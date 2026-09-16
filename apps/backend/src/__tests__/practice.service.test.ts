// PHASE 12G-T10 — Practice service tests (mocked repositories)
// Recreated during 12G-T9-R2; follows the project's vitest conventions.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../core/repositories/practice.repo", () => ({
  createSession: vi.fn(),
  findSessionByIdAndOwner: vi.fn(),
  listAnswersForSession: vi.fn(),
  parseSessionConfig: vi.fn(async (config: unknown) => config),
  upsertAnswer: vi.fn(),
  updateSessionStatus: vi.fn(),
}));

import {
  activatePracticeSession,
  createPracticeSession,
  getPracticeSession,
  getPracticeSessionAnswers,
  savePracticeAnswer,
} from "../core/services/practice.service";
import {
  createSession,
  findSessionByIdAndOwner,
  listAnswersForSession,
  upsertAnswer,
  updateSessionStatus,
} from "../core/repositories/practice.repo";

type SessionRow = NonNullable<Awaited<ReturnType<typeof findSessionByIdAndOwner>>>;

const createSessionMock = vi.mocked(createSession);
const findSessionMock = vi.mocked(findSessionByIdAndOwner);
const listAnswersMock = vi.mocked(listAnswersForSession);
const upsertAnswerMock = vi.mocked(upsertAnswer);
const sessionUpdateMock = vi.mocked(updateSessionStatus);

function makeSession(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: "session-1",
    userId: "user-1",
    modeId: "mode-1",
    config: { mode: "default", filters: {}, question_count: 10, pool: null },
    timed: false,
    totalQuestions: 10,
    status: "pending",
    startedAt: new Date("2026-01-01T00:00:00Z"),
    endedAt: null,
    abandonedAt: null,
    score: null,
    ...overrides,
  };
}

const FROZEN_POOL_SNAPSHOT = {
  questionIds: ["q-1", "q-2"],
  questionVersionIds: ["qv-1", "qv-2"],
  selectedAt: "2026-01-01T00:00:00Z",
};

const SELECTION_METADATA = {
  poolSnapshot: FROZEN_POOL_SNAPSHOT,
  shuffleSeed: 42,
  createdAt: "2026-01-01T00:00:00Z",
};

const ANSWER_INPUT = {
  sessionId: "session-1",
  userId: "user-1",
  questionId: "q-1",
  publishedVersionId: "qv-1",
  questionNumber: 1,
  answerState: "answered",
  markedForReview: true,
  selectedAnswers: ["A"],
};

