// PHASE 12G-T10 Practice Service Layer
import { errors } from "../errors";

import {
  createSession as createSessionRepo,
  findSessionByIdAndOwner,
  listAnswersForSession,
  parseSessionConfig,
  SessionConfig,
  upsertAnswer,
  completeSession as completeSessionRepo,
} from "../repositories/practice.repo";
import type { PracticeSession, Prisma } from "@prisma/client";
import { updateSessionStatus } from "../repositories/practice.repo";


const STATUS = {
  PENDING: "pending",
  ACTIVE: "active",
  SUBMITTED: "submitted",
  COMPLETED: "completed",
} as const;

export interface CreateSessionInput {
  userId: string;
  modeId?: string;
  config?: SessionConfig;
  timed?: boolean;
  totalQuestions: number;
  frozenPoolSnapshot?: Prisma.InputJsonValue;
  selectionMetadata?: Prisma.InputJsonValue;
}

export interface RouteCreateSessionInput {
  mode: string;
  filters: Record<string, unknown>;
  timed?: boolean;
  questionCount?: number;
}

export interface RouteRecordAttemptInput {
  question_id: string;
  answer: Record<string, unknown>;
  time_taken_seconds: number;
}

export interface RecordAttemptResult {
  created: boolean;
  payload: {
    attempt_id: string;
    question_id: string;
    is_correct: boolean;
    marks: number;
    time_taken_seconds: number;
  };
}

export interface SaveAnswerInput {
  sessionId: string;
  userId: string;
  questionId: string;
  publishedVersionId: string;
  questionNumber?: number;
  answerState?: string;
  markedForReview?: boolean;
  selectedAnswers?: string[] | null;
  numericAnswer?: number | null;
}

export interface SessionDTO {
  id: string;
  userId: string;
  modeId: string;
  status: string;
  totalQuestions: number;
  timed: boolean;
  config: SessionConfig;
  startedAt: Date;
  completedAt: Date | null;
  frozenPoolSnapshot?: Prisma.InputJsonValue;
  selectionMetadata?: Prisma.InputJsonValue;
}

async function toSessionDTO(session: PracticeSession): Promise<SessionDTO> {
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
      // Keep the legacy fallback for malformed config without exposing raw JSON.
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
    startedAt: session.startedAt,
    completedAt: session.endedAt,
    frozenPoolSnapshot: parsedConfig.frozenPoolSnapshot,
    selectionMetadata: parsedConfig.selectionMetadata,
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

  const session = await createSessionRepo({
    userId: input.userId,
    modeId: input.modeId,
    config,
    timed: input.timed ?? false,
    totalQuestions: input.totalQuestions,
    status: STATUS.PENDING,
    frozenPoolSnapshot: input.frozenPoolSnapshot,
    selectionMetadata: input.selectionMetadata,
  });
  return await toSessionDTO(session);
}

// Route-compatible createSession
export async function createSessionRoute(userId: string, input: RouteCreateSessionInput): Promise<SessionDTO> {
  return createPracticeSession({
    userId,
    modeId: input.mode,
    config: {
      mode: input.mode,
      filters: input.filters,
      question_count: input.questionCount ?? 20,
      pool: null,
    },
    timed: input.timed ?? false,
    totalQuestions: input.questionCount ?? 20,
  });
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
    const updated = await updateSessionStatus(sessionId, STATUS.ACTIVE, userId);
    return await toSessionDTO(updated);
  }

  if (currentStatus === STATUS.ACTIVE) {
    throw errors.conflict("INVALID_SESSION_STATE", "Session is already active");
  }

  if (currentStatus === STATUS.SUBMITTED || currentStatus === STATUS.COMPLETED) {
    throw errors.conflict("SUBMITTED_SESSION_IMMUTABLE", "Cannot activate a submitted session");
  }

  throw errors.conflict("INVALID_SESSION_STATE", `Cannot activate from status '${currentStatus}'`);
}

export async function savePracticeAnswer(input: SaveAnswerInput): Promise<void> {
  const session = await findSessionByIdAndOwner(input.sessionId, input.userId);
  if (!session) {
    throw errors.notFound("SESSION_NOT_FOUND", `Session ${input.sessionId} not found or not owned`);
  }

  if (session.status === STATUS.SUBMITTED || session.status === STATUS.COMPLETED) {
    throw errors.conflict("SUBMITTED_SESSION_IMMUTABLE", "Cannot modify answers for a submitted session");
  }

  if (session.status !== STATUS.ACTIVE) {
    throw errors.conflict("INVALID_SESSION_STATE", `Cannot save answer in status "${session.status}"`);
  }

  const upsertInput: Parameters<typeof upsertAnswer>[0] = {
    sessionId: input.sessionId,
    userId: input.userId,
    questionId: input.questionId,
    questionVersionId: input.publishedVersionId,
    sequence: input.questionNumber ?? 0,
    questionNumber: input.questionNumber,
    answerState: input.answerState ?? (input.selectedAnswers && input.selectedAnswers.length > 0 ? "answered" : "unanswered"),
    markedForReview: input.markedForReview ?? false,
    selectedAnswers: input.selectedAnswers ?? undefined,
    numericAnswer: input.numericAnswer,
  };

  await upsertAnswer(upsertInput);
}

