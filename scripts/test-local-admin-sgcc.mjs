import { chromium } from "playwright";

const BASE_URL = process.env.HUL_BASE_URL || "http://127.0.0.1:3000";
const ADMIN_USERNAME = process.env.HUL_ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.HUL_ADMIN_PASSWORD || "change-me-admin";
const ACCOUNT_ID = Number(process.env.HUL_ACCOUNT_ID || "4");
const CDP_URL = process.env.HUL_CDP_URL || "http://127.0.0.1:9222";

async function loginIfNeeded(page) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
  if (page.url().includes("/admin")) {
    return;
  }

  await page.fill("#usernameInput", ADMIN_USERNAME);
  await page.fill("#passwordInput", ADMIN_PASSWORD);
  await page.click("#loginButton");
  await page.waitForURL(/\/admin/, { timeout: 30000 });
}

async function main() {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];
  if (!context) {
    throw new Error("No browser context available on CDP endpoint");
  }
  const page = await context.newPage();

  try {
    await loginIfNeeded(page);
    await page.goto(`${BASE_URL}/admin`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);

    const result = await page.evaluate(async ({ accountId }) => {
      const response = await fetch(`/api/admin/accounts/${accountId}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });
      const text = await response.text();
      let data = null;
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }
      return {
        ok: response.ok,
        status: response.status,
        data
      };
    }, { accountId: ACCOUNT_ID });

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await page.close().catch(() => null);
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