beforeEach(() => {
  vi.clearAllMocks();
});
describe("Practice service", () => {
  it("creates a pending session through the repository", async () => {
    createSessionMock.mockResolvedValue(makeSession());
    const result = await createPracticeSession({ userId: "user-1", modeId: "mode-1", totalQuestions: 10 });
    expect(result.status).toBe("pending");
    expect(createSessionMock).toHaveBeenCalledWith(expect.objectContaining({ status: "pending" }));
  });

  it("preserves supplied metadata and frozen snapshot", async () => {
    const config = { mode: "default", filters: { year: 2099 }, question_count: 2, pool: ["q-1"] };
    createSessionMock.mockResolvedValue(makeSession({ config: {
      ...config, frozenPoolSnapshot: FROZEN_POOL_SNAPSHOT, selectionMetadata: SELECTION_METADATA,
    } }));
    const result = await createPracticeSession({ userId: "user-1", modeId: "mode-1", totalQuestions: 2,
      config, frozenPoolSnapshot: FROZEN_POOL_SNAPSHOT, selectionMetadata: SELECTION_METADATA });
    expect(createSessionMock).toHaveBeenCalledWith(expect.objectContaining({
      config, frozenPoolSnapshot: FROZEN_POOL_SNAPSHOT, selectionMetadata: SELECTION_METADATA,
    }));
    expect(result.frozenPoolSnapshot).toEqual(FROZEN_POOL_SNAPSHOT);
    expect(result.selectionMetadata).toEqual(SELECTION_METADATA);
    expect(result.config.filters).toEqual({ year: 2099 });
  });

  it.each([
    { userId: "", modeId: "mode-1", totalQuestions: 2 },
    { userId: "user-1", totalQuestions: 2 },
    { userId: "user-1", modeId: "mode-1", totalQuestions: 0 },
    { userId: "user-1", modeId: "mode-1", totalQuestions: -1 },
  ])("rejects invalid creation input %j", async (input) => {
    await expect(createPracticeSession(input)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("retrieves an owned session using owner-scoped lookup", async () => {
    findSessionMock.mockResolvedValue(makeSession());
    expect(await getPracticeSession("session-1", "user-1")).toMatchObject({ id: "session-1", userId: "user-1" });
    expect(findSessionMock).toHaveBeenCalledWith("session-1", "user-1");
  });

  it.each(["non-owner", "missing-session"])("rejects lookup for %s", async (value) => {
    findSessionMock.mockResolvedValue(null);
    await expect(getPracticeSession(value, "other-user")).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" });
  });

  it("activates pending sessions through the repository", async () => {
    findSessionMock.mockResolvedValue(makeSession());
    sessionUpdateMock.mockResolvedValue(makeSession({ status: "active" }));
    expect(await activatePracticeSession("session-1", "user-1")).toMatchObject({ status: "active" });
    expect(sessionUpdateMock).toHaveBeenCalledWith("session-1", "active", "user-1");
  });

  it.each([
    ["active", "INVALID_SESSION_STATE"], ["submitted", "SUBMITTED_SESSION_IMMUTABLE"],
  ])("rejects activation from %s", async (status, code) => {
    findSessionMock.mockResolvedValue(makeSession({ status }));
    await expect(activatePracticeSession("session-1", "user-1")).rejects.toMatchObject({ code });
    expect(sessionUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects activation by a non-owner", async () => {
    findSessionMock.mockResolvedValue(null);
    await expect(activatePracticeSession("session-1", "other")).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" });
    expect(sessionUpdateMock).not.toHaveBeenCalled();
  });

  it("persists an owned active answer without sending grading fields", async () => {
    findSessionMock.mockResolvedValue(makeSession({ status: "active" }));
    expect(await savePracticeAnswer(ANSWER_INPUT)).toBeUndefined();
    expect(findSessionMock).toHaveBeenCalledWith("session-1", "user-1");
    expect(upsertAnswerMock).toHaveBeenCalledExactlyOnceWith({
      sessionId: "session-1", userId: "user-1", questionId: "q-1", questionVersionId: "qv-1",
      sequence: 1, questionNumber: 1, answerState: "answered", markedForReview: true,
      selectedAnswers: ["A"], numericAnswer: undefined,
    });
  });

  it.each([
    ["pending", "INVALID_SESSION_STATE"], ["submitted", "SUBMITTED_SESSION_IMMUTABLE"],
  ])("rejects answers in %s sessions", async (status, code) => {
    findSessionMock.mockResolvedValue(makeSession({ status }));
    await expect(savePracticeAnswer(ANSWER_INPUT)).rejects.toMatchObject({ code });
    expect(upsertAnswerMock).not.toHaveBeenCalled();
  });

  it("rejects answer writes by a non-owner", async () => {
    findSessionMock.mockResolvedValue(null);
    await expect(savePracticeAnswer(ANSWER_INPUT)).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" });
    expect(upsertAnswerMock).not.toHaveBeenCalled();
  });

  it("returns student state without grading metadata or answer keys", async () => {
    findSessionMock.mockResolvedValue(makeSession({ status: "active" }));
    listAnswersMock.mockResolvedValue([{ questionVersionId: "qv-1", sequence: 1, selectedAnswers: {
      values: ["A"], numericAnswer: null, __answerState: "answered", __markedForReview: true,
      __negativeMarksApplied: 1, correctOptions: ["B"], numericAnswerKey: 42, score: 10, correct: false,
    } }]);
    expect(await getPracticeSessionAnswers("session-1", "user-1")).toEqual([{
      questionVersionId: "qv-1", questionNumber: 1, selectedAnswers: ["A"], numericAnswer: null,
      answerState: "answered", markedForReview: true,
    }]);
    expect(listAnswersMock).toHaveBeenCalledWith("session-1");
  });

  it("rejects answer retrieval by a non-owner", async () => {
    findSessionMock.mockResolvedValue(null);
    await expect(getPracticeSessionAnswers("session-1", "other")).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" });
    expect(listAnswersMock).not.toHaveBeenCalled();
  });
});
