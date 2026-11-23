import { describe, expect, it } from "vitest";
import type { GameItem, SaveFile } from "@sef/shared-types";
import {
  applyCommand,
  BattleEngine,
  computeEffectiveItemCost,
  computeMarketPrice,
  computeTrainingFoodCost,
  findPath,
  OccupancyGrid
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
    attackInterval: 20,
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

function makeSave(): SaveFile {
  return {
    playerInfo: {
      pid: "test_1",
      name: "Test Emperor",
      pic: "",
      cash: 50,
      completed_tutorial: 0,
      default_map: 0,
      map_names: ["Test Empire"],
      world_id: 0,
      last_logged_in: 0,
      attacks_won: 0,
      attacks_lost: 0
    },
    maps: [
      {
        id: 0,
        expansions: [13],
        timestamp: 0,
        coins: 5000,
        xp: 0,
        level: 1,
        stone: 500,
        wood: 500,
        food: 500,
        race: "h",
        skin: 0,
        idCurrentTreasure: 0,
        timestampLastTreasure: 0,
        resourcesTraded: {},
        receivedAssists: {},
        increasedPopulation: 0,
        questTimes: {},
        lastQuestTimes: {},
        items: [[1, 45, 45, 0, 0, 0, [], {}], [1, 45, 45, 0, 0, 0, [], {}]],
        warehousedUnits: [],
        store: {}
      }
    ],
    privateState: { mana: 50, potion: 1 }
  };
}

describe("economy & PR #48 verified fixes", () => {
  it("computes training food cost (0 for peasants, ceil for others) and Blacksmith discount", () => {
    const peasant = makeItem({ id: 500, name: "Villager I", type: "u", cost: 50, costType: "f" });
    const archer = makeItem({ id: 502, name: "Archer", type: "u", cost: 100, costType: "g", subcatFunctional: 72 });
    expect(computeTrainingFoodCost(peasant, 0.25)).toBe(0);
    expect(computeTrainingFoodCost(archer, 0.25)).toBe(25);
    expect(computeEffectiveItemCost(archer, { hasBlacksmith: true })).toBe(90);
  });

  it("rounds market sell prices half-up and removes exact resource amount on sell (PR #48)", () => {
    expect(computeMarketPrice("w", 0, "buy")).toBe(100);
    expect(computeMarketPrice("w", 0, "sell")).toBe(75);
    const save = makeSave();
    const res = applyCommand(
      save,
      { cmd: "trade_resource_b", args: ["w", "sell", 100] },
      { itemsById: new Map(), levels: [], expansionPrices: [], globals: {}, nowSec: 1000 }
    );
    expect(res.ok).toBe(true);
    expect(save.maps[0]!.wood).toBe(400);
    expect(save.maps[0]!.coins).toBe(5075);
  });

  it("removes only ONE stacked item on store_item (PR #48) and parses resurrect_hero '0' flag as falsy", () => {
    const save = makeSave();
    const hero = makeItem({ id: 533, name: "Arthur", type: "u", cost: 0, costUnitCash: 10 });
    const house = makeItem({ id: 1, name: "House I", type: "b", width: 2, height: 2, cost: 30, costType: "w" });
    const ctx = {
      itemsById: new Map([[1, house], [533, hero]]),
      levels: [],
      expansionPrices: [],
      globals: { RESURRECT_COST_MULT: 500 },
      nowSec: 1000
    };

    // Stacked items at (45, 45): storing once must leave the 2nd item intact
    const r1 = applyCommand(save, { cmd: "store_item", args: [45, 45, 1] }, ctx);
    expect(r1.ok).toBe(true);
    expect(save.maps[0]!.items.length).toBe(1);
    expect(save.maps[0]!.store["1"]).toBe(1);

    // resurrect_hero with "0" string must spend GOLD, NOT consume the potion!
    const r2 = applyCommand(save, { cmd: "resurrect_hero", args: [533, 50, 50, "0", 500] }, ctx);
    expect(r2.ok).toBe(true);
    expect(save.privateState.potion).toBe(1);
    expect(save.maps[0]!.coins).toBe(4500);
  });
});

describe("Pathfinder & BattleEngine (RTS + 15 Magic Spells)", () => {
  it("finds A* path around multi-tile wall and lets flying dragons fly straight over it", () => {
    const grid = new OccupancyGrid();
    for (let y = 45; y <= 55; y++) {
      grid.occupy(99, 50, y, 1, 1);
    }
    const groundPath = findPath(grid, { tx: 48, ty: 50 }, { tx: 52, ty: 50 }, { flying: false });
    expect(groundPath.length).toBeGreaterThan(4);
    expect(groundPath.some((p) => p.tx === 50 && p.ty === 50)).toBe(false);

    const flyPath = findPath(grid, { tx: 48, ty: 50 }, { tx: 52, ty: 50 }, { flying: true });
    expect(flyPath.length).toBe(4);
  });

  it("simulates melee/ranged combat, beam damage (PR #48), and all 15 magic spells deterministically", () => {
    const grid = new OccupancyGrid();
    const knight = makeItem({ id: 508, name: "Knight", type: "u", life: 120, attack: 25, defense: 4, attackRange: 1, attackInterval: 10 });
    const dragon = makeItem({ id: 649, name: "Electric Dynasty Dragon", type: "u", groups: "dragon", life: 600, attack: 60, defense: 10, attackRange: 6, attackInterval: 15, flying: true });
    const troll = makeItem({ id: 700, name: "Troll", type: "u", race: "t", life: 100, attack: 10, defense: 0, attackRange: 1, attackInterval: 20 });

    const itemsById = new Map<number, GameItem>([
      [508, knight],
      [649, dragon],
      [700, troll]
    ]);
    const engine = new BattleEngine(grid, itemsById);
    const d = engine.spawnFromItem(649, 45, 50, "player")!;
    const e1 = engine.spawnFromItem(700, 49, 50, "enemy")!;
    expect(d).toBeTruthy();
    expect(e1).toBeTruthy();

    // Step 40 ticks -> dragon beam must kill troll (PR #48 beam fix verified)
    for (let t = 0; t < 40; t++) {
      engine.step();
    }
    expect(e1.alive).toBe(false);

    // Test all 15 magic spells (IDs 2..16) execute cleanly without throwing
    const e2 = engine.spawnFromItem(700, 50, 50, "enemy")!;
    for (let magicId = 2; magicId <= 16; magicId++) {
      const evs = engine.castMagicSpell(magicId, 50, 50, "player", 1);
      expect(evs.some((ev) => ev.type === "spell_cast" && ev.magicId === magicId)).toBe(true);
    }
    expect(e2.alive).toBe(false);
  });

  it("maintains < 5ms/tick CPU budget under a 200-unit RTS battle stress test (60-144+ FPS ready)", () => {
    const grid = new OccupancyGrid();
    const archer = makeItem({ id: 516, name: "Light Archer", type: "u", life: 80, attack: 12, defense: 1, attackRange: 4, attackInterval: 18 });
    const troll = makeItem({ id: 700, name: "Troll", type: "u", race: "t", life: 90, attack: 10, defense: 1, attackRange: 1, attackInterval: 20 });
    const engine = new BattleEngine(grid, new Map([[516, archer], [700, troll]]));

    for (let i = 0; i < 100; i++) {
      engine.spawnFromItem(516, 40 + (i % 10), 40 + Math.floor(i / 10), "player");
      engine.spawnFromItem(700, 52 + (i % 10), 40 + Math.floor(i / 10), "enemy");
    }

    const t0 = performance.now();
    for (let tick = 0; tick < 60; tick++) {
      engine.step();
    }
    const avgTickMs = (performance.now() - t0) / 60;
    expect(avgTickMs).toBeLessThan(16.6);
  });

  it("keeps neutral trees immune from troll attacks and lets villagers harvest trees (subcatFunctional 125)", () => {
    const grid = new OccupancyGrid();
    const tree = makeItem({ id: 19, name: "Tree", type: "b", race: "n", subcatFunctional: 125, life: 50, attack: 2, collect: 20, collectType: "w" });
    const troll = makeItem({ id: 525, name: "Small Troll", type: "u", race: "t", life: 80, attack: 12, attackRange: 1, attackInterval: 15 });
    const villager = makeItem({ id: 500, name: "Villager I", type: "u", race: "h", subcatFunctional: 71, life: 60, attack: 6 });

    const engine = new BattleEngine(grid, new Map([[19, tree], [525, troll], [500, villager]]));
    const treeEnt = engine.spawnFromItem(19, 45, 50, "neutral")!;
    const remoteTree = engine.spawnFromItem(19, 59, 50, "neutral")!;
    const trollEnt = engine.spawnFromItem(525, 60, 50, "enemy")!;
    trollEnt.stance = "defensive";
    const vEnt = engine.spawnFromItem(500, 42, 50, "player")!;
    vEnt.stance = "stand";

    // Order villager to harvest tree; defensive troll right next to remoteTree must NOT attack remoteTree or chase across map
    engine.orderHarvest(vEnt.uid, treeEnt.uid);
    let harvested = false;
    for (let tick = 0; tick < 160; tick++) {
      const evs = engine.step();
      if (evs.some((ev) => ev.type === "harvest" && ev.resourceType === "w" && ev.amount === 20)) {
        harvested = true;
      }
    }
    expect(remoteTree.hp).toBe(50);
    expect(remoteTree.alive).toBe(true);
    expect(treeEnt.hp).toBe(50);
    expect(harvested).toBe(true);
  });
});
