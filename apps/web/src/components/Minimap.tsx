import { useEffect, useRef } from "react";
import { EXPANSION_GRID_DIM, EXPANSION_SIZE_TILES } from "@sef/shared-types";
import type { GameController } from "../engine/GameController.js";
import { useGameStore } from "../store/gameStore.js";

export function Minimap(props: { controller: GameController | null }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const draggingRef = useRef(false);
  const expansions = useGameStore((s) => s.expansions);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const cvs = canvasRef.current;
      const ctrl = props.controller;
      if (!cvs || !ctrl || !ctrl.battle) return;
      const ctx = cvs.getContext("2d");
      if (!ctx) return;

      const w = cvs.width;
      const h = cvs.height;
      ctx.clearRect(0, 0, w, h);

      // Diamond background
      ctx.fillStyle = "#1b3312";
      ctx.beginPath();
      ctx.moveTo(w / 2, 4);
      ctx.lineTo(w - 4, h / 2);
      ctx.lineTo(w / 2, h - 4);
      ctx.lineTo(4, h / 2);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "#d49b38";
      ctx.lineWidth = 1.75;
      ctx.stroke();

      const project = (tx: number, ty: number) => ({
        x: w / 2 + ((tx - ty) / 100) * (w / 2 - 6),
        y: 6 + ((tx + ty) / 200) * (h - 12)
      });

      // Owned expansions
      ctx.fillStyle = "rgba(132, 204, 22, 0.36)";
      for (const expId of expansions) {
        const idx = expId - 1;
        const row = Math.floor(idx / EXPANSION_GRID_DIM);
        const col = idx % EXPANSION_GRID_DIM;
        const x0 = col * EXPANSION_SIZE_TILES;
        const y0 = row * EXPANSION_SIZE_TILES;
        const p0 = project(x0, y0);
        const p1 = project(x0 + 20, y0);
        const p2 = project(x0 + 20, y0 + 20);
        const p3 = project(x0, y0 + 20);
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.lineTo(p3.x, p3.y);
        ctx.closePath();
        ctx.fill();
      }

      // Entities
      for (const e of ctrl.battle.entities.values()) {
        if (!e.alive) continue;
        const pt = project(e.tx, e.ty);
        ctx.fillStyle =
          e.team === "enemy" ? "#ef4444" : e.team === "neutral" ? "#a3e635" : e.type === "u" ? "#38bdf8" : "#facc15";
        ctx.fillRect(pt.x - 1, pt.y - 1, 2.5, 2.5);
      }

      // Live Camera Viewport Trapezoid (QoL)
      const quad = ctrl.renderer.camera.getViewportTileQuad();
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(w / 2, 4);
      ctx.lineTo(w - 4, h / 2);
      ctx.lineTo(w / 2, h - 4);
      ctx.lineTo(4, h / 2);
      ctx.closePath();
      ctx.clip();

      const q0 = project(quad[0].tx, quad[0].ty);
      const q1 = project(quad[1].tx, quad[1].ty);
      const q2 = project(quad[2].tx, quad[2].ty);
      const q3 = project(quad[3].tx, quad[3].ty);
      ctx.strokeStyle = "rgba(255, 248, 220, 0.92)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(q0.x, q0.y);
      ctx.lineTo(q1.x, q1.y);
      ctx.lineTo(q2.x, q2.y);
      ctx.lineTo(q3.x, q3.y);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }, 150);

    return () => window.clearInterval(timer);
  }, [props.controller, expansions]);

  const moveCameraToEvent = (e: React.PointerEvent<HTMLCanvasElement>, smooth: boolean) => {
    const ctrl = props.controller;
    const cvs = canvasRef.current;
    if (!ctrl || !cvs) return;
    const r = cvs.getBoundingClientRect();
    const nx = (e.clientX - r.left - r.width / 2) / (r.width / 2 - 6);
    const ny = (e.clientY - r.top - 6) / (r.height - 12);
    const sum = ny * 200;
    const diff = nx * 100;
    const tx = Math.max(0, Math.min(99, (sum + diff) * 0.5));
    const ty = Math.max(0, Math.min(99, (sum - diff) * 0.5));
    if (smooth) ctrl.renderer.camera.smoothCenterOnTile(tx, ty);
    else ctrl.renderer.camera.centerOnTile(tx, ty);
  };

  return (
    <canvas
      ref={canvasRef}
      width={172}
      height={100}
      onPointerDown={(e) => {
        draggingRef.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        moveCameraToEvent(e, true);
      }}
      onPointerMove={(e) => {
        if (!draggingRef.current) return;
        moveCameraToEvent(e, false);
      }}
      onPointerUp={(e) => {
        draggingRef.current = false;
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      }}
      className="sp-panel pointer-events-auto cursor-pointer rounded-xl"
    />
  );
}
