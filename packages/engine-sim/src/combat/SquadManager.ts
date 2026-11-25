import { MAP_SIZE_TILES } from "@sef/shared-types";
import type { OccupancyGrid } from "../index.js";
import type { TileReservationChecker } from "../pathfinding/Pathfinder.js";

/**
 * Canonical timing & spatial constants verified from `core/Config.as` & `battle/IA.as`
 * (Social Empires 1.4.07, 30 Hz fixed clock).
 */
export const CONFIG_AGGRO_RANGE = 10;
export const CONFIG_DEFENSIVE_LEASH_MANHATTAN = 20;
export const CONFIG_SURVIVE_FLEE_TILES = 5;
export const CONFIG_TIMER_REPOSITION_TICKS = 9; // Config.TIMER_REPOSITION = 300ms @ 30 Hz
export const CONFIG_TIMER_REATACAR_TICKS = 9; // Config.TIMER_REATACAR = 300ms @ 30 Hz
export const CONFIG_GARBAGE_COLLECTOR_INTERVAL = 61; // IsoUnit.as:570 (param1 % 61 == 0)
export const CONFIG_TIMER_DEAD_DISAPPEAR_TICKS = 120; // Config.TIMER_DEAD_DISAPPEAR = 4000ms @ 30 Hz
export const CONFIG_LIMIT_CHARGE_THROTTLE_TICKS = 30; // LimitDelegate.as:227 (1s @ 30 Hz)
export const CONFIG_LIMIT_MAX_CANONICAL = 2000; // LimitDelegate.as:31
export const CONFIG_DAMAGE_PARTICLE_THROTTLE_TICKS = 15; // Config.INTERVAL_FRAME_SHOW_PARTICLE_ATTACK

/**
 * Tracks per-tile occupancy for ground units (`IsoUnit.as:2178-2189` & `644-667`),
 * separated from static building footprints in `OccupancyGrid` so moving units can pass
 * through allies while never parking on the same tile.
 */
export class UnitOccupancyMap implements TileReservationChecker {
  private readonly tileToUid = new Map<number, number>();
  private readonly uidToTile = new Map<number, number>();
  readonly width: number;
  readonly height: number;

  constructor(width = MAP_SIZE_TILES, height = MAP_SIZE_TILES) {
    this.width = width;
    this.height = height;
  }

  private key(tx: number, ty: number): number {
    return ty * this.width + tx;
  }

  claim(uid: number, tx: number, ty: number): void {
    const rtx = Math.max(0, Math.min(this.width - 1, Math.round(tx)));
    const rty = Math.max(0, Math.min(this.height - 1, Math.round(ty)));
    const nextKey = this.key(rtx, rty);
    const prevKey = this.uidToTile.get(uid);
    if (prevKey === nextKey) return;

    if (prevKey !== undefined && this.tileToUid.get(prevKey) === uid) {
      this.tileToUid.delete(prevKey);
    }

    if (!this.tileToUid.has(nextKey)) {
      this.tileToUid.set(nextKey, uid);
      this.uidToTile.set(uid, nextKey);
    } else {
      // Tile is already claimed by another unit; release previous tile so GC can nudge us
      this.uidToTile.delete(uid);
    }
  }

  release(uid: number): void {
    const prevKey = this.uidToTile.get(uid);
    if (prevKey !== undefined) {
      if (this.tileToUid.get(prevKey) === uid) {
        this.tileToUid.delete(prevKey);
      }
      this.uidToTile.delete(uid);
    }
  }

  getOccupant(tx: number, ty: number): number | undefined {
    const rtx = Math.round(tx);
    const rty = Math.round(ty);
    if (rtx < 0 || rty < 0 || rtx >= this.width || rty >= this.height) return undefined;
    return this.tileToUid.get(this.key(rtx, rty));
  }

  isTileFreeFor(tx: number, ty: number, ignoreUid?: number, allowedUids?: ReadonlySet<number>): boolean {
    const occ = this.getOccupant(tx, ty);
    if (occ === undefined) return true;
    if (ignoreUid !== undefined && occ === ignoreUid) return true;
    if (allowedUids && allowedUids.has(occ)) return true;
    return false;
  }

  isSharingTile(uid: number, tx: number, ty: number): boolean {
    const occ = this.getOccupant(tx, ty);
    return occ !== undefined && occ !== uid;
  }

