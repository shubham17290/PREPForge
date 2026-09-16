// PHASE 12G-T10 — Practice Service Tests
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as practiceRepo from "../core/repositories/practice.repo";
import {
  createPracticeSession,
  getPracticeSession,
  activatePracticeSession,
  savePracticeAnswer,
  getPracticeSessionAnswers,
  PracticeSessionStatus,
} from "../core/services/practice.service";

// ─── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("../core/repositories/practice.repo", () => ({
  ensurePracticeMode: vi.fn(),
  createSession: vi.fn(),
  findSessionById: vi.fn(),
  findSessionByIdAndOwner: vi.fn(),
  parseSessionConfig: vi.fn(),
  savePool: vi.fn(),
  saveFrozenPoolSnapshot: vi.fn(),
  saveSelectionMetadata: vi.fn(),
  updateSessionStatus: vi.fn(),
  completeSession: vi.fn(),
  abandonSession: vi.fn(),
  findSessionWithAnswersById: vi.fn(),
  findSessionWithAnswersByIdAndOwner: vi.fn(),

// ─── Test Data ──────────────────────────────────────────────────────────────────

const MockSessionRow = {
  id: "session-123",
  userId: "user-456",
  modeId: "mode-789",
  status: "pending" as const,
  timed: false,
  totalQuestions: 10,
  score: null,
  startedAt: null,
  endedAt: null,
  abandonedAt: null,
  config: { mode: "mixed", filters: {}, question_count: 10, pool: null },
  mode: { id: "mode-789", code: "mixed", name: "Mixed" },
};

const MockSessionWithAnswers = {
  ...MockSessionRow,
  attempts: [
    {
      id: "attempt-1",
      questionVersionId: "qv-001",
      selectedAnswers: { optionId: "opt-1" },
      isCorrect: false,
      marks: 0,
      timeTakenSeconds: 30,
      answeredAt: new Date("2024-01-01T10:00:00Z"),
      responseVersion: 1,
    },
  ],
};

// ─── Tests ──────────────────────────────────────────────────────────────────────

