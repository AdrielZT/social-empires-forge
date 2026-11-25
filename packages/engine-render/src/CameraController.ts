import { ISO_TILE_HEIGHT, ISO_TILE_WIDTH, MAP_SIZE_TILES, screenToTile, tileToScreen, type TileCoord } from "@sef/shared-types";

export interface CameraState {
  x: number;
  y: number;
  zoom: number;
  viewportW: number;
  viewportH: number;
}

export class CameraController {
  x = 0;
  y = 0;
  zoom = 0.85;
  viewportW = 1280;
  viewportH = 720;

  readonly minZoom = 0.28;
  readonly maxZoom = 2.0;

  private targetX = 0;
  private targetY = 0;
  private targetZoom = 0.85;
  private zoomAnchorScreenX: number | null = null;
  private zoomAnchorScreenY: number | null = null;
  private smoothActive = false;

  private shakeMagnitude = 0;
  private shakeDecay = 0.88;

  constructor(viewportW = 1280, viewportH = 720) {
    this.viewportW = viewportW;
    this.viewportH = viewportH;
    this.centerOnTile(50, 50);
  }

  resize(width: number, height: number): void {
    this.viewportW = Math.max(1, width);
    this.viewportH = Math.max(1, height);
    this.clamp();
    this.targetX = this.x;
    this.targetY = this.y;
  }

  centerOnTile(tx: number, ty: number): void {
    const p = tileToScreen(tx, ty);
    this.x = p.x;
    this.y = p.y;
    this.clamp();
    this.targetX = this.x;
    this.targetY = this.y;
    this.zoomAnchorScreenX = null;
    this.zoomAnchorScreenY = null;
    this.smoothActive = false;
  }

  /**
   * Smoothly pans the camera to `(tx, ty)` using framerate-independent exponential damping.
   */
  smoothCenterOnTile(tx: number, ty: number): void {
    const p = tileToScreen(tx, ty);
    const clamped = this.clampCoords(p.x, p.y);
    this.targetX = clamped.x;
    this.targetY = clamped.y;
    this.zoomAnchorScreenX = null;
    this.zoomAnchorScreenY = null;
    this.smoothActive = true;
  }

  panByScreenDelta(dx: number, dy: number): void {
    this.x -= dx / this.zoom;
    this.y -= dy / this.zoom;
    this.clamp();
    this.targetX = this.x;
    this.targetY = this.y;
    this.zoomAnchorScreenX = null;
    this.zoomAnchorScreenY = null;
  }

