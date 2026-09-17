// PHASE 12G-T11 — Practice service tests (mocked repositories)
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../core/repositories/practice.repo", () => ({
  createSession: vi.fn(),
  findSessionByIdAndOwner: vi.fn(),
  listAnswersForSession: vi.fn(),
  parseSessionConfig: vi.fn(async (config: unknown) => {
    if (typeof config === "object" && config !== null && !Array.isArray(config)) {
      return config as Record<string, unknown>;
    }
    throw new Error("Invalid session config");
  }),
  upsertAnswer: vi.fn(),
  updateSessionStatus: vi.fn(),
  findPracticeModeByCode: vi.fn(),
  findPublishedQuestionVersion: vi.fn(),
  findEligiblePublishedQuestions: vi.fn().mockResolvedValue([]),
  getQuestionVersionsByIds: vi.fn().mockResolvedValue([]),
}));

import {
  activatePracticeSession,
  createPracticeSession,
  getPracticeSession,
  getPracticeSessionAnswers,
  savePracticeAnswer,
  createSessionRoute,
  recordAttemptRoute,
  getSessionQuestions,
} from "../core/services/practice.service";
import {
  createSession,
  findSessionByIdAndOwner,
  listAnswersForSession,
  upsertAnswer,
  updateSessionStatus,
  findPracticeModeByCode,
  findPublishedQuestionVersion,
  findEligiblePublishedQuestions,
  getQuestionVersionsByIds,
} from "../core/repositories/practice.repo";
import type { QuestionVersion } from "@prisma/client";
import { Prisma } from "@prisma/client";

type SessionRow = NonNullable<Awaited<ReturnType<typeof findSessionByIdAndOwner>>>;

const createSessionMock = vi.mocked(createSession);
const findSessionMock = vi.mocked(findSessionByIdAndOwner);
const listAnswersMock = vi.mocked(listAnswersForSession);
const upsertAnswerMock = vi.mocked(upsertAnswer);
const sessionUpdateMock = vi.mocked(updateSessionStatus);
const findPracticeModeMock = vi.mocked(findPracticeModeByCode);
const findPublishedQuestionVersionMock = vi.mocked(findPublishedQuestionVersion);
const findEligiblePublishedQuestionsMock = vi.mocked(findEligiblePublishedQuestions);
const getQuestionVersionsByIdsMock = vi.mocked(getQuestionVersionsByIds);

function makeSession(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: "session-1",
    userId: "user-1",
    modeId: "mode-1",
    config: { mode: "default", filters: {}, question_count: 10, pool: null },
    timed: false,
    totalQuestions: 10,
    status: "in_progress",
    startedAt: new Date("2026-01-01T00:00:00Z"),
    endedAt: null,
    abandonedAt: null,
    score: null,
    ...overrides,
  };
}

