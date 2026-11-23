import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { CACHE_DIR, UPSTREAM_BRANCH, UPSTREAM_DIR, UPSTREAM_REPO_URL } from "./paths.js";

function main(): void {
  fs.mkdirSync(CACHE_DIR, { recursive: true });

  const localHint = process.env.SE_UPSTREAM_LOCAL_PATH ?? "/tmp/audit/socialemperors-nerroth";

  if (fs.existsSync(UPSTREAM_DIR)) {
    const rev = execFileSync("git", ["-C", UPSTREAM_DIR, "rev-parse", "--short", "HEAD"], {
      encoding: "utf-8"
    }).trim();
    console.log(`[sync-source] Upstream already present at ${UPSTREAM_DIR} (commit ${rev})`);
    return;
  }

  if (fs.existsSync(path.join(localHint, "config", "main.json"))) {
    fs.symlinkSync(localHint, UPSTREAM_DIR, "dir");
    const rev = execFileSync("git", ["-C", UPSTREAM_DIR, "rev-parse", "--short", "HEAD"], {
      encoding: "utf-8"
    }).trim();
    console.log(`[sync-source] Linked local upstream ${localHint} -> ${UPSTREAM_DIR} (commit ${rev})`);
    return;
  }

  console.log(`[sync-source] Cloning ${UPSTREAM_REPO_URL} (branch ${UPSTREAM_BRANCH})...`);
  execFileSync(
    "git",
    ["clone", "--depth=1", "--branch", UPSTREAM_BRANCH, UPSTREAM_REPO_URL, UPSTREAM_DIR],
    { stdio: "inherit" }
  );
  const rev = execFileSync("git", ["-C", UPSTREAM_DIR, "rev-parse", "--short", "HEAD"], {
    encoding: "utf-8"
  }).trim();
  console.log(`[sync-source] Cloned commit ${rev} successfully.`);
}

main();
