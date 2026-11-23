import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { CACHE_DIR, DECOMPILED_AS3_DIR, GENERATED_ASSETS_DIR, UPSTREAM_DIR } from "./paths.js";

const FFDEC_DIR = path.join(CACHE_DIR, "tools", "ffdec");
const FFDEC_JAR = path.join(FFDEC_DIR, "ffdec.jar");

function findMainSpriteId(swfPath: string, spriteId: string): number | null {
  try {
    const raw = fs.readFileSync(swfPath);
    if (raw.length < 12) return null;
    const sig = raw.subarray(0, 3).toString("ascii");
    let body: Buffer;
    if (sig === "CWS") body = zlib.inflateSync(raw.subarray(8));
    else if (sig === "FWS") body = raw.subarray(8);
    else return null;

    // Skip SWF RECT (nbits 5-bit header + 4*nbits padded to byte) + 2B fps + 2B frameCount
    const nbits = body[0]! >> 3;
    const rectBytes = Math.ceil((5 + 4 * nbits) / 8);
    let pos = rectBytes + 4;

    const spriteIds = new Set<number>();
    const spriteFrameCounts = new Map<number, number>();
    const symbols: { cid: number; name: string }[] = [];

    while (pos + 2 <= body.length) {
      const tagCodeAndLen = body.readUInt16LE(pos);
      pos += 2;
      const tagType = tagCodeAndLen >> 6;
      let tagLen = tagCodeAndLen & 0x3f;
      if (tagLen === 0x3f) {
        if (pos + 4 > body.length) break;
        tagLen = body.readUInt32LE(pos);
        pos += 4;
      }
      if (pos + tagLen > body.length) break;
      const td = body.subarray(pos, pos + tagLen);
      pos += tagLen;

      if (tagType === 39 && td.length >= 4) {
        const cid = td.readUInt16LE(0);
        const fcnt = td.readUInt16LE(2);
        spriteIds.add(cid);
        spriteFrameCounts.set(cid, fcnt);
      } else if (tagType === 76 && td.length >= 2) {
        const count = td.readUInt16LE(0);
        let p = 2;
        for (let i = 0; i < count && p + 2 <= td.length; i++) {
          const cid = td.readUInt16LE(p);
          p += 2;
          const zero = td.indexOf(0, p);
          if (zero === -1) break;
          const name = td.subarray(p, zero).toString("utf-8");
          p = zero + 1;
          symbols.push({ cid, name });
        }
      } else if (tagType === 0) {
        break;
      }
    }

    for (const s of symbols) {
      if (spriteIds.has(s.cid) && s.name.toLowerCase() === spriteId.toLowerCase()) {
        return s.cid;
      }
    }
    for (const s of symbols) {
      if (spriteIds.has(s.cid) && s.cid !== 0) return s.cid;
    }
    let bestCid: number | null = null;
    let bestFrames = -1;
    for (const [cid, fcnt] of spriteFrameCounts) {
      if (fcnt > bestFrames) {
        bestFrames = fcnt;
        bestCid = cid;
      }
    }
    return bestCid;
  } catch {
    return null;
  }
}

async function ensureFfdec(): Promise<string> {
  if (fs.existsSync(FFDEC_JAR)) {
    return FFDEC_JAR;
  }
  fs.mkdirSync(FFDEC_DIR, { recursive: true });
  console.log("[decompile-as3] Fetching latest JPEXS FFDec (GPLv3, $0) release metadata from GitHub...");
  const apiJson = execFileSync(
    "gh",
    ["api", "repos/jindrapetrik/jpexs-decompiler/releases/latest", "--jq", ".assets[] | select(.name | test(\"ffdec_[0-9.]+\\\\.zip$\")) | .browser_download_url"],
    { encoding: "utf-8" }
  ).trim().split("\n")[0];

  if (!apiJson) {
    throw new Error("Could not locate JPEXS FFDec release zip asset from GitHub API.");
  }

  const zipPath = path.join(FFDEC_DIR, "ffdec.zip");
  console.log(`[decompile-as3] Downloading ${apiJson}...`);
  execFileSync("curl", ["-fsSL", "-o", zipPath, apiJson], { stdio: "inherit" });
  execFileSync("python3", ["-m", "zipfile", "-e", zipPath, FFDEC_DIR], { stdio: "inherit" });
  fs.rmSync(zipPath, { force: true });

  if (!fs.existsSync(FFDEC_JAR)) {
    throw new Error(`Expected ${FFDEC_JAR} after extraction.`);
  }
  return FFDEC_JAR;
}