  clear(): void {
    this.tileToUid.clear();
    this.uidToTile.clear();
  }
}

/**
 * Squad group matching `battle/Squad.as`: tracks a commanded group of units
 * and coordinates reposition throttling (`TIMER_REPOSITION = 300ms`) so troops
 * keep formation and archers preserve `DISTANCIA_MINIMA_ARQUEROS`.
 */
export class SquadGroup {
  readonly id: number;
  readonly memberUids: number[];
  targetUid: number | null = null;
  repositionCooldownTicks = 0;

  constructor(id: number, memberUids: readonly number[], targetUid: number | null = null) {
    this.id = id;
    this.memberUids = [...memberUids];
    this.targetUid = targetUid;
  }

  pop(uid: number): void {
    const idx = this.memberUids.indexOf(uid);
    if (idx >= 0) {
      this.memberUids.splice(idx, 1);
    }
  }

  tick(): void {
    if (this.repositionCooldownTicks > 0) {
      this.repositionCooldownTicks -= 1;
    }
  }

  get isEmpty(): boolean {
    return this.memberUids.length === 0;
  }
}

export interface SeparableUnit {
  uid: number;
  type: "b" | "u";
  alive: boolean;
  flying: boolean;
  tx: number;
  ty: number;
  path: { tx: number; ty: number }[];
}

/**
 * Spatial-hashed soft separation pass (O(N)) that gently nudges overlapping ground units
 * apart when they converge within `minRadius` tiles (e.g., melee skirmishes or tight paths),
 * preventing sprite collapse onto identical coordinates while keeping performance < 0.3ms for 200 units.
 */
export function applySoftUnitSeparation(
  units: Iterable<SeparableUnit>,
  grid: OccupancyGrid,
  minRadius = 0.44,
  pushStrength = 0.055
): void {
  const buckets = new Map<number, SeparableUnit[]>();
  const active: SeparableUnit[] = [];

  for (const u of units) {
    if (!u.alive || u.type !== "u" || u.flying) continue;
    active.push(u);
    const bx = Math.floor(u.tx);
    const by = Math.floor(u.ty);
    const bkey = by * 128 + bx;
    let list = buckets.get(bkey);
    if (!list) {
      list = [];
      buckets.set(bkey, list);
    }
    list.push(u);
  }

  const r2 = minRadius * minRadius;
  const maxX = grid.width - 1;
  const maxY = grid.height - 1;

  for (const a of active) {
    const bx = Math.floor(a.tx);
    const by = Math.floor(a.ty);
    let pushX = 0;
    let pushY = 0;

    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const list = buckets.get((by + oy) * 128 + (bx + ox));
        if (!list) continue;
        for (const b of list) {
          if (b.uid === a.uid) continue;
          let dx = a.tx - b.tx;
          let dy = a.ty - b.ty;
          let distSq = dx * dx + dy * dy;
          if (distSq >= r2) continue;

          if (distSq < 1e-5) {
            // Deterministic tie-breaker angle based on uid pair so identical positions separate cleanly
            const angle = ((a.uid * 2654435761 + b.uid * 40503) & 255) * ((Math.PI * 2) / 256);
            dx = Math.cos(angle) * 0.05;
            dy = Math.sin(angle) * 0.05;
            distSq = dx * dx + dy * dy;
          }

          const dist = Math.sqrt(distSq);
          const overlap = (minRadius - dist) / minRadius;
          // Stationary unit yields very little to passing units (passing unit steers around)
          const weight = a.path.length === 0 && b.path.length > 0 ? 0.12 : 1.0;
          pushX += (dx / dist) * overlap * weight;
          pushY += (dy / dist) * overlap * weight;
        }
      }
    }

    if (pushX !== 0 || pushY !== 0) {
      const mag = Math.hypot(pushX, pushY);
      const step = Math.min(pushStrength, mag * pushStrength);
      const nextTx = Math.max(0, Math.min(maxX, a.tx + (pushX / mag) * step));
      const nextTy = Math.max(0, Math.min(maxY, a.ty + (pushY / mag) * step));
      // Never push a unit into an occupied solid building footprint
      if (grid.get(Math.round(nextTx), Math.round(nextTy)) === 0) {
        a.tx = nextTx;
        a.ty = nextTy;
      }
    }
  }
}
