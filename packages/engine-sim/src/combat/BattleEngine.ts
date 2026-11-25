import { ISO_TILE_HEIGHT, ISO_TILE_WIDTH, type GameItem, type TileCoord } from "@sef/shared-types";
import type { OccupancyGrid } from "../index.js";
import {
  computeAttackFormation,
  computeSpiralFormation,
  computeSquareFormation,
  deltaToOrientation,
  DISTANCIA_MINIMA_ARQUEROS,
  findNearestFreeTile,
  findPath
} from "../pathfinding/Pathfinder.js";
import {
  applySoftUnitSeparation,
  CONFIG_AGGRO_RANGE,
  CONFIG_DAMAGE_PARTICLE_THROTTLE_TICKS,
  CONFIG_DEFENSIVE_LEASH_MANHATTAN,
  CONFIG_GARBAGE_COLLECTOR_INTERVAL,
  CONFIG_LIMIT_CHARGE_THROTTLE_TICKS,
  CONFIG_LIMIT_MAX_CANONICAL,
  CONFIG_SURVIVE_FLEE_TILES,
  CONFIG_TIMER_DEAD_DISAPPEAR_TICKS,
  CONFIG_TIMER_REPOSITION_TICKS,
  SquadGroup,
  UnitOccupancyMap
} from "./SquadManager.js";

export type TeamId = "player" | "enemy" | "neutral";

export type StanceMode = "aggressive" | "defensive" | "stand";

export type IACondition = "defensive" | "aggressive" | "passive" | "survive";

export type IAState = "idle" | "hold_position" | "patrol" | "force_move" | "attacking" | "fleeing";

export const SUBCAT_UNIT_PEASANT = 71;
export const SUBCAT_UNIT_SIEGE = 81;
export const SUBCAT_BUILDING_FARM = 122;
export const SUBCAT_BUILDING_TOWNHALL = 135;

export interface StatusEffects {
  frozenTicks: number;
  dizzyTicks: number;
  poisonTicks: number;
  poisonDps: number;
  burnTicks: number;
  burnDps: number;
  shieldHp: number;
  enlargedTicks: number;
  speed2xTicks: number;
  range2xTicks: number;
}

export interface SpecialAttackSpec {
  id: string;
  name?: string;
  kind:
    | "area_damage"
    | "whirlwind"
    | "rain"
    | "beam"
    | "energy_balls"
    | "spawn_minion"
    | "heal_aura"
    | "push_in_air"
    | "dizzy"
    | "freeze"
    | "poison"
    | "incinerate"
    | "direct_kill";
  animState: number; // 6..14 (ANIMATION_ATTACKING_SPECIAL1..9)
  cooldown?: number; // Cooldown in seconds (IsoSpecialUnit.as tTick)
  triggerEveryHits: number;
  damageMultiplier: number;
  radius: number;
  summonItemId?: number;
  summonCount?: number;
  projectileType?: ProjectileKind;
  fxName?: string;
}

export interface UnitBehaviorProfile {
  itemId: number;
  className?: string;
  isSpecialUnit: boolean;
  hasLimitBar: boolean;
  limitMax: number;
  scale: number;
  specials: SpecialAttackSpec[];
}

export interface SimEntity {
  uid: number;
  itemId: number;
  imgName: string;
  name: string;
  type: "b" | "u";
  team: TeamId;
  tx: number;
  ty: number;
  prevTx: number;
  prevTy: number;
  originTx: number;
  originTy: number;
  width: number;
  height: number;
  orientation: number;
  animState: number; // 0=idle,1=walk,2=attack,3=die,4=harvest,5=repair/strike,6+=special
  animSeq: number; // Increments on every attack/special cast so renderer restarts one-shot clip
  attackAnimTicks: number; // Ticks remaining in active swing/cast animation
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  velocity: number;
  attackRange: number;
  attackInterval: number;
  flying: boolean;
  subcatFunctional: number;
  groups: string;
  xpValue: number;
  collectAmount: number;
  collectType: string;

  // Dynamic RTS & AI state (`battle/IA.as`, `battle/IAWithAgro.as`, `core/isoengine/IsoUnit.as`)
  alive: boolean;
  dyingTicks: number;
  attackCooldown: number;
  delayAttack: number;
  hitCounter: number;
  limitGauge: number;
  limitMax: number;
  lastLimitChargeTick: number;
  specialCooldownTicks: number[];
  damageParticleCooldown: number;
  inCombatTicks: number;
  stance: StanceMode;
  iaCondition: IACondition;
  iaState: IAState;
  aggroRange: number;
  squadId: number | null;
  threatTable: Map<number, number>;
  path: TileCoord[];
  targetUid: number | null;
  harvestTargetUid: number | null;
  harvestProgress: number;
  status: StatusEffects;
  behavior?: UnitBehaviorProfile;
}

export type ProjectileKind = "arrow" | "rock" | "fireball" | "beam" | "energy_ball" | "magic_rain";

export interface SimProjectile {
  id: number;
  kind: ProjectileKind;
  sourceUid: number;
  team: TeamId;
  x: number;
  y: number;
  targetTx: number;
  targetTy: number;
  targetUid: number | null;
  progress: number; // 0..1
  durationTicks: number;
  damage: number;
  blastRadius: number;
  color: number;
}

export type SimVisualEvent =
  | {
      type: "damage";
      targetUid: number;
      targetTeam: TeamId;
      tx: number;
      ty: number;
      amount: number;
      crit?: boolean;
      absorbed?: number;
      throttled?: boolean;
    }
  | { type: "heal"; targetUid: number; tx: number; ty: number; amount: number }
  | { type: "death"; uid: number; itemId: number; team: TeamId; tx: number; ty: number; xp: number }
  | {
      type: "harvest";
      workerUid: number;
      resourceUid: number;
      tx: number;
      ty: number;
      resourceType: string;
      amount: number;
    }
  | { type: "spell_cast"; magicId: number; tx: number; ty: number; radius: number }
  | { type: "limit_cast"; unitUid: number; tx: number; ty: number; radius: number }
  | { type: "sfx"; name: string }
  | { type: "spawn"; entity: SimEntity };

export function createDefaultStatus(): StatusEffects {
  return {
    frozenTicks: 0,
    dizzyTicks: 0,
    poisonTicks: 0,
    poisonDps: 0,
    burnTicks: 0,
    burnDps: 0,
    shieldHp: 0,
    enlargedTicks: 0,
    speed2xTicks: 0,
    range2xTicks: 0
  };
}

/**
 * Classic Social Empires 1.4.07 hero special fallbacks (`IsoUnit.as:753-780`, `841-849`)
 * for iconic units that use imperative switches inside `IsoUnit.as` rather than separate Delegate files.
 */
const CLASSIC_UNIT_SPECIAL_OVERRIDES: Readonly<Record<number, UnitBehaviorProfile>> = {
  533: {
    // Warrior Princess (Xena) — IsoUnit.as:755 attackSpecialWhirlwind
    itemId: 533,
    className: "IsoUnit_Xena",
    isSpecialUnit: true,
    hasLimitBar: true,
    limitMax: CONFIG_LIMIT_MAX_CANONICAL,
    scale: 1.0,
    specials: [
      {
        id: "xena_whirlwind",
        name: "Torbellino",
        kind: "whirlwind",
        animState: 6,
        cooldown: 16,
        triggerEveryHits: 4,
        damageMultiplier: 2.0,
        radius: 3.5
      }
    ]
  },
  535: {
    // Thor — IsoUnit.as:841 pushInAir thunder smash
    itemId: 535,
    className: "IsoUnit_Thor",
    isSpecialUnit: true,
    hasLimitBar: true,
    limitMax: CONFIG_LIMIT_MAX_CANONICAL,
    scale: 1.0,
    specials: [
      {
        id: "thor_thunder",
        name: "Martillo de Trueno",
        kind: "push_in_air",
        animState: 6,
        cooldown: 18,
        triggerEveryHits: 4,
        damageMultiplier: 2.2,
        radius: 4.0
      }
    ]
  }
};

function isWorkerSubcat(itemId: number, subcat: number): boolean {
  return itemId === 500 || itemId === 501 || subcat === SUBCAT_UNIT_PEASANT;
}

function isBossOrDragon(ent: SimEntity): boolean {
  return (
    ent.groups.includes("dragon") ||
    ent.groups.includes("god") ||
    ent.groups.includes("boss") ||
    Boolean(ent.behavior?.hasLimitBar)
  );
}

