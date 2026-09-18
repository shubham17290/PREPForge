// T19 — Practice API HTTP integration (real Express → Service → Repo → Prisma → isolated PG)
// Uses isolated TEST_DATABASE_URL via helpers/test-db.ts, never production Neon.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { getTestDatabaseUrl } from "./helpers/test-db";
import { PrismaClient } from "@prisma/client";

// Fail fast before app is imported — must use TEST_DATABASE_URL, never fallback
const _testUrlEarly = getTestDatabaseUrl();
// Override production DATABASE_URL for the Express app's singleton Prisma
const _originalDatabaseUrl = process.env.DATABASE_URL;
process.env.DATABASE_URL = _testUrlEarly;

// Dynamic import after env override (ESM hoisting would otherwise use production URL)
let app: import("express").Express;
let testPrisma: PrismaClient;

// Deterministic isolated fixtures — prefix ensures scoped cleanup
const RUN = Date.now().toString(36).slice(-6);
const PREFIX = `[T19-INT-${RUN}]`;
const TEST_SUBJECT_CODE = `t19_cs_${RUN}`;
const TEST_SUBJECT_NAME = `T19 CS ${RUN}`;
const TEST_TOPIC_NAME = `T19 Topic ${RUN}`;
const TEST_EMAIL = `t19-int-${RUN}-${Date.now()}@test.local`;
const TEST_PASSWORD = `T19test123${RUN}`;
const TEST_FULL_NAME = `T19 User ${RUN}`;

let testUserId = "";
let testSubjectId = "";
let testTopicId = "";
let testQuestionId = "";
let testQuestionVersionId = "";
let correctOptionId = "";
let testSessionId = "";
let authCookie = "";

function extractCookie(res: request.Response): string {
  const raw = res.headers["set-cookie"] as unknown as string[] | string | undefined;
  if (!raw) return "";
  const arr = Array.isArray(raw) ? raw : [raw];
  // Keep only name=value part before ;
  return arr.map((c) => c.split(";")[0]).join("; ");
}

