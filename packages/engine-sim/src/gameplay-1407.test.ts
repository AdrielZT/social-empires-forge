import { describe, expect, it } from "vitest";
import type { GameItem, SaveFile } from "@sef/shared-types";
import {
  applyCommand,
  BattleEngine,
  computeEarlyUnlockCashCost,
  computeFarmReplantWoodCost,
  computeProducerYield,
  DRAGON_NEST_IDS,
  ID_BUILDING_REGEN_GOLD,
  ID_BUILDING_REGEN_STONE,
  MONSTER_NEST_IDS,
  NEST_STEP_COOLDOWN_SEC,
  OccupancyGrid,
  REGEN_ORE_DURATION_SEC,
  SUBCAT_BUILDING_FARM,
  SUBCAT_BUILDING_MILL,
  SUBCAT_RESOURCE_GOLD,
  SUBCAT_RESOURCE_STONE,
  SUBCAT_RESOURCE_TREE,
  type CommandExecutionContext,
  type LevelTableEntry
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
    collectXp: 1,
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

const LEVELS_SAMPLE: LevelTableEntry[] = [
  { name: "Slave", exp_required: 0, reward_type: "s", reward_amount: 50 },
  { name: "Servant", exp_required: 29, reward_type: "w", reward_amount: 50 },
  { name: "Peon", exp_required: 60, reward_type: "f", reward_amount: 50 },
  { name: "Peasant", exp_required: 100, reward_type: "w", reward_amount: 400 },
  { name: "Villager", exp_required: 200, reward_type: "c", reward_amount: 1 },
  { name: "Scout", exp_required: 350, reward_type: "c", reward_amount: 1 }
];

function makeSave(overrides: Partial<SaveFile["maps"][0]> = {}): SaveFile {
  return {
    playerInfo: {
      pid: "p1",
      name: "Emperor",
      pic: "",
      cash: 20,
      completed_tutorial: 1,
      default_map: 0,
      map_names: ["Empire"],
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
        xp: 30,
        level: 2,
        stone: 250,
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
        items: [],
        warehousedUnits: [],
        store: {},
        ...overrides
      }
    ],
    privateState: { mana: 30 }
  };
}

