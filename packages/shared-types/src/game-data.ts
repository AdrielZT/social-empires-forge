import { z } from "zod";

export const LocaleSchema = z.enum(["es", "en"]);
export type Locale = z.infer<typeof LocaleSchema>;

export const RaceSchema = z.enum(["h", "n", "a", "t", "e"]);
export type Race = z.infer<typeof RaceSchema>;

export const CostTypeSchema = z.enum(["g", "w", "s", "f", "c", ""]);
export type CostType = z.infer<typeof CostTypeSchema>;

export const ItemTypeSchema = z.enum(["b", "u"]);
export type ItemType = z.infer<typeof ItemTypeSchema>;

export const GameItemSchema = z.object({
  id: z.number().int(),
  inStore: z.boolean(),
  name: z.string(),
  type: ItemTypeSchema,
  cost: z.number(),
  costType: CostTypeSchema,
  xp: z.number(),
  groups: z.string(),
  trains: z.number().int(),
  upgradesTo: z.number().int(),
  displayOrder: z.number().int(),
  activation: z.number(),
  expiration: z.number(),
  collect: z.number(),
  collectType: CostTypeSchema,
  collectXp: z.number(),
  categoryId: z.number().int(),
  subcategoryId: z.number().int(),
  subcatFunctional: z.number().int(),
  minLevel: z.number().int(),
  width: z.number().int().min(1),
  height: z.number().int().min(1),
  maxFrame: z.number().int().min(1),
  giftable: z.boolean(),
  imgName: z.string(),
  elevation: z.number(),
  unitCapacity: z.number().int(),
  attack: z.number(),
  defense: z.number(),
  life: z.number(),
  velocity: z.number(),
  attackRange: z.number(),
  attackInterval: z.number(),
  newItem: z.boolean(),
  population: z.number(),
  giftLevel: z.number().int(),
  costUnitCash: z.number(),
  race: RaceSchema,
  flying: z.boolean(),
  protect: z.number(),
  potion: z.number(),
  unitsLimit: z.number().int(),
  storeGroups: z.string(),
  storeLevel: z.number().int(),
  onlyMobile: z.boolean()
});
export type GameItem = z.infer<typeof GameItemSchema>;

export const MagicSpellDefSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  mana: z.number().int(),
  description: z.string(),
  minLevel: z.number().int().default(1),
  imgName: z.string().default(""),
  unlockCostCash: z.number().default(0),
  unlockCostGold: z.number().default(0),
  cooldown: z.number().default(0)
});
export type MagicSpellDef = z.infer<typeof MagicSpellDefSchema>;

export const GoalDefSchema = z.object({
  id: z.number().int(),
  types: z.string(),
  reward: z.number(),
  title: z.string(),
  description: z.string(),
  orders: z.number().int(),
  instructions: z.string(),
  minLevel: z.number().int(),
  image: z.string(),
  characters: z.string(),
  params: z.record(z.string(), z.unknown())
});
export type GoalDef = z.infer<typeof GoalDefSchema>;

export const TerrainSkinSchema = z.enum([
  "terreno",
  "terrenodesierto",
  "terrenohielo",
  "terrenomar2",
  "terrenomineral",
  "terrenonubes",
  "terrenoselva",
  "islandbigboss3"
]);
export type TerrainSkin = z.infer<typeof TerrainSkinSchema>;

/**
 * Exact save item tuple format from Social Empires 1.4.07 (`maps[n].items`):
 * [itemId, tx, ty, orientation, timestamp, level, garrisonUnits[], attrs{}]
 */
export const RawMapItemTupleSchema = z.tuple([
  z.number().int(),
  z.number().int(),
  z.number().int(),
  z.number().int(),
  z.number(),
  z.number().int(),
  z.array(z.number().int()),
  z.record(z.string(), z.unknown())
]);
export type RawMapItemTuple = z.infer<typeof RawMapItemTupleSchema>;

export const MapStateSchema = z.object({
  id: z.number().int(),
  expansions: z.array(z.number().int()),
  timestamp: z.number(),
  coins: z.number(),
  xp: z.number(),
  level: z.number().int(),
  stone: z.number(),
  wood: z.number(),
  food: z.number(),
  race: z.string(),
  skin: z.number().int(),
  idCurrentTreasure: z.number().int().default(0),
  timestampLastTreasure: z.number().default(0),
  resourcesTraded: z.record(z.string(), z.number()).default({}),
  receivedAssists: z.record(z.string(), z.unknown()).default({}),
  increasedPopulation: z.number().int().default(0),
  questTimes: z.record(z.string(), z.number()).default({}),
  lastQuestTimes: z.record(z.string(), z.number()).default({}),
  items: z.array(RawMapItemTupleSchema),
  warehousedUnits: z.array(z.number().int()).default([]),
  store: z.record(z.string(), z.number()).default({})
});
export type MapState = z.infer<typeof MapStateSchema>;

export const SaveFileSchema = z.object({
  playerInfo: z.object({
    pid: z.union([z.string(), z.number()]).transform(String),
    name: z.string(),
    pic: z.string().default(""),
    cash: z.number().default(0),
    completed_tutorial: z.union([z.number(), z.boolean()]).default(0),
    default_map: z.number().int().default(0),
    map_names: z.array(z.string()).default(["My Empire"]),
    world_id: z.number().int().default(0),
    last_logged_in: z.number().default(0),
    attacks_won: z.number().int().default(0),
    attacks_lost: z.number().int().default(0)
  }).passthrough(),
  maps: z.array(MapStateSchema),
  privateState: z.record(z.string(), z.unknown()).default({})
});
export type SaveFile = z.infer<typeof SaveFileSchema>;
