import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  CommandBatchRequestSchema,
  SaveFileSchema,
  type CommandBatchResponse,
  type GameItem,
  type SaveFile
} from "@sef/shared-types";
import { applyCommand, type CommandExecutionContext, type CommandSideEvent, type LevelTableEntry } from "@sef/engine-sim";
import { SaveRepository } from "./db/SaveRepository.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "../../..");

export interface ServerOptions {
  assetsDir?: string;
  gameDataDir?: string;
  dbPath?: string;
}

function readJsonSafe<T = unknown>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
}

function listMapKeys(mapsDir: string): { key: string; category: string; label: string }[] {
  if (!fs.existsSync(mapsDir)) return [];
  const entries: { key: string; category: string; label: string }[] = [];

  for (const fn of fs.readdirSync(mapsDir).sort()) {
    if (!fn.endsWith(".json")) continue;
    const stem = fn.replace(/\.json$/, "");
    entries.push({ key: stem, category: "village", label: stem });
  }
  const friendDir = path.join(mapsDir, "friend_static");
  if (fs.existsSync(friendDir)) {
    for (const fn of fs.readdirSync(friendDir).sort()) {
      if (!fn.endsWith(".json")) continue;
      const stem = fn.replace(/\.save\.json$/, "").replace(/\.json$/, "");
      entries.push({ key: `friend/${stem}`, category: "friend", label: `Amigo: ${stem}` });
    }
  }
  const questsDir = path.join(mapsDir, "quests");
  if (fs.existsSync(questsDir)) {
    for (const fn of fs.readdirSync(questsDir).sort()) {
      if (!fn.endsWith(".json")) continue;
      const stem = fn.replace(/\.save\.json$/, "").replace(/\.json$/, "");
      entries.push({ key: `quest/${stem}`, category: "quest", label: `Quest ${stem}` });
    }
  }
  return entries;
}

