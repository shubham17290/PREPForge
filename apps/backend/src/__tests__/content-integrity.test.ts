import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomBytes, pbkdf2Sync } from "node:crypto";
import {
  createQuestionValidated,
  importQuestions,
  publishQuestionValidated,
  updateQuestionValidated,
} from "../core/services/content.service";

const prisma = new PrismaClient();

const DEV_USER_ID = "00000000-0000-4000-8000-0000000000aa";
const DEV_USER_EMAIL = "dev-seed@gate-pyq.local";
const DEV_PUBLISHER_ID = "00000000-0000-4000-8000-0000000000bb";
const DEV_PUBLISHER_EMAIL = "dev-publisher-seed@gate-pyq.local";
const SUBJECT_ID = "00000000-0000-4000-8000-000000000001";
// PHASE 12F.2-S: question ids created by the keyless-policy tests (gate_year 2026
// is below the 2090 fixture line, so cleanup removes them explicitly).
const keylessTestQuestionIds: string[] = [];

function hashPassword(password: string): string {
  const iterations = 310_000;
  const keyLength = 64;
  const salt = randomBytes(16).toString("hex");
  const derived = pbkdf2Sync(password, salt, iterations, keyLength, "sha512");
  return `pbkdf2$${iterations}$${salt}$${derived.toString("hex")}`;
}

async function ensureDevUser() {
  const studentRole = await prisma.role.upsert({
    where: { code: "student" },
    update: {},
    create: { code: "student", name: "Student", isActive: true },
  });
  return prisma.user.upsert({
    where: { id: DEV_USER_ID },
    update: { roleId: studentRole.id, status: "active", deletedAt: null },
    create: {
      id: DEV_USER_ID,
      email: DEV_USER_EMAIL,
      passwordHash: hashPassword("dev-passw0rd-1"),
      roleId: studentRole.id,
      fullName: "Development Seeder",
      status: "active",
    },
  });
}

async function ensureDevSubject() {
  return prisma.subject.upsert({
    where: { id: SUBJECT_ID },
    update: { code: "DEV-CS", name: "Development Computer Science", isActive: true, deletedAt: null },
    create: { id: SUBJECT_ID, code: "DEV-CS", name: "Development Computer Science", sortOrder: 0 },
  });
}

async function ensureDevPublisher() {
  const studentRole = await prisma.role.upsert({
    where: { code: "student" },
    update: {},
    create: { code: "student", name: "Student", isActive: true },
  });
  return prisma.user.upsert({
    where: { id: DEV_PUBLISHER_ID },
    update: { roleId: studentRole.id, status: "active", deletedAt: null },
    create: {
      id: DEV_PUBLISHER_ID,
      email: DEV_PUBLISHER_EMAIL,
      passwordHash: hashPassword("dev-passw0rd-1"),
      roleId: studentRole.id,
      fullName: "Development Publisher",
      status: "active",
    },
  });
}

async function cleanup() {
  // PHASE 12F.2-S: audit rows reference users with onDelete: Restrict — remove
  // service-written audit entries for both test actors BEFORE user deletion.
  await prisma.auditLog.deleteMany({ where: { actorId: { in: [DEV_USER_ID, DEV_PUBLISHER_ID] } } });
  await prisma.attempt.deleteMany({});
  await prisma.bookmark.deleteMany({});
  await prisma.practiceSession.deleteMany({});
  await prisma.questionVersion.deleteMany({});
  await prisma.questionNumericAnswer.deleteMany({});
  await prisma.questionOption.deleteMany({});
  // PHASE 12F.2-S: the keyless-policy questions live at gate_year 2026 (below
  // the 2090 fixture line) and may reference sources at exam_year >= 2090, so
  // questions MUST be swept BEFORE sources or the FK RESTRICT blocks the source
  // sweep. The "[TEST] " prefix catches them; the id list is a safety net for
  // any test body that does not carry the prefix.
  await prisma.question.deleteMany({
    where: { OR: [{ body: { startsWith: "[TEST] " } }, { id: { in: keylessTestQuestionIds } }] },
  });
  await prisma.$queryRaw`DELETE FROM "questions" WHERE "gate_year" >= 2090`;
  await prisma.$queryRaw`DELETE FROM "question_sources" WHERE "exam_year" >= 2090`;
  await prisma.topic.deleteMany({ where: { subjectId: SUBJECT_ID } });
  await prisma.subject.deleteMany({ where: { id: SUBJECT_ID } });
  await prisma.user.deleteMany({ where: { id: { in: [DEV_USER_ID, DEV_PUBLISHER_ID] } }});
  const role = await prisma.role.findUnique({ where: { code: "student" } });
  if (role) {
    const userCount = await prisma.user.count({ where: { roleId: role.id } });
    if (userCount === 0) await prisma.role.delete({ where: { code: "student" } });
  }
}

