import { ISO_TILE_HEIGHT, ISO_TILE_WIDTH, MAP_SIZE_TILES, type TileCoord } from "@sef/shared-types";
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

/**
 * Canonical Social Empires 1.4.07 constants (`core/Config.as`, `core/Constants.as`).
 */
export const DISTANCIA_MINIMA_ARQUEROS = 3;

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
 * Computes an 8-directional isometric orientation code (1..8) matching `Constants.ORIENTATION_*`
 * and `IsoUnit.getDirectionTo` (`IsoUnit.as:2639-2685`) by projecting `(dx, dy)` into
 * isometric screen pixels `(dpx, dpy)` and quantizing into 8 octants of 45 degrees.
 *
 * Includes a small pixel deadzone to eliminate facing jitter on sub-tile micro-deltas.
 *
 * Orientation mapping (`Constants.as:2740-2754`):
 * - 1: UP         (screen -Y, tile -1,-1)
 * - 2: UP_RIGHT   (screen +X,-Y, tile 0,-1)
 * - 3: RIGHT      (screen +X, tile +1,-1)
 * - 4: DOWN_RIGHT (screen +X,+Y, tile +1,0)
 * - 5: DOWN       (screen +Y, tile +1,+1)
 * - 6: UP_LEFT    (screen -X,-Y, tile -1,0)  [mirrored frame 2]
 * - 7: LEFT       (screen -X, tile -1,+1)    [mirrored frame 3]
 * - 8: DOWN_LEFT  (screen -X,+Y, tile 0,+1)  [mirrored frame 4]
 */
export function deltaToOrientation(dx: number, dy: number, fallbackOrientation = 5): number {
  const dpx = (dx - dy) * (ISO_TILE_WIDTH * 0.5);
  const dpy = (dx + dy) * (ISO_TILE_HEIGHT * 0.5);
  if (dpx * dpx + dpy * dpy < 4) {
    return fallbackOrientation;
  }

  // atan2 returns radians in (-PI, PI]; divide into 8 octants centered at multiples of PI/4
  const sector = Math.round(Math.atan2(dpy, dpx) / (Math.PI / 4));
  switch (sector) {
    case 0:
      return 3; // ORIENTATION_RIGHT
    case 1:
      return 4; // ORIENTATION_DOWN_RIGHT
    case 2:
      return 5; // ORIENTATION_DOWN
    case 3:
      return 8; // ORIENTATION_DOWN_LEFT
    case 4:
    case -4:
      return 7; // ORIENTATION_LEFT
    case -3:
      return 6; // ORIENTATION_UP_LEFT
    case -2:
      return 1; // ORIENTATION_UP
    case -1:
      return 2; // ORIENTATION_UP_RIGHT
    default:
      return fallbackOrientation;
  }
}

export interface TileReservationChecker {
  isTileFreeFor(tx: number, ty: number, ignoreUid?: number, allowedUids?: ReadonlySet<number>): boolean;
}

function isTileWalkable(
  grid: OccupancyGrid,
  unitOcc: TileReservationChecker | undefined,
  tx: number,
  ty: number,
  ignoreUid?: number,
  allowedUids?: ReadonlySet<number>,
  reserved?: ReadonlySet<number>
): boolean {
  if (!grid.inBounds(tx, ty)) return false;
  const key = ty * grid.width + tx;
  if (reserved && reserved.has(key)) return false;
  const bldgOcc = grid.get(tx, ty);
  if (bldgOcc !== 0 && bldgOcc !== ignoreUid && !(allowedUids && allowedUids.has(bldgOcc))) {
    return false;
  }
  if (unitOcc && !unitOcc.isTileFreeFor(tx, ty, ignoreUid, allowedUids)) {
    return false;
  }
  return true;
}

/**
 * Finds the nearest free walkable tile to `(centerTx, centerTy)`.
 * Faithful to `IsoEngine.encontrarTileProximaLibre` (`IsoEngine.as:1626`).
 */
