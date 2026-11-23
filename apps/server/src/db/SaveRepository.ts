import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { SaveFileSchema, type CommandBatchResponse, type SaveFile } from "@sef/shared-types";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as { DatabaseSync: typeof DatabaseSyncType };

export interface PlayerSummary {
  pid: string;
  name: string;
  level: number;
  coins: number;
  cash: number;
  updatedAt: number;
}

const BACKUP_INTERVAL_SEC = 600; // 10 minutes (PR #48 policy)
const MAX_BACKUPS_PER_PLAYER = 30;

/**
 * Crash-safe SQLite (WAL mode) persistence repository for Social Empires Forge:
 * - Atomic save transactions (eliminates mid-write save corruption from PR #48).
 * - Rolling automatic backups (max 1 per 10 min, 30 retained per player).
 * - Idempotent packet deduplication cache (`packet_log`) so retried batches never double-apply.
 * - Direct .save.json import/export compatibility with AcidCaos/socialemperors saves.
 */
export class SaveRepository {
  private readonly db: DatabaseSyncType;

  constructor(dbPath: string) {
    if (dbPath !== ":memory:") {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS players (
        pid TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        level INTEGER NOT NULL DEFAULT 1,
        coins REAL NOT NULL DEFAULT 0,
        cash REAL NOT NULL DEFAULT 0,
        save_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS save_backups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pid TEXT NOT NULL,
        save_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_backups_pid ON save_backups(pid, created_at DESC);
      CREATE TABLE IF NOT EXISTS packet_log (
        pid TEXT NOT NULL,
        packet_id TEXT NOT NULL,
        response_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (pid, packet_id)
      );
    `);
  }

  listPlayers(): PlayerSummary[] {
    const rows = this.db
      .prepare("SELECT pid, name, level, coins, cash, updated_at FROM players ORDER BY updated_at DESC")
      .all() as { pid: string; name: string; level: number; coins: number; cash: number; updated_at: number }[];
    return rows.map((r) => ({
      pid: r.pid,
      name: r.name,
      level: r.level,
      coins: r.coins,
      cash: r.cash,
      updatedAt: r.updated_at
    }));
  }

  getSave(pid: string): SaveFile | null {
    const row = this.db
      .prepare("SELECT save_json FROM players WHERE pid = ?")
      .get(pid) as { save_json: string } | undefined;
    if (!row) return null;
    try {
      return SaveFileSchema.parse(JSON.parse(row.save_json));
    } catch {
      // Automatic fallback to newest valid backup (PR #48 resilience)
      return this.restoreLatestBackup(pid);
    }
  }

  createNewEmpire(name: string, initialTemplate: SaveFile): SaveFile {
    const pid = `emp_${crypto.randomBytes(6).toString("hex")}`;
    const now = Math.floor(Date.now() / 1000);
    const cloned = structuredClone(initialTemplate);
    cloned.playerInfo.pid = pid;
    cloned.playerInfo.name = name.trim() || "Emperador";
    cloned.playerInfo.last_logged_in = now;
    if (cloned.maps[0]) {
      cloned.maps[0].timestamp = now;
    }
    this.save(cloned, true);
    return cloned;
  }

  importSave(rawSave: unknown): SaveFile {
    const parsed = SaveFileSchema.parse(rawSave);
    if (!parsed.playerInfo.pid || parsed.playerInfo.pid === "0") {
      parsed.playerInfo.pid = `imp_${crypto.randomBytes(6).toString("hex")}`;
    }
    this.save(parsed, true);
    return parsed;
  }

  save(saveFile: SaveFile, forceBackup = false): void {
    const pid = String(saveFile.playerInfo.pid);
    const map0 = saveFile.maps[0];
    const level = map0?.level ?? 1;
    const coins = map0?.coins ?? 0;
    const cash = saveFile.playerInfo.cash ?? 0;
    const now = Math.floor(Date.now() / 1000);
    const serialized = JSON.stringify(saveFile);

    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          `INSERT INTO players (pid, name, level, coins, cash, save_json, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(pid) DO UPDATE SET
             name = excluded.name,
             level = excluded.level,
             coins = excluded.coins,
             cash = excluded.cash,
             save_json = excluded.save_json,
             updated_at = excluded.updated_at`
        )
        .run(pid, saveFile.playerInfo.name, level, coins, cash, serialized, now);

      const lastBackup = this.db
        .prepare("SELECT created_at FROM save_backups WHERE pid = ? ORDER BY created_at DESC LIMIT 1")
        .get(pid) as { created_at: number } | undefined;

      if (forceBackup || !lastBackup || now - lastBackup.created_at >= BACKUP_INTERVAL_SEC) {
        this.db
          .prepare("INSERT INTO save_backups (pid, save_json, created_at) VALUES (?, ?, ?)")
          .run(pid, serialized, now);

        // Trim older backups beyond retention limit
        this.db
          .prepare(
            `DELETE FROM save_backups WHERE pid = ? AND id NOT IN (
               SELECT id FROM save_backups WHERE pid = ? ORDER BY created_at DESC, id DESC LIMIT ?
             )`
          )
          .run(pid, pid, MAX_BACKUPS_PER_PLAYER);
      }

      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  getCachedPacketResponse(pid: string, packetId: string): CommandBatchResponse | null {
    const row = this.db
      .prepare("SELECT response_json FROM packet_log WHERE pid = ? AND packet_id = ?")
      .get(pid, packetId) as { response_json: string } | undefined;
    if (!row) return null;
    return JSON.parse(row.response_json) as CommandBatchResponse;
  }

  recordPacketResponse(pid: string, packetId: string, response: CommandBatchResponse): void {
    const now = Math.floor(Date.now() / 1000);
    this.db
      .prepare(
        `INSERT OR REPLACE INTO packet_log (pid, packet_id, response_json, created_at)
         VALUES (?, ?, ?, ?)`
      )
      .run(pid, packetId, JSON.stringify(response), now);
  }

  private restoreLatestBackup(pid: string): SaveFile | null {
    const backups = this.db
      .prepare("SELECT save_json FROM save_backups WHERE pid = ? ORDER BY created_at DESC, id DESC LIMIT 10")
      .all(pid) as { save_json: string }[];
    for (const b of backups) {
      try {
        const parsed = SaveFileSchema.parse(JSON.parse(b.save_json));
        this.save(parsed, false);
        return parsed;
      } catch {
        continue;
      }
    }
    return null;
  }

  close(): void {
    this.db.close();
  }
}
