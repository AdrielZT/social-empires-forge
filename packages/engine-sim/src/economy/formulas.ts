import type { CostType, GameItem } from "@sef/shared-types";

export const COLLECT_MULTIPLIERS = [0.0, 0.5, 1.0, 2.0, 3.0] as const;

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
