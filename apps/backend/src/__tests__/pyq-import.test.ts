// PHASE 12F.2-T1 — PYQ staging → database importer tests.
//
// These tests exercise the importer against SYNTHETIC in-memory artifacts only.
// No real 2022/2023 staging artifact is read or imported, and no PDF is touched.
// Fixtures use a year no other suite uses (current year + 1) and deterministic
// source names prefixed "GATE CS <year> Q", so cleanup can only ever remove rows
// this file created.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomBytes, pbkdf2Sync } from "node:crypto";
import type { StagedQuestion, StagingOutput } from "../ingestion/staging.js";
import {
  PYQ_IMPORT_ERRORS,
  buildPyqSourceName,
  importPyqStagingArtifact,
  planPyqImport,
  verifyPyqImport,
  withDbRetry,
  type PyqImportResult,
} from "../ingestion/pyq-importer.js";
import { createQuestionWithSource } from "../core/repositories/questions.repo.js";
import { validateQuestionInput } from "../core/services/content.service.js";

const prisma = new PrismaClient();

// Kept clear of every other fixture year (2023/2024/2026/2031/2032/2034/209x) and
// within the validator's gate_year window (<= current year + 1).
const EXAM_YEAR = new Date().getUTCFullYear() + 1;
const SOURCE_PREFIX = `GATE CS ${EXAM_YEAR} Q`;

const TEST_SUBJECT_ID = "00000000-0000-4000-8000-0000000000f1";
const TEST_SUBJECT_CODE = "PYQ-IMP-TEST";
const TEST_USER_ID = "00000000-0000-4000-8000-0000000000f2";
const TEST_USER_EMAIL = "pyq-importer-test@gate-pyq.local";

function hashPassword(password: string): string {
  const iterations = 310_000;
  const salt = randomBytes(16).toString("hex");
  const derived = pbkdf2Sync(password, salt, iterations, 64, "sha512");
  return `pbkdf2$${iterations}$${salt}$${derived.toString("hex")}`;
}

async function ensureSubject() {
  return prisma.subject.upsert({
    where: { id: TEST_SUBJECT_ID },
    update: { code: TEST_SUBJECT_CODE, name: "PYQ Importer Test Subject", isActive: true, deletedAt: null },
    create: { id: TEST_SUBJECT_ID, code: TEST_SUBJECT_CODE, name: "PYQ Importer Test Subject", sortOrder: 99 },
  });
}

async function ensureUser() {
  const studentRole = await prisma.role.upsert({
    where: { code: "student" },
    update: {},
    create: { code: "student", name: "Student", isActive: true },
  });
  return prisma.user.upsert({
    where: { id: TEST_USER_ID },
    update: { roleId: studentRole.id, status: "active", deletedAt: null },
    create: {
      id: TEST_USER_ID,
      email: TEST_USER_EMAIL,
      passwordHash: hashPassword("pyq-importer-test-1"),
      roleId: studentRole.id,
      fullName: "PYQ Importer Test",
      status: "active",
    },
  });
}
/** Synthetic staging artifact builder — mirrors the StagingOutput shape exactly. */
function makeArtifact(
  questions: Array<Partial<StagedQuestion>>,
  source: Partial<StagingOutput["source"]> = {},
): StagingOutput {
  return {
    source: {
      file: "SYNTHETIC_TEST_ARTIFACT.pdf",
      exam_year: EXAM_YEAR,
      paper_number: null,
      shift: null,
      ...source,
    },
    questions: questions.map((question, index) => ({
      question_number: question.question_number ?? index + 1,
      type: question.type ?? "mcq",
      body: question.body ?? `[SYNTHETIC] Body for staged question ${question.question_number ?? index + 1}.`,
      options: question.options ?? [],
      answer: question.answer ?? null,
      marks: question.marks === undefined ? 1 : question.marks,
      negative_marks: question.negative_marks === undefined ? null : question.negative_marks,
      warnings: question.warnings ?? [],
    })) as StagedQuestion[],
    generated_at: new Date().toISOString(),
    parser_version: "test",
  };
}

