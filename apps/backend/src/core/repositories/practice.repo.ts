// Persistence compatibility for the current PracticeSession / Attempt schema.
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
  frozenPoolSnapshot?: Prisma.InputJsonValue;
  selectionMetadata?: Prisma.InputJsonValue;
}

export function parseSessionConfig(config: unknown): SessionConfig {
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    throw new Error("Invalid session config");
  }
  const value = config as Partial<SessionConfig>;
  return {
    ...value,
    mode: value.mode ?? "default",
    filters: value.filters ?? {},
    question_count: value.question_count ?? 0,
    pool: value.pool ?? null,
    frozenPoolSnapshot: value.frozenPoolSnapshot,
    selectionMetadata: value.selectionMetadata,
  };
}

export function createSession(input: {
  userId: string;
  modeId: string;
  config: SessionConfig;
  timed: boolean;
  totalQuestions: number;
  status?: string;
  frozenPoolSnapshot?: Prisma.InputJsonValue;
  selectionMetadata?: Prisma.InputJsonValue;
}) {
  const config = {
    ...input.config,
    ...(input.frozenPoolSnapshot !== undefined ? { frozenPoolSnapshot: input.frozenPoolSnapshot } : {}),
    ...(input.selectionMetadata !== undefined ? { selectionMetadata: input.selectionMetadata } : {}),
  };
  return prisma.practiceSession.create({
    data: {
      userId: input.userId,
      modeId: input.modeId,
      config: config as Prisma.InputJsonObject,
      timed: input.timed,
      totalQuestions: input.totalQuestions,
      status: input.status ?? "in_progress",
    },
  });
}

export function findSessionByIdAndOwner(id: string, userId: string) {
  return prisma.practiceSession.findFirst({ where: { id, userId } });
}

export function updateSessionStatus(sessionId: string, status: string, userId: string) {
  return prisma.practiceSession.update({ where: { id: sessionId, userId }, data: { status } });
}

export function completeSession(sessionId: string, userId: string) {
  return prisma.practiceSession.update({
    where: { id: sessionId, userId },
    data: { status: "completed", endedAt: new Date() },
  });
}

export function findPracticeModeByCode(code: string) {
  return prisma.practiceMode.findUnique({ where: { code } });
}

export function findPublishedQuestionVersion(questionId: string) {
  return prisma.questionVersion.findFirst({
    where: {
      questionId,
      question: { status: "published" },
    },
    orderBy: { version: "desc" },
  });
}

export function findEligiblePublishedQuestions(filters: {
  subject_id?: string;
  topic_id?: string;
  year?: number;
  difficulty?: string;
  question_types?: string[];
  limit: number;
}) {
  return prisma.question.findMany({
    where: {
      status: "published",
      ...(filters.subject_id ? { subjectId: filters.subject_id } : {}),
      ...(filters.topic_id ? { topicId: filters.topic_id } : {}),
      ...(filters.year ? { gateYear: filters.year } : {}),
      ...(filters.difficulty ? { difficulty: filters.difficulty } : {}),
      ...(filters.question_types && filters.question_types.length > 0
        ? { questionType: { code: { in: filters.question_types } } }
        : {}),
    },
    include: {
      versions: {
        where: { question: { status: "published" } },
        orderBy: { version: "desc" },
        take: 1,
      },
      questionType: true,
    },
    orderBy: { id: "asc" },
    take: filters.limit,
  });
}

export interface AnswerUpsertInput {
  sessionId: string;
  userId: string;
  questionVersionId: string;
  questionId: string;
  sequence: number;
  questionNumber?: number;
  questionTypeId?: string;
  selectedAnswers?: string[];
  numericAnswer?: number | null;
  marks?: number;
  isCorrect?: boolean;
  timeTakenSeconds?: number;
  answerState?: string;
  markedForReview?: boolean;
  negativeMarksApplied?: number;
}

export function upsertAnswer(input: AnswerUpsertInput) {
  // Attempt has no composite unique constraint. Serialize read/write transactions;
  // Prisma serialization conflicts propagate to the caller, like other DB errors.
  return prisma.$transaction(async (tx) => {
    const existing = await tx.attempt.findFirst({
      where: { sessionId: input.sessionId, questionVersionId: input.questionVersionId },
    });
    const previous = existing?.selectedAnswers;
    const selectedAnswers: Prisma.InputJsonObject = {
      ...(Array.isArray(previous) ? { values: previous } :
        previous !== null && typeof previous === "object" ? previous : {}),
      ...(input.selectedAnswers !== undefined ? { values: input.selectedAnswers } : {}),
      ...(input.numericAnswer !== undefined ? { numericAnswer: input.numericAnswer } : {}),
      ...(input.answerState !== undefined ? { __answerState: input.answerState } : {}),
      ...(input.markedForReview !== undefined ? { __markedForReview: input.markedForReview } : {}),
      ...(input.negativeMarksApplied !== undefined ? { __negativeMarksApplied: input.negativeMarksApplied } : {}),
    };
    const data = {
      sequence: input.sequence,
      selectedAnswers,
      ...(input.isCorrect !== undefined ? { isCorrect: input.isCorrect } : {}),
      ...(input.marks !== undefined ? { marks: input.marks } : {}),
      ...(input.timeTakenSeconds !== undefined ? { timeTakenSeconds: input.timeTakenSeconds } : {}),
    };
    if (existing) return tx.attempt.update({ where: { id: existing.id }, data });
    return tx.attempt.create({
      data: {
        ...data,
        sessionId: input.sessionId,
        userId: input.userId,
        questionVersionId: input.questionVersionId,
        // Required legacy columns, not a grading decision; never exposed by the service.
        isCorrect: input.isCorrect ?? false,
        marks: input.marks ?? 0,
        timeTakenSeconds: input.timeTakenSeconds ?? 0,
      },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export function listAnswersForSession(sessionId: string) {
  return prisma.attempt.findMany({
    where: { sessionId },
    orderBy: { sequence: "asc" },
    select: { questionVersionId: true, sequence: true, selectedAnswers: true },
  });
}
