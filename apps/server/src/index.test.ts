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
});