describe("Social Empires 1.4.07 — Phases 1..7 Gameplay Fidelity", () => {
  it("Phase 1: awards exact levels.json rewards across multi-level jumps (+Food, +Wood, +1 Cash at L5+)", () => {
    const save = makeSave({ level: 2, xp: 30, food: 100, wood: 100 });
    const ctx: CommandExecutionContext = {
      itemsById: new Map(),
      levels: LEVELS_SAMPLE,
      expansionPrices: [],
      globals: { START_LEVEL_MANA_REWARD: 36, MANA_REWARD_PER_LEVEL: 2 },
      nowSec: 1000
    };

    // +200 XP takes player from 30 -> 230 XP, crossing L3 (f:50), L4 (w:400), and L5 (c:1)
    const res = applyCommand(save, { cmd: "reward_goal", args: [1, 100, 200] }, ctx);
    expect(res.ok).toBe(true);
    expect(save.maps[0]!.level).toBe(5);
    expect(save.maps[0]!.food).toBe(150); // +50 from L3
    expect(save.maps[0]!.wood).toBe(500); // +400 from L4
    expect(save.playerInfo.cash).toBe(21); // +1 Cash from L5

    const levelEvents = res.events.filter((e) => e.type === "level_up");
    expect(levelEvents).toHaveLength(3);
    expect(levelEvents.map((e) => e.level)).toEqual([3, 4, 5]);
    expect(levelEvents[2]!.rewardType).toBe("c");
    expect(levelEvents[2]!.rewardAmount).toBe(1);
    expect(levelEvents[2]!.rankName).toBe("Villager");
    expect(res.events.some((e) => e.type === "sfx" && e.name === "LevelUpSound")).toBe(true);
  });

  it("Phase 2: enforces User Mode level locks & canonical Cash early unlock, while Admin Mode unlocks everything", () => {
    const castle = makeItem({
      id: 99,
      name: "Royal Castle",
      type: "b",
      minLevel: 12,
      cost: 20000,
      costType: "g",
      inStore: true
    });
    const secretDragon = makeItem({
      id: 999,
      name: "Secret Dragon",
      type: "u",
      minLevel: 30,
      cost: 100,
      costType: "c",
      inStore: false
    });
    const itemsById = new Map<number, GameItem>([
      [99, castle],
      [999, secretDragon]
    ]);
    const save = makeSave({ level: 2, coins: 30000 });
    const userCtx: CommandExecutionContext = {
      itemsById,
      levels: LEVELS_SAMPLE,
      expansionPrices: [],
      globals: {},
      nowSec: 1000,
      adminMode: false
    };

    // User Mode blocks locked store item & non-store item
    expect(applyCommand(save, { cmd: "buy", args: [99, 50, 50, 0] }, userCtx).ok).toBe(false);
    expect(applyCommand(save, { cmd: "buy", args: [999, 50, 50, 0] }, userCtx).ok).toBe(false);

    // Canonical early unlock with Cash: ceil(12 * 1/3) = 4 Cash
    expect(computeEarlyUnlockCashCost(12)).toBe(4);
    const unlockRes = applyCommand(save, { cmd: "unlock_building", args: [99] }, userCtx);
    expect(unlockRes.ok).toBe(true);
    expect(save.playerInfo.cash).toBe(16);
    expect(applyCommand(save, { cmd: "buy", args: [99, 50, 50, 0] }, userCtx).ok).toBe(true);

    // Admin Mode unlocks non-store & high-level items freely without losing the save
    const adminCtx: CommandExecutionContext = { ...userCtx, adminMode: true };
    const adminBuy = applyCommand(save, { cmd: "buy", args: [999, 51, 51, 0] }, adminCtx);
    expect(adminBuy.ok).toBe(true);
    expect(save.maps[0]!.items.some((it) => it[0] === 999)).toBe(true);
  });

  it("Phase 3: executes full Dragon Nest (1233) & Monster Nest (1255) lifecycle commands", () => {
    const dragon1 = makeItem({ id: DRAGON_NEST_IDS[0], name: "Dragon I", type: "u", xp: 100 });
    const monster1 = makeItem({ id: MONSTER_NEST_IDS[0], name: "Monster I", type: "u", xp: 100 });
    const save = makeSave({ coins: 150000 });
    save.playerInfo.cash = 100;
    const ctx: CommandExecutionContext = {
      itemsById: new Map([
        [dragon1.id, dragon1],
        [monster1.id, monster1]
      ]),
      levels: LEVELS_SAMPLE,
      expansionPrices: [],
      globals: {},
      nowSec: 10000,
      adminMode: false
    };

    expect(applyCommand(save, { cmd: "activate_dragon", args: [0] }, ctx).ok).toBe(true);
    expect(save.maps[0]!.coins).toBe(50000);
    expect(save.privateState.dragonNestActive).toBe(1);

    // First step succeeds; immediate second step blocked by 6h cooldown
    expect(applyCommand(save, { cmd: "next_step_dragon", args: [] }, ctx).ok).toBe(true);
    expect(save.privateState.stepNumber).toBe(1);
    expect(applyCommand(save, { cmd: "next_step_dragon", args: [] }, ctx).ok).toBe(false);

    // After 6h cooldown, step 2 succeeds; buy_step_dragon speeds up steps 3..10
    const laterCtx = { ...ctx, nowSec: 10000 + NEST_STEP_COOLDOWN_SEC + 1 };
    expect(applyCommand(save, { cmd: "next_step_dragon", args: [] }, laterCtx).ok).toBe(true);
    for (let i = 0; i < 8; i++) {
      expect(applyCommand(save, { cmd: "buy_step_dragon", args: [] }, laterCtx).ok).toBe(true);
    }
    expect(save.privateState.stepNumber).toBe(10);

    // Hatch Dragon 1 (638) onto tile (52, 52) and advance to Dragon 2
    const hatchRes = applyCommand(save, { cmd: "next_dragon", args: [52, 52] }, laterCtx);
    expect(hatchRes.ok).toBe(true);
    expect(save.maps[0]!.items.some((it) => it[0] === DRAGON_NEST_IDS[0] && it[1] === 52 && it[2] === 52)).toBe(true);
    expect(save.privateState.dragonNumber).toBe(1);
    expect(save.privateState.stepNumber).toBe(0);

    // Monster Nest activation via Cash (50)
    expect(applyCommand(save, { cmd: "activate_monster", args: [1] }, laterCtx).ok).toBe(true);
    expect(save.privateState.monsterNestActive).toBe(1);
  });

  it("Phase 4 & 6: emits harvest SFX only on arrival (not while walking), depletes natural tree, and auto-chains to next tree", () => {
    const grid = new OccupancyGrid();
    const tree = makeItem({
      id: 19,
      name: "Tree",
      type: "b",
      race: "n",
      subcatFunctional: SUBCAT_RESOURCE_TREE,
      activation: 3.24,
      collect: 20,
      collectType: "w"
    });
    const villager = makeItem({ id: 500, name: "Villager", type: "u", subcatFunctional: 71, velocity: 3 });
    const engine = new BattleEngine(
      grid,
      new Map([
        [19, tree],
        [500, villager]
      ])
    );

    const t1 = engine.spawnFromItem(19, 46, 50, "neutral")!;
    const t2 = engine.spawnFromItem(19, 49, 50, "neutral")!;
    const v = engine.spawnFromItem(500, 42, 50, "player")!;

    engine.orderHarvest(v.uid, t1.uid);

    let sfxWhileWalking = 0;
    let sfxOnArrival = 0;
    let depletedCount = 0;

    for (let tick = 0; tick < 170; tick++) {
      const evs = engine.step();
      const isWalking = v.animState === 1 || (v.path.length > 0 && v.harvestProgress === 0);
      for (const ev of evs) {
        if (ev.type === "sfx" && ev.name === "Lumber3Sound") {
          if (isWalking) sfxWhileWalking += 1;
          else sfxOnArrival += 1;
        }
        if (ev.type === "harvest" && ev.depleted && ev.resourceUid === t1.uid) {
          depletedCount += 1;
        }
      }
      if (depletedCount > 0) break;
    }

    expect(sfxWhileWalking).toBe(0);
    expect(sfxOnArrival).toBeGreaterThanOrEqual(1);
    expect(depletedCount).toBe(1);
    expect(t1.alive).toBe(false);
    expect(grid.get(46, 50)).toBe(0);
    // Villager auto-chains to t2!
    expect(v.harvestTargetUid).toBe(t2.uid);

    // Command-side HARVEST sell gives 0 refund, and stone/gold regen spawns & finishes cleanly
    const save = makeSave({
      coins: 500,
      items: [
        [19, 46, 50, 0, 100, 0, [], {}],
        [69, 48, 50, 0, 100, 0, [], {}]
      ]
    });
    const ctx: CommandExecutionContext = {
      itemsById: new Map([[19, tree]]),
      levels: LEVELS_SAMPLE,
      expansionPrices: [],
      globals: {},
      nowSec: 1000
    };
    const sellTree = applyCommand(save, { cmd: "sell", args: [46, 50, 19, "HARVEST"] }, ctx);
    expect(sellTree.ok).toBe(true);
    expect(save.maps[0]!.coins).toBe(500); // 0 sell refund on HARVEST
    expect(save.maps[0]!.items.some((it) => it[0] === 19)).toBe(false);

    expect(applyCommand(save, { cmd: "spawn_regen_node", args: [48, 50, ID_BUILDING_REGEN_STONE] }, ctx).ok).toBe(true);
    expect(applyCommand(save, { cmd: "finish_regen", args: [48, 50, ID_BUILDING_REGEN_STONE] }, ctx).ok).toBe(false);
    const after3h = { ...ctx, nowSec: 1000 + REGEN_ORE_DURATION_SEC + 1 };
    expect(applyCommand(save, { cmd: "finish_regen", args: [48, 50, ID_BUILDING_REGEN_STONE] }, after3h).ok).toBe(true);
    expect(save.maps[0]!.items.some((it) => it[0] === ID_BUILDING_REGEN_STONE)).toBe(false);
    expect(ID_BUILDING_REGEN_GOLD).toBe(80);
    expect(SUBCAT_RESOURCE_STONE).toBe(126);
    expect(SUBCAT_RESOURCE_GOLD).toBe(127);
  });

  it("Phase 5: villagers disappear inside mines/mills & farms, produce with +20% worker bonus, and farms deduct replant wood", () => {
    const grid = new OccupancyGrid();
    const goldMine = makeItem({
      id: 13,
      name: "Gold Mine I",
      type: "b",
      width: 2,
      height: 2,
      subcatFunctional: SUBCAT_BUILDING_MILL,
      unitCapacity: 2,
      collect: 100,
      collectType: "g"
    });
    const farm = makeItem({
      id: 8,
      name: "Pumpkin Crop",
      type: "b",
      width: 2,
      height: 2,
      subcatFunctional: SUBCAT_BUILDING_FARM,
      unitCapacity: 1,
      activation: 32.4,
      collect: 25,
      collectType: "f"
    });
    const villager = makeItem({ id: 500, name: "Villager", type: "u", subcatFunctional: 71, velocity: 4 });
    const itemsById = new Map<number, GameItem>([
      [13, goldMine],
      [8, farm],
      [500, villager]
    ]);
    const engine = new BattleEngine(grid, itemsById);

    const mineEnt = engine.spawnFromItem(13, 50, 50, "player")!;
    const v1 = engine.spawnFromItem(500, 47, 50, "player")!;
    engine.orderHarvest(v1.uid, mineEnt.uid);

    let entered = false;
    for (let t = 0; t < 120; t++) {
      const evs = engine.step();
      if (evs.some((e) => e.type === "worker_enter_building" && e.buildingUid === mineEnt.uid)) {
        entered = true;
        break;
      }
    }
    expect(entered).toBe(true);
    expect(v1.alive).toBe(false); // Villager disappeared inside mine
    expect(mineEnt.garrison).toEqual([500]);

    // Command persistence: push_unit -> activate (cp=2 -> x1.0) -> collect_new with 2 villagers (+20% bonus = 120 Gold)
    const save = makeSave({
      coins: 0,
      wood: 100,
      food: 0,
      items: [
        [13, 50, 50, 0, 1000, 0, [], {}],
        [500, 47, 50, 4, 1000, 0, [], {}],
        [500, 48, 50, 4, 1000, 0, [], {}],
        [8, 54, 50, 0, 1000, 0, [], {}],
        [500, 53, 50, 4, 1000, 0, [], {}]
      ]
    });
    const ctx: CommandExecutionContext = {
      itemsById,
      levels: LEVELS_SAMPLE,
      expansionPrices: [],
      globals: {},
      nowSec: 2000
    };

    expect(applyCommand(save, { cmd: "push_unit", args: [50, 50, 13, 500, 47, 50] }, ctx).ok).toBe(true);
    expect(applyCommand(save, { cmd: "push_unit", args: [50, 50, 13, 500, 48, 50] }, ctx).ok).toBe(true);
    const mineTuple = save.maps[0]!.items.find((it) => it[0] === 13)!;
    expect(mineTuple[6]).toEqual([500, 500]);

    expect(applyCommand(save, { cmd: "activate", args: [50, 50, 13, 2] }, ctx).ok).toBe(true);
    expect(computeProducerYield(100, 2, 2)).toBe(120);
    expect(applyCommand(save, { cmd: "collect_new", args: [50, 50, 13, 2] }, ctx).ok).toBe(true);
    expect(save.maps[0]!.coins).toBe(120);
    expect(mineTuple[7].cp).toBe(0);

    // Pop villager back onto map
    expect(applyCommand(save, { cmd: "pop_unit", args: [50, 50, 13, 500, 49, 50] }, ctx).ok).toBe(true);
    expect(mineTuple[6]).toEqual([500]);
    expect(save.maps[0]!.items.some((it) => it[0] === 500 && it[1] === 49 && it[2] === 50)).toBe(true);

    // Farm enter + collect deducts round(25/3)=8 Wood and keeps farmer sowing
    expect(applyCommand(save, { cmd: "push_unit", args: [54, 50, 8, 500, 53, 50] }, ctx).ok).toBe(true);
    expect(computeFarmReplantWoodCost(25)).toBe(8);
    expect(applyCommand(save, { cmd: "collect_new", args: [54, 50, 8, 2, 55, 50] }, ctx).ok).toBe(true);
    expect(save.maps[0]!.food).toBe(25);
    expect(save.maps[0]!.wood).toBe(92);
    const farmTuple = save.maps[0]!.items.find((it) => it[0] === 8)!;
    expect(farmTuple[6]).toEqual([500]);
  });

  it("Phase 7: neighbor_assist awards +10 Gold and +3 XP without activating tutorial", () => {
    const save = makeSave({ coins: 100, xp: 30 });
    const ctx: CommandExecutionContext = {
      itemsById: new Map(),
      levels: LEVELS_SAMPLE,
      expansionPrices: [],
      globals: {},
      nowSec: 1000
    };
    const res = applyCommand(save, { cmd: "neighbor_assist", args: ["king_arthur"] }, ctx);
    expect(res.ok).toBe(true);
    expect(save.maps[0]!.coins).toBe(110);
    expect(save.maps[0]!.xp).toBe(33);
    expect(save.playerInfo.completed_tutorial).toBe(1);
  });
});