/**
 * Deterministic 30 Hz RTS Combat, AI (`IA.as` / `IAWithAgro.as`), Squad Separation (`Squad.as`),
 * Worker Harvesting, Projectile, Special Ability Cooldowns, Limit Gauge (`LimitDelegate.as`),
 * and 15-Magic-Spell simulation engine (zero DOM dependencies).
 */
export class BattleEngine {
  readonly entities = new Map<number, SimEntity>();
  readonly projectiles: SimProjectile[] = [];
  readonly grid: OccupancyGrid;
  readonly unitOccupancy: UnitOccupancyMap;
  readonly squads = new Map<number, SquadGroup>();
  readonly itemsById: ReadonlyMap<number, GameItem>;
  readonly behaviorsById: ReadonlyMap<number, UnitBehaviorProfile>;

  private nextUid = 10000;
  private nextProjId = 1;
  private nextSquadId = 1;
  private tickCount = 0;
  private rngState: number;

  constructor(
    grid: OccupancyGrid,
    itemsById: ReadonlyMap<number, GameItem>,
    behaviorsById: ReadonlyMap<number, UnitBehaviorProfile> = new Map(),
    seed = 0x1407cafe
  ) {
    this.grid = grid;
    this.unitOccupancy = new UnitOccupancyMap(grid.width, grid.height);
    this.itemsById = itemsById;
    this.behaviorsById = behaviorsById;
    this.rngState = seed >>> 0;
  }