/** Keyless MCQ/MSQ options: bodies present, every is_correct explicitly null. */
function keylessOptions(labels: string[]) {
  return labels.map((label) => ({ label, body: `[SYNTHETIC] Option ${label}`, is_correct: null }));
}

function importerConfig() {
  return { subjectId: TEST_SUBJECT_ID, createdById: TEST_USER_ID };
}

async function loadImported(questionNumber: number) {
  const source = await prisma.questionSource.findFirst({
    where: { name: buildPyqSourceName(EXAM_YEAR, questionNumber) },
  });
  if (!source) {
    return { source: null, question: null, options: [] as Array<{ isCorrect: boolean }>, numericAnswers: [] as Array<{ numericValue: unknown }> };
  }
  const question = await prisma.question.findFirst({ where: { sourceId: source.id } });
  if (!question) {
    return { source, question: null, options: [] as Array<{ isCorrect: boolean }>, numericAnswers: [] as Array<{ numericValue: unknown }> };
  }
  const options = await prisma.questionOption.findMany({
    where: { questionId: question.id },
    orderBy: { sortOrder: "asc" },
  });
  const numericAnswers = await prisma.questionNumericAnswer.findMany({ where: { questionId: question.id } });
  return { source, question, options, numericAnswers };
}

beforeAll(async () => {
  await ensureSubject();
  await ensureUser();
});

afterAll(async () => {
  // Remove ONLY this file's rows: sources by deterministic-name prefix, questions
  // by those sources or by this file's author.
  const sources = await prisma.questionSource.findMany({
    where: { name: { startsWith: SOURCE_PREFIX } },
    select: { id: true },
  });
  const sourceIds = sources.map((source) => source.id);
  const questions = await prisma.question.findMany({
    where: { OR: [{ sourceId: { in: sourceIds } }, { createdById: TEST_USER_ID }] },
    select: { id: true },
  });
  const questionIds = questions.map((question) => question.id);
  await prisma.questionOption.deleteMany({ where: { questionId: { in: questionIds } } });
  await prisma.questionNumericAnswer.deleteMany({ where: { questionId: { in: questionIds } } });
  await prisma.questionVersion.deleteMany({ where: { questionId: { in: questionIds } } });
  await prisma.question.deleteMany({ where: { id: { in: questionIds } } });
  await prisma.questionSource.deleteMany({ where: { id: { in: sourceIds } } });
  await prisma.auditLog.deleteMany({ where: { actorId: TEST_USER_ID } });
  await prisma.user.deleteMany({ where: { id: TEST_USER_ID } });
  await prisma.subject.deleteMany({ where: { id: TEST_SUBJECT_ID } });
    await prisma.$disconnect();
});

// ─── Phase 12F.2-T1: PYQ staging → DB importer (synthetic artifacts only) ─────
// No real 2022/2023 staging file is read, no PDF is processed, no importer is
// invoked from any route. Every test below uses in-memory StagingOutput objects.

