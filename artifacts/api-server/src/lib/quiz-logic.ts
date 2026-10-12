import type {
  AttemptRecord,
  QuizRecord,
  StoredAnswer,
  StoredQuestion,
} from "@workspace/db";

export const nowMs = (): number => Date.now();

export function toQuizSummary(quiz: QuizRecord) {
  return {
    code: quiz.code,
    title: quiz.title,
    description: quiz.description,
    mode: quiz.mode,
    timerMode: quiz.timerMode,
    totalDurationMinutes:
      quiz.totalDurationMinutes === null
        ? null
        : Number(quiz.totalDurationMinutes),
    theme: quiz.theme,
    questionCount: quiz.questions.length,
    status: quiz.status,
  };
}

export function toQuizEditor(quiz: QuizRecord) {
  return {
    ...toQuizSummary(quiz),
    questions: quiz.questions.map((question) => ({
      id: question.id,
      prompt: question.prompt,
      options: question.options,
      correctOption: question.correctOption,
      ...(question.timeLimitSeconds === null
        ? {}
        : { timeLimitSeconds: question.timeLimitSeconds }),
    })),
  };
}

export function toQuizPublic(quiz: QuizRecord) {
  return {
    ...toQuizSummary(quiz),
    questions: quiz.questions.map((question) => ({
      id: question.id,
      prompt: question.prompt,
      options: question.options,
      timeLimitSeconds: question.timeLimitSeconds,
    })),
    competitionStartedAt:
      quiz.competitionStartedAt === null
        ? null
        : Number(quiz.competitionStartedAt),
  };
}

export function calculateScore(
  questions: StoredQuestion[],
  answers: StoredAnswer[],
): number {
  return answers.reduce((score, answer) => {
    return questions[answer.questionIndex]?.correctOption ===
      answer.selectedOption
      ? score + 1
      : score;
  }, 0);
}

export function getQuestionDeadline(
  quiz: QuizRecord,
  attempt: AttemptRecord,
): number | null {
  if (quiz.timerMode !== "per_question") return null;
  if (quiz.mode === "competition") {
    if (quiz.competitionStartedAt === null) return null;
    const start = Number(quiz.competitionStartedAt);
    const index = getCompetitionQuestionIndex(quiz, start, nowMs());
    return start + durationThroughQuestion(quiz.questions, index);
  }
  if (attempt.questionStartedAt === null) return null;
  const index = Number(attempt.currentQuestionIndex);
  const duration = quiz.questions[index]?.timeLimitSeconds ?? 1;
  return Number(attempt.questionStartedAt) + duration * 1000;
}

export function getTotalDeadline(
  quiz: QuizRecord,
  attempt: AttemptRecord,
): number | null {
  if (quiz.timerMode !== "total") return null;
  const durationMinutes =
    quiz.totalDurationMinutes === null
      ? 0
      : Number(quiz.totalDurationMinutes);
  if (quiz.mode === "competition") {
    if (quiz.competitionStartedAt === null) return null;
    return Number(quiz.competitionStartedAt) + durationMinutes * 60_000;
  }
  return Number(attempt.totalDeadline);
}

export function getCompetitionQuestionIndex(
  quiz: QuizRecord,
  startedAt: number,
  currentTime: number,
): number {
  const elapsed = Math.max(0, currentTime - startedAt);
  let elapsedThroughQuestion = 0;
  for (let index = 0; index < quiz.questions.length; index += 1) {
    elapsedThroughQuestion +=
      (quiz.questions[index]?.timeLimitSeconds ?? 1) * 1000;
    if (elapsed < elapsedThroughQuestion) return index;
  }
  return Math.max(0, quiz.questions.length - 1);
}

export function getCompetitionEndTime(quiz: QuizRecord): number | null {
  if (
    quiz.mode !== "competition" ||
    quiz.timerMode !== "per_question" ||
    quiz.competitionStartedAt === null
  ) {
    return null;
  }
  return (
    Number(quiz.competitionStartedAt) +
    durationThroughQuestion(quiz.questions, quiz.questions.length - 1)
  );
}

export function getCurrentQuestionIndex(
  quiz: QuizRecord,
  attempt: AttemptRecord,
  currentTime: number,
): number {
  if (
    quiz.mode === "competition" &&
    quiz.timerMode === "per_question" &&
    quiz.competitionStartedAt !== null
  ) {
    return getCompetitionQuestionIndex(
      quiz,
      Number(quiz.competitionStartedAt),
      currentTime,
    );
  }
  return Math.min(
    Number(attempt.currentQuestionIndex),
    Math.max(0, quiz.questions.length - 1),
  );
}

export function getAttemptDeadline(
  quiz: QuizRecord,
  attempt: AttemptRecord,
  currentTime: number,
): number | null {
  const totalDeadline = getTotalDeadline(quiz, attempt);
  if (totalDeadline !== null) return totalDeadline;
  const questionDeadline = getQuestionDeadline(quiz, attempt);
  if (questionDeadline !== null) return questionDeadline;
  if (
    quiz.mode === "competition" &&
    quiz.timerMode === "per_question" &&
    quiz.competitionStartedAt !== null
  ) {
    return getCompetitionEndTime(quiz) ?? currentTime;
  }
  return null;
}

function durationThroughQuestion(
  questions: StoredQuestion[],
  questionIndex: number,
): number {
  return questions
    .slice(0, questionIndex + 1)
    .reduce(
      (duration, question) =>
        duration + (question.timeLimitSeconds ?? 1) * 1000,
      0,
    );
}
