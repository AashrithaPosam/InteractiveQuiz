import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, or } from "drizzle-orm";
import { Router, type IRouter, type Request } from "express";
import {
  db,
  attemptsTable,
  quizzesTable,
  type AttemptRecord,
  type QuizRecord,
  type StoredAnswer,
  type StoredQuestion,
} from "@workspace/db";
import {
  CreateQuizBody,
  CreateQuizResponse,
  FinishAttemptParams,
  FinishAttemptResponse,
  GetAttemptParams,
  GetAttemptResponse,
  GetLeaderboardParams,
  GetLeaderboardResponse,
  GetQuizEditorHeader,
  GetQuizEditorParams,
  GetQuizEditorResponse,
  GetQuizParams,
  GetQuizResponse,
  ListQuizzesResponse,
  NavigateAttemptBody,
  NavigateAttemptParams,
  NavigateAttemptResponse,
  PublishQuizHeader,
  PublishQuizParams,
  PublishQuizResponse,
  StartAttemptBody,
  StartAttemptParams,
  StartAttemptResponse,
  StartCompetitionHeader,
  StartCompetitionParams,
  StartCompetitionResponse,
  StopCompetitionHeader,
  StopCompetitionParams,
  StopCompetitionResponse,
  SubmitAnswerBody,
  SubmitAnswerParams,
  SubmitAnswerResponse,
  UpdateQuizBody,
  UpdateQuizHeader,
  UpdateQuizParams,
  UpdateQuizResponse,
} from "@workspace/api-zod";
import {
  calculateScore,
  getAttemptDeadline,
  getCompetitionEndTime,
  getCompetitionQuestionIndex,
  getCurrentQuestionIndex,
  getQuestionDeadline,
  getTotalDeadline,
  nowMs,
  toQuizEditor,
  toQuizPublic,
  toQuizSummary,
} from "../lib/quiz-logic";

const router: IRouter = Router();
const joinCodeAlphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function creatorToken(req: Request): string {
  return req.get("X-Creator-Token") ?? "";
}

function validConfiguration(
  input: {
    mode: "static" | "competition";
    timerMode: "none" | "per_question" | "total";
    totalDurationMinutes: number | null;
    questions: Array<{ options: string[]; correctOption: number; timeLimitSeconds?: number | null }>;
  },
): string | null {
  if (input.mode === "competition" && input.timerMode === "none") {
    return "Competition quizzes need a per-question or total timer.";
  }
  if (
    input.timerMode === "total" &&
    (!input.totalDurationMinutes || input.totalDurationMinutes <= 0)
  ) {
    return "Set a positive total duration in minutes.";
  }
  if (input.timerMode !== "total" && input.totalDurationMinutes !== null) {
    return "Only total quiz timers can have a total duration.";
  }
  for (const [index, question] of input.questions.entries()) {
    if (
      question.options.some((option) => option.trim().length === 0)
    ) {
      return `Every answer option on question ${index + 1} needs text.`;
    }
    if (
      question.correctOption < 0 ||
      question.correctOption >= question.options.length
    ) {
      return `Choose a correct answer for question ${index + 1}.`;
    }
    if (
      input.timerMode === "per_question" &&
      (!question.timeLimitSeconds || question.timeLimitSeconds <= 0)
    ) {
      return `Set a positive time limit for question ${index + 1}.`;
    }
  }
  return null;
}

function createCode(): string {
  return Array.from(randomBytes(6), (byte) =>
    joinCodeAlphabet[byte % joinCodeAlphabet.length],
  ).join("");
}

function questionsFromInput(
  questions: Array<{
    prompt: string;
    options: string[];
    correctOption: number;
    timeLimitSeconds?: number;
  }>,
): StoredQuestion[] {
  return questions.map((question) => ({
    id: randomUUID(),
    prompt: question.prompt.trim(),
    options: question.options.map((option) => option.trim()),
    correctOption: question.correctOption,
    timeLimitSeconds: question.timeLimitSeconds ?? null,
  }));
}

async function findQuiz(code: string): Promise<QuizRecord | undefined> {
  const [quiz] = await db
    .select()
    .from(quizzesTable)
    .where(eq(quizzesTable.code, code.toUpperCase()))
    .limit(1);
  return quiz;
}

async function findAttempt(id: string): Promise<AttemptRecord | undefined> {
  const [attempt] = await db
    .select()
    .from(attemptsTable)
    .where(eq(attemptsTable.id, id))
    .limit(1);
  return attempt;
}

