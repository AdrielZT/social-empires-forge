import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { CACHE_DIR, UPSTREAM_DIR } from "./paths.js";

const FFDEC_DIR = path.join(CACHE_DIR, "tools", "ffdec");
const FFDEC_JAR = path.join(FFDEC_DIR, "ffdec.jar");

function resolveFfdecJar(): string {
  const candidates = [
    process.env.SE_FFDEC_JAR,
    FFDEC_JAR,
    "/tmp/se-canonical-research/ffdec/ffdec.jar"
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  fs.mkdirSync(FFDEC_DIR, { recursive: true });
  console.log("[patch-animated-buildings] Fetching JPEXS FFDec (GPLv3, $0)...");
  const url = execFileSync(
    "gh",
    [
      "api",
      "repos/jindrapetrik/jpexs-decompiler/releases/latest",
      "--jq",
      '.assets[] | select(.name | test("ffdec_[0-9.]+\\\\.zip$")) | .browser_download_url'
    ],
    { encoding: "utf-8" }
  )
    .trim()
    .split("\n")[0];
  if (!url) throw new Error("Unable to resolve JPEXS FFDec download URL");
  const zipPath = path.join(FFDEC_DIR, "ffdec.zip");
  execFileSync("curl", ["-fsSL", "-o", zipPath, url], { stdio: "inherit" });
  execFileSync("python3", ["-m", "zipfile", "-e", zipPath, FFDEC_DIR], { stdio: "inherit" });
  fs.rmSync(zipPath, { force: true });
  return FFDEC_JAR;
}

function main(): void {
  const hasUpstream =
    fs.existsSync(path.join(UPSTREAM_DIR, "assets", "buildingsprites")) ||
    fs.existsSync("/tmp/se-canonical-research/upstream/assets/buildingsprites") ||
    (process.env.SE_UPSTREAM_DIR && fs.existsSync(path.join(process.env.SE_UPSTREAM_DIR, "assets", "buildingsprites")));

  if (!hasUpstream) {
    const syncScript = path.join(path.dirname(fileURLToPath(import.meta.url)), "sync-source.ts");
    execFileSync("pnpm", ["exec", "tsx", syncScript], { stdio: "inherit" });
  }

  const resolvedUpstream = fs.existsSync(path.join(UPSTREAM_DIR, "assets", "buildingsprites"))
    ? UPSTREAM_DIR
    : "/tmp/se-canonical-research/upstream";

  const jar = resolveFfdecJar();
  const pyBin = process.platform === "win32" ? "python" : "python3";
  const pyScript = path.join(path.dirname(fileURLToPath(import.meta.url)), "patch_animated_buildings.py");
  execFileSync(pyBin, [pyScript], {
    stdio: "inherit",
    env: {
      ...process.env,
      SE_FFDEC_JAR: jar,
      SE_UPSTREAM_DIR: process.env.SE_UPSTREAM_DIR ?? resolvedUpstream
    }
  });
}

main();
