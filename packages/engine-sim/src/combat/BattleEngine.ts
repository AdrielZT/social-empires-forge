import type { GameItem, TileCoord } from "@sef/shared-types";
import type { OccupancyGrid } from "../index.js";
import { deltaToOrientation, findPath } from "../pathfinding/Pathfinder.js";

export type TeamId = "player" | "enemy" | "neutral";

export type StanceMode = "aggressive" | "defensive" | "stand";

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
  animState: number;       // 6..14 (ANIMATION_ATTACKING_SPECIAL1..9)
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
  width: number;
  height: number;
  orientation: number;
  animState: number; // 0=idle,1=walk,2=attack,3=die,4=harvest,5=repair,6+=special
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

  // Dynamic RTS state
  alive: boolean;
  dyingTicks: number;
  attackCooldown: number;
  hitCounter: number;
  limitGauge: number;
  stance: StanceMode;
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
  | { type: "damage"; targetUid: number; tx: number; ty: number; amount: number; crit?: boolean }
  | { type: "heal"; targetUid: number; tx: number; ty: number; amount: number }
  | { type: "death"; uid: number; itemId: number; team: TeamId; tx: number; ty: number; xp: number }
  | { type: "harvest"; workerUid: number; resourceUid: number; tx: number; ty: number; resourceType: string; amount: number }
  | { type: "spell_cast"; magicId: number; tx: number; ty: number; radius: number }
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
 * Deterministic 30 Hz RTS Combat, AI, Worker Harvesting, Projectile,
 * Special Ability, and 15-Magic-Spell simulation engine (zero DOM dependencies).
 */
export class BattleEngine {
  readonly entities = new Map<number, SimEntity>();
  readonly projectiles: SimProjectile[] = [];
  readonly grid: OccupancyGrid;
  readonly itemsById: ReadonlyMap<number, GameItem>;
  readonly behaviorsById: ReadonlyMap<number, UnitBehaviorProfile>;

  private nextUid = 10000;
  private nextProjId = 1;
  private tickCount = 0;

  constructor(
    grid: OccupancyGrid,
    itemsById: ReadonlyMap<number, GameItem>,
    behaviorsById: ReadonlyMap<number, UnitBehaviorProfile> = new Map()
  ) {
    this.grid = grid;
    this.itemsById = itemsById;
    this.behaviorsById = behaviorsById;
  }

  addEntity(ent: SimEntity): void {
    this.entities.set(ent.uid, ent);
    if (ent.uid >= this.nextUid) this.nextUid = ent.uid + 1;
    if (ent.type === "b") {
      this.grid.occupy(ent.uid, Math.round(ent.tx), Math.round(ent.ty), ent.width, ent.height);
    }
  }

