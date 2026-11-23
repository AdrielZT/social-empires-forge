import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import jsonpatch, { type Operation } from "fast-json-patch";
import { GameItemSchema, GoalDefSchema, MagicSpellDefSchema, type GameItem } from "@sef/shared-types";
import { GAME_DATA_DIR, UPSTREAM_DIR } from "./paths.js";

const PR40_TILE_DIMENSION_FIXES: Record<number, { width: number; height: number }> = {
  25: { width: 3, height: 3 },   // University (PR #40)
  1529: { width: 3, height: 3 }  // Soul Mixer (PR #40)
};

const MAGIC_ES_TRANSLATIONS: Record<number, { name: string; description: string }> = {
  2: { name: "Furia de Fuego", description: "Una tempestad de fuego golpea el campo de batalla. Más eficaz contra edificios y tropas agrupadas." },
  3: { name: "Granizo Definitivo", description: "Cientos de rocas caen del cielo aplastando a los enemigos en el área." },
  4: { name: "Congelación Mortal", description: "Las unidades enemigas quedan congeladas, incapaces de moverse o atacar temporalmente." },
  5: { name: "Lluvia Sagrada", description: "Una lluvia sanadora cae sobre tus unidades heridas restaurando su salud." },
  6: { name: "Ira del Gólem", description: "Invoca un poderoso Gólem de Piedra aliado directamente en el campo de batalla." },
  7: { name: "Abismo Infernal", description: "La tierra se abre y engulle unidades pequeñas y edificios enemigos." },
  8: { name: "Inundación Venenosa", description: "Una nube tóxica infecta a los enemigos causando daño continuo con el tiempo." },
  9: { name: "Escudo de Éter", description: "Un escudo de éter sólido protege a tus unidades absorbiendo parte del daño recibido." },
  10: { name: "Senda del Yeti", description: "Invoca un abominable Yeti aliado que siembra el caos en las filas enemigas." },
  11: { name: "Era del Coloso", description: "Tus unidades aumentan de tamaño y causan mucho más daño durante un tiempo." },
  12: { name: "Invocar Dragón", description: "Invoca un poderoso Dragón aliado para asistirte en la batalla." },
  13: { name: "Límite Instantáneo", description: "Llena al instante la barra de Límite de tus unidades especiales." },
  14: { name: "Velocidad x2", description: "Duplica la velocidad de movimiento de tus unidades en el área." },
  15: { name: "Alcance x2", description: "Duplica el alcance de ataque de tus unidades." },
  16: { name: "Agujero Negro", description: "Absorbe enemigos y edificios cercanos durante un breve periodo." }
};

function toNum(v: unknown, fallback = 0): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function toBool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return v === "1" || v.toLowerCase() === "true";
  return false;
}

function toRace(v: unknown): "h" | "n" | "a" | "t" | "e" {
  const s = String(v ?? "h").toLowerCase();
  if (s === "h" || s === "n" || s === "a" || s === "t" || s === "e") return s;
  return "h";
}

function toCostType(v: unknown): "g" | "w" | "s" | "f" | "c" | "" {
  const s = String(v ?? "").toLowerCase();
  if (s === "g" || s === "w" || s === "s" || s === "f" || s === "c") return s;
  return "";
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
}

function writeJson(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data));
}

function copyJsonDir(srcDir: string, dstDir: string): number {
  if (!fs.existsSync(srcDir)) return 0;
  fs.mkdirSync(dstDir, { recursive: true });
  let count = 0;
  for (const entry of fs.readdirSync(srcDir)) {
    if (!entry.endsWith(".json")) continue;
    const src = path.join(srcDir, entry);
    if (!fs.statSync(src).isFile()) continue;
    fs.copyFileSync(src, path.join(dstDir, entry));
    count += 1;
  }
  return count;
}

