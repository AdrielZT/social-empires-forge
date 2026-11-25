import { describe, expect, it } from "vitest";
import type { GameItem } from "@sef/shared-types";
import {
  BattleEngine,
  CONFIG_DEFENSIVE_LEASH_MANHATTAN,
  CONFIG_LIMIT_MAX_CANONICAL,
  deltaToOrientation,
  DISTANCIA_MINIMA_ARQUEROS,
  OccupancyGrid,
  SUBCAT_BUILDING_FARM,
  SUBCAT_BUILDING_TOWNHALL,
  SUBCAT_UNIT_PEASANT,
  SUBCAT_UNIT_SIEGE,
  type UnitBehaviorProfile
} from "./index.js";

function makeItem(partial: Partial<GameItem> & { id: number; name: string; type: "b" | "u" }): GameItem {
  return {
    inStore: true,
    cost: 100,
    costType: "g",
    xp: 10,
    groups: "",
    trains: 0,
    upgradesTo: 0,
    displayOrder: 1,
    activation: 0,
    expiration: 0,
    collect: 0,
    collectType: "g",
    collectXp: 0,
    categoryId: 1,
    subcategoryId: 1,
    subcatFunctional: 1,
    minLevel: 1,
    width: 1,
    height: 1,
    maxFrame: 2,
    giftable: true,
    imgName: "test",
    elevation: 1,
    unitCapacity: 0,
    attack: 0,
    defense: 1,
    life: 100,
    velocity: 3,
    attackRange: 1,
    attackInterval: 35,
    newItem: false,
    population: 1,
    giftLevel: 1,
    costUnitCash: 0,
    race: "h",
    flying: false,
    protect: 0,
    potion: 1,
    unitsLimit: 0,
    storeGroups: "",
    storeLevel: 0,
    onlyMobile: false,
    ...partial
  };
}

describe("Social Empires 1.4.07 — 1:1 Movement, Orientation, and Squad Separation", () => {
  it("maps all 8 isometric screen octants accurately without jitter on sub-tile micro-deltas", () => {
    expect(deltaToOrientation(-1, -1)).toBe(1); // UP
    expect(deltaToOrientation(0, -1)).toBe(2); // UP_RIGHT
    expect(deltaToOrientation(1, -1)).toBe(3); // RIGHT
    expect(deltaToOrientation(1, 0)).toBe(4); // DOWN_RIGHT
    expect(deltaToOrientation(1, 1)).toBe(5); // DOWN
    expect(deltaToOrientation(-1, 0)).toBe(6); // UP_LEFT
    expect(deltaToOrientation(-1, 1)).toBe(7); // LEFT
    expect(deltaToOrientation(0, 1)).toBe(8); // DOWN_LEFT

    // Nearly pure +ty with tiny dx drift must still face DOWN_LEFT (8), not snap to DOWN (5)
    expect(deltaToOrientation(0.05, 1.0)).toBe(8);
    expect(deltaToOrientation(1.0, -0.04)).toBe(4);
    // Tiny delta within pixel deadzone preserves fallback orientation
    expect(deltaToOrientation(0.01, 0.01, 6)).toBe(6);
  });

  it("advances units at exact canonical uiSpeed pixels/tick (54 / velocity ticks per orthogonal tile @ 30 Hz)", () => {
    const grid = new OccupancyGrid();
    const footman = makeItem({ id: 502, name: "Footman", type: "u", velocity: 3, attack: 10 });
    const dragon = makeItem({ id: 649, name: "Fast Dragon", type: "u", velocity: 6, attack: 40, flying: true });
    const engine = new BattleEngine(grid, new Map([[502, footman], [649, dragon]]));

    const uSlow = engine.spawnFromItem(502, 40, 40, "player")!;
    const uFast = engine.spawnFromItem(649, 40, 45, "player")!;
    engine.orderMove([uSlow.uid], 42, 40); // 2 orthogonal tiles -> 2 * (54/3) = 36 ticks
    engine.orderMove([uFast.uid], 42, 45); // 2 orthogonal tiles -> 2 * (54/6) = 18 ticks

    for (let t = 0; t < 18; t++) engine.step();
    expect(uFast.tx).toBeCloseTo(42, 2);
    expect(uSlow.tx).toBeCloseTo(41, 1);

    for (let t = 0; t < 18; t++) engine.step();
    expect(uSlow.tx).toBeCloseTo(42, 2);
  });

  it("spreads a 12-unit squad into distinct non-overlapping tiles on move and keeps archers at firing rings on attack", () => {
    const grid = new OccupancyGrid();
    const knight = makeItem({ id: 508, name: "Knight", type: "u", velocity: 5, attack: 20, attackRange: 1, life: 200 });
    const archer = makeItem({ id: 516, name: "Archer", type: "u", velocity: 4, attack: 10, attackRange: 5, life: 80 });
    const castle = makeItem({ id: 100, name: "Enemy Keep", type: "b", width: 2, height: 2, life: 3000, attack: 0, race: "t" });
    const engine = new BattleEngine(
      grid,
      new Map([[508, knight], [516, archer], [100, castle]])
    );

    const uids: number[] = [];
    for (let i = 0; i < 6; i++) {
      uids.push(engine.spawnFromItem(508, 35 + i, 50, "player")!.uid);
      uids.push(engine.spawnFromItem(516, 35 + i, 52, "player")!.uid);
    }

    // 1. Move all 12 units to the same tile (48, 50) -> all 12 must land on distinct tiles
    engine.orderMove(uids, 48, 50);
    for (let t = 0; t < 320; t++) engine.step();

    const finalTiles = new Set<string>();
    for (const uid of uids) {
      const u = engine.entities.get(uid)!;
      finalTiles.add(`${Math.round(u.tx)},${Math.round(u.ty)}`);
    }
    expect(finalTiles.size).toBe(12);

    // 2. Order mixed melee+archer squad to attack enemy building -> archers hold distance >= DISTANCIA_MINIMA_ARQUEROS
    const target = engine.spawnFromItem(100, 62, 50, "enemy")!;
    engine.orderAttack(uids, target.uid);
    for (let t = 0; t < 240; t++) engine.step();

    const attackTiles = new Set<string>();
    for (const uid of uids) {
      const u = engine.entities.get(uid)!;
      attackTiles.add(`${Math.round(u.tx)},${Math.round(u.ty)}`);
      if (u.itemId === 516) {
        const dist = Math.hypot(u.tx - target.tx, u.ty - target.ty);
        expect(dist).toBeGreaterThanOrEqual(DISTANCIA_MINIMA_ARQUEROS - 0.5);
      }
    }
    expect(attackTiles.size).toBeGreaterThanOrEqual(10);
  });

  it("allows units to walk across farms (SUBCATFUNC_BUILDING_FARM = 122)", () => {
    const grid = new OccupancyGrid();
    const farm = makeItem({ id: 12, name: "Farm", type: "b", width: 2, height: 2, subcatFunctional: SUBCAT_BUILDING_FARM });
    const villager = makeItem({ id: 500, name: "Villager", type: "u", subcatFunctional: SUBCAT_UNIT_PEASANT });
    const engine = new BattleEngine(grid, new Map([[12, farm], [500, villager]]));

    engine.spawnFromItem(12, 50, 50, "player");
    expect(grid.get(50, 50)).toBe(0);
  });
});