function hasCreatorAccess(
  quiz: QuizRecord,
  suppliedToken: string,
): boolean {
  return (
    suppliedToken.length > 0 &&
    tokenHash(suppliedToken) === quiz.creatorTokenHash
  );
}

async function leaderboardFor(quiz: QuizRecord) {
  const attempts = await db
    .select()
    .from(attemptsTable)
    .where(eq(attemptsTable.quizCode, quiz.code));
  const currentRoundAttempts =
    quiz.mode === "competition" &&
    quiz.status === "active" &&
    quiz.competitionStartedAt !== null
      ? attempts.filter(
          (attempt) =>
            Number(attempt.startedAt) >= Number(quiz.competitionStartedAt),
        )
      : attempts;
  const refreshed = await Promise.all(
    currentRoundAttempts.map(async (attempt) => {
      const current = await refreshAttempt(quiz, attempt, nowMs());
      return {
      participantName: attempt.participantName,
      score:
        current.score === null
          ? calculateScore(quiz.questions, current.answers)
          : Number(current.score),
      completedAt:
        current.submittedAt === null ? null : Number(current.submittedAt),
      };
    }),
  );
  return refreshed
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      if (a.completedAt === null) return 1;
      if (b.completedAt === null) return -1;
      return a.completedAt - b.completedAt;
    });
}

async function finishAttempt(
  quiz: QuizRecord,
  attempt: AttemptRecord,
  finishedAt: number,
): Promise<AttemptRecord> {
  if (attempt.status === "submitted") return attempt;
  const score = calculateScore(quiz.questions, attempt.answers);
  const [updated] = await db
    .update(attemptsTable)
    .set({
      status: "submitted",
      score: String(score),
      submittedAt: String(finishedAt),
    })
    .where(eq(attemptsTable.id, attempt.id))
    .returning();
  return updated ?? attempt;
}

async function refreshAttempt(
  quiz: QuizRecord,
  original: AttemptRecord,
  currentTime: number,
): Promise<AttemptRecord> {
  let attempt = original;
  if (attempt.status === "submitted") return attempt;

  const deadline =
    quiz.timerMode === "per_question" && quiz.mode === "static"
      ? null
      : getAttemptDeadline(quiz, attempt, currentTime);
  if (deadline !== null && currentTime >= deadline) {
    return finishAttempt(quiz, attempt, deadline);
  }

  if (
    quiz.mode === "static" &&
    quiz.timerMode === "per_question" &&
    attempt.questionStartedAt !== null
  ) {
    let questionIndex = Number(attempt.currentQuestionIndex);
    let questionStartedAt = Number(attempt.questionStartedAt);
    while (questionIndex < quiz.questions.length) {
      const seconds = quiz.questions[questionIndex]?.timeLimitSeconds ?? 1;
      const nextDeadline = questionStartedAt + seconds * 1000;
      if (currentTime < nextDeadline) break;
      questionIndex += 1;
      if (questionIndex >= quiz.questions.length) {
        return finishAttempt(quiz, attempt, nextDeadline);
      }
      questionStartedAt = nextDeadline;
    }
    if (
      questionIndex !== Number(attempt.currentQuestionIndex) ||
      questionStartedAt !== Number(attempt.questionStartedAt)
    ) {
      const [updated] = await db
        .update(attemptsTable)
        .set({
          currentQuestionIndex: String(questionIndex),
          questionStartedAt: String(questionStartedAt),
        })
        .where(eq(attemptsTable.id, attempt.id))
        .returning();
      attempt = updated ?? attempt;
    }
  }
  return attempt;
}

async function attemptResponse(
  quiz: QuizRecord,
  startingAttempt: AttemptRecord,
): Promise<{
  id: string;
  quiz: ReturnType<typeof toQuizPublic>;
  participantName: string;
  answers: StoredAnswer[];
  currentQuestionIndex: number;
  questionDeadline: number | null;
  totalDeadline: number | null;
  serverNow: number;
  status: "in_progress" | "submitted";
  score: number | null;
  leaderboard: Awaited<ReturnType<typeof leaderboardFor>>;
}> {
  const serverNow = nowMs();
  const attempt = await refreshAttempt(quiz, startingAttempt, serverNow);
  const questionIndex = getCurrentQuestionIndex(quiz, attempt, serverNow);
  return {
    id: attempt.id,
    quiz: toQuizPublic(quiz),
    participantName: attempt.participantName,
    answers: attempt.answers,
    currentQuestionIndex: questionIndex,
    questionDeadline:
      attempt.status === "submitted"
        ? null
        : getQuestionDeadline(quiz, attempt),
    totalDeadline:
      attempt.status === "submitted"
        ? null
        : getTotalDeadline(quiz, attempt),
    serverNow,
    status: attempt.status as "in_progress" | "submitted",
    score:
      attempt.status === "submitted"
        ? Number(attempt.score)
        : calculateScore(quiz.questions, attempt.answers),
    leaderboard: await leaderboardFor(quiz),
  };
}

