import { create } from "zustand";
import type { GameItem, GoalDef, Locale, MagicSpellDef, SaveFile, TerrainSkin } from "@sef/shared-types";
import type { RendererMetrics } from "@sef/engine-render";
import type { MusicTrackId } from "@sef/engine-audio";
import type { UnitBehaviorProfile } from "@sef/engine-sim";
import { gameApi } from "../api/gameApi.js";

export type PlayMode = "village" | "quest" | "survival" | "pvp";

export type ActiveModal = null | "shop" | "worldMap" | "systems" | "empires";

export interface MapListEntry {
  key: string;
  category: string;
  label: string;
}

export interface SavedEmpireSummary {
  pid: string;
  name: string;
  level: number;
  coins: number;
  cash: number;
  updatedAt: number;
}

export interface SelectedEntitySummary {
  uid: number;
  itemId: number;
  imgName: string;
  name: string;
  type: "b" | "u";
  team: "player" | "enemy" | "neutral";
  tx: number;
  ty: number;
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  attackRange: number;
  velocity: number;
  orientation: number;
  animState: number;
  limitGauge: number;
  limitMax: number;
  collectReady: boolean;
  collectAmount: number;
  collectType: string;
  queue: number[];
  behavior?: UnitBehaviorProfile;
}

export interface VillageResources {
  coins: number;
  wood: number;
  stone: number;
  food: number;
  cash: number;
  mana: number;
  level: number;
  xp: number;
  population: number;
  maxPopulation: number;
}

export interface BattleStatus {
  mode: PlayMode;
  title: string;
  questId?: string;
  survivalMapId?: number;
  wave: number;
  enemiesRemaining: number;
  playerUnitsAlive: number;
  lootGold: number;
  lootXp: number;
  finished: null | "victory" | "defeat";
}

interface GameStoreState {
  locale: Locale;
  loading: boolean;
  error: string | null;
  toast: string | null;

  // Compiled 1.4.07 catalogs
  items: GameItem[];
  itemsById: Map<number, GameItem>;
  magics: MagicSpellDef[];
  goals: GoalDef[];
  behaviorsById: Map<number, UnitBehaviorProfile>;
  collections: Record<string, unknown>;
  localizationEn: Record<string, string>;
  localizationEs: Record<string, string>;
  availableMaps: MapListEntry[];
  savedEmpires: SavedEmpireSummary[];

  // Active persistent empire & mode
  activeSave: SaveFile | null;
  playMode: PlayMode;
  activeBiome: TerrainSkin;
  activeMusic: MusicTrackId;
  musicEnabled: boolean;
  sfxEnabled: boolean;
  showGrid: boolean;
  activeModal: ActiveModal;
  systemsTab: "goals" | "market" | "storage" | "graveyard" | "specials";

  // Interactive tools
  placingItemId: number | null;
  movingEntityUid: number | null;
  castingMagicId: number | null;
  selectedUids: number[];
  selectedSummary: SelectedEntitySummary | null;
  hoveredTile: { tx: number; ty: number } | null;

  // Live HUD state
  resources: VillageResources;
  expansions: number[];
  battleStatus: BattleStatus | null;
  metrics: RendererMetrics;

  setLocale: (locale: Locale) => void;
  setToast: (msg: string | null) => void;
  setActiveModal: (modal: ActiveModal) => void;
  setSystemsTab: (tab: GameStoreState["systemsTab"]) => void;
  setPlacingItemId: (id: number | null) => void;
  setMovingEntityUid: (uid: number | null) => void;
  setCastingMagicId: (id: number | null) => void;
  setActiveBiome: (biome: TerrainSkin) => void;
  setActiveMusic: (track: MusicTrackId) => void;
  setMusicEnabled: (enabled: boolean) => void;
  setSfxEnabled: (enabled: boolean) => void;
  setShowGrid: (show: boolean) => void;
  setHoveredTile: (tile: { tx: number; ty: number } | null) => void;
  setMetrics: (metrics: RendererMetrics) => void;
  setSelection: (uids: number[], summary: SelectedEntitySummary | null) => void;
  setBattleStatus: (status: BattleStatus | null) => void;
  setActiveSave: (save: SaveFile) => void;
  setPlayMode: (mode: PlayMode) => void;
  refreshSavedEmpires: () => Promise<void>;
  bootstrapCatalogs: () => Promise<SaveFile | null>;
}

const SKIN_INDEX_TO_BIOME: TerrainSkin[] = [
  "terreno",
  "terrenodesierto",
  "terrenohielo",
  "terrenomar2",
  "terrenomineral",
  "terrenonubes",
  "terrenoselva",
  "islandbigboss3"
];

