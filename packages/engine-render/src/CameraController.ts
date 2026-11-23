import { ISO_TILE_HEIGHT, ISO_TILE_WIDTH, MAP_SIZE_TILES, tileToScreen } from "@sef/shared-types";

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
  }

  centerOnTile(tx: number, ty: number): void {
    const p = tileToScreen(tx, ty);
    this.x = p.x;
    this.y = p.y;
    this.clamp();
  }

  panByScreenDelta(dx: number, dy: number): void {
    this.x -= dx / this.zoom;
    this.y -= dy / this.zoom;
    this.clamp();
  }

  zoomAtScreenPoint(factor: number, screenX: number, screenY: number): void {
    const before = this.screenToWorld(screenX, screenY);
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * factor));
    const after = this.screenToWorld(screenX, screenY);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
    this.clamp();
  }

  setZoom(nextZoom: number): void {
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, nextZoom));
    this.clamp();
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

  private clamp(): void {
    const maxHalfX = MAP_SIZE_TILES * ISO_TILE_WIDTH * 0.55;
    const maxY = MAP_SIZE_TILES * ISO_TILE_HEIGHT * 1.05;
    this.x = Math.max(-maxHalfX, Math.min(maxHalfX, this.x));
    this.y = Math.max(-200, Math.min(maxY, this.y));
  }
}
