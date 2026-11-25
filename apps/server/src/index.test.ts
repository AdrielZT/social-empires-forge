import { describe, expect, it } from "vitest";
import { createServer } from "./index.js";

describe("sef-server Phase 2 & 3 Authoritative API", () => {
  it("serves compiled 1.4.07 game data, unit behaviors, and maps", async () => {
    const app = await createServer({ dbPath: ":memory:" });

    const health = await app.inject({ method: "GET", url: "/api/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json().targetVersion).toBe("1.4.07");

    const meta = await app.inject({ method: "GET", url: "/api/game-data/metadata" });
    expect(meta.statusCode).toBe(200);
    expect(meta.json().counts.items).toBeGreaterThan(1500);
    expect(meta.json().counts.magics).toBe(15);

    const maps = await app.inject({ method: "GET", url: "/api/maps" });
    expect(maps.statusCode).toBe(200);
    expect(maps.json().maps.length).toBeGreaterThan(35);

    const initMap = await app.inject({ method: "GET", url: "/api/maps/initial1407" });
    expect(initMap.statusCode).toBe(200);
    expect(initMap.json().maps[0].items.length).toBeGreaterThan(100);

    await app.close();
  });

  it("creates empire, applies buy/move/market commands atomically, deduplicates retries (PR #48), and exports .save.json", async () => {
    const app = await createServer({ dbPath: ":memory:" });

    const createRes = await app.inject({
      method: "POST",
      url: "/api/saves",
      payload: { name: "Imperio Adriel" }
    });
    expect(createRes.statusCode).toBe(200);
    const created = createRes.json().save;
    const pid = created.playerInfo.pid as string;
    const initialWood = created.maps[0].wood as number;
    const initialCount = created.maps[0].items.length as number;

    // Buy House I (id=1, cost=30 wood) inside starting expansion 13 at (46, 46)
    const batchPayload = {
      pid,
      packetId: "pkt-buy-house-1",
      tries: 1,
      timestamp: 1000,
      commands: [{ cmd: "buy", args: [1, 46, 46, 0] }]
    };

    const cmdRes1 = await app.inject({ method: "POST", url: "/api/commands", payload: batchPayload });
    expect(cmdRes1.statusCode).toBe(200);
    const body1 = cmdRes1.json();
    expect(body1.result).toBe("ok");
    expect(body1.replayed).toBe(false);
    expect(body1.appliedCount).toBe(1);
    expect(body1.save.maps[0].wood).toBe(initialWood - 30);
    expect(body1.save.maps[0].items.length).toBe(initialCount + 1);

    // Retry same packetId with tries=2 -> MUST replay without charging wood twice!
    const cmdRes2 = await app.inject({
      method: "POST",
      url: "/api/commands",
      payload: { ...batchPayload, tries: 2 }
    });
    expect(cmdRes2.statusCode).toBe(200);
    const body2 = cmdRes2.json();
    expect(body2.replayed).toBe(true);
    expect(body2.save.maps[0].wood).toBe(initialWood - 30);
    expect(body2.save.maps[0].items.length).toBe(initialCount + 1);

    // Export compatible .save.json
    const expRes = await app.inject({ method: "GET", url: `/api/saves/${pid}/export` });
    expect(expRes.statusCode).toBe(200);
    expect(expRes.json().playerInfo.name).toBe("Imperio Adriel");

    await app.close();
  });

  it("enforces User Mode vs Admin Mode on /api/commands, awards Level Up rewards, and persists Dragon Nest actions", async () => {
    const app = await createServer({ dbPath: ":memory:" });
    const createRes = await app.inject({
      method: "POST",
      url: "/api/saves",
      payload: { name: "Imperio Progresion" }
    });
    const created = createRes.json().save;
    const pid = created.playerInfo.pid as string;
    expect(created.maps[0].level).toBe(2);
    expect(created.maps[0].xp).toBe(30);

    // 1. User Mode blocks buying high-level item (e.g., item 1299 Cash Wonder minLevel > 2 or high-level barracks)
    const itemsRes = await app.inject({ method: "GET", url: "/api/game-data/items" });
    const items = itemsRes.json() as { id: number; minLevel: number; inStore: boolean; type: string }[];
    const lockedItem = items.find((i) => i.inStore && i.minLevel >= 10 && i.type === "b")!;
    expect(lockedItem).toBeDefined();

    const userBuy = await app.inject({
      method: "POST",
      url: "/api/commands",
      payload: {
        pid,
        packetId: "pkt-user-locked",
        tries: 1,
        timestamp: 2000,
        adminMode: false,
        commands: [{ cmd: "buy", args: [lockedItem.id, 47, 47, 0] }]
      }
    });
    expect(userBuy.json().result).toBe("desync");

    // 2. Switching to Admin Mode allows buying the locked item on the SAME save without losing it
    const adminBuy = await app.inject({
      method: "POST",
      url: "/api/commands",
      payload: {
        pid,
        packetId: "pkt-admin-unlock",
        tries: 1,
        timestamp: 2001,
        adminMode: true,
        commands: [{ cmd: "buy", args: [lockedItem.id, 47, 47, 0] }]
      }
    });
    expect(adminBuy.json().result).toBe("ok");

    // 3. Awarding +180 XP crosses L3 (60), L4 (100), L5 (200 -> +1 Cash!)
    const prevCash = adminBuy.json().save.playerInfo.cash as number;
    const lvlRes = await app.inject({
      method: "POST",
      url: "/api/commands",
      payload: {
        pid,
        packetId: "pkt-level-up",
        tries: 1,
        timestamp: 2002,
        adminMode: false,
        commands: [{ cmd: "reward_goal", args: [999, 500, 180] }]
      }
    });
    const lvlBody = lvlRes.json();
    expect(lvlBody.result).toBe("ok");
    expect(lvlBody.save.maps[0].level).toBe(5);
    expect(lvlBody.save.playerInfo.cash).toBe(prevCash + 1);
    const lvlEvents = (lvlBody.events as { type: string; level?: number }[]).filter((e) => e.type === "level_up");
    expect(lvlEvents.length).toBeGreaterThanOrEqual(1);

    // 4. Activate Dragon Nest in Admin Mode and verify privateState persistence
    const nestRes = await app.inject({
      method: "POST",
      url: "/api/commands",
      payload: {
        pid,
        packetId: "pkt-dragon-nest",
        tries: 1,
        timestamp: 2003,
        adminMode: true,
        commands: [{ cmd: "activate_dragon", args: [0] }, { cmd: "next_step_dragon", args: [] }]
      }
    });
    expect(nestRes.json().result).toBe("ok");
    expect(nestRes.json().save.privateState.dragonNestActive).toBe(1);
    expect(nestRes.json().save.privateState.stepNumber).toBe(1);

    await app.close();
  });
});
