// PHASE 8 — Practice sessions + attempts data access (Phase 3 §6.15–6.17)
// PHASE 12G-T9 — Enhanced Practice repository layer with answer-state persistence
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

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

export async function ensurePracticeMode(code: string): Promise<{ id: string; code: string }> {
  const existing = await prisma.practiceMode.findUnique({ where: { code } });
  if (existing) return existing;
  return prisma.practiceMode.create({
    data: { code, name: code.charAt(0).toUpperCase() + code.slice(1) },
  });
}

export async function createSession(input: {
  userId: string;
  modeId: string;
  config: SessionConfig;
  timed: boolean;
  totalQuestions: number;
}) {
  return prisma.practiceSession.create({
    data: {
      userId: input.userId,
      modeId: input.modeId,
      config: input.config as unknown as Prisma.InputJsonValue,
      timed: input.timed,
      totalQuestions: input.totalQuestions,
      status: "in_progress",
    },
  });
}

const SESSION_SELECT = {
  id: true,
  userId: true,
  status: true,
  timed: true,
  totalQuestions: true,
  score: true,
  startedAt: true,
  endedAt: true,
  abandonedAt: true,
  config: true,
  mode: { select: { id: true, code: true, name: true } },
} satisfies Prisma.PracticeSessionSelect;

export type SessionRow = Prisma.PracticeSessionGetPayload<{ select: typeof SESSION_SELECT }>;

export async function findSessionById(id: string): Promise<SessionRow | null> {
  return prisma.practiceSession.findUnique({ where: { id }, select: SESSION_SELECT });
}

export async function findSessionByIdAndOwner(
  id: string,
  ownerUserId: string
): Promise<SessionRow | null> {
  return prisma.practiceSession.findFirst({
    where: { id, userId: ownerUserId },
    select: SESSION_SELECT,
  });
}

export function parseSessionConfig(raw: unknown): SessionConfig {
  const value = raw as Partial<SessionConfig> | null;
  if (!value || typeof value !== "object") {
    throw new Error("SESSION_CONFIG_CORRUPT");
  }
  return {
    mode: String(value.mode ?? "custom"),
    filters: value.filters ?? {},
    question_count: Number(value.question_count ?? 0),
    pool: Array.isArray(value.pool) ? (value.pool as string[]) : null,
  };
}

// ─── Session with answers lookup ────────────────────────────────────────────────

const SESSION_WITH_ANSWERS_SELECT = {
  id: true,
  userId: true,
  status: true,
  timed: true,
  totalQuestions: true,
  score: true,
  startedAt: true,
  endedAt: true,
  abandonedAt: true,
  config: true,
  mode: { select: { id: true, code: true, name: true } },
  attempts: {
    orderBy: [{ answeredAt: "asc" }],
    select: {
      id: true,
      questionVersionId: true,
      selectedAnswers: true,
      isCorrect: true,
      marks: true,
      timeTakenSeconds: true,
      answeredAt: true,
      responseVersion: true,
    },
  },
} satisfies Prisma.PracticeSessionSelect;

export type SessionWithAnswersRow = Prisma.PracticeSessionGetPayload<{
  select: typeof SESSION_WITH_ANSWERS_SELECT;
}>;

export async function findSessionWithAnswersById(
  id: string
): Promise<SessionWithAnswersRow | null> {
  return prisma.practiceSession.findUnique({
    where: { id },
    select: SESSION_WITH_ANSWERS_SELECT,
  });
}

export async function findSessionWithAnswersByIdAndOwner(
  id: string,
  ownerUserId: string
): Promise<SessionWithAnswersRow | null> {
  return prisma.practiceSession.findFirst({
    where: { id, userId: ownerUserId },
    select: SESSION_WITH_ANSWERS_SELECT,
  });
}

// ─── Practice Question Answer (Attempt) operations ──────────────────────────────