describe("PYQ importer — keyless drafts through the approved policy path", () => {
  it("imports a keyless MCQ as a DRAFT with no invented correct flag", async () => {
    const result = await importPyqStagingArtifact({
      artifact: makeArtifact([{ question_number: 51, type: "mcq", options: keylessOptions(["A", "B", "C", "D"]) }]),
      ...importerConfig(),
    });
    expect(result.imported).toBe(1);
    const loaded = await loadImported(51);
    expect(loaded.question?.status).toBe("draft");
    expect(loaded.options).toHaveLength(4);
    // Every staged is_correct was null → every flag stays false (never invented).
    expect(loaded.options.every((option) => option.isCorrect === false)).toBe(true);
  });

  it("imports a keyless MSQ with all-false options", async () => {
    const result = await importPyqStagingArtifact({
      artifact: makeArtifact([{ question_number: 52, type: "msq", options: keylessOptions(["A", "B", "C", "D"]) }]),
      ...importerConfig(),
    });
    expect(result.imported).toBe(1);
    const loaded = await loadImported(52);
    expect(loaded.options).toHaveLength(4);
    expect(loaded.options.some((option) => option.isCorrect)).toBe(false);
  });

  it("imports a keyless NAT with zero options and zero numeric answers", async () => {
    const result = await importPyqStagingArtifact({
      artifact: makeArtifact([{ question_number: 53, type: "nat", options: [] }]),
      ...importerConfig(),
    });
    expect(result.imported).toBe(1);
    const loaded = await loadImported(53);
    expect(loaded.options).toHaveLength(0);
    expect(loaded.numericAnswers).toHaveLength(0);
  });

  it("normal create validation (default policy) still rejects keyless drafts", async () => {
    const keylessMcqPayload = {
      type_code: "mcq",
      subject_id: TEST_SUBJECT_ID,
      body: "[SYNTHETIC] Body for staged question D.",
      marks: 1,
      gate_year: EXAM_YEAR,
      question_number: 9001,
      difficulty: "medium",
      options: keylessOptions(["A", "B"]),
    };
        // The import path (allowKeylessDraft) accepts it; the default create gate does not.
    await expect(validateQuestionInput(keylessMcqPayload, "create")).rejects.toThrow("VALIDATION_MCQ_ONE_CORRECT");
  });
});

describe("PYQ importer — pre-flight classification", () => {
  it("skips an MCQ with insufficient options (a staged Q5-class) but imports the rest", async () => {
    const artifact = makeArtifact([
      { question_number: 54, type: "mcq", options: keylessOptions(["A"]) },
      { question_number: 55, type: "mcq", options: keylessOptions(["A", "B"]) },
    ]);
    const result = await importPyqStagingArtifact({ artifact, ...importerConfig() });
    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.skippedQuestions[0].questionNumber).toBe(54);
    expect(result.skippedQuestions[0].reason).toBe("VALIDATION_INVALID_OPTIONS");
    expect((await prisma.questionSource.findMany({ where: { name: buildPyqSourceName(EXAM_YEAR, 54) } })).length).toBe(0);
    const good = await loadImported(55);
    expect(good.question).not.toBeNull();
  });
});


