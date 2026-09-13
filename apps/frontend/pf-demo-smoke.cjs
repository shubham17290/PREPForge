// TEMP — PrepForge demo smoke test via Playwright (delete after use)
const { chromium } = require("@playwright/test");
const os = require("os");
const path = require("path");
const fs = require("fs");

const BASE = "http://localhost:3000";
const SHOT_DIR = path.join(os.tmpdir(), "pf-demo-shots");
const LOG_FILE = path.join(__dirname, "pf-demo-smoke.log");
fs.mkdirSync(SHOT_DIR, { recursive: true });
fs.writeFileSync(LOG_FILE, "");
const log = (line) => fs.appendFileSync(LOG_FILE, `${line}\n`);
const shot = (page, name) => page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`), fullPage: true });

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(`[console] ${m.text()}`); });
  page.on("pageerror", (e) => errors.push(`[pageerror] ${String(e)}`));
  page.on("response", (r) => {
    if (r.status() >= 400) errors.push(`[http ${r.status()}] ${r.request().method()} ${r.url()}`);
  });

  try {
    // 1. Landing
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(1500);
    log(`LANDING_TITLE: ${await page.title()}`);
    await shot(page, "01-landing");

    // 2. Login
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(1000);
    await page.fill('input[type="email"]', "dev-seed@gate-pyq.local");
    await page.fill('input[type="password"]', "dev-passw0rd-1");
    await Promise.all([
      page.waitForURL("**/dashboard", { timeout: 25000 }),
      page.getByRole("button", { name: "Log in" }).click(),
    ]);
    log(`LOGIN_OK_URL: ${page.url()}`);
    await page.waitForTimeout(2000);
    await shot(page, "02-dashboard");

    // 3. Subjects
    await page.goto(`${BASE}/subjects`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForSelector("text=Development Computer Science", { timeout: 20000 });
    await shot(page, "03-subjects");
    log("SUBJECTS_OK");

    // 4. Topics
    await page.goto(`${BASE}/subjects/00000000-0000-4000-8000-000000000001/topics`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForSelector("text=Algorithms (Development)", { timeout: 20000 });
    await shot(page, "04-topics");
    log("TOPICS_OK");

    // 5. Practice setup
    await page.goto(`${BASE}/practice`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForSelector("select", { timeout: 20000 });
    await shot(page, "05-practice-setup");
    log("PRACTICE_SETUP_OK");

    // 6. Bookmarks -> Open navigates to question page
    await page.goto(`${BASE}/bookmarks`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForSelector("text=Open", { timeout: 20000 });
    const openLinks = page.getByRole("link", { name: /Open/ });
    log(`BOOKMARK_OPEN_LINKS: ${await openLinks.count()}`);
    if ((await openLinks.count()) > 0) {
      await Promise.all([
        page.waitForURL("**/questions/**", { timeout: 20000 }),
        openLinks.first().click(),
      ]);
      log(`QUESTION_PAGE_URL: ${page.url()}`);
      await page.waitForSelector("text=Question preview", { timeout: 20000 });
      await shot(page, "06-question-detail");
    }

    // 7. Mistakes
    await page.goto(`${BASE}/mistakes`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForSelector("text=Mistake review", { timeout: 20000 });
    await shot(page, "07-mistakes");
    log("MISTAKES_OK");

    // 8. Full practice session via the UI
    await page.goto(`${BASE}/practice`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForSelector("select", { timeout: 20000 });
    await page.locator("select").first().selectOption({ value: "00000000-0000-4000-8000-000000000001" });
    await page.waitForSelector('button:has-text("Algorithms (Development)")', { timeout: 20000 });
    await page.getByRole("button", { name: "Algorithms (Development)" }).click();
    await page.getByRole("button", { name: "Start practice" }).click();
    await page.waitForURL("**/practice/**", { timeout: 30000 });
    log(`SESSION_URL: ${page.url()}`);

    await page.waitForSelector('input[inputmode="decimal"], button:has-text("In-order")', { timeout: 25000 });
    for (let q = 0; q < 2; q += 1) {
      log(`Q${q + 1}_START`);
      const natInput = page.locator('input[inputmode="decimal"]');
      const mcqOption = page.getByRole("radio", { name: "In-order" });
      if ((await natInput.count()) > 0 && (await natInput.first().isVisible())) {
        log("Q_NAT_FILL");
        await natInput.first().fill("8");
      } else if (await mcqOption.isVisible()) {
        log("Q_MCQ_OPTION");
        await mcqOption.click();
      }
      await page.getByRole("button", { name: "Save answer" }).click();
      await page.waitForTimeout(4000);
      const statusText = await page.locator('p[role="status"], [role="alert"]').first().textContent().catch(() => "");
      log(`Q${q + 1}_STATUS: ${statusText}`);
      await page.waitForSelector("text=Correct — +1 marks", { timeout: 20000 });
      log(`Q${q + 1}_SAVED_CORRECT`);
      await shot(page, `08-session-q${q + 1}`);
      const nextBtn = page.getByRole("button", { name: "Next" });
      if (await nextBtn.isVisible()) await nextBtn.click();
    }

    await page.getByRole("button", { name: "Finish" }).click();
    await page.getByRole("button", { name: "Submit & view result" }).click();
    await page.waitForURL("**/results/**", { timeout: 30000 });
    log(`RESULT_URL: ${page.url()}`);
    await page.waitForSelector("text=Score", { timeout: 20000 });
    await page.waitForTimeout(1500);
    await shot(page, "09-result");
    log("RESULT_OK");
  } catch (e) {
    log(`SCRIPT_FAIL: ${String(e)}`);
    try {
      const body = await page.locator("body").innerText();
      log("BODY_SNAPSHOT:");
      log(body.slice(0, 4000));
    } catch {}
  }

  log(`CONSOLE_ERRORS: ${errors.length ? `\n${errors.join("\n")}` : "none"}`);
  await browser.close();
})().catch((e) => {
  fs.appendFileSync(LOG_FILE, `FATAL: ${String(e)}\n`);
  process.exit(0);
});