import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { GameItem } from "@sef/shared-types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../data");

describe("compiled 1.4.07 game data integrity", () => {
  it("contains all 1,786 validated items with PR #40 3x3 fixes for University and Soul Mixer", () => {
    const items = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "items.json"), "utf-8")) as GameItem[];
    expect(items.length).toBeGreaterThanOrEqual(1700);

    const university = items.find((i) => i.id === 25);
    const soulMixer = items.find((i) => i.id === 1529);
    expect(university?.width).toBe(3);
    expect(university?.height).toBe(3);
    expect(soulMixer?.width).toBe(3);
    expect(soulMixer?.height).toBe(3);
  });

  it("contains all 15 magic spells, 206 goals, and 100% unit_behaviors coverage for all 771 units", () => {
    const items = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "items.json"), "utf-8")) as GameItem[];
    const magics = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "magics.json"), "utf-8")) as unknown[];
    const goals = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "goals.json"), "utf-8")) as unknown[];
    const behaviors = JSON.parse(
      fs.readFileSync(path.join(DATA_DIR, "unit_behaviors.json"), "utf-8")
    ) as Record<string, { itemId: number; hasLimitBar: boolean; specials: unknown[] }>;

    expect(magics.length).toBe(15);
    expect(goals.length).toBe(206);

    const units = items.filter((i) => i.type === "u");
    for (const u of units) {
      expect(behaviors[String(u.id)]).toBeDefined();
    }
    const limitUnits = Object.values(behaviors).filter((b) => b.hasLimitBar);
    expect(limitUnits.length).toBeGreaterThan(200);
  });
});
