import { MAP_SIZE_TILES, type TileCoord } from "@sef/shared-types";
import type { OccupancyGrid } from "../index.js";

const DIRS_8: readonly [number, number, number][] = [
  [1, 0, 1.0],
  [-1, 0, 1.0],
  [0, 1, 1.0],
  [0, -1, 1.0],
  [1, 1, 1.414],
  [-1, 1, 1.414],
  [1, -1, 1.414],
  [-1, -1, 1.414]
];

interface HeapNode {
  idx: number;
  f: number;
}

class MinHeap {
  private readonly items: HeapNode[] = [];

  get size(): number {
    return this.items.length;
  }

  push(node: HeapNode): void {
    this.items.push(node);
    this.siftUp(this.items.length - 1);
  }

  pop(): HeapNode | undefined {
    const top = this.items[0];
    const last = this.items.pop();
    if (this.items.length > 0 && last) {
      this.items[0] = last;
      this.siftDown(0);
    }
    return top;
  }

  private siftUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.items[parent]!.f <= this.items[i]!.f) break;
      const tmp = this.items[parent]!;
      this.items[parent] = this.items[i]!;
      this.items[i] = tmp;
      i = parent;
    }
  }

  private siftDown(i: number): void {
    const n = this.items.length;
    while (true) {
      const left = (i << 1) + 1;
      const right = left + 1;
      let smallest = i;
      if (left < n && this.items[left]!.f < this.items[smallest]!.f) smallest = left;
      if (right < n && this.items[right]!.f < this.items[smallest]!.f) smallest = right;
      if (smallest === i) break;
      const tmp = this.items[smallest]!;
      this.items[smallest] = this.items[i]!;
      this.items[i] = tmp;
      i = smallest;
    }
  }
}

function octile(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return Math.max(dx, dy) + 0.414 * Math.min(dx, dy);
}

/**
 * Computes an 8-directional isometric orientation code (1..8) matching Constants.ORIENTATION_*
 * from a tile delta (dx, dy).
 */
export function deltaToOrientation(dx: number, dy: number): number {
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  // In iso projection: (-1,-1)=UP(1), (0,-1)=UP_RIGHT(2), (1,-1)=RIGHT(3), (1,0)=DOWN_RIGHT(4),
  // (1,1)=DOWN(5), (0,1)=DOWN_LEFT(8), (-1,1)=LEFT(7), (-1,0)=UP_LEFT(6)
  if (sx < 0 && sy < 0) return 1;
  if (sx === 0 && sy < 0) return 2;
  if (sx > 0 && sy < 0) return 3;
  if (sx > 0 && sy === 0) return 4;
  if (sx > 0 && sy > 0) return 5;
  if (sx < 0 && sy === 0) return 6;
  if (sx < 0 && sy > 0) return 7;
  if (sx === 0 && sy > 0) return 8;
  return 5;
}

/**
 * High-performance A* pathfinder on the 100x100 Social Empires grid.
 * Supports flying units (direct line), diagonal corner-cut prevention,
 * and bounded node expansion to guarantee 60+ FPS even during 150v150 battles.
 */
export function findPath(
  grid: OccupancyGrid,
  start: TileCoord,
  goal: TileCoord,
  opts: {
    flying?: boolean;
    ignoreEntityId?: number;
    targetEntityId?: number;
    maxNodes?: number;
    stopDistance?: number;
  } = {}
): TileCoord[] {
  const sx = Math.max(0, Math.min(MAP_SIZE_TILES - 1, Math.round(start.tx)));
  const sy = Math.max(0, Math.min(MAP_SIZE_TILES - 1, Math.round(start.ty)));
  const gx = Math.max(0, Math.min(MAP_SIZE_TILES - 1, Math.round(goal.tx)));
  const gy = Math.max(0, Math.min(MAP_SIZE_TILES - 1, Math.round(goal.ty)));

  if (sx === gx && sy === gy) return [];

  if (opts.flying) {
    // Flying units move directly over obstacles in discrete waypoints
    const steps = Math.max(Math.abs(gx - sx), Math.abs(gy - sy));
    const path: TileCoord[] = [];
    for (let i = 1; i <= steps; i++) {
      path.push({
        tx: Math.round(sx + ((gx - sx) * i) / steps),
        ty: Math.round(sy + ((gy - sy) * i) / steps)
      });
    }
    return path;
  }

  const w = grid.width;
  const total = w * grid.height;
  const gScore = new Float32Array(total);
  gScore.fill(1e9);
  const cameFrom = new Int32Array(total);
  cameFrom.fill(-1);
  const closed = new Uint8Array(total);

  const startIdx = sy * w + sx;
  const goalIdx = gy * w + gx;
  const maxNodes = opts.maxNodes ?? 900;
  const stopDist = opts.stopDistance ?? 0;
  const ignoreId = opts.ignoreEntityId ?? 0;
  const targetId = opts.targetEntityId ?? -1;

  gScore[startIdx] = 0;
  const open = new MinHeap();
  open.push({ idx: startIdx, f: octile(sx, sy, gx, gy) });

  let bestIdx = startIdx;
  let bestH = octile(sx, sy, gx, gy);
  let expanded = 0;

  const isPassable = (tx: number, ty: number): boolean => {
    if (!grid.inBounds(tx, ty)) return false;
    const occ = grid.get(tx, ty);
    return occ === 0 || occ === ignoreId || occ === targetId;
  };

  while (open.size > 0 && expanded < maxNodes) {
    const cur = open.pop()!;
    if (closed[cur.idx]) continue;
    closed[cur.idx] = 1;
    expanded += 1;

    const cx = cur.idx % w;
    const cy = Math.floor(cur.idx / w);
    const hCur = octile(cx, cy, gx, gy);

    if (hCur < bestH) {
      bestH = hCur;
      bestIdx = cur.idx;
    }

    if (cur.idx === goalIdx || (stopDist > 0 && hCur <= stopDist)) {
      bestIdx = cur.idx;
      break;
    }

    const baseG = gScore[cur.idx]!;
    for (const [dx, dy, cost] of DIRS_8) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!isPassable(nx, ny)) continue;
      // Prevent diagonal squeezing through two blocked orthogonal tiles
      if (dx !== 0 && dy !== 0 && (!isPassable(cx + dx, cy) || !isPassable(cx, cy + dy))) {
        continue;
      }
      const nIdx = ny * w + nx;
      if (closed[nIdx]) continue;
      const tentativeG = baseG + cost;
      if (tentativeG < gScore[nIdx]!) {
        gScore[nIdx] = tentativeG;
        cameFrom[nIdx] = cur.idx;
        open.push({ idx: nIdx, f: tentativeG + octile(nx, ny, gx, gy) });
      }
    }
  }

  // Reconstruct path from bestIdx back to startIdx
  const rev: TileCoord[] = [];
  let trace = bestIdx;
  while (trace !== -1 && trace !== startIdx) {
    rev.push({ tx: trace % w, ty: Math.floor(trace / w) });
    trace = cameFrom[trace]!;
  }
  rev.reverse();
  return rev;
}
