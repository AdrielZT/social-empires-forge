import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { AssetManifestSchema, SpriteAtlasMetadataSchema, type GameItem } from "@sef/shared-types";
import { GAME_DATA_DIR, GENERATED_ASSETS_DIR, UPSTREAM_DIR } from "./paths.js";

const REQUIRED_TERRAINS = [
  "terreno",
  "terrenodesierto",
  "terrenohielo",
  "terrenomar2",
  "terrenomineral",
  "terrenonubes",
  "terrenoselva",
  "islandbigboss3"
];

function sha256(filePath: string): string {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function main(): void {
  const spritesDir = path.join(GENERATED_ASSETS_DIR, "sprites");
  const audioIndexPath = path.join(GENERATED_ASSETS_DIR, "audio", "audio-index.json");
  const itemsPath = path.join(GAME_DATA_DIR, "items.json");

  if (!fs.existsSync(spritesDir) || !fs.existsSync(audioIndexPath) || !fs.existsSync(itemsPath)) {
    throw new Error("Missing generated assets or compiled data. Run 'pnpm assets:pipeline' first.");
  }

  const upstreamCommit = fs.existsSync(UPSTREAM_DIR)
    ? execFileSync("git", ["-C", UPSTREAM_DIR, "rev-parse", "--short", "HEAD"], { encoding: "utf-8" }).trim()
    : "unknown";

  const audioIndex = JSON.parse(fs.readFileSync(audioIndexPath, "utf-8")) as {
    sfx: Record<string, { path: string; sha256: string }>;
    music: Record<string, { path: string; sha256: string }>;
  };

  const sprites: Record<string, { atlasJson: string; atlasImage: string; sha256: string; sourceType: "bitmap" | "vector" | "terrain" | "fx" }> = {};
  const atlasJsonFiles = fs.readdirSync(spritesDir).filter((f) => f.endsWith(".atlas.json")).sort();

  for (const fn of atlasJsonFiles) {
    const id = fn.replace(/\.atlas\.json$/, "");
    const jsonPath = path.join(spritesDir, fn);
    const parsed = SpriteAtlasMetadataSchema.parse(JSON.parse(fs.readFileSync(jsonPath, "utf-8")));
    const imgFull = path.join(GENERATED_ASSETS_DIR, parsed.atlasImage);
    if (!fs.existsSync(imgFull)) {
      throw new Error(`Atlas image missing for ${id}: ${imgFull}`);
    }
    const sourceType = REQUIRED_TERRAINS.includes(id) ? "terrain" : "bitmap";
    sprites[id] = {
      atlasJson: `sprites/${fn}`,
      atlasImage: parsed.atlasImage,
      sha256: sha256(imgFull),
      sourceType
    };
  }

  const manifest = AssetManifestSchema.parse({
    version: "1.4.07",
    upstreamCommit,
    generatedAt: new Date().toISOString(),
    sprites,
    audio: audioIndex,
    ui: {
      thumbsDir: "ui/thumbs",
      imagesDir: "ui/images_new",
      externalizedDir: "ui/externalized"
    }
  });

  // Verify coverage assertions
  const missingTerrains = REQUIRED_TERRAINS.filter((t) => !manifest.sprites[t]);
  if (missingTerrains.length > 0) {
    throw new Error(`Missing required terrain sprites: ${missingTerrains.join(", ")}`);
  }

  const sfxCount = Object.keys(manifest.audio.sfx).length;
  const musicCount = Object.keys(manifest.audio.music).length;
  if (sfxCount < 35 || musicCount < 7) {
    throw new Error(`Audio incomplete: sfx=${sfxCount} (expected >=35), music=${musicCount} (expected >=7)`);
  }

  const items = JSON.parse(fs.readFileSync(itemsPath, "utf-8")) as GameItem[];
  const webStoreItems = items.filter((i) => i.inStore && !i.onlyMobile && i.imgName);
  const missingWebStoreSprites = webStoreItems.filter((i) => !manifest.sprites[i.imgName]);

  const manifestPath = path.join(GENERATED_ASSETS_DIR, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));

  console.log("[verify-manifest] Manifest written & validated:", {
    sprites: Object.keys(manifest.sprites).length,
    terrainsOk: `${REQUIRED_TERRAINS.length}/${REQUIRED_TERRAINS.length}`,
    sfx: sfxCount,
    music: musicCount,
    webStoreItems: webStoreItems.length,
    missingWebStoreSprites: missingWebStoreSprites.length
  });

  if (missingWebStoreSprites.length > 0) {
    console.warn(
      "[verify-manifest] Warning: missing store sprites:",
      missingWebStoreSprites.slice(0, 15).map((i) => `${i.id}:${i.imgName}`)
    );
  }
}

main();