  /**
   * Deterministic mulberry32 PRNG in [0, 1) for reproducible 1.4.07 damage variance & crits.
   */
  private nextRand(): number {
    this.rngState = (this.rngState + 0x6d2b79f5) >>> 0;
    let t = Math.imul(this.rngState ^ (this.rngState >>> 15), 1 | this.rngState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  addEntity(ent: SimEntity): void {
    this.entities.set(ent.uid, ent);
    if (ent.uid >= this.nextUid) this.nextUid = ent.uid + 1;
    if (ent.type === "b") {
      // Farms (`SUBCATFUNC_BUILDING_FARM = 122`) are walkable in Social Empires (`IsoUnit.as:2019`)
      if (ent.subcatFunctional !== SUBCAT_BUILDING_FARM) {
        this.grid.occupy(ent.uid, Math.round(ent.tx), Math.round(ent.ty), ent.width, ent.height);
      }
    } else if (!ent.flying && ent.alive) {
      this.unitOccupancy.claim(ent.uid, ent.tx, ent.ty);
    }
  }

  spawnFromItem(itemId: number, tx: number, ty: number, team: TeamId, orientation = 4): SimEntity | null {
    const def = this.itemsById.get(itemId);
    if (!def) return null;

    const rawBehavior = this.behaviorsById.get(itemId);
    const override = CLASSIC_UNIT_SPECIAL_OVERRIDES[itemId];
    const behavior =
      rawBehavior && (rawBehavior.specials.length > 0 || rawBehavior.hasLimitBar)
        ? rawBehavior
        : override ?? rawBehavior;

    const maxHp = Math.max(1, def.life);
    const uid = this.nextUid++;
    const isWorker = def.type === "u" && isWorkerSubcat(def.id, def.subcatFunctional);
    const hasLimit = Boolean(behavior?.hasLimitBar);
    const limitMax = hasLimit ? Math.max(behavior?.limitMax ?? 0, CONFIG_LIMIT_MAX_CANONICAL) : 0;

    // Canonical default IA condition (`battle/IA.as:65-152`)
    const iaCondition: IACondition = isWorker
      ? "survive"
      : team === "neutral"
        ? "passive"
        : "aggressive";

    const ent: SimEntity = {
      uid,
      itemId: def.id,
      imgName: def.imgName,
      name: def.name,
      type: def.type,
      team,
      tx,
      ty,
      prevTx: tx,
      prevTy: ty,
      originTx: Math.round(tx),
      originTy: Math.round(ty),
      width: def.width,
      height: def.height,
      orientation,
      animState: 0,
      animSeq: 0,
      attackAnimTicks: 0,
      hp: maxHp,
      maxHp,
      attack: def.attack,
      defense: def.defense,
      velocity: def.velocity,
      attackRange: Math.max(1, def.attackRange),
      attackInterval: Math.max(10, def.attackInterval || 35),
      flying: def.flying,
      subcatFunctional: def.subcatFunctional,
      groups: def.groups,
      xpValue: def.xp,
      collectAmount: def.collect,
      collectType: def.collectType || "g",
      alive: true,
      dyingTicks: 0,
      attackCooldown: 0,
      delayAttack: uid % 5,
      hitCounter: 0,
      limitGauge: 0,
      limitMax,
      lastLimitChargeTick: -CONFIG_LIMIT_CHARGE_THROTTLE_TICKS,
      specialCooldownTicks: (behavior?.specials ?? []).map(() => 0),
      damageParticleCooldown: 0,
      inCombatTicks: 0,
      stance: isWorker ? "stand" : "aggressive",
      iaCondition,
      iaState: "idle",
      aggroRange: Math.max(CONFIG_AGGRO_RANGE, def.attackRange),
      squadId: null,
      threatTable: new Map(),
      path: [],
      targetUid: null,
      harvestTargetUid: null,
      harvestProgress: 0,
      status: createDefaultStatus(),
      behavior
    };
    this.addEntity(ent);
    return ent;
  }

  /**
   * Changes unit stance (`aggressive`, `defensive`, `stand`) synced to canonical `IA.as` condition/state.
   */
  setUnitsStance(uids: readonly number[], stance: StanceMode): void {
    for (const uid of uids) {
      const ent = this.entities.get(uid);
      if (!ent || !ent.alive || ent.type !== "u") continue;
      ent.stance = stance;
      if (stance === "aggressive") {
        ent.iaCondition = "aggressive";
        if (ent.iaState === "hold_position") ent.iaState = "idle";
      } else if (stance === "defensive") {
        ent.iaCondition = "defensive";
        ent.originTx = Math.round(ent.tx);
        ent.originTy = Math.round(ent.ty);
        if (ent.iaState === "hold_position") ent.iaState = "idle";
      } else {
        ent.iaCondition = isWorkerSubcat(ent.itemId, ent.subcatFunctional) ? "survive" : "passive";
        ent.iaState = "hold_position";
        ent.targetUid = null;
        ent.path = [];
      }
    }
  }

  /**
   * Immediately halts selected units (`S` Stop hotkey) and clears active orders.
   */
  stopUnits(uids: readonly number[]): void {
    for (const uid of uids) {
      const ent = this.entities.get(uid);
      if (!ent || !ent.alive || ent.type !== "u") continue;
      this.detachFromSquad(ent);
      ent.path = [];
      ent.targetUid = null;
      ent.harvestTargetUid = null;
      ent.iaState = "idle";
      ent.animState = 0;
      ent.originTx = Math.round(ent.tx);
      ent.originTy = Math.round(ent.ty);
    }
  }

  /**
   * Moves one or more units in canonical `Base.startMovementsSquad` formation (`Base.as:4417`):
   * - Open ground -> `getSquareTiles` (non-overlapping walkable square)
   * - Friendly building -> `getSpiralTiles` (concentric perimeter around building)
   * Sets `STATE_FORCE_MOVE` so units march cleanly without getting distracted until `DestinyReached()`.
   */
  orderMove(uids: readonly number[], goalTx: number, goalTy: number): void {
    const validUnits: SimEntity[] = [];
    for (const uid of uids) {
      const ent = this.entities.get(uid);
      if (ent && ent.alive && ent.type === "u") {
        validUnits.push(ent);
      }
    }
    if (validUnits.length === 0) return;

    const gx = Math.max(0, Math.min(this.grid.width - 1, Math.round(goalTx)));
    const gy = Math.max(0, Math.min(this.grid.height - 1, Math.round(goalTy)));
    const allowedUids = new Set(validUnits.map((u) => u.uid));
    const goalBlockedByBldg = this.grid.get(gx, gy) !== 0;

    const slots = goalBlockedByBldg
      ? computeSpiralFormation(this.grid, this.unitOccupancy, gx, gy, validUnits.length, allowedUids)
      : computeSquareFormation(this.grid, this.unitOccupancy, gx, gy, validUnits.length, allowedUids);

    const squad = this.createSquad(validUnits, null);

    // Pair units with closest available formation slots to minimize path crossing
    const remainingSlots = [...slots];
    for (const ent of validUnits) {
      let chosen: TileCoord = { tx: gx, ty: gy };
      if (remainingSlots.length > 0) {
        let bestIdx = 0;
        let bestD = Infinity;
        for (let i = 0; i < remainingSlots.length; i++) {
          const s = remainingSlots[i]!;
          const d = (s.tx - ent.tx) * (s.tx - ent.tx) + (s.ty - ent.ty) * (s.ty - ent.ty);
          if (d < bestD) {
            bestD = d;
            bestIdx = i;
          }
        }
        chosen = remainingSlots.splice(bestIdx, 1)[0]!;
      }

      ent.squadId = squad.id;
      ent.targetUid = null;
      ent.harvestTargetUid = null;
      ent.iaState = "force_move";
      ent.originTx = chosen.tx;
      ent.originTy = chosen.ty;
      ent.path = findPath(this.grid, { tx: ent.tx, ty: ent.ty }, chosen, {
        flying: ent.flying,
        ignoreEntityId: ent.uid,
        unitOccupancy: this.unitOccupancy
      });
    }
  }

  /**
   * Orders units to attack a target using canonical `IsoEngine.getAttackFormationTiles` (`IsoEngine.as:3121`)
   * and `Squad.as` coordination: ranged troops hold firing rings (`>= DISTANCIA_MINIMA_ARQUEROS`)
   * while melee troops surround the target without stacking on the same tile.
   */
  orderAttack(uids: readonly number[], targetUid: number): void {
    const target = this.entities.get(targetUid);
    if (!target || !target.alive) return;

    const attackers: SimEntity[] = [];
    for (const uid of uids) {
      const ent = this.entities.get(uid);
      if (ent && ent.alive && ent.type === "u" && ent.uid !== targetUid) {
        attackers.push(ent);
      }
    }
    if (attackers.length === 0) return;

    const squad = this.createSquad(attackers, targetUid);
    const formation = computeAttackFormation(
      this.grid,
      this.unitOccupancy,
      { tx: target.tx, ty: target.ty, width: target.width, height: target.height },
      attackers.map((u) => ({
        uid: u.uid,
        tx: u.tx,
        ty: u.ty,
        attackRange: u.attackRange * (u.status.range2xTicks > 0 ? 2 : 1),
        flying: u.flying
      }))
    );

    for (const ent of attackers) {
      ent.squadId = squad.id;
      ent.harvestTargetUid = null;
      ent.targetUid = targetUid;
      ent.iaState = "attacking";
      const assignedTile = formation.get(ent.uid);
      if (assignedTile) {
        ent.path = findPath(this.grid, { tx: ent.tx, ty: ent.ty }, assignedTile, {
          flying: ent.flying,
          ignoreEntityId: ent.uid,
          targetEntityId: target.uid,
          unitOccupancy: this.unitOccupancy
        });
      } else {
        const effRange = ent.attackRange * (ent.status.range2xTicks > 0 ? 2 : 1);
        ent.path = findPath(
          this.grid,
          { tx: ent.tx, ty: ent.ty },
          { tx: target.tx, ty: target.ty },
          {
            flying: ent.flying,
            ignoreEntityId: ent.uid,
            targetEntityId: target.uid,
            stopDistance: Math.max(1, effRange - 0.3),
            unitOccupancy: this.unitOccupancy
          }
        );
      }
    }
  }

  /**
   * Orders one or more villagers (`IsoUnit.CanHarvest`) to harvest a resource node,
   * spreading multiple workers around its perimeter so they never stack.
   */
  orderHarvest(workerUid: number, resourceUid: number): void {
    this.orderHarvestGroup([workerUid], resourceUid);
  }

  orderHarvestGroup(workerUids: readonly number[], resourceUid: number): void {
    const res = this.entities.get(resourceUid);
    if (!res || !res.alive) return;

    const workers: SimEntity[] = [];
    for (const uid of workerUids) {
      const w = this.entities.get(uid);
      if (w && w.alive && w.type === "u") {
        workers.push(w);
      }
    }
    if (workers.length === 0) return;

    const formation = computeAttackFormation(
      this.grid,
      this.unitOccupancy,
      { tx: res.tx, ty: res.ty, width: res.width, height: res.height },
      workers.map((w) => ({
        uid: w.uid,
        tx: w.tx,
        ty: w.ty,
        attackRange: 1,
        flying: false
      }))
    );

    for (const worker of workers) {
      this.detachFromSquad(worker);
      worker.targetUid = null;
      worker.harvestTargetUid = resourceUid;
      worker.harvestProgress = 0;
      worker.iaState = "idle";
      const slot = formation.get(worker.uid);
      worker.path = findPath(
        this.grid,
        { tx: worker.tx, ty: worker.ty },
        slot ?? { tx: res.tx, ty: res.ty },
        {
          flying: false,
          ignoreEntityId: worker.uid,
          targetEntityId: res.uid,
          stopDistance: slot ? 0 : 1.2,
          unitOccupancy: this.unitOccupancy
        }
      );
    }
  }

  /**
   * Manually activates one of a special unit's abilities (`IsoSpecialUnit.doAttack`, `IsoSpecialUnit.as:181`),
   * checking per-ability cooldown in seconds (30 ticks/s).
   */
  triggerSpecialAbility(unitUid: number, specialIndex: number): SimVisualEvent[] {
    const events: SimVisualEvent[] = [];
    const ent = this.entities.get(unitUid);
    if (!ent || !ent.alive || !ent.behavior) return events;
    const spec = ent.behavior.specials[specialIndex];
    if (!spec) return events;
    if ((ent.specialCooldownTicks[specialIndex] ?? 0) > 0) return events;

    const target =
      (ent.targetUid !== null ? this.entities.get(ent.targetUid) : null) ??
      this.acquireBestTarget(ent, Math.max(ent.attackRange + 4, CONFIG_AGGRO_RANGE));

    const effectiveTarget = target && target.alive ? target : ent;
    const enlargeMult = ent.status.enlargedTicks > 0 ? 1.6 : 1.0;

    if (effectiveTarget.uid !== ent.uid) {
      ent.orientation = deltaToOrientation(effectiveTarget.tx - ent.tx, effectiveTarget.ty - ent.ty, ent.orientation);
    }
    ent.animState = spec.animState;
    ent.animSeq += 1;
    ent.attackAnimTicks = 24;
    const cdSec = Math.max(4, spec.cooldown ?? 18);
    ent.specialCooldownTicks[specialIndex] = Math.round(cdSec * 30);

    this.executeSpecialAttack(ent, effectiveTarget, spec, enlargeMult, events);
    return events;
  }

  /**
   * Manually (or via AI for enemy dragons) triggers the unit's Limit Attack (`IsoLimitUnit.as:26-46`,
   * `LimitDelegate.as:31`) when `limitGauge >= limitMax`, resetting `limitGauge = 0`.
   */
  triggerLimitAttack(unitUid: number): SimVisualEvent[] {
    const events: SimVisualEvent[] = [];
    const ent = this.entities.get(unitUid);
    if (!ent || !ent.alive || !ent.behavior?.hasLimitBar || ent.limitMax <= 0) return events;
    if (ent.limitGauge < ent.limitMax) return events;

    const enemyTeam: TeamId = ent.team === "player" ? "enemy" : "player";
    const target =
      (ent.targetUid !== null ? this.entities.get(ent.targetUid) : null) ??
      this.acquireBestTarget(ent, Math.max(ent.attackRange + 5, 14));

    const cx = target && target.alive ? target.tx : ent.tx;
    const cy = target && target.alive ? target.ty : ent.ty;
    const radius = 5.5;
    const enlargeMult = ent.status.enlargedTicks > 0 ? 1.6 : 1.0;
    const limitDmg = Math.max(25, Math.round(ent.attack * 3.0 * enlargeMult));

    if (target && target.alive) {
      ent.orientation = deltaToOrientation(target.tx - ent.tx, target.ty - ent.ty, ent.orientation);
    }

    ent.limitGauge = 0;
    ent.animState = 9; // ANIMATION_ATTACKING_SPECIAL4 / Limit pose
    ent.animSeq += 1;
    ent.attackAnimTicks = 32;

    events.push(
      { type: "limit_cast", unitUid: ent.uid, tx: cx, ty: cy, radius },
      { type: "sfx", name: "FireballSound" }
    );

    let hitCount = 0;
    for (const e of this.entities.values()) {
      if (!e.alive || e.team !== enemyTeam) continue;
      if (Math.hypot(e.tx - cx, e.ty - cy) <= radius) {
        this.applyDamage(e, limitDmg, events, { attacker: ent, forceCrit: true, allowLimitCharge: false });
        e.status.dizzyTicks = Math.max(e.status.dizzyTicks, 36);
        hitCount += 1;
        if (hitCount >= 8) break;
      }
    }
    return events;
  }

  /**
   * Executes any of the 15 classic Social Empires Magic Spells (IDs 2..16).
   */
  castMagicSpell(magicId: number, tx: number, ty: number, casterTeam: TeamId = "player", spellLevel = 1): SimVisualEvent[] {
    const events: SimVisualEvent[] = [];
    const enemyTeam: TeamId = casterTeam === "player" ? "enemy" : "player";
    const lvlMult = 1 + (spellLevel - 1) * 0.35;
    const radius = 5.5;

    events.push({ type: "spell_cast", magicId, tx, ty, radius }, { type: "sfx", name: "FireballSound" });

    const inRadius = (teamFilter?: TeamId) => {
      const out: SimEntity[] = [];
      for (const e of this.entities.values()) {
        if (!e.alive) continue;
        if (teamFilter && e.team !== teamFilter) continue;
        const d = Math.hypot(e.tx - tx, e.ty - ty);
        if (d <= radius) out.push(e);
      }
      return out;
    };

    switch (magicId) {
      case 2: // Fire Havoc
        for (const e of inRadius(enemyTeam)) {
          this.applyDamage(e, Math.round(140 * lvlMult), events, { rawSpell: true });
          e.status.burnTicks = Math.max(e.status.burnTicks, 90);
          e.status.burnDps = Math.round(10 * lvlMult);
        }
        break;
      case 3: // Ultimate Hail
        for (const e of inRadius(enemyTeam)) {
          this.applyDamage(e, Math.round(180 * lvlMult), events, { rawSpell: true });
          e.status.dizzyTicks = Math.max(e.status.dizzyTicks, 45);
        }
        break;
      case 4: // Deadly Frostbite
        for (const e of inRadius(enemyTeam)) {
          e.status.frozenTicks = Math.max(e.status.frozenTicks, Math.round(180 * lvlMult));
          this.applyDamage(e, Math.round(35 * lvlMult), events, { rawSpell: true });
        }
        break;
      case 5: // Sacred Rain (Heal allies)
        events.push({ type: "sfx", name: "CurarSound" });
        for (const e of inRadius(casterTeam)) {
          const heal = Math.round(e.maxHp * 0.45 * lvlMult);
          e.hp = Math.min(e.maxHp, e.hp + heal);
          events.push({ type: "heal", targetUid: e.uid, tx: e.tx, ty: e.ty, amount: heal });
        }
        break;
      case 6: { // Golem's Wrath (summon Stone Golem)
        const free = findNearestFreeTile(this.grid, this.unitOccupancy, tx, ty) ?? { tx, ty };
        const golem = this.spawnFromItem(548, free.tx, free.ty, casterTeam) ?? this.spawnFromItem(508, free.tx, free.ty, casterTeam);
        if (golem) events.push({ type: "spawn", entity: golem });
        break;
      }
      case 7: // Hell Abyss
        for (const e of inRadius(enemyTeam)) {
          const dmg = e.maxHp <= 350 * lvlMult ? e.hp + e.defense : Math.round(250 * lvlMult);
          this.applyDamage(e, dmg, events, { rawSpell: true });
        }
        break;
      case 8: // Poisonous Flood
        for (const e of inRadius(enemyTeam)) {
          e.status.poisonTicks = Math.max(e.status.poisonTicks, 240);
          e.status.poisonDps = Math.round(18 * lvlMult);
        }
        break;
      case 9: // Ether Shield
        for (const e of inRadius(casterTeam)) {
          e.status.shieldHp = Math.max(e.status.shieldHp, Math.round(180 * lvlMult));
        }
        break;
      case 10: { // Yeti's Trail
        const free = findNearestFreeTile(this.grid, this.unitOccupancy, tx, ty) ?? { tx, ty };
        const yeti = this.spawnFromItem(587, free.tx, free.ty, casterTeam) ?? this.spawnFromItem(508, free.tx, free.ty, casterTeam);
        if (yeti) events.push({ type: "spawn", entity: yeti });
        break;
      }
      case 11: // Age of Colossus (30s = 900 ticks)
        for (const e of inRadius(casterTeam)) {
          e.status.enlargedTicks = Math.max(e.status.enlargedTicks, 900);
        }
        break;
      case 12: { // Summon Dragon
        const free = findNearestFreeTile(this.grid, this.unitOccupancy, tx, ty) ?? { tx, ty };
        const dragon = this.spawnFromItem(649, free.tx, free.ty, casterTeam) ?? this.spawnFromItem(602, free.tx, free.ty, casterTeam);
        if (dragon) events.push({ type: "spawn", entity: dragon });
        break;
      }
      case 13: // Instant Limit (`LimitDelegate.specialFillLimitToMax`)
        for (const e of inRadius(casterTeam)) {
          if (e.behavior?.hasLimitBar && e.limitMax > 0) {
            e.limitGauge = e.limitMax;
          }
        }
        break;
      case 14: // 2x Speed
        for (const e of inRadius(casterTeam)) {
          e.status.speed2xTicks = Math.max(e.status.speed2xTicks, 600);
        }
        break;
      case 15: // 2x Range
        for (const e of inRadius(casterTeam)) {
          e.status.range2xTicks = Math.max(e.status.range2xTicks, 600);
        }
        break;
      case 16: // Black Hole
        for (const e of inRadius(enemyTeam)) {
          const dmg = e.maxHp <= 500 * lvlMult ? e.hp + e.defense : Math.round(350 * lvlMult);
          this.applyDamage(e, dmg, events, { rawSpell: true });
        }
        break;
    }

    return events;
  }

  /**
   * Advances simulation by exactly 1 fixed tick (1/30s = 33.33ms, matching `SocialEmpires1.4.07sec_fixed.swf` 30 FPS).
   */
  step(): SimVisualEvent[] {
    this.tickCount += 1;
    const events: SimVisualEvent[] = [];

    // 0. Tick active Squad reposition timers (`battle/Squad.as`)
    for (const [id, sq] of this.squads) {
      sq.tick();
      if (sq.isEmpty) this.squads.delete(id);
    }

    // 1. Update status effects, cooldowns & entity AI/movement
    for (const ent of this.entities.values()) {
      ent.prevTx = ent.tx;
      ent.prevTy = ent.ty;

      if (!ent.alive) {
        if (ent.dyingTicks > 0) ent.dyingTicks -= 1;
        continue;
      }

      this.tickStatusEffects(ent, events);
      if (!ent.alive) continue;

      if (ent.attackCooldown > 0) ent.attackCooldown -= 1;
      if (ent.attackAnimTicks > 0) ent.attackAnimTicks -= 1;
      if (ent.damageParticleCooldown > 0) ent.damageParticleCooldown -= 1;
      if (ent.inCombatTicks > 0) ent.inCombatTicks -= 1;

      for (let i = 0; i < ent.specialCooldownTicks.length; i++) {
        if (ent.specialCooldownTicks[i]! > 0) {
          ent.specialCooldownTicks[i] = ent.specialCooldownTicks[i]! - 1;
        }
      }

      if (ent.status.frozenTicks > 0 || ent.status.dizzyTicks > 0) {
        ent.animState = 0;
        continue;
      }

      // Worker harvesting loop
      if (ent.type === "u" && ent.harvestTargetUid !== null) {
        this.tickWorkerHarvest(ent, events);
        continue;
      }

      // Combat AI & movement
      if (ent.type === "u") {
        // Canonical `IsoUnit.updateGarbageCollector` every 61 ticks (`IsoUnit.as:570, 637-676`)
        if ((this.tickCount + ent.uid) % CONFIG_GARBAGE_COLLECTOR_INTERVAL === 0) {
          this.tickUnitGarbageCollector(ent);
        }
        this.tickUnitAI(ent, events);
      } else if (ent.team !== "neutral" && ent.attack > 0 && ent.attackRange > 0) {
        this.tickTowerCombat(ent, events);
      }
    }

    // 2. Soft spatial separation pass so melee/moving ground units never collapse into one pixel
    applySoftUnitSeparation(this.entities.values(), this.grid);

    // 3. Advance projectiles
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i]!;
      p.progress += 1 / Math.max(1, p.durationTicks);
      if (p.progress >= 1) {
        this.resolveProjectileImpact(p, events);
        this.projectiles.splice(i, 1);
      }
    }

    return events;
  }

