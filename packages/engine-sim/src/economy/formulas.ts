import type { CostType, GameItem } from "@sef/shared-types";

export const COLLECT_MULTIPLIERS = [0.0, 0.5, 1.0, 2.0, 3.0] as const;

/** Canonical `Config.COLLECT_MINUTES` (`Config.as:404`) for variable-time resource buildings */
export const COLLECT_MINUTES = [5, 60, 240, 480] as const;

/** Canonical `globals.COLLECT_VARIABLE_IDS` (`Base.as:2111`): mills, gold mines, stone mines, lumber mills */
export const COLLECT_VARIABLE_IDS = new Set([5, 6, 7, 202, 13, 14, 15, 203, 16, 17, 18, 204, 77, 78, 79, 205]);

/** Canonical `Config.MULTIPLIER_UNLOCK = 1/3` (`Config.as:358`) */
export const MULTIPLIER_UNLOCK = 1 / 3;

/** Canonical Dragon Nest (`PopupDragons.as:59-73`) & Monster Nest (`PopupMonstersNest.as`) constants */
export const DRAGON_NEST_IDS = [638, 649, 651, 684, 698, 695] as const;
export const DRAGON_NEST_HAS_EGG = [true, false, true, false, true, false] as const;
export const MONSTER_NEST_IDS = [717, 713, 742, 653] as const;
export const NEST_STEP_COOLDOWN_SEC = 6 * 60 * 60; // 21600s (6h)
export const NEST_TOTAL_STEPS = 10;
export const ACTIVATE_NEST_GOLD = 100000;
export const ACTIVATE_NEST_CASH = 50;
export const DRAGON_STEP_CASH_SMALL = 3;
export const DRAGON_STEP_CASH_BIG = 15;
export const MONSTER_STEP_CASH = 7;

/** Canonical resource regeneration nodes (`IsoElement.as:793-826, 897-924`) */
export const ID_BUILDING_REGEN_GOLD = 80;
export const ID_BUILDING_REGEN_STONE = 81;
export const STONE_ORE_IDS = [69, 70, 71, 72] as const;
export const GOLD_ORE_IDS = [73, 74, 75, 76] as const;
export const REGEN_ORE_DURATION_SEC = 10800; // 3 hours

export const PEASANT_IDS = new Set([500, 501]);

export const BLACKSMITH_DISCOUNT_SUBCATS = new Set([
  72, // SUBCATFUNC_UNIT_ARCHER
  73, // SUBCATFUNC_UNIT_FOOTMAN
  74  // SUBCATFUNC_UNIT_MOUNTED
]);

export const UNIVERSITY_DISCOUNT_SUBCATS = new Set([
  75 // SUBCATFUNC_UNIT_SIEGE
]);

export const BUILDING_BLACKSMITH_IDS = new Set([18]);
export const BUILDING_UNIVERSITY_IDS = new Set([25]);

export interface ResourceBag {
  coins: number;
  wood: number;
  stone: number;
  food: number;
  cash: number;
  mana: number;
}

export function roundHalfUp(n: number): number {
  return Math.floor(n + 0.5);
}

/**
 * Exact training food cost formula verified from Social Empires 1.4.07 BuildingQueueManager (PR #48):
 * ceil(cost * FOOD_PER_GOLD_INTRAINING), 0 for peasants, charged regardless of primary cost type.
 */
export function computeTrainingFoodCost(
  item: GameItem,
  foodPerGoldInTraining = 0.25
): number {
  if (item.type !== "u") return 0;
  if (PEASANT_IDS.has(item.id)) return 0;
  if (item.costType === "f") return 0;
  return Math.ceil(item.cost * foodPerGoldInTraining);
}

/**
 * Applies Blacksmith / University training discount when those buildings exist in the empire.
 */
export function computeEffectiveItemCost(
  item: GameItem,
  opts: { hasBlacksmith?: boolean; hasUniversity?: boolean } = {}
): number {
  let discount = 0;
  if (opts.hasBlacksmith && BLACKSMITH_DISCOUNT_SUBCATS.has(item.subcatFunctional)) {
    discount = 0.1;
  } else if (opts.hasUniversity && UNIVERSITY_DISCOUNT_SUBCATS.has(item.subcatFunctional)) {
    discount = 0.1;
  }
  return Math.max(0, Math.floor(item.cost * (1 - discount)));
}

export function canAfford(bag: ResourceBag, costType: CostType, amount: number): boolean {
  if (amount <= 0 || costType === "") return true;
  switch (costType) {
    case "g":
      return bag.coins >= amount;
    case "w":
      return bag.wood >= amount;
    case "s":
      return bag.stone >= amount;
    case "f":
      return bag.food >= amount;
    case "c":
      return bag.cash >= amount;
  }
}