describe("Social Empires 1.4.07 — 1:1 Combat, IA.as/IAWithAgro.as, Cooldowns, and Limit Bar", () => {
  it("enforces IsoEngine.getElementScore priority (IsoUnit > TownHall > Resource > Tower > Passive)", () => {
    const grid = new OccupancyGrid();
    const attacker = makeItem({ id: 508, name: "Knight", type: "u", attack: 25, life: 200 });
    const wall = makeItem({ id: 20, name: "Wall", type: "b", attack: 0, collect: 0, life: 400, race: "t" });
    const tower = makeItem({ id: 21, name: "Tower", type: "b", attack: 15, attackRange: 6, life: 400, race: "t" });
    const hall = makeItem({ id: 22, name: "Town Hall", type: "b", subcatFunctional: SUBCAT_BUILDING_TOWNHALL, life: 800, race: "t" });
    const troll = makeItem({ id: 525, name: "Troll", type: "u", attack: 12, life: 80, race: "t" });

    const engine = new BattleEngine(
      grid,
      new Map([[508, attacker], [20, wall], [21, tower], [22, hall], [525, troll]])
    );
    const k = engine.spawnFromItem(508, 50, 50, "player")!;
    engine.spawnFromItem(20, 51, 50, "enemy"); // closest passive wall (score -1)
    const tow = engine.spawnFromItem(21, 53, 50, "enemy")!;
    const th = engine.spawnFromItem(22, 54, 50, "enemy")!;
    const tr = engine.spawnFromItem(525, 55, 50, "enemy")!;

    expect(engine.acquireBestTarget(k, 10)?.uid).toBe(tr.uid); // Unit (+150) wins over closer buildings
    tr.alive = false;
    expect(engine.acquireBestTarget(k, 10)?.uid).toBe(th.uid); // TownHall (+100) wins over Tower (+50)
    th.alive = false;
    expect(engine.acquireBestTarget(k, 10)?.uid).toBe(tow.uid); // Tower (+50) wins over passive Wall (-1)
    tow.alive = false;
    expect(engine.acquireBestTarget(k, 10)).toBeNull(); // Passive wall is ignored by auto-aggro
  });

  it("enforces defensive leash (> 20 Manhattan tiles returns to origin) and peasant survive-flee behavior", () => {
    const grid = new OccupancyGrid();
    const troll = makeItem({ id: 525, name: "Guard Troll", type: "u", velocity: 5, attack: 10, life: 120, race: "t" });
    const peasant = makeItem({ id: 500, name: "Villager", type: "u", velocity: 4, subcatFunctional: SUBCAT_UNIT_PEASANT, life: 100 });
    const hall = makeItem({ id: 10, name: "Town Hall", type: "b", subcatFunctional: SUBCAT_BUILDING_TOWNHALL, life: 1000 });
    const engine = new BattleEngine(grid, new Map([[525, troll], [500, peasant], [10, hall]]));

    engine.spawnFromItem(10, 50, 50, "player");
    const guard = engine.spawnFromItem(525, 70, 70, "enemy")!;
    engine.setUnitsStance([guard.uid], "defensive");
    // Displace guard beyond CONFIG_DEFENSIVE_LEASH_MANHATTAN (20)
    guard.tx = 70 - CONFIG_DEFENSIVE_LEASH_MANHATTAN - 2;
    guard.ty = 70;
    engine.step();
    expect(guard.iaState).toBe("force_move");
    expect(guard.targetUid).toBeNull();
    expect(guard.path.length).toBeGreaterThan(0);

    // Peasant attacked by troll must flee toward Town Hall (`IA.CONDITION_SURVIVE`)
    const worker = engine.spawnFromItem(500, 62, 50, "player")!;
    const raider = engine.spawnFromItem(525, 63, 50, "enemy")!;
    for (let t = 0; t < 10; t++) engine.step();
    expect(worker.iaState === "fleeing" || worker.tx < 62).toBe(true);
    expect(raider.alive).toBe(true);
  });

  it("applies canonical siege modifiers, special cooldowns in seconds, and Limit bar charge/activation", () => {
    const grid = new OccupancyGrid();
    const dragonItem = makeItem({
      id: 649,
      name: "Furious Dragon",
      type: "u",
      groups: "dragon",
      attack: 120,
      defense: 10,
      life: 1600,
      attackRange: 6,
      attackInterval: 15,
      flying: true
    });
    const siegeItem = makeItem({
      id: 602,
      name: "Siege Tower",
      type: "u",
      subcatFunctional: SUBCAT_UNIT_SIEGE,
      groups: "siege",
      attack: 40,
      defense: 0,
      life: 2000,
      attackRange: 6,
      attackInterval: 20
    });
    const behavior: UnitBehaviorProfile = {
      itemId: 649,
      className: "FuriousRedDragonDelegate",
      isSpecialUnit: true,
      hasLimitBar: true,
      limitMax: 100,
      scale: 1,
      specials: [
        {
          id: "dragon_flame",
          name: "Fire Breath",
          kind: "area_damage",
          animState: 6,
          cooldown: 10,
          triggerEveryHits: 10,
          damageMultiplier: 2.0,
          radius: 4.5
        }
      ]
    };

    const engine = new BattleEngine(
      grid,
      new Map([[649, dragonItem], [602, siegeItem]]),
      new Map([[649, behavior]])
    );
    const dragon = engine.spawnFromItem(649, 45, 50, "player")!;
    const siege = engine.spawnFromItem(602, 48, 50, "enemy")!;
    expect(dragon.limitMax).toBe(CONFIG_LIMIT_MAX_CANONICAL);

    // Trigger special ability -> sets 10s * 30Hz = 300 ticks cooldown and rejects immediate recast
    const sp1 = engine.triggerSpecialAbility(dragon.uid, 0);
    expect(sp1.some((e) => e.type === "damage")).toBe(true);
    expect(dragon.specialCooldownTicks[0]).toBe(300);
    expect(engine.triggerSpecialAbility(dragon.uid, 0)).toHaveLength(0);
    expect(dragon.limitGauge).toBeGreaterThan(0);

    // Fill Limit via Instant Limit (magicId 13) and fire Limit Attack -> resets gauge to 0
    engine.castMagicSpell(13, dragon.tx, dragon.ty, "player", 1);
    expect(dragon.limitGauge).toBe(CONFIG_LIMIT_MAX_CANONICAL);
    const limEvs = engine.triggerLimitAttack(dragon.uid);
    expect(limEvs.some((e) => e.type === "limit_cast" && e.unitUid === dragon.uid)).toBe(true);
    expect(dragon.limitGauge).toBe(0);
    expect(siege.hp).toBeLessThan(2000);
  });
});