router.get("/quizzes", async (_req, res): Promise<void> => {
  const quizzes = await db
    .select()
    .from(quizzesTable)
    .where(
      or(
        eq(quizzesTable.status, "published"),
        eq(quizzesTable.status, "active"),
      ),
    )
    .orderBy(desc(quizzesTable.createdAt))
    .limit(30);
  res.json(ListQuizzesResponse.parse(quizzes.map(toQuizSummary)));
});

router.post("/quizzes", async (req, res): Promise<void> => {
  const parsed = CreateQuizBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const configError = validConfiguration(parsed.data);
  if (configError) {
    res.status(400).json({ error: configError });
    return;
  }
  const token = randomBytes(32).toString("base64url");
  const code = createCode();
  const questions = questionsFromInput(parsed.data.questions);
  const [quiz] = await db
    .insert(quizzesTable)
    .values({
      code,
      creatorTokenHash: tokenHash(token),
      title: parsed.data.title.trim(),
      description: parsed.data.description.trim(),
      mode: parsed.data.mode,
      timerMode: parsed.data.timerMode,
      totalDurationMinutes:
        parsed.data.totalDurationMinutes === null
          ? null
          : String(parsed.data.totalDurationMinutes),
      theme: parsed.data.theme,
      questions,
      status: "draft",
    })
    .returning();
  if (!quiz) {
    res.status(500).json({ error: "Quiz could not be created." });
    return;
  }
  res
    .status(201)
    .json(CreateQuizResponse.parse({ quiz: toQuizEditor(quiz), creatorToken: token }));
});

router.get("/quizzes/:code", async (req, res): Promise<void> => {
  const params = GetQuizParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const quiz = await findQuiz(params.data.code);
  if (!quiz || quiz.status === "draft") {
    res.status(404).json({ error: "Quiz not found." });
    return;
  }
  res.json(GetQuizResponse.parse(toQuizPublic(quiz)));
});

router.get("/quizzes/:code/editor", async (req, res): Promise<void> => {
  const params = GetQuizEditorParams.safeParse(req.params);
  const headers = GetQuizEditorHeader.safeParse({
    "X-Creator-Token": creatorToken(req),
  });
  if (!params.success || !headers.success) {
    res.status(400).json({ error: "Quiz code and creator token are required." });
    return;
  }
  const quiz = await findQuiz(params.data.code);
  if (!quiz) {
    res.status(404).json({ error: "Quiz not found." });
    return;
  }
  if (!hasCreatorAccess(quiz, headers.data["X-Creator-Token"])) {
    res.status(403).json({ error: "Creator access is invalid." });
    return;
  }
  res.json(GetQuizEditorResponse.parse(toQuizEditor(quiz)));
});

router.patch("/quizzes/:code/editor", async (req, res): Promise<void> => {
  const params = UpdateQuizParams.safeParse(req.params);
  const headers = UpdateQuizHeader.safeParse({
    "X-Creator-Token": creatorToken(req),
  });
  const parsed = UpdateQuizBody.safeParse(req.body);
  if (!params.success || !headers.success || !parsed.success) {
    res.status(400).json({
      error: parsed.success ? "Quiz code and creator token are required." : parsed.error.message,
    });
    return;
  }
  const configError = validConfiguration(parsed.data);
  if (configError) {
    res.status(400).json({ error: configError });
    return;
  }
  const quiz = await findQuiz(params.data.code);
  if (!quiz) {
    res.status(404).json({ error: "Quiz not found." });
    return;
  }
  if (!hasCreatorAccess(quiz, headers.data["X-Creator-Token"])) {
    res.status(403).json({ error: "Creator access is invalid." });
    return;
  }
  if (quiz.status === "active") {
    res.status(409).json({ error: "Stop and reset the competition before editing." });
    return;
  }
  const [activeAttempt] = await db
    .select({ id: attemptsTable.id })
    .from(attemptsTable)
    .where(
      and(
        eq(attemptsTable.quizCode, quiz.code),
        eq(attemptsTable.status, "in_progress"),
      ),
    )
    .limit(1);
  if (activeAttempt) {
    res.status(409).json({ error: "A participant is taking this quiz; finish or reset attempts before editing." });
    return;
  }
  const [updated] = await db
    .update(quizzesTable)
    .set({
      title: parsed.data.title.trim(),
      description: parsed.data.description.trim(),
      mode: parsed.data.mode,
      timerMode: parsed.data.timerMode,
      totalDurationMinutes:
        parsed.data.totalDurationMinutes === null
          ? null
          : String(parsed.data.totalDurationMinutes),
      theme: parsed.data.theme,
      questions: questionsFromInput(parsed.data.questions),
    })
    .where(eq(quizzesTable.code, quiz.code))
    .returning();
  if (!updated) {
    res.status(500).json({ error: "Quiz could not be updated." });
    return;
  }
  res.json(UpdateQuizResponse.parse(toQuizEditor(updated)));
});

