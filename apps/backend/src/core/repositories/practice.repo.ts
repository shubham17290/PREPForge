// PHASE 8 - Practice sessions + attempts data access (Phase 3 §6.15-6.17)
// PHASE 12G-T9 - Enhanced Practice repository layer with answer-state persistence

import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

// Session Config & Metadata Interfaces
export interface SessionConfig {
  mode: string;
  filters: {
    subject_id?: string;
    topic_id?: string;
    year?: number;
    difficulty?: string;
    question_types?: string[];
  };
  question_count: number;
  pool: string[] | null;
  frozenPoolSnapshot?: unknown;
  selectionMetadata?: unknown;
}

export interface FrozenPoolSnapshot {
  questionIds: string[];
  questionVersionIds: string[];
  selectedAt: string;
  metadata?: Record<string, unknown>;
}

export interface SelectionMetadata {
  poolSnapshot: FrozenPoolSnapshot;
  selectedQuestionIds?: string[];
  excludedQuestionIds?: string[];
  shuffleSeed?: number;
  createdAt: string;
}

// Practice Mode
export async function ensurePracticeMode(code: string): Promise<{ id: string; code: string }> {
  const existing = await prisma.practiceMode.findUnique({ where: { code } });
  if (existing) return existing;
  return prisma.practiceMode.create({
    data: { code, name: code.charAt(0).toUpperCase() + code.slice(1) },
  });
}

// Session Create / Find
export async function createSession(input: {
  userId: string;
  modeId: string;
  config: SessionConfig;
  timed: boolean;
  totalQuestions: number;
  frozenPoolSnapshot?: unknown;
  selectionMetadata?: unknown;
}) {
  const configData: Record<string, unknown> = {
    mode: input.config.mode,
    filters: input.config.filters,
    question_count: input.config.question_count,
    pool: input.config.pool,
  };
  if (input.frozenPoolSnapshot) { configData.frozenPoolSnapshot = input.frozenPoolSnapshot; }
  if (input.selectionMetadata) { configData.selectionMetadata = input.selectionMetadata; }

  return prisma.practiceSession.create({
    data: {
      userId: input.userId,
      modeId: input.modeId,
      config: configData as unknown as Prisma.InputJsonValue,
      timed: input.timed,
      totalQuestions: input.totalQuestions,
      status: "in_progress",
    },
  });
}

export async function findSessionById(id: string) {
  return prisma.practiceSession.findUnique({ where: { id } });
}

export async function findSessionByIdAndOwner(id: string, userId: string) {
  return prisma.practiceSession.findFirst({ where: { id, userId } });
}

export async function parseSessionConfig(config: unknown): Promise<SessionConfig> {
  if (typeof config !== "object" || config === null) {
    throw new Error("Invalid session config");
  }
  const cfg = config as Record<string, unknown>;
  return {
    mode: (cfg.mode as string) ?? "default",
    filters: (cfg.filters as SessionConfig["filters"]) ?? {},
    question_count: (cfg.question_count as number) ?? 0,
    pool: (cfg.pool as string[] | null) ?? null,
    frozenPoolSnapshot: cfg.frozenPoolSnapshot,
    selectionMetadata: cfg.selectionMetadata,
  };
}

// Session With Answers
const SESSION_WITH_ANSWERS_INCLUDE = {
  include: { attempts: { include: { questionVersion: true } } },
};
export type SessionWithAnswersRow = Awaited<
  any
>;

export async function findSessionWithAnswersById(id: string): Promise<SessionWithAnswersRow> {
  return prisma.practiceSession.findUnique({
    where: { id },
    ...SESSION_WITH_ANSWERS_INCLUDE,
  });
}

export async function findSessionWithAnswersByIdAndOwner(id: string, userId: string): Promise<SessionWithAnswersRow> {
  return prisma.practiceSession.findFirst({
    where: { id, userId },
    ...SESSION_WITH_ANSWERS_INCLUDE,
  });
}

// Session Management
export async function savePool(sessionId: string, _questionIds: string[], _userId?: string) {
  return prisma.practiceSession.findUnique({ where: { id: sessionId } });
}

export async function saveFrozenPoolSnapshot(sessionId: string, snapshot: FrozenPoolSnapshot, userId?: string) {
  const session = userId
    ? await prisma.practiceSession.findFirst({ where: { id: sessionId, userId } })
    : await prisma.practiceSession.findUnique({ where: { id: sessionId } });
  if (!session) throw new Error("Session " + sessionId + " not found");
  const config = typeof session.config === "object" ? session.config as Record<string, unknown> : {};
  config.frozenPoolSnapshot = snapshot;
  return prisma.practiceSession.update({
    where: { id: sessionId },
    data: { config: config as unknown as Prisma.InputJsonValue },
  });
}

