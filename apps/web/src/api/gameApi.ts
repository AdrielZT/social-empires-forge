import {
  SaveFileSchema,
  type CommandBatchResponse,
  type CommandPayload,
  type GameItem,
  type GoalDef,
  type LevelDef,
  type MagicSpellDef,
  type SaveFile
} from "@sef/shared-types";
import {
  applyCommand,
  type CommandExecutionContext,
  type CommandSideEvent,
  type UnitBehaviorProfile
} from "@sef/engine-sim";
import { IS_STATIC_MODE, dataUrl } from "./paths.js";

export interface ApiMapListEntry {
  key: string;
  category: string;
  label: string;
  file?: string;
}

export interface ApiSavedEmpireSummary {
  pid: string;
  name: string;
  level: number;
  coins: number;
  cash: number;
  updatedAt: number;
}

export interface ApiRankingEntry {
  pid: string;
  name: string;
  level: number;
  wins: number;
  losses: number;
}

export interface CatalogBundle {
  items: GameItem[];
  magics: MagicSpellDef[];
  goals: GoalDef[];
  levels: LevelDef[];
  globals: Record<string, unknown>;
  behaviors: Record<string, UnitBehaviorProfile>;
  maps: ApiMapListEntry[];
  collections: Record<string, unknown>;
  localizationEn: Record<string, string>;
  localizationEs: Record<string, string>;
  saves: ApiSavedEmpireSummary[];
}

export interface ExecuteCommandsResult extends CommandBatchResponse {
  save?: SaveFile;
  events: CommandSideEvent[];
}

interface StoredEmpireRecord {
  pid: string;
  name: string;
  level: number;
  coins: number;
  cash: number;
  updatedAt: number;
  save: SaveFile;
}

interface StoredPacketRecord {
  key: string;
  response: CommandBatchResponse;
  createdAt: number;
}

const IDB_NAME = "social-empires-forge";
const IDB_VERSION = 1;
const STORE_EMPIRES = "empires";
const STORE_PACKETS = "packets";
const LS_FALLBACK_KEY = "sef_empires_v1";

// Cached static tables for in-browser deterministic command execution
let cachedItemsById: Map<number, GameItem> = new Map();
let cachedLevels: LevelDef[] = [];
let cachedExpansionPrices: { coins?: number | string; cash?: number | string; level?: number | string }[] = [];
let cachedGlobals: Record<string, unknown> = {};
let cachedInitialTemplate: SaveFile | null = null;
let cachedMapsByKey: Map<string, ApiMapListEntry> = new Map();

let dbPromise: Promise<IDBDatabase | null> | null = null;
const memoryPackets = new Map<string, CommandBatchResponse>();

