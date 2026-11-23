import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const basePath = process.env.VITE_BASE_PATH ?? "/social-empires-forge/";
const webDistDir = path.join(REPO_ROOT, "apps", "web", "dist");
const gameDataSrcDir = path.join(REPO_ROOT, "packages", "game-data", "data");
const gameDataDestDir = path.join(webDistDir, "game-data");

function buildMapsIndex(mapsDir) {
  if (!fs.existsSync(mapsDir)) return [];
  const entries = [];

  for (const fn of fs.readdirSync(mapsDir).sort()) {
    if (!fn.endsWith(".json")) continue;
    const stem = fn.replace(/\.json$/, "");
    entries.push({ key: stem, category: "village", label: stem, file: `maps/${fn}` });
  }

  const friendDir = path.join(mapsDir, "friend_static");
  if (fs.existsSync(friendDir)) {
    for (const fn of fs.readdirSync(friendDir).sort()) {
      if (!fn.endsWith(".json")) continue;
      const stem = fn.replace(/\.save\.json$/, "").replace(/\.json$/, "");
      entries.push({
        key: `friend/${stem}`,
        category: "friend",
        label: `Amigo: ${stem}`,
        file: `maps/friend_static/${fn}`
      });
    }
  }

  const questsDir = path.join(mapsDir, "quests");
  const quests1407Dir = path.join(mapsDir, "quests_1407");
  if (fs.existsSync(questsDir)) {
    for (const fn of fs.readdirSync(questsDir).sort()) {
      if (!fn.endsWith(".json")) continue;
      const stem = fn.replace(/\.save\.json$/, "").replace(/\.json$/, "");
      const override1407 = path.join(quests1407Dir, `${stem}.save.json`);
      const file = fs.existsSync(override1407) ? `maps/quests_1407/${stem}.save.json` : `maps/quests/${fn}`;
      entries.push({
        key: `quest/${stem}`,
        category: "quest",
        label: `Quest ${stem}`,
        file
      });
    }
  }

  return entries;
}

console.log(`[prepare-pages] Building @sef/web in static mode (VITE_BASE_PATH=${basePath})...`);
const pnpmBin = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
execFileSync(pnpmBin, ["--filter", "@sef/web", "build"], {
  cwd: REPO_ROOT,
  stdio: "inherit",
  env: {
    ...process.env,
    VITE_BASE_PATH: basePath,
    VITE_STATIC_MODE: "true"
  }
});

if (!fs.existsSync(gameDataSrcDir)) {
  throw new Error(`Missing compiled game data at ${gameDataSrcDir}`);
}

fs.rmSync(gameDataDestDir, { recursive: true, force: true });
fs.cpSync(gameDataSrcDir, gameDataDestDir, { recursive: true });

const mapsIndex = buildMapsIndex(path.join(gameDataSrcDir, "maps"));
fs.writeFileSync(
  path.join(gameDataDestDir, "maps-index.json"),
  JSON.stringify({ maps: mapsIndex }, null, 2)
);

// Prevent GitHub Pages Jekyll from ignoring files/folders starting with underscore
fs.writeFileSync(path.join(webDistDir, ".nojekyll"), "");

console.log(`[prepare-pages] Copied game-data and indexed ${mapsIndex.length} maps into ${webDistDir}`);