export interface PracticeQuestionAnswerUpsertInput {
  sessionId: string;
  userId: string;
  questionVersionId: string;
  questionId: string;
  selectedAnswers: unknown;
  correct: boolean;
  score: number;
  negativeMarksApplied: boolean;
  markedForReview: boolean;
  answerState: "unanswered" | "answered" | "skipped" | "review";
  timeTakenSeconds: number;
}

export interface AnswerMetadata {
  negativeMarksApplied?: boolean;
  markedForReview?: boolean;
  answerState?: "unanswered" | "answered" | "skipped" | "review";
  [key: string]: unknown;
}

export async function findAnswerBySessionAndQuestion(
  sessionId: string,
  questionVersionId: string
): Promise<Prisma.Attempt | null> {
  return prisma.attempt.findFirst({
    where: { sessionId, questionVersionId },
  });
}

export async function upsertAnswer(input: PracticeQuestionAnswerUpsertInput) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.attempt.findFirst({
      where: { sessionId: input.sessionId, questionVersionId: input.questionVersionId },
    });

    const metadata: AnswerMetadata = {
      negativeMarksApplied: input.negativeMarksApplied,
      markedForReview: input.markedForReview,
      answerState: input.answerState,
    };

    const mergedSelectedAnswers =
      typeof input.selectedAnswers === "object" && input.selectedAnswers !== null
        ? {
            ...(input.selectedAnswers as object),
            _answerMetadata: metadata,
          }
        : input.selectedAnswers;

    if (existing) {
      return tx.attempt.update({
        where: { id: existing.id },
        data: {
          selectedAnswers: mergedSelectedAnswers as Prisma.InputJsonValue,
          isCorrect: input.correct,
          marks: input.score,
          timeTakenSeconds: input.timeTakenSeconds,
          answeredAt: new Date(),
          responseVersion: { increment: 1 },
        },
      });
    }

    const priorCount = await tx.attempt.count({
      where: { sessionId: input.sessionId },
    });

    return tx.attempt.create({
      data: {

export function extractAnswerMetadata(
  selectedAnswers: unknown
): AnswerMetadata | undefined {
  if (
    typeof selectedAnswers === "object" &&
    selectedAnswers !== null &&
    !Array.isArray(selectedAnswers)
  ) {
    const obj = selectedAnswers as Record<string, unknown>;
    if (obj._answerMetadata && typeof obj._answerMetadata === "object") {
      return obj._answerMetadata as AnswerMetadata;
    }
  }
  return undefined;
}

export function toPracticeQuestionAnswer(row: Prisma.AttempGetPayload<{
  select: {
    id: true;
    questionVersionId: true;
    selectedAnswers: true;
    isCorrect: true;
    marks: true;
    timeTakenSeconds: true;
    answeredAt: true;
    responseVersion: true;
    questionVersion: { select: { questionId: true } };
  };
}>): {
  id: string;
  sessionId: string;
  questionId: string;
  questionVersionId: string;
  selectedAnswers: unknown;
  correct: boolean;
  score: number;
  negativeMarksApplied: boolean;
  markedForReview: boolean;
  answerState: "unanswered" | "answered" | "skipped" | "review";
  timeTakenSeconds: number;
  answeredAt: Date;
  responseVersion: number;
} {
  const metadata = extractAnswerMetadata(row.selectedAnswers) ?? {};

  return {
    id: row.id,
    sessionId: row.sessionId,
    questionId: row.questionVersion.questionId,
    questionVersionId: row.questionVersionId,
    selectedAnswers: row.selectedAnswers,
    correct: row.isCorrect,
    score: Number(row.marks),
    negativeMarksApplied: Boolean(metadata.negativeMarksApplied ?? false),
    markedForReview: Boolean(metadata.markedForReview ?? false),
    answerState: (metadata.answerState ?? "unanswered") as
      | "unanswered"
      | "answered"
      | "skipped"
      | "review",
    timeTakenSeconds: row.timeTakenSeconds,
    answeredAt: row.answeredAt,
    responseVersion: row.responseVersion,
  };
}

// ─── Existing Attempt helpers (backward compatibility) ──────────────────────────

export interface AttemptUpsertInput {
  sessionId: string;
  userId: string;
  questionVersionId: string;
  selectedAnswers: unknown;
  isCorrect: boolean;
  marks: number;
  timeTakenSeconds: number;
}

export async function findAttempt(sessionId: string, questionVersionId: string) {
  return prisma.attempt.findFirst({ where: { sessionId, questionVersionId } });
}

/** @deprecated Use upsertAnswer instead. */
export async function upsertAttempt(input: AttemptUpsertInput) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.attempt.findFirst({
      where: { sessionId: input.sessionId, questionVersionId: input.questionVersionId },
    });
    if (existing) {
      return tx.attempt.update({
        where: { id: existing.id },
        data: {
          selectedAnswers: input.selectedAnswers as Prisma.InputJsonValue,
          isCorrect: input.isCorrect,
          marks: input.marks,
          timeTakenSeconds: input.timeTakenSeconds,
          answeredAt: new Date(),
          responseVersion: { increment: 1 },
        },
      });
    }
    const priorCount = await tx.attempt.count({ where: { sessionId: input.sessionId } });
    return tx.attempt.create({
      data: {
        sessionId: input.sessionId,
        userId: input.userId,
        questionVersionId: input.questionVersionId,
        sequence: priorCount + 1,
        selectedAnswers: input.selectedAnswers as Prisma.InputJsonValue,
        isCorrect: input.isCorrect,
        marks: input.marks,
        timeTakenSeconds: input.timeTakenSeconds,
      },
    });
  });
}

