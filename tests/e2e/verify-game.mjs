import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "../../apps/server/src/index.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const OUT_DIR = process.env.E2E_SCREENSHOT_DIR ?? path.join(REPO_ROOT, "test-results");

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const app = await createServer({ dbPath: ":memory:" });
  const address = await app.listen({ port: 0, host: "127.0.0.1" });
  console.log(`[e2e] Server started at ${address}`);

  const chromePath = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
  const browser = await chromium.launch({
    executablePath: chromePath,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--enable-webgl",
      "--ignore-gpu-blocklist",
      "--use-gl=angle",
      "--use-angle=swiftshader-webgl",
      "--enable-unsafe-swiftshader"
    ]
  });

  const consoleErrors = [];
  const failedRequests = [];

  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(err.message));
    page.on("response", (res) => {
      if (res.status() >= 400) {
        failedRequests.push(`${res.status()} ${res.url()}`);
      }
    });

    await page.goto(address, { waitUntil: "networkidle" });
    await page.waitForSelector('[data-testid="fps-badge"]', { timeout: 15000 });
    await page.waitForFunction(
      () => {
        const badge = document.querySelector('[data-testid="fps-badge"]');
        return (
          badge &&
          !badge.textContent.includes("initializing") &&
          !badge.textContent.includes("0 atl") &&
          !document.body.innerText.includes("Cargando tu imperio")
        );
      },
      { timeout: 25000 }
    );
    await page.waitForTimeout(2500);

    const fpsText = await page.locator('[data-testid="fps-badge"]').innerText();
    console.log(`[e2e] Initial Village telemetry: ${fpsText}`);

    // 1. Screenshot: Classic Village in Spanish
    await page.screenshot({ path: path.join(OUT_DIR, "01_village_es.png") });

    // 2. Open Shop Modal & screenshot
    await page.click('[data-testid="btn-shop"]');
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT_DIR, "02_shop_modal.png") });
    await page.locator("button", { hasText: "✕" }).first().click();

    // 3. Open Systems Modal (Goals + Market) & screenshot
    await page.click('[data-testid="btn-systems"]');
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT_DIR, "03_systems_goals.png") });
    await page.locator("button", { hasText: "✕" }).first().click();

    // 4. Open World Map & launch a real Quest Battle
    await page.click('[data-testid="btn-worldmap"]');
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT_DIR, "04_world_map.png") });

    // Click first Quest island button
    await page.locator("button", { hasText: "Quest" }).first().click();
    await page.waitForTimeout(2800);
    const battleFps = await page.locator('[data-testid="fps-badge"]').innerText();
    console.log(`[e2e] Quest Battle telemetry: ${battleFps}`);
    await page.screenshot({ path: path.join(OUT_DIR, "05_quest_battle.png") });

    console.log(`[e2e] Console errors: ${consoleErrors.length}`);
    if (consoleErrors.length > 0) console.log("  errors:", consoleErrors.slice(0, 10));
    console.log(`[e2e] Failed requests (>=400): ${failedRequests.length}`);
    if (failedRequests.length > 0) console.log("  failed:", failedRequests.slice(0, 10));

    if (consoleErrors.length > 0 || failedRequests.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
    await app.close();
  }
}

main().catch((err) => {
  console.error("[e2e] Fatal error:", err);
  process.exit(1);
});