  private createSquad(units: readonly SimEntity[], targetUid: number | null): SquadGroup {
    for (const u of units) {
      this.detachFromSquad(u);
    }
    const sq = new SquadGroup(this.nextSquadId++, units.map((u) => u.uid), targetUid);
    this.squads.set(sq.id, sq);
    return sq;
  }

  private detachFromSquad(ent: SimEntity): void {
    if (ent.squadId === null) return;
    const sq = this.squads.get(ent.squadId);
    if (sq) {
      sq.pop(ent.uid);
      if (sq.isEmpty) this.squads.delete(sq.id);
    }
    ent.squadId = null;
  }

  /**
   * Canonical `IsoUnit.updateGarbageCollector` (`IsoUnit.as:637-676`):
   * If a stationary ground unit shares a tile with another unit or solid building,
   * smoothly steps it to the nearest free adjacent tile.
   */
  private tickUnitGarbageCollector(ent: SimEntity): void {
    if (ent.flying || ent.path.length > 0 || ent.harvestTargetUid !== null) return;
    const rtx = Math.round(ent.tx);
    const rty = Math.round(ent.ty);
    const blockedByBldg = this.grid.get(rtx, rty) !== 0;
    const sharingWithUnit = this.unitOccupancy.isSharingTile(ent.uid, rtx, rty);

    if (blockedByBldg || sharingWithUnit) {
      const free = findNearestFreeTile(this.grid, this.unitOccupancy, rtx, rty, {
        ignoreUid: ent.uid,
        maxRadius: 5
      });
      if (free && (free.tx !== rtx || free.ty !== rty)) {
        ent.path = [{ tx: free.tx, ty: free.ty }];
      }
    } else {
      this.unitOccupancy.claim(ent.uid, rtx, rty);
      // Canonical `IsoUnit.as:668-675`: re-center stationary unit on exact tile center
      if (Math.hypot(ent.tx - rtx, ent.ty - rty) > 0.08) {
        ent.path = [{ tx: rtx, ty: rty }];
      }
    }
  }

