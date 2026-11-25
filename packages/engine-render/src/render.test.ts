import { describe, expect, it } from "vitest";
import { tileToScreen } from "@sef/shared-types";
import {
  CameraController,
  computeAnimationFrameIndex,
  directionFrame,
  directionScaleX
} from "./index.js";

describe("@sef/engine-render — Animation Timing, 8D Mirrors, and Smooth Camera", () => {
  it("maps 8 canonical orientations to 5 SWF frames + horizontal mirrors", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(directionFrame)).toEqual([1, 2, 3, 4, 5, 2, 3, 4]);
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(directionScaleX)).toEqual([1, 1, 1, 1, 1, -1, -1, -1]);
  });

  it("holds last frame on one-shot death/attack clips and scales walk speed with velocity", () => {
    // Dying (animState=3) with 10 frames @ 30fps must clamp at frame 9 after 1s (never loop!)
    expect(computeAnimationFrameIndex(3, 10, 0.0, 30)).toBe(0);
    expect(computeAnimationFrameIndex(3, 10, 1.0, 30)).toBe(9);
    expect(computeAnimationFrameIndex(3, 10, 5.0, 30)).toBe(9);

    // Walking (animState=1) loops and plays faster for vel=6 than vel=3
    const slowWalk = computeAnimationFrameIndex(1, 20, 0.2, 30, 3, false);
    const fastWalk = computeAnimationFrameIndex(1, 20, 0.2, 30, 6, false);
    expect(fastWalk).toBeGreaterThan(slowWalk);
  });

  it("converges smoothly on smoothCenterOnTile and smoothZoomAtScreenPoint, and computes minimap viewport quad", () => {
    const cam = new CameraController(1280, 720);
    cam.centerOnTile(50, 50);
    const targetPos = tileToScreen(62, 44);

    cam.smoothCenterOnTile(62, 44);
    for (let i = 0; i < 60; i++) cam.update(16.67);
    expect(cam.x).toBeCloseTo(targetPos.x, 0);
    expect(cam.y).toBeCloseTo(targetPos.y, 0);

    cam.smoothZoomAtScreenPoint(1.5, 640, 360);
    for (let i = 0; i < 60; i++) cam.update(16.67);
    expect(cam.zoom).toBeCloseTo(0.85 * 1.5, 2);

    const quad = cam.getViewportTileQuad();
    expect(quad).toHaveLength(4);
    expect(Number.isFinite(quad[0].tx)).toBe(true);
    expect(Number.isFinite(quad[2].ty)).toBe(true);
  });
});
