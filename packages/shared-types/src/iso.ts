import { z } from "zod";

/**
 * Isometric constants faithful to Social Empires 1.4.07 (`IsoEngine.as`).
 * The world map is a 100x100 tile grid partitioned into a 5x5 matrix of 20x20 expansions.
 * Expansion index 13 (1-indexed: col=2, row=2 -> tiles 40..59, 40..59) is the starting territory.
 */
export const MAP_SIZE_TILES = 100;
export const EXPANSION_SIZE_TILES = 20;
export const EXPANSION_GRID_DIM = 5; // 5x5 = 25 expansions (IDs 1..25)
export const INITIAL_EXPANSION_ID = 13;

/**
 * Isometric tile projection dimensions in pixels (exact 2:1 diamond ratio).
 * Verified directly from upstream SWF geometry:
 * - terreno.swf (20x20 expansion) = 2160 x 1080 px -> 108 x 54 px per tile
 * - casa1.swf (2x2 building) = 216 x 166 px -> 2 * 108 px width
 */
export const ISO_TILE_WIDTH = 108;
export const ISO_TILE_HEIGHT = 54;

export const SIM_TICK_HZ = 30;
export const SIM_TICK_MS = 1000 / SIM_TICK_HZ;

export interface TileCoord {
  tx: number;
  ty: number;
}

export interface ScreenCoord {
  x: number;
  y: number;
}

/**
 * Converts isometric grid coordinates (tx, ty) to world-space pixel coordinates (x, y).
 * Standard diamond projection matching Flash Social Empires IsoEngine:
 * +tx moves down-right, +ty moves down-left.
 */
export function tileToScreen(
  tx: number,
  ty: number,
  tileW = ISO_TILE_WIDTH,
  tileH = ISO_TILE_HEIGHT
): ScreenCoord {
  return {
    x: (tx - ty) * (tileW * 0.5),
    y: (tx + ty) * (tileH * 0.5)
  };
}

/**
 * Converts world-space pixel coordinates (x, y) back into continuous tile coordinates (tx, ty).
 */
export function screenToTile(
  x: number,
  y: number,
  tileW = ISO_TILE_WIDTH,
  tileH = ISO_TILE_HEIGHT
): TileCoord {
  const halfW = tileW * 0.5;
  const halfH = tileH * 0.5;
  return {
    tx: (x / halfW + y / halfH) * 0.5,
    ty: (y / halfH - x / halfW) * 0.5
  };
}

/**
 * Returns the 1-based expansion index (1..25) containing tile (tx, ty), matching IsoEngine.getLargeTile.
 */
export function tileToExpansionId(tx: number, ty: number): number {
  const col = Math.floor(tx / EXPANSION_SIZE_TILES);
  const row = Math.floor(ty / EXPANSION_SIZE_TILES);
  if (col < 0 || col >= EXPANSION_GRID_DIM || row < 0 || row >= EXPANSION_GRID_DIM) {
    return -1;
  }
  return row * EXPANSION_GRID_DIM + col + 1;
}

export function expansionIdToBounds(expansionId: number): {
  minTx: number;
  minTy: number;
  maxTx: number;
  maxTy: number;
} {
  const idx = expansionId - 1;
  const row = Math.floor(idx / EXPANSION_GRID_DIM);
  const col = idx % EXPANSION_GRID_DIM;
  const minTx = col * EXPANSION_SIZE_TILES;
  const minTy = row * EXPANSION_SIZE_TILES;
  return {
    minTx,
    minTy,
    maxTx: minTx + EXPANSION_SIZE_TILES - 1,
    maxTy: minTy + EXPANSION_SIZE_TILES - 1
  };
}

/**
 * 8 isometric facing directions; SWF sprites store 5 canonical directions (0..4)
 * and horizontally flip (scaleX = -1) for the remaining 3 mirrored directions.
 */
export type Direction8 = "S" | "SW" | "W" | "NW" | "N" | "NE" | "E" | "SE";

export const SpriteFrameRectSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  w: z.number().int(),
  h: z.number().int(),
  anchorX: z.number(),
  anchorY: z.number()
});
export type SpriteFrameRect = z.infer<typeof SpriteFrameRectSchema>;

export const SpriteAnimationSchema = z.object({
  frames: z.array(z.string()),
  loop: z.boolean().default(true)
});
export type SpriteAnimation = z.infer<typeof SpriteAnimationSchema>;

export const SpriteAtlasMetadataSchema = z.object({
  id: z.string(),
  fps: z.number().positive(),
  atlasImage: z.string(),
  atlasWidth: z.number().int().positive(),
  atlasHeight: z.number().int().positive(),
  rootFrames: z.number().int().positive(),
  frames: z.record(z.string(), SpriteFrameRectSchema),
  animations: z.record(z.string(), SpriteAnimationSchema)
});
export type SpriteAtlasMetadata = z.infer<typeof SpriteAtlasMetadataSchema>;

export const AssetManifestSchema = z.object({
  version: z.string(),
  upstreamCommit: z.string(),
  generatedAt: z.string(),
  sprites: z.record(z.string(), z.object({
    atlasJson: z.string(),
    atlasImage: z.string(),
    sha256: z.string(),
    sourceType: z.enum(["bitmap", "vector", "terrain", "fx"])
  })),
  audio: z.object({
    sfx: z.record(z.string(), z.object({ path: z.string(), sha256: z.string() })),
    music: z.record(z.string(), z.object({ path: z.string(), sha256: z.string() }))
  }),
  ui: z.object({
    thumbsDir: z.string(),
    imagesDir: z.string(),
    externalizedDir: z.string()
  })
});
export type AssetManifest = z.infer<typeof AssetManifestSchema>;
