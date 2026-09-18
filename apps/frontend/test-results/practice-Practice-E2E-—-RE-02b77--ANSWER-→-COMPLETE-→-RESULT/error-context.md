# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: practice.spec.ts >> Practice E2E — REGISTER → SETUP → START → QUESTION → ANSWER → COMPLETE → RESULT >> REGISTER → PRACTICE SETUP → START → QUESTION → ANSWER → COMPLETE → RESULT
- Location: e2e\practice.spec.ts:153:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText(/Correct/)
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for getByText(/Correct/)

```

```yaml
- banner:
  - navigation "Main":
    - link "PREPForge GATE CS & IT":
      - /url: /
    - list:
      - listitem:
        - link "Dashboard":
          - /url: /dashboard
      - listitem:
        - link "Subjects":
          - /url: /subjects
      - listitem:
        - link "Practice":
          - /url: /practice
      - listitem:
        - link "Bookmarks":
          - /url: /bookmarks
      - listitem:
        - link "Mistakes":
          - /url: /mistakes
      - listitem:
        - link "Admin":
          - /url: /admin
    - link "Signed in as T19 E2E 6wm9wme9c":
      - /url: /profile
      - text: T
    - button "Log out"
- main:
  - paragraph: Question 1 of 1
  - text: ⏱ —
  - button "Bookmark this question": ☆
  - img "0 of 1 answered"
  - text: T19 E2E 6wm9wme9c T19 Topic 6wm9wme9c GATE 2099 easy MCQ 2 marks
  - main:
    - paragraph: "[T19-E2E-6wm9wme9c] MCQ test question — which traversal visits BST in sorted order?"
    - group "Pick one answer":
      - text: Pick one answer
      - group:
        - radio "[T19-E2E-6wm9wme9c] In-order" [checked]
        - radio "[T19-E2E-6wm9wme9c] Pre-order"
        - radio "[T19-E2E-6wm9wme9c] Post-order"
  - button "⚑ Mark for review"
  - button "Save answer"
  - paragraph
  - navigation "Question navigation":
    - button "← Prev" [disabled]
    - list "Question palette":
      - listitem:
        - button "Question 1, unanswered": "1"
    - button "Finish ✓"
- alert
```

# Test source

```ts
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
  178 |     await page.goto("/register");
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
  223 |     await expect(page.getByRole("radio", { name: CORRECT_BODY })).toHaveAttribute("aria-checked", "true", { timeout: 5000 });
  224 |     const attemptPromise = page.waitForResponse((resp) => resp.url().includes("/attempts") && resp.request().method() === "POST", { timeout: 10000 });
  225 |     await page.getByRole("button", { name: /Save answer/ }).click();
  226 |     const attemptResp = await attemptPromise;
  227 |     // eslint-disable-next-line no-console
  228 |     console.log("ATTEMPT status", attemptResp.status(), await attemptResp.json().catch(() => ({})));
> 229 |     await expect(page.getByText(/Correct/)).toBeVisible({ timeout: 10000 });
      |                                             ^ Error: expect(locator).toBeVisible() failed
  230 | 
  231 |     // 6. Complete
  232 |     await page.getByRole("button", { name: /Finish/ }).click();
  233 |     await expect(page.getByRole("heading", { name: "Submit session?" })).toBeVisible();
  234 |     await page.getByRole("button", { name: /Submit & view result/ }).click();
  235 |     await expect(page).toHaveURL(/\/results\//, { timeout: 15000 });
  236 | 
  237 |     // 7. Result assertions
  238 |     await expect(page.getByText(/1 correct of 1 attempted/)).toBeVisible({ timeout: 10000 });
  239 |     await expect(page.getByText("Score")).toBeVisible();
  240 |     // Score 2 of 2 max is rendered as StatCard
  241 |     await expect(page.getByText(/2.*of.*2 max|Score.*2/)).toBeVisible();
  242 |     await expect(page.getByText("Per-topic breakdown")).toBeVisible();
  243 |     await expect(page.getByText("Explanations")).toBeVisible();
  244 |     // Ensure result not leaking tolerance
  245 |     const resultBody = await page.textContent("body");
  246 |     expect(resultBody).not.toMatch(/tolerance/i);
  247 |   });
  248 | });
  249 | 
```