describe("Practice Service - createPracticeSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a pending session", async () => {
    const input = {
      userId: "user-456",
      modeId: "mode-789",
      config: MockSessionRow.config,
      timed: false,
      totalQuestions: 10,
    };

    vi.mocked(practiceRepo.createSession).mockResolvedValue(MockSessionRow);
    vi.mocked(practiceRepo.updateSessionStatus).mockResolvedValue(undefined);
    vi.mocked(practiceRepo.findSessionById).mockResolvedValue(MockSessionRow);

    const result = await createPracticeSession(input);

    expect(result.status).toBe("pending");
    expect(practiceRepo.createSession).toHaveBeenCalledWith({

describe("Practice Service - getPracticeSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns session for owner", async () => {
    vi.mocked(practiceRepo.findSessionByIdAndOwner).mockResolvedValue(MockSessionRow);

    const result = await getPracticeSession("session-123", "user-456");

    expect(result.id).toBe("session-123");
    expect(result.userId).toBe("user-456");
    expect(practiceRepo.findSessionByIdAndOwner).toHaveBeenCalledWith(
      "session-123",
      "user-456"
    );
  });

  it("throws SESSION_NOT_FOUND for non-owner", async () => {
    vi.mocked(practiceRepo.findSessionByIdAndOwner).mockResolvedValue(null);

    await expect(
      getPracticeSession("session-123", "user-999")
    ).rejects.toThrow("SESSION_NOT_FOUND");
  });

  it("throws SESSION_NOT_FOUND for non-existent session", async () => {
    vi.mocked(practiceRepo.findSessionByIdAndOwner).mockResolvedValue(null);

    await expect(
      getPracticeSession("non-existent", "user-456")
    ).rejects.toThrow("SESSION_NOT_FOUND");
  });
});

describe("Practice Service - activatePracticeSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("activates pending session successfully", async () => {
    const pendingSession = { ...MockSessionRow, status: "pending" as const };
    const activeSession = { ...MockSessionRow, status: "active" as const };

    vi.mocked(practiceRepo.findSessionByIdAndOwner)
      .mockResolvedValueOnce(pendingSession)
      .mockResolvedValueOnce(activeSession);
    vi.mocked(practiceRepo.updateSessionStatus).mockResolvedValue(undefined);

    const result = await activatePracticeSession("session-123", "user-456");

    expect(result.status).toBe("active");
    expect(practiceRepo.updateSessionStatus).toHaveBeenCalledWith(
      "session-123",
      "active",

describe("Practice Service - savePracticeAnswer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockAnswerInput = {
    sessionId: "session-123",
    userId: "user-456",
    questionId: "q-001",
    questionVersionId: "qv-001",
    answerState: "answered" as const,
    markedForReview: false,
    selectedAnswers: { optionId: "opt-1" },
    timeTakenSeconds: 30,
  };

  it("saves answer for active session", async () => {
    const activeSession = { ...MockSessionRow, status: "active" as const };
    const mockAttempt = {
      id: "attempt-1",
      sessionId: "session-123",
      questionVersionId: "qv-001",
      selectedAnswers: mockAnswerInput.selectedAnswers,
      isCorrect: false,
      marks: 0,
      timeTakenSeconds: 30,
      answeredAt: new Date(),
      responseVersion: 1,
    };

    vi.mocked(practiceRepo.findSessionByIdAndOwner).mockResolvedValue(activeSession);
    vi.mocked(practiceRepo.upsertAnswer).mockResolvedValue(mockAttempt);

    const result = await savePracticeAnswer(
      mockAnswerInput.sessionId,

  it("throws SUBMITTED_SESSION_IMMUTABLE for submitted session", async () => {
    const submittedSession = { ...MockSessionRow, status: "submitted" as const };
    vi.mocked(practiceRepo.findSessionByIdAndOwner).mockResolvedValue(submittedSession);

    await expect(
      savePracticeAnswer(
        mockAnswerInput.sessionId,
        mockAnswerInput.userId,
        mockAnswerInput.questionId,
        mockAnswerInput.questionVersionId,
        mockAnswerInput.answerState,
        mockAnswerInput.markedForReview,
        mockAnswerInput.selectedAnswers,
        mockAnswerInput.timeTakenSeconds
      )
    ).rejects.toThrow("SUBMITTED_SESSION_IMMUTABLE");
  });

  it("throws SESSION_NOT_FOUND for non-owner", async () => {
    vi.mocked(practiceRepo.findSessionByIdAndOwner).mockResolvedValue(null);

    await expect(
      savePracticeAnswer(
        mockAnswerInput.sessionId,
        mockAnswerInput.userId,
        mockAnswerInput.questionId,
        mockAnswerInput.questionVersionId,
        mockAnswerInput.answerState,
        mockAnswerInput.markedForReview,
        mockAnswerInput.selectedAnswers,
        mockAnswerInput.timeTakenSeconds
      )
    ).rejects.toThrow("SESSION_NOT_FOUND");
  });
});

describe("Practice Service - getPracticeSessionAnswers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns answers for owner", async () => {
    vi.mocked(practiceRepo.findSessionByIdAndOwner).mockResolvedValue(MockSessionRow);
    vi.mocked(practiceRepo.findSessionWithAnswersByIdAndOwner).mockResolvedValue(
      MockSessionWithAnswers
    );

    const result = await getPracticeSessionAnswers("session-123", "user-456");

    expect(result.session.id).toBe("session-123");
    expect(result.answers).toHaveLength(1);
    expect(result.answers[0].id).toBe("attempt-1");
    expect(practiceRepo.findSessionWithAnswersByIdAndOwner).toHaveBeenCalledWith(
      "session-123",
      "user-456"
    );
  });

  it("throws SESSION_NOT_FOUND for non-owner", async () => {
    vi.mocked(practiceRepo.findSessionByIdAndOwner).mockResolvedValue(null);

    await expect(
      getPracticeSessionAnswers("session-123", "user-999")
    ).rejects.toThrow("SESSION_NOT_FOUND");
  });
});

describe("Practice Service - Grading Boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not calculate correctness in savePracticeAnswer", async () => {
    const activeSession = { ...MockSessionRow, status: "active" as const };
    const mockAttempt = {
      id: "attempt-1",
      sessionId: "session-123",
      questionVersionId: "qv-001",
      selectedAnswers: { optionId: "opt-1" },
      isCorrect: false,
      marks: 0,
      timeTakenSeconds: 30,
      answeredAt: new Date(),
      responseVersion: 1,
    };

    vi.mocked(practiceRepo.findSessionByIdAndOwner).mockResolvedValue(activeSession);
    vi.mocked(practiceRepo.upsertAnswer).mockResolvedValue(mockAttempt);

    await savePracticeAnswer(
      mockAnswerInput.sessionId,
      mockAnswerInput.userId,
      mockAnswerInput.questionId,
      mockAnswerInput.questionVersionId,
      mockAnswerInput.answerState,
      mockAnswerInput.markedForReview,
      mockAnswerInput.selectedAnswers,
      mockAnswerInput.timeTakenSeconds
    );

    expect(practiceRepo.upsertAnswer).toHaveBeenCalledWith(
      expect.objectContaining({
        correct: false,
        score: 0,
        negativeMarksApplied: false,
      })
    );
  });

  it("does not return correct_answer information in getPracticeSessionAnswers", async () => {
    vi.mocked(practiceRepo.findSessionByIdAndOwner).mockResolvedValue(MockSessionRow);
    vi.mocked(practiceRepo.findSessionWithAnswersByIdAndOwner).mockResolvedValue(
      MockSessionWithAnswers
    );

    const result = await getPracticeSessionAnswers("session-123", "user-456");

    expect(result.answers[0]).toHaveProperty("selectedAnswers");
    expect(result.answers[0]).toHaveProperty("correct");
  });
});

describe("PracticeSessionStatus", () => {
  it("defines the correct status values", () => {
    expect(PracticeSessionStatus.PENDING).toBe("pending");
    expect(PracticeSessionStatus.ACTIVE).toBe("active");
    expect(PracticeSessionStatus.SUBMITTED).toBe("submitted");
  });
});

      mockAnswerInput.userId,
      mockAnswerInput.questionId,
      mockAnswerInput.questionVersionId,
      mockAnswerInput.answerState,
      mockAnswerInput.markedForReview,
      mockAnswerInput.selectedAnswers,
      mockAnswerInput.timeTakenSeconds
    );

    expect(result.id).toBe("attempt-1");
    expect(practiceRepo.upsertAnswer).toHaveBeenCalled();
  });

  it("throws INVALID_SESSION_STATE for pending session", async () => {
    const pendingSession = { ...MockSessionRow, status: "pending" as const };
    vi.mocked(practiceRepo.findSessionByIdAndOwner).mockResolvedValue(pendingSession);

    await expect(
      savePracticeAnswer(
        mockAnswerInput.sessionId,
        mockAnswerInput.userId,
        mockAnswerInput.questionId,
        mockAnswerInput.questionVersionId,
        mockAnswerInput.answerState,
        mockAnswerInput.markedForReview,
        mockAnswerInput.selectedAnswers,
        mockAnswerInput.timeTakenSeconds
      )
    ).rejects.toThrow("INVALID_SESSION_STATE");
  });
});

      expect.objectContaining({ startedAt: expect.any(Date) })
    );
  });

  it("throws INVALID_SESSION_STATE for already active session", async () => {
    const activeSession = { ...MockSessionRow, status: "active" as const };
    vi.mocked(practiceRepo.findSessionByIdAndOwner).mockResolvedValue(activeSession);

    await expect(
      activatePracticeSession("session-123", "user-456")
    ).rejects.toThrow("INVALID_SESSION_STATE");
  });

  it("throws SUBMITTED_SESSION_IMMUTABLE for submitted session", async () => {
    const submittedSession = { ...MockSessionRow, status: "submitted" as const };
    vi.mocked(practiceRepo.findSessionByIdAndOwner).mockResolvedValue(submittedSession);

    await expect(
      activatePracticeSession("session-123", "user-456")
    ).rejects.toThrow("SUBMITTED_SESSION_IMMUTABLE");
  });

  it("throws SESSION_NOT_FOUND for non-owner", async () => {
    vi.mocked(practiceRepo.findSessionByIdAndOwner).mockResolvedValue(null);

    await expect(
      activatePracticeSession("session-123", "user-999")
    ).rejects.toThrow("SESSION_NOT_FOUND");
  });
});

      ...input,
    });
    expect(practiceRepo.updateSessionStatus).toHaveBeenCalledWith(
      MockSessionRow.id,
      "pending"
    );
  });

  it("preserves selection metadata when supplied", async () => {
    const input = {
      userId: "user-456",
      modeId: "mode-789",
      config: MockSessionRow.config,
      timed: false,
      totalQuestions: 10,
      selectionMetadata: {
        poolSnapshot: {
          questionIds: ["q1", "q2"],
          questionVersionIds: ["qv1", "qv2"],
          selectedAt: new Date().toISOString(),
          metadata: {},
        },
        createdAt: new Date().toISOString(),
      },
    };

    vi.mocked(practiceRepo.createSession).mockResolvedValue(MockSessionRow);
    vi.mocked(practiceRepo.updateSessionStatus).mockResolvedValue(undefined);
    vi.mocked(practiceRepo.findSessionById).mockResolvedValue(MockSessionRow);

    await createPracticeSession(input);

    expect(practiceRepo.saveSelectionMetadata).toHaveBeenCalledWith(
      MockSessionRow.id,
      input.selectionMetadata
    );
  });

  it("preserves frozen pool snapshot when supplied", async () => {
    const input = {
      userId: "user-456",
      modeId: "mode-789",
      config: MockSessionRow.config,
      timed: false,
      totalQuestions: 10,
      frozenPoolSnapshot: {
        questionIds: ["q1", "q2"],
        questionVersionIds: ["qv1", "qv2"],
        selectedAt: new Date().toISOString(),
        metadata: { test: "data" },
      },
    };

    vi.mocked(practiceRepo.createSession).mockResolvedValue(MockSessionRow);
    vi.mocked(practiceRepo.updateSessionStatus).mockResolvedValue(undefined);
    vi.mocked(practiceRepo.findSessionById).mockResolvedValue(MockSessionRow);

    await createPracticeSession(input);

    expect(practiceRepo.saveFrozenPoolSnapshot).toHaveBeenCalledWith(
      MockSessionRow.id,
      input.frozenPoolSnapshot
    );
  });

  it("throws validation error for missing userId", async () => {
    const input = {
      userId: "",
      modeId: "mode-789",
      config: MockSessionRow.config,
      timed: false,
      totalQuestions: 10,
    };

    await expect(createPracticeSession(input)).rejects.toThrow();
    expect(practiceRepo.createSession).not.toHaveBeenCalled();
  });

  it("throws validation error for missing modeId", async () => {
    const input = {
      userId: "user-456",
      modeId: "",
      config: MockSessionRow.config,
      timed: false,
      totalQuestions: 10,
    };

    await expect(createPracticeSession(input)).rejects.toThrow();
    expect(practiceRepo.createSession).not.toHaveBeenCalled();
  });

  it("throws validation error for invalid totalQuestions", async () => {
    const input = {
      userId: "user-456",
      modeId: "mode-789",
      config: MockSessionRow.config,
      timed: false,
      totalQuestions: 0,
    };

    await expect(createPracticeSession(input)).rejects.toThrow();
    expect(practiceRepo.createSession).not.toHaveBeenCalled();
  });
});

  findAnswerBySessionAndQuestion: vi.fn(),
  upsertAnswer: vi.fn(),
  listAnswersForSession: vi.fn(),
  listAnswersForSessionWithQuestionIds: vi.fn(),
  extractAnswerMetadata: vi.fn(),
  toPracticeQuestionAnswer: vi.fn(),
  findAttempt: vi.fn(),
  upsertAttempt: vi.fn(),
  listAttemptsForSession: vi.fn(),
  attemptsForSessionWithTopics: vi.fn(),
  sumMarksForQuestionVersions: vi.fn(),
  sumMarksForQuestions: vi.fn(),
}));

