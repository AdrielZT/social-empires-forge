export interface RendererMetrics {
  fps: number;
  frameTimeMs: number;
  visibleEntities: number;
  loadedAtlases: number;
}

export const RENDERER_ENGINE = "pixi-v8-webgl2-webgpu" as const;
