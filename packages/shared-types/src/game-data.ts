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

const phpRecordNum = z
  .union([z.record(z.string(), z.coerce.number()), z.array(z.unknown()).transform(() => ({} as Record<string, number>))])
  .default({});

const phpRecordAny = z
  .union([z.record(z.string(), z.unknown()), z.array(z.unknown()).transform(() => ({} as Record<string, unknown>))])
  .default({});

const warehousedUnitsField = z
  .union([
    z.array(z.number().int()),
    z.record(z.string(), z.unknown()).transform((rec) => {
      const out: number[] = [];
      for (const [k, v] of Object.entries(rec)) {
        const id = Number(k);
        const cnt = Number(v);
        if (Number.isInteger(id) && Number.isFinite(cnt) && cnt > 0) {
          for (let i = 0; i < Math.min(cnt, 200); i++) out.push(id);
        }
      }
      return out;
    })
  ])
  .default([]);

export const MapStateSchema = z
  .object({
    id: z.number().int().default(0),
    expansions: z.array(z.number().int()).default([13]),
    timestamp: z.number().default(0),
    coins: z.number().default(0),
    xp: z.number().default(0),
    level: z.number().int().default(1),
    stone: z.number().default(0),
    wood: z.number().default(0),
    food: z.number().default(0),
    race: z.string().default("h"),
    skin: z.number().int().default(0),
    idCurrentTreasure: z.number().int().default(0),
    timestampLastTreasure: z.number().default(0),
    resourcesTraded: phpRecordNum,
    receivedAssists: phpRecordAny,
    increasedPopulation: z.number().int().default(0),
    questTimes: phpRecordNum,
    lastQuestTimes: phpRecordNum,
    items: z.array(RawMapItemTupleSchema).default([]),
    warehousedUnits: warehousedUnitsField,
    store: phpRecordNum
  })
  .passthrough();
export type MapState = z.infer<typeof MapStateSchema>;

export const SaveFileSchema = z
  .object({
    playerInfo: z
      .object({
        pid: z.union([z.string(), z.number()]).transform(String),
        name: z.string().default("Emperador"),
        pic: z.string().nullable().default("").transform((v) => v ?? ""),
        cash: z.number().default(0),
        completed_tutorial: z.union([z.number(), z.boolean()]).default(0),
        default_map: z.number().int().default(0),
        map_names: z.array(z.string()).default(["My Empire"]),
        world_id: z.number().int().nullable().default(0),
        last_logged_in: z.number().default(0),
        attacks_won: z.number().int().default(0),
        attacks_lost: z.number().int().default(0)
      })
      .passthrough(),
    maps: z.array(MapStateSchema),
    privateState: phpRecordAny
  })
  .passthrough();
export type SaveFile = z.infer<typeof SaveFileSchema>;
