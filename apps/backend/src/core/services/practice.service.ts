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
  findPracticeModeByCode,
  findEligiblePublishedQuestions,
  getQuestionVersionsByIds,
  getQuestionVersionsWithSnapshotByIds,
  calculateSessionScore,
} from "../repositories/practice.repo";
import type { PracticeSession, Prisma } from "@prisma/client";
import { gradePracticeAnswer } from "../grading/grading.service";


const STATUS = {
  IN_PROGRESS: "in_progress",
  SUBMITTED: "submitted",
  COMPLETED: "completed",
  ABANDONED: "abandoned",
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
    frozenPoolSnapshot: input.frozenPoolSnapshot,
    selectionMetadata: input.selectionMetadata,
  });
  return await toSessionDTO(session);
}

// Route-compatible createSession
export async function createSessionRoute(userId: string, input: RouteCreateSessionInput): Promise<SessionDTO> {
  // Validate PracticeMode exists
  const mode = await findPracticeModeByCode(input.mode);
  if (!mode) {
    throw errors.validation([{ field: "mode", code: "INVALID_PRACTICE_MODE", message: `Practice mode "${input.mode}" does not exist.` }]);
  }

  const questionCount = input.questionCount ?? 20;

  // Select eligible published questions based on filters
  const eligibleQuestions = await findEligiblePublishedQuestions({
    subject_id: input.filters.subject_id as string | undefined,
    topic_id: input.filters.topic_id as string | undefined,
    year: input.filters.year as number | undefined,
    difficulty: input.filters.difficulty as string | undefined,
    question_types: input.filters.question_types as string[] | undefined,
    limit: questionCount,
  });

  if (eligibleQuestions.length < questionCount) {
    throw errors.noMatchingQuestions();
  }

  // Build frozen pool snapshot
  const frozenPool = eligibleQuestions.map((q, index) => ({
    questionId: q.id,
    questionVersionId: q.versions[0]?.id ?? null,
    questionNumber: index + 1,
    sequence: index + 1,
  }));

  // Filter out questions without a published version (should not happen due to query, but safety)
  const validPool = frozenPool.filter((item) => item.questionVersionId !== null);

  if (validPool.length < questionCount) {
    throw errors.noMatchingQuestions();
  }

  const config = {
    mode: input.mode,
    filters: input.filters,
    question_count: questionCount,
    pool: validPool.map((item) => item.questionId),
  };

  const selectionMetadata = {
    poolSnapshot: validPool,
    shuffleSeed: Math.floor(Math.random() * 1_000_000),
    createdAt: new Date().toISOString(),
  };

  return createPracticeSession({
    userId,
    modeId: mode.id,
    config,
    timed: input.timed ?? false,
    totalQuestions: questionCount,
    frozenPoolSnapshot: validPool,
    selectionMetadata,
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
  if (currentStatus === STATUS.IN_PROGRESS) {
    // Session is already in the active state (in_progress)
    return await toSessionDTO(session);
  }

  if (currentStatus === STATUS.SUBMITTED || currentStatus === STATUS.COMPLETED || currentStatus === STATUS.ABANDONED) {
    throw errors.conflict("SUBMITTED_SESSION_IMMUTABLE", "Cannot activate a submitted, completed, or abandoned session");
  }

  throw errors.conflict("INVALID_SESSION_STATE", `Cannot activate from status '${currentStatus}'`);
}

export async function savePracticeAnswer(input: SaveAnswerInput): Promise<void> {
  const session = await findSessionByIdAndOwner(input.sessionId, input.userId);
  if (!session) {
    throw errors.notFound("SESSION_NOT_FOUND", `Session ${input.sessionId} not found or not owned`);
  }

  if (session.status === STATUS.SUBMITTED || session.status === STATUS.COMPLETED || session.status === STATUS.ABANDONED) {
    throw errors.conflict("SUBMITTED_SESSION_IMMUTABLE", "Cannot modify answers for a submitted, completed, or abandoned session");
  }

  if (session.status !== STATUS.IN_PROGRESS) {
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

  if (session.status === STATUS.SUBMITTED || session.status === STATUS.COMPLETED || session.status === STATUS.ABANDONED) {
    throw errors.conflict("SUBMITTED_SESSION_IMMUTABLE", "Cannot modify answers for a submitted, completed, or abandoned session");
  }

  if (session.status !== STATUS.IN_PROGRESS) {
    throw errors.conflict("INVALID_SESSION_STATE", `Cannot save answer in status "${session.status}"`);
  }

  // Parse session config to get frozen pool
  let parsedConfig: SessionConfig;
  try {
    parsedConfig = await parseSessionConfig(session.config);
  } catch {
    throw errors.conflict("INVALID_SESSION_CONFIG", "Session configuration is invalid");
  }

  const frozenPool = parsedConfig.frozenPoolSnapshot as Array<{ questionId: string; questionVersionId: string; questionNumber: number; sequence: number }> | undefined;

  if (!frozenPool || frozenPool.length === 0) {
    throw errors.conflict("NO_FROZEN_POOL", "Session does not have a frozen question pool");
  }

  // Find the question in the frozen pool
  const poolEntry = frozenPool.find((item) => item.questionId === input.question_id);
  if (!poolEntry) {
    throw errors.notFound("QUESTION_NOT_IN_POOL", `Question ${input.question_id} is not part of this session's frozen pool`);
  }

  const questionVersionId = poolEntry.questionVersionId;
  const questionNumber = poolEntry.questionNumber;
  const sequence = poolEntry.sequence;

  // Extract answer based on type
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

  // Fetch the QuestionVersion with full snapshot for grading (uses frozen published version)
  const questionVersions = await getQuestionVersionsWithSnapshotByIds([questionVersionId]);
  const questionVersion = questionVersions[0];

  if (!questionVersion) {
    throw errors.notFound("QUESTION_VERSION_NOT_FOUND", `Question version ${questionVersionId} not found`);
  }

  // Get question type from snapshot
  const snapshot = questionVersion.snapshot as Record<string, unknown>;
  const questionType = getQuestionType(snapshot);

  if (!questionType) {
    throw errors.conflict("INVALID_QUESTION_TYPE", "Question type not found in snapshot");
  }

  // Get marks and negativeMarks from snapshot
  const marks = Number(getSnapshotValue<number>(snapshot, "marks") ?? 1);
  const negativeMarks = getSnapshotValue<number>(snapshot, "negativeMarks");

  // Grade the answer
  const gradingResult = gradePracticeAnswer({
    questionTypeCode: questionType.code,
    studentAnswer: {
      selectedAnswers,
      numericAnswer,
    },
    snapshot,
    marks,
    negativeMarks,
  });

  const upsertInput: Parameters<typeof upsertAnswer>[0] = {
    sessionId,
    userId,
    questionId: input.question_id,
    questionVersionId,
    sequence,
    questionNumber,
    answerState: "answered",
    markedForReview: false,
    selectedAnswers,
    numericAnswer,
    timeTakenSeconds: input.time_taken_seconds,
    isCorrect: gradingResult.correct,
    marks: gradingResult.marksAwarded,
    negativeMarksApplied: gradingResult.negativeMarksApplied,
  };

  // Persist and get the actual attempt back
  const attempt = await upsertAnswer(upsertInput);

  // Return real attempt data with grading result
  return {
    created: true,
    payload: {
      attempt_id: attempt.id,
      question_id: input.question_id,
      is_correct: gradingResult.correct,
      marks: gradingResult.marksAwarded,
      time_taken_seconds: input.time_taken_seconds,
    },
  };
}

// Helper functions to extract data from QuestionVersion snapshot
function getSnapshotValue<T>(snapshot: Record<string, unknown>, key: string): T | undefined {
  return snapshot[key] as T | undefined;
}

function getQuestionType(snapshot: Record<string, unknown>): { code: string; supportsMultiple?: boolean } | undefined {
  const qt = getSnapshotValue<Record<string, unknown>>(snapshot, "questionType");
  if (!qt) return undefined;
  return {
    code: String(qt.code),
    supportsMultiple: qt.supportsMultiple as boolean | undefined,
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

// getSessionQuestions - returns frozen questions with student-safe data for rendering
export interface SessionQuestionDTO {
  questionId: string;
  questionVersionId: string;
  questionNumber: number;
  sequence: number;
  body: string;
  questionType: string;
  marks: number;
  difficulty: string;
  options?: Array<{ id: string; body: string; sortOrder: number }>;
  // No numeric answers, tolerance, or correct answers exposed
}

export async function getSessionQuestions(sessionId: string, userId: string): Promise<SessionQuestionDTO[]> {
  const session = await findSessionByIdAndOwner(sessionId, userId);
  if (!session) {
    throw errors.notFound("SESSION_NOT_FOUND", `Session ${sessionId} not found or not owned`);
  }

  let parsedConfig: SessionConfig;
  try {
    parsedConfig = await parseSessionConfig(session.config);
  } catch {
    throw errors.conflict("INVALID_SESSION_CONFIG", "Session configuration is invalid");
  }

  const frozenPool = parsedConfig.frozenPoolSnapshot as Array<{ questionId: string; questionVersionId: string; questionNumber: number; sequence: number }> | undefined;

  if (!frozenPool || frozenPool.length === 0) {
    throw errors.conflict("NO_FROZEN_POOL", "Session does not have a frozen question pool");
  }

  const questionVersionIds = frozenPool.map((item) => item.questionVersionId);
  const questionVersions = await getQuestionVersionsByIds(questionVersionIds);

  // Map question versions by ID for quick lookup
  const versionMap = new Map(questionVersions.map((qv) => [qv.id, qv]));

  // Build response in frozen pool sequence order
  const questions: SessionQuestionDTO[] = [];
  for (const poolEntry of frozenPool) {
    const qv = versionMap.get(poolEntry.questionVersionId);
    if (!qv) continue; // Skip if question version not found (should not happen)

    const question = qv.question;
    const questionType = question.questionType;

    const questionDTO: SessionQuestionDTO = {
      questionId: poolEntry.questionId,
      questionVersionId: poolEntry.questionVersionId,
      questionNumber: poolEntry.questionNumber,
      sequence: poolEntry.sequence,
      body: question.body,
      questionType: questionType.code,
      marks: Number(question.marks),
      difficulty: question.difficulty,
    };

    // Add options for MCQ/MSQ (without isCorrect)
    if (questionType.hasOptions && question.options && question.options.length > 0) {
      questionDTO.options = question.options.map((opt) => ({
        id: opt.id,
        body: opt.body,
        sortOrder: opt.sortOrder,
      }));
    }

    questions.push(questionDTO);
  }

  return questions;
}

// completeSession - finalizes the session (sets status to completed, sets endedAt, calculates score)
export async function completeSession(sessionId: string, userId: string): Promise<SessionDTO> {
  const session = await findSessionByIdAndOwner(sessionId, userId);
  if (!session) {
    throw errors.notFound("SESSION_NOT_FOUND", `Session ${sessionId} not found or not owned`);
  }

  if (session.status === STATUS.COMPLETED) {
    throw errors.conflict("SESSION_ALREADY_COMPLETED", "Session is already completed");
  }

  if (session.status !== STATUS.IN_PROGRESS) {
    throw errors.conflict("INVALID_SESSION_STATE", `Cannot complete session with status "${session.status}"`);
  }

  // Parse session config to get frozen pool
  let parsedConfig: SessionConfig;
  try {
    parsedConfig = await parseSessionConfig(session.config);
  } catch {
    throw errors.conflict("INVALID_SESSION_CONFIG", "Session configuration is invalid");
  }

  const frozenPool = parsedConfig.frozenPoolSnapshot as Array<{ questionId: string; questionVersionId: string; questionNumber: number; sequence: number }> | undefined;

  if (!frozenPool || frozenPool.length === 0) {
    throw errors.conflict("NO_FROZEN_POOL", "Session does not have a frozen question pool");
  }

  const frozenQuestionVersionIds = frozenPool.map((item) => item.questionVersionId);

  // Calculate aggregate score from graded attempts in the frozen pool
  const score = await calculateSessionScore(sessionId, frozenQuestionVersionIds);

  // Complete the session with the calculated score (atomic transaction)
  const updated = await completeSessionRepo(sessionId, userId, score);
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