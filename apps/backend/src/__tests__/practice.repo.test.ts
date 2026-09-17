import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const db = vi.hoisted(() => ({
  practiceSession: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  attempt: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  questionVersion: { findMany: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("../core/repositories/prisma", () => ({ prisma: db }));
import {
  createSession, findSessionByIdAndOwner, updateSessionStatus,
  upsertAnswer, listAnswersForSession, parseSessionConfig,
  getQuestionVersionsByIds, getMaxPossibleMarks,
} from "../core/repositories/practice.repo";

const input = {
  sessionId: "session-1", userId: "user-1", questionId: "question-1",
  questionVersionId: "version-1", sequence: 1,
  selectedAnswers: ["A"], answerState: "answered", markedForReview: true,
};

beforeEach(() => {
  vi.resetAllMocks();
  db.$transaction.mockImplementation(async (callback: (tx: typeof db) => Promise<unknown>) => callback(db));
});

describe("Practice repository compatibility", () => {
  it("creates a session with supplied status and metadata", async () => {
    const config = { mode: "default", filters: { year: 2099 }, question_count: 1, pool: ["question-1"] };
    const frozenPoolSnapshot = { questionVersionIds: ["version-1"] };
    const selectionMetadata = { paperNumber: 1 };
    db.practiceSession.create.mockResolvedValue({ id: "session-1" });
    expect(await createSession({ userId: "user-1", modeId: "mode-1", config,
      timed: false, totalQuestions: 1, status: "pending", frozenPoolSnapshot, selectionMetadata,
    })).toEqual({ id: "session-1" });
    expect(db.practiceSession.create).toHaveBeenCalledWith({ data: {
      userId: "user-1", modeId: "mode-1", config: { ...config, frozenPoolSnapshot, selectionMetadata },
      timed: false, totalQuestions: 1, status: "pending",
    } });
  });

  it("looks up sessions with both id and owner", async () => {
    db.practiceSession.findFirst.mockResolvedValue(null);
    expect(await findSessionByIdAndOwner("session-1", "other-user")).toBeNull();
    expect(db.practiceSession.findFirst).toHaveBeenCalledWith({ where: { id: "session-1", userId: "other-user" } });
  });

  it("updates status without dropping the owner filter", async () => {
    await updateSessionStatus("session-1", "active", "user-1");
    expect(db.practiceSession.update).toHaveBeenCalledWith({
      where: { id: "session-1", userId: "user-1" }, data: { status: "active" },
    });
  });

  it("creates an answer bound to the supplied version in a serializable transaction", async () => {
    db.attempt.findFirst.mockResolvedValue(null);
    db.attempt.create.mockResolvedValue({ id: "answer-1" });
    expect(await upsertAnswer(input)).toEqual({ id: "answer-1" });
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(db.attempt.findFirst).toHaveBeenCalledWith({ where: { sessionId: "session-1", questionVersionId: "version-1" } });
    expect(db.attempt.create).toHaveBeenCalledWith({ data: {
      sessionId: "session-1", userId: "user-1", questionVersionId: "version-1", sequence: 1,
      selectedAnswers: { values: ["A"], __answerState: "answered", __markedForReview: true },
      isCorrect: false, marks: 0, timeTakenSeconds: 0,
    } });
    expect(db.attempt.update).not.toHaveBeenCalled();
  });

  it("updates an existing pair rather than creating a second answer", async () => {
    db.attempt.findFirst.mockResolvedValue({ id: "answer-1", selectedAnswers: {
      values: ["B"], __negativeMarksApplied: 0.5,
    } });
    await upsertAnswer(input);
    expect(db.attempt.create).not.toHaveBeenCalled();
    expect(db.attempt.update).toHaveBeenCalledWith({ where: { id: "answer-1" }, data: {
      sequence: 1, selectedAnswers: { values: ["A"], __negativeMarksApplied: 0.5,
        __answerState: "answered", __markedForReview: true },
    } });
  });

  it("preserves legacy answer arrays on review-only updates", async () => {
    db.attempt.findFirst.mockResolvedValue({ id: "answer-1", selectedAnswers: ["B"] });
    await upsertAnswer({ ...input, selectedAnswers: undefined, markedForReview: false });
    expect(db.attempt.update).toHaveBeenCalledWith(expect.objectContaining({ data: {
      sequence: 1, selectedAnswers: { values: ["B"], __answerState: "answered", __markedForReview: false },
    } }));
  });

  it("propagates transaction conflicts without pretending persistence succeeded", async () => {
    const conflict = new Error("serialization conflict");
    db.$transaction.mockRejectedValue(conflict);
    await expect(upsertAnswer(input)).rejects.toBe(conflict);
    expect(db.attempt.create).not.toHaveBeenCalled();
  });

  it("lists only persisted student fields, ordered by sequence", async () => {
    db.attempt.findMany.mockResolvedValue([]);
    expect(await listAnswersForSession("session-1")).toEqual([]);
    expect(db.attempt.findMany).toHaveBeenCalledWith({ where: { sessionId: "session-1" },
      orderBy: { sequence: "asc" }, select: { questionVersionId: true, sequence: true, selectedAnswers: true, isCorrect: true, marks: true },
    });
  });

  it("parses configuration without discarding selection metadata", () => {
    expect(parseSessionConfig({ selectionMetadata: { shift: 2 } })).toEqual({
      mode: "default", filters: {}, question_count: 0, pool: null, selectionMetadata: { shift: 2 },
    });
    expect(() => parseSessionConfig(null)).toThrow("Invalid session config");
  });

  it("getQuestionVersionsByIds returns all options ordered by sortOrder without filtering correct answers (F1)", async () => {
    db.questionVersion.findMany.mockResolvedValue([]);
    expect(await getQuestionVersionsByIds(["qv-1", "qv-2"])).toEqual([]);
    expect(db.questionVersion.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["qv-1", "qv-2"] } },
      include: {
        question: {
          include: {
            options: { orderBy: { sortOrder: "asc" } },
            numericAnswers: false,
            questionType: true,
          },
        },
      },
    });
  });

  it("getMaxPossibleMarks sums frozen snapshot marks not live Question.marks (F2)", async () => {
    db.questionVersion.findMany.mockResolvedValue([
      { snapshot: { marks: 2 } },
      { snapshot: { marks: 1.5 } },
      { snapshot: { marks: 1 } },
    ] as unknown as never);
    const result = await getMaxPossibleMarks(["qv-1", "qv-2", "qv-3"]);
    expect(result.equals(new Prisma.Decimal(4.5))).toBe(true);
    expect(db.questionVersion.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["qv-1", "qv-2", "qv-3"] } },
      select: { snapshot: true },
    });
  });
});
