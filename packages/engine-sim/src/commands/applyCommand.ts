import {
  tileToExpansionId,
  type CommandPayload,
  type CostType,
  type GameItem,
  type MapState,
  type RawMapItemTuple,
  type SaveFile
} from "@sef/shared-types";
import {
  ACTIVATE_NEST_CASH,
  ACTIVATE_NEST_GOLD,
  BUILDING_BLACKSMITH_IDS,
  BUILDING_UNIVERSITY_IDS,
  COLLECT_MULTIPLIERS,
  COLLECT_VARIABLE_IDS,
  DRAGON_NEST_HAS_EGG,
  DRAGON_NEST_IDS,
  DRAGON_STEP_CASH_BIG,
  DRAGON_STEP_CASH_SMALL,
  GOLD_ORE_IDS,
  ID_BUILDING_REGEN_GOLD,
  ID_BUILDING_REGEN_STONE,
  MONSTER_NEST_IDS,
  MONSTER_STEP_CASH,
  NEST_STEP_COOLDOWN_SEC,
  NEST_TOTAL_STEPS,
  REGEN_ORE_DURATION_SEC,
  STONE_ORE_IDS,
  canAfford,
  computeEarlyUnlockCashCost,
  computeEffectiveItemCost,
  computeFarmReplantWoodCost,
  computeLevelFromXp,
  computeMarketPrice,
  computeProducerYield,
  computeSellRefund,
  computeTrainingFoodCost,
  creditResource,
  debitResource,
  type ResourceBag
} from "../economy/formulas.js";

export interface LevelTableEntry {
  level?: number | string;
  name?: string;
  exp_required?: number | string;
  reward_type?: string;
  reward_amount?: number | string;
}

export interface CommandExecutionContext {
  itemsById: ReadonlyMap<number, GameItem>;
  levels: readonly LevelTableEntry[];
  expansionPrices: readonly { coins?: number | string; cash?: number | string; level?: number | string }[];
  globals: Readonly<Record<string, unknown>>;
  nowSec: number;
  adminMode?: boolean;
}

export interface CommandResult {
  ok: boolean;
  error?: string;
  events: CommandSideEvent[];
}

export type CommandSideEvent =
  | { type: "resource_delta"; coins?: number; wood?: number; stone?: number; food?: number; cash?: number; xp?: number; mana?: number }
  | {
      type: "level_up";
      level: number;
      rankName: string;
      rewardType: CostType;
      rewardAmount: number;
      manaBonus: number;
    }
  | { type: "item_placed"; itemId: number; tx: number; ty: number }
  | { type: "item_removed"; itemId: number; tx: number; ty: number }
  | { type: "sfx"; name: string };

const NON_GRAVEYARD_UNIT_IDS = new Set([500, 501]); // Peasants
const NON_GRAVEYARD_SUBCATS = new Set([76, 77, 78, 79]); // Cow, sheep, horse, boar
const HERO_UNIT_IDS = new Set([533, 534, 535, 550, 554, 555, 556, 557]);
const SUBCAT_FARM = 122;

function getBag(save: SaveFile, map: MapState): ResourceBag {
  const priv = save.privateState;
  return {
    coins: map.coins,
    wood: map.wood,
    stone: map.stone,
    food: map.food,
    cash: save.playerInfo.cash ?? 0,
    mana: Number(priv.mana ?? 0)
  };
}

function commitBag(save: SaveFile, map: MapState, bag: ResourceBag): void {
  map.coins = bag.coins;
  map.wood = bag.wood;
  map.stone = bag.stone;
  map.food = bag.food;
  save.playerInfo.cash = bag.cash;
  save.privateState.mana = bag.mana;
}

function parseCostType(raw: unknown): CostType {
  if (raw === "g" || raw === "w" || raw === "s" || raw === "f" || raw === "c") return raw;
  return "c";
}

function isItemUnlockedForPlayer(save: SaveFile, map: MapState, def: GameItem, adminMode?: boolean): boolean {
  if (adminMode) return true;
  if (map.level >= def.minLevel) return true;
  const early = save.privateState.unlockedEarlyBuildings;
  if (Array.isArray(early) && early.map(Number).includes(def.id)) return true;
  return false;
}

function addXp(save: SaveFile, map: MapState, amount: number, ctx: CommandExecutionContext, events: CommandSideEvent[]): void {
  if (amount <= 0) return;
  const prevLevel = map.level;
  map.xp += amount;
  const nextLevel = computeLevelFromXp(map.xp, ctx.levels);
  if (nextLevel > prevLevel) {
    map.level = nextLevel;
    const bag = getBag(save, map);
    const startLvl = Number(ctx.globals.START_LEVEL_MANA_REWARD ?? 36);
    const manaPerLvl = Number(ctx.globals.MANA_REWARD_PER_LEVEL ?? 2);

    for (let lvl = prevLevel + 1; lvl <= nextLevel; lvl++) {
      const entry = ctx.levels[lvl - 1];
      const rankName = String(entry?.name ?? `Level ${lvl}`);
      const rewardType = entry?.reward_type ? parseCostType(entry.reward_type) : "c";
      const rewardAmount = entry?.reward_amount !== undefined ? Math.max(0, Number(entry.reward_amount) || 0) : 1;
      const manaBonus = lvl >= startLvl ? manaPerLvl : 0;

      if (rewardAmount > 0) {
        creditResource(bag, rewardType, rewardAmount);
      }
      if (manaBonus > 0) {
        bag.mana += manaBonus;
      }

      events.push({
        type: "level_up",
        level: lvl,
        rankName,
        rewardType,
        rewardAmount,
        manaBonus
      });
    }

    commitBag(save, map, bag);
    events.push({ type: "sfx", name: "LevelUpSound" });
  }
}

function findItemIndex(map: MapState, tx: number, ty: number, itemId?: number): number {
  return map.items.findIndex(
    (it) => it[1] === tx && it[2] === ty && (itemId === undefined || it[0] === itemId)
  );
}

function hasAnyBuilding(map: MapState, ids: Set<number>): boolean {
  return map.items.some((it) => ids.has(it[0]));
}