function main(): void {
  const configDir = path.join(UPSTREAM_DIR, "config");
  const patchDir = path.join(configDir, "patch");
  const villagesDir = path.join(UPSTREAM_DIR, "villages");

  if (!fs.existsSync(path.join(configDir, "main.json"))) {
    throw new Error(`Missing upstream config at ${configDir}. Run "pnpm assets:sync" first.`);
  }

  const upstreamCommit = execFileSync("git", ["-C", UPSTREAM_DIR, "rev-parse", "--short", "HEAD"], {
    encoding: "utf-8"
  }).trim();

  console.log(`[compile-data] Loading config/main.json from upstream commit ${upstreamCommit}...`);
  const cfg = readJson<Record<string, unknown>>(path.join(configDir, "main.json"));

  // Apply RFC 6902 patches in alphabetical order just like get_game_config.py
  const patchFiles = fs.existsSync(patchDir)
    ? fs.readdirSync(patchDir).filter((f) => f.endsWith(".json")).sort()
    : [];

  let appliedOps = 0;
  let skippedOps = 0;
  for (const patchFile of patchFiles) {
    const ops = readJson<Operation[]>(path.join(patchDir, patchFile));
    for (const op of ops) {
      try {
        jsonpatch.applyOperation(cfg, op, false, true);
        appliedOps += 1;
      } catch {
        skippedOps += 1;
      }
    }
    console.log(`[compile-data] Applied patch ${patchFile} (${ops.length} ops)`);
  }
  console.log(`[compile-data] Patch totals: applied=${appliedOps}, skipped=${skippedOps}`);

  // Normalize & deduplicate items (last wins, matching remove_duplicate_items in get_game_config.py)
  const rawItems = (cfg.items as Record<string, unknown>[]) ?? [];
  const itemMap = new Map<number, GameItem>();
  let pr40Applied = 0;

  for (const raw of rawItems) {
    const id = Math.trunc(toNum(raw.id, -1));
    if (id < 0) continue;
    const pr40 = PR40_TILE_DIMENSION_FIXES[id];
    const width = pr40 ? pr40.width : Math.max(1, Math.trunc(toNum(raw.width, 1)));
    const height = pr40 ? pr40.height : Math.max(1, Math.trunc(toNum(raw.height, 1)));
    if (pr40) pr40Applied += 1;

    const normalized = GameItemSchema.parse({
      id,
      inStore: toBool(raw.in_store),
      name: String(raw.name ?? `Item ${id}`),
      type: String(raw.type) === "u" ? "u" : "b",
      cost: toNum(raw.cost, 0),
      costType: toCostType(raw.cost_type),
      xp: toNum(raw.xp, 0),
      groups: String(raw.groups ?? ""),
      trains: Math.trunc(toNum(raw.trains, 0)),
      upgradesTo: Math.trunc(toNum(raw.upgrades_to, 0)),
      displayOrder: Math.trunc(toNum(raw.display_order, 0)),
      activation: toNum(raw.activation, 0),
      expiration: toNum(raw.expiration, 0),
      collect: toNum(raw.collect, 0),
      collectType: toCostType(raw.collect_type),
      collectXp: toNum(raw.collect_xp, 0),
      categoryId: Math.trunc(toNum(raw.category_id, 0)),
      subcategoryId: Math.trunc(toNum(raw.subcategory_id, 0)),
      subcatFunctional: Math.trunc(toNum(raw.subcat_functional, 0)),
      minLevel: Math.trunc(toNum(raw.min_level, 0)),
      width,
      height,
      maxFrame: Math.max(1, Math.trunc(toNum(raw.max_frame, 1))),
      giftable: toBool(raw.giftable),
      imgName: String(raw.img_name ?? ""),
      elevation: toNum(raw.elevation, 0),
      unitCapacity: Math.trunc(toNum(raw.unit_capacity, 0)),
      attack: toNum(raw.attack, 0),
      defense: toNum(raw.defense, 0),
      life: toNum(raw.life, 0),
      velocity: toNum(raw.velocity, 0),
      attackRange: toNum(raw.attack_range, 0),
      attackInterval: toNum(raw.attack_interval, 0),
      newItem: toBool(raw.new_item),
      population: toNum(raw.population, 0),
      giftLevel: Math.trunc(toNum(raw.gift_level, 0)),
      costUnitCash: toNum(raw.cost_unit_cash, 0),
      race: toRace(raw.race),
      flying: toBool(raw.flying),
      protect: toNum(raw.protect, 0),
      potion: toNum(raw.potion, 0),
      unitsLimit: Math.trunc(toNum(raw.units_limit, 0)),
      storeGroups: String(raw.store_groups ?? ""),
      storeLevel: Math.trunc(toNum(raw.store_level, 0)),
      onlyMobile: toBool(raw.only_mobile)
    });
    itemMap.set(id, normalized);
  }

  const items = Array.from(itemMap.values()).sort((a, b) => a.id - b.id);

  // Normalize magics (with ES translations alongside EN originals)
  const rawMagics = (cfg.magics as Record<string, unknown>[]) ?? [];
  const magics = rawMagics.map((m) =>
    MagicSpellDefSchema.parse({
      id: Math.trunc(toNum(m.id, 0)),
      name: String(m.name ?? ""),
      mana: Math.trunc(toNum(m.mana, 0)),
      description: String(m.description ?? ""),
      minLevel: Math.trunc(toNum(m.min_level ?? m.level, 1)),
      imgName: String(m.img_name ?? ""),
      unlockCostCash: toNum(m.cash ?? m.unlock_cash, 0),
      unlockCostGold: toNum(m.gold ?? m.unlock_gold, 0),
      cooldown: toNum(m.cooldown, 0)
    })
  );

  // Normalize goals.json
  const rawGoals = readJson<Record<string, unknown>[]>(path.join(configDir, "goals.json"));
  const goals = rawGoals.map((g) => {
    let params: Record<string, unknown> = {};
    if (typeof g.params === "string" && g.params.trim().startsWith("{")) {
      try {
        params = JSON.parse(g.params) as Record<string, unknown>;
      } catch {
        params = {};
      }
    } else if (g.params && typeof g.params === "object") {
      params = g.params as Record<string, unknown>;
    }
    return GoalDefSchema.parse({
      id: Math.trunc(toNum(g.id, 0)),
      types: String(g.types ?? "none"),
      reward: toNum(g.reward, 0),
      title: String(g.title ?? ""),
      description: String(g.description ?? ""),
      orders: Math.trunc(toNum(g.orders, 0)),
      instructions: String(g.instructions ?? ""),
      minLevel: Math.trunc(toNum(g.min_level, 1)),
      image: String(g.image ?? "none"),
      characters: String(g.characters ?? "none"),
      params
    });
  });

  // Extract localization dictionary (EN original + ES overlay)
  const rawLoc = (cfg.localization_strings as Record<string, unknown>[]) ?? [];
  const localizationEn: Record<string, string> = {};
  for (const entry of rawLoc) {
    const key = String(entry.name ?? entry.id ?? "");
    if (!key) continue;
    localizationEn[key] = String(entry.text ?? "");
  }
  const localizationEs: Record<string, string> = {
    CATEGORY_VILLAGE: "ALDEA",
    CATEGORY_DEFENSE: "DEFENSA",
    CATEGORY_ARMY: "EJÉRCITO",
    CATEGORY_DECORATIONS: "DECORACIONES",
    CATEGORY_WONDERS: "MARAVILLAS",
    CATEGORY_NEW: "NOVEDADES",
    CATEGORY_DRAGONS: "DRAGONES",
    CATEGORY_DRAGGIES: "DRAGONCITOS",
    CATEGORY_RIDERS: "JINETES",
    CATEGORY_ELVES: "ELFOS",
    CATEGORY_CELESTIAL: "CELESTIALES",
    CATEGORY_INFERNO: "INFERNO",
    CATEGORY_MONSTERS: "MONSTRUOS",
    CATEGORY_GOLEMS: "GÓLEMS",
    CATEGORY_PHOENIX: "FÉNIX",
    CATEGORY_PETS: "MASCOTAS",
    CATEGORY_GLADIATORS_I: "GLADIADORES I"
  };
  for (const [idStr, tr] of Object.entries(MAGIC_ES_TRANSLATIONS)) {
    localizationEs[`MAGIC_${idStr}_NAME`] = tr.name;
    localizationEs[`MAGIC_${idStr}_DESC`] = tr.description;
  }

  // Write compiled data files
  fs.mkdirSync(GAME_DATA_DIR, { recursive: true });
  writeJson(path.join(GAME_DATA_DIR, "items.json"), items);
  writeJson(path.join(GAME_DATA_DIR, "magics.json"), magics);
  writeJson(path.join(GAME_DATA_DIR, "goals.json"), goals);
  writeJson(path.join(GAME_DATA_DIR, "globals.json"), cfg.globals ?? {});
  writeJson(path.join(GAME_DATA_DIR, "categories.json"), cfg.categories ?? {});
  writeJson(path.join(GAME_DATA_DIR, "levels.json"), cfg.levels ?? []);
  writeJson(path.join(GAME_DATA_DIR, "honor_levels.json"), cfg.honor_levels ?? []);
  writeJson(path.join(GAME_DATA_DIR, "expansion_prices.json"), cfg.expansion_prices ?? []);
  writeJson(path.join(GAME_DATA_DIR, "missions.json"), cfg.missions ?? []);
  writeJson(path.join(GAME_DATA_DIR, "collections.json"), cfg.units_collections_categories ?? {});
  writeJson(path.join(GAME_DATA_DIR, "offer_packs.json"), cfg.offer_packs ?? []);
  writeJson(path.join(GAME_DATA_DIR, "darts_items.json"), cfg.darts_items ?? []);
  writeJson(path.join(GAME_DATA_DIR, "social_items.json"), cfg.social_items ?? []);
  writeJson(path.join(GAME_DATA_DIR, "localization_en.json"), localizationEn);
  writeJson(path.join(GAME_DATA_DIR, "localization_es.json"), localizationEs);

  // Copy extra server config tables
  for (const extra of ["shop_rotation.json", "avatars.json"]) {
    const src = path.join(configDir, extra);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(GAME_DATA_DIR, extra));
    }
  }

  // Copy maps & quests
  const mapsDir = path.join(GAME_DATA_DIR, "maps");
  const rootMapsCount = copyJsonDir(villagesDir, mapsDir);
  const questsCount = copyJsonDir(path.join(villagesDir, "quests"), path.join(mapsDir, "quests"));
  const quests1407Count = copyJsonDir(path.join(villagesDir, "quests_1407"), path.join(mapsDir, "quests_1407"));
  const friendsCount = copyJsonDir(path.join(villagesDir, "friend_static"), path.join(mapsDir, "friend_static"));

  const metadata = {
    targetVersion: "1.4.07",
    upstreamCommit,
    compiledAt: new Date().toISOString(),
    counts: {
      items: items.length,
      buildings: items.filter((i) => i.type === "b").length,
      units: items.filter((i) => i.type === "u").length,
      magics: magics.length,
      goals: goals.length,
      missions: Array.isArray(cfg.missions) ? cfg.missions.length : 0,
      localizationEn: Object.keys(localizationEn).length,
      localizationEs: Object.keys(localizationEs).length,
      rootMaps: rootMapsCount,
      quests: questsCount,
      quests1407: quests1407Count,
      friends: friendsCount,
      pr40FixesApplied: pr40Applied
    }
  };
  writeJson(path.join(GAME_DATA_DIR, "metadata.json"), metadata);
  console.log("[compile-data] Compiled game data successfully:", JSON.stringify(metadata.counts));
}

main();
