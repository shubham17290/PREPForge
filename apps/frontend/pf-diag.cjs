// TEMP — diagnostic: capture MCQ attempt response from the browser context (delete after use)
const { chromium } = require("@playwright/test");
const BASE = "http://localhost:3000";
const API = "http://localhost:4000/api/v1";

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  // Login via UI so cookies land in the browser context
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(800);
  await page.fill('input[type="email"]', "dev-seed@gate-pyq.local");
  await page.fill('input[type="password"]', "dev-passw0rd-1");
  await Promise.all([
    page.waitForURL("**/dashboard", { timeout: 25000 }),
    page.getByRole("button", { name: "Log in" }).click(),
  ]);
  console.log("LOGGED_IN");

  const api = context.request;
  const me = await api.get(`${API}/auth/me`);
  console.log("ME_STATUS:", me.status());

  // Create a session for the DEV-CS Algorithms topic via API using shared cookies
  const created = await api.post(`${API}/practice-sessions`, {
    data: {
      mode: "topic",
      filters: { subject_id: "00000000-0000-4000-8000-000000000001", topic_id: "00000000-0000-4000-8000-000000000011" },
      timed: false,
      question_count: 5,
    },
  });
  const createdJson = await created.json();
  const sessionId = createdJson.data.id;
  console.log("SESSION:", sessionId, "total:", createdJson.data.total_questions);

  const started = await api.post(`${API}/practice-sessions/${sessionId}/start`);
  const state = (await started.json()).data;
  const mcq = state.questions.find((q) => q.type_code === "mcq");
  console.log("MCQ_QUESTION:", mcq.id, "options:", mcq.options.map((o) => `${o.id}:${o.body}`).join(" | "));

  const attempt = await api.post(`${API}/practice-sessions/${sessionId}/attempts`, {
    data: {
      question_id: mcq.id,
      answer: { option_id: mcq.options[0].id },
      time_taken_seconds: 5,
    },
  });
  console.log("ATTEMPT_STATUS:", attempt.status());
  console.log("ATTEMPT_BODY:", await attempt.text());

  // Now repeat the SAME attempt from the page's own fetch path (as the app does)
  await page.goto(`${BASE}/practice/${sessionId}`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);
  const pageResult = await page.evaluate(
    async ({ apiBase, sessionId, questionId, optionId }) => {
      const res = await fetch(`${apiBase}/practice-sessions/${sessionId}/attempts`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question_id: questionId,
          answer: { option_id: optionId },
          time_taken_seconds: 5,
        }),
      });
      return { status: res.status, body: await res.text() };
    },
    { apiBase: API, sessionId, questionId: mcq.id, optionId: mcq.options[0].id },
  );
  console.log("PAGE_FETCH_ATTEMPT_STATUS:", pageResult.status);
  console.log("PAGE_FETCH_ATTEMPT_BODY:", pageResult.body);

  await browser.close();
})().catch((e) => {
  console.error("DIAG_FAIL:", e);
  process.exit(0);
});