export function findNearestFreeTile(
  grid: OccupancyGrid,
  unitOcc: TileReservationChecker | undefined,
  centerTx: number,
  centerTy: number,
  opts: {
    ignoreUid?: number;
    allowedUids?: ReadonlySet<number>;
    reserved?: ReadonlySet<number>;
    preferFrom?: TileCoord;
    maxRadius?: number;
  } = {}
): TileCoord | null {
  const cx = Math.max(0, Math.min(grid.width - 1, Math.round(centerTx)));
  const cy = Math.max(0, Math.min(grid.height - 1, Math.round(centerTy)));
  const maxR = opts.maxRadius ?? 14;

  if (isTileWalkable(grid, unitOcc, cx, cy, opts.ignoreUid, opts.allowedUids, opts.reserved)) {
    return { tx: cx, ty: cy };
  }

  for (let r = 1; r <= maxR; r++) {
    let best: TileCoord | null = null;
    let bestScore = Infinity;

    const consider = (tx: number, ty: number) => {
      if (!isTileWalkable(grid, unitOcc, tx, ty, opts.ignoreUid, opts.allowedUids, opts.reserved)) return;
      const dCenter = (tx - cx) * (tx - cx) + (ty - cy) * (ty - cy);
      const dFrom = opts.preferFrom
        ? (tx - opts.preferFrom.tx) * (tx - opts.preferFrom.tx) + (ty - opts.preferFrom.ty) * (ty - opts.preferFrom.ty)
        : 0;
      const score = dCenter * 100 + dFrom * 0.05;
      if (score < bestScore) {
        bestScore = score;
        best = { tx, ty };
      }
    };

    for (let tx = cx - r; tx <= cx + r; tx++) {
      consider(tx, cy + r);
      consider(tx, cy - r);
    }
    for (let ty = cy - r + 1; ty <= cy + r - 1; ty++) {
      consider(cx - r, ty);
      consider(cx + r, ty);
    }

    if (best) return best;
  }
  return null;
}

/**
 * Square formation tile allocation for moving a squad onto open ground.
 * Faithful to `IsoEngine.getSquareTiles` (`IsoEngine.as:3460-3525`), centered around `(goalTx, goalTy)`
 * and skipping all occupied buildings/stationary units.
 */
export function computeSquareFormation(
  grid: OccupancyGrid,
  unitOcc: TileReservationChecker | undefined,
  goalTx: number,
  goalTy: number,
  count: number,
  allowedUids?: ReadonlySet<number>
): TileCoord[] {
  if (count <= 0) return [];
  const cx = Math.max(0, Math.min(grid.width - 1, Math.round(goalTx)));
  const cy = Math.max(0, Math.min(grid.height - 1, Math.round(goalTy)));
  const out: TileCoord[] = [];
  const reserved = new Set<number>();

  // Shift origin so square expands symmetrically around clicked tile
  const half = Math.floor((Math.ceil(Math.sqrt(count)) - 1) / 2);
  const startX = Math.max(0, Math.min(grid.width - 1, cx - half));
  const startY = Math.max(0, Math.min(grid.height - 1, cy - half));

  const tryAdd = (tx: number, ty: number) => {
    if (out.length >= count) return;
    if (isTileWalkable(grid, unitOcc, tx, ty, undefined, allowedUids, reserved)) {
      reserved.add(ty * grid.width + tx);
      out.push({ tx, ty });
    }
  };

  for (let ring = 0; ring <= 24 && out.length < count; ring++) {
    const rx = startX + ring;
    for (let ry = startY; ry <= startY + ring && out.length < count; ry++) {
      tryAdd(rx, ry);
    }
    if (ring > 0 && out.length < count) {
      const ry = startY + ring;
      for (let rx2 = startX + ring - 1; rx2 >= startX && out.length < count; rx2--) {
        tryAdd(rx2, ry);
      }
    }
  }

  // Fallback spiral around exact click if edge of map constrained square expansion
  if (out.length < count) {
    const extra = computeSpiralFormation(grid, unitOcc, cx, cy, count - out.length, allowedUids, reserved);
    out.push(...extra);
  }
  return out;
}

/**
 * Concentric spiral formation around a friendly building or landmark.
 * Faithful to `IsoEngine.getSpiralTiles` (`IsoEngine.as:3337-3458`).
 */
export function computeSpiralFormation(
  grid: OccupancyGrid,
  unitOcc: TileReservationChecker | undefined,
  centerTx: number,
  centerTy: number,
  count: number,
  allowedUids?: ReadonlySet<number>,
  existingReserved?: Set<number>
): TileCoord[] {
  if (count <= 0) return [];
  const cx = Math.max(0, Math.min(grid.width - 1, Math.round(centerTx)));
  const cy = Math.max(0, Math.min(grid.height - 1, Math.round(centerTy)));
  const reserved = existingReserved ?? new Set<number>();
  const collected: { tx: number; ty: number; d: number }[] = [];

  const tryAdd = (tx: number, ty: number) => {
    if (collected.length >= count) return;
    if (isTileWalkable(grid, unitOcc, tx, ty, undefined, allowedUids, reserved)) {
      reserved.add(ty * grid.width + tx);
      collected.push({ tx, ty, d: (tx - cx) * (tx - cx) + (ty - cy) * (ty - cy) });
    }
  };

  tryAdd(cx, cy);
  for (let r = 1; r <= 28 && collected.length < count; r++) {
    for (let tx = cx - r; tx <= cx + r && collected.length < count; tx++) {
      tryAdd(tx, cy + r);
      tryAdd(tx, cy - r);
    }
    for (let ty = cy - r + 1; ty <= cy + r - 1 && collected.length < count; ty++) {
      tryAdd(cx - r, ty);
      tryAdd(cx + r, ty);
    }
  }

  collected.sort((a, b) => a.d - b.d);
  return collected.map(({ tx, ty }) => ({ tx, ty }));
}