function toInt(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function getStringNumMap(obj: Record<string, unknown>, key: string): Record<string, number> {
  const cur = obj[key];
  if (cur && typeof cur === "object" && !Array.isArray(cur)) {
    return cur as Record<string, number>;
  }
  const fresh: Record<string, number> = {};
  obj[key] = fresh;
  return fresh;
}

/**
 * Pure deterministic command processor implementing the Social Empires 1.4.07
 * command protocol (`op.py` + PR #48 & PR #40 verified fixes).
 * Shared identically by `apps/server` (authoritative SQLite) and `apps/web` (optimistic client).
 */
export function applyCommand(
  save: SaveFile,
  payload: CommandPayload,
  ctx: CommandExecutionContext
): CommandResult {
  const map = save.maps[save.playerInfo.default_map ?? 0] ?? save.maps[0];
  if (!map) return { ok: false, error: "No active map in save", events: [] };

  const events: CommandSideEvent[] = [];
  const bag = getBag(save, map);
  const { cmd, args } = payload;

  switch (cmd) {
    case "nop":
    case "ping":
    case "game_status":
    case "set_info_showed":
    case "set_help_map":
    case "set_variables":
    case "set_quest_var":
    case "start_quest_new":
      return { ok: true, events };

    case "buy": {
      // args: [itemId, tx, ty, orientation?, payWithCash?]
      const itemId = toInt(args[0]);
      const tx = toInt(args[1]);
      const ty = toInt(args[2]);
      const orientation = toInt(args[3], 0);
      const def = ctx.itemsById.get(itemId);
      if (!def) return { ok: false, error: `Unknown item ${itemId}`, events };

      const expId = tileToExpansionId(tx, ty);
      if (expId > 0 && !map.expansions.includes(expId)) {
        return { ok: false, error: `Tile (${tx},${ty}) is outside owned territory`, events };
      }

      const isInternalRegen = itemId === ID_BUILDING_REGEN_GOLD || itemId === ID_BUILDING_REGEN_STONE;
      if (!ctx.adminMode && !isInternalRegen) {
        if (!def.inStore) {
          return { ok: false, error: `Item ${itemId} is not available in the store`, events };
        }
        if (!isItemUnlockedForPlayer(save, map, def, false)) {
          return { ok: false, error: `Level ${def.minLevel} required for ${def.name}`, events };
        }
      }

      const cost = isInternalRegen
        ? 0
        : computeEffectiveItemCost(def, {
            hasBlacksmith: hasAnyBuilding(map, BUILDING_BLACKSMITH_IDS),
            hasUniversity: hasAnyBuilding(map, BUILDING_UNIVERSITY_IDS)
          });
      const foodCost = isInternalRegen
        ? 0
        : computeTrainingFoodCost(def, Number(ctx.globals.FOOD_PER_GOLD_INTRAINING ?? 0.25));

      if (!ctx.adminMode) {
        if (!canAfford(bag, def.costType, cost) || bag.food < foodCost) {
          return { ok: false, error: "Insufficient resources", events };
        }
        debitResource(bag, def.costType, cost);
        bag.food -= foodCost;
      } else {
        // Admin mode: allow placing freely even if current balance is below item cost
        if (canAfford(bag, def.costType, cost)) debitResource(bag, def.costType, cost);
        if (bag.food >= foodCost) bag.food -= foodCost;
      }

      const tuple: RawMapItemTuple = [itemId, tx, ty, orientation, ctx.nowSec, 0, [], {}];
      map.items.push(tuple);
      commitBag(save, map, bag);
      if (!isInternalRegen) {
        addXp(save, map, def.xp, ctx, events);
      }
      events.push(
        { type: "item_placed", itemId, tx, ty },
        { type: "sfx", name: def.type === "b" ? "BuildSound" : "FinalConstruc1Sound" }
      );
      return { ok: true, events };
    }

    case "buy_cash": {
      // PR #48 fix: accept any item with costUnitCash > 0 (not just the 8 heroes)
      const itemId = toInt(args[0]);
      const tx = toInt(args[1]);
      const ty = toInt(args[2]);
      const orientation = toInt(args[3], 0);
      const def = ctx.itemsById.get(itemId);
      if (!def || def.costUnitCash <= 0) {
        return { ok: false, error: `Item ${itemId} cannot be bought with cash`, events };
      }
      if (!ctx.adminMode && !debitResource(bag, "c", def.costUnitCash)) {
        return { ok: false, error: "Insufficient cash", events };
      }
      if (ctx.adminMode && canAfford(bag, "c", def.costUnitCash)) {
        debitResource(bag, "c", def.costUnitCash);
      }
      map.items.push([itemId, tx, ty, orientation, ctx.nowSec, 0, [], {}]);
      commitBag(save, map, bag);
      addXp(save, map, def.xp, ctx, events);
      events.push({ type: "item_placed", itemId, tx, ty }, { type: "sfx", name: "BuildSound" });
      return { ok: true, events };
    }

    case "move": {
      // args: [fromTx, fromTy, itemId, toTx, toTy, orientation?]
      const fromTx = toInt(args[0]);
      const fromTy = toInt(args[1]);
      const itemId = toInt(args[2]);
      const toTx = toInt(args[3]);
      const toTy = toInt(args[4]);
      const idx = findItemIndex(map, fromTx, fromTy, itemId);
      if (idx < 0) return { ok: false, error: `Item ${itemId} not found at (${fromTx},${fromTy})`, events };
      const item = map.items[idx]!;
      item[1] = toTx;
      item[2] = toTy;
      if (args[5] !== undefined) item[3] = toInt(args[5], item[3]);
      events.push({ type: "sfx", name: "ButtonClickSound" });
      return { ok: true, events };
    }

    case "orient": {
      const tx = toInt(args[0]);
      const ty = toInt(args[1]);
      const orientation = toInt(args[2], 0);
      const itemId = args[3] !== undefined ? toInt(args[3]) : undefined;
      const idx = findItemIndex(map, tx, ty, itemId);
      if (idx < 0) return { ok: false, error: `Item not found at (${tx},${ty})`, events };
      map.items[idx]![3] = orientation;
      events.push({ type: "sfx", name: "ButtonClickSound" });
      return { ok: true, events };
    }

    case "sell":
    case "pop_sell":
    case "kill": {
      // args: [tx, ty, itemId, reason?, ..., checkPutToGraveyard?]
      const tx = toInt(args[0]);
      const ty = toInt(args[1]);
      const itemId = toInt(args[2]);
      const reason = String(args[3] ?? (cmd === "kill" ? "KILL" : "SELL")).toUpperCase();
      const idx = findItemIndex(map, tx, ty, itemId);
      if (idx < 0) return { ok: false, error: `Item ${itemId} not found at (${tx},${ty})`, events };
      map.items.splice(idx, 1);

      const def = ctx.itemsById.get(itemId);
      if (def) {
        if (reason === "HARVEST") {
          // Canonical `Constants.SELL_REASON_HARVEST` (`IsoElement.as:880-882`): depleted resource disappears with 0 sell refund
        } else if (reason === "KILL" || cmd === "kill") {
          // PR #48 fix: honor checkPutToGraveyard flag; exclude peasants, animals, trolls
          const allowGrave = args[6] !== undefined ? Boolean(Number(args[6])) : true;
          if (HERO_UNIT_IDS.has(itemId)) {
            const deadHeroes = getStringNumMap(save.privateState, "deadHeroes");
            deadHeroes[String(itemId)] = 1;
          } else if (
            allowGrave &&
            def.type === "u" &&
            !NON_GRAVEYARD_UNIT_IDS.has(itemId) &&
            !NON_GRAVEYARD_SUBCATS.has(def.subcatFunctional) &&
            def.race !== "t"
          ) {
            const graveyard = getStringNumMap(save.privateState, "graveyard");
            graveyard[String(itemId)] = Math.min(100, (graveyard[String(itemId)] ?? 0) + 1);
          }
        } else {
          const refund = computeSellRefund(def);
          creditResource(bag, refund.costType, refund.amount);
          commitBag(save, map, bag);
        }
      }
      events.push({ type: "item_removed", itemId, tx, ty });
      if (reason !== "HARVEST") {
        events.push({ type: "sfx", name: "Collection2Sound" });
      }
      return { ok: true, events };
    }

    case "upgrade": {
      const tx = toInt(args[0]);
      const ty = toInt(args[1]);
      const itemId = toInt(args[2]);
      const idx = findItemIndex(map, tx, ty, itemId);
      if (idx < 0) return { ok: false, error: `Item ${itemId} not found at (${tx},${ty})`, events };
      const curDef = ctx.itemsById.get(itemId);
      if (!curDef || curDef.upgradesTo <= 0) {
        return { ok: false, error: `Item ${itemId} cannot be upgraded`, events };
      }
      const nextDef = ctx.itemsById.get(curDef.upgradesTo);
      if (!nextDef) return { ok: false, error: `Upgrade target ${curDef.upgradesTo} missing`, events };
      if (!ctx.adminMode && !debitResource(bag, nextDef.costType, nextDef.cost)) {
        return { ok: false, error: "Insufficient resources for upgrade", events };
      }
      if (ctx.adminMode && canAfford(bag, nextDef.costType, nextDef.cost)) {
        debitResource(bag, nextDef.costType, nextDef.cost);
      }
      map.items[idx]![0] = nextDef.id;
      map.items[idx]![4] = ctx.nowSec;
      commitBag(save, map, bag);
      addXp(save, map, nextDef.xp, ctx, events);
      events.push({ type: "sfx", name: "FinalConstruc1Sound" });
      return { ok: true, events };
    }

    case "collect_new": {
      // args: [tx, ty, itemId, multiplierIdx?, spawnTx?, spawnTy?]
      const tx = toInt(args[0]);
      const ty = toInt(args[1]);
      const itemId = toInt(args[2]);
      const multIdxArg = toInt(args[3], 2);
      const idx = findItemIndex(map, tx, ty, itemId);
      if (idx < 0) return { ok: false, error: `Collectable ${itemId} not found at (${tx},${ty})`, events };

      const def = ctx.itemsById.get(itemId);
      if (!def) return { ok: false, error: `Unknown item ${itemId}`, events };

      const tuple = map.items[idx]!;
      const garrison = tuple[6];
      const attrs = tuple[7];

      // PR #48 fix: harvesting trees/stones/gold rocks yields fixed client amount (no +20% villager inflation)
      const isResourceNode =
        def.subcatFunctional === 2 ||
        def.subcatFunctional === 3 ||
        def.subcatFunctional === 4 ||
        def.subcatFunctional === 125 ||
        def.subcatFunctional === 126 ||
        def.subcatFunctional === 127;

      const isFarm = def.subcatFunctional === SUBCAT_FARM;
      const isVariableProducer = COLLECT_VARIABLE_IDS.has(itemId);

      let amount: number;
      if (isResourceNode) {
        amount = Math.round(def.collect);
      } else if (isVariableProducer) {
        const cpIdx = Math.max(1, Math.min(4, Number(attrs.cp ?? multIdxArg) || 2));
        amount = computeProducerYield(def.collect, Math.max(1, garrison.length), cpIdx);
        attrs.cp = 0;
      } else if (isFarm) {
        amount = Math.round(def.collect);
        const replantWood = computeFarmReplantWoodCost(def.collect);
        if (garrison.length > 0) {
          if (bag.wood >= replantWood) {
            bag.wood -= replantWood;
          } else {
            // Canonical `IsoElement.as:1730-1750`: insufficient wood to replant ejects the farmer
            const ejectedId = garrison.shift()!;
            const spawnTx = args[4] !== undefined ? toInt(args[4], tx + 1) : tx + 1;
            const spawnTy = args[5] !== undefined ? toInt(args[5], ty + 1) : ty + 1;
            map.items.push([ejectedId, spawnTx, spawnTy, 4, ctx.nowSec, 0, [], {}]);
            events.push({ type: "item_placed", itemId: ejectedId, tx: spawnTx, ty: spawnTy });
          }
        }
      } else {
        const multIdx = Math.max(0, Math.min(COLLECT_MULTIPLIERS.length - 1, multIdxArg));
        const mult = COLLECT_MULTIPLIERS[multIdx] ?? 1.0;
        amount = Math.round(def.collect * mult);
      }

      const resType = def.collectType || "g";
      creditResource(bag, resType, amount);
      tuple[4] = ctx.nowSec;
      commitBag(save, map, bag);
      addXp(save, map, def.collectXp, ctx, events);
      events.push({ type: "sfx", name: "Collection2Sound" });
      return { ok: true, events };
    }

    case "store_item":
    case "store_item_frombug": {
      // PR #48 fix: remove ONLY ONE matching item at (tx, ty), preserving stacked items
      const tx = toInt(args[0]);
      const ty = toInt(args[1]);
      const itemId = toInt(args[2]);
      const idx = findItemIndex(map, tx, ty, itemId);
      if (idx < 0) return { ok: false, error: `Item ${itemId} not found at (${tx},${ty})`, events };
      map.items.splice(idx, 1);
      const key = String(itemId);
      map.store[key] = (map.store[key] ?? 0) + 1;
      events.push({ type: "item_removed", itemId, tx, ty }, { type: "sfx", name: "ButtonClickSound" });
      return { ok: true, events };
    }

    case "place_stored_item": {
      const itemId = toInt(args[0]);
      const tx = toInt(args[1]);
      const ty = toInt(args[2]);
      const orientation = toInt(args[3], 0);
      const key = String(itemId);
      const count = map.store[key] ?? 0;
      if (count <= 0) return { ok: false, error: `Item ${itemId} not in storage`, events };
      if (count === 1) delete map.store[key];
      else map.store[key] = count - 1;
      map.items.push([itemId, tx, ty, orientation, ctx.nowSec, 0, [], {}]);
      events.push({ type: "item_placed", itemId, tx, ty }, { type: "sfx", name: "BuildSound" });
      return { ok: true, events };
    }

    case "sell_stored_item": {
      const itemId = toInt(args[0]);
      const key = String(itemId);
      const count = map.store[key] ?? 0;
      if (count <= 0) return { ok: false, error: `Item ${itemId} not in storage`, events };
      if (count === 1) delete map.store[key];
      else map.store[key] = count - 1;
      const def = ctx.itemsById.get(itemId);
      if (def) {
        const refund = computeSellRefund(def);
        creditResource(bag, refund.costType, refund.amount);
        commitBag(save, map, bag);
      }
      events.push({ type: "sfx", name: "Collection2Sound" });
      return { ok: true, events };
    }

    case "expand": {
      // args: [expansionId, payWithCash?]
      const expId = toInt(args[0]);
      const withCash = Boolean(Number(args[1] ?? 0));
      if (expId < 1 || expId > 25) return { ok: false, error: `Invalid expansion ${expId}`, events };
      if (map.expansions.includes(expId)) return { ok: true, events };

      const ownedCount = Math.max(0, map.expansions.length - 1);
      const priceEntry = ctx.expansionPrices[Math.min(ownedCount, ctx.expansionPrices.length - 1)];
      const goldCost = Number(priceEntry?.coins ?? 5000);
      const cashCost = Number(priceEntry?.cash ?? 10);

      if (withCash) {
        if (!debitResource(bag, "c", cashCost)) return { ok: false, error: "Insufficient cash", events };
      } else {
        if (!debitResource(bag, "g", goldCost)) return { ok: false, error: "Insufficient gold", events };
      }
      map.expansions.push(expId);
      commitBag(save, map, bag);
      addXp(save, map, 50, ctx, events);
      events.push({ type: "sfx", name: "NewTownSound" });
      return { ok: true, events };
    }

    case "market_trade_resource":
    case "trade_resource_b": {
      // args: [resource ('w'|'s'|'f'), action ('buy'|'sell'), units (multiple of 100)]
      const res = String(args[0]) as "w" | "s" | "f";
      const action = String(args[1]) === "sell" ? "sell" : "buy";
      const amount = Math.max(100, toInt(args[2], 100));
      if (res !== "w" && res !== "s" && res !== "f") {
        return { ok: false, error: `Invalid trade resource ${res}`, events };
      }
      const steps = map.resourcesTraded[res] ?? 0;
      const unitPrice = computeMarketPrice(res, steps, action);
      const totalGold = Math.round((unitPrice * amount) / 100);

      if (action === "buy") {
        if (!debitResource(bag, "g", totalGold)) return { ok: false, error: "Insufficient gold", events };
        creditResource(bag, res, amount);
        map.resourcesTraded[res] = steps + Math.round(amount / 100);
      } else {
        // PR #48 fix: remove `amount` of resource (not `sell_cost`) and credit gold
        if (!debitResource(bag, res, amount)) return { ok: false, error: "Insufficient resource", events };
        creditResource(bag, "g", totalGold);
        map.resourcesTraded[res] = steps - Math.round(amount / 100);
      }
      commitBag(save, map, bag);
      events.push({ type: "sfx", name: "Collection2Sound" });
      return { ok: true, events };
    }

    case "exchange_cash": {
      const cashCost = Number(ctx.globals.EXCHANGE_CASH ?? 5);
      const goldGain = Number(ctx.globals.EXCHANGE_GOLD ?? 2500);
      if (!debitResource(bag, "c", cashCost)) return { ok: false, error: "Insufficient cash", events };
      creditResource(bag, "g", goldGain);
      commitBag(save, map, bag);
      events.push({ type: "sfx", name: "Collection2Sound" });
      return { ok: true, events };
    }

    case "push_queue_unit": {
      // args: [tx, ty, buildingId, unitId]
      const tx = toInt(args[0]);
      const ty = toInt(args[1]);
      const bId = toInt(args[2]);
      const unitId = toInt(args[3]);
      const idx = findItemIndex(map, tx, ty, bId);
      if (idx < 0) return { ok: false, error: "Training building not found", events };
      const unitDef = ctx.itemsById.get(unitId);
      if (!unitDef) return { ok: false, error: `Unknown unit ${unitId}`, events };

      if (!isItemUnlockedForPlayer(save, map, unitDef, ctx.adminMode)) {
        return { ok: false, error: `Level ${unitDef.minLevel} required to train ${unitDef.name}`, events };
      }

      const cost = computeEffectiveItemCost(unitDef, {
        hasBlacksmith: hasAnyBuilding(map, BUILDING_BLACKSMITH_IDS),
        hasUniversity: hasAnyBuilding(map, BUILDING_UNIVERSITY_IDS)
      });
      const foodCost = computeTrainingFoodCost(unitDef, Number(ctx.globals.FOOD_PER_GOLD_INTRAINING ?? 0.25));
      if (!ctx.adminMode) {
        if (!canAfford(bag, unitDef.costType, cost) || bag.food < foodCost) {
          return { ok: false, error: "Insufficient resources for training", events };
        }
        debitResource(bag, unitDef.costType, cost);
        bag.food -= foodCost;
      } else {
        if (canAfford(bag, unitDef.costType, cost)) debitResource(bag, unitDef.costType, cost);
        if (bag.food >= foodCost) bag.food -= foodCost;
      }
      commitBag(save, map, bag);

      const building = map.items[idx]!;
      const attrs = building[7];
      const queue = Array.isArray(attrs.queue) ? (attrs.queue as number[]) : [];
      queue.push(unitId);
      attrs.queue = queue;
      if (!attrs.queueStart) attrs.queueStart = ctx.nowSec;
      events.push({ type: "sfx", name: "ButtonClickSound" });
      return { ok: true, events };
    }

    case "pop_queue_unit": {
      // args: [tx, ty, buildingId, spawnTx, spawnTy]
      const tx = toInt(args[0]);
      const ty = toInt(args[1]);
      const bId = toInt(args[2]);
      const spawnTx = toInt(args[3], tx + 1);
      const spawnTy = toInt(args[4], ty + 1);
      const idx = findItemIndex(map, tx, ty, bId);
      if (idx < 0) return { ok: false, error: "Training building not found", events };
      const attrs = map.items[idx]![7];
      const queue = Array.isArray(attrs.queue) ? (attrs.queue as number[]) : [];
      const unitId = queue.shift();
      if (unitId === undefined) return { ok: false, error: "Queue empty", events };
      attrs.queue = queue;
      attrs.queueStart = queue.length > 0 ? ctx.nowSec : 0;

      map.items.push([unitId, spawnTx, spawnTy, 4, ctx.nowSec, 0, [], {}]);
      const unitDef = ctx.itemsById.get(unitId);
      if (unitDef) addXp(save, map, unitDef.xp, ctx, events);
      events.push({ type: "item_placed", itemId: unitId, tx: spawnTx, ty: spawnTy }, { type: "sfx", name: "FinalConstruc1Sound" });
      return { ok: true, events };
    }

    case "unqueue_unit": {
      const tx = toInt(args[0]);
      const ty = toInt(args[1]);
      const bId = toInt(args[2]);
      const queueIndex = toInt(args[3], 0);
      const idx = findItemIndex(map, tx, ty, bId);
      if (idx < 0) return { ok: false, error: "Training building not found", events };
      const attrs = map.items[idx]![7];
      const queue = Array.isArray(attrs.queue) ? (attrs.queue as number[]) : [];
      if (queueIndex < 0 || queueIndex >= queue.length) return { ok: false, error: "Invalid queue index", events };
      const [unitId] = queue.splice(queueIndex, 1);
      attrs.queue = queue;
      if (unitId !== undefined) {
        const unitDef = ctx.itemsById.get(unitId);
        if (unitDef) {
          creditResource(bag, unitDef.costType, unitDef.cost);
          commitBag(save, map, bag);
        }
      }
      return { ok: true, events };
    }

    case "speed_up_queue": {
      const tx = toInt(args[0]);
      const ty = toInt(args[1]);
      const bId = toInt(args[2]);
      const cashCost = Math.max(1, toInt(args[3], 1));
      const idx = findItemIndex(map, tx, ty, bId);
      if (idx < 0) return { ok: false, error: "Training building not found", events };
      if (!debitResource(bag, "c", cashCost)) return { ok: false, error: "Insufficient cash", events };
      commitBag(save, map, bag);
      map.items[idx]![7].queueStart = 0;
      return { ok: true, events };
    }

    case "push_unit": {
      // args: [bTx, bTy, bId, unitId, unitTx?, unitTy?]
      const tx = toInt(args[0]);
      const ty = toInt(args[1]);
      const bId = toInt(args[2]);
      const unitId = toInt(args[3]);
      const bIdx = findItemIndex(map, tx, ty, bId);
      if (bIdx < 0) return { ok: false, error: "Garrison building not found", events };
      const bDef = ctx.itemsById.get(bId);
      const building = map.items[bIdx]!;
      const cap = bDef && bDef.unitCapacity > 0 ? bDef.unitCapacity : 6;
      if (building[6].length >= cap) {
        return { ok: false, error: "Building capacity reached", events };
      }

      // If villager map coordinates are supplied, remove the unit tuple from the map so it disappears inside
      if (args[4] !== undefined && args[5] !== undefined) {
        const uTx = toInt(args[4]);
        const uTy = toInt(args[5]);
        let uIdx = findItemIndex(map, uTx, uTy, unitId);
        if (uIdx < 0) {
          // Fallback: nearest matching unitId in map (villager may have walked away from its initial saved tile)
          uIdx = map.items.findIndex((it) => it[0] === unitId);
        }
        if (uIdx >= 0) {
          const removed = map.items[uIdx]!;
          map.items.splice(uIdx, 1);
          events.push({ type: "item_removed", itemId: unitId, tx: removed[1], ty: removed[2] });
        }
      }

      building[6].push(unitId);
      if (bDef && bDef.subcatFunctional === SUBCAT_FARM) {
        // Start canonical ~30s farm sowing cycle when farmer enters
        building[4] = ctx.nowSec;
        events.push({ type: "sfx", name: "FarmSound" });
      }
      return { ok: true, events };
    }

    case "pop_unit": {
      // args: [bTx, bTy, bId, unitId, spawnTx?, spawnTy?]
      const tx = toInt(args[0]);
      const ty = toInt(args[1]);
      const bId = toInt(args[2]);
      const unitId = toInt(args[3]);
      const idx = findItemIndex(map, tx, ty, bId);
      if (idx < 0) return { ok: false, error: "Garrison building not found", events };
      const building = map.items[idx]!;
      const list = building[6];
      const uIdx = unitId > 0 ? list.indexOf(unitId) : list.length > 0 ? 0 : -1;
      if (uIdx < 0) return { ok: false, error: "Unit not garrisoned", events };
      const poppedId = list.splice(uIdx, 1)[0]!;
      if (list.length === 0) {
        building[7].cp = 0;
      }
      if (args[4] !== undefined && args[5] !== undefined) {
        const spawnTx = toInt(args[4], tx + 1);
        const spawnTy = toInt(args[5], ty + 1);
        map.items.push([poppedId, spawnTx, spawnTy, 4, ctx.nowSec, 0, [], {}]);
        events.push({ type: "item_placed", itemId: poppedId, tx: spawnTx, ty: spawnTy });
      }
      return { ok: true, events };
    }

    case "activate": {
      // Canonical `PopupCollect.as` (`CMD_ACTIVATE`): args [tx, ty, itemId, cpIndex (1..4)]
      const tx = toInt(args[0]);
      const ty = toInt(args[1]);
      const itemId = toInt(args[2]);
      const cpIndex = Math.max(1, Math.min(4, toInt(args[3], 1)));
      const idx = findItemIndex(map, tx, ty, itemId);
      if (idx < 0) return { ok: false, error: `Building ${itemId} not found at (${tx},${ty})`, events };
      const building = map.items[idx]!;
      building[7].cp = cpIndex;
      building[4] = ctx.nowSec;
      events.push({ type: "sfx", name: "ButtonClickSound" });
      return { ok: true, events };
    }

    case "add_warehoused_item": {
      const tx = toInt(args[0]);
      const ty = toInt(args[1]);
      const itemId = toInt(args[2]);
      const idx = findItemIndex(map, tx, ty, itemId);
      if (idx < 0) return { ok: false, error: "Unit not found", events };
      map.items.splice(idx, 1);
      map.warehousedUnits.push(itemId);
      events.push({ type: "item_removed", itemId, tx, ty });
      return { ok: true, events };
    }

    case "place_warehoused_item": {
      const itemId = toInt(args[0]);
      const tx = toInt(args[1]);
      const ty = toInt(args[2]);
      const uIdx = map.warehousedUnits.indexOf(itemId);
      if (uIdx < 0) return { ok: false, error: "Unit not in warehouse", events };
      map.warehousedUnits.splice(uIdx, 1);
      map.items.push([itemId, tx, ty, 4, ctx.nowSec, 0, [], {}]);
      events.push({ type: "item_placed", itemId, tx, ty });
      return { ok: true, events };
    }

    case "name_map": {
      const name = String(args[0] ?? "").trim();
      if (name) {
        save.playerInfo.name = name;
        save.playerInfo.map_names[0] = name;
      }
      return { ok: true, events };
    }

    case "unlock_skin": {
      const skinId = toInt(args[0]);
      const cost = Number(ctx.globals.COST_UNLOCK_SKIN ?? 20);
      const unlocked = getStringNumMap(save.privateState, "unlockedSkins");
      if (!unlocked[String(skinId)]) {
        if (!debitResource(bag, "c", cost)) return { ok: false, error: "Insufficient cash", events };
        unlocked[String(skinId)] = 1;
        commitBag(save, map, bag);
      }
      return { ok: true, events };
    }

    case "set_skin": {
      map.skin = Math.max(0, Math.min(7, toInt(args[0], 0)));
      return { ok: true, events };
    }

    case "buy_mana": {
      const withCash = Boolean(Number(args[0] ?? 0));
      const gain = Number(ctx.globals.MANA_PER_PURCHASE ?? 5);
      if (withCash) {
        if (!debitResource(bag, "c", Number(ctx.globals.COST_MANA_CASH ?? 1))) {
          return { ok: false, error: "Insufficient cash", events };
        }
      } else {
        if (!debitResource(bag, "g", Number(ctx.globals.COST_MANA_GOLD ?? 20000))) {
          return { ok: false, error: "Insufficient gold", events };
        }
      }
      bag.mana += gain;
      commitBag(save, map, bag);
      events.push({ type: "sfx", name: "Collection2Sound" });
      return { ok: true, events };
    }

    case "buy_magic": {
      const magicId = toInt(args[0]);
      const cost = toInt(args[1], 0);
      const costType = (String(args[2] ?? "g") as "g" | "c") || "g";
      if (cost > 0 && !debitResource(bag, costType, cost)) {
        return { ok: false, error: "Insufficient resources for magic", events };
      }
      const magics = getStringNumMap(save.privateState, "magics");
      magics[String(magicId)] = (magics[String(magicId)] ?? 0);
      commitBag(save, map, bag);
      return { ok: true, events };
    }

    case "use_magic": {
      const magicId = toInt(args[0]);
      const manaCost = Math.max(0, toInt(args[1], 0));
      if (bag.mana < manaCost) return { ok: false, error: "Insufficient mana", events };
      bag.mana -= manaCost;
      const magics = getStringNumMap(save.privateState, "magics");
      magics[String(magicId)] = (magics[String(magicId)] ?? 0) + 1;
      commitBag(save, map, bag);
      events.push({ type: "sfx", name: "FireballSound" });
      return { ok: true, events };
    }

    case "resurrect_hero": {
      // PR #48 fix: potion flag is "0"/"1" string where "0" must be falsy
      const unitId = toInt(args[0]);
      const tx = toInt(args[1], 50);
      const ty = toInt(args[2], 50);
      const usePotion = String(args[3] ?? "0") === "1";
      const goldCost = Math.max(0, toInt(args[4], Number(ctx.globals.RESURRECT_COST_MULT ?? 500)));

      if (usePotion) {
        const potions = Number(save.privateState.potion ?? 0);
        if (potions <= 0) return { ok: false, error: "No resurrection potions", events };
        save.privateState.potion = potions - 1;
      } else if (!debitResource(bag, "g", goldCost)) {
        return { ok: false, error: "Insufficient gold", events };
      }

      const deadHeroes = getStringNumMap(save.privateState, "deadHeroes");
      delete deadHeroes[String(unitId)];
      const graveyard = getStringNumMap(save.privateState, "graveyard");
      if ((graveyard[String(unitId)] ?? 0) > 1) graveyard[String(unitId)]!--;
      else delete graveyard[String(unitId)];

      map.items.push([unitId, tx, ty, 4, ctx.nowSec, 0, [], {}]);
      commitBag(save, map, bag);
      events.push({ type: "item_placed", itemId: unitId, tx, ty }, { type: "sfx", name: "CurarSound" });
      return { ok: true, events };
    }

    case "complete_tutorial": {
      save.playerInfo.completed_tutorial = 1;
      return { ok: true, events };
    }

    case "complete_goal":
    case "reward_goal": {
      const goalId = toInt(args[0]);
      const rewardGold = toInt(args[1], 0);
      const rewardXp = toInt(args[2], 0);
      const completed = Array.isArray(save.privateState.completedMissions)
        ? (save.privateState.completedMissions as number[])
        : [];
      if (!completed.includes(goalId)) completed.push(goalId);
      save.privateState.completedMissions = completed;
      if (cmd === "reward_goal") {
        const rewarded = Array.isArray(save.privateState.rewardedMissions)
          ? (save.privateState.rewardedMissions as number[])
          : [];
        if (!rewarded.includes(goalId)) {
          rewarded.push(goalId);
          save.privateState.rewardedMissions = rewarded;
          creditResource(bag, "g", rewardGold);
          commitBag(save, map, bag);
          addXp(save, map, rewardXp, ctx, events);
          events.push({ type: "sfx", name: "AchievementSound" });
        }
      }
      return { ok: true, events };
    }

    case "collect_treasure": {
      // PR #48 fix: allow skipping non-existent chapters without 4h timer refusal
      const rewardGold = toInt(args[0], 0);
      if (rewardGold > 0) {
        creditResource(bag, "g", rewardGold);
        map.timestampLastTreasure = ctx.nowSec;
        commitBag(save, map, bag);
        events.push({ type: "sfx", name: "Collection2Sound" });
      }
      map.idCurrentTreasure += 1;
      return { ok: true, events };
    }

    case "win_bonus": {
      const rewardGold = toInt(args[0], 500);
      const rewardCash = toInt(args[1], 0);
      creditResource(bag, "g", rewardGold);
      creditResource(bag, "c", rewardCash);
      save.privateState.timestampLastBonus = ctx.nowSec;
      save.privateState.bonusNextId = (Number(save.privateState.bonusNextId ?? 0) + 1) % 7;
      commitBag(save, map, bag);
      events.push({ type: "sfx", name: "AchievementSound" });
      return { ok: true, events };
    }

    case "gold_statue_conversion": {
      const gold = toInt(args[0], 0);
      creditResource(bag, "g", gold);
      commitBag(save, map, bag);
      events.push({ type: "sfx", name: "Collection2Sound" });
      return { ok: true, events };
    }

    case "unlock_building": {
      const buildingId = toInt(args[0]);
      const def = ctx.itemsById.get(buildingId);
      const canonicalCost = def ? computeEarlyUnlockCashCost(def.minLevel) : 1;
      const cashCost = args[1] !== undefined ? Math.max(0, toInt(args[1], canonicalCost)) : canonicalCost;
      if (!ctx.adminMode && cashCost > 0 && !debitResource(bag, "c", cashCost)) {
        return { ok: false, error: "Insufficient cash", events };
      }
      if (ctx.adminMode && cashCost > 0 && canAfford(bag, "c", cashCost)) {
        debitResource(bag, "c", cashCost);
      }
      const list = Array.isArray(save.privateState.unlockedEarlyBuildings)
        ? (save.privateState.unlockedEarlyBuildings as number[])
        : [];
      if (!list.includes(buildingId)) list.push(buildingId);
      save.privateState.unlockedEarlyBuildings = list;
      commitBag(save, map, bag);
      events.push({ type: "sfx", name: "AchievementSound" });
      return { ok: true, events };
    }

    case "spawn_regen_node": {
      // Canonical `IsoElement.as:897-924`: depleted stone/gold ore leaves regPiedras (81) or regOro (80)
      const tx = toInt(args[0]);
      const ty = toInt(args[1]);
      const regenId = toInt(args[2]);
      if (regenId !== ID_BUILDING_REGEN_GOLD && regenId !== ID_BUILDING_REGEN_STONE) {
        return { ok: false, error: `Invalid regen node ${regenId}`, events };
      }
      map.items.push([regenId, tx, ty, 0, ctx.nowSec, 0, [], {}]);
      events.push({ type: "item_placed", itemId: regenId, tx, ty });
      return { ok: true, events };
    }

    case "finish_regen": {
      // Canonical `IsoElement.as:793-826`: regen crater turns back into fresh stone/gold ore after 3h
      const tx = toInt(args[0]);
      const ty = toInt(args[1]);
      const regenId = toInt(args[2]);
      const idx = findItemIndex(map, tx, ty, regenId);
      if (idx < 0) return { ok: false, error: `Regen node ${regenId} not found at (${tx},${ty})`, events };
      const tuple = map.items[idx]!;
      const elapsed = ctx.nowSec - tuple[4];
      if (!ctx.adminMode && elapsed < REGEN_ORE_DURATION_SEC) {
        return { ok: false, error: "Resource not yet regenerated", events };
      }
      const pool = regenId === ID_BUILDING_REGEN_GOLD ? GOLD_ORE_IDS : STONE_ORE_IDS;
      const freshId = pool[Math.abs(tx * 31 + ty * 17 + ctx.nowSec) % pool.length]!;
      tuple[0] = freshId;
      tuple[4] = ctx.nowSec;
      events.push({ type: "item_placed", itemId: freshId, tx, ty });
      return { ok: true, events };
    }

    case "activate_dragon": {
      // Canonical `PopupInactiveNest.as` + `op.py`: activate Dragon Nest with 100k gold or 50 cash
      const withCash = Boolean(Number(args[0] ?? 0));
      if (!ctx.adminMode) {
        if (withCash) {
          if (!debitResource(bag, "c", ACTIVATE_NEST_CASH)) return { ok: false, error: "Insufficient cash", events };
        } else {
          if (!debitResource(bag, "g", ACTIVATE_NEST_GOLD)) return { ok: false, error: "Insufficient gold", events };
        }
      } else {
        if (withCash && canAfford(bag, "c", ACTIVATE_NEST_CASH)) debitResource(bag, "c", ACTIVATE_NEST_CASH);
        if (!withCash && canAfford(bag, "g", ACTIVATE_NEST_GOLD)) debitResource(bag, "g", ACTIVATE_NEST_GOLD);
      }
      save.privateState.dragonNestActive = 1;
      save.privateState.dragonNumber = 0;
      save.privateState.stepNumber = 0;
      save.privateState.timeStampTakeCare = 0;
      commitBag(save, map, bag);
      events.push({ type: "sfx", name: "AchievementSound" });
      return { ok: true, events };
    }

    case "next_step_dragon": {
      if (Number(save.privateState.dragonNestActive ?? 0) !== 1) {
        return { ok: false, error: "Dragon Nest is not active", events };
      }
      const step = Number(save.privateState.stepNumber ?? 0);
      if (step >= NEST_TOTAL_STEPS) {
        return { ok: false, error: "Dragon is already ready to collect", events };
      }
      const lastTs = Number(save.privateState.timeStampTakeCare ?? 0);
      if (!ctx.adminMode && lastTs > 0 && ctx.nowSec - lastTs < NEST_STEP_COOLDOWN_SEC) {
        return { ok: false, error: "Dragon care cooldown active", events };
      }
      save.privateState.stepNumber = step + 1;
      save.privateState.timeStampTakeCare = ctx.nowSec;
      addXp(save, map, 15, ctx, events);
      events.push({ type: "sfx", name: "Collection2Sound" });
      return { ok: true, events };
    }

    case "buy_step_dragon": {
      if (Number(save.privateState.dragonNestActive ?? 0) !== 1) {
        return { ok: false, error: "Dragon Nest is not active", events };
      }
      const dragonIdx = Math.max(0, Math.min(DRAGON_NEST_IDS.length - 1, Number(save.privateState.dragonNumber ?? 0)));
      const step = Number(save.privateState.stepNumber ?? 0);
      if (step >= NEST_TOTAL_STEPS) {
        return { ok: false, error: "Dragon is already ready to collect", events };
      }
      const hasEgg = DRAGON_NEST_HAS_EGG[dragonIdx] ?? true;
      const cashCost = hasEgg ? DRAGON_STEP_CASH_SMALL : DRAGON_STEP_CASH_BIG;
      if (!ctx.adminMode && !debitResource(bag, "c", cashCost)) {
        return { ok: false, error: "Insufficient cash", events };
      }
      if (ctx.adminMode && canAfford(bag, "c", cashCost)) {
        debitResource(bag, "c", cashCost);
      }
      save.privateState.stepNumber = step + 1;
      save.privateState.timeStampTakeCare = 0;
      commitBag(save, map, bag);
      addXp(save, map, 15, ctx, events);
      events.push({ type: "sfx", name: "Collection2Sound" });
      return { ok: true, events };
    }

    case "next_dragon": {
      if (Number(save.privateState.dragonNestActive ?? 0) !== 1) {
        return { ok: false, error: "Dragon Nest is not active", events };
      }
      const dragonIdx = Number(save.privateState.dragonNumber ?? 0);
      const step = Number(save.privateState.stepNumber ?? 0);
      if (!ctx.adminMode && step < NEST_TOTAL_STEPS) {
        return { ok: false, error: "Dragon training not finished yet", events };
      }
      const dragonId = DRAGON_NEST_IDS[dragonIdx];
      if (dragonId !== undefined) {
        if (args[0] !== undefined && args[1] !== undefined) {
          const tx = toInt(args[0], 50);
          const ty = toInt(args[1], 50);
          map.items.push([dragonId, tx, ty, 4, ctx.nowSec, 0, [], {}]);
          events.push({ type: "item_placed", itemId: dragonId, tx, ty });
        } else {
          map.store[String(dragonId)] = (map.store[String(dragonId)] ?? 0) + 1;
        }
        const def = ctx.itemsById.get(dragonId);
        if (def) addXp(save, map, Math.max(50, def.xp), ctx, events);
      }
      const nextIdx = dragonIdx + 1;
      if (nextIdx >= DRAGON_NEST_IDS.length) {
        save.privateState.dragonNestActive = 0;
        save.privateState.dragonNumber = 0;
      } else {
        save.privateState.dragonNumber = nextIdx;
      }
      save.privateState.stepNumber = 0;
      save.privateState.timeStampTakeCare = 0;
      events.push({ type: "sfx", name: "AchievementSound" });
      return { ok: true, events };
    }

    case "desactivate_dragon": {
      save.privateState.dragonNestActive = 0;
      save.privateState.dragonNumber = 0;
      save.privateState.stepNumber = 0;
      save.privateState.timeStampTakeCare = 0;
      return { ok: true, events };
    }

    case "activate_monster": {
      const withCash = Boolean(Number(args[0] ?? 0));
      if (!ctx.adminMode) {
        if (withCash) {
          if (!debitResource(bag, "c", ACTIVATE_NEST_CASH)) return { ok: false, error: "Insufficient cash", events };
        } else {
          if (!debitResource(bag, "g", ACTIVATE_NEST_GOLD)) return { ok: false, error: "Insufficient gold", events };
        }
      } else {
        if (withCash && canAfford(bag, "c", ACTIVATE_NEST_CASH)) debitResource(bag, "c", ACTIVATE_NEST_CASH);
        if (!withCash && canAfford(bag, "g", ACTIVATE_NEST_GOLD)) debitResource(bag, "g", ACTIVATE_NEST_GOLD);
      }
      save.privateState.monsterNestActive = 1;
      save.privateState.monsterNumber = 0;
      save.privateState.stepMonsterNumber = 0;
      save.privateState.timeStampTakeCareMonster = 0;
      commitBag(save, map, bag);
      events.push({ type: "sfx", name: "AchievementSound" });
      return { ok: true, events };
    }

    case "next_step_monster": {
      if (Number(save.privateState.monsterNestActive ?? 0) !== 1) {
        return { ok: false, error: "Monsters Nest is not active", events };
      }
      const step = Number(save.privateState.stepMonsterNumber ?? 0);
      if (step >= NEST_TOTAL_STEPS) {
        return { ok: false, error: "Monster is already ready to collect", events };
      }
      const lastTs = Number(save.privateState.timeStampTakeCareMonster ?? 0);
      if (!ctx.adminMode && lastTs > 0 && ctx.nowSec - lastTs < NEST_STEP_COOLDOWN_SEC) {
        return { ok: false, error: "Monster care cooldown active", events };
      }
      save.privateState.stepMonsterNumber = step + 1;
      save.privateState.timeStampTakeCareMonster = ctx.nowSec;
      addXp(save, map, 15, ctx, events);
      events.push({ type: "sfx", name: "Collection2Sound" });
      return { ok: true, events };
    }

    case "buy_step_monster": {
      if (Number(save.privateState.monsterNestActive ?? 0) !== 1) {
        return { ok: false, error: "Monsters Nest is not active", events };
      }
      const step = Number(save.privateState.stepMonsterNumber ?? 0);
      if (step >= NEST_TOTAL_STEPS) {
        return { ok: false, error: "Monster is already ready to collect", events };
      }
      if (!ctx.adminMode && !debitResource(bag, "c", MONSTER_STEP_CASH)) {
        return { ok: false, error: "Insufficient cash", events };
      }
      if (ctx.adminMode && canAfford(bag, "c", MONSTER_STEP_CASH)) {
        debitResource(bag, "c", MONSTER_STEP_CASH);
      }
      save.privateState.stepMonsterNumber = step + 1;
      save.privateState.timeStampTakeCareMonster = 0;
      commitBag(save, map, bag);
      addXp(save, map, 15, ctx, events);
      events.push({ type: "sfx", name: "Collection2Sound" });
      return { ok: true, events };
    }

    case "next_monster": {
      if (Number(save.privateState.monsterNestActive ?? 0) !== 1) {
        return { ok: false, error: "Monsters Nest is not active", events };
      }
      const monsterIdx = Number(save.privateState.monsterNumber ?? 0);
      const step = Number(save.privateState.stepMonsterNumber ?? 0);
      if (!ctx.adminMode && step < NEST_TOTAL_STEPS) {
        return { ok: false, error: "Monster training not finished yet", events };
      }
      const monsterId = MONSTER_NEST_IDS[monsterIdx];
      if (monsterId !== undefined) {
        if (args[0] !== undefined && args[1] !== undefined) {
          const tx = toInt(args[0], 50);
          const ty = toInt(args[1], 50);
          map.items.push([monsterId, tx, ty, 4, ctx.nowSec, 0, [], {}]);
          events.push({ type: "item_placed", itemId: monsterId, tx, ty });
        } else {
          map.store[String(monsterId)] = (map.store[String(monsterId)] ?? 0) + 1;
        }
        const def = ctx.itemsById.get(monsterId);
        if (def) addXp(save, map, Math.max(50, def.xp), ctx, events);
      }
      const nextIdx = monsterIdx + 1;
      if (nextIdx >= MONSTER_NEST_IDS.length) {
        save.privateState.monsterNestActive = 0;
        save.privateState.monsterNumber = 0;
      } else {
        save.privateState.monsterNumber = nextIdx;
      }
      save.privateState.stepMonsterNumber = 0;
      save.privateState.timeStampTakeCareMonster = 0;
      events.push({ type: "sfx", name: "AchievementSound" });
      return { ok: true, events };
    }

    case "desactivate_monster": {
      save.privateState.monsterNestActive = 0;
      save.privateState.monsterNumber = 0;
      save.privateState.stepMonsterNumber = 0;
      save.privateState.timeStampTakeCareMonster = 0;
      return { ok: true, events };
    }

    case "neighbor_assist": {
      // Canonical neighbor visit assist (`PopOverVisit` / `IsoElement.as`): +10 Gold, +3 XP
      const neighborId = String(args[0] ?? "king");
      const assists = getStringNumMap(save.privateState, "neighborAssists");
      assists[neighborId] = (assists[neighborId] ?? 0) + 1;
      creditResource(bag, "g", 10);
      commitBag(save, map, bag);
      addXp(save, map, 3, ctx, events);
      events.push({ type: "sfx", name: "Collection2Sound" });
      return { ok: true, events };
    }

    case "buy_survival_map": {
      // PR #48 fix: store actual mapId (not literal string "map_id")
      const mapId = String(args[0] ?? "");
      const cost = toInt(args[1], 0);
      const costType = (String(args[2] ?? "g") as "g" | "c") || "g";
      if (cost > 0 && !debitResource(bag, costType, cost)) {
        return { ok: false, error: "Insufficient resources", events };
      }
      const survivalMaps = getStringNumMap(save.privateState, "survivalMaps");
      survivalMaps[mapId] = 1;
      commitBag(save, map, bag);
      return { ok: true, events };
    }

    case "end_quest": {
      const questId = String(args[0] ?? "");
      const won = Boolean(Number(args[1] ?? 1));
      const goldReward = toInt(args[2], 0);
      const xpReward = toInt(args[3], 0);
      const unitReward = toInt(args[4], 0);
      map.lastQuestTimes[questId] = ctx.nowSec;
      if (won) {
        map.questTimes[questId] = (map.questTimes[questId] ?? 0) + 1;
        creditResource(bag, "g", goldReward);
        if (unitReward > 0) {
          map.store[String(unitReward)] = (map.store[String(unitReward)] ?? 0) + 1;
        }
        commitBag(save, map, bag);
        addXp(save, map, xpReward, ctx, events);
        events.push({ type: "sfx", name: "AchievementSound" });
      }
      return { ok: true, events };
    }

    case "pvp_end_attack_new":
    case "end_attack": {
      // PR #48 fix: handle optional food key gracefully, persist attacker wins/honor
      const won = Boolean(Number(args[0] ?? 0));
      const goldLoot = toInt(args[1], 0);
      const xpGain = toInt(args[2], 0);
      const woodLoot = toInt(args[3], 0);
      const stoneLoot = toInt(args[4], 0);
      const foodLoot = toInt(args[5], 0);
      creditResource(bag, "g", goldLoot);
      creditResource(bag, "w", woodLoot);
      creditResource(bag, "s", stoneLoot);
      creditResource(bag, "f", foodLoot);
      if (won) save.playerInfo.attacks_won += 1;
      else save.playerInfo.attacks_lost += 1;
      commitBag(save, map, bag);
      addXp(save, map, xpGain, ctx, events);
      return { ok: true, events };
    }

    default:
      return { ok: false, error: `Unsupported command: ${cmd}`, events };
  }
}