function runFfdec(jar: string, args: string[]): void {
  execFileSync("java", ["-Xmx2g", "-jar", jar, ...args], { stdio: "inherit" });
}

async function main(): Promise<void> {
  const mainSwf = path.join(UPSTREAM_DIR, "assets", "flash", "SocialEmpires1.4.07sec_fixed.swf");
  if (!fs.existsSync(mainSwf)) {
    throw new Error(`Missing ${mainSwf}. Run "pnpm assets:sync" first.`);
  }

  const jar = await ensureFfdec();

  // 1. Decompile all 1,954 AS3 classes of SocialEmpires1.4.07sec_fixed.swf for exact reference
  if (!fs.existsSync(path.join(DECOMPILED_AS3_DIR, "scripts"))) {
    fs.mkdirSync(DECOMPILED_AS3_DIR, { recursive: true });
    console.log("[decompile-as3] Decompiling SocialEmpires1.4.07sec_fixed.swf AS3 source -> .cache/decompiled-as3/scripts ...");
    runFfdec(jar, ["-export", "script", path.join(DECOMPILED_AS3_DIR, "scripts"), mainSwf]);
  } else {
    console.log("[decompile-as3] AS3 scripts already decompiled at .cache/decompiled-as3/scripts");
  }

  // 2. Rasterize any pure-vector buildingsprites/*.swf reported by extract_sprites.py with alpha transparency
  const reportPath = path.join(GENERATED_ASSETS_DIR, "sprites-extract-report.json");
  const forceVector = process.env.SE_VECTOR_FORCE === "1";
  if (fs.existsSync(reportPath)) {
    const report = JSON.parse(fs.readFileSync(reportPath, "utf-8")) as {
      vectorOnly?: { id: string; swf: string }[];
    };
    const vectorList = report.vectorOnly ?? [];
    if (vectorList.length > 0) {
      const vecTmp = path.join(CACHE_DIR, "vector-frames");
      if (forceVector) fs.rmSync(vecTmp, { recursive: true, force: true });
      fs.mkdirSync(vecTmp, { recursive: true });
      console.log(`[decompile-as3] Exporting ${vectorList.length} pure-vector SWFs (transparent DefineSprite) via JPEXS FFDec...`);
      let idx = 0;
      for (const entry of vectorList) {
        idx += 1;
        const outSub = path.join(vecTmp, entry.id);
        if (!forceVector && fs.existsSync(path.join(GENERATED_ASSETS_DIR, "sprites", `${entry.id}.webp`))) continue;
        fs.rmSync(outSub, { recursive: true, force: true });
        fs.mkdirSync(outSub, { recursive: true });
        if (idx % 10 === 1 || idx === vectorList.length) {
          console.log(`[decompile-as3]   vector ${idx}/${vectorList.length}: ${entry.id}`);
        }
        const swfPath = path.isAbsolute(entry.swf)
          ? entry.swf
          : path.join(UPSTREAM_DIR, "assets", "buildingsprites", `${entry.id}.swf`);
        const mainCid = findMainSpriteId(swfPath, entry.id);
        let exported = false;
        if (mainCid !== null) {
          try {
            execFileSync(
              "java",
              ["-Xmx1g", "-jar", jar, "-selectid", String(mainCid), "-format", "sprite:png", "-export", "sprite", outSub, swfPath],
              { stdio: "pipe", timeout: 40000 }
            );
            exported = fs.readdirSync(outSub).length > 0;
          } catch {
            exported = false;
          }
        }
        if (!exported) {
          try {
            execFileSync(
              "java",
              ["-Xmx1g", "-jar", jar, "-format", "sprite:png", "-export", "sprite", outSub, swfPath],
              { stdio: "pipe", timeout: 40000 }
            );
            exported = fs.readdirSync(outSub).length > 0;
          } catch {
            exported = false;
          }
        }
        if (!exported) {
          try {
            execFileSync(
              "java",
              ["-Xmx1g", "-jar", jar, "-format", "frame:png", "-export", "frame", outSub, swfPath],
              { stdio: "pipe", timeout: 40000 }
            );
          } catch {
            // Recorded as skipped if corrupted upstream SWF
          }
        }
      }
      // Pack rasterized vector PNGs into WebP atlases
      const pyBin = process.platform === "win32" ? "python" : "python3";
      const packScript = path.join(path.dirname(fileURLToPath(import.meta.url)), "pack_vector_frames.py");
      execFileSync(pyBin, [packScript], {
        stdio: "inherit"
      });
    }
  }

  console.log("[decompile-as3] Completed.");
}

main().catch((err) => {
  console.error("[decompile-as3] Failed:", err);
  process.exit(1);
});