  private tickStatusEffects(ent: SimEntity, events: SimVisualEvent[]): void {
    const st = ent.status;
    if (st.frozenTicks > 0) st.frozenTicks -= 1;
    if (st.dizzyTicks > 0) st.dizzyTicks -= 1;
    if (st.enlargedTicks > 0) st.enlargedTicks -= 1;
    if (st.speed2xTicks > 0) st.speed2xTicks -= 1;
    if (st.range2xTicks > 0) st.range2xTicks -= 1;

    if (st.poisonTicks > 0) {
      st.poisonTicks -= 1;
      if (this.tickCount % 30 === 0) {
        this.applyDamage(ent, st.poisonDps, events, { rawSpell: true });
      }
    }
    if (st.burnTicks > 0) {
      st.burnTicks -= 1;
      if (this.tickCount % 30 === 0) {
        this.applyDamage(ent, st.burnDps, events, { rawSpell: true });
      }
    }
  }

  private tickWorkerHarvest(worker: SimEntity, events: SimVisualEvent[]): void {
    const res = worker.harvestTargetUid !== null ? this.entities.get(worker.harvestTargetUid) : null;
    if (!res || !res.alive) {
      worker.harvestTargetUid = null;
      worker.animState = 0;
      return;
    }

    const dist = this.distanceBetween(worker, res);
    if (dist > 1.35) {
      if (worker.path.length === 0) {
        const slot = findNearestFreeTile(this.grid, this.unitOccupancy, res.tx, res.ty, {
          ignoreUid: worker.uid,
          preferFrom: { tx: worker.tx, ty: worker.ty },
          maxRadius: 4
        });
        worker.path = findPath(
          this.grid,
          { tx: worker.tx, ty: worker.ty },
          slot ?? { tx: res.tx, ty: res.ty },
          {
            flying: false,
            ignoreEntityId: worker.uid,
            targetEntityId: res.uid,
            stopDistance: slot ? 0 : 1.2,
            unitOccupancy: this.unitOccupancy
          }
        );
        if (worker.path.length === 0) {
          worker.path = [{ tx: Math.round(res.tx), ty: Math.round(res.ty) }];
        }
      }
      this.stepAlongPath(worker);
      return;
    }

    worker.path = [];
    if (!worker.flying) this.unitOccupancy.claim(worker.uid, worker.tx, worker.ty);
    worker.orientation = deltaToOrientation(res.tx - worker.tx, res.ty - worker.ty, worker.orientation);
    worker.animState = 4; // ANIMATION_HARVESTING
    worker.harvestProgress += 1;

    if (worker.harvestProgress % 35 === 0) {
      const sfx =
        res.collectType === "w" ? "Lumber3Sound" : res.collectType === "f" ? "FarmSound" : "Rock6Sound";
      events.push({ type: "sfx", name: sfx });
    }

    if (worker.harvestProgress >= 75) {
      worker.harvestProgress = 0;
      const amount = Math.max(10, res.collectAmount || 20);
      events.push({
        type: "harvest",
        workerUid: worker.uid,
        resourceUid: res.uid,
        tx: res.tx,
        ty: res.ty,
        resourceType: res.collectType || "w",
        amount
      });
    }
  }

  private tickUnitAI(ent: SimEntity, events: SimVisualEvent[]): void {
    // Sync stance field if mutated externally by callers/tests
    const effectiveCondition: IACondition =
      ent.stance === "stand"
        ? isWorkerSubcat(ent.itemId, ent.subcatFunctional)
          ? "survive"
          : "passive"
        : ent.stance === "defensive"
          ? "defensive"
          : ent.iaCondition === "survive" || ent.iaCondition === "passive"
            ? ent.iaCondition
            : "aggressive";

    // 1. Canonical `IA.STATE_FORCE_MOVE` / `fleeing`: complete movement before re-engaging
    if (ent.iaState === "force_move" || ent.iaState === "fleeing") {
      if (ent.path.length > 0) {
        this.stepAlongPath(ent);
        return;
      }
      // `IA.DestinyReached()` (`IA.as:405-427`)
      ent.iaState = "idle";
      ent.animState = 0;
      if (!ent.flying) this.unitOccupancy.claim(ent.uid, ent.tx, ent.ty);
    }

    // 2. Canonical `IA.CONDITION_DEFENSIVE` leash (`IA.as:191-198`):
    // If Manhattan distance from origin exceeds 20 tiles, drop target and march back home!
    if (effectiveCondition === "defensive") {
      const manhattanFromOrigin =
        Math.abs(ent.originTx - Math.round(ent.tx)) + Math.abs(ent.originTy - Math.round(ent.ty));
      if (manhattanFromOrigin > CONFIG_DEFENSIVE_LEASH_MANHATTAN) {
        ent.targetUid = null;
        ent.iaState = "force_move";
        ent.path = findPath(
          this.grid,
          { tx: ent.tx, ty: ent.ty },
          { tx: ent.originTx, ty: ent.originTy },
          { flying: ent.flying, ignoreEntityId: ent.uid, unitOccupancy: this.unitOccupancy }
        );
        if (ent.path.length > 0) {
          this.stepAlongPath(ent);
          return;
        }
      }
    }

    // 3. Validate current target or pick highest-threat / best-scored enemy within `AGGRO_RANGE`
    let target = ent.targetUid !== null ? this.entities.get(ent.targetUid) ?? null : null;
    if (target && !target.alive) {
      ent.threatTable.delete(target.uid);
      ent.targetUid = null;
      target = null;
    }

    // For IAWithAgro bosses/dragons, honor top living threat target
    if (isBossOrDragon(ent) && ent.threatTable.size > 0 && ent.iaState !== "force_move") {
      const topThreat = this.getTopThreatTarget(ent);
      if (topThreat) {
        target = topThreat;
        ent.targetUid = topThreat.uid;
      }
    }

    if (
      !target &&
      ent.path.length === 0 &&
      ent.stance !== "stand" &&
      effectiveCondition !== "passive" &&
      effectiveCondition !== "survive" &&
      ent.attack > 0
    ) {
      const range =
        effectiveCondition === "defensive"
          ? Math.min(ent.aggroRange, CONFIG_AGGRO_RANGE)
          : Math.max(ent.aggroRange, CONFIG_AGGRO_RANGE);
      target = this.acquireBestTarget(ent, range);
      if (target) {
        ent.targetUid = target.uid;
        ent.iaState = "attacking";
      }
    }

    if (target) {
      const effRange = ent.attackRange * (ent.status.range2xTicks > 0 ? 2 : 1);
      const dist = this.distanceBetween(ent, target);

      if (dist <= effRange + 0.35) {
        ent.path = [];
        if (!ent.flying) this.unitOccupancy.claim(ent.uid, ent.tx, ent.ty);
        ent.orientation = deltaToOrientation(target.tx - ent.tx, target.ty - ent.ty, ent.orientation);
        ent.inCombatTicks = 90;

        // Enemy AI dragons auto-cast Limit when full
        if (ent.team === "enemy" && ent.behavior?.hasLimitBar && ent.limitMax > 0 && ent.limitGauge >= ent.limitMax) {
          const limitEvs = this.triggerLimitAttack(ent.uid);
          events.push(...limitEvs);
          ent.attackCooldown = ent.attackInterval;
          return;
        }

        if (ent.attackCooldown <= 0) {
          this.performAttack(ent, target, events);
          ent.attackCooldown = ent.attackInterval;
        } else if (ent.attackAnimTicks <= 0) {
          // Hold ready idle pose between attack intervals rather than spinning attack frames non-stop
          ent.animState = 0;
        }
        return;
      }

      // If standing ground (`hold_position`), drop out-of-range targets instead of chasing
      if (ent.stance === "stand" || ent.iaState === "hold_position") {
        ent.targetUid = null;
        ent.animState = 0;
        return;
      }

      // Squad reposition (`Squad.reposicionarSquad`, `Squad.as:46-86`) or solo chase repath
      if (ent.path.length === 0 || (this.tickCount + ent.delayAttack) % 18 === 0) {
        const sq = ent.squadId !== null ? this.squads.get(ent.squadId) : undefined;
        if (sq && sq.repositionCooldownTicks <= 0 && sq.targetUid === target.uid) {
          this.repositionSquadAroundTarget(sq, target);
        } else {
          const desiredSlot = computeAttackFormation(
            this.grid,
            this.unitOccupancy,
            { tx: target.tx, ty: target.ty, width: target.width, height: target.height },
            [
              {
                uid: ent.uid,
                tx: ent.tx,
                ty: ent.ty,
                attackRange: effRange,
                flying: ent.flying
              }
            ]
          ).get(ent.uid);

          ent.path = findPath(
            this.grid,
            { tx: ent.tx, ty: ent.ty },
            desiredSlot ?? { tx: target.tx, ty: target.ty },
            {
              flying: ent.flying,
              ignoreEntityId: ent.uid,
              targetEntityId: target.uid,
              stopDistance: desiredSlot ? 0 : Math.max(1, effRange - 0.3),
              unitOccupancy: this.unitOccupancy
            }
          );
        }
      }
    }

    if (ent.path.length > 0) {
      this.stepAlongPath(ent);
    } else if (ent.attackAnimTicks <= 0) {
      ent.animState = 0; // ANIMATION_IDLE
    }
  }