// Route-compatible recordAttempt
export async function recordAttemptRoute(sessionId: string, userId: string, input: RouteRecordAttemptInput): Promise<RecordAttemptResult> {
  const session = await findSessionByIdAndOwner(sessionId, userId);
  if (!session) {
    throw errors.notFound("SESSION_NOT_FOUND", `Session ${sessionId} not found or not owned`);
  }

  if (session.status === STATUS.SUBMITTED || session.status === STATUS.COMPLETED) {
    throw errors.conflict("SUBMITTED_SESSION_IMMUTABLE", "Cannot modify answers for a submitted session");
  }

  if (session.status !== STATUS.ACTIVE) {
    throw errors.conflict("INVALID_SESSION_STATE", `Cannot save answer in status "${session.status}"`);
  }

  // Extract answer based on type - for now we just persist, no grading
  const answer = input.answer;
  let selectedAnswers: string[] | undefined;
  let numericAnswer: number | null | undefined;

  if (answer && typeof answer === "object") {
    if ("option_id" in answer && typeof answer.option_id === "string") {
      selectedAnswers = [answer.option_id];
    } else if ("option_ids" in answer && Array.isArray(answer.option_ids)) {
      selectedAnswers = answer.option_ids as string[];
    } else if ("value" in answer && typeof answer.value === "number") {
      numericAnswer = answer.value;
    }
  }

  const upsertInput: Parameters<typeof upsertAnswer>[0] = {
    sessionId,
    userId,
    questionId: input.question_id,
    questionVersionId: input.question_id, // routes use question_id as version id for now
    sequence: 0,
    answerState: "answered",
    markedForReview: false,
    selectedAnswers,
    numericAnswer,
  };

  // We need to get the created/updated attempt back - upsertAnswer doesn't return it currently
  // For compatibility, we'll call upsertAnswer and then fetch the attempt
  await upsertAnswer(upsertInput);

  // Return a compatible response (created=true for now)
  return {
    created: true,
    payload: {
      attempt_id: "temp",
      question_id: input.question_id,
      is_correct: false,
      marks: 0,
      time_taken_seconds: input.time_taken_seconds,
    },
  };
}

export async function getPracticeSessionAnswers(sessionId: string, userId: string) {
  const session = await findSessionByIdAndOwner(sessionId, userId);
  if (!session) {
    throw errors.notFound("SESSION_NOT_FOUND", `Session ${sessionId} not found or not owned`);
  }
  const answers = await listAnswersForSession(sessionId);
  return answers.map((row) => {
    const raw = row.selectedAnswers;
    const state = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    return {
      questionVersionId: row.questionVersionId,
      questionNumber: row.sequence,
      selectedAnswers: Array.isArray(raw) ? raw : state.values,
      numericAnswer: state.numericAnswer,
      answerState: state.__answerState,
      markedForReview: state.__markedForReview,
    };
  });
}

// completeSession - finalizes the session (sets status to completed, sets endedAt)
export async function completeSession(sessionId: string, userId: string): Promise<SessionDTO> {
  const session = await findSessionByIdAndOwner(sessionId, userId);
  if (!session) {
    throw errors.notFound("SESSION_NOT_FOUND", `Session ${sessionId} not found or not owned`);
  }

  if (session.status === STATUS.COMPLETED) {
    throw errors.conflict("SESSION_ALREADY_COMPLETED", "Session is already completed");
  }

  const updated = await completeSessionRepo(sessionId, userId);
  return await toSessionDTO(updated);
}

// getResult - returns session result with answers (no grading)
export async function getResult(sessionId: string, userId: string): Promise<SessionDTO & { answers: Awaited<ReturnType<typeof getPracticeSessionAnswers>> }> {
  const session = await findSessionByIdAndOwner(sessionId, userId);
  if (!session) {
    throw errors.notFound("SESSION_NOT_FOUND", `Session ${sessionId} not found or not owned`);
  }

  if (session.status !== STATUS.COMPLETED) {
    throw errors.conflict("RESULT_NOT_READY", "Session not completed yet");
  }

  const sessionDTO = await toSessionDTO(session);
  const answers = await getPracticeSessionAnswers(sessionId, userId);

  return { ...sessionDTO, answers };
}

// Compatibility aliases for routes
export const startSession = activatePracticeSession;
export const recordAttempt = recordAttemptRoute;
export const getSessionState = getPracticeSession;
export const createSession = createSessionRoute;