router.post("/quizzes/:code/publish", async (req, res): Promise<void> => {
  const params = PublishQuizParams.safeParse(req.params);
  const headers = PublishQuizHeader.safeParse({
    "X-Creator-Token": creatorToken(req),
  });
  if (!params.success || !headers.success) {
    res.status(400).json({ error: "Quiz code and creator token are required." });
    return;
  }
  const quiz = await findQuiz(params.data.code);
  if (!quiz) {
    res.status(404).json({ error: "Quiz not found." });
    return;
  }
  if (!hasCreatorAccess(quiz, headers.data["X-Creator-Token"])) {
    res.status(403).json({ error: "Creator access is invalid." });
    return;
  }
  const configError = validConfiguration({
    mode: quiz.mode,
    timerMode: quiz.timerMode,
    totalDurationMinutes:
      quiz.totalDurationMinutes === null
        ? null
        : Number(quiz.totalDurationMinutes),
    questions: quiz.questions,
  });
  if (configError) {
    res.status(400).json({ error: configError });
    return;
  }
  if (quiz.status === "active") {
    res.status(409).json({ error: "This competition has already started." });
    return;
  }
  const [updated] = await db
    .update(quizzesTable)
    .set({ status: "published" })
    .where(eq(quizzesTable.code, quiz.code))
    .returning();
  res.json(PublishQuizResponse.parse(toQuizEditor(updated ?? quiz)));
});

router.post("/quizzes/:code/start", async (req, res): Promise<void> => {
  const params = StartCompetitionParams.safeParse(req.params);
  const headers = StartCompetitionHeader.safeParse({
    "X-Creator-Token": creatorToken(req),
  });
  if (!params.success || !headers.success) {
    res.status(400).json({ error: "Quiz code and creator token are required." });
    return;
  }
  const quiz = await findQuiz(params.data.code);
  if (!quiz) {
    res.status(404).json({ error: "Quiz not found." });
    return;
  }
  if (!hasCreatorAccess(quiz, headers.data["X-Creator-Token"])) {
    res.status(403).json({ error: "Creator access is invalid." });
    return;
  }
  if (quiz.mode !== "competition" || quiz.status !== "published") {
    res.status(409).json({ error: "Only a published competition can be started." });
    return;
  }
  const startedAt = nowMs();
  const [updated] = await db
    .update(quizzesTable)
    .set({ status: "active", competitionStartedAt: String(startedAt) })
    .where(
      and(
        eq(quizzesTable.code, quiz.code),
        eq(quizzesTable.status, "published"),
      ),
    )
    .returning();
  if (!updated) {
    res.status(409).json({ error: "This competition has already started." });
    return;
  }
  res.json(
    StartCompetitionResponse.parse({
      startedAt,
      serverNow: nowMs(),
    }),
  );
});