  /**
   * Canonical `Squad.reposicionarSquad` (`Squad.as:46-86`):
   * Repositions squad members that fell out of attack range or archers closer than
   * `DISTANCIA_MINIMA_ARQUEROS (3)` tiles from the moving target.
   */
  private repositionSquadAroundTarget(sq: SquadGroup, target: SimEntity): void {
    const needMove: SimEntity[] = [];
    for (const uid of sq.memberUids) {
      const m = this.entities.get(uid);
      if (!m || !m.alive) continue;
      const d = this.distanceBetween(m, target);
      const effRange = m.attackRange * (m.status.range2xTicks > 0 ? 2 : 1);
      if (d > effRange + 0.35 || (m.attackRange >= DISTANCIA_MINIMA_ARQUEROS && d < DISTANCIA_MINIMA_ARQUEROS - 0.5)) {
        needMove.push(m);
      }
    }
    if (needMove.length === 0) return;

    sq.repositionCooldownTicks = CONFIG_TIMER_REPOSITION_TICKS;
    const slots = computeAttackFormation(
      this.grid,
      this.unitOccupancy,
      { tx: target.tx, ty: target.ty, width: target.width, height: target.height },
      needMove.map((u) => ({
        uid: u.uid,
        tx: u.tx,
        ty: u.ty,
        attackRange: u.attackRange * (u.status.range2xTicks > 0 ? 2 : 1),
        flying: u.flying
      }))
    );

    for (const m of needMove) {
      const slot = slots.get(m.uid);
      if (!slot) continue;
      m.path = findPath(this.grid, { tx: m.tx, ty: m.ty }, slot, {
        flying: m.flying,
        ignoreEntityId: m.uid,
        targetEntityId: target.uid,
        unitOccupancy: this.unitOccupancy
      });
    }
  }

  private tickTowerCombat(tower: SimEntity, events: SimVisualEvent[]): void {
    if (tower.attackCooldown > 0) return;
    const target = this.acquireBestTarget(tower, tower.attackRange);
    if (!target) return;
    tower.inCombatTicks = 90;
    this.performAttack(tower, target, events);
    tower.attackCooldown = tower.attackInterval;
  }

  /**
   * Canonical `IsoUnit.updateMove` (`IsoUnit.as:2121-2194`, 30 FPS):
   * Moves at exact `uiSpeed` pixels/tick along the dominant isometric screen axis
   * (`54 / uiSpeed` ticks per orthogonal or N/S tile; `108 / uiSpeed` per E/W tile),
   * updating `UnitOccupancyMap` on tile crossings.
   */
  private stepAlongPath(ent: SimEntity): void {
    const next = ent.path[0];
    if (!next) {
      ent.animState = 0;
      return;
    }

    const dx = next.tx - ent.tx;
    const dy = next.ty - ent.ty;
    const dpx = (dx - dy) * (ISO_TILE_WIDTH * 0.5);
    const dpy = (dx + dy) * (ISO_TILE_HEIGHT * 0.5);
    const dominantPx = Math.max(Math.abs(dpx), Math.abs(dpy));
    const pxSpeed = Math.max(1, ent.velocity || 3) * (ent.status.speed2xTicks > 0 ? 2 : 1);

    ent.orientation = deltaToOrientation(dx, dy, ent.orientation);
    ent.animState = 1; // ANIMATION_WALKING

    const prevTileX = Math.round(ent.tx);
    const prevTileY = Math.round(ent.ty);

    if (dominantPx <= pxSpeed || dominantPx < 1e-4) {
      ent.tx = next.tx;
      ent.ty = next.ty;
      ent.path.shift();
    } else {
      const ratio = pxSpeed / dominantPx;
      ent.tx += dx * ratio;
      ent.ty += dy * ratio;
    }

    const curTileX = Math.round(ent.tx);
    const curTileY = Math.round(ent.ty);
    if (!ent.flying && (curTileX !== prevTileX || curTileY !== prevTileY)) {
      this.unitOccupancy.claim(ent.uid, curTileX, curTileY);
    }
  }

  private performAttack(attacker: SimEntity, target: SimEntity, events: SimVisualEvent[]): void {
    attacker.hitCounter += 1;
    const enlargeMult = attacker.status.enlargedTicks > 0 ? 1.6 : 1.0;

    // Check special attack triggers respecting per-special cooldowns (seconds * 30 Hz)
    const specials = attacker.behavior?.specials ?? [];
    let triggeredIdx = -1;
    for (let i = 0; i < specials.length; i++) {
      const s = specials[i]!;
      const cd = attacker.specialCooldownTicks[i] ?? 0;
      if (cd <= 0 && s.triggerEveryHits > 0 && attacker.hitCounter % s.triggerEveryHits === 0) {
        triggeredIdx = i;
        break;
      }
    }

    if (triggeredIdx >= 0) {
      const spec = specials[triggeredIdx]!;
      attacker.animState = spec.animState;
      attacker.animSeq += 1;
      attacker.attackAnimTicks = 22;
      const cdSec = Math.max(4, spec.cooldown ?? 18);
      attacker.specialCooldownTicks[triggeredIdx] = Math.round(cdSec * 30);
      this.executeSpecialAttack(attacker, target, spec, enlargeMult, events);
      return;
    }

    attacker.animState = 2; // ANIMATION_ATTACKING
    attacker.animSeq += 1;
    attacker.attackAnimTicks = Math.min(20, Math.max(10, Math.floor(attacker.attackInterval * 0.55)));
    const rawDamage = Math.max(1, Math.round(attacker.attack * enlargeMult));

    if (attacker.attackRange > 1.8) {
      const isBeam = attacker.groups.includes("dragon") || attacker.groups.includes("god");
      const kind: ProjectileKind = isBeam ? "beam" : attacker.groups.includes("siege") ? "rock" : "arrow";
      this.projectiles.push({
        id: this.nextProjId++,
        kind,
        sourceUid: attacker.uid,
        team: attacker.team,
        x: attacker.tx,
        y: attacker.ty,
        targetTx: target.tx,
        targetTy: target.ty,
        targetUid: target.uid,
        progress: 0,
        durationTicks: kind === "beam" ? 5 : Math.max(6, Math.round(this.distanceBetween(attacker, target) * 2.5)),
        damage: rawDamage,
        blastRadius: kind === "rock" ? 1.8 : 0,
        color: kind === "beam" ? 0x60e5ff : kind === "rock" ? 0xa89f91 : 0xffe484
      });
      events.push({
        type: "sfx",
        name: kind === "beam" ? "FireballSound" : kind === "rock" ? "CanonSound" : "Archer3Sound"
      });
    } else {
      this.applyDamage(target, rawDamage, events, { attacker });
      events.push({ type: "sfx", name: attacker.hitCounter % 2 === 0 ? "Sword2Sound" : "Sword5Sound" });
    }
  }