function randomHex(byteCount: number): string {
  const bytes = new Uint8Array(byteCount);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < byteCount; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  if (typeof indexedDB === "undefined") {
    dbPromise = Promise.resolve(null);
    return dbPromise;
  }
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_EMPIRES)) {
          db.createObjectStore(STORE_EMPIRES, { keyPath: "pid" });
        }
        if (!db.objectStoreNames.contains(STORE_PACKETS)) {
          db.createObjectStore(STORE_PACKETS, { keyPath: "key" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function lsReadAll(): Record<string, StoredEmpireRecord> {
  try {
    const raw = localStorage.getItem(LS_FALLBACK_KEY);
    return raw ? (JSON.parse(raw) as Record<string, StoredEmpireRecord>) : {};
  } catch {
    return {};
  }
}

function lsWriteAll(records: Record<string, StoredEmpireRecord>): void {
  try {
    localStorage.setItem(LS_FALLBACK_KEY, JSON.stringify(records));
  } catch {
    // Ignore storage quota errors in restricted browsing modes
  }
}

function toRecord(save: SaveFile): StoredEmpireRecord {
  const map0 = save.maps[0];
  return {
    pid: String(save.playerInfo.pid),
    name: save.playerInfo.name,
    level: map0?.level ?? 1,
    coins: map0?.coins ?? 0,
    cash: save.playerInfo.cash ?? 0,
    updatedAt: Math.floor(Date.now() / 1000),
    save
  };
}

function toSummary(rec: StoredEmpireRecord): ApiSavedEmpireSummary {
  return {
    pid: rec.pid,
    name: rec.name,
    level: rec.level,
    coins: rec.coins,
    cash: rec.cash,
    updatedAt: rec.updatedAt
  };
}

async function idbGetAllEmpires(): Promise<StoredEmpireRecord[]> {
  const db = await openDb();
  if (!db) {
    return Object.values(lsReadAll()).sort((a, b) => b.updatedAt - a.updatedAt);
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_EMPIRES, "readonly");
    const req = tx.objectStore(STORE_EMPIRES).getAll();
    req.onsuccess = () => {
      const list = (req.result as StoredEmpireRecord[]).sort((a, b) => b.updatedAt - a.updatedAt);
      resolve(list);
    };
    req.onerror = () => reject(req.error);
  });
}

async function idbGetEmpire(pid: string): Promise<SaveFile | null> {
  const db = await openDb();
  if (!db) {
    const rec = lsReadAll()[pid];
    return rec ? SaveFileSchema.parse(rec.save) : null;
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_EMPIRES, "readonly");
    const req = tx.objectStore(STORE_EMPIRES).get(pid);
    req.onsuccess = () => {
      const rec = req.result as StoredEmpireRecord | undefined;
      if (!rec) {
        resolve(null);
        return;
      }
      try {
        resolve(SaveFileSchema.parse(rec.save));
      } catch {
        resolve(null);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

async function idbPutEmpire(save: SaveFile): Promise<void> {
  const rec = toRecord(save);
  const db = await openDb();
  if (!db) {
    const all = lsReadAll();
    all[rec.pid] = rec;
    lsWriteAll(all);
    return;
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_EMPIRES, "readwrite");
    tx.objectStore(STORE_EMPIRES).put(rec);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGetPacket(pid: string, packetId: string): Promise<CommandBatchResponse | null> {
  const key = `${pid}::${packetId}`;
  const mem = memoryPackets.get(key);
  if (mem) return mem;
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_PACKETS, "readonly");
    const req = tx.objectStore(STORE_PACKETS).get(key);
    req.onsuccess = () => {
      const rec = req.result as StoredPacketRecord | undefined;
      resolve(rec ? rec.response : null);
    };
    req.onerror = () => resolve(null);
  });
}

async function idbPutPacket(pid: string, packetId: string, response: CommandBatchResponse): Promise<void> {
  const key = `${pid}::${packetId}`;
  memoryPackets.set(key, response);
  if (memoryPackets.size > 250) {
    const oldest = memoryPackets.keys().next().value;
    if (oldest) memoryPackets.delete(oldest);
  }
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_PACKETS, "readwrite");
    const rec: StoredPacketRecord = { key, response, createdAt: Math.floor(Date.now() / 1000) };
    tx.objectStore(STORE_PACKETS).put(rec);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

async function fetchJsonOptional<T>(url: string, fallback: T): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) return fallback;
  return (await res.json()) as T;
}

async function ensureStaticTemplate(): Promise<SaveFile> {
  if (cachedInitialTemplate) return cachedInitialTemplate;
  const res = await fetch(dataUrl("maps/initial1407.json"));
  if (!res.ok) throw new Error(`HTTP ${res.status} loading initial1407.json`);
  cachedInitialTemplate = SaveFileSchema.parse(await res.json());
  return cachedInitialTemplate;
}

