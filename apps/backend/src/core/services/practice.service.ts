// PHASE 12G-T10 — Practice Service Layer (thin business logic over 12G-T9 repositories)
import { errors } from "../errors";
import * as practiceRepo from "../repositories/practice.repo";
import type {
  SessionRow,
  SessionWithAnswersRow,
  PracticeQuestionAnswerUpsertInput,
  FrozenPoolSnapshot,
  SelectionMetadata,
} from "../repositories/practice.repo";

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface CreatePracticeSessionInput {
  userId: string;
  modeId: string;
  config: {
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
  };
  timed: boolean;
  totalQuestions: number;
  frozenPoolSnapshot?: FrozenPoolSnapshot;
  selectionMetadata?: SelectionMetadata;
}

export interface PracticeSessionDTO {
  id: string;
  userId: string;
  modeId: string;
  status: string;
  timed: boolean;
  totalQuestions: number;
  score: number | null;
  startedAt: string | null;
  endedAt: string | null;
  abandonedAt: string | null;
  config: unknown;
  mode: { id: string; code: string; name: string };
}

export interface PracticeAnswerDTO {
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
  answeredAt: string;
  responseVersion: number;
}

export interface PracticeSessionWithAnswersDTO {
  session: PracticeSessionDTO;
  answers: PracticeAnswerDTO[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function toSessionDTO(row: SessionRow): PracticeSessionDTO {
  return {
    id: row.id,
    userId: row.userId,
    modeId: row.modeId,
    status: row.status,
    timed: row.timed,
    totalQuestions: row.totalQuestions,
    score: row.score ? Number(row.score) : null,
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    endedAt: row.endedAt ? row.endedAt.toISOString() : null,
    abandonedAt: row.abandonedAt ? row.abandonedAt.toISOString() : null,
    config: row.config,
    mode: row.mode,
  };
}

function toSessionWithAnswersDTO(
  sessionRow: SessionWithAnswersRow
): PracticeSessionWithAnswersDTO {
  const answers: PracticeAnswerDTO[] = (sessionRow.attempts || []).map((attempt) => ({
    id: attempt.id,
    sessionId: sessionRow.id,
    questionId: attempt.questionVersionId,
    questionVersionId: attempt.questionVersionId,
    selectedAnswers: attempt.selectedAnswers,
    correct: attempt.isCorrect,
    score: Number(attempt.marks),
    negativeMarksApplied: false,
    markedForReview: false,
    answerState: "answered" as const,
    timeTakenSeconds: attempt.timeTakenSeconds,
    answeredAt: attempt.answeredAt.toISOString(),
    responseVersion: attempt.responseVersion,
  }));

  return {
    session: toSessionDTO(sessionRow as unknown as SessionRow),
    answers,
  };
}

// ─── Service Operations ─────────────────────────────────────────────────────────

/**
 * Create a new Practice session.
 *
 * Rules:
 * - Validates basic input
 * - Preserves selection metadata when supplied
 * - Persists frozenPoolSnapshot when supplied
 * - Creates session with initial 'pending' status
 * - Does NOT select questions or generate pools
 */
export async function createPracticeSession(
  input: CreatePracticeSessionInput
): Promise<PracticeSessionDTO> {
  // Basic validation
  if (!input.userId) {
    throw errors.malformed("User ID is required.");
  }
  if (!input.modeId) {
    throw errors.malformed("Mode ID is required.");
  }
  if (input.totalQuestions <= 0) {
    throw errors.malformed("Total questions must be positive.");
  }

  // Create session
  const session = await practiceRepo.createSession({
    userId: input.userId,
    modeId: input.modeId,
    config: input.config,
    timed: input.timed,
    totalQuestions: input.totalQuestions,
  });

  // Persist frozen pool snapshot if supplied
  if (input.frozenPoolSnapshot) {
    await practiceRepo.saveFrozenPoolSnapshot(session.id, input.frozenPoolSnapshot);
  }


/**
 * Get a Practice session by ID for the owning user.
 *
 * Rules:
 * - Uses owner-scoped lookup
 * - Returns 404 if session doesn't exist or doesn't belong to user
 * - Does NOT expose answer-key information
 */
export async function getPracticeSession(
  sessionId: string,
  userId: string
): Promise<PracticeSessionDTO> {
  const session = await loadOwnedSession(sessionId, userId);
  return toSessionDTO(session);
}

/**
 * Activate a Practice session.
 *
 * Allowed transition: pending → active
 * Rejected transitions: active → active, submitted → active
 *
 * Rules:
 * - Verifies session ownership
 * - Only allows activation from 'pending' status
 * - Rejects activation from 'active' or 'submitted' status
 * - Does NOT implement submission
 */
export async function activatePracticeSession(
  sessionId: string,
  userId: string
): Promise<PracticeSessionDTO> {
  const session = await loadOwnedSession(sessionId, userId);

  // Validate status transition
  if (session.status === "submitted") {
    throw errors.conflict(
      "SUBMITTED_SESSION_IMMUTABLE",
      "Cannot activate a submitted session."
    );
  }

  if (session.status === "active") {
    throw errors.conflict(
      "INVALID_SESSION_STATE",
      "Session is already active."
    );

/**
 * Save or update a Practice answer.
 *
 * Rules:
 * - Verifies session ownership
 * - Verifies session is 'active'
 * - Rejects modification of 'submitted' sessions
 * - Does NOT calculate correctness, score, or negative marks
 * - Does NOT expose correct answers
 * - Only persists student's answer state and review flag
 */
export async function savePracticeAnswer(
  sessionId: string,
  userId: string,
  questionId: string,
  questionVersionId: string,
  answerState: "unanswered" | "answered" | "skipped" | "review",
  markedForReview: boolean,
  selectedAnswers: unknown,
  timeTakenSeconds: number
): Promise<PracticeAnswerDTO> {
  // Verify session ownership and get session
  const session = await loadOwnedSession(sessionId, userId);

  // Validate session status
  if (session.status === "submitted") {
    throw errors.conflict(
      "SUBMITTED_SESSION_IMMUTABLE",
      "Cannot modify answers in a submitted session."
    );
  }

  if (session.status !== "active") {
    throw errors.conflict(
      "INVALID_SESSION_STATE",
      `Cannot save answers to a '${session.status}' session. Session must be 'active'.`
    );
  }

  // Prepare answer input for repository
  const answerInput: PracticeQuestionAnswerUpsertInput = {
    sessionId,
    userId,
    questionVersionId,
    questionId,
    selectedAnswers,
    correct: false,
    score: 0,
    negativeMarksApplied: false,
    markedForReview,
    answerState,
    timeTakenSeconds,
  };

  // Persist through repository
  const attempt = await practiceRepo.upsertAnswer(answerInput);


// ─── Status Constants ───────────────────────────────────────────────────────────

export const PracticeSessionStatus = {
  PENDING: "pending",
  ACTIVE: "active",
  SUBMITTED: "submitted",
} as const;

export type PracticeSessionStatus = (typeof PracticeSessionStatus)[keyof typeof PracticeSessionStatus];

  // Convert to DTO
  return {
    id: attempt.id,
    sessionId: attempt.sessionId,
    questionId: attempt.questionVersionId,
    questionVersionId: attempt.questionVersionId,
    selectedAnswers: attempt.selectedAnswers,
    correct: attempt.isCorrect,
    score: Number(attempt.marks),
    negativeMarksApplied: false,
    markedForReview: false,
    answerState: "answered" as const,
    timeTakenSeconds: attempt.timeTakenSeconds,
    answeredAt: attempt.answeredAt.toISOString(),
    responseVersion: attempt.responseVersion,
  };
}

/**
 * Get all answers for a Practice session.
 *
 * Rules:
 * - Verifies session ownership
 * - Returns persisted student answer state only
 * - Does NOT calculate score or result
 * - Does NOT expose correct_answer data
 */
export async function getPracticeSessionAnswers(
  sessionId: string,
  userId: string
): Promise<PracticeSessionWithAnswersDTO> {
  // Verify ownership
  await loadOwnedSession(sessionId, userId);

  // Get session with answers
  const sessionWithAnswers = await practiceRepo.findSessionWithAnswersByIdAndOwner(
    sessionId,
    userId
  );

  if (!sessionWithAnswers) {
    throw errors.notFound("SESSION_NOT_FOUND", "Practice session not found.");
  }

  return toSessionWithAnswersDTO(sessionWithAnswers);
}

  }

  if (session.status !== "pending") {
    throw errors.conflict(
      "INVALID_SESSION_STATE",
      `Cannot activate session from '${session.status}' status. Only 'pending' sessions can be activated.`
    );
  }

  // Activate the session
  await practiceRepo.updateSessionStatus(sessionId, "active", {
    startedAt: new Date(),
  });

  const refreshedSession = await practiceRepo.findSessionById(sessionId);
  if (!refreshedSession) {
    throw errors.notFound("SESSION_NOT_FOUND", "Failed to retrieve activated session.");
  }

  return toSessionDTO(refreshedSession);
}

  // Persist selection metadata if supplied
  if (input.selectionMetadata) {
    await practiceRepo.saveSelectionMetadata(session.id, input.selectionMetadata);
  }

  // Update status to pending
  await practiceRepo.updateSessionStatus(session.id, "pending");

  const refreshedSession = await practiceRepo.findSessionById(session.id);
  if (!refreshedSession) {
    throw errors.notFound("SESSION_NOT_FOUND", "Failed to retrieve created session.");
  }

  return toSessionDTO(refreshedSession);
}

    markedForReview: false,
    answerState: "answered" as const,
    timeTakenSeconds: attempt.timeTakenSeconds,
    answeredAt: attempt.answeredAt.toISOString(),
    responseVersion: attempt.responseVersion,
  }));

  return {
    session: toSessionDTO(sessionRow as unknown as SessionRow),
    answers,
  };
}

async function loadOwnedSession(
  sessionId: string,
  userId: string
): Promise<SessionRow> {
  const session = await practiceRepo.findSessionByIdAndOwner(sessionId, userId);
  if (!session) {
    throw errors.notFound("SESSION_NOT_FOUND", "Practice session not found.");
  }
  return session;
}
