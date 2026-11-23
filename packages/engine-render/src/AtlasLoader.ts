import { ImageSource, Rectangle, Texture } from "pixi.js";
import type { SpriteAtlasMetadata, SpriteFrameRect } from "@sef/shared-types";

export interface LoadedSpriteAtlas {
  readonly id: string;
  readonly meta: SpriteAtlasMetadata;
  readonly source: ImageSource;
  readonly textures: ReadonlyMap<string, { texture: Texture; rect: SpriteFrameRect }>;
  lastUsedAt: number;
}

/**
 * On-demand Texture Atlas loader with an LRU VRAM budget so browsing or rendering
 * across 1,786 game items never exhausts GPU memory.
 */
export class AtlasLoader {
  private readonly baseUrl: string;
  private readonly maxLoaded: number;
  private readonly cache = new Map<string, LoadedSpriteAtlas>();
  private readonly inflight = new Map<string, Promise<LoadedSpriteAtlas | null>>();
  private readonly missing = new Set<string>();

  constructor(baseUrl = "/assets", maxLoaded = 300) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.maxLoaded = maxLoaded;
  }

  get loadedCount(): number {
    return this.cache.size;
  }

  getIfLoaded(spriteId: string): LoadedSpriteAtlas | null {
    const entry = this.cache.get(spriteId);
    if (entry) {
      entry.lastUsedAt = performance.now();
      return entry;
    }
    return null;
  }

  async load(spriteId: string): Promise<LoadedSpriteAtlas | null> {
    if (!spriteId || this.missing.has(spriteId)) return null;
    const cached = this.getIfLoaded(spriteId);
    if (cached) return cached;
    const pending = this.inflight.get(spriteId);
    if (pending) return pending;

    const promise = this.fetchAndDecode(spriteId);
    this.inflight.set(spriteId, promise);
    try {
      return await promise;
    } finally {
      this.inflight.delete(spriteId);
    }
  }

  private async fetchAndDecode(spriteId: string): Promise<LoadedSpriteAtlas | null> {
    try {
      const metaRes = await fetch(`${this.baseUrl}/sprites/${encodeURIComponent(spriteId)}.atlas.json`);
      if (!metaRes.ok) {
        this.missing.add(spriteId);
        return null;
      }
      const meta = (await metaRes.json()) as SpriteAtlasMetadata;

      const imgRes = await fetch(`${this.baseUrl}/${meta.atlasImage}`);
      if (!imgRes.ok) {
        this.missing.add(spriteId);
        return null;
      }
      const blob = await imgRes.blob();
      const bitmap = await createImageBitmap(blob);
      const source = new ImageSource({
        resource: bitmap,
        scaleMode: "linear"
      });

      const textures = new Map<string, { texture: Texture; rect: SpriteFrameRect }>();
      for (const [frameKey, rect] of Object.entries(meta.frames)) {
        const frameTex = new Texture({
          source,
          frame: new Rectangle(rect.x, rect.y, rect.w, rect.h)
        });
        textures.set(frameKey, { texture: frameTex, rect });
      }

      const loaded: LoadedSpriteAtlas = {
        id: spriteId,
        meta,
        source,
        textures,
        lastUsedAt: performance.now()
      };

      this.evictIfNeeded();
      this.cache.set(spriteId, loaded);
      return loaded;
    } catch {
      this.missing.add(spriteId);
      return null;
    }
  }

  private evictIfNeeded(): void {
    if (this.cache.size < this.maxLoaded) return;
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [k, v] of this.cache) {
      if (k.startsWith("terreno") || k === "islandbigboss3") continue;
      if (v.lastUsedAt < oldestTime) {
        oldestTime = v.lastUsedAt;
        oldestKey = k;
      }
    }
    if (oldestKey) {
      const evicted = this.cache.get(oldestKey);
      if (evicted) {
        for (const { texture } of evicted.textures.values()) {
          texture.destroy(false);
        }
        evicted.source.destroy();
      }
      this.cache.delete(oldestKey);
    }
  }

  destroy(): void {
    for (const loaded of this.cache.values()) {
      for (const { texture } of loaded.textures.values()) {
        texture.destroy(false);
      }
      loaded.source.destroy();
    }
    this.cache.clear();
  }
}
