import { describe, expect, it } from "vitest";
import type { SaveFile } from "@sef/shared-types";
import { SaveRepository } from "./SaveRepository.js";

const SAMPLE_SAVE: SaveFile = {
  playerInfo: {
    pid: "0",
    name: "Initial",
    pic: "",
    cash: 100,
    completed_tutorial: 0,
    default_map: 0,
    map_names: ["Empire"],
    world_id: 0,
    last_logged_in: 0,
    attacks_won: 0,
    attacks_lost: 0
  },
  maps: [
    {
      id: 0,
      expansions: [13],
      timestamp: 0,
      coins: 1000,
      xp: 125,
      level: 2,
      stone: 250,
      wood: 250,
      food: 250,
      race: "h",
      skin: 0,
      idCurrentTreasure: 0,
      timestampLastTreasure: 0,
      resourcesTraded: {},
      receivedAssists: {},
      increasedPopulation: 0,
      questTimes: {},
      lastQuestTimes: {},
      items: [[26, 52, 52, 0, 0, 0, [], {}]],
      warehousedUnits: [],
      store: {}
    }
  ],
  privateState: { mana: 20 }
};

describe("SaveRepository (SQLite WAL + Idempotent Packet Deduplication)", () => {
  it("creates, persists, lists, and deduplicates retried command packets", () => {
    const repo = new SaveRepository(":memory:");
    const created = repo.createNewEmpire("Adriel Empire", SAMPLE_SAVE);
    expect(created.playerInfo.pid).toMatch(/^emp_/);
    expect(repo.listPlayers()).toHaveLength(1);

    const loaded = repo.getSave(created.playerInfo.pid);
    expect(loaded?.playerInfo.name).toBe("Adriel Empire");
    expect(loaded?.maps[0]?.coins).toBe(1000);

    // Record packet response & confirm replay lookup
    const resp = {
      result: "ok" as const,
      packetId: "pkt-001",
      replayed: false,
      appliedCount: 1,
      serverTime: 12345
    };
    repo.recordPacketResponse(created.playerInfo.pid, "pkt-001", resp);
    expect(repo.getCachedPacketResponse(created.playerInfo.pid, "pkt-001")?.appliedCount).toBe(1);

    repo.close();
  });
});