export function debitResource(bag: ResourceBag, costType: CostType, amount: number): boolean {
  if (!canAfford(bag, costType, amount)) return false;
  if (amount <= 0 || costType === "") return true;
  switch (costType) {
    case "g":
      bag.coins -= amount;
      break;
    case "w":
      bag.wood -= amount;
      break;
    case "s":
      bag.stone -= amount;
      break;
    case "f":
      bag.food -= amount;
      break;
    case "c":
      bag.cash -= amount;
      break;
  }
  return true;
}

export function creditResource(bag: ResourceBag, costType: CostType, amount: number): void {
  if (amount <= 0 || costType === "") return;
  switch (costType) {
    case "g":
      bag.coins += amount;
      break;
    case "w":
      bag.wood += amount;
      break;
    case "s":
      bag.stone += amount;
      break;
    case "f":
      bag.food += amount;
      break;
    case "c":
      bag.cash += amount;
      break;
  }
}

export interface MarketConfig {
  baseCosts: Record<"w" | "s" | "f", number>;
  increment: number;
  sellPercentage: number;
  maxIncrements: number;
  maxDecrements: number;
}

export const DEFAULT_MARKET_CONFIG: MarketConfig = {
  baseCosts: { w: 100, s: 150, f: 100 },
  increment: 0.02,
  sellPercentage: 0.75,
  maxIncrements: 200,
  maxDecrements: 25
};

/**
 * Exact Market buy/sell price per 100 units (PR #48 half-up rounding faithful to client).
 */
export function computeMarketPrice(
  resource: "w" | "s" | "f",
  netSteps: number,
  action: "buy" | "sell",
  cfg: MarketConfig = DEFAULT_MARKET_CONFIG
): number {
  const clampedSteps = Math.max(-cfg.maxDecrements, Math.min(cfg.maxIncrements, netSteps));
  const base = cfg.baseCosts[resource];
  const buyPrice = base * Math.pow(1 + cfg.increment, clampedSteps);
  if (action === "buy") {
    return roundHalfUp(buyPrice);
  }
  return roundHalfUp(buyPrice * cfg.sellPercentage);
}

/**
 * Computes sell refund (50% of cost in gold/resource, 0 for cash items).
 */
export function computeSellRefund(item: GameItem): { costType: CostType; amount: number } {
  if (item.costType === "c" || item.costType === "" || item.cost <= 0) {
    return { costType: "g", amount: 0 };
  }
  return { costType: item.costType, amount: Math.floor(item.cost * 0.5) };
}

/**
 * Computes current level from total XP using Social Empires levels table.
 */
export function computeLevelFromXp(
  xp: number,
  levelsTable: readonly { level?: number | string; exp_required?: number | string }[]
): number {
  let lvl = 1;
  for (let i = 0; i < levelsTable.length; i++) {
    const entry = levelsTable[i];
    if (!entry) continue;
    const req = Number(entry.exp_required ?? 0);
    const l = Number(entry.level ?? i + 1);
    if (xp >= req && l >= lvl) {
      lvl = l;
    }
  }
  return lvl;
}

/**
 * Canonical early building/unit unlock cost in Cash (`ItemButtonLarge.as:205`, `Config.MULTIPLIER_UNLOCK = 1/3`).
 */
export function computeEarlyUnlockCashCost(minLevel: number): number {
  return Math.max(1, Math.ceil(Math.max(1, minLevel) * MULTIPLIER_UNLOCK));
}

/**
 * Canonical producer building yield (`IsoElement.as` + `engine.py`):
 * floor(floor(base + (workers - 1) * base * 0.2) * COLLECT_MULTIPLIERS[cpIndex])
 */
export function computeProducerYield(baseCollect: number, workerCount: number, cpIndex: number): number {
  const workers = Math.max(1, workerCount);
  const mult = COLLECT_MULTIPLIERS[Math.max(1, Math.min(4, cpIndex))] ?? 1.0;
  const withWorkers = Math.floor(baseCollect + (workers - 1) * baseCollect * 0.2);
  return Math.max(1, Math.floor(withWorkers * mult));
}

/**
 * Canonical farm replant wood cost (`IsoElement.as:1730` & `engine.py:397`): Math.round(collect / 3).
 */
export function computeFarmReplantWoodCost(baseCollect: number): number {
  return Math.max(0, Math.round(baseCollect / 3));
}

