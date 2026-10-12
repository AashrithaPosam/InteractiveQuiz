import { createInsertSchema } from "drizzle-zod";
import { pgTable, jsonb, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export type QuizMode = "static" | "competition";
export type QuizTimerMode = "none" | "per_question" | "total";
export type QuizTheme =
  | "playful"
  | "modern"
  | "tech"
  | "minimal"
  | "professional"
  | "gamified";
export type QuizStatus = "draft" | "published" | "active";

export interface StoredQuestion {
  id: string;
  prompt: string;
  options: string[];
  correctOption: number;
  timeLimitSeconds: number | null;
}

export interface StoredAnswer {
  questionIndex: number;
  selectedOption: number;
}

export const quizzesTable = pgTable("quizzes", {
  code: text("code").primaryKey(),
  creatorTokenHash: text("creator_token_hash").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  mode: text("mode").$type<QuizMode>().notNull(),
  timerMode: text("timer_mode").$type<QuizTimerMode>().notNull(),
  totalDurationMinutes: text("total_duration_minutes"),
  theme: text("theme").$type<QuizTheme>().notNull(),
  questions: jsonb("questions").$type<StoredQuestion[]>().notNull(),
  status: text("status").$type<QuizStatus>().notNull().default("draft"),
  competitionStartedAt: text("competition_started_at"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const attemptsTable = pgTable("quiz_attempts", {
  id: text("id").primaryKey(),
  quizCode: text("quiz_code").notNull().references(() => quizzesTable.code, { onDelete: "cascade" }),
  participantName: text("participant_name").notNull(),
  answers: jsonb("answers").$type<StoredAnswer[]>().notNull().default([]),
  currentQuestionIndex: text("current_question_index").notNull().default("0"),
  questionStartedAt: text("question_started_at"),
  startedAt: text("started_at").notNull(),
  totalDeadline: text("total_deadline"),
  status: text("status").notNull().default("in_progress"),
  score: text("score"),
  submittedAt: text("submitted_at"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertQuizSchema = createInsertSchema(quizzesTable);
export const insertAttemptSchema = createInsertSchema(attemptsTable);
export type QuizRecord = typeof quizzesTable.$inferSelect;
export type AttemptRecord = typeof attemptsTable.$inferSelect;
export type InsertQuiz = z.infer<typeof insertQuizSchema>;
export type InsertAttempt = z.infer<typeof insertAttemptSchema>;
