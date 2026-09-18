# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: apps\frontend\e2e\practice.spec.ts >> Practice E2E — REGISTER → SETUP → START → QUESTION → ANSWER → COMPLETE → RESULT >> REGISTER → PRACTICE SETUP → START → QUESTION → ANSWER → COMPLETE → RESULT
- Location: apps\frontend\e2e\practice.spec.ts:153:7

# Error details

```
Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
Call log:
  - navigating to "/register", waiting until "load"

```

# Test source

```ts
  78  |     await prisma.questionOption.create({ data: { questionId: testQuestionId, body: WRONG2_BODY, isCorrect: false, sortOrder: 2 } });
  79  | 
  80  |     const snapshot = {
  81  |       question_id: testQuestionId,
  82  |       type_code: "mcq",
  83  |       body: q.body,
  84  |       explanation: q.explanation,
  85  |       marks: 2,
  86  |       negative_marks: null,
  87  |       difficulty: "easy",
  88  |       gate_year: 2099,
  89  |       subject_id: testSubjectId,
  90  |       topic_id: testTopicId,
  91  |       options: [
  92  |         { id: optCorrect.id, body: CORRECT_BODY, is_correct: true },
  93  |         { id: optWrong1.id, body: WRONG1_BODY, is_correct: false },
  94  |         { id: (await prisma.questionOption.findFirstOrThrow({ where: { questionId: testQuestionId, sortOrder: 2 } })).id, body: WRONG2_BODY, is_correct: false },
  95  |       ],
  96  |       numeric_answers: [],
  97  |     };
  98  | 
  99  |     await prisma.questionVersion.create({
  100 |       data: {
  101 |         questionId: testQuestionId,
  102 |         version: 1,
  103 |         snapshot: snapshot as unknown as import("@prisma/client").Prisma.InputJsonValue,
  104 |         createdById: testCreatorId,
  105 |         reason: "T19 E2E seed",
  106 |       },
  107 |     });
  108 | 
  109 |     await prisma.$disconnect();
  110 |   });
  111 | 
  112 |   test.afterAll(async () => {
  113 |     // @ts-ignore
  114 |     const { createTestPrismaClient } = await import("../../backend/src/__tests__/helpers/test-db");
  115 |     const prisma = createTestPrismaClient();
  116 |     try {
  117 |       // Delete in FK-safe order — only deterministic fixtures
  118 |       // Sessions/attempts will be for the UI-registered student (not creator), but we can sweep by question/subject
  119 |       const sessions = await prisma.practiceSession.findMany({ where: { user: { email: { contains: `t19-e2e-${RUN}` } } }, select: { id: true } }).catch(() => []);
  120 |       for (const s of sessions as Array<{ id: string }>) {
  121 |         await prisma.attempt.deleteMany({ where: { sessionId: s.id } }).catch(() => {});
  122 |       }
  123 |       await prisma.practiceSession.deleteMany({ where: { user: { email: { contains: `t19-e2e-${RUN}` } } } }).catch(() => {});
  124 |       await prisma.practiceSession.deleteMany({ where: { userId: testCreatorId } }).catch(() => {});
  125 |       await prisma.attempt.deleteMany({ where: { userId: testCreatorId } }).catch(() => {});
  126 |       await prisma.session.deleteMany({ where: { userId: testCreatorId } }).catch(() => {});
  127 |       await prisma.session.deleteMany({ where: { user: { email: { contains: `t19-e2e-${RUN}` } } } }).catch(() => {});
  128 |       await prisma.auditLog.deleteMany({ where: { actorId: testCreatorId } }).catch(() => {});
  129 |       // Sweep UI-registered users by RUN prefix in email
  130 |       const e2eUsers = await prisma.user.findMany({ where: { email: { contains: `t19-e2e-${RUN}` } }, select: { id: true } });
  131 |       for (const u of e2eUsers) {
  132 |         await prisma.attempt.deleteMany({ where: { userId: u.id } }).catch(() => {});
  133 |         await prisma.practiceSession.deleteMany({ where: { userId: u.id } }).catch(() => {});
  134 |         await prisma.bookmark.deleteMany({ where: { userId: u.id } }).catch(() => {});
  135 |         await prisma.session.deleteMany({ where: { userId: u.id } }).catch(() => {});
  136 |         await prisma.auditLog.deleteMany({ where: { actorId: u.id } }).catch(() => {});
  137 |       }
  138 |       await prisma.user.deleteMany({ where: { email: { contains: `t19-e2e-${RUN}` } } }).catch(() => {});
  139 |       if (testQuestionId) {
  140 |         await prisma.questionVersion.deleteMany({ where: { questionId: testQuestionId } }).catch(() => {});
  141 |         await prisma.questionOption.deleteMany({ where: { questionId: testQuestionId } }).catch(() => {});
  142 |         await prisma.questionNumericAnswer.deleteMany({ where: { questionId: testQuestionId } }).catch(() => {});
  143 |         await prisma.question.deleteMany({ where: { id: testQuestionId } }).catch(() => {});
  144 |       }
  145 |       if (testTopicId) await prisma.topic.deleteMany({ where: { id: testTopicId } }).catch(() => {});
  146 |       if (testSubjectId) await prisma.subject.deleteMany({ where: { id: testSubjectId } }).catch(() => {});
  147 |       if (testCreatorId) await prisma.user.deleteMany({ where: { id: testCreatorId } }).catch(() => {});
  148 |     } finally {
  149 |       await prisma.$disconnect().catch(() => {});
  150 |     }
  151 |   });
  152 | 
  153 |   test("REGISTER → PRACTICE SETUP → START → QUESTION → ANSWER → COMPLETE → RESULT", async ({ page }) => {
  154 |     const email = `t19-e2e-${RUN}-${Date.now()}@test.local`;
  155 |     const password = `T19test123${RUN}`;
  156 |     const fullName = `T19 E2E ${RUN}`;
  157 | 
  158 |     // Intercepts: force question_count to 1 so single-question fixture succeeds when UI sends 5
  159 |     await page.route("**/*", async (route) => {
  160 |       const req = route.request();
  161 |       const url = req.url();
  162 |       if (req.method() === "POST" && url.includes("/practice-sessions") && !url.includes("/practice-sessions/")) {
  163 |         try {
  164 |           const postData = req.postDataJSON() as Record<string, unknown> | null;
  165 |           if (postData && typeof postData["question_count"] === "number") {
  166 |             (postData as Record<string, unknown>)["question_count"] = 1;
  167 |             await route.continue({ postData: JSON.stringify(postData) });
  168 |             return;
  169 |           }
  170 |         } catch {
  171 |           // ignore parse errors
  172 |         }
  173 |       }
  174 |       await route.continue();
  175 |     });
  176 | 
  177 |     // 1. Register via real UI
> 178 |     await page.goto("/register");
      |                ^ Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
  179 |     await expect(page.getByRole("heading", { name: "Create your free account" })).toBeVisible();
  180 |     await page.getByLabel("Full name").fill(fullName);
  181 |     await page.getByLabel("Email").fill(email);
  182 |     // PasswordInput: use autocomplete selector (label association flaky with toggle button)
  183 |     await page.locator('input[autocomplete="new-password"]').fill(password);
  184 |     await page.getByRole("button", { name: "Create account" }).click();
  185 |     await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
  186 | 
  187 |     // 2. Open Practice
  188 |     await page.goto("/practice");
  189 |     await expect(page.getByRole("heading", { name: "Start a practice session" })).toBeVisible({ timeout: 10000 });
  190 | 
  191 |     // 3. Configure: Mode Topic focus
  192 |     await page.getByRole("button", { name: /Topic focus/ }).click();
  193 |     // Subject — select by value (id) for determinism (label includes " · N questions")
  194 |     await expect(page.getByLabel("Subject")).toBeVisible({ timeout: 10000 });
  195 |     await page.getByLabel("Subject").selectOption(testSubjectId);
  196 |     // Wait for topics to load
  197 |     await expect(page.getByRole("button", { name: TOPIC_NAME })).toBeVisible({ timeout: 10000 });
  198 |     await page.getByRole("button", { name: TOPIC_NAME }).click();
  199 |     // Question count 5 (smallest) — will be intercepted to 1
  200 |     await page.getByRole("button", { name: "5", exact: true }).click();
  201 |     // Start — capture create response to verify frozen pool
  202 |     const createPromise = page.waitForResponse((resp) => resp.url().includes("/practice-sessions") && resp.request().method() === "POST", { timeout: 10000 });
  203 |     await page.getByRole("button", { name: /Start practice/ }).click();
  204 |     const createResp = await createPromise;
  205 |     // eslint-disable-next-line no-console
  206 |     console.log("CREATE status", createResp.status(), await createResp.json().catch(() => ({})));
  207 | 
  208 |     // 4. Session page
  209 |     await expect(page).toHaveURL(/\/practice\//, { timeout: 15000 });
  210 |     // UI may show 1 or 5 depending on intercept — accept either but prefer 1
  211 |     await expect(page.getByText(/Question 1 of (1|5)/)).toBeVisible({ timeout: 15000 });
  212 |     // Exactly 3 MCQ options visible
  213 |     await expect(page.getByRole("radio", { name: CORRECT_BODY })).toBeVisible();
  214 |     await expect(page.getByRole("radio", { name: WRONG1_BODY })).toBeVisible();
  215 |     await expect(page.getByRole("radio", { name: WRONG2_BODY })).toBeVisible();
  216 |     // Not exposed before submission
  217 |     const bodyText = await page.textContent("body");
  218 |     expect(bodyText).not.toMatch(/isCorrect/);
  219 |     expect(bodyText).not.toMatch(/is_correct/);
  220 | 
  221 |     // 5. Select correct and save
  222 |     await page.getByRole("radio", { name: CORRECT_BODY }).click();
  223 |     await page.getByRole("button", { name: /Save answer/ }).click();
  224 |     await expect(page.getByText(/Correct — \+2 marks|Correct!/)).toBeVisible({ timeout: 10000 });
  225 | 
  226 |     // 6. Complete
  227 |     await page.getByRole("button", { name: /Finish/ }).click();
  228 |     await expect(page.getByRole("heading", { name: "Submit session?" })).toBeVisible();
  229 |     await page.getByRole("button", { name: /Submit & view result/ }).click();
  230 |     await expect(page).toHaveURL(/\/results\//, { timeout: 15000 });
  231 | 
  232 |     // 7. Result assertions
  233 |     await expect(page.getByText(/1 correct of 1 attempted/)).toBeVisible({ timeout: 10000 });
  234 |     await expect(page.getByText("Score")).toBeVisible();
  235 |     // Score 2 of 2 max is rendered as StatCard
  236 |     await expect(page.getByText(/2.*of.*2 max|Score.*2/)).toBeVisible();
  237 |     await expect(page.getByText("Per-topic breakdown")).toBeVisible();
  238 |     await expect(page.getByText("Explanations")).toBeVisible();
  239 |     // Ensure result not leaking tolerance
  240 |     const resultBody = await page.textContent("body");
  241 |     expect(resultBody).not.toMatch(/tolerance/i);
  242 |   });
  243 | });
  244 | 
```