export const gameApi = {
  isStaticMode: IS_STATIC_MODE,

  async fetchCatalogBundle(): Promise<CatalogBundle> {
    if (!IS_STATIC_MODE) {
      const [
        itemsRes,
        magicsRes,
        goalsRes,
        levelsRes,
        globalsRes,
        behaviorsRes,
        mapsRes,
        colRes,
        locEnRes,
        locEsRes,
        savesRes
      ] = await Promise.all([
        fetch("/api/game-data/items"),
        fetch("/api/game-data/magics"),
        fetch("/api/game-data/goals"),
        fetch("/api/game-data/levels"),
        fetch("/api/game-data/globals"),
        fetch("/api/game-data/behaviors"),
        fetch("/api/maps"),
        fetch("/api/game-data/collections"),
        fetch("/api/game-data/localization/en"),
        fetch("/api/game-data/localization/es"),
        fetch("/api/saves")
      ]);

      if (!itemsRes.ok) throw new Error(`HTTP ${itemsRes.status} loading items`);
      const items = (await itemsRes.json()) as GameItem[];
      const magics = magicsRes.ok ? ((await magicsRes.json()) as MagicSpellDef[]) : [];
      const goals = goalsRes.ok ? ((await goalsRes.json()) as GoalDef[]) : [];
      const levels = levelsRes.ok ? ((await levelsRes.json()) as LevelDef[]) : [];
      const globals = globalsRes.ok ? ((await globalsRes.json()) as Record<string, unknown>) : {};
      const behaviors = behaviorsRes.ok ? ((await behaviorsRes.json()) as Record<string, UnitBehaviorProfile>) : {};
      const mapsData = mapsRes.ok ? ((await mapsRes.json()) as { maps: ApiMapListEntry[] }) : { maps: [] };
      const collections = colRes.ok ? ((await colRes.json()) as Record<string, unknown>) : {};
      const localizationEn = locEnRes.ok ? ((await locEnRes.json()) as Record<string, string>) : {};
      const localizationEs = locEsRes.ok ? ((await locEsRes.json()) as Record<string, string>) : {};
      const savesData = savesRes.ok ? ((await savesRes.json()) as { players: ApiSavedEmpireSummary[] }) : { players: [] };

      return {
        items,
        magics,
        goals,
        levels,
        globals,
        behaviors,
        maps: mapsData.maps,
        collections,
        localizationEn,
        localizationEs,
        saves: savesData.players
      };
    }

    const [
      itemsRes,
      magics,
      goals,
      behaviors,
      mapsPayload,
      collections,
      localizationEn,
      localizationEs,
      levels,
      expansionPrices,
      globals,
      templateRaw,
      storedEmpires
    ] = await Promise.all([
      fetch(dataUrl("items.json")),
      fetchJsonOptional<MagicSpellDef[]>(dataUrl("magics.json"), []),
      fetchJsonOptional<GoalDef[]>(dataUrl("goals.json"), []),
      fetchJsonOptional<Record<string, UnitBehaviorProfile>>(dataUrl("unit_behaviors.json"), {}),
      fetchJsonOptional<{ maps: ApiMapListEntry[] }>(dataUrl("maps-index.json"), { maps: [] }),
      fetchJsonOptional<Record<string, unknown>>(dataUrl("collections.json"), {}),
      fetchJsonOptional<Record<string, string>>(dataUrl("localization_en.json"), {}),
      fetchJsonOptional<Record<string, string>>(dataUrl("localization_es.json"), {}),
      fetchJsonOptional<LevelDef[]>(dataUrl("levels.json"), []),
      fetchJsonOptional<{ coins?: number | string; cash?: number | string; level?: number | string }[]>(
        dataUrl("expansion_prices.json"),
        []
      ),
      fetchJsonOptional<Record<string, unknown>>(dataUrl("globals.json"), {}),
      fetchJsonOptional<unknown>(dataUrl("maps/initial1407.json"), null),
      idbGetAllEmpires()
    ]);

    if (!itemsRes.ok) throw new Error(`HTTP ${itemsRes.status} loading static items.json`);
    const items = (await itemsRes.json()) as GameItem[];

    cachedItemsById = new Map(items.map((it) => [it.id, it]));
    cachedLevels = levels;
    cachedExpansionPrices = expansionPrices;
    cachedGlobals = globals;
    if (templateRaw) {
      cachedInitialTemplate = SaveFileSchema.parse(templateRaw);
    }
    cachedMapsByKey = new Map(mapsPayload.maps.map((m) => [m.key, m]));

    return {
      items,
      magics,
      goals,
      levels,
      globals,
      behaviors,
      maps: mapsPayload.maps,
      collections,
      localizationEn,
      localizationEs,
      saves: storedEmpires.map(toSummary)
    };
  },

  async listSaves(): Promise<ApiSavedEmpireSummary[]> {
    if (!IS_STATIC_MODE) {
      const res = await fetch("/api/saves");
      if (!res.ok) return [];
      const data = (await res.json()) as { players: ApiSavedEmpireSummary[] };
      return data.players;
    }
    return (await idbGetAllEmpires()).map(toSummary);
  },

  async createSave(name: string): Promise<SaveFile | null> {
    if (!IS_STATIC_MODE) {
      const res = await fetch("/api/saves", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name })
      });
      if (!res.ok) return null;
      return ((await res.json()) as { save: SaveFile }).save;
    }

    const template = await ensureStaticTemplate();
    const pid = `emp_${randomHex(6)}`;
    const now = Math.floor(Date.now() / 1000);
    const cloned = structuredClone(template);
    cloned.playerInfo.pid = pid;
    cloned.playerInfo.name = name.trim() || "Imperio Clásico";
    cloned.playerInfo.last_logged_in = now;
    if (cloned.maps[0]) {
      cloned.maps[0].timestamp = now;
    }
    await idbPutEmpire(cloned);
    return cloned;
  },

  async loadSave(pid: string): Promise<SaveFile | null> {
    if (!IS_STATIC_MODE) {
      const res = await fetch(`/api/saves/${encodeURIComponent(pid)}`);
      if (!res.ok) return null;
      return ((await res.json()) as { save: SaveFile }).save;
    }
    return idbGetEmpire(pid);
  },

  async importSave(rawJsonText: string): Promise<SaveFile | null> {
    if (!IS_STATIC_MODE) {
      const res = await fetch("/api/saves/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: rawJsonText
      });
      if (!res.ok) return null;
      return ((await res.json()) as { save: SaveFile }).save;
    }

    const parsed = SaveFileSchema.parse(JSON.parse(rawJsonText));
    if (!parsed.playerInfo.pid || parsed.playerInfo.pid === "0") {
      parsed.playerInfo.pid = `imp_${randomHex(6)}`;
    }
    await idbPutEmpire(parsed);
    return parsed;
  },

  exportSaveDownload(save: SaveFile): void {
    const blob = new Blob([JSON.stringify(save, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${save.playerInfo.pid}.save.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  },

  async executeCommands(
    pid: string,
    packetId: string,
    commands: CommandPayload[],
    adminMode = false
  ): Promise<ExecuteCommandsResult | null> {
    if (!IS_STATIC_MODE) {
      const res = await fetch("/api/commands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pid,
          packetId,
          tries: 1,
          timestamp: Math.floor(Date.now() / 1000),
          adminMode,
          commands
        })
      });
      if (!res.ok) return null;
      return (await res.json()) as ExecuteCommandsResult;
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const cached = await idbGetPacket(pid, packetId);
    if (cached) {
      const latestSave = (await idbGetEmpire(pid)) ?? undefined;
      return { ...cached, replayed: true, save: latestSave, events: [] };
    }

    const save = await idbGetEmpire(pid);
    if (!save) return null;

    const ctx: CommandExecutionContext = {
      itemsById: cachedItemsById,
      levels: cachedLevels,
      expansionPrices: cachedExpansionPrices,
      globals: cachedGlobals,
      nowSec,
      adminMode
    };

    const allEvents: CommandSideEvent[] = [];
    let appliedCount = 0;
    let firstError: string | undefined;

    for (const cmdPayload of commands) {
      const res = applyCommand(save, cmdPayload, ctx);
      if (!res.ok) {
        firstError = res.error ?? `Command ${cmdPayload.cmd} failed`;
        break;
      }
      appliedCount += 1;
      allEvents.push(...res.events);
    }

    if (appliedCount > 0) {
      save.playerInfo.last_logged_in = nowSec;
      await idbPutEmpire(save);
    }

    const response: CommandBatchResponse = {
      result: firstError ? "desync" : "ok",
      packetId,
      replayed: false,
      appliedCount,
      error: firstError,
      serverTime: nowSec
    };

    await idbPutPacket(pid, packetId, response);
    return { ...response, save, events: allEvents };
  },

  async fetchMap(mapKey: string): Promise<SaveFile | null> {
    if (!IS_STATIC_MODE) {
      const res = await fetch(`/api/maps/${mapKey}`);
      if (!res.ok) return null;
      return (await res.json()) as SaveFile;
    }

    if (mapKey.includes("..") || mapKey.startsWith("/")) return null;
    const entry = cachedMapsByKey.get(mapKey);
    const candidates: string[] = [];
    if (entry?.file) {
      candidates.push(entry.file);
    }
    if (mapKey.startsWith("quest/")) {
      const id = mapKey.slice("quest/".length);
      candidates.push(`maps/quests_1407/${id}.save.json`, `maps/quests/${id}.save.json`, `maps/quests/${id}.json`);
    } else if (mapKey.startsWith("friend/")) {
      const id = mapKey.slice("friend/".length);
      candidates.push(`maps/friend_static/${id}.save.json`, `maps/friend_static/${id}.json`);
    } else {
      candidates.push(`maps/${mapKey}.json`, `maps/${mapKey}.save.json`);
    }

    const tried = new Set<string>();
    for (const rel of candidates) {
      if (tried.has(rel)) continue;
      tried.add(rel);
      const res = await fetch(dataUrl(rel));
      if (res.ok) {
        return (await res.json()) as SaveFile;
      }
    }
    return null;
  },

  async fetchPvpMatch(pid: string): Promise<SaveFile | null> {
    if (!IS_STATIC_MODE) {
      const res = await fetch(`/api/pvp/match/${encodeURIComponent(pid)}`);
      if (!res.ok) return null;
      return ((await res.json()) as { save: SaveFile | null }).save;
    }

    const others = (await idbGetAllEmpires()).filter((e) => e.pid !== pid);
    if (others.length > 0) {
      const pick = others[Math.floor(Math.random() * others.length)]!;
      return SaveFileSchema.parse(pick.save);
    }
    return (await this.fetchMap("friend/AcidCaos")) ?? (await this.fetchMap("Arthur30"));
  },

  async fetchPvpRanking(): Promise<ApiRankingEntry[]> {
    if (!IS_STATIC_MODE) {
      const res = await fetch("/api/pvp/ranking");
      if (!res.ok) return [];
      const data = (await res.json()) as { ranking?: ApiRankingEntry[] };
      return data.ranking ?? [];
    }

    const records = await idbGetAllEmpires();
    const ranking: ApiRankingEntry[] = records.map((r) => ({
      pid: r.pid,
      name: r.name,
      level: r.level,
      wins: r.save.playerInfo.attacks_won ?? 0,
      losses: r.save.playerInfo.attacks_lost ?? 0
    }));
    ranking.sort((a, b) => b.wins - a.wins || b.level - a.level);
    return ranking;
  }
};