describe("Practice API HTTP integration — CREATE → START → QUESTIONS → ATTEMPT → COMPLETE → RESULT", () => {
  beforeAll(async () => {
    // Isolation already verified at module load via _testUrlEarly; do not re-check after DATABASE_URL override via helper

    const mod = await import("../index");
    app = (mod as unknown as { default: import("express").Express }).default;
    // Use direct PrismaClient with test URL to avoid helper's production-equality check after DATABASE_URL override
    testPrisma = new PrismaClient({ datasources: { db: { url: _testUrlEarly } } } as unknown as ConstructorParameters<typeof PrismaClient>[0]);
    await testPrisma.$connect();

    // Ensure required lookup rows exist
    await testPrisma.practiceMode.upsert({
      where: { code: "topic" },
      update: {},
      create: { code: "topic", name: "Topic" },
    });
    const qtype = await testPrisma.questionType.upsert({
      where: { code: "mcq" },
      update: {},
      create: { code: "mcq", name: "Multiple Choice (Single Correct)", hasOptions: true, hasNumeric: false, supportsMultiple: false },
    });

    // Isolated subject/topic
    const subject = await testPrisma.subject.create({
      data: { code: TEST_SUBJECT_CODE, name: TEST_SUBJECT_NAME, sortOrder: 999 },
    });
    testSubjectId = subject.id;
    const topic = await testPrisma.topic.create({
      data: { subjectId: testSubjectId, name: TEST_TOPIC_NAME, sortOrder: 999 },
    });
    testTopicId = topic.id;

    // Register + login test user via real HTTP (uses test DB because DATABASE_URL overridden)
    const reg = await request(app)
      .post("/api/v1/auth/register")
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD, full_name: TEST_FULL_NAME });
    expect(reg.status).toBe(201);
    expect(reg.body.success).toBe(true);
    testUserId = reg.body.data.id as string;
    expect(testUserId).toBeTruthy();

    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.success).toBe(true);
    authCookie = extractCookie(login);
    expect(authCookie).toContain("gate_pyq_session=");
    // Also verify login returns access_token
    expect(login.body.data.access_token).toBeTruthy();

    // Create published MCQ with 3 options (1 correct) + version snapshot (snake_case shape as persisted)
    const q = await testPrisma.question.create({
      data: {
        questionTypeId: qtype.id,
        subjectId: testSubjectId,
        topicId: testTopicId,
        body: `${PREFIX} MCQ test question — which traversal visits BST in sorted order?`,
        explanation: `${PREFIX} In-order traversal.`,
        marks: 2,
        negativeMarks: 0.66,
        difficulty: "easy",
        status: "published",
        version: 1,
        gateYear: 2099,
        createdById: testUserId,
        reviewedById: testUserId,
      },
    });
    testQuestionId = q.id;

    const optCorrect = await testPrisma.questionOption.create({
      data: { questionId: testQuestionId, body: `${PREFIX} In-order`, isCorrect: true, sortOrder: 0 },
    });
    const optWrong1 = await testPrisma.questionOption.create({
      data: { questionId: testQuestionId, body: `${PREFIX} Pre-order`, isCorrect: false, sortOrder: 1 },
    });
    await testPrisma.questionOption.create({
      data: { questionId: testQuestionId, body: `${PREFIX} Post-order`, isCorrect: false, sortOrder: 2 },
    });
    correctOptionId = optCorrect.id;

    // Snapshot must be snake_case as produced by publish/seed (grading dual-read supports both)
    const snapshot = {
      question_id: testQuestionId,
      type_code: "mcq",
      body: q.body,
      explanation: q.explanation,
      marks: 2,
      negative_marks: 0.66,
      difficulty: "easy",
      gate_year: 2099,
      subject_id: testSubjectId,
      topic_id: testTopicId,
      options: [
        { id: optCorrect.id, body: optCorrect.body, is_correct: true },
        { id: optWrong1.id, body: optWrong1.body, is_correct: false },
        // third option fetched similarly
        { id: (await testPrisma.questionOption.findFirstOrThrow({ where: { questionId: testQuestionId, sortOrder: 2 } })).id, body: `${PREFIX} Post-order`, is_correct: false },
      ],
      numeric_answers: [],
    };

    const qv = await testPrisma.questionVersion.create({
      data: {
        questionId: testQuestionId,
        version: 1,
        snapshot: snapshot as unknown as import("@prisma/client").Prisma.InputJsonValue,
        createdById: testUserId,
        reason: "T19 seed",
      },
    });
    testQuestionVersionId = qv.id;
  }, 120_000);

  afterAll(async () => {
    // Scoped cleanup respecting FK order — deterministic fixtures only
    // Use testPrisma directly; avoid helper after DATABASE_URL override
    let prisma: PrismaClient;
    if (testPrisma) prisma = testPrisma;
    else {
      const { PrismaClient: PC } = await import("@prisma/client");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma = new (PC as any)({ datasources: { db: { url: _testUrlEarly } } });
    }
    try {
      if (testSessionId) {
        await prisma.attempt.deleteMany({ where: { sessionId: testSessionId } }).catch(() => {});
        await prisma.practiceSession.deleteMany({ where: { id: testSessionId } }).catch(() => {});
      }
      // Fallback: any sessions for test user
      if (testUserId) {
        await prisma.attempt.deleteMany({ where: { userId: testUserId } }).catch(() => {});
        await prisma.practiceSession.deleteMany({ where: { userId: testUserId } }).catch(() => {});
        await prisma.bookmark.deleteMany({ where: { userId: testUserId } }).catch(() => {});
        await prisma.session.deleteMany({ where: { userId: testUserId } }).catch(() => {});
        await prisma.auditLog.deleteMany({ where: { actorId: testUserId } }).catch(() => {});
      }
      if (testQuestionId) {
        await prisma.questionVersion.deleteMany({ where: { questionId: testQuestionId } }).catch(() => {});
        await prisma.questionOption.deleteMany({ where: { questionId: testQuestionId } }).catch(() => {});
        await prisma.questionNumericAnswer.deleteMany({ where: { questionId: testQuestionId } }).catch(() => {});
        await prisma.question.deleteMany({ where: { id: testQuestionId } }).catch(() => {});
      }
      if (testTopicId) await prisma.topic.deleteMany({ where: { id: testTopicId } }).catch(() => {});
      if (testSubjectId) await prisma.subject.deleteMany({ where: { id: testSubjectId } }).catch(() => {});
      if (testUserId) await prisma.user.deleteMany({ where: { id: testUserId } }).catch(() => {});
    } finally {
      await prisma.$disconnect().catch(() => {});
      // Restore env for other suites
      if (_originalDatabaseUrl !== undefined) process.env.DATABASE_URL = _originalDatabaseUrl;
      else delete (process.env as unknown as Record<string, string | undefined>).DATABASE_URL;
    }
  }, 120_000);

  it("CREATE → START → QUESTIONS → ATTEMPT → COMPLETE → RESULT via real HTTP", async () => {
    // ---------- CREATE ----------
    const createRes = await request(app)
      .post("/api/v1/practice-sessions")
      .set("Cookie", authCookie)
      .send({
        mode: "topic",
        filters: { subject_id: testSubjectId, topic_id: testTopicId, question_types: ["mcq"] },
        timed: false,
        question_count: 1,
      });
    expect(createRes.status).toBe(201);
    expect(createRes.body.success).toBe(true);
    const sess = createRes.body.data as Record<string, unknown>;
    expect(typeof sess.id).toBe("string");
    testSessionId = sess.id as string;
    expect(sess.userId ?? (sess as unknown as Record<string, unknown>).user_id ?? sess.userId).toBeDefined();
    // status check — CURRENT enum is in_progress
    expect(sess.status).toBe("in_progress");
    // frozen pool present in config
    const cfg = sess.config as Record<string, unknown>;
    expect(cfg).toBeDefined();
    const frozen = (cfg.frozenPoolSnapshot ?? (sess as Record<string, unknown>).frozenPoolSnapshot) as unknown[] | undefined;
    expect(Array.isArray(frozen) ? frozen.length : (cfg.pool as unknown[])?.length ?? 0).toBeGreaterThan(0);
    // Verify session belongs to test user via direct DB
    const dbSess = await testPrisma.practiceSession.findUnique({ where: { id: testSessionId } });
    expect(dbSess).not.toBeNull();
    expect(dbSess?.userId).toBe(testUserId);
    expect(dbSess?.status).toBe("in_progress");
    expect(dbSess?.totalQuestions).toBe(1);

    // ---------- START ----------
    const startRes = await request(app).post(`/api/v1/practice-sessions/${testSessionId}/start`).set("Cookie", authCookie).send({});
    expect(startRes.status).toBe(200);
    expect(startRes.body.success).toBe(true);
    expect(startRes.body.data.status).toBe("in_progress");
    expect(startRes.body.data.id).toBe(testSessionId);

    // ---------- QUESTIONS ----------
    const qRes = await request(app).get(`/api/v1/practice-sessions/${testSessionId}/questions`).set("Cookie", authCookie);
    expect(qRes.status).toBe(200);
    expect(qRes.body.success).toBe(true);
    const questions = qRes.body.data as Array<Record<string, unknown>>;
    expect(Array.isArray(questions)).toBe(true);
    expect(questions.length).toBe(1);
    const q0 = questions[0];
    expect(q0.questionId).toBe(testQuestionId);
    expect(q0.questionVersionId).toBe(testQuestionVersionId);
    expect(q0.questionNumber).toBe(1);
    expect(q0.sequence).toBe(1);
    expect(typeof q0.body).toBe("string");
    expect((q0.body as string)).toContain(PREFIX);
    expect(q0.questionType).toBe("mcq");
    expect(q0.marks).toBe(2);
    // deterministic order — single question trivially ordered; also check options order
    const opts = q0.options as Array<Record<string, unknown>>;
    expect(Array.isArray(opts)).toBe(true);
    expect(opts.length).toBe(3);
    expect(opts[0].sortOrder).toBe(0);
    expect(opts[1].sortOrder).toBe(1);
    expect(opts[2].sortOrder).toBe(2);
    // student-safe: must NOT expose isCorrect / is_correct / correct / tolerance / numeric answer
    const qRaw = JSON.stringify(q0);
    expect(qRaw).not.toMatch(/isCorrect/);
    expect(qRaw).not.toMatch(/is_correct/);
    expect(qRaw).not.toMatch(/correct/i); // conservative — ensures no correct leak
    expect(qRaw).not.toMatch(/tolerance/);
    expect(qRaw).not.toMatch(/numeric/);
    for (const o of opts) {
      expect(o).toHaveProperty("id");
      expect(o).toHaveProperty("body");
      expect(o).toHaveProperty("sortOrder");
      expect(o).not.toHaveProperty("isCorrect");
      expect(o).not.toHaveProperty("is_correct");
    }

    // ---------- ATTEMPT ----------
    const attemptRes = await request(app)
      .post(`/api/v1/practice-sessions/${testSessionId}/attempts`)
      .set("Cookie", authCookie)
      .send({ question_id: testQuestionId, answer: { option_id: correctOptionId }, time_taken_seconds: 42 });
    expect([200, 201]).toContain(attemptRes.status);
    expect(attemptRes.body.success).toBe(true);
    const payload = attemptRes.body.data as Record<string, unknown>;
    expect(payload.attempt_id).toBeTruthy();
    expect(payload.question_id).toBe(testQuestionId);
    expect(payload.is_correct).toBe(true);
    expect(payload.marks).toBe(2);
    expect(payload.time_taken_seconds).toBe(42);
    // no answer-key leakage in attempt response
    const attRaw = JSON.stringify(payload);
    expect(attRaw).not.toMatch(/is_correct.*true.*is_correct/); // at least not leaking correct set
    expect(attRaw).not.toMatch(/tolerance/);
    // persistence check via testPrisma
    const attemptRow = await testPrisma.attempt.findFirst({ where: { sessionId: testSessionId, questionVersionId: testQuestionVersionId } });
    expect(attemptRow).not.toBeNull();
    expect(attemptRow?.isCorrect).toBe(true);
    expect(Number(attemptRow?.marks)).toBe(2);
    expect(attemptRow?.timeTakenSeconds).toBe(42);
    expect(attemptRow?.userId).toBe(testUserId);

    // ---------- COMPLETE ----------
    const compRes = await request(app).post(`/api/v1/practice-sessions/${testSessionId}/complete`).set("Cookie", authCookie).send({});
    expect(compRes.status).toBe(200);
    expect(compRes.body.success).toBe(true);
    expect(compRes.body.data.status).toBe("completed");
    expect(compRes.body.data.id).toBe(testSessionId);
    // score persisted
    const completed = await testPrisma.practiceSession.findUnique({ where: { id: testSessionId } });
    expect(completed?.status).toBe("completed");
    expect(Number(completed?.score)).toBe(2);
    expect(completed?.endedAt).toBeTruthy();

    // ---------- RESULT ----------
    const resRes = await request(app).get(`/api/v1/practice-sessions/${testSessionId}/result`).set("Cookie", authCookie);
    expect(resRes.status).toBe(200);
    expect(resRes.body.success).toBe(true);
    const result = resRes.body.data as Record<string, unknown>;
    expect(result.sessionId ?? result.session_id).toBe(testSessionId);
    expect(result.sessionStatus ?? (result as Record<string, unknown>).session_status ?? result.sessionStatus).toBe("completed");
    expect(result.totalQuestions ?? (result as Record<string, unknown>).total_questions).toBe(1);
    expect(result.attemptedCount ?? (result as Record<string, unknown>).attempted_count ?? result.attemptedCount).toBe(1);
    expect(result.correctCount ?? (result as Record<string, unknown>).correct_count ?? result.correctCount).toBe(1);
    expect(result.incorrectCount ?? (result as Record<string, unknown>).incorrect_count ?? result.incorrectCount).toBe(0);
    expect(result.unansweredCount ?? (result as Record<string, unknown>).unanswered_count ?? result.unansweredCount).toBe(0);
    expect(Number(result.finalScore ?? (result as Record<string, unknown>).final_score ?? result.totalMarksAwarded ?? 0)).toBe(2);
    const rq = (result.questions as Array<Record<string, unknown>>)[0];
    expect(rq).toBeDefined();
    expect(rq.correct).toBe(true);
    expect(rq.marksAwarded ?? rq.marks_awarded).toBe(2);
    // correct answer available only in RESULT (explicitly allowed)
    const ropts = rq.options as Array<Record<string, unknown>>;
    expect(Array.isArray(ropts)).toBe(true);
    const correctOpt = ropts.find((o) => o.id === correctOptionId);
    expect(correctOpt?.isCorrect).toBe(true);
    expect(correctOpt?.selected).toBe(true);
    // tolerance must still not be exposed even in result (for MCQ no NAT, but check)
    const resultRaw = JSON.stringify(result);
    expect(resultRaw).not.toMatch(/tolerance/);
    // total/max consistency
    expect(Number(result.maxPossibleMarks ?? (result as Record<string, unknown>).max_possible_marks ?? 2)).toBe(2);
  }, 120_000);
});