router.post("/quizzes/:code/stop", async (req, res): Promise<void> => {
  const params = StopCompetitionParams.safeParse(req.params);
  const headers = StopCompetitionHeader.safeParse({
    "X-Creator-Token": creatorToken(req),
  });
  if (!params.success || !headers.success) {
    res.status(400).json({ error: "Quiz code and creator token are required." });
    return;
  }
  const quiz = await findQuiz(params.data.code);
  if (!quiz) {
    res.status(404).json({ error: "Quiz not found." });
    return;
  }
  if (!hasCreatorAccess(quiz, headers.data["X-Creator-Token"])) {
    res.status(403).json({ error: "Creator access is invalid." });
    return;
  }
  if (quiz.mode !== "competition" || quiz.status !== "active") {
    res.status(409).json({ error: "Only an active competition can be stopped." });
    return;
  }

  const stoppedAt = nowMs();
  const updated = await db.transaction(async (tx) => {
    const [stoppedQuiz] = await tx
      .update(quizzesTable)
      .set({ status: "published", competitionStartedAt: null })
      .where(
        and(
          eq(quizzesTable.code, quiz.code),
          eq(quizzesTable.status, "active"),
        ),
      )
      .returning();
    if (!stoppedQuiz) return null;

    const activeAttempts = await tx
      .select()
      .from(attemptsTable)
      .where(
        and(
          eq(attemptsTable.quizCode, quiz.code),
          eq(attemptsTable.status, "in_progress"),
        ),
      );
    for (const attempt of activeAttempts) {
      await tx
        .update(attemptsTable)
        .set({
          status: "submitted",
          score: String(calculateScore(quiz.questions, attempt.answers)),
          submittedAt: String(stoppedAt),
        })
        .where(
          and(
            eq(attemptsTable.id, attempt.id),
            eq(attemptsTable.status, "in_progress"),
          ),
        );
    }
    return stoppedQuiz;
  });
  if (!updated) {
    res.status(409).json({ error: "This competition is no longer active." });
    return;
  }
  res.json(StopCompetitionResponse.parse(toQuizSummary(updated)));
});

router.get("/quizzes/:code/leaderboard", async (req, res): Promise<void> => {
  const params = GetLeaderboardParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const quiz = await findQuiz(params.data.code);
  if (!quiz || quiz.status === "draft") {
    res.status(404).json({ error: "Quiz not found." });
    return;
  }
  const entries = await leaderboardFor(quiz);
  res.json(GetLeaderboardResponse.parse(entries));
});

router.post("/quizzes/:code/attempts", async (req, res): Promise<void> => {
  const params = StartAttemptParams.safeParse(req.params);
  const parsed = StartAttemptBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const quiz = await findQuiz(params.data.code);
  if (!quiz) {
    res.status(404).json({ error: "Quiz not found." });
    return;
  }
  if (
    quiz.status === "draft" ||
    (quiz.mode === "competition" && quiz.status !== "active")
  ) {
    res.status(409).json({ error: "This quiz is not accepting participants." });
    return;
  }
  const startedAt =
    quiz.mode === "competition"
      ? Number(quiz.competitionStartedAt)
      : nowMs();
  const duration =
    quiz.totalDurationMinutes === null
      ? null
      : Number(quiz.totalDurationMinutes) * 60_000;
  const [attempt] = await db
    .insert(attemptsTable)
    .values({
      id: randomUUID(),
      quizCode: quiz.code,
      participantName: parsed.data.participantName.trim().slice(0, 48),
      answers: [],
      currentQuestionIndex:
        quiz.mode === "competition" && quiz.timerMode === "per_question"
          ? String(
              getCompetitionQuestionIndex(quiz, startedAt, nowMs()),
            )
          : "0",
      questionStartedAt:
        quiz.mode === "competition"
          ? null
          : quiz.timerMode === "per_question"
            ? String(startedAt)
            : null,
      startedAt: String(startedAt),
      totalDeadline:
        quiz.mode === "static" &&
        quiz.timerMode === "total" &&
        duration !== null
          ? String(startedAt + duration)
          : null,
      status: "in_progress",
    })
    .returning();
  if (!attempt) {
    res.status(500).json({ error: "Could not start this attempt." });
    return;
  }
  const response = await attemptResponse(quiz, attempt);
  res.status(201).json(StartAttemptResponse.parse(response));
});

router.get("/attempts/:attemptId", async (req, res): Promise<void> => {
  const params = GetAttemptParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const attempt = await findAttempt(params.data.attemptId);
  if (!attempt) {
    res.status(404).json({ error: "Attempt not found." });
    return;
  }
  const quiz = await findQuiz(attempt.quizCode);
  if (!quiz) {
    res.status(404).json({ error: "Quiz not found." });
    return;
  }
  res.json(GetAttemptResponse.parse(await attemptResponse(quiz, attempt)));
});