  zoomAtScreenPoint(factor: number, screenX: number, screenY: number): void {
    const before = this.screenToWorld(screenX, screenY);
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * factor));
    const after = this.screenToWorld(screenX, screenY);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
    this.clamp();
    this.targetX = this.x;
    this.targetY = this.y;
    this.targetZoom = this.zoom;
    this.zoomAnchorScreenX = null;
    this.zoomAnchorScreenY = null;
  }

  /**
   * Queues a smooth zoom transition anchored under `(screenX, screenY)`.
   */
  smoothZoomAtScreenPoint(factor: number, screenX: number, screenY: number): void {
    this.targetZoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.targetZoom * factor));
    this.zoomAnchorScreenX = screenX;
    this.zoomAnchorScreenY = screenY;
    this.smoothActive = true;
  }

  setZoom(nextZoom: number): void {
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, nextZoom));
    this.targetZoom = this.zoom;
    this.zoomAnchorScreenX = null;
    this.zoomAnchorScreenY = null;
    this.clamp();
  }

  /**
   * Advances smooth camera pan/zoom interpolation cleanly at any display refresh rate (60-240 Hz).
   */
  update(dtMs: number): void {
    if (!this.smoothActive) return;
    const dtSec = Math.max(0.001, Math.min(0.1, dtMs / 1000));
    const alpha = 1 - Math.exp(-13 * dtSec);

    let settled = true;

    if (Math.abs(this.targetZoom - this.zoom) > 0.0015) {
      settled = false;
      const nextZoom = this.zoom + (this.targetZoom - this.zoom) * alpha;
      if (this.zoomAnchorScreenX !== null && this.zoomAnchorScreenY !== null) {
        const before = this.screenToWorld(this.zoomAnchorScreenX, this.zoomAnchorScreenY);
        this.zoom = nextZoom;
        const after = this.screenToWorld(this.zoomAnchorScreenX, this.zoomAnchorScreenY);
        this.x += before.x - after.x;
        this.y += before.y - after.y;
        this.targetX = this.x;
        this.targetY = this.y;
      } else {
        this.zoom = nextZoom;
      }
    } else if (this.zoom !== this.targetZoom) {
      if (this.zoomAnchorScreenX !== null && this.zoomAnchorScreenY !== null) {
        const before = this.screenToWorld(this.zoomAnchorScreenX, this.zoomAnchorScreenY);
        this.zoom = this.targetZoom;
        const after = this.screenToWorld(this.zoomAnchorScreenX, this.zoomAnchorScreenY);
        this.x += before.x - after.x;
        this.y += before.y - after.y;
        this.targetX = this.x;
        this.targetY = this.y;
      } else {
        this.zoom = this.targetZoom;
      }
      this.zoomAnchorScreenX = null;
      this.zoomAnchorScreenY = null;
    }

    if (Math.hypot(this.targetX - this.x, this.targetY - this.y) > 0.6) {
      settled = false;
      this.x += (this.targetX - this.x) * alpha;
      this.y += (this.targetY - this.y) * alpha;
    } else {
      this.x = this.targetX;
      this.y = this.targetY;
    }

    this.clamp();
    if (settled) {
      this.smoothActive = false;
    }
  }

  triggerShake(magnitude: number): void {
    this.shakeMagnitude = Math.max(this.shakeMagnitude, magnitude);
  }

  screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    return {
      x: (screenX - this.viewportW * 0.5) / this.zoom + this.x,
      y: (screenY - this.viewportH * 0.5) / this.zoom + this.y
    };
  }

  worldToScreen(worldX: number, worldY: number): { x: number; y: number } {
    return {
      x: (worldX - this.x) * this.zoom + this.viewportW * 0.5,
      y: (worldY - this.y) * this.zoom + this.viewportH * 0.5
    };
  }

  getWorldTransform(): { x: number; y: number; scale: number } {
    let ox = 0;
    let oy = 0;
    if (this.shakeMagnitude > 0.25) {
      ox = (Math.random() * 2 - 1) * this.shakeMagnitude;
      oy = (Math.random() * 2 - 1) * this.shakeMagnitude;
      this.shakeMagnitude *= this.shakeDecay;
    } else {
      this.shakeMagnitude = 0;
    }
    return {
      x: this.viewportW * 0.5 - this.x * this.zoom + ox,
      y: this.viewportH * 0.5 - this.y * this.zoom + oy,
      scale: this.zoom
    };
  }

  getVisibleWorldBounds(marginPx = 320): { minX: number; minY: number; maxX: number; maxY: number } {
    const tl = this.screenToWorld(-marginPx, -marginPx);
    const br = this.screenToWorld(this.viewportW + marginPx, this.viewportH + marginPx);
    return { minX: tl.x, minY: tl.y, maxX: br.x, maxY: br.y };
  }

  /**
   * Returns the 4 viewport corners in continuous isometric tile coordinates
   * for rendering the live camera viewport rectangle on the Minimap.
   */
  getViewportTileQuad(): [TileCoord, TileCoord, TileCoord, TileCoord] {
    const corners: [number, number][] = [
      [0, 0],
      [this.viewportW, 0],
      [this.viewportW, this.viewportH],
      [0, this.viewportH]
    ];
    return corners.map(([sx, sy]) => {
      const w = this.screenToWorld(sx, sy);
      return screenToTile(w.x, w.y);
    }) as [TileCoord, TileCoord, TileCoord, TileCoord];
  }

  private clampCoords(x: number, y: number): { x: number; y: number } {
    const maxHalfX = MAP_SIZE_TILES * ISO_TILE_WIDTH * 0.55;
    const maxY = MAP_SIZE_TILES * ISO_TILE_HEIGHT * 1.05;
    return {
      x: Math.max(-maxHalfX, Math.min(maxHalfX, x)),
      y: Math.max(-200, Math.min(maxY, y))
    };
  }

  private clamp(): void {
    const c = this.clampCoords(this.x, this.y);
    this.x = c.x;
    this.y = c.y;
  }
}
