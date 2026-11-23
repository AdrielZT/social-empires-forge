import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = path.resolve(__dirname, "../../..");
export const CACHE_DIR = path.join(REPO_ROOT, ".cache");
export const UPSTREAM_DIR = path.join(CACHE_DIR, "upstream-socialemperors");
export const DECOMPILED_AS3_DIR = path.join(CACHE_DIR, "decompiled-as3");
export const GENERATED_ASSETS_DIR = path.join(REPO_ROOT, "assets", "generated");
export const GAME_DATA_DIR = path.join(REPO_ROOT, "packages", "game-data", "data");
export const UPSTREAM_REPO_URL = "https://github.com/AcidCaos/socialemperors.git";
export const UPSTREAM_BRANCH = "nerroth-rewrite";