export async function saveSelectionMetadata(sessionId: string, metadata: SelectionMetadata, userId?: string) {
  const session = userId
    ? await prisma.practiceSession.findFirst({ where: { id: sessionId, userId } })
    : await prisma.practiceSession.findUnique({ where: { id: sessionId } });
  if (!session) throw new Error("Session " + sessionId + " not found");
  const config = typeof session.config === "object" ? session.config as Record<string, unknown> : {};
  config.selectionMetadata = metadata;
  return prisma.practiceSession.update({
    where: { id: sessionId },
    data: { config: config as unknown as Prisma.InputJsonValue },
  });
}

export async function updateSessionStatus(sessionId: string, status: string, _userId?: string) {
  return prisma.practiceSession.update({
    where: { id: sessionId },
    data: { status },
  });
}

export async function completeSession(sessionId: string, score: number, userId?: string) {
  const session = userId
    ? await prisma.practiceSession.findFirst({ where: { id: sessionId, userId } })
    : await prisma.practiceSession.findUnique({ where: { id: sessionId } });
  if (!session) throw new Error("Session " + sessionId + " not found");
  return prisma.practiceSession.update({
    where: { id: sessionId },
    data: { status: "completed", endedAt: new Date(), score: score as unknown as Prisma.Decimal },
  });
}

export async function abandonSession(sessionId: string, userId?: string) {
  const session = userId
    ? await prisma.practiceSession.findFirst({ where: { id: sessionId, userId } })
    : await prisma.practiceSession.findUnique({ where: { id: sessionId } });
  if (!session) throw new Error("Session " + sessionId + " not found");
  return prisma.practiceSession.update({
    where: { id: sessionId },
    data: { status: "abandoned", abandonedAt: new Date() },
  });
}

// Answer Data Access
export interface AnswerUpdateInput {
  selectedAnswers?: string[];
  numericAnswer?: number | null;
  isCorrect?: boolean;
  marks?: number;
  timeTakenSeconds?: number;
  responseVersion?: number;
  markedForReview?: boolean;
  answerState?: string;
  negativeMarksApplied?: number;
}

export async function findAnswerBySessionAndQuestionVersion(sessionId: string, questionVersionId: string) {
  return prisma.attempt.findFirst({ where: { sessionId, questionVersionId } });
}

export async function findAnswerBySessionAndQuestion(sessionId: string, questionId: string) {
  const session = await prisma.practiceSession.findUnique({
    where: { id: sessionId },
    include: {
      attempts: {
        where: { questionVersion: { questionId } },
        include: { questionVersion: { include: { question: true } } },
      },
    },
  });
  return session?.attempts[0] ?? null;
}

export async function createAnswer(input: {
  sessionId: string;
  userId: string;
  questionVersionId: string;
  selectedAnswers?: string[];
  numericAnswer?: number | null;
  isCorrect?: boolean;
  marks?: number;
  timeTakenSeconds?: number;
}) {
  const attemptData: any = {
    sessionId: input.sessionId,
    userId: input.userId,
    questionVersionId: input.questionVersionId,
    sequence: 0,
    selectedAnswers: {},
    isCorrect: input.isCorrect ?? false,
    marks: input.marks ?? 0,
    timeTakenSeconds: input.timeTakenSeconds ?? 0,
  };
  if (input.selectedAnswers) { attemptData.selectedAnswers = input.selectedAnswers; }
  if (input.numericAnswer !== undefined) { attemptData.selectedAnswers = { numericAnswer: input.numericAnswer }; }

  return prisma.attempt.create({ data: attemptData });
}

export async function upsertAnswer(input: {
  sessionId: string;
  userId: string;
  questionVersionId: string;
  sequence: number;
  selectedAnswers?: string[];
  numericAnswer?: number | null;
  marks?: number;
  isCorrect?: boolean;
  timeTakenSeconds?: number;
  questionId: string;
  questionNumber?: number;
  questionTypeId?: string;
  answerState?: string;
  markedForReview?: boolean;
  negativeMarksApplied?: number;
}) {
  const existing = await prisma.attempt.findFirst({
    where: { sessionId: input.sessionId, questionVersionId: input.questionVersionId },
  });
  const attemptData: any = {
    sessionId: input.sessionId,
    userId: input.userId,
    questionVersionId: input.questionVersionId,
    sequence: input.sequence,
    isCorrect: input.isCorrect ?? (existing?.isCorrect ?? false),
    marks: input.marks ?? (existing?.marks ?? 0),
    timeTakenSeconds: input.timeTakenSeconds ?? 0,
  };
  if (input.selectedAnswers) { attemptData.selectedAnswers = input.selectedAnswers; }
  else if (input.numericAnswer !== undefined) { attemptData.selectedAnswers = { numericAnswer: input.numericAnswer }; }
  else if (existing) { attemptData.selectedAnswers = existing.selectedAnswers; }
  else { attemptData.selectedAnswers = {}; }

  if (input.markedForReview !== undefined || input.answerState || input.negativeMarksApplied !== undefined) {
    const currentAnswers = typeof attemptData.selectedAnswers === "object" && !Array.isArray(attemptData.selectedAnswers)
      ? { ...attemptData.selectedAnswers }
      : Array.isArray(attemptData.selectedAnswers) ? { values: attemptData.selectedAnswers } : { values: attemptData.selectedAnswers };
    if (input.markedForReview !== undefined) { (currentAnswers as any).__markedForReview = input.markedForReview; }
    if (input.answerState) { (currentAnswers as any).__answerState = input.answerState; }
    if (input.negativeMarksApplied !== undefined) { (currentAnswers as any).__negativeMarksApplied = input.negativeMarksApplied; }
    attemptData.selectedAnswers = currentAnswers;
  }

  if (existing) {
    return prisma.attempt.update({ where: { id: existing.id }, data: attemptData });
  }
  return prisma.attempt.create({ data: attemptData });
}

