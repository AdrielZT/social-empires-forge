const rawBase = import.meta.env.BASE_URL || "/";

export const BASE_URL = rawBase.endsWith("/") ? rawBase : `${rawBase}/`;
export const IS_STATIC_MODE = import.meta.env.VITE_STATIC_MODE === "true";

// Exact set of thumbnails compiled as .png in assets/generated/ui/thumbs/ (all others are .jpg)
const PNG_THUMB_STEMS = new Set<string>([
  "822_dragon_rider1_training",
  "823_dragon_rider2_training",
  "824_dragon_rider3_training",
  "arqueroelfo_altar",
  "mago_altar",
  "princearthur_altar",
  "ranger_altar",
  "thor_altar",
  "valkiria_altar",
  "wallace_altar",
  "xena_altar"
]);

// Items lacking a dedicated ui/thumbs file that DO have a compiled WebP sprite atlas
const SPRITE_FALLBACK_THUMBS = new Set<string>([
  "1254_eggphoenix", "arboles_2x2", "arboles_3x3", "cactus1", "cactus2", "calaveraDesierto",
  "columna", "esqueletoDesierto", "esqueletoRoca", "icemontain4x4", "islaasian", "islaaztec",
  "islacalavera", "islacivilizated", "isladangerous", "isladune", "islaemergent", "islagrande",
  "islahero", "islahielo2x2", "islahielo4x4", "islamineral2x2", "islamineral2x2b",
  "islamineral3x3", "islamineral4x4", "islamisty", "islamysterious", "islamythical",
  "islandbigboss3", "islanest", "islapinguino", "islaroca2x2", "islaselva2x2",
  "islaselva2x2b", "islaselva2x2c", "islaselva3x3", "islaselva4x4", "islaselvagrande",
  "islaundiscovered", "islaunknown", "islavegetacion2x2", "islavegetacion3x3", "islawild",
  "islaxonquered", "islitas2x2", "islitas4x4", "islitas4x4b", "islitas4x4c", "lake2x2",
  "lake4x4", "mascaraTutankamon", "oasis", "palmera2", "palmera4", "palmera8",
  "pinosnevados2x2", "pinosnevados4x4", "pinosnevados8x8", "piramide2", "piramide3",
  "placashielo", "rocacalavera", "rocaminerales2", "rocaminerales3", "rocaminerales3b",
  "rocaminerales4", "terreno", "terrenodesierto", "terrenohielo", "terrenomar2",
  "terrenomineral", "terrenonubes", "terrenoselva"
]);

// Upstream items without either a thumb or sprite SWF in 1.4.07 (render clean SVG crest -> 0 HTTP 404s)
const NO_THUMB_OR_SPRITE = new Set<string>([
  "1210_miniportal", "1246_barracafantasma", "1302_barrack_pyros", "1315_necro_deco_4",
  "1324_necro_gollum_barracks", "1327_necro_executioner_barracks", "1328_necro_shark_barracks",
  "1330_necro_gryphon_barracks", "1331_necro_abomination_barracks", "1332_necro_worm_barracks",
  "1432_chained_jade_dragon", "1434_barracks_archer_orc", "1440_deco3", "1458_banyan_tree",
  "1472_chained_soul_eater", "1523_dwarfAxe_barrack", "1524_dwarfPriest_barrack",
  "1525_dwarvenCatapult_barrack", "2025_fire_draggy", "2028_archer_orc", "2032_jade_dragon",
  "2033_jade_draggy", "2034_jade_dragon_rider", "2051_chuck_dragon", "2082_forest_colossus_minion",
  "2088_infra_god_minion", "2095_heaven_colossus_minion", "2097_black_phoenix",
  "2100_reptile_warrior", "2124_sky_whirlwind", "2163_dwarfAxe", "2164_dwarfPriest",
  "2165_dwarvenCatapult", "2166_tinyLightGod", "3042_chained_reptile_warrior",
  "3058_chained_supreme", "3088_chained_genesisWindColossus", "3089_chained_tinyLightGod",
  "639_aguila", "720_chock", "726_dragon", "734_fantasma", "800_necro_gollum",
  "804_necro_executioner", "819_snakes_charmer", "848_giant_bat", "874_dragon_hunter3",
  "animal2", "colonizador", "islarock", "lobo1", "trophytotem",
  "upgrade1", "upgrade2", "upgrade3", "upgrade4"
]);

export type ThumbResolutionKind = "thumb" | "sprite" | "fallback";

export function resolveThumbKind(imgName: string): ThumbResolutionKind {
  if (!imgName || NO_THUMB_OR_SPRITE.has(imgName)) return "fallback";
  if (SPRITE_FALLBACK_THUMBS.has(imgName)) return "sprite";
  return "thumb";
}

export function assetsBaseUrl(): string {
  return `${BASE_URL}assets`;
}

export function audioBaseUrl(): string {
  return `${BASE_URL}assets/audio`;
}

export function dataUrl(relPath: string): string {
  return `${BASE_URL}game-data/${relPath.replace(/^\/+/, "")}`;
}

export function thumbUrl(imgName: string): string {
  const ext = PNG_THUMB_STEMS.has(imgName) ? "png" : "jpg";
  return `${BASE_URL}assets/ui/thumbs/${encodeURIComponent(imgName)}.${ext}`;
}

export function spriteAtlasUrl(imgName: string): string {
  return `${BASE_URL}assets/sprites/${encodeURIComponent(imgName)}.atlas.json`;
}