describe("Question Number and GATE Source Identity", () => {
  beforeAll(async () => {
    await ensureDevUser();
    await ensureDevSubject();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("Question number persists on QuestionSource", async () => {
    const source = await prisma.questionSource.create({
      data: {
        name: "TEST-GATE-CS-2091-P1",
        examYear: 2091,
        paperNumber: "1",
        shift: "Morning",
        questionNumber: 5,
        isActive: true,
      },
    });
    expect(source.questionNumber).toBe(5);
    expect(source.examYear).toBe(2091);
    expect(source.paperNumber).toBe("1");
    expect(source.shift).toBe("Morning");
  });

  it("Different question numbers are accepted for the same year", async () => {
    const source1 = await prisma.questionSource.create({
      data: { name: "TEST-Q1-2091", examYear: 2091, paperNumber: "1", shift: "Morning", questionNumber: 1, isActive: true },
    });
    const source2 = await prisma.questionSource.create({
      data: { name: "TEST-Q2-2091", examYear: 2091, paperNumber: "1", shift: "Morning", questionNumber: 2, isActive: true },
    });
    expect(source1.questionNumber).not.toBe(source2.questionNumber);
  });

  it("Different paper/shift identities are accepted", async () => {
    const source1 = await prisma.questionSource.create({
      data: { name: "TEST-CS-P1-2092", examYear: 2092, paperNumber: "1", shift: "Morning", questionNumber: 1, isActive: true },
    });
    const source2 = await prisma.questionSource.create({
      data: { name: "TEST-CS-P2-2092", examYear: 2092, paperNumber: "2", shift: "Afternoon", questionNumber: 1, isActive: true },
    });
    expect(source1.paperNumber).not.toBe(source2.paperNumber);
    expect(source1.shift).not.toBe(source2.shift);
  });
});

describe("Duplicate Prevention", () => {
  beforeAll(async () => {
    await ensureDevUser();
    await ensureDevSubject();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("Same GATE source identity is rejected", async () => {
    await prisma.questionSource.create({
      data: { name: "TEST-DUP-Q1-2092", examYear: 2092, paperNumber: "1", shift: "Morning", questionNumber: 1, isActive: true },
    });
    await expect(
      prisma.questionSource.create({
        data: { name: "TEST-DUP-Q2-2092", examYear: 2092, paperNumber: "1", shift: "Morning", questionNumber: 1, isActive: true },
      })
    ).rejects.toThrow();
  });

  it("Different question numbers are accepted", async () => {
    const source1 = await prisma.questionSource.create({
      data: { name: "TEST-Q1-2093", examYear: 2093, paperNumber: "1", shift: "Morning", questionNumber: 1, isActive: true },
    });
    const source2 = await prisma.questionSource.create({
      data: { name: "TEST-Q2-2093", examYear: 2093, paperNumber: "1", shift: "Morning", questionNumber: 2, isActive: true },
    });
    expect(source1.id).not.toBe(source2.id);
  });
});

describe("Historical Marks", () => {
  beforeAll(async () => {
    await ensureDevUser();
    await ensureDevSubject();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("Version 1 marks are preserved after Version 2 is published", async () => {
    const question = await prisma.question.create({
      data: {
        questionTypeId: (await prisma.questionType.findUniqueOrThrow({ where: { code: "mcq" } })).id,
        subjectId: SUBJECT_ID,
        body: "[TEST] Historical marks question",
        explanation: "Test explanation",
        marks: 1,
        negativeMarks: 0.33,
        difficulty: "easy",
        status: "published",
        gateYear: 2091,
        createdById: DEV_USER_ID,
        reviewedById: DEV_USER_ID,
        options: { create: [{ body: "Option A", isCorrect: true, sortOrder: 0 }, { body: "Option B", isCorrect: false, sortOrder: 1 }] },
        numericAnswers: { create: [] },
      },
    });

    const version1 = await prisma.questionVersion.create({
      data: {
        questionId: question.id,
        version: 1,
        snapshot: {
          question_id: question.id,
          type_code: "mcq",
          body: question.body,
          explanation: question.explanation,
          marks: 1,
          negative_marks: 0.33,
          difficulty: "easy",
          gate_year: 2091,
          subject_id: SUBJECT_ID,
          topic_id: null,
          question_number: null,
          source_id: null,
          options: [{ id: "opt1", body: "Option A", is_correct: true }, { id: "opt2", body: "Option B", is_correct: false }],
          numeric_answers: [],
        },
        reason: "Initial publish",
        createdById: DEV_USER_ID,
      },
    });

    await prisma.question.update({
      where: { id: question.id },
      data: { version: 2, marks: 2, negativeMarks: 0.66 },
    });

    const version2 = await prisma.questionVersion.create({
      data: {
        questionId: question.id,
        version: 2,
        snapshot: {
          question_id: question.id,
          type_code: "mcq",
          body: question.body,
          explanation: question.explanation,
          marks: 2,
          negative_marks: 0.66,
          difficulty: "easy",
          gate_year: 2091,
          subject_id: SUBJECT_ID,
          topic_id: null,
          question_number: null,
          source_id: null,
          options: [{ id: "opt1", body: "Option A", is_correct: true }, { id: "opt2", body: "Option B", is_correct: false }],
          numeric_answers: [],
        },
        reason: "Updated marks",
        createdById: DEV_USER_ID,
      },
    });

    const v1Snapshot = version1.snapshot as { marks: number; negative_marks: number };
    const v2Snapshot = version2.snapshot as { marks: number; negative_marks: number };

    expect(v1Snapshot.marks).toBe(1);
    expect(v1Snapshot.negative_marks).toBe(0.33);
    expect(v2Snapshot.marks).toBe(2);
    expect(v2Snapshot.negative_marks).toBe(0.66);
  });
});

describe("Keyless PYQ Draft Policy (Phase 12F.2-S)", () => {
  // Remote-DB integration suite: service calls fan out to several DB round-trips.
  beforeAll(async () => {
    await ensureDevUser();
    await ensureDevSubject();
    await ensureDevPublisher();
  }, 120_000);

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  }, 120_000);

  async function expectValidationError(promise: Promise<unknown>, code: string): Promise<void> {
    let caught: unknown;
    try {
      await promise;
    } catch (error) {
      caught = error;
    }
    const err = caught as { status?: number; code?: string; details?: Array<{ code: string }> } | undefined;
    expect(err?.status).toBe(422);
    expect(err?.code).toBe("VALIDATION_ERROR");
    expect(err?.details?.some((d) => d.code === code)).toBe(true);
  }

  const keylessMcq = {
    type_code: "mcq",
    subject_id: SUBJECT_ID,
    body: "[TEST] Keyless MCQ PYQ draft",
    marks: 2,
    gate_year: 2026,
    options: [{ body: "Option A" }, { body: "Option B" }, { body: "Option C" }, { body: "Option D" }],
  };
  const keylessNat = {
    type_code: "nat",
    subject_id: SUBJECT_ID,
    body: "[TEST] Keyless NAT PYQ draft",
    marks: 2,
    gate_year: 2026,
  };

  it("A. keyless MCQ draft is accepted through the internal bulk import path", async () => {
    const report = await importQuestions(DEV_USER_ID, [keylessMcq]);
    expect(report.imported).toBe(1);
    expect(report.failed).toBe(0);
    const created = await prisma.question.findFirstOrThrow({ where: { body: keylessMcq.body }, include: { options: true } });
    keylessTestQuestionIds.push(created.id);
    expect(created.status).toBe("draft");
    expect(created.options).toHaveLength(4);
    expect(created.options.every((option) => option.isCorrect === false)).toBe(true);
  }, 120_000);

  it("B. keyless MSQ draft is accepted through the internal bulk import path", async () => {
    const report = await importQuestions(DEV_USER_ID, [
      { ...keylessMcq, type_code: "msq", body: "[TEST] Keyless MSQ PYQ draft" },
    ]);
    expect(report.imported).toBe(1);
    expect(report.failed).toBe(0);
    const created = await prisma.question.findFirstOrThrow({ where: { body: "[TEST] Keyless MSQ PYQ draft" }, include: { options: true } });
    keylessTestQuestionIds.push(created.id);
    expect(created.status).toBe("draft");
    expect(created.options).toHaveLength(4);
    expect(created.options.every((option) => option.isCorrect === false)).toBe(true);
  }, 120_000);

  it("C. keyless NAT draft is accepted through the internal bulk import path", async () => {
    const report = await importQuestions(DEV_USER_ID, [keylessNat]);
    expect(report.imported).toBe(1);
    expect(report.failed).toBe(0);
    const created = await prisma.question.findFirstOrThrow({ where: { body: keylessNat.body }, include: { numericAnswers: true } });
    keylessTestQuestionIds.push(created.id);
    expect(created.status).toBe("draft");
    expect(created.numericAnswers).toHaveLength(0);
  }, 120_000);

  it("D. normal create/update APIs still reject keyless questions", async () => {
    await expectValidationError(createQuestionValidated(DEV_USER_ID, keylessMcq), "VALIDATION_MCQ_ONE_CORRECT");
    await expectValidationError(createQuestionValidated(DEV_USER_ID, keylessNat), "VALIDATION_NAT_KEY_REQUIRED");

    const keylessMcqId = (await prisma.question.findFirstOrThrow({ where: { body: keylessMcq.body } })).id;
    await expectValidationError(
      updateQuestionValidated(DEV_USER_ID, keylessMcqId, {
        type_code: "mcq",
        subject_id: SUBJECT_ID,
        options: [{ body: "Option A" }, { body: "Option B" }, { body: "Option C" }, { body: "Option D" }],
      }),
      "VALIDATION_MCQ_ONE_CORRECT",
    );
  }, 120_000);

  it("E. keyless draft cannot be published", async () => {
    const keylessMcqId = (await prisma.question.findFirstOrThrow({ where: { body: keylessMcq.body } })).id;
    await expectValidationError(publishQuestionValidated(DEV_PUBLISHER_ID, keylessMcqId), "VALIDATION_KEY_REQUIRED_ON_PUBLISH");
    const still = await prisma.question.findUniqueOrThrow({ where: { id: keylessMcqId } });
    expect(still.status).toBe("draft");
  }, 120_000);

  it("F. keyed draft can be published", async () => {
    const keylessMcqId = (await prisma.question.findFirstOrThrow({ where: { body: keylessMcq.body } })).id;
    // updateQuestion treats an absent source_id in the patch as an explicit
    // disconnect (pre-existing repo semantics), so the keying patch must
    // re-state the source linkage — exactly what the future PYQ keying flow does.
    const source = await prisma.questionSource.upsert({
      where: { name: "TEST-KEYLESS-PUB-SRC" },
      update: {},
      create: { name: "TEST-KEYLESS-PUB-SRC", examYear: 2094, paperNumber: "1", shift: "Morning", questionNumber: 9, isActive: true },
    });
    await updateQuestionValidated(DEV_USER_ID, keylessMcqId, {
      type_code: "mcq",
      subject_id: SUBJECT_ID,
      body: "[TEST] Keyless MCQ PYQ draft",
      marks: 2,
      difficulty: "easy",
      gate_year: 2026,
      source_id: source.id,
      options: [
        { body: "Option A", is_correct: false },
        { body: "Option B", is_correct: true },
        { body: "Option C", is_correct: false },
        { body: "Option D", is_correct: false },
      ],
    });
    const result = await publishQuestionValidated(DEV_PUBLISHER_ID, keylessMcqId);
    expect(result.status).toBe("published");
    expect(result.version).toBe(2);
    const published = await prisma.question.findUniqueOrThrow({ where: { id: keylessMcqId }, include: { source: true } });
    expect(published.status).toBe("published");
    expect(published.source?.examYear).toBe(2094);
    expect(await prisma.questionVersion.count({ where: { questionId: keylessMcqId } })).toBe(1);
  }, 120_000);

  it("G. existing keyed MCQ/MSQ/NAT behavior remains unchanged", async () => {
    const keyedMcq = await createQuestionValidated(DEV_USER_ID, {
      type_code: "mcq",
      subject_id: SUBJECT_ID,
      body: "[TEST] Keyed MCQ control",
      gate_year: 2026,
      options: [{ body: "A", is_correct: false }, { body: "B", is_correct: true }],
    });
    keylessTestQuestionIds.push(keyedMcq.id);

    const keyedNat = await createQuestionValidated(DEV_USER_ID, {
      type_code: "nat",
      subject_id: SUBJECT_ID,
      body: "[TEST] Keyed NAT control",
      gate_year: 2026,
      numeric_answers: [{ numeric_value: 42 }],
    });
    keylessTestQuestionIds.push(keyedNat.id);

    await expectValidationError(
      createQuestionValidated(DEV_USER_ID, {
        type_code: "mcq",
        subject_id: SUBJECT_ID,
        body: "[TEST] Two-correct MCQ control",
        gate_year: 2026,
        options: [{ body: "A", is_correct: true }, { body: "B", is_correct: true }],
      }),
      "VALIDATION_MCQ_ONE_CORRECT",
    );

    const keyedImport = await importQuestions(DEV_USER_ID, [
      {
        type_code: "mcq",
        subject_id: SUBJECT_ID,
        body: "[TEST] Keyed MCQ via import",
        gate_year: 2026,
        options: [{ body: "A", is_correct: false }, { body: "B", is_correct: true }],
      },
    ]);
    expect(keyedImport.imported).toBe(1);
    const keyedImported = await prisma.question.findFirstOrThrow({ where: { body: "[TEST] Keyed MCQ via import" } });
    keylessTestQuestionIds.push(keyedImported.id);
    expect(keyedImported.status).toBe("draft");
  }, 120_000);
});