  private executeSpecialAttack(
    attacker: SimEntity,
    target: SimEntity,
    spec: SpecialAttackSpec,
    enlargeMult: number,
    events: SimVisualEvent[]
  ): void {
    const dmg = Math.max(1, Math.round(attacker.attack * spec.damageMultiplier * enlargeMult));
    const enemyTeam: TeamId = attacker.team === "player" ? "enemy" : "player";

    switch (spec.kind) {
      case "whirlwind":
      case "area_damage":
      case "rain":
      case "push_in_air":
      case "dizzy":
      case "freeze":
      case "poison":
      case "incinerate": {
        const cx = spec.kind === "whirlwind" ? attacker.tx : target.tx;
        const cy = spec.kind === "whirlwind" ? attacker.ty : target.ty;
        for (const e of this.entities.values()) {
          if (!e.alive || e.team !== enemyTeam) continue;
          if (Math.hypot(e.tx - cx, e.ty - cy) <= Math.max(1.5, spec.radius)) {
            this.applyDamage(e, dmg, events, { attacker, forceCrit: true });
            if (spec.kind === "dizzy" || spec.kind === "push_in_air") {
              e.status.dizzyTicks = Math.max(e.status.dizzyTicks, 45);
            }
            if (spec.kind === "freeze") {
              e.status.frozenTicks = Math.max(e.status.frozenTicks, 75);
            }
            if (spec.kind === "poison") {
              e.status.poisonTicks = Math.max(e.status.poisonTicks, 150);
              e.status.poisonDps = Math.max(8, Math.round(dmg * 0.15));
            }
            if (spec.kind === "incinerate") {
              e.status.burnTicks = Math.max(e.status.burnTicks, 120);
              e.status.burnDps = Math.max(10, Math.round(dmg * 0.2));
            }
          }
        }
        events.push({ type: "sfx", name: "FireballSound" });
        break;
      }
      case "beam":
      case "energy_balls": {
        this.projectiles.push({
          id: this.nextProjId++,
          kind: spec.kind === "beam" ? "beam" : "energy_ball",
          sourceUid: attacker.uid,
          team: attacker.team,
          x: attacker.tx,
          y: attacker.ty,
          targetTx: target.tx,
          targetTy: target.ty,
          targetUid: target.uid,
          progress: 0,
          durationTicks: 8,
          damage: dmg,
          blastRadius: spec.radius,
          color: 0x38bdf8
        });
        events.push({ type: "sfx", name: "FireballSound" });
        break;
      }
      case "spawn_minion": {
        const count = Math.max(1, Math.min(4, spec.summonCount ?? 2));
        const summonId = spec.summonItemId ?? 508;
        for (let i = 0; i < count; i++) {
          const slot = findNearestFreeTile(
            this.grid,
            this.unitOccupancy,
            attacker.tx + (i % 2 === 0 ? 1 : -1),
            attacker.ty + 1
          ) ?? { tx: Math.round(attacker.tx), ty: Math.round(attacker.ty) };
          const spawned = this.spawnFromItem(summonId, slot.tx, slot.ty, attacker.team);
          if (spawned) events.push({ type: "spawn", entity: spawned });
        }
        break;
      }
      case "heal_aura": {
        for (const e of this.entities.values()) {
          if (!e.alive || e.team !== attacker.team) continue;
          if (Math.hypot(e.tx - attacker.tx, e.ty - attacker.ty) <= Math.max(3, spec.radius)) {
            const h = Math.round(dmg);
            e.hp = Math.min(e.maxHp, e.hp + h);
            events.push({ type: "heal", targetUid: e.uid, tx: e.tx, ty: e.ty, amount: h });
          }
        }
        events.push({ type: "sfx", name: "CurarSound" });
        break;
      }
      case "direct_kill": {
        const finalDmg = target.maxHp <= dmg * 3 ? target.hp + target.defense : dmg;
        this.applyDamage(target, finalDmg, events, { attacker, forceCrit: true });
        break;
      }
    }
  }

  private resolveProjectileImpact(p: SimProjectile, events: SimVisualEvent[]): void {
    const attacker = this.entities.get(p.sourceUid);
    const enemyTeam: TeamId = p.team === "player" ? "enemy" : "player";
    if (p.blastRadius > 0) {
      let hitPrimary = false;
      for (const e of this.entities.values()) {
        if (!e.alive || e.team !== enemyTeam) continue;
        if (Math.hypot(e.tx - p.targetTx, e.ty - p.targetTy) <= p.blastRadius) {
          this.applyDamage(e, p.damage, events, { attacker });
          if (e.uid === p.targetUid) hitPrimary = true;
        }
      }
      if (!hitPrimary && p.targetUid !== null) {
        const t = this.entities.get(p.targetUid);
        if (t && t.alive) this.applyDamage(t, p.damage, events, { attacker });
      }
    } else if (p.targetUid !== null) {
      const t = this.entities.get(p.targetUid);
      if (t && t.alive) {
        this.applyDamage(t, p.damage, events, { attacker });
      }
    }
  }

  /**
   * Canonical `IsoFightingElement.calculateDamage` & `recibirAtaque` (`IsoFightingElement.as:249-279, 418-450`):
   * - 10% crit (`×1.5`), variance `±4` (`VARIANCE_DAMAGE = 8`)
   * - Siege vs unit: `ceil(atk / 2)`; unit vs siege: `ceil(atk * 1.25)`
   * - Defense subtraction 1:1 (`max(1, round(dmg - defense))`)
   * - Shield absorption & Limit gauge charge (`LimitDelegate.onDealedDamage`)
   * - Triggers `IA.BeingAttacked` & `IA.NearbyAllyAttacked`
   */
  private applyDamage(
    target: SimEntity,
    rawDamage: number,
    events: SimVisualEvent[],
    opts: { attacker?: SimEntity; forceCrit?: boolean; rawSpell?: boolean; allowLimitCharge?: boolean } = {}
  ): void {
    if (!target.alive) return;
    const attacker = opts.attacker;

    let nAttack = rawDamage;
    if (attacker && attacker.type === "u" && target.type === "u") {
      if (attacker.subcatFunctional === SUBCAT_UNIT_SIEGE) {
        nAttack = Math.ceil(nAttack / 2);
      }
      if (target.subcatFunctional === SUBCAT_UNIT_SIEGE) {
        nAttack = Math.ceil(nAttack * 1.25);
      }
    }

    let isCrit = Boolean(opts.forceCrit);
    let computed = nAttack;
    if (!opts.rawSpell) {
      if (!isCrit) {
        isCrit = this.nextRand() * 100 < 10; // IsoFightingElement.PERCENT_CRIT = 10
      }
      const variance = this.nextRand() * 8 - 4; // IsoFightingElement.VARIANCE_DAMAGE = 8
      computed = isCrit ? (nAttack + Math.abs(variance)) * 1.5 : nAttack + variance;
    }

    let absorbed = 0;
    if (target.status.shieldHp > 0) {
      absorbed = Math.min(target.status.shieldHp, Math.max(0, Math.round(computed)));
      target.status.shieldHp -= absorbed;
      computed -= absorbed;
    }

    const dmg = computed <= 0 && absorbed > 0 ? 0 : Math.max(1, Math.round(computed - target.defense));
    if (dmg <= 0 && absorbed <= 0) return;

    target.hp = Math.max(0, target.hp - dmg);
    target.inCombatTicks = 120;

    // Limit gauge charging (`LimitDelegate.onDealedDamage`, `LimitDelegate.as:221-250`)
    if (
      attacker &&
      attacker.alive &&
      attacker.behavior?.hasLimitBar &&
      attacker.limitMax > 0 &&
      opts.allowLimitCharge !== false &&
      this.tickCount - attacker.lastLimitChargeTick >= CONFIG_LIMIT_CHARGE_THROTTLE_TICKS
    ) {
      // Scale charge so dragons/heroes reach full LIMIT_MAX (2000) in ~12-18s of active combat
      const charge = Math.max(60, dmg * 3);
      attacker.limitGauge = Math.min(attacker.limitMax, attacker.limitGauge + charge);
      attacker.lastLimitChargeTick = this.tickCount;
    }

    const throttled = target.damageParticleCooldown > 0 && !isCrit && target.hp > 0;
    if (!throttled) {
      target.damageParticleCooldown = CONFIG_DAMAGE_PARTICLE_THROTTLE_TICKS;
    }
    events.push({
      type: "damage",
      targetUid: target.uid,
      targetTeam: target.team,
      tx: target.tx,
      ty: target.ty,
      amount: dmg,
      crit: isCrit,
      absorbed: absorbed > 0 ? absorbed : undefined,
      throttled
    });

    if (target.hp <= 0) {
      target.alive = false;
      target.animState = 3; // ANIMATION_DYING
      target.animSeq += 1;
      target.dyingTicks = CONFIG_TIMER_DEAD_DISAPPEAR_TICKS;
      target.path = [];
      this.detachFromSquad(target);
      if (target.type === "b") {
        this.grid.vacate(target.uid, Math.round(target.tx), Math.round(target.ty), target.width, target.height);
      } else {
        this.unitOccupancy.release(target.uid);
      }
      events.push(
        {
          type: "death",
          uid: target.uid,
          itemId: target.itemId,
          team: target.team,
          tx: target.tx,
          ty: target.ty,
          xp: target.xpValue
        },
        { type: "sfx", name: target.team === "enemy" ? "MuerteTrol2Sound" : "DieManSound" }
      );
      return;
    }

    // Trigger `IA.BeingAttacked` & `IA.NearbyAllyAttacked` (`IA.as:441-527`)
    if (attacker && attacker.alive && attacker.team !== target.team && target.type === "u") {
      this.onUnitBeingAttacked(target, attacker, dmg);
    }
  }