export interface AttackFormationUnitInput {
  uid: number;
  tx: number;
  ty: number;
  attackRange: number;
  flying: boolean;
}

export interface AttackFormationTargetInput {
  tx: number;
  ty: number;
  width: number;
  height: number;
}

/**
 * Computes non-overlapping attack/harvest perimeter tiles grouped by `attackRange` descending.
 * Faithful to `IsoEngine.getAttackFormationTiles` (`IsoEngine.as:3121-3330`) & `Squad.as:66`:
 * - Ranged units are placed on rings at their `attackRange` (at least `DISTANCIA_MINIMA_ARQUEROS = 3`
 *   when `attackRange >= 3`).
 * - Melee units and harvesters surround the target footprint perimeter without duplicating tiles.
 * - Each unit receives the walkable candidate tile closest to its current position.
 */
export function computeAttackFormation(
  grid: OccupancyGrid,
  unitOcc: TileReservationChecker | undefined,
  target: AttackFormationTargetInput,
  units: readonly AttackFormationUnitInput[]
): Map<number, TileCoord> {
  const result = new Map<number, TileCoord>();
  if (units.length === 0) return result;

  const allowedUids = new Set<number>(units.map((u) => u.uid));
  const reserved = new Set<number>();

  // Sort units by attackRange descending (ranged rings allocated first, just like IsoEngine.as:3161)
  const sorted = [...units].sort((a, b) => b.attackRange - a.attackRange || a.uid - b.uid);

  const halfW = Math.floor(target.width / 2);
  const halfH = Math.floor(target.height / 2);
  const centerTx = Math.round(target.tx) - halfW;
  const centerTy = Math.round(target.ty) - halfH;
  const evenFootprint = target.width % 2 === 0;

  for (const unit of sorted) {
    const baseRange = Math.max(1, Math.round(unit.attackRange));
    const minRing = baseRange >= DISTANCIA_MINIMA_ARQUEROS ? Math.max(DISTANCIA_MINIMA_ARQUEROS, baseRange) : baseRange;
    let ring = minRing + Math.max(halfW, halfH);
    let assigned: TileCoord | null = null;

    for (let attempt = 0; attempt < 10 && !assigned; attempt++) {
      const candidates: { tx: number; ty: number; d: number }[] = [];
      const minX = centerTx - ring + (evenFootprint ? 1 : 0);
      const maxX = centerTx + ring;
      const minY = centerTy - ring + (evenFootprint ? 1 : 0);
      const maxY = centerTy + ring;

      const consider = (tx: number, ty: number) => {
        if (!grid.inBounds(tx, ty)) return;
        const key = ty * grid.width + tx;
        if (reserved.has(key)) return;
        const ok = unit.flying
          ? !reserved.has(key)
          : isTileWalkable(grid, unitOcc, tx, ty, unit.uid, allowedUids, reserved);
        if (!ok) return;
        const d = (tx - unit.tx) * (tx - unit.tx) + (ty - unit.ty) * (ty - unit.ty);
        candidates.push({ tx, ty, d });
      };

      for (let tx = minX; tx <= maxX; tx++) {
        consider(tx, maxY);
        consider(tx, minY);
      }
      for (let ty = minY + 1; ty <= maxY - 1; ty++) {
        consider(minX, ty);
        consider(maxX, ty);
      }

      if (candidates.length > 0) {
        candidates.sort((a, b) => a.d - b.d);
        const pick = candidates[0]!;
        reserved.add(pick.ty * grid.width + pick.tx);
        assigned = { tx: pick.tx, ty: pick.ty };
      } else {
        ring += 1;
      }
    }

    if (!assigned) {
      const fallback = findNearestFreeTile(grid, unitOcc, centerTx, centerTy, {
        ignoreUid: unit.uid,
        allowedUids,
        reserved,
        preferFrom: { tx: unit.tx, ty: unit.ty }
      });
      if (fallback) {
        reserved.add(fallback.ty * grid.width + fallback.tx);
        assigned = fallback;
      }
    }

    if (assigned) {
      result.set(unit.uid, assigned);
    }
  }

  return result;
}

/**
 * High-performance A* pathfinder on the 100x100 Social Empires grid.
 * Supports flying units (direct line), diagonal corner-cut prevention,
 * optional unit-occupancy soft penalty, and bounded node expansion to guarantee
 * 60+ FPS even during 150v150 battles.
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
    unitOccupancy?: TileReservationChecker;
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
  const unitOcc = opts.unitOccupancy;

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
      // Soft penalty for stepping through a tile currently occupied by another unit
      // (encourages natural routing around friendly clusters without blocking narrow corridors)
      const unitPenalty =
        unitOcc && !unitOcc.isTileFreeFor(nx, ny, ignoreId) && !(nx === gx && ny === gy) ? 0.65 : 0;
      const tentativeG = baseG + cost + unitPenalty;
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