export async function listAttemptsForSession(sessionId: string) {
  return prisma.attempt.findMany({
    where: { sessionId },
    orderBy: [{ answeredAt: "asc" }],
    select: {
      id: true,
      questionVersionId: true,
      selectedAnswers: true,
      isCorrect: true,
      marks: true,
      timeTakenSeconds: true,
      answeredAt: true,
    },
  });
}

export async function attemptsForSessionWithTopics(sessionId: string) {
  return prisma.attempt.findMany({
    where: { sessionId },
    orderBy: [{ answeredAt: "asc" }],
    select: {
      questionVersionId: true,
      isCorrect: true,
      marks: true,
      timeTakenSeconds: true,
      questionVersion: {
        select: {
          snapshot: true,
          question: { select: { id: true, topicId: true, explanation: true } },
        },
      },
    },
  });
}

/** Max marks over the session pool using the marks from the question versions used by attempts. */
export async function sumMarksForQuestionVersions(versionIds: string[]): Promise<number> {
  if (versionIds.length === 0) return 0;
  const rows = await prisma.questionVersion.findMany({
    where: { id: { in: versionIds } },
    select: { snapshot: true },
  });
  return rows.reduce((total, row) => {
    const snap = row.snapshot as { marks?: number } | null;
    return total + (snap?.marks ?? 0);
  }, 0);
}

/** Max marks over the session pool using current authored marks per question (fallback). */
export async function sumMarksForQuestions(questionIds: string[]): Promise<number> {
  if (questionIds.length === 0) return 0;
  const rows = await prisma.question.findMany({
    where: { id: { in: questionIds } },
    select: { marks: true },
  });
  return rows.reduce((total, row) => total + Number(row.marks), 0);
}

        sessionId: input.sessionId,
        userId: input.userId,
        questionVersionId: input.questionVersionId,
        sequence: priorCount + 1,
        selectedAnswers: mergedSelectedAnswers as Prisma.InputJsonValue,
        isCorrect: input.correct,
        marks: input.score,
        timeTakenSeconds: input.timeTakenSeconds,
      },
    });
  });
}