describe("PYQ importer — identity, null-preservation, and atomicity", () => {
  it("uses the deterministic source name \"GATE CS <year> Q<n>\" (null paper/shift)", async () => {
    const result = await importPyqStagingArtifact({
      artifact: makeArtifact([{ question_number: 56, type: "mcq", options: keylessOptions(["A", "B"]) }]),
      ...importerConfig(),
    });
    const imported = result.importedQuestions[0];
    expect(imported.sourceName).toBe(buildPyqSourceName(EXAM_YEAR, 56));
    expect(imported.sourceName).toBe(`GATE CS ${EXAM_YEAR} Q56`);
    expect(result.paperNumber).toBeNull();
    expect(result.shift).toBeNull();
    const source = await prisma.questionSource.findUnique({ where: { id: imported.sourceId } });
    expect(source?.name).toBe(`GATE CS ${EXAM_YEAR} Q56`);
    expect(source?.examYear).toBe(EXAM_YEAR);
    expect(source?.paperNumber).toBeNull();
    expect(source?.shift).toBeNull();
    expect(source?.questionNumber).toBe(56);
  });

  it("preserves staged null negativeMarks (never invents 0)", async () => {
    const result = await importPyqStagingArtifact({
      artifact: makeArtifact([{ question_number: 57, type: "mcq", options: keylessOptions(["A", "B"]), negative_marks: null }]),
      ...importerConfig(),
    });
    const question = await prisma.question.findUnique({
      where: { id: result.importedQuestions[0].questionId },
      select: { negativeMarks: true },
    });
    expect(question?.negativeMarks).toBeNull();
  });

  it("carries staged paper/shift + numeric negative_marks and a numeric answer through unchanged", async () => {
    const result = await importPyqStagingArtifact({
      artifact: makeArtifact(
        [{ question_number: 58, type: "nat", options: [], marks: 2, negative_marks: 0.33, answer: { type: "numeric", value: 12, raw_text: "12" } }],
        { paper_number: "1", shift: "Morning" },
      ),
      ...importerConfig(),
    });
    expect(result.paperNumber).toBe("1");
    expect(result.shift).toBe("Morning");
    expect(result.imported).toBe(1);
    const loaded = await loadImported(58);
    expect(loaded.source?.paperNumber).toBe("1");
    expect(loaded.source?.shift).toBe("Morning");
    expect(Number(loaded.question?.marks)).toBe(2);
    expect(Number(loaded.question?.negativeMarks)).toBeCloseTo(0.33, 5);
    expect(loaded.options).toHaveLength(0);
    expect(loaded.numericAnswers).toHaveLength(1);
    expect(Number(loaded.numericAnswers[0].numericValue)).toBe(12);
  });

  it("is idempotent: re-running the same artifact creates no duplicate rows", async () => {
    const artifact = makeArtifact([
      { question_number: 69, type: "mcq", options: keylessOptions(["A", "B"]) },
      { question_number: 70, type: "nat", options: [] },
    ]);
    const first = await importPyqStagingArtifact({ artifact, ...importerConfig() });
    expect(first.imported).toBe(2);
    expect(first.alreadyExisting).toBe(0);
    const firstIds = first.importedQuestions.map((row) => row.questionId).sort();
    const second = await importPyqStagingArtifact({ artifact, ...importerConfig() });
    expect(second.imported).toBe(0);
    expect(second.alreadyExisting).toBe(2);
    expect(second.failed).toBe(0);
    expect(second.existingQuestions.map((row) => row.questionId).sort()).toEqual(firstIds);
      });

  it("resolves an existing Subject by code and User by email", async () => {
    const result = await importPyqStagingArtifact({
      artifact: makeArtifact([{ question_number: 71, type: "mcq", options: keylessOptions(["A", "B"]) }]),
      subjectCode: TEST_SUBJECT_CODE,
      createdByEmail: TEST_USER_EMAIL,
    });
    expect(result.imported).toBe(1);
    const loaded = await loadImported(71);
    expect(loaded.question?.subjectId).toBe(TEST_SUBJECT_ID);
    expect(loaded.question?.createdById).toBe(TEST_USER_ID);
  });

  it("fails pre-flight without writing when the configured Subject does not exist", async () => {
    const artifact = makeArtifact([{ question_number: 72, type: "mcq", options: keylessOptions(["A", "B"]) }]);
    await expect(
      importPyqStagingArtifact({ artifact, subjectId: "00000000-0000-4000-8000-0000000000fe", difficulty: "medium" }),
    ).rejects.toThrow(PYQ_IMPORT_ERRORS.SUBJECT_UNRESOLVED);
    expect((await prisma.questionSource.findMany({ where: { name: buildPyqSourceName(EXAM_YEAR, 72) } })).length).toBe(0);
  });

  it("fails pre-flight without writing when the configured importer User does not exist", async () => {
    const artifact = makeArtifact([{ question_number: 73, type: "mcq", options: keylessOptions(["A", "B"]) }]);
    await expect(
      importPyqStagingArtifact({ artifact, subjectId: TEST_SUBJECT_ID, createdById: "00000000-0000-4000-8000-0000000000fd" }),
    ).rejects.toThrow(PYQ_IMPORT_ERRORS.USER_UNRESOLVED);
    expect((await prisma.questionSource.findMany({ where: { name: buildPyqSourceName(EXAM_YEAR, 73) } })).length).toBe(0);
  });

  it("rejects an unusable config (no artifact) before any write", async () => {
    await expect(importPyqStagingArtifact({ ...importerConfig() })).rejects.toThrow(PYQ_IMPORT_ERRORS.CONFIG_INVALID);
    expect((await prisma.questionSource.findMany({ where: { name: { startsWith: SOURCE_PREFIX } } })).length).toBe(0);
  });

  it("is atomic per question: an FK failure rolls back the QuestionSource write", async () => {
    const artifact = makeArtifact([{ question_number: 74, type: "mcq", options: keylessOptions(["A", "B"]) }]);
    const plan = await planPyqImport(artifact, { subjectId: TEST_SUBJECT_ID, difficulty: "medium" });
    expect(plan.importable).toHaveLength(1);
    // A bogus QuestionType id violates the FK INSIDE createQuestionWithSource's
    // transaction (after the QuestionSource row is written), so the source must
    // roll back with it and no orphan QuestionSource/question may survive.
    await expect(
      createQuestionWithSource(
        { name: buildPyqSourceName(EXAM_YEAR, 74), examYear: EXAM_YEAR, paperNumber: null, shift: null, questionNumber: 74 },
        plan.importable[0].write,
        "00000000-0000-4000-8000-0000000000fc",
        TEST_USER_ID,
      ),
    ).rejects.toThrow();
    expect(await prisma.questionSource.count({ where: { name: buildPyqSourceName(EXAM_YEAR, 74) } })).toBe(0);
    const orphans = await prisma.question.findMany({
      where: { createdById: TEST_USER_ID, gateYear: EXAM_YEAR, source: { questionNumber: 74 } },
      select: { id: true },
    });
    expect(orphans).toHaveLength(0);
  });
});

