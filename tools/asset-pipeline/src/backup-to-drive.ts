import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { CACHE_DIR, GENERATED_ASSETS_DIR } from "./paths.js";

const DRIVE_FOLDER_ID = process.env.SE_DRIVE_FOLDER_ID ?? "1Itx7mMvNxEyLsan7m0Brf4eCIvd59lRO";

function main(): void {
  const manifestPath = path.join(GENERATED_ASSETS_DIR, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error("manifest.json missing. Run 'pnpm assets:pipeline' before backing up to Drive.");
  }

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const archivePath = path.join(CACHE_DIR, "social-empires-forge-assets-1.4.07.tar.gz");
  console.log(`[backup-drive] Packaging compiled assets into ${archivePath}...`);
  execFileSync("tar", ["-czf", archivePath, "-C", GENERATED_ASSETS_DIR, "."], { stdio: "inherit" });

  const sizeMb = (fs.statSync(archivePath).size / (1024 * 1024)).toFixed(1);
  console.log(`[backup-drive] Archive ready (${sizeMb} MB). Uploading to Google Drive folder ${DRIVE_FOLDER_ID}...`);

  let existingId: string | null = null;
  try {
    const lsJson = execFileSync(
      "gdrive",
      ["readonly", "ls", DRIVE_FOLDER_ID, "--json"],
      { encoding: "utf-8" }
    );
    const parsed = JSON.parse(lsJson) as { files?: { id: string; name: string }[] } | { id: string; name: string }[];
    const list = Array.isArray(parsed) ? parsed : (parsed.files ?? []);
    const match = list.find((f) => f.name === "social-empires-forge-assets-1.4.07.tar.gz");
    if (match) existingId = match.id;
  } catch {
    // Proceed with fresh upload if listing format differs
  }

  if (existingId) {
    execFileSync(
      "gdrive",
      ["mutate", "update", existingId, archivePath, "--mime-type", "application/gzip"],
      { stdio: "inherit" }
    );
  } else {
    execFileSync(
      "gdrive",
      ["mutate", "upload", archivePath, "--parent", DRIVE_FOLDER_ID, "--mime-type", "application/gzip"],
      { stdio: "inherit" }
    );
  }
  console.log("[backup-drive] Upload complete.");
}

main();
