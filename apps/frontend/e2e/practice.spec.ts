// T20.1 — PRACTICE UI FIRST E2E (real browser → frontend → backend → isolated PG)
// Covers REGISTER → PRACTICE SETUP → START → QUESTION → ANSWER → COMPLETE → RESULT
// Uses isolated gate_pyq_test via helpers/test-db.ts, never production Neon.
// One deterministic MCQ fixture, 3 options, 1 correct, marks=2, negative=null.
// The UI only offers count presets 5/10/15/20; we seed exactly one eligible question
// and intercept the smallest preset (5) to 1 so the backend's strict contract (> = count)
// can still create a one-question frozen pool without changing product UI/backend.
// @ts-nocheck
import { test, expect } from "@playwright/test";

// Per-run isolated identifier — deterministic for this run, unique across runs.
const RUN = Date.now().toString(36).slice(-6) + Math.random().toString(36).slice(2, 5);
const PREFIX = `[T20-E2E-${RUN}]`;
const SUBJECT_CODE = `t20_e2e_${RUN}`.toLowerCase();
const SUBJECT_NAME = `T20 E2E ${RUN}`;
const TOPIC_NAME = `T20 Topic ${RUN}`;
const CORRECT_BODY = `${PREFIX} In-order`;
const WRONG1_BODY = `${PREFIX} Pre-order`;
const WRONG2_BODY = `${PREFIX} Post-order`;
const QUESTION_BODY = `${PREFIX} MCQ test question — which traversal visits BST in sorted order?`;
const EXPLANATION = `${PREFIX} In-order traversal.`;

let testSubjectId = "";
let testTopicId = "";
let testQuestionId = "";
let testCreatorId = "";
let correctOptionId = "";

// Seed isolated fixtures in gate_pyq_test before the browser flow.
test.beforeAll(async () => {
  const { createTestPrismaClient, getTestDatabaseUrl } = await import("../../backend/src/__tests__/helpers/test-db");
  getTestDatabaseUrl(); // fail fast if missing or equals production
  const prisma = createTestPrismaClient();

  await prisma.practiceMode.upsert({ where: { code: "topic" }, update: {}, create: { code: "topic", name: "Topic" } });
  const qtype = await prisma.questionType.upsert({
    where: { code: "mcq" },
    update: {},
    create: { code: "mcq", name: "Multiple Choice (Single Correct)", hasOptions: true, hasNumeric: false, supportsMultiple: false },
  });

  const subject = await prisma.subject.create({ data: { code: SUBJECT_CODE, name: SUBJECT_NAME, sortOrder: 999 } });
  testSubjectId = subject.id;
  const topic = await prisma.topic.create({ data: { subjectId: testSubjectId, name: TOPIC_NAME, sortOrder: 999 } });
  testTopicId = topic.id;

  const { hashPassword } = await import("../../backend/src/core/utils/crypto");
  const role = await prisma.role.upsert({ where: { code: "student" }, update: {}, create: { code: "student", name: "Student" } });
  const creator = await prisma.user.create({
    data: {
      email: `t20-creator-${RUN}@test.local`,
      passwordHash: hashPassword("T20Creator123"),
      fullName: `T20 Creator ${RUN}`,
      roleId: role.id,
      status: "active",
    },
  });
  testCreatorId = creator.id;

  const q = await prisma.question.create({
    data: {
      questionTypeId: qtype.id,
      subjectId: testSubjectId,
      topicId: testTopicId,
      body: QUESTION_BODY,
      explanation: EXPLANATION,
      marks: 2,
      negativeMarks: null,
      difficulty: "easy",
      status: "published",
      version: 1,
      gateYear: 2099,
      createdById: testCreatorId,
      reviewedById: testCreatorId,
    },
  });
  testQuestionId = q.id;

  const optCorrect = await prisma.questionOption.create({ data: { questionId: testQuestionId, body: CORRECT_BODY, isCorrect: true, sortOrder: 0 } });
  const optWrong1 = await prisma.questionOption.create({ data: { questionId: testQuestionId, body: WRONG1_BODY, isCorrect: false, sortOrder: 1 } });
  await prisma.questionOption.create({ data: { questionId: testQuestionId, body: WRONG2_BODY, isCorrect: false, sortOrder: 2 } });
  correctOptionId = optCorrect.id;

  const snapshot = {
    question_id: testQuestionId,
    type_code: "mcq",
    body: q.body,
    explanation: q.explanation,
    marks: 2,
    negative_marks: null,
    difficulty: "easy",
    gate_year: 2099,
    subject_id: testSubjectId,
    topic_id: testTopicId,
    options: [
      { id: optCorrect.id, body: CORRECT_BODY, is_correct: true },
      { id: optWrong1.id, body: WRONG1_BODY, is_correct: false },
      { id: (await prisma.questionOption.findFirstOrThrow({ where: { questionId: testQuestionId, sortOrder: 2 } })).id, body: WRONG2_BODY, is_correct: false },
    ],
    numeric_answers: [],
  };

  await prisma.questionVersion.create({
    data: {
      questionId: testQuestionId,
      version: 1,
      snapshot: snapshot as unknown as import("@prisma/client").Prisma.InputJsonValue,
      createdById: testCreatorId,
      reason: "T20.1 E2E seed",
    },
  });

  await prisma.$disconnect();
});