// ─── Phase 12F.2-T3: reliability hardening (retry / verification / audit) ─────

/** Fabricated-result builder for pure verification tests (no writes). */
function makeResult(overrides: Partial<PyqImportResult> = {}): PyqImportResult {
  return {
    artifactFile: null,
    examYear: EXAM_YEAR,
    paperNumber: null,
    shift: null,
    numbering: { staged: [], missing: [], duplicates: [] },
    totalStaged: 0,
    importable: 0,
    imported: 0,
    alreadyExisting: 0,
    skipped: 0,
    failed: 0,
    importedQuestions: [],
    existingQuestions: [],
    skippedQuestions: [],
    failedQuestions: [],
    verification: null,
    ...overrides,
  };
}

describe("PYQ importer — reliability hardening (Phase 12F.2-T3)", () => {
  it("A. retries a transient DB failure and succeeds", async () => {
    let calls = 0;
    const value = await withDbRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw new Error("Can't reach database server at localhost:5432");
        return "ok";
      },
      { backoffMs: 1 },
    );
    expect(value).toBe("ok");
    expect(calls).toBe(3);
  });

  it("B. stops after the configured maximum attempts and preserves the original error", async () => {
    let calls = 0;
    const original = new Error("Server has closed the connection");
    await expect(
      withDbRetry(
        async () => {
          calls += 1;
          throw original;
        },
        { maxAttempts: 4, backoffMs: 1 },
      ),
    ).rejects.toBe(original);
    expect(calls).toBe(4);
  });

  it("C. does NOT retry non-transient validation errors", async () => {
    let calls = 0;
    await expect(
      withDbRetry(
        async () => {
          calls += 1;
          throw new Error("VALIDATION_MCQ_ONE_CORRECT: keyless MCQ rejected outside the PYQ policy");
        },
        { maxAttempts: 4, backoffMs: 1 },
      ),
    ).rejects.toThrow("VALIDATION_MCQ_ONE_CORRECT");
    expect(calls).toBe(1);
  });

  it("D. a successful import reports verification.success = true", async () => {
    const result = await importPyqStagingArtifact({
      artifact: makeArtifact([
        { question_number: 81, type: "mcq", options: keylessOptions(["A", "B"]) },
        { question_number: 82, type: "nat", options: [] },
      ]),
      ...importerConfig(),
    });
    expect(result.imported).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.verification.success).toBe(true);
    expect(result.verification.issues).toHaveLength(0);
    expect(result.verification.checkedImported).toBe(2);
    expect(result.verification.countInvariant).toEqual({
      expectedImportable: 2,
      importedPlusExisting: 2,
      ok: true,
    });
  });

  it("E. verification detects missing and incorrect persisted data", async () => {
    // (1) fabricated result pointing at rows that do not exist:
    const missingCheck = await verifyPyqImport(
      makeResult({
        imported: 1,
        importedQuestions: [
          {
            questionNumber: 83,
            sourceName: buildPyqSourceName(EXAM_YEAR, 83),
            sourceId: "00000000-0000-4000-8000-000000000dea",
            questionId: "00000000-0000-4000-8000-000000000dbe",
            type: "mcq",
            expectedOptionCount: 4,
            expectedNumericAnswerCount: 0,
          },
        ],
      }),
      { expectedImportableCount: 1 },
    );
    expect(missingCheck.success).toBe(false);
    expect(missingCheck.issues.some((issue) => issue.check === "source_missing")).toBe(true);

    // (2) real persisted question, wrong expectation (2 staged options vs 4 claimed):
    const loaded81 = await loadImported(81);
    if (!loaded81.source || !loaded81.question) throw new Error("Q81 was not imported by the previous test");
    const mismatch = await verifyPyqImport(
      makeResult({
        imported: 1,
        importedQuestions: [
          {
            questionNumber: 81,
            sourceName: buildPyqSourceName(EXAM_YEAR, 81),
            sourceId: loaded81.source.id,
            questionId: loaded81.question.id,
            type: "mcq",
            expectedOptionCount: 4,
            expectedNumericAnswerCount: 0,
          },
        ],
      }),
      { expectedImportableCount: 1 },
    );
    expect(mismatch.success).toBe(false);
    expect(mismatch.issues.some((issue) => issue.check === "option_count_mismatch")).toBe(true);

    // (3) paper-level count invariant violation:
    const badCount = await verifyPyqImport(makeResult({ imported: 1, alreadyExisting: 1 }), {
      expectedImportableCount: 3,
    });
    expect(badCount.countInvariant.ok).toBe(false);
    expect(badCount.issues.some((issue) => issue.check === "count_invariant")).toBe(true);
  });

  it("F. each imported question produces one PYQ audit entry with full identity", async () => {
    const loaded81 = await loadImported(81);
    if (!loaded81.question) throw new Error("Q81 was not imported by the previous test");
    const audit = await prisma.auditLog.findFirst({
      where: { action: "question.pyq_import", entityType: "questions", entityId: loaded81.question.id },
    });
    expect(audit).not.toBeNull();
    expect(audit?.actorId).toBe(TEST_USER_ID);
    const after = audit?.after as Record<string, unknown>;
    expect(after.import).toBe("PYQ");
    expect(after.examYear).toBe(EXAM_YEAR);
    expect(after.questionNumber).toBe(81);
    expect(after.sourceName).toBe(buildPyqSourceName(EXAM_YEAR, 81));
    expect(after.questionSourceId).toBe(loaded81.source?.id);
  });

  it("G. idempotent rerun creates no duplicate rows and no duplicate audit entries", async () => {
    const artifact = makeArtifact([
      { question_number: 81, type: "mcq", options: keylessOptions(["A", "B"]) },
      { question_number: 82, type: "nat", options: [] },
    ]);
    const second = await importPyqStagingArtifact({ artifact, ...importerConfig() });
    expect(second.imported).toBe(0);
    expect(second.alreadyExisting).toBe(2);
    expect(second.failed).toBe(0);
    expect(second.verification.success).toBe(true);
    expect(second.verification.countInvariant).toEqual({
      expectedImportable: 2,
      importedPlusExisting: 2,
      ok: true,
    });
    expect(await prisma.questionSource.count({ where: { name: buildPyqSourceName(EXAM_YEAR, 81) } })).toBe(1);
    const source81 = await prisma.questionSource.findFirst({ where: { name: buildPyqSourceName(EXAM_YEAR, 81) } });
    if (!source81) throw new Error("Q81 source disappeared");
    expect(await prisma.question.count({ where: { sourceId: source81.id } })).toBe(1);
    const loaded81 = await loadImported(81);
    if (!loaded81.question) throw new Error("Q81 was not imported");
    expect(
      await prisma.auditLog.count({ where: { action: "question.pyq_import", entityType: "questions", entityId: loaded81.question.id } }),
    ).toBe(1);
  });
});