function resolveMapFile(mapsDir: string, mapKey: string): string | null {
  if (mapKey.includes("..") || mapKey.startsWith("/")) return null;
  const candidates = [
    path.join(mapsDir, `${mapKey}.json`),
    path.join(mapsDir, `${mapKey}.save.json`)
  ];
  if (mapKey.startsWith("quest/")) {
    const id = mapKey.slice("quest/".length);
    candidates.unshift(
      path.join(mapsDir, "quests_1407", `${id}.save.json`),
      path.join(mapsDir, "quests", `${id}.save.json`),
      path.join(mapsDir, "quests", `${id}.json`)
    );
  } else if (mapKey.startsWith("friend/")) {
    const id = mapKey.slice("friend/".length);
    candidates.unshift(
      path.join(mapsDir, "friend_static", `${id}.save.json`),
      path.join(mapsDir, "friend_static", `${id}.json`)
    );
  }
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

export async function createServer(options: ServerOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });

  const assetsDir = options.assetsDir ?? path.join(REPO_ROOT, "assets", "generated");
  const gameDataDir = options.gameDataDir ?? path.join(REPO_ROOT, "packages", "game-data", "data");
  const mapsDir = path.join(gameDataDir, "maps");
  const dbPath = options.dbPath ?? path.join(REPO_ROOT, "data", "social-empires-forge.db");

  const saveRepo = new SaveRepository(dbPath);
  app.addHook("onClose", async () => {
    saveRepo.close();
  });

  // Preload static compiled game tables into memory for zero-latency authoritative command checks
  const itemsList = readJsonSafe<GameItem[]>(path.join(gameDataDir, "items.json")) ?? [];
  const itemsById = new Map<number, GameItem>();
  for (const it of itemsList) itemsById.set(it.id, it);
  const levels = readJsonSafe<LevelTableEntry[]>(
    path.join(gameDataDir, "levels.json")
  ) ?? [];
  const expansionPrices = readJsonSafe<{ coins?: number | string; cash?: number | string; level?: number | string }[]>(
    path.join(gameDataDir, "expansion_prices.json")
  ) ?? [];
  const globals = readJsonSafe<Record<string, unknown>>(path.join(gameDataDir, "globals.json")) ?? {};

  const getInitialTemplate = (): SaveFile => {
    const raw = readJsonSafe(path.join(mapsDir, "initial1407.json"));
    if (!raw) throw new Error("Missing compiled initial1407.json template");
    return SaveFileSchema.parse(raw);
  };

  const EMPTY_PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64"
  );

  app.get<{ Params: { filename: string } }>("/assets/ui/thumbs/:filename", async (req, reply) => {
    const raw = path.basename(req.params.filename);
    const stem = raw.replace(/\.(jpg|jpeg|png|webp)$/i, "");
    const thumbsDir = path.join(assetsDir, "ui", "thumbs");
    for (const ext of [".jpg", ".png", ".jpeg", ".webp"]) {
      const candidate = path.join(thumbsDir, `${stem}${ext}`);
      if (fs.existsSync(candidate)) {
        const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
        return reply.type(mime).send(fs.readFileSync(candidate));
      }
    }
    return reply.type("image/png").send(EMPTY_PNG);
  });

  if (fs.existsSync(assetsDir)) {
    await app.register(fastifyStatic, {
      root: assetsDir,
      prefix: "/assets/",
      decorateReply: false
    });
  }

  const webDistDir = path.join(REPO_ROOT, "apps", "web", "dist");
  if (fs.existsSync(webDistDir)) {
    await app.register(fastifyStatic, {
      root: webDistDir,
      prefix: "/",
      decorateReply: false
    });
  }

  app.get("/api/health", async () => ({
    status: "ok",
    game: "Social Empires Forge",
    targetVersion: "1.4.07",
    serverTime: Math.floor(Date.now() / 1000)
  }));

  // --- Static Game Data API ---
  const jsonRoutes: [string, string][] = [
    ["/api/game-data/metadata", "metadata.json"],
    ["/api/game-data/items", "items.json"],
    ["/api/game-data/magics", "magics.json"],
    ["/api/game-data/goals", "goals.json"],
    ["/api/game-data/globals", "globals.json"],
    ["/api/game-data/levels", "levels.json"],
    ["/api/game-data/expansion-prices", "expansion_prices.json"],
    ["/api/game-data/collections", "collections.json"],
    ["/api/game-data/missions", "missions.json"],
    ["/api/game-data/behaviors", "unit_behaviors.json"]
  ];

  for (const [route, filename] of jsonRoutes) {
    app.get(route, async (_req, reply) => {
      const data = readJsonSafe(path.join(gameDataDir, filename));
      if (!data) return reply.code(404).send({ error: `${filename} not compiled yet` });
      return data;
    });
  }

  app.get<{ Params: { locale: string } }>("/api/game-data/localization/:locale", async (req, reply) => {
    const loc = req.params.locale === "es" ? "localization_es.json" : "localization_en.json";
    const data = readJsonSafe(path.join(gameDataDir, loc));
    if (!data) return reply.code(404).send({ error: "localization not compiled yet" });
    return data;
  });

  // --- Maps & Quests API ---
  app.get("/api/maps", async () => ({
    maps: listMapKeys(mapsDir)
  }));

  app.get<{ Params: { "*": string } }>("/api/maps/*", async (req, reply) => {
    const mapKey = req.params["*"];
    const resolved = resolveMapFile(mapsDir, mapKey);
    if (!resolved) return reply.code(404).send({ error: `Map not found: ${mapKey}` });
    return readJsonSafe(resolved);
  });

  // --- Persistent Empires & Saves API (SQLite WAL + .save.json compat) ---
  app.get("/api/saves", async () => ({
    players: saveRepo.listPlayers()
  }));

  app.post<{ Body: { name?: string } }>("/api/saves", async (req) => {
    const name = req.body?.name ?? "Imperio Clásico";
    const created = saveRepo.createNewEmpire(name, getInitialTemplate());
    return { save: created };
  });

  app.get<{ Params: { pid: string } }>("/api/saves/:pid", async (req, reply) => {
    const save = saveRepo.getSave(req.params.pid);
    if (!save) return reply.code(404).send({ error: "Empire save not found" });
    return { save };
  });

  app.post("/api/saves/import", async (req, reply) => {
    try {
      const imported = saveRepo.importSave(req.body);
      return { save: imported };
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : "Invalid save file" });
    }
  });

  app.get<{ Params: { pid: string } }>("/api/saves/:pid/export", async (req, reply) => {
    const save = saveRepo.getSave(req.params.pid);
    if (!save) return reply.code(404).send({ error: "Empire save not found" });
    reply.header("Content-Disposition", `attachment; filename="${save.playerInfo.pid}.save.json"`);
    return save;
  });

  // --- Authoritative Idempotent Command Batch API (PR #48 safe saves + deduplication) ---
  app.post("/api/commands", async (req, reply) => {
    const parsed = CommandBatchRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const batch = parsed.data;
    const nowSec = Math.floor(Date.now() / 1000);

    // PR #48 idempotency: if packetId was already processed, replay exact cached response
    const cached = saveRepo.getCachedPacketResponse(batch.pid, batch.packetId);
    if (cached) {
      const latestSave = saveRepo.getSave(batch.pid);
      return { ...cached, replayed: true, save: latestSave, events: [] };
    }

    const save = saveRepo.getSave(batch.pid);
    if (!save) {
      return reply.code(404).send({ error: `Unknown empire pid: ${batch.pid}` });
    }

    const ctx: CommandExecutionContext = {
      itemsById,
      levels,
      expansionPrices,
      globals,
      nowSec,
      adminMode: batch.adminMode
    };

    const allEvents: CommandSideEvent[] = [];
    let appliedCount = 0;
    let firstError: string | undefined;

    for (const cmdPayload of batch.commands) {
      const res = applyCommand(save, cmdPayload, ctx);
      if (!res.ok) {
        firstError = res.error ?? `Command ${cmdPayload.cmd} failed`;
        break;
      }
      appliedCount += 1;
      allEvents.push(...res.events);
    }

    // PR #48 fix: persist successfully applied state even if a later command in batch desynced
    if (appliedCount > 0) {
      save.playerInfo.last_logged_in = nowSec;
      saveRepo.save(save, false);
    }

    const response: CommandBatchResponse = {
      result: firstError ? "desync" : "ok",
      packetId: batch.packetId,
      replayed: false,
      appliedCount,
      error: firstError,
      serverTime: nowSec
    };

    saveRepo.recordPacketResponse(batch.pid, batch.packetId, response);
    return { ...response, save, events: allEvents };
  });

  // --- PvP Matchmaking & Ranking API ---
  app.get<{ Params: { pid: string } }>("/api/pvp/match/:pid", async (req) => {
    const others = saveRepo.listPlayers().filter((p) => p.pid !== req.params.pid);
    if (others.length > 0) {
      const pick = others[Math.floor(Math.random() * others.length)]!;
      const enemySave = saveRepo.getSave(pick.pid);
      if (enemySave) return { source: "local_player", save: enemySave };
    }
    const fallbackFile = resolveMapFile(mapsDir, "friend/AcidCaos") ?? resolveMapFile(mapsDir, "Arthur30");
    const fallbackSave = fallbackFile ? readJsonSafe(fallbackFile) : null;
    return { source: "static_rival", save: fallbackSave };
  });

  app.get("/api/pvp/ranking", async () => {
    const players = saveRepo.listPlayers().map((p) => {
      const s = saveRepo.getSave(p.pid);
      return {
        pid: p.pid,
        name: p.name,
        level: p.level,
        wins: s?.playerInfo.attacks_won ?? 0,
        losses: s?.playerInfo.attacks_lost ?? 0
      };
    });
    players.sort((a, b) => b.wins - a.wins || b.level - a.level);
    return { ranking: players };
  });

  return app;
}

function isMainEntrypoint(): boolean {
  if (!process.argv[1]) return false;
  const argPath = path.resolve(process.argv[1]);
  const selfPath = path.resolve(fileURLToPath(import.meta.url));
  return process.platform === "win32"
    ? argPath.toLowerCase() === selfPath.toLowerCase()
    : argPath === selfPath;
}

if (isMainEntrypoint()) {
  const port = Number(process.env.PORT ?? 5050);
  const host = process.env.HOST ?? "127.0.0.1";
  createServer()
    .then((app) => app.listen({ port, host }))
    .then((address) => {
      console.log(`[sef-server] Listening at ${address}`);
    })
    .catch((err) => {
      console.error("[sef-server] Fatal startup error:", err);
      process.exit(1);
    });
}