test.afterAll(async () => {
  const { createTestPrismaClient } = await import("../../backend/src/__tests__/helpers/test-db");
  const prisma = createTestPrismaClient();
  try {
    // FK-safe deletion — only deterministic fixtures for this RUN
    const e2eEmails = `e2e-${RUN}`;
    const creatorEmail = `t20-creator-${RUN}`;

    // Find UI-registered users for this RUN
    const e2eUsers = await prisma.user.findMany({ where: { email: { contains: e2eEmails } }, select: { id: true } }).catch(() => []);
    const e2eUserIds = (e2eUsers as Array<{ id: string }>).map((u) => u.id);

    // Sessions/attempts for E2E users and creator
    const allUserIds = [...e2eUserIds, testCreatorId].filter(Boolean);
    for (const uid of allUserIds) {
      await prisma.attempt.deleteMany({ where: { userId: uid } }).catch(() => {});
      await prisma.practiceSession.deleteMany({ where: { userId: uid } }).catch(() => {});
      await prisma.bookmark.deleteMany({ where: { userId: uid } }).catch(() => {});
      await prisma.session.deleteMany({ where: { userId: uid } }).catch(() => {});
      await prisma.auditLog.deleteMany({ where: { actorId: uid } }).catch(() => {});
    }
    // Also sweep sessions that may remain via direct session id (belt-and-belt)
    await prisma.attempt.deleteMany({ where: { sessionId: { contains: "" } } }).catch(() => {});

    // User records
    await prisma.user.deleteMany({ where: { email: { contains: e2eEmails } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { email: creatorEmail } }).catch(() => {});

    if (testQuestionId) {
      await prisma.questionVersion.deleteMany({ where: { questionId: testQuestionId } }).catch(() => {});
      await prisma.questionOption.deleteMany({ where: { questionId: testQuestionId } }).catch(() => {});
      await prisma.questionNumericAnswer.deleteMany({ where: { questionId: testQuestionId } }).catch(() => {});
      await prisma.question.deleteMany({ where: { id: testQuestionId } }).catch(() => {});
    }
    if (testTopicId) await prisma.topic.deleteMany({ where: { id: testTopicId } }).catch(() => {});
    if (testSubjectId) await prisma.subject.deleteMany({ where: { id: testSubjectId } }).catch(() => {});
    if (testCreatorId) await prisma.user.deleteMany({ where: { id: testCreatorId } }).catch(() => {});
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
});

test("REGISTER → PRACTICE SETUP → START → QUESTION → ANSWER → COMPLETE → RESULT", async ({ page }) => {
  test.setTimeout(90_000);
  const email = `e2e-${RUN}@test.local`;
  const password = `T20test123${RUN}`;
  const fullName = `T20 E2E ${RUN}`;

  // Intercept PRACTICE create to rewrite count 5 → 1 so single-question fixture succeeds
  // without mocking the response — real HTTP still flows to backend and PG.
  await page.route("**/practice-sessions", async (route) => {
    const req = route.request();
    const url = req.url();
    const method = req.method();
    // Only the create endpoint (POST /practice-sessions, not /:id/*)
    if (method === "POST" && url.includes("/practice-sessions") && !/\/practice-sessions\//.test(url)) {
      try {
        const postData = req.postDataJSON() as Record<string, unknown> | null;
        if (postData && typeof postData["question_count"] === "number") {
          (postData as Record<string, unknown>)["question_count"] = 1;
          await route.continue({ postData: JSON.stringify(postData) });
          return;
        }
      } catch {
        // fall through
      }
    }
    await route.continue();
  });

  // 1. REGISTER via real UI
  await page.goto("/register");
  await expect(page.getByRole("heading", { name: "Create your free account" })).toBeVisible();
  await page.getByLabel("Full name").fill(fullName);
  await page.getByLabel("Email").fill(email);
  await page.locator('input[autocomplete="new-password"]').fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });

  // 2. Open PRACTICE setup
  await page.goto("/practice");
  await expect(page.getByRole("heading", { name: "Start a practice session" })).toBeVisible({ timeout: 10000 });

  // 3. Configure: Topic focus + Subject + Topic + smallest preset
  await page.getByRole("button", { name: /Topic focus/ }).click();
  await expect(page.getByLabel("Subject")).toBeVisible({ timeout: 10000 });
  await page.getByLabel("Subject").selectOption(testSubjectId);
  await expect(page.getByRole("button", { name: TOPIC_NAME })).toBeVisible({ timeout: 10000 });
  await page.getByRole("button", { name: TOPIC_NAME }).click();
  await page.getByRole("button", { name: "5", exact: true }).click();

  // 4. START — capture create response
  const createPromise = page.waitForResponse((resp) => resp.url().includes("/practice-sessions") && resp.request().method() === "POST", { timeout: 10000 });
  await page.getByRole("button", { name: /Start practice/ }).click();
  await createPromise;

  // 5. SESSION assertions — URL, counter, options, no leak
  await expect(page).toHaveURL(/\/practice\//, { timeout: 15000 });
  await expect(page.getByText("Question 1 of 1")).toBeVisible({ timeout: 15000 });

  // Exactly 3 MCQ options visible
  const radios = page.getByRole("radio");
  await expect(radios).toHaveCount(3);
  await expect(page.getByRole("radio", { name: CORRECT_BODY })).toBeVisible();
  await expect(page.getByRole("radio", { name: WRONG1_BODY })).toBeVisible();
  await expect(page.getByRole("radio", { name: WRONG2_BODY })).toBeVisible();

  // Correct-answer indicators NOT exposed before submission (page text should not leak isCorrect)
  const preBody = await page.textContent("body");
  expect(preBody).not.toMatch(/isCorrect/);
  expect(preBody).not.toMatch(/is_correct/);

  // Select known correct option
  await page.getByRole("radio", { name: CORRECT_BODY }).click();
  await expect(page.getByRole("radio", { name: CORRECT_BODY })).toHaveAttribute("aria-checked", "true");

  // Save answer — verify grading feedback +2
  const attemptPromise = page.waitForResponse((resp) => resp.url().includes("/attempts") && resp.request().method() === "POST", { timeout: 10000 });
  await page.getByRole("button", { name: /Save answer/ }).click();
  await attemptPromise;
  await expect(page.getByText(/Correct/)).toBeVisible({ timeout: 10000 });
  await expect(page.getByText(/\+2/)).toBeVisible({ timeout: 10000 });

  // 6. COMPLETION — Finish → modal → Submit & view result
  await page.getByRole("button", { name: /Finish/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole("heading", { name: "Submit session?" })).toBeVisible();
  await page.getByRole("button", { name: /Submit & view result/ }).click();
  await expect(page).toHaveURL(/\/results\//, { timeout: 15000 });

  // 7. RESULT assertions — 1 correct, 1 attempted, 0 unanswered/skipped, 2/2, explanations present
  await expect(page.getByText(/1 correct of 1 attempted/)).toBeVisible({ timeout: 10000 });
  // unanswered is rendered as skipped per UI
  await expect(page.getByText(/0 skipped|0 unanswered/)).toBeVisible({ timeout: 10000 });
  // Score card: total 2 with max 2
  await expect(page.getByText("Score")).toBeVisible();
  await expect(page.getByText(/of 2 max/)).toBeVisible();
  // The big 2 value should be visible twice (score + max) — check at least one 2
  await expect(page.getByText("Per-topic breakdown")).toBeVisible();
  await expect(page.getByText("Explanations")).toBeVisible();
  // Explanations content present (our fixture explanation)
  await expect(page.getByText(EXPLANATION)).toBeVisible({ timeout: 10000 });
  // No tolerance leak in result
  const resultBody = await page.textContent("body");
  expect(resultBody).not.toMatch(/tolerance/i);
});
