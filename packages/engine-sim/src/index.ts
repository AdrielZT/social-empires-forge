import { MAP_SIZE_TILES, SIM_TICK_MS } from "@sef/shared-types";

export * from "./economy/formulas.js";
export * from "./commands/applyCommand.js";
export * from "./pathfinding/Pathfinder.js";
export * from "./combat/BattleEngine.js";

/**
 * Deterministic fixed-timestep accumulator (30 Hz logical simulation decoupled from 60-144+ Hz rendering).
 */
export class FixedStepClock {
  private accumulatorMs = 0;
  private tickCount = 0;
  readonly tickMs: number;
  readonly maxFrameMs: number;

  constructor(tickMs = SIM_TICK_MS, maxFrameMs = 100) {
    this.tickMs = tickMs;
    this.maxFrameMs = maxFrameMs;
  }

  /**
   * Advances simulation by `deltaMs` and returns the interpolation factor `alpha` in [0, 1).
   */
  advance(deltaMs: number, onTick: (tick: number) => void): number {
    const clamped = Math.max(0, Math.min(deltaMs, this.maxFrameMs));
    this.accumulatorMs += clamped;
    while (this.accumulatorMs >= this.tickMs) {
      this.tickCount += 1;
      onTick(this.tickCount);
      this.accumulatorMs -= this.tickMs;
    }
    return this.accumulatorMs / this.tickMs;
  }

  get currentTick(): number {
    return this.tickCount;
  }
}

/**
 * 100x100 isometric tile occupancy grid supporting multi-tile buildings and entity IDs.
 */
export class OccupancyGrid {
  readonly width: number;
  readonly height: number;
  private readonly cells: Int32Array;

  constructor(width = MAP_SIZE_TILES, height = MAP_SIZE_TILES) {
    this.width = width;
    this.height = height;
    this.cells = new Int32Array(width * height);
  }

  inBounds(tx: number, ty: number): boolean {
    return tx >= 0 && ty >= 0 && tx < this.width && ty < this.height;
  }

  get(tx: number, ty: number): number {
    if (!this.inBounds(tx, ty)) return -1;
    return this.cells[ty * this.width + tx] ?? 0;
  }

  canPlace(tx: number, ty: number, footprintW: number, footprintH: number, ignoreEntityId = 0): boolean {
    for (let dy = 0; dy < footprintH; dy++) {
      for (let dx = 0; dx < footprintW; dx++) {
        const cx = tx - dx;
        const cy = ty - dy;
        if (!this.inBounds(cx, cy)) return false;
        const existing = this.cells[cy * this.width + cx] ?? 0;
        if (existing !== 0 && existing !== ignoreEntityId) return false;
      }
    }
    return true;
  }

  occupy(entityId: number, tx: number, ty: number, footprintW: number, footprintH: number): void {
    for (let dy = 0; dy < footprintH; dy++) {
      for (let dx = 0; dx < footprintW; dx++) {
        const cx = tx - dx;
        const cy = ty - dy;
        if (this.inBounds(cx, cy)) {
          this.cells[cy * this.width + cx] = entityId;
        }
      }
    }
  }

  vacate(entityId: number, tx: number, ty: number, footprintW: number, footprintH: number): void {
    for (let dy = 0; dy < footprintH; dy++) {
      for (let dx = 0; dx < footprintW; dx++) {
        const cx = tx - dx;
        const cy = ty - dy;
        if (this.inBounds(cx, cy) && this.cells[cy * this.width + cx] === entityId) {
          this.cells[cy * this.width + cx] = 0;
        }
      }
    }
  }
}