export async function listAnswersForSession(sessionId: string) {
  return prisma.attempt.findMany({
    where: { sessionId },
    orderBy: { sequence: "asc" },
    include: { questionVersion: { include: { question: true } } },
  });
}

export async function listAnswersForSessionWithQuestionIds(sessionId: string) {
  return prisma.attempt.findMany({
    where: { sessionId },
    select: { questionVersionId: true, selectedAnswers: true, isCorrect: true, marks: true, sequence: true, answeredAt: true, timeTakenSeconds: true },
    orderBy: { sequence: "asc" },
  });
}

export interface PracticeQuestionAnswer {
  questionVersionId: string;
  questionId: string;
  questionNumber: number | null;
  questionTypeId: string | null;
  answerState: string | null;
  markedForReview: boolean | null;
  selectedAnswers: string[] | null;
  numericAnswer: number | null;
  negativeMarksApplied: number | null;
  correct: boolean | null;
  score: number | null;
}

export function toPracticeQuestionAnswer(row: {
  questionVersionId: string;
  selectedAnswers: unknown;
  isCorrect: boolean;
  marks: number;
  sequence: number;
  questionVersion?: { questionId: string };
}): PracticeQuestionAnswer {
  const selected = row.selectedAnswers;
  let answers: string[] | null = null;
  let numericAnswer: number | null = null;
  let markedForReview: boolean | null = null;
  let answerState: string | null = null;
  let negativeMarksApplied: number | null = null;

  if (Array.isArray(selected)) { answers = selected; }
  else if (typeof selected === "object" && selected !== null) {
    const obj = selected as Record<string, unknown>;
    if (Array.isArray(obj.values)) { answers = obj.values; }
    if (typeof obj.numericAnswer === "number") { numericAnswer = obj.numericAnswer; }
    if (typeof obj.__markedForReview === "boolean") { markedForReview = obj.__markedForReview; }
    if (typeof obj.__answerState === "string") { answerState = obj.__answerState; }
    if (typeof obj.__negativeMarksApplied === "number") { negativeMarksApplied = obj.__negativeMarksApplied; }
  }

  return {
    questionVersionId: row.questionVersionId,
    questionId: row.questionVersion?.questionId ?? "",
    questionNumber: row.sequence,
    questionTypeId: null,
    answerState,
    markedForReview,
    selectedAnswers: answers,
    numericAnswer,
    negativeMarksApplied,
    correct: row.isCorrect,
    score: Number(row.marks),
  };
}

export async function extractAnswerMetadata(sessionId: string) {
  return prisma.attempt.findMany({
    where: { sessionId },
    select: { questionVersionId: true, selectedAnswers: true, isCorrect: true, marks: true, sequence: true, answeredAt: true, timeTakenSeconds: true },
    orderBy: { sequence: "asc" },
  });
}

// Legacy Compatibility
export async function findAttempt(sessionId: string, questionVersionId: string) {
  return prisma.attempt.findFirst({ where: { sessionId, questionVersionId } });
}

export async function upsertAttempt(input: any) {
  return upsertAnswer(input);
}

export async function listAttemptsForSession(sessionId: string) {
  return listAnswersForSession(sessionId);
}

export async function attemptsForSessionWithTopics(sessionId: string) {
  return prisma.attempt.findMany({
    where: { sessionId },
    include: { questionVersion: { include: { question: { include: { topic: true } } } } },
    orderBy: { sequence: "asc" },
  });
}

export async function sumMarksForQuestionVersions(questionVersionIds: string[]) {
  return prisma.attempt.aggregate({
    where: { questionVersionId: { in: questionVersionIds } },
    _sum: { marks: true },
  });
}

export async function sumMarksForQuestions(questionIds: string[]) {
  return prisma.attempt.findMany({
    where: { questionVersion: { questionId: { in: questionIds } } },
    select: { questionVersionId: true, marks: true },
  });
}

export async function findAnswerBySessionIdAndVersion(sessionId: string, questionVersionId: string) {
  return prisma.attempt.findFirst({ where: { sessionId, questionVersionId } });
}


