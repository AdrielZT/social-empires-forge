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

    // Verify Village drag-mode toggle & Army + Control Group QoL
    const dragBtn = page.locator('[data-testid="btn-drag-mode"]');
    await dragBtn.click();
    await page.waitForTimeout(150);
    await dragBtn.click();

    await page.click('[data-testid="btn-army"]');
    await page.waitForSelector('[data-testid="extended-portrait"]', { timeout: 5000 });
    await page.keyboard.press("Control+2");
    await page.waitForSelector('[data-testid="group-chip-2"]', { timeout: 5000 });
    console.log("[e2e] Army selection, ExtendedPortrait & Control Group [2] verified.");

    // 2. Open Shop Modal, toggle 'Show all' to exercise ItemThumb atlas/crest fallbacks & check 0 broken visible images
    await page.click('[data-testid="btn-shop"]');
    await page.waitForTimeout(600);
    await page.click('[data-testid="shop-show-all"]');
    await page.waitForTimeout(1000);
    const brokenImages = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll("img"));
      return imgs
        .filter((img) => {
          const r = img.getBoundingClientRect();
          const inView = r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight;
          return inView && (!img.complete || img.naturalWidth === 0);
        })
        .map((img) => img.src);
    });
    console.log(`[e2e] Shop Show-All broken visible <img> count: ${brokenImages.length}`);
    if (brokenImages.length > 0) console.log("  broken:", brokenImages.slice(0, 10));
    await page.screenshot({ path: path.join(OUT_DIR, "02_shop_modal.png") });
    await page.click('[data-testid="modal-close"]');

    // 3. Open Systems Modal (Goals + Market) & screenshot
    await page.click('[data-testid="btn-systems"]');
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT_DIR, "03_systems_goals.png") });
    await page.click('[data-testid="modal-close"]');

    // 4. Open World Map & launch a real Quest Battle
    await page.click('[data-testid="btn-worldmap"]');
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT_DIR, "04_world_map.png") });

    // Click first Quest island button
    await page.locator("button", { hasText: "Quest" }).first().click();
    await page.waitForSelector('[data-testid="group-chip-1"]', { timeout: 10000 });
    await page.waitForSelector('[data-testid="extended-portrait"]', { timeout: 10000 });
    await page.waitForTimeout(3000);
    const battleFps = await page.locator('[data-testid="fps-badge"]').innerText();
    console.log(`[e2e] Quest Battle telemetry: ${battleFps}`);
    await page.screenshot({ path: path.join(OUT_DIR, "05_quest_battle.png") });

    console.log(`[e2e] Console errors: ${consoleErrors.length}`);
    if (consoleErrors.length > 0) console.log("  errors:", consoleErrors.slice(0, 10));
    console.log(`[e2e] Failed requests (>=400): ${failedRequests.length}`);
    if (failedRequests.length > 0) console.log("  failed:", failedRequests.slice(0, 10));

    if (consoleErrors.length > 0 || failedRequests.length > 0 || brokenImages.length > 0) {
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