  spawnFromItem(itemId: number, tx: number, ty: number, team: TeamId, orientation = 4): SimEntity | null {
    const def = this.itemsById.get(itemId);
    if (!def) return null;
    const behavior = this.behaviorsById.get(itemId);
    const maxHp = Math.max(1, def.life);
    const ent: SimEntity = {
      uid: this.nextUid++,
      itemId: def.id,
      imgName: def.imgName,
      name: def.name,
      type: def.type,
      team,
      tx,
      ty,
      prevTx: tx,
      prevTy: ty,
      width: def.width,
      height: def.height,
      orientation,
      animState: 0,
      hp: maxHp,
      maxHp,
      attack: def.attack,
      defense: def.defense,
      velocity: def.velocity,
      attackRange: Math.max(1, def.attackRange),
      attackInterval: Math.max(10, def.attackInterval || 30),
      flying: def.flying,
      subcatFunctional: def.subcatFunctional,
      groups: def.groups,
      xpValue: def.xp,
      collectAmount: def.collect,
      collectType: def.collectType || "g",
      alive: true,
      dyingTicks: 0,
      attackCooldown: 0,
      hitCounter: 0,
      limitGauge: 0,
      stance: "aggressive",
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

  orderMove(uids: readonly number[], goalTx: number, goalTy: number): void {
    const count = uids.length;
    const side = Math.max(1, Math.ceil(Math.sqrt(count)));
    uids.forEach((uid, idx) => {
      const ent = this.entities.get(uid);
      if (!ent || !ent.alive || ent.type !== "u") return;
      const ox = (idx % side) - Math.floor(side / 2);
      const oy = Math.floor(idx / side) - Math.floor(side / 2);
      const tx = Math.max(0, Math.min(this.grid.width - 1, Math.round(goalTx + ox)));
      const ty = Math.max(0, Math.min(this.grid.height - 1, Math.round(goalTy + oy)));
      ent.targetUid = null;
      ent.harvestTargetUid = null;
      ent.path = findPath(this.grid, { tx: ent.tx, ty: ent.ty }, { tx, ty }, {
        flying: ent.flying,
        ignoreEntityId: ent.uid
      });
    });
  }

  orderAttack(uids: readonly number[], targetUid: number): void {
    const target = this.entities.get(targetUid);
    if (!target || !target.alive) return;
    for (const uid of uids) {
      const ent = this.entities.get(uid);
      if (!ent || !ent.alive || ent.type !== "u" || ent.uid === targetUid) continue;
      ent.harvestTargetUid = null;
      ent.targetUid = targetUid;
      ent.path = findPath(
        this.grid,
        { tx: ent.tx, ty: ent.ty },
        { tx: target.tx, ty: target.ty },
        { flying: ent.flying, ignoreEntityId: ent.uid, targetEntityId: target.uid, stopDistance: Math.max(1, ent.attackRange - 0.5) }
      );
    }
  }

  orderHarvest(workerUid: number, resourceUid: number): void {
    const worker = this.entities.get(workerUid);
    const res = this.entities.get(resourceUid);
    if (!worker || !res || !worker.alive || !res.alive || worker.type !== "u") return;
    worker.targetUid = null;
    worker.harvestTargetUid = resourceUid;
    worker.harvestProgress = 0;
    worker.path = findPath(
      this.grid,
      { tx: worker.tx, ty: worker.ty },
      { tx: res.tx, ty: res.ty },
      { flying: false, ignoreEntityId: worker.uid, targetEntityId: res.uid, stopDistance: 1.5 }
    );
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
          this.applyDamage(e, Math.round(140 * lvlMult), events);
          e.status.burnTicks = Math.max(e.status.burnTicks, 90);
          e.status.burnDps = Math.round(10 * lvlMult);
        }
        break;
      case 3: // Ultimate Hail
        for (const e of inRadius(enemyTeam)) {
          this.applyDamage(e, Math.round(180 * lvlMult), events);
          e.status.dizzyTicks = Math.max(e.status.dizzyTicks, 45);
        }
        break;
      case 4: // Deadly Frostbite
        for (const e of inRadius(enemyTeam)) {
          e.status.frozenTicks = Math.max(e.status.frozenTicks, Math.round(180 * lvlMult));
          this.applyDamage(e, Math.round(35 * lvlMult), events);
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
        const golem = this.spawnFromItem(548, tx, ty, casterTeam) ?? this.spawnFromItem(508, tx, ty, casterTeam);
        if (golem) events.push({ type: "spawn", entity: golem });
        break;
      }
      case 7: // Hell Abyss (instant kill small units / heavy building damage)
        for (const e of inRadius(enemyTeam)) {
          const dmg = e.maxHp <= 350 * lvlMult ? e.hp : Math.round(250 * lvlMult);
          this.applyDamage(e, dmg, events);
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
        const yeti = this.spawnFromItem(587, tx, ty, casterTeam) ?? this.spawnFromItem(508, tx, ty, casterTeam);
        if (yeti) events.push({ type: "spawn", entity: yeti });
        break;
      }
      case 11: // Age of Colossus (30s = 900 ticks)
        for (const e of inRadius(casterTeam)) {
          e.status.enlargedTicks = Math.max(e.status.enlargedTicks, 900);
        }
        break;
      case 12: { // Summon Dragon
        const dragon = this.spawnFromItem(649, tx, ty, casterTeam) ?? this.spawnFromItem(602, tx, ty, casterTeam);
        if (dragon) events.push({ type: "spawn", entity: dragon });
        break;
      }
      case 13: // Instant Limit
        for (const e of inRadius(casterTeam)) {
          if (e.behavior?.hasLimitBar) {
            e.limitGauge = e.behavior.limitMax;
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
          const dmg = e.maxHp <= 500 * lvlMult ? e.hp : Math.round(350 * lvlMult);
          this.applyDamage(e, dmg, events);
        }
        break;
    }

    return events;
  }

  /**
   * Advances simulation by exactly 1 fixed tick (1/30s = 33.33ms).
   */
  step(): SimVisualEvent[] {
    this.tickCount += 1;
    const events: SimVisualEvent[] = [];

    // 1. Update status effects & entities
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
        this.tickUnitAI(ent, events);
      } else if (ent.attack > 0 && ent.attackRange > 0) {
        // Defensive towers & castles auto-fire at nearby enemies
        this.tickTowerCombat(ent, events);
      }
    }