router.post("/attempts/:attemptId/answers", async (req, res): Promise<void> => {
  const params = SubmitAnswerParams.safeParse(req.params);
  const parsed = SubmitAnswerBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const attempt = await findAttempt(params.data.attemptId);
  if (!attempt) {
    res.status(404).json({ error: "Attempt not found." });
    return;
  }
  const quiz = await findQuiz(attempt.quizCode);
  if (!quiz) {
    res.status(404).json({ error: "Quiz not found." });
    return;
  }
  const currentTime = nowMs();
  const refreshed = await refreshAttempt(quiz, attempt, currentTime);
  if (refreshed.status === "submitted") {
    res.status(409).json({ error: "This attempt is already submitted or its timer expired." });
    return;
  }
  const { questionIndex, selectedOption } = parsed.data;
  if (
    questionIndex >= quiz.questions.length ||
    selectedOption >= (quiz.questions[questionIndex]?.options.length ?? 0)
  ) {
    res.status(400).json({ error: "Question or answer option is out of range." });
    return;
  }
  if (
    quiz.timerMode === "per_question" &&
    questionIndex !== getCurrentQuestionIndex(quiz, refreshed, currentTime)
  ) {
    res.status(409).json({ error: "That question is no longer active." });
    return;
  }
  const deadline = getAttemptDeadline(quiz, refreshed, currentTime);
  if (deadline !== null && currentTime >= deadline) {
    await finishAttempt(quiz, refreshed, deadline);
    res.status(409).json({ error: "The answer deadline has passed." });
    return;
  }
  const answers = refreshed.answers.filter(
    (answer) => answer.questionIndex !== questionIndex,
  );
  answers.push({ questionIndex, selectedOption });
  const [updated] = await db
    .update(attemptsTable)
    .set({
      answers,
      score: String(calculateScore(quiz.questions, answers)),
    })
    .where(
      and(
        eq(attemptsTable.id, refreshed.id),
        eq(attemptsTable.status, "in_progress"),
      ),
    )
    .returning();
  const response = await attemptResponse(quiz, updated ?? refreshed);
  res.json(SubmitAnswerResponse.parse(response));
});

router.post("/attempts/:attemptId/navigate", async (req, res): Promise<void> => {
  const params = NavigateAttemptParams.safeParse(req.params);
  const parsed = NavigateAttemptBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const attempt = await findAttempt(params.data.attemptId);
  if (!attempt) {
    res.status(404).json({ error: "Attempt not found." });
    return;
  }
  const quiz = await findQuiz(attempt.quizCode);
  if (!quiz) {
    res.status(404).json({ error: "Quiz not found." });
    return;
  }
  const currentTime = nowMs();
  const refreshed = await refreshAttempt(quiz, attempt, currentTime);
  if (refreshed.status === "submitted") {
    res.status(409).json({ error: "This attempt is already submitted or its timer expired." });
    return;
  }
  const target = parsed.data.questionIndex;
  const current = getCurrentQuestionIndex(quiz, refreshed, currentTime);
  if (
    target >= quiz.questions.length ||
    (quiz.mode === "competition" && quiz.timerMode === "per_question") ||
    (quiz.timerMode === "per_question" &&
      (target < current || target > current + 1))
  ) {
    res.status(409).json({ error: "Navigation is not allowed for this timer mode." });
    return;
  }
  if (quiz.timerMode === "per_question" && target > current) {
    const [updated] = await db
      .update(attemptsTable)
      .set({
        currentQuestionIndex: String(target),
        questionStartedAt: String(currentTime),
      })
      .where(eq(attemptsTable.id, refreshed.id))
      .returning();
    res.json(
      NavigateAttemptResponse.parse(
        await attemptResponse(quiz, updated ?? refreshed),
      ),
    );
    return;
  }
  const [updated] = await db
    .update(attemptsTable)
    .set({ currentQuestionIndex: String(target) })
    .where(eq(attemptsTable.id, refreshed.id))
    .returning();
  res.json(
    NavigateAttemptResponse.parse(
      await attemptResponse(quiz, updated ?? refreshed),
    ),
  );
});

router.post("/attempts/:attemptId/submit", async (req, res): Promise<void> => {
  const params = FinishAttemptParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const attempt = await findAttempt(params.data.attemptId);
  if (!attempt) {
    res.status(404).json({ error: "Attempt not found." });
    return;
  }
  const quiz = await findQuiz(attempt.quizCode);
  if (!quiz) {
    res.status(404).json({ error: "Quiz not found." });
    return;
  }
  const currentTime = nowMs();
  const refreshed = await refreshAttempt(quiz, attempt, currentTime);
  const deadline = getAttemptDeadline(quiz, refreshed, currentTime);
  const finished = await finishAttempt(
    quiz,
    refreshed,
    deadline !== null && deadline < currentTime ? deadline : currentTime,
  );
  res.json(
    FinishAttemptResponse.parse(await attemptResponse(quiz, finished)),
  );
});

export default router;
