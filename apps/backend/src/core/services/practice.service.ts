// PHASE 12G-T10 Practice Service Layer
import { errors } from "../errors";

import {
  createSession,
  findSessionByIdAndOwner,
  listAnswersForSession,
  parseSessionConfig,
  SessionConfig,
  upsertAnswer,
} from "../repositories/practice.repo";
import { prisma } from "../repositories/prisma";



const STATUS = {
  PENDING: "pending",
  ACTIVE: "active",
  SUBMITTED: "submitted",
} as const;

export interface CreateSessionInput {
  userId: string;
  modeId?: string;
  config?: SessionConfig;
  timed?: boolean;
  totalQuestions: number;
  frozenPoolSnapshot?: unknown;
  selectionMetadata?: unknown;
}

export interface SaveAnswerInput {
  sessionId: string;
  userId: string;
  questionId: string;
  questionNumber?: number;
  answerState?: string;
  markedForReview?: boolean;
  selectedAnswers?: string[] | null;
  numericAnswer?: number | null;
  negativeMarksApplied?: number;
}

export interface SessionDTO {
  id: string;
  userId: string;
  modeId: string;
  status: string;
  totalQuestions: number;
  timed: boolean;
  config: SessionConfig;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  frozenPoolSnapshot?: unknown;
  selectionMetadata?: unknown;
  attempts?: any[];
}

async function toSessionDTO(session: any): Promise<SessionDTO> {
  let parsedConfig: SessionConfig = {
    mode: "default",
    filters: {},
    question_count: session.totalQuestions ?? 0,
    pool: null,
  };

  if (session.config) {
    try {
      parsedConfig = await parseSessionConfig(session.config);
    } catch {
      parsedConfig = session.config;
    }
  }

  return {
    id: session.id,
    userId: session.userId,
    modeId: session.modeId,
    status: session.status,
    totalQuestions: session.totalQuestions,
    timed: session.timed,
    config: parsedConfig,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    startedAt: session.startedAt,
    completedAt: session.completedAt,
    frozenPoolSnapshot: (parsedConfig as any).frozenPoolSnapshot,
    selectionMetadata: (parsedConfig as any).selectionMetadata,
    attempts: session.answers,
  };
}

export async function createPracticeSession(input: CreateSessionInput): Promise<SessionDTO> {
  if (!input.userId) {
    throw errors.validation([{ field: "userId", code: "MISSING", message: "userId is required" }]);
  }
  if (!input.modeId) {
    throw errors.validation([{ field: "modeId", code: "MISSING", message: "modeId is required" }]);
  }
  if (!input.totalQuestions || input.totalQuestions <= 0) {
    throw errors.validation([{ field: "totalQuestions", code: "INVALID", message: "totalQuestions must be a positive number" }]);
  }

  const config = input.config ?? {
    mode: "default",
    filters: {},
    question_count: input.totalQuestions,
    pool: null,
  };

  if (input.frozenPoolSnapshot) {
    (config as any).frozenPoolSnapshot = input.frozenPoolSnapshot;
  }
  if (input.selectionMetadata) {
    (config as any).selectionMetadata = input.selectionMetadata;
  }

  const session = await createSession({
    userId: input.userId,
    modeId: input.modeId,
    config: config as SessionConfig,
    timed: input.timed ?? false,
    totalQuestions: input.totalQuestions,
  });
  return await toSessionDTO(session);
}

export async function getPracticeSession(sessionId: string, userId: string): Promise<SessionDTO> {
  const session = await findSessionByIdAndOwner(sessionId, userId);
  if (!session) {
    throw errors.notFound("SESSION_NOT_FOUND", `Session ${sessionId} not found or not owned`);
  }
  return await toSessionDTO(session);
}

export async function activatePracticeSession(sessionId: string, userId: string): Promise<SessionDTO> {
  const session = await findSessionByIdAndOwner(sessionId, userId);
  if (!session) {
    throw errors.notFound("SESSION_NOT_FOUND", `Session ${sessionId} not found or not owned`);
  }

  const currentStatus = session.status;
  if (currentStatus === STATUS.PENDING) {
    const updated = await prisma.practiceSession.update({
      where: { id: sessionId },
      data: {
        status: STATUS.ACTIVE,
        startedAt: session.startedAt ?? new Date(),
      },
    });
    return await toSessionDTO(updated);
  }

  if (currentStatus === STATUS.ACTIVE) {
    throw errors.conflict("INVALID_SESSION_STATE", "Session is already active");
  }

  if (currentStatus === STATUS.SUBMITTED) {
    throw errors.conflict("SUBMITTED_SESSION_IMMUTABLE", "Cannot activate a submitted session");
  }

  throw errors.conflict("INVALID_SESSION_STATE", `Cannot activate from status '${currentStatus}'`);
}

export async function savePracticeAnswer(input: SaveAnswerInput): Promise<void> {
  const session = await findSessionByIdAndOwner(input.sessionId, input.userId);
  if (!session) {
    throw errors.notFound("SESSION_NOT_FOUND", `Session ${input.sessionId} not found or not owned`);
  }

  if (session.status === STATUS.SUBMITTED) {
    throw errors.conflict("SUBMITTED_SESSION_IMMUTABLE", "Cannot modify answers for a submitted session");
  }

  if (session.status !== STATUS.ACTIVE) {
    throw errors.conflict("INVALID_SESSION_STATE", `Cannot save answer in status "${session.status}"`);
  }

  const upsertInput: Parameters<typeof upsertAnswer>[0] = {
    sessionId: input.sessionId,
    userId: input.userId,
    questionId: input.questionId,
    questionVersionId: input.questionId,
    sequence: input.questionNumber ?? 0,
    questionNumber: input.questionNumber,
    answerState: input.answerState ?? (input.selectedAnswers && input.selectedAnswers.length > 0 ? "answered" : "unanswered"),
    markedForReview: input.markedForReview ?? false,
    selectedAnswers: input.selectedAnswers ?? undefined,
    numericAnswer: input.numericAnswer,
    negativeMarksApplied: input.negativeMarksApplied ?? 0,
  };

  await upsertAnswer(upsertInput);
}

export async function getPracticeSessionAnswers(sessionId: string, userId: string): Promise<any[]> {
  const session = await findSessionByIdAndOwner(sessionId, userId);
  if (!session) {
    throw errors.notFound("SESSION_NOT_FOUND", `Session ${sessionId} not found or not owned`);
  }
  return listAnswersForSession(sessionId);
}

// Compatibility aliases for routes
export const startSession = activatePracticeSession;
export const recordAttempt = savePracticeAnswer;
export const getSessionState = getPracticeSession;

