import { describe, expect, it } from "vitest";
import { FixedStepClock, OccupancyGrid } from "./index.js";

describe("FixedStepClock", () => {
  it("steps deterministically at 30 Hz and returns render interpolation alpha", () => {
    const clock = new FixedStepClock(1000 / 30);
    let ticks = 0;
    const alpha1 = clock.advance(50, () => {
      ticks += 1;
    });
    expect(ticks).toBe(1);
    expect(alpha1).toBeCloseTo(0.5, 4);

    const alpha2 = clock.advance(16.6667, () => {
      ticks += 1;
    });
    expect(ticks).toBe(2);
    expect(alpha2).toBeCloseTo(0, 2);
  });
});

describe("OccupancyGrid", () => {
  it("tracks multi-tile footprints and prevents overlaps", () => {
    const grid = new OccupancyGrid();
    expect(grid.canPlace(50, 50, 3, 3)).toBe(true);
    grid.occupy(42, 50, 50, 3, 3);
    expect(grid.get(50, 50)).toBe(42);
    expect(grid.get(48, 48)).toBe(42);
    expect(grid.canPlace(49, 49, 2, 2)).toBe(false);
    expect(grid.canPlace(49, 49, 2, 2, 42)).toBe(true);
    grid.vacate(42, 50, 50, 3, 3);
    expect(grid.canPlace(49, 49, 2, 2)).toBe(true);
  });
});
