import { describe, expect, it } from "vitest";
import {
  expansionIdToBounds,
  INITIAL_EXPANSION_ID,
  screenToTile,
  tileToExpansionId,
  tileToScreen
} from "./iso.js";

describe("isometric math", () => {
  it("round-trips tile <-> screen coordinates accurately", () => {
    const coords: readonly [number, number][] = [
      [0, 0],
      [50, 50],
      [44, 52],
      [99, 12]
    ];
    for (const [tx, ty] of coords) {
      const s = tileToScreen(tx, ty);
      const back = screenToTile(s.x, s.y);
      expect(back.tx).toBeCloseTo(tx, 6);
      expect(back.ty).toBeCloseTo(ty, 6);
    }
  });

  it("maps center tiles (40..59, 40..59) to initial expansion 13", () => {
    const bounds = expansionIdToBounds(INITIAL_EXPANSION_ID);
    expect(bounds).toEqual({ minTx: 40, minTy: 40, maxTx: 59, maxTy: 59 });
    expect(tileToExpansionId(40, 40)).toBe(13);
    expect(tileToExpansionId(59, 59)).toBe(13);
    expect(tileToExpansionId(0, 0)).toBe(1);
    expect(tileToExpansionId(99, 99)).toBe(25);
    expect(tileToExpansionId(-1, 50)).toBe(-1);
  });
});
