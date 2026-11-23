import type { Locale } from "@sef/shared-types";

export interface UiStrings {
  readonly appTitle: string;
  readonly loading: string;
  readonly languageLabel: string;
  readonly resources: {
    readonly gold: string;
    readonly wood: string;
    readonly stone: string;
    readonly food: string;
    readonly cash: string;
    readonly mana: string;
    readonly population: string;
    readonly xp: string;
    readonly level: string;
  };
  readonly hud: {
    readonly shop: string;
    readonly storage: string;
    readonly warehouse: string;
    readonly gifts: string;
    readonly magic: string;
    readonly worldMap: string;
    readonly quests: string;
    readonly survival: string;
    readonly pvp: string;
    readonly collections: string;
    readonly goals: string;
    readonly move: string;
    readonly rotate: string;
    readonly sell: string;
    readonly store: string;
    readonly train: string;
    readonly collect: string;
    readonly upgrade: string;
    readonly fullscreen: string;
    readonly music: string;
    readonly sfx: string;
  };
  readonly categories: Record<string, string>;
  readonly biomes: Record<string, string>;
  readonly modes: {
    readonly village: string;
    readonly quest: string;
    readonly survival: string;
    readonly pvp: string;
    readonly sandbox: string;
  };
}

export const UI_TRANSLATIONS: Record<Locale, UiStrings> = {
  es: {
    appTitle: "Social Empires Forge",
    loading: "Cargando tu imperio...",
    languageLabel: "Idioma",
    resources: {
      gold: "Oro",
      wood: "Madera",
      stone: "Piedra",
      food: "Comida",
      cash: "Cash",
      mana: "Maná",
      population: "Población",
      xp: "XP",
      level: "Nivel"
    },
    hud: {
      shop: "Tienda",
      storage: "Inventario",
      warehouse: "Almacén",
      gifts: "Regalos",
      magic: "Magia",
      worldMap: "Mapa Mundial",
      quests: "Misiones",
      survival: "Supervivencia",
      pvp: "Asalto PvP",
      collections: "Colecciones",
      goals: "Objetivos",
      move: "Mover",
      rotate: "Rotar",
      sell: "Vender",
      store: "Guardar",
      train: "Entrenar",
      collect: "Recoger",
      upgrade: "Mejorar",
      fullscreen: "Pantalla completa",
      music: "Música",
      sfx: "Efectos"
    },
    categories: {
      "1": "Aldea",
      "2": "Defensa",
      "3": "Ejército",
      "4": "Decoraciones",
      "5": "Maravillas",
      "12": "Novedades"
    },
    biomes: {
      terreno: "Pradera Clásica",
      terrenodesierto: "Desierto",
      terrenohielo: "Hielo",
      terrenomar2: "Isla Oceánica",
      terrenomineral: "Tierras Minerales",
      terrenonubes: "Reino Celestial",
      terrenoselva: "Selva",
      islandbigboss3: "Isla del Gran Jefe"
    },
    modes: {
      village: "Aldea",
      quest: "Campaña",
      survival: "Supervivencia",
      pvp: "PvP",
      sandbox: "Explorador"
    }
  },
  en: {
    appTitle: "Social Empires Forge",
    loading: "Loading your empire...",
    languageLabel: "Language",
    resources: {
      gold: "Gold",
      wood: "Wood",
      stone: "Stone",
      food: "Food",
      cash: "Cash",
      mana: "Mana",
      population: "Population",
      xp: "XP",
      level: "Level"
    },
    hud: {
      shop: "Shop",
      storage: "Storage",
      warehouse: "Warehouse",
      gifts: "Gifts",
      magic: "Magic",
      worldMap: "World Map",
      quests: "Quests",
      survival: "Survival",
      pvp: "PvP Assault",
      collections: "Collections",
      goals: "Goals",
      move: "Move",
      rotate: "Rotate",
      sell: "Sell",
      store: "Store",
      train: "Train",
      collect: "Collect",
      upgrade: "Upgrade",
      fullscreen: "Fullscreen",
      music: "Music",
      sfx: "SFX"
    },
    categories: {
      "1": "Village",
      "2": "Defense",
      "3": "Army",
      "4": "Decorations",
      "5": "Wonders",
      "12": "New"
    },
    biomes: {
      terreno: "Classic Plains",
      terrenodesierto: "Desert",
      terrenohielo: "Ice",
      terrenomar2: "Ocean Island",
      terrenomineral: "Mineral Lands",
      terrenonubes: "Sky Realm",
      terrenoselva: "Jungle",
      islandbigboss3: "Big Boss Island"
    },
    modes: {
      village: "Village",
      quest: "Quest",
      survival: "Survival",
      pvp: "PvP",
      sandbox: "Explorer"
    }
  }
};

export function getUiStrings(locale: Locale): UiStrings {
  return UI_TRANSLATIONS[locale];
}