function makeQuestionVersion(overrides: Partial<QuestionVersion> = {}): QuestionVersion {
  return {
    id: "qv-1",
    questionId: "q-1",
    version: 1,
    snapshot: {},
    reason: null,
    createdById: "user-1",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makeSessionWithFrozenPool(overrides: Partial<SessionRow> = {}): SessionRow {
  const frozenPool = [
    { questionId: "q-1", questionVersionId: "qv-1", questionNumber: 1, sequence: 1 },
    { questionId: "q-2", questionVersionId: "qv-2", questionNumber: 2, sequence: 2 },
  ];
  return makeSession({
    config: {
      mode: "topic",
      filters: { topic_id: "topic-1" },
      question_count: 2,
      pool: ["q-1", "q-2"],
      frozenPoolSnapshot: frozenPool,
      selectionMetadata: { poolSnapshot: frozenPool, shuffleSeed: 42, createdAt: "2026-01-01T00:00:00Z" },
    },
    ...overrides,
  });
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
  findPracticeModeMock.mockResolvedValue({ id: "mode-1", code: "topic", name: "Topic" });
  findPublishedQuestionVersionMock.mockResolvedValue(makeQuestionVersion());
  getQuestionVersionsByIdsMock.mockResolvedValue([]);
});

describe("Practice service", () => {
  it("creates a session through the repository with in_progress status", async () => {
    createSessionMock.mockResolvedValue(makeSession());
    const result = await createPracticeSession({ userId: "user-1", modeId: "mode-1", totalQuestions: 10 });
    expect(result.status).toBe("in_progress");
    expect(createSessionMock).toHaveBeenCalledWith(expect.objectContaining({ modeId: "mode-1" }));
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

  it("returns existing in_progress session on activate", async () => {
    findSessionMock.mockResolvedValue(makeSession());
    expect(await activatePracticeSession("session-1", "user-1")).toMatchObject({ status: "in_progress" });
    expect(sessionUpdateMock).not.toHaveBeenCalled();
  });

  it.each([
    ["submitted", "SUBMITTED_SESSION_IMMUTABLE"],
    ["completed", "SUBMITTED_SESSION_IMMUTABLE"],
    ["abandoned", "SUBMITTED_SESSION_IMMUTABLE"],
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

  it("persists an owned in_progress answer without sending grading fields", async () => {
    findSessionMock.mockResolvedValue(makeSession({ status: "in_progress" }));
    expect(await savePracticeAnswer(ANSWER_INPUT)).toBeUndefined();
    expect(findSessionMock).toHaveBeenCalledWith("session-1", "user-1");
    expect(upsertAnswerMock).toHaveBeenCalledExactlyOnceWith({
      sessionId: "session-1", userId: "user-1", questionId: "q-1", questionVersionId: "qv-1",
      sequence: 1, questionNumber: 1, answerState: "answered", markedForReview: true,
      selectedAnswers: ["A"], numericAnswer: undefined,
    });
  });

  it.each([
    ["submitted", "SUBMITTED_SESSION_IMMUTABLE"],
    ["completed", "SUBMITTED_SESSION_IMMUTABLE"],
    ["abandoned", "SUBMITTED_SESSION_IMMUTABLE"],
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
    findSessionMock.mockResolvedValue(makeSession({ status: "in_progress" }));
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

  it("createSessionRoute validates PracticeMode exists", async () => {
    findPracticeModeMock.mockResolvedValue(null);
    await expect(createSessionRoute("user-1", { mode: "invalid", filters: {} })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(findPracticeModeMock).toHaveBeenCalledWith("invalid");
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("createSessionRoute builds frozen pool from eligible published questions", async () => {
    findPracticeModeMock.mockResolvedValue({ id: "mode-1", code: "topic", name: "Topic" });
    // @ts-expect-error - test mock with partial data
    findEligiblePublishedQuestionsMock.mockResolvedValue([
      { id: "q-1", versions: [{ id: "qv-1", questionId: "q-1", version: 1, snapshot: {}, reason: null, createdById: "user-1", createdAt: new Date() }], questionType: { id: "qt-1", code: "mcq", name: "MCQ", hasOptions: true, hasNumeric: false, supportsMultiple: false } },
      { id: "q-2", versions: [{ id: "qv-2", questionId: "q-2", version: 1, snapshot: {}, reason: null, createdById: "user-1", createdAt: new Date() }], questionType: { id: "qt-1", code: "mcq", name: "MCQ", hasOptions: true, hasNumeric: false, supportsMultiple: false } },
    ] as unknown);
    createSessionMock.mockResolvedValue(makeSession({
      config: {
        mode: "topic",
        filters: { topic_id: "topic-1" },
        question_count: 2,
        pool: ["q-1", "q-2"],
        frozenPoolSnapshot: [
          { questionId: "q-1", questionVersionId: "qv-1", questionNumber: 1, sequence: 1 },
          { questionId: "q-2", questionVersionId: "qv-2", questionNumber: 2, sequence: 2 },
        ],
        selectionMetadata: {
          poolSnapshot: [
            { questionId: "q-1", questionVersionId: "qv-1", questionNumber: 1, sequence: 1 },
            { questionId: "q-2", questionVersionId: "qv-2", questionNumber: 2, sequence: 2 },
          ],
          shuffleSeed: 42,
          createdAt: "2026-01-01T00:00:00Z",
        },
      },
    }));

    const result = await createSessionRoute("user-1", {
      mode: "topic",
      filters: { topic_id: "topic-1" },
      questionCount: 2,
    });

    expect(findEligiblePublishedQuestionsMock).toHaveBeenCalledWith(expect.objectContaining({
      topic_id: "topic-1",
      limit: 2,
    }));
    expect(result.frozenPoolSnapshot).toEqual([
      { questionId: "q-1", questionVersionId: "qv-1", questionNumber: 1, sequence: 1 },
      { questionId: "q-2", questionVersionId: "qv-2", questionNumber: 2, sequence: 2 },
    ]);
    expect(result.selectionMetadata).toMatchObject({
      poolSnapshot: [
        { questionId: "q-1", questionVersionId: "qv-1", questionNumber: 1, sequence: 1 },
        { questionId: "q-2", questionVersionId: "qv-2", questionNumber: 2, sequence: 2 },
      ],
    });
    expect(createSessionMock).toHaveBeenCalledWith(expect.objectContaining({
      frozenPoolSnapshot: [
        { questionId: "q-1", questionVersionId: "qv-1", questionNumber: 1, sequence: 1 },
        { questionId: "q-2", questionVersionId: "qv-2", questionNumber: 2, sequence: 2 },
      ],
    }));
  });

  it("createSessionRoute rejects when not enough published questions match filters", async () => {
    findPracticeModeMock.mockResolvedValue({ id: "mode-1", code: "topic", name: "Topic" });
    // @ts-expect-error - test mock with partial data
    findEligiblePublishedQuestionsMock.mockResolvedValue([
      { id: "q-1", versions: [{ id: "qv-1", questionId: "q-1", version: 1, snapshot: {}, reason: null, createdById: "user-1", createdAt: new Date() }], questionType: { id: "qt-1", code: "mcq", name: "MCQ", hasOptions: true, hasNumeric: false, supportsMultiple: false } },
    ] as unknown);

    await expect(createSessionRoute("user-1", {
      mode: "topic",
      filters: { topic_id: "topic-1" },
      questionCount: 2,
    })).rejects.toMatchObject({ code: "NO_MATCHING_QUESTIONS" });

    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("createSessionRoute rejects when eligible questions lack published versions", async () => {
    findPracticeModeMock.mockResolvedValue({ id: "mode-1", code: "topic", name: "Topic" });
    // @ts-expect-error - test mock with partial data
    findEligiblePublishedQuestionsMock.mockResolvedValue([
      { id: "q-1", versions: [], questionType: { id: "qt-1", code: "mcq", name: "MCQ", hasOptions: true, hasNumeric: false, supportsMultiple: false } },
    ] as unknown);

    await expect(createSessionRoute("user-1", {
      mode: "topic",
      filters: { topic_id: "topic-1" },
      questionCount: 1,
    })).rejects.toMatchObject({ code: "NO_MATCHING_QUESTIONS" });

    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("recordAttemptRoute uses frozen pool and returns real attempt ID", async () => {
    findSessionMock.mockResolvedValue(makeSessionWithFrozenPool());
    upsertAnswerMock.mockResolvedValue({ id: "attempt-real-1", sessionId: "session-1", userId: "user-1", questionVersionId: "qv-1", sequence: 1, selectedAnswers: {}, isCorrect: false, marks: new Prisma.Decimal(0), timeTakenSeconds: 30, answeredAt: new Date(), responseVersion: 1 });

    const result = await recordAttemptRoute("session-1", "user-1", {
      question_id: "q-1",
      answer: { option_id: "A" },
      time_taken_seconds: 30,
    });

    expect(upsertAnswerMock).toHaveBeenCalledWith(expect.objectContaining({
      questionVersionId: "qv-1",
      sequence: 1,
      questionNumber: 1,
    }));
    expect(result.payload.attempt_id).toBe("attempt-real-1");
    expect(result.payload.question_id).toBe("q-1");
    expect(result.payload.time_taken_seconds).toBe(30);
  });

  it("recordAttemptRoute rejects question not in frozen pool", async () => {
    findSessionMock.mockResolvedValue(makeSessionWithFrozenPool());

    await expect(recordAttemptRoute("session-1", "user-1", {
      question_id: "q-999",
      answer: { option_id: "A" },
      time_taken_seconds: 30,
    })).rejects.toMatchObject({ code: "QUESTION_NOT_IN_POOL" });

    expect(upsertAnswerMock).not.toHaveBeenCalled();
  });

  it("recordAttemptRoute rejects when session has no frozen pool", async () => {
    findSessionMock.mockResolvedValue(makeSession({ status: "in_progress" }));

    await expect(recordAttemptRoute("session-1", "user-1", {
      question_id: "q-1",
      answer: { option_id: "A" },
      time_taken_seconds: 30,
    })).rejects.toMatchObject({ code: "NO_FROZEN_POOL" });

    expect(upsertAnswerMock).not.toHaveBeenCalled();
  });

  it("recordAttemptRoute rejects when session config is invalid", async () => {
    findSessionMock.mockResolvedValue(makeSession({ config: "invalid" }));

    await expect(recordAttemptRoute("session-1", "user-1", {
      question_id: "q-1",
      answer: { option_id: "A" },
      time_taken_seconds: 30,
    })).rejects.toMatchObject({ code: "INVALID_SESSION_CONFIG" });

    expect(upsertAnswerMock).not.toHaveBeenCalled();
  });

  // getSessionQuestions tests
  it("getSessionQuestions returns frozen questions with student-safe data", async () => {
    const sessionWithPool = makeSessionWithFrozenPool();

    findSessionMock.mockResolvedValue(sessionWithPool);
    // @ts-expect-error - test mock with partial data
    getQuestionVersionsByIdsMock.mockResolvedValue([
      {
        id: "qv-1",
        question: {
          id: "q-1",
          body: "What is 2+2?",
          marks: new Prisma.Decimal(1),
          difficulty: "easy",
          questionType: { code: "mcq", hasOptions: true, hasNumeric: false, supportsMultiple: false },
          options: [
            { id: "opt-1", body: "3", sortOrder: 1, questionId: "q-1", isCorrect: false },
            { id: "opt-2", body: "4", sortOrder: 2, questionId: "q-1", isCorrect: false },
            { id: "opt-3", body: "5", sortOrder: 3, questionId: "q-1", isCorrect: false },
          ],
        },
      },
      {
        id: "qv-2",
        question: {
          id: "q-2",
          body: "What is 3*3?",
          marks: new Prisma.Decimal(2),
          difficulty: "medium",
          questionType: { code: "msq", hasOptions: true, hasNumeric: false, supportsMultiple: true },
          options: [
            { id: "opt-4", body: "6", sortOrder: 1, questionId: "q-2", isCorrect: false },
            { id: "opt-5", body: "9", sortOrder: 2, questionId: "q-2", isCorrect: false },
          ],
        },
      },
    ] as unknown);

    const questions = await getSessionQuestions("session-1", "user-1");

    expect(findSessionMock).toHaveBeenCalledWith("session-1", "user-1");
    expect(getQuestionVersionsByIdsMock).toHaveBeenCalledWith(["qv-1", "qv-2"]);
    expect(questions).toHaveLength(2);

    expect(questions[0]).toMatchObject({
      questionId: "q-1",
      questionVersionId: "qv-1",
      questionNumber: 1,
      sequence: 1,
      body: "What is 2+2?",
      questionType: "mcq",
      marks: 1,
      difficulty: "easy",
    });
    expect(questions[0].options).toHaveLength(3);
    expect(questions[0].options).toEqual([
      { id: "opt-1", body: "3", sortOrder: 1 },
      { id: "opt-2", body: "4", sortOrder: 2 },
      { id: "opt-3", body: "5", sortOrder: 3 },
    ]);

    expect(questions[1]).toMatchObject({
      questionId: "q-2",
      questionVersionId: "qv-2",
      questionNumber: 2,
      sequence: 2,
      body: "What is 3*3?",
      questionType: "msq",
      marks: 2,
      difficulty: "medium",
    });
    expect(questions[1].options).toHaveLength(2);
  });

  it("getSessionQuestions rejects non-owner", async () => {
    findSessionMock.mockResolvedValue(null);

    await expect(getSessionQuestions("session-1", "other")).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" });
    expect(getQuestionVersionsByIdsMock).not.toHaveBeenCalled();
  });

  it("getSessionQuestions rejects when session has no frozen pool", async () => {
    findSessionMock.mockResolvedValue(makeSession({ status: "in_progress" }));

    await expect(getSessionQuestions("session-1", "user-1")).rejects.toMatchObject({ code: "NO_FROZEN_POOL" });
    expect(getQuestionVersionsByIdsMock).not.toHaveBeenCalled();
  });

  it("getSessionQuestions rejects when session config is invalid", async () => {
    findSessionMock.mockResolvedValue(makeSession({ config: "invalid" }));

    await expect(getSessionQuestions("session-1", "user-1")).rejects.toMatchObject({ code: "INVALID_SESSION_CONFIG" });
    expect(getQuestionVersionsByIdsMock).not.toHaveBeenCalled();
  });

  it("getSessionQuestions does not expose correct answers or numeric answers", async () => {
    const sessionWithPool = makeSessionWithFrozenPool();

    findSessionMock.mockResolvedValue(sessionWithPool);
    // @ts-expect-error - test mock with partial data
    getQuestionVersionsByIdsMock.mockResolvedValue([
      {
        id: "qv-1",
        question: {
          id: "q-1",
          body: "What is 2+2?",
          marks: new Prisma.Decimal(1),
          difficulty: "easy",
          questionType: { code: "mcq", hasOptions: true, hasNumeric: false, supportsMultiple: false },
          options: [
            { id: "opt-1", body: "3", sortOrder: 1, questionId: "q-1", isCorrect: true }, // Correct answer in DB
            { id: "opt-2", body: "4", sortOrder: 2, questionId: "q-1", isCorrect: false },
          ],
        },
      },
    ] as unknown);

    const questions = await getSessionQuestions("session-1", "user-1");

    expect(questions[0].options).toHaveLength(2);
    // Verify isCorrect is NOT in the response
    for (const opt of questions[0].options ?? []) {
      expect(opt).not.toHaveProperty("isCorrect");
    }
  });

  it("getSessionQuestions preserves frozen pool sequence order", async () => {
    const frozenPool = [
      { questionId: "q-1", questionVersionId: "qv-1", questionNumber: 1, sequence: 1 },
      { questionId: "q-2", questionVersionId: "qv-2", questionNumber: 2, sequence: 2 },
      { questionId: "q-3", questionVersionId: "qv-3", questionNumber: 3, sequence: 3 },
    ];
    const sessionWithPool = makeSession({
      config: {
        mode: "topic",
        filters: { topic_id: "topic-1" },
        question_count: 3,
        pool: ["q-1", "q-2", "q-3"],
        frozenPoolSnapshot: frozenPool,
        selectionMetadata: { poolSnapshot: frozenPool, shuffleSeed: 42, createdAt: "2026-01-01T00:00:00Z" },
      },
    });

    findSessionMock.mockResolvedValue(sessionWithPool);
    // @ts-expect-error - test mock with partial data
    getQuestionVersionsByIdsMock.mockResolvedValue([
      { id: "qv-1", question: { id: "q-1", body: "Q1", marks: new Prisma.Decimal(1), difficulty: "easy", questionType: { code: "mcq", hasOptions: true, hasNumeric: false, supportsMultiple: false }, options: [] } },
      { id: "qv-2", question: { id: "q-2", body: "Q2", marks: new Prisma.Decimal(1), difficulty: "easy", questionType: { code: "mcq", hasOptions: true, hasNumeric: false, supportsMultiple: false }, options: [] } },
      { id: "qv-3", question: { id: "q-3", body: "Q3", marks: new Prisma.Decimal(1), difficulty: "easy", questionType: { code: "mcq", hasOptions: true, hasNumeric: false, supportsMultiple: false }, options: [] } },
    ] as unknown);

    const questions = await getSessionQuestions("session-1", "user-1");

    expect(questions).toHaveLength(3);
    expect(questions.map(q => q.sequence)).toEqual([1, 2, 3]);
    expect(questions.map(q => q.questionNumber)).toEqual([1, 2, 3]);
    expect(questions.map(q => q.questionId)).toEqual(["q-1", "q-2", "q-3"]);
  });
});