    // 2. Advance projectiles (ParabolicProjectile, Beam, Blast)
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
        this.applyDamage(ent, st.poisonDps, events);
      }
    }
    if (st.burnTicks > 0) {
      st.burnTicks -= 1;
      if (this.tickCount % 30 === 0) {
        this.applyDamage(ent, st.burnDps, events);
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

    const dist = Math.hypot(res.tx - worker.tx, res.ty - worker.ty);
    if (dist > Math.max(res.width, res.height) + 0.9) {
      this.stepAlongPath(worker);
      return;
    }

    worker.orientation = deltaToOrientation(res.tx - worker.tx, res.ty - worker.ty);
    worker.animState = 4; // ANIMATION_HARVESTING
    worker.harvestProgress += 1;

    if (worker.harvestProgress % 45 === 0) {
      const sfx =
        res.collectType === "w" ? "Lumber3Sound" : res.collectType === "f" ? "FarmSound" : "Rock6Sound";
      events.push({ type: "sfx", name: sfx });
    }

    if (worker.harvestProgress >= 120) {
      worker.harvestProgress = 0;
      const amount = Math.max(10, res.collectAmount || 25);
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
    // 1. Validate current target or auto-acquire enemy within aggro range
    let target = ent.targetUid !== null ? this.entities.get(ent.targetUid) ?? null : null;
    if (target && !target.alive) {
      ent.targetUid = null;
      target = null;
    }

    if (!target && ent.path.length === 0 && ent.stance !== "stand" && ent.attack > 0) {
      target = this.findNearestEnemy(ent, Math.max(7, ent.attackRange + 3));
      if (target) ent.targetUid = target.uid;
    }

    if (target) {
      const effRange = ent.attackRange * (ent.status.range2xTicks > 0 ? 2 : 1);
      const dist = this.distanceBetween(ent, target);

      if (dist <= effRange + 0.35) {
        ent.path = [];
        ent.orientation = deltaToOrientation(target.tx - ent.tx, target.ty - ent.ty);
        if (ent.attackCooldown <= 0) {
          this.performAttack(ent, target, events);
          ent.attackCooldown = ent.attackInterval;
        } else {
          ent.animState = 2; // Keep attacking posture
        }
        return;
      }

      // Repath toward moving target periodically
      if (ent.path.length === 0 || this.tickCount % 18 === ent.uid % 18) {
        ent.path = findPath(
          this.grid,
          { tx: ent.tx, ty: ent.ty },
          { tx: target.tx, ty: target.ty },
          { flying: ent.flying, ignoreEntityId: ent.uid, targetEntityId: target.uid, stopDistance: Math.max(1, effRange - 0.3) }
        );
      }
    }

    if (ent.path.length > 0) {
      this.stepAlongPath(ent);
    } else {
      ent.animState = 0; // ANIMATION_IDLE
    }
  }

  private tickTowerCombat(tower: SimEntity, events: SimVisualEvent[]): void {
    if (tower.attackCooldown > 0) return;
    const target = this.findNearestEnemy(tower, tower.attackRange);
    if (!target) return;
    this.performAttack(tower, target, events);
    tower.attackCooldown = tower.attackInterval;
  }

  private stepAlongPath(ent: SimEntity): void {
    const next = ent.path[0];
    if (!next) {
      ent.animState = 0;
      return;
    }
    const dx = next.tx - ent.tx;
    const dy = next.ty - ent.ty;
    const dist = Math.hypot(dx, dy);
    const speedTilesPerTick = Math.max(0.04, (ent.velocity || 3) * 0.032) * (ent.status.speed2xTicks > 0 ? 2 : 1);

    ent.orientation = deltaToOrientation(dx, dy);
    ent.animState = 1; // ANIMATION_WALKING

    if (dist <= speedTilesPerTick) {
      ent.tx = next.tx;
      ent.ty = next.ty;
      ent.path.shift();
    } else {
      ent.tx += (dx / dist) * speedTilesPerTick;
      ent.ty += (dy / dist) * speedTilesPerTick;
    }
  }

  private performAttack(attacker: SimEntity, target: SimEntity, events: SimVisualEvent[]): void {
    attacker.hitCounter += 1;
    const enlargeMult = attacker.status.enlargedTicks > 0 ? 1.6 : 1.0;

    // Check data-driven special attack triggers (Phase 5 ready)
    const specials = attacker.behavior?.specials ?? [];
    const triggeredSpecial = specials.find(
      (s) => s.triggerEveryHits > 0 && attacker.hitCounter % s.triggerEveryHits === 0
    );

    if (attacker.behavior?.hasLimitBar) {
      attacker.limitGauge = Math.min(attacker.behavior.limitMax, attacker.limitGauge + 10);
    }

    if (triggeredSpecial) {
      attacker.animState = triggeredSpecial.animState;
      this.executeSpecialAttack(attacker, target, triggeredSpecial, enlargeMult, events);
      return;
    }

    attacker.animState = 2; // ANIMATION_ATTACKING
    const rawDamage = Math.max(1, Math.round(attacker.attack * enlargeMult));

    if (attacker.attackRange > 1.8) {
      // Ranged / Beam / Siege projectile (PR #48 fix: Beam always deals direct damage even if blastRadius == 0)
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
      events.push({ type: "sfx", name: kind === "beam" ? "FireballSound" : kind === "rock" ? "CanonSound" : "Archer3Sound" });
    } else {
      this.applyDamage(target, rawDamage, events);
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
            this.applyDamage(e, dmg, events, true);
            if (spec.kind === "dizzy" || spec.kind === "push_in_air") e.status.dizzyTicks = Math.max(e.status.dizzyTicks, 45);
            if (spec.kind === "freeze") e.status.frozenTicks = Math.max(e.status.frozenTicks, 75);
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
          const spawned = this.spawnFromItem(summonId, attacker.tx + (i % 2 === 0 ? 1 : -1), attacker.ty + 1, attacker.team);
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
        const finalDmg = target.maxHp <= dmg * 3 ? target.hp : dmg;
        this.applyDamage(target, finalDmg, events, true);
        break;
      }
    }
  }

  private resolveProjectileImpact(p: SimProjectile, events: SimVisualEvent[]): void {
    const enemyTeam: TeamId = p.team === "player" ? "enemy" : "player";
    if (p.blastRadius > 0) {
      let hitPrimary = false;
      for (const e of this.entities.values()) {
        if (!e.alive || e.team !== enemyTeam) continue;
        if (Math.hypot(e.tx - p.targetTx, e.ty - p.targetTy) <= p.blastRadius) {
          this.applyDamage(e, p.damage, events);
          if (e.uid === p.targetUid) hitPrimary = true;
        }
      }
      if (!hitPrimary && p.targetUid !== null) {
        const t = this.entities.get(p.targetUid);
        if (t && t.alive) this.applyDamage(t, p.damage, events);
      }
    } else if (p.targetUid !== null) {
      const t = this.entities.get(p.targetUid);
      if (t && t.alive) {
        this.applyDamage(t, p.damage, events);
      }
    }
  }

  private applyDamage(target: SimEntity, rawDamage: number, events: SimVisualEvent[], crit = false): void {
    if (!target.alive) return;
    // Social Empires defense reduction (minimum 1 damage)
    let dmg = Math.max(1, Math.round(rawDamage - target.defense * 0.25));
    if (target.status.shieldHp > 0) {
      const absorbed = Math.min(target.status.shieldHp, dmg);
      target.status.shieldHp -= absorbed;
      dmg -= absorbed;
    }
    if (dmg <= 0) return;

    target.hp = Math.max(0, target.hp - dmg);
    events.push({ type: "damage", targetUid: target.uid, tx: target.tx, ty: target.ty, amount: dmg, crit });

    if (target.hp <= 0) {
      target.alive = false;
      target.animState = 3; // ANIMATION_DYING
      target.dyingTicks = 45;
      if (target.type === "b") {
        this.grid.vacate(target.uid, Math.round(target.tx), Math.round(target.ty), target.width, target.height);
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
    }
  }

  private findNearestEnemy(origin: SimEntity, maxRange: number): SimEntity | null {
    const enemyTeam: TeamId = origin.team === "player" ? "enemy" : "player";
    let best: SimEntity | null = null;
    let bestDist = maxRange;
    for (const e of this.entities.values()) {
      if (!e.alive || e.team !== enemyTeam) continue;
      const d = this.distanceBetween(origin, e);
      if (d <= bestDist) {
        bestDist = d;
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