  /**
   * Canonical `IA.BeingAttacked` (`IA.as:441-498`) + `IAWithAgro.addThreat` (`IAWithAgro.as:103-138`)
   * + `IA.NearbyAllyAttacked` (`IA.as:500-527`).
   */
  private onUnitBeingAttacked(victim: SimEntity, attacker: SimEntity, damage: number): void {
    // IAWithAgro threat table for dragons/bosses (`AGGRO_FOCUS_MULTIPLIER = 1.5`)
    if (isBossOrDragon(victim)) {
      const topUid = this.getTopThreatUid(victim);
      const mult = topUid === attacker.uid ? 1.5 : 1.0;
      const prev = victim.threatTable.get(attacker.uid) ?? 0;
      victim.threatTable.set(attacker.uid, prev + Math.max(1, damage) * mult);
    }

    const cond: IACondition =
      victim.stance === "stand"
        ? isWorkerSubcat(victim.itemId, victim.subcatFunctional)
          ? "survive"
          : "passive"
        : victim.stance === "defensive"
          ? "defensive"
          : victim.iaCondition;

    if (cond === "survive") {
      // Civilian / peasant flees 5 tiles toward Town Hall or map center (`IA.as:489-495`)
      if (victim.iaState !== "fleeing") {
        let safeTx = 50;
        let safeTy = 50;
        for (const e of this.entities.values()) {
          if (e.alive && e.team === victim.team && e.subcatFunctional === SUBCAT_BUILDING_TOWNHALL) {
            safeTx = e.tx;
            safeTy = e.ty;
            break;
          }
        }
        const vx = safeTx - victim.tx;
        const vy = safeTy - victim.ty;
        const len = Math.hypot(vx, vy) || 1;
        const rawTx = Math.max(1, Math.min(this.grid.width - 2, Math.round(victim.tx + (vx / len) * CONFIG_SURVIVE_FLEE_TILES)));
        const rawTy = Math.max(1, Math.min(this.grid.height - 2, Math.round(victim.ty + (vy / len) * CONFIG_SURVIVE_FLEE_TILES)));
        const fleeDest = findNearestFreeTile(this.grid, this.unitOccupancy, rawTx, rawTy, { ignoreUid: victim.uid });
        if (fleeDest) {
          victim.targetUid = null;
          victim.harvestTargetUid = null;
          victim.iaState = "fleeing";
          victim.path = findPath(this.grid, { tx: victim.tx, ty: victim.ty }, fleeDest, {
            flying: victim.flying,
            ignoreEntityId: victim.uid,
            unitOccupancy: this.unitOccupancy
          });
        }
      }
      return;
    }

    if (cond === "passive" || victim.iaState === "force_move") {
      return;
    }

    // `CONDITION_DEFENSIVE` / `CONDITION_AGGRESSIVE` target-switch rules (`IA.as:463-485`)
    const curTarget = victim.targetUid !== null ? this.entities.get(victim.targetUid) ?? null : null;
    if (!curTarget || !curTarget.alive) {
      victim.targetUid = attacker.uid;
      victim.iaState = "attacking";
    } else if (curTarget.attack === 0 && attacker.attack > 0) {
      // Stop hitting passive structure to fight an active aggressor
      victim.targetUid = attacker.uid;
      victim.iaState = "attacking";
    } else if (curTarget.uid !== attacker.uid) {
      const distCur = this.distanceBetween(victim, curTarget);
      const distAtt = this.distanceBetween(victim, attacker);
      if (distAtt * 2 < distCur) {
        victim.targetUid = attacker.uid;
        victim.iaState = "attacking";
      }
    }

    // Alert nearby idle allies (`IA.NearbyAllyAttacked`, `IA.as:500-527`)
    for (const ally of this.entities.values()) {
      if (
        !ally.alive ||
        ally.uid === victim.uid ||
        ally.type !== "u" ||
        ally.team !== victim.team ||
        ally.attack <= 0 ||
        ally.targetUid !== null ||
        ally.iaState === "force_move" ||
        ally.stance === "stand" ||
        ally.iaCondition === "passive" ||
        ally.iaCondition === "survive"
      ) {
        continue;
      }
      if (this.distanceBetween(ally, victim) <= CONFIG_AGGRO_RANGE) {
        ally.targetUid = attacker.uid;
        ally.iaState = "attacking";
      }
    }
  }

  private getTopThreatUid(ent: SimEntity): number | null {
    let bestUid: number | null = null;
    let bestThreat = -1;
    for (const [uid, score] of ent.threatTable) {
      const candidate = this.entities.get(uid);
      if (!candidate || !candidate.alive) {
        ent.threatTable.delete(uid);
        continue;
      }
      if (score > bestThreat) {
        bestThreat = score;
        bestUid = uid;
      }
    }
    return bestUid;
  }

  private getTopThreatTarget(ent: SimEntity): SimEntity | null {
    const uid = this.getTopThreatUid(ent);
    return uid !== null ? this.entities.get(uid) ?? null : null;
  }

  /**
   * Canonical `IsoEngine.getNearestTarget` + `bucleNearestUnits` + `getElementScore`
   * (`IsoEngine.as:2245-2380`):
   * - `sort = dx² + dy² + (target.attack == 0 ? AGGRO_RANGE : 0)`
   * - `score = 1000 - sort + typePriority`
   *   - `IsoUnit`: +150
   *   - `TownHall`: +100
   *   - `Resource/Collect building`: +75
   *   - `Defensive building (attack > 0)`: +50
   *   - Passive non-resource structure: -1 (ignored by auto-targeting)
   */
  acquireBestTarget(origin: SimEntity, maxRange: number): SimEntity | null {
    if (origin.team === "neutral") return null;
    const enemyTeam: TeamId = origin.team === "player" ? "enemy" : "player";
    const maxRangeSq = maxRange * maxRange;

    let best: SimEntity | null = null;
    let bestScore = -1;

    for (const e of this.entities.values()) {
      if (!e.alive || e.team !== enemyTeam) continue;
      const dx = origin.tx - e.tx;
      const dy = origin.ty - e.ty;
      const distSq = dx * dx + dy * dy;
      if (distSq > maxRangeSq) continue;

      const sortVal = distSq + (e.attack === 0 ? CONFIG_AGGRO_RANGE : 0);
      let score = 1000 - sortVal;
      if (e.type === "u") {
        score += 150;
      } else if (e.subcatFunctional === SUBCAT_BUILDING_TOWNHALL) {
        score += 100;
      } else if (e.collectAmount > 0) {
        score += 75;
      } else if (e.attack > 0) {
        score += 50;
      } else {
        score = -1;
      }

      if (score > bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best;
  }

  private distanceBetween(a: SimEntity, b: SimEntity): number {
    const acx = a.tx - (a.width - 1) * 0.5;
    const acy = a.ty - (a.height - 1) * 0.5;
    const bcx = b.tx - (b.width - 1) * 0.5;
    const bcy = b.ty - (b.height - 1) * 0.5;
    const raw = Math.hypot(acx - bcx, acy - bcy);
    const radiusPad = (Math.max(a.width, a.height) + Math.max(b.width, b.height)) * 0.35;
    return Math.max(0, raw - radiusPad);
  }
}