export function computeResourcesFromSave(
  save: SaveFile,
  itemsById: ReadonlyMap<number, GameItem>
): { resources: VillageResources; expansions: number[]; biome: TerrainSkin } {
  const map0 = save.maps[0];
  if (!map0) {
    return {
      resources: { coins: 0, wood: 0, stone: 0, food: 0, cash: 0, mana: 0, level: 1, xp: 0, population: 0, maxPopulation: 10 },
      expansions: [13],
      biome: "terreno"
    };
  }
  let popUsed = 0;
  let popMax = 10 + (map0.increasedPopulation ?? 0);
  for (const tuple of map0.items) {
    const def = itemsById.get(tuple[0]);
    if (!def) continue;
    if (def.type === "u") popUsed += Math.max(0, def.population);
    else if (def.population > 0) popMax += def.population;
  }
  return {
    resources: {
      coins: map0.coins,
      wood: map0.wood,
      stone: map0.stone,
      food: map0.food,
      cash: save.playerInfo.cash ?? 0,
      mana: Number(save.privateState.mana ?? 25),
      level: map0.level,
      xp: map0.xp,
      population: popUsed,
      maxPopulation: popMax
    },
    expansions: map0.expansions.length > 0 ? map0.expansions : [13],
    biome: SKIN_INDEX_TO_BIOME[map0.skin] ?? "terreno"
  };
}

export const useGameStore = create<GameStoreState>((set, get) => ({
  locale: "es",
  loading: true,
  error: null,
  toast: null,

  items: [],
  itemsById: new Map(),
  magics: [],
  goals: [],
  behaviorsById: new Map(),
  collections: {},
  localizationEn: {},
  localizationEs: {},
  availableMaps: [],
  savedEmpires: [],

  activeSave: null,
  playMode: "village",
  activeBiome: "terreno",
  activeMusic: "village",
  musicEnabled: true,
  sfxEnabled: true,
  showGrid: false,
  activeModal: null,
  systemsTab: "goals",

  placingItemId: null,
  movingEntityUid: null,
  castingMagicId: null,
  selectedUids: [],
  selectedSummary: null,
  hoveredTile: null,

  resources: { coins: 0, wood: 0, stone: 0, food: 0, cash: 0, mana: 25, level: 1, xp: 0, population: 0, maxPopulation: 10 },
  expansions: [13],
  battleStatus: null,
  metrics: {
    fps: 0,
    frameTimeMs: 0,
    p95FrameMs: 0,
    cpuTimeMs: 0,
    visibleEntities: 0,
    totalEntities: 0,
    loadedAtlases: 0,
    rendererType: "initializing"
  },

  setLocale: (locale) => set({ locale }),
  setToast: (toast) => set({ toast }),
  setActiveModal: (activeModal) => set({ activeModal }),
  setSystemsTab: (systemsTab) => set({ systemsTab }),
  setPlacingItemId: (placingItemId) => set({ placingItemId, castingMagicId: null, movingEntityUid: null }),
  setMovingEntityUid: (movingEntityUid) => set({ movingEntityUid, placingItemId: null, castingMagicId: null }),
  setCastingMagicId: (castingMagicId) => set({ castingMagicId, placingItemId: null, movingEntityUid: null }),
  setActiveBiome: (activeBiome) => set({ activeBiome }),
  setActiveMusic: (activeMusic) => set({ activeMusic }),
  setMusicEnabled: (musicEnabled) => set({ musicEnabled }),
  setSfxEnabled: (sfxEnabled) => set({ sfxEnabled }),
  setShowGrid: (showGrid) => set({ showGrid }),
  setHoveredTile: (hoveredTile) => set({ hoveredTile }),
  setMetrics: (metrics) => set({ metrics }),
  setSelection: (selectedUids, selectedSummary) => set({ selectedUids, selectedSummary }),
  setBattleStatus: (battleStatus) => set({ battleStatus }),
  setPlayMode: (playMode) => set({ playMode }),

  setActiveSave: (save) => {
    const computed = computeResourcesFromSave(save, get().itemsById);
    set({
      activeSave: save,
      resources: computed.resources,
      expansions: computed.expansions,
      activeBiome: computed.biome
    });
  },

  refreshSavedEmpires: async () => {
    const players = await gameApi.listSaves();
    set({ savedEmpires: players });
  },

  bootstrapCatalogs: async () => {
    set({ loading: true, error: null });
    try {
      const bundle = await gameApi.fetchCatalogBundle();
      const itemsById = new Map<number, GameItem>();
      for (const it of bundle.items) itemsById.set(it.id, it);

      const behaviorsById = new Map<number, UnitBehaviorProfile>();
      for (const [k, v] of Object.entries(bundle.behaviors)) behaviorsById.set(Number(k), v);

      set({
        items: bundle.items,
        itemsById,
        magics: bundle.magics,
        goals: bundle.goals,
        behaviorsById,
        availableMaps: bundle.maps,
        collections: bundle.collections,
        localizationEn: bundle.localizationEn,
        localizationEs: bundle.localizationEs,
        savedEmpires: bundle.saves
      });

      // Load most recent saved empire or auto-create classic empire on first launch
      let activeSave: SaveFile | null = null;
      if (bundle.saves.length > 0) {
        activeSave = await gameApi.loadSave(bundle.saves[0]!.pid);
      }
      if (!activeSave) {
        activeSave = await gameApi.createSave("Imperio Clásico");
        if (activeSave) {
          await get().refreshSavedEmpires();
        }
      }

      if (activeSave) {
        // Ensure starting player has mana to try magic spells right away if unset
        if (activeSave.privateState.mana === undefined) {
          activeSave.privateState.mana = 30;
        }
        get().setActiveSave(activeSave);
      }

      set({ loading: false });
      return activeSave;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), loading: false });
      return null;
    }
  }
}));
