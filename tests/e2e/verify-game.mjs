import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "../../apps/server/src/index.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const OUT_DIR = process.env.E2E_SCREENSHOT_DIR ?? path.join(REPO_ROOT, "test-results");

function resolveChromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser"
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return "/usr/bin/google-chrome";
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const app = await createServer({ dbPath: ":memory:" });
  const address = await app.listen({ port: 0, host: "127.0.0.1" });
  console.log(`[e2e] Server started at ${address}`);

  const chromePath = resolveChromePath();
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
    await page.waitForTimeout(2000);

    const fpsText = await page.locator('[data-testid="fps-badge"]').innerText();
    console.log(`[e2e] Initial Village telemetry: ${fpsText}`);

    // 1. Verify Dragon Nest animated atlas (1233_criadero) & Farm 45-frame atlas (granja1)
    const atlasCheck = await page.evaluate(async () => {
      const nest = await fetch("/assets/sprites/1233_criadero.atlas.json").then((r) => r.json());
      const farm = await fetch("/assets/sprites/granja1.atlas.json").then((r) => r.json());
      return {
        nestMode: nest.animMode,
        nestFrames: nest.animations?.f1?.frames?.length ?? 0,
        farmMode: farm.animMode,
        farmFrames: farm.animations?.f1?.frames?.length ?? 0
      };
    });
    console.log(`[e2e] Atlas verification:`, atlasCheck);
    if (atlasCheck.nestMode !== "loop" || atlasCheck.nestFrames < 10) {
      throw new Error(`Expected animated 1233_criadero loop atlas, got ${JSON.stringify(atlasCheck)}`);
    }
    if (atlasCheck.farmFrames < 45) {
      throw new Error(`Expected 45-frame granja1 atlas, got ${JSON.stringify(atlasCheck)}`);
    }

    // 2. Verify Classic Bottom Bar: Friends Dock (King Arthur) + Explicit Cursor Tools (Normal / Sell / Area)
    await page.waitForSelector('[data-testid="friends-dock"]', { timeout: 5000 });
    await page.waitForSelector('[data-testid="friend-card-king"]', { timeout: 5000 });
    await page.waitForSelector('[data-testid="tool-cursor-normal"]', { timeout: 5000 });
    await page.waitForSelector('[data-testid="tool-cursor-bulldoze"]', { timeout: 5000 });
    await page.waitForSelector('[data-testid="tool-cursor-box"]', { timeout: 5000 });

    // Toggle cursor tools cleanly
    await page.click('[data-testid="tool-cursor-box"]');
    await page.waitForTimeout(120);
    await page.click('[data-testid="tool-cursor-bulldoze"]');
    await page.waitForTimeout(120);
    await page.click('[data-testid="tool-cursor-normal"]');
    await page.waitForTimeout(120);

    // Screenshot 1: Classic Village with Friends Dock, King, Cursor Tools & User/Admin Toggle
    await page.screenshot({ path: path.join(OUT_DIR, "01_village_es.png") });

    // Verify King Arthur neighbor visit & return home WITHOUT tutorial
    await page.click('[data-testid="friend-card-king"]');
    await page.waitForSelector('[data-testid="btn-visit-neighbor"]', { timeout: 5000 });
    await page.click('[data-testid="btn-visit-neighbor"]');
    await page.waitForSelector('[data-testid="visit-banner"]', { timeout: 10000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT_DIR, "06_visit_king.png") });
    await page.click('[data-testid="btn-return-from-visit"]');
    await page.waitForSelector('[data-testid="visit-banner"]', { state: "detached", timeout: 8000 });
    console.log("[e2e] Classic Friends Dock, King visit, and cursor tools verified.");

    // Verify Army selection & Control Group [2]
    await page.click('[data-testid="btn-army"]');
    await page.waitForSelector('[data-testid="extended-portrait"]', { timeout: 5000 });
    await page.keyboard.press("Control+2");
    await page.waitForSelector('[data-testid="group-chip-2"]', { timeout: 5000 });
    console.log("[e2e] Army selection, ExtendedPortrait & Control Group [2] verified.");

    // 3. Verify Shop User Mode (locked items) vs Admin Mode (all unlocked) WITHOUT losing save
    await page.click('[data-testid="btn-shop"]');
    await page.waitForTimeout(500);
    const lockedCountUser = await page.locator('[data-testid^="shop-item-locked-"]').count();
    console.log(`[e2e] Shop User Mode locked cards visible: ${lockedCountUser}`);
    if (lockedCountUser === 0) {
      throw new Error("Expected locked level-gated items in Shop User Mode!");
    }
    await page.screenshot({ path: path.join(OUT_DIR, "02_shop_user_mode.png") });

    // Switch to Admin Mode inside Shop -> locked cards must become 0!
    await page.click('[data-testid="shop-mode-admin"]');
    await page.waitForTimeout(400);
    const lockedCountAdmin = await page.locator('[data-testid^="shop-item-locked-"]').count();
    if (lockedCountAdmin !== 0) {
      throw new Error(`Expected 0 locked items in Admin Mode, got ${lockedCountAdmin}`);
    }
    await page.click('[data-testid="shop-show-all"]');
    await page.waitForTimeout(800);
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
    console.log(`[e2e] Shop Admin Show-All broken visible <img> count: ${brokenImages.length}`);
    if (brokenImages.length > 0) console.log("  broken:", brokenImages.slice(0, 10));
    await page.screenshot({ path: path.join(OUT_DIR, "02_shop_admin_mode.png") });
    // Switch back to User Mode cleanly
    await page.click('[data-testid="shop-mode-user"]');
    await page.click('[data-testid="modal-close"]');

    // 4. Open Systems Modal (Goals) and claim 2 goals (+50 XP from 30 -> 80 XP) to trigger Classic Level Up Modal!
    await page.click('[data-testid="btn-systems"]');
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT_DIR, "03_systems_goals.png") });
    const claimBtns = page.locator('[data-testid="btn-claim-goal"]:not([disabled])');
    await claimBtns.first().click();
    await page.waitForTimeout(350);
    await claimBtns.first().click();
    await page.waitForSelector('[data-testid="level-up-modal"]', { timeout: 6000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT_DIR, "07_level_up_modal.png") });
    await page.click('[data-testid="level-up-close"]');
    await page.waitForSelector('[data-testid="level-up-modal"]', { state: "detached", timeout: 5000 });
    await page.click('[data-testid="modal-close"]');
    const hudLevel = await page.locator('[data-testid="hud-level-badge"]').innerText();
    console.log(`[e2e] Level Up Modal verified! New HUD level: ${hudLevel}`);
    if (Number(hudLevel) < 3) {
      throw new Error(`Expected HUD level >= 3 after claiming goals, got ${hudLevel}`);
    }

    // 5. Open World Map & launch a real Quest Battle
    await page.click('[data-testid="btn-worldmap"]');
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT_DIR, "04_world_map.png") });

    await page.locator("button", { hasText: "Quest" }).first().click();
    await page.waitForSelector('[data-testid="group-chip-1"]', { timeout: 10000 });
    await page.waitForSelector('[data-testid="extended-portrait"]', { timeout: 10000 });
    await page.waitForTimeout(2500);
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