export async function listAnswersForSession(sessionId: string) {
  return prisma.attempt.findMany({
    where: { sessionId },
    orderBy: [{ answeredAt: "asc" }],
    select: {
      id: true,
      questionVersionId: true,
      selectedAnswers: true,
      isCorrect: true,
      marks: true,
      timeTakenSeconds: true,
      answeredAt: true,
      responseVersion: true,
    },
  });
}

export async function listAnswersForSessionWithQuestionIds(sessionId: string) {
  return prisma.attempt.findMany({
    where: { sessionId },
    orderBy: [{ answeredAt: "asc" }],
    select: {
      id: true,
      questionVersionId: true,
      questionVersion: {
        select: {
          questionId: true,
        },
      },
      selectedAnswers: true,
      isCorrect: true,
      marks: true,
      timeTakenSeconds: true,
      answeredAt: true,
      responseVersion: true,
    },
  });
}

): Promise<SessionWithAnswersRow | null> {
  return prisma.practiceSession.findUnique({
    where: { id },
    select: SESSION_WITH_ANSWERS_SELECT,
  });
}

export async function findSessionWithAnswersByIdAndOwner(
  id: string,
  ownerUserId: string
): Promise<SessionWithAnswersRow | null> {
  return prisma.practiceSession.findFirst({
    where: { id, userId: ownerUserId },
    select: SESSION_WITH_ANSWERS_SELECT,
  });
}


export async function savePool(sessionId: string, config: SessionConfig): Promise<void> {
  await prisma.practiceSession.update({
    where: { id: sessionId },
    data: { config: config as unknown as Prisma.InputJsonValue },
  });
}

export async function saveFrozenPoolSnapshot(
  sessionId: string,
  snapshot: FrozenPoolSnapshot
): Promise<void> {
  const existing = await prisma.practiceSession.findUnique({
    where: { id: sessionId },
    select: { config: true },
  });
  const currentConfig = (existing?.config as object) ?? {};
  await prisma.practiceSession.update({
    where: { id: sessionId },
    data: {
      config: {
        ...currentConfig,
        frozen_pool_snapshot: snapshot as unknown as Prisma.InputJsonValue,
      } as unknown as Prisma.InputJsonValue,
    },
  });
}

export async function saveSelectionMetadata(
  sessionId: string,
  metadata: SelectionMetadata
): Promise<void> {
  const existing = await prisma.practiceSession.findUnique({
    where: { id: sessionId },
    select: { config: true },
  });
  const currentConfig = (existing?.config as object) ?? {};
  await prisma.practiceSession.update({
    where: { id: sessionId },
    data: {
      config: {
        ...currentConfig,
        selection_metadata: metadata as unknown as Prisma.InputJsonValue,
      } as unknown as Prisma.InputJsonValue,
    },
  });
}

export async function updateSessionStatus(
  sessionId: string,
  status: string,
  timestamps?: {
    endedAt?: Date;
    abandonedAt?: Date;
    startedAt?: Date;
  }
): Promise<void> {
  const data: Prisma.PracticeSessionUpdateInput = { status };
  if (timestamps) {
    if (timestamps.endedAt) data.endedAt = timestamps.endedAt;
    if (timestamps.abandonedAt) data.abandonedAt = timestamps.abandonedAt;
    if (timestamps.startedAt) data.startedAt = timestamps.startedAt;
  }
  await prisma.practiceSession.update({
    where: { id: sessionId },
    data,
  });
}

export async function completeSession(sessionId: string, score: number): Promise<void> {
  await prisma.practiceSession.update({
    where: { id: sessionId },
    data: { status: "completed", endedAt: new Date(), score },
  });
}

export async function abandonSession(sessionId: string): Promise<void> {
  await prisma.practiceSession.update({
    where: { id: sessionId },
    data: { status: "abandoned", abandonedAt: new Date(), endedAt: new Date() },
  });
}

﻿
