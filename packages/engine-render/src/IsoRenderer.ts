import { Application, Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import {
  EXPANSION_GRID_DIM,
  EXPANSION_SIZE_TILES,
  ISO_TILE_HEIGHT,
  ISO_TILE_WIDTH,
  screenToTile,
  tileToScreen,
  type TerrainSkin
} from "@sef/shared-types";
import { AtlasLoader, type LoadedSpriteAtlas } from "./AtlasLoader.js";
import { CameraController } from "./CameraController.js";

export interface RenderEntityData {
  uid: number;
  itemId: number;
  imgName: string;
  name: string;
  type: "b" | "u";
  tx: number;
  ty: number;
  prevTx?: number;
  prevTy?: number;
  width: number;
  height: number;
  orientation: number;
  animState: number; // 0=idle, 1=walk, 2=attack, 3=die, 4=harvest, 5=repair/strike, 6+=special
  hp: number;
  maxHp: number;
  flying: boolean;
  scale?: number;
  selected?: boolean;
  team?: "player" | "enemy" | "neutral";
  limitRatio?: number;
  collectReady?: boolean;
  frozen?: boolean;
  poisoned?: boolean;
  shielded?: boolean;
  enlarged?: boolean;
}

export interface RenderProjectileData {
  id: number;
  kind: string;
  fromTx: number;
  fromTy: number;
  toTx: number;
  toTy: number;
  progress: number;
  color: number;
}

export interface PlacementPreview {
  imgName: string;
  width: number;
  height: number;
  valid: boolean;
}

export interface SpellPreview {
  magicId: number;
  radiusTiles: number;
  color: number;
}

export interface RendererMetrics {
  fps: number;
  frameTimeMs: number;
  p95FrameMs: number;
  cpuTimeMs: number;
  visibleEntities: number;
  totalEntities: number;
  loadedAtlases: number;
  rendererType: string;
}

export interface ClickModifiers {
  ctrlKey: boolean;
  shiftKey: boolean;
  doubleClick: boolean;
}

export interface IsoRendererCallbacks {
  onEntitySelect?: (entity: RenderEntityData | null, additive: boolean) => void;
  onBoxSelect?: (uids: number[]) => void;
  onTileHover?: (tx: number, ty: number) => void;
  onTileClick?: (
    tx: number,
    ty: number,
    button: number,
    hitEntity: RenderEntityData | null,
    modifiers?: ClickModifiers
  ) => void;
  onEscape?: () => void;
  onTickFrame?: (dtMs: number) => void;
}

interface EntityVisual {
  data: RenderEntityData;
  container: Container;
  sprite: Sprite;
  selectionRing: Graphics;
  hpBar: Graphics;
  collectBadge: Graphics;
  atlas: LoadedSpriteAtlas | null;
  loadingAtlas: boolean;
  animElapsed: number;
  lastFrameKey: string;
  lastOverlaySig: string;
}

interface FloatingTextItem {
  text: Text;
  vx: number;
  vy: number;
  lifeMs: number;
  maxLifeMs: number;
}

interface SpellRingEffect {
  g: Graphics;
  wx: number;
  wy: number;
  maxRadiusPx: number;
  color: number;
  lifeMs: number;
  maxLifeMs: number;
}

export function directionFrame(orientation: number): number {
  return orientation > 5 ? orientation - 4 : Math.max(1, Math.min(5, orientation));
}

export function directionScaleX(orientation: number): 1 | -1 {
  return orientation > 5 ? -1 : 1;
}

export class IsoRenderer {
  private app: Application | null = null;
  private readonly hostEl: HTMLElement;
  private readonly callbacks: IsoRendererCallbacks;
  readonly atlasLoader: AtlasLoader;
  readonly camera: CameraController;

  private readonly worldRoot = new Container();
  private readonly terrainLayer = new Container();
  private readonly gridLayer = new Graphics();
  private readonly hoverLayer = new Graphics();
  private readonly entityLayer = new Container();
  private readonly flyingLayer = new Container();
  private readonly projectileLayer = new Graphics();
  private readonly vfxLayer = new Container();
  private readonly ghostSprite = new Sprite(Texture.EMPTY);
  private readonly selectBoxLayer = new Graphics();

  private readonly visuals = new Map<number, EntityVisual>();
  private readonly terrainSprites: { expId: number; col: number; row: number; sprite: Sprite }[] = [];
  private readonly floatingTexts: FloatingTextItem[] = [];
  private readonly spellEffects: SpellRingEffect[] = [];

  private projectiles: readonly RenderProjectileData[] = [];
  private hadProjectiles = false;
  private ownedExpansions = new Set<number>([13]);
  private currentBiome: TerrainSkin = "terreno";
  private showGrid = false;
  private selectedUids = new Set<number>();
  private hoveredTile: { tx: number; ty: number } | null = null;
  private placementPreview: PlacementPreview | null = null;
  private spellPreview: SpellPreview | null = null;
  private renderAlpha = 1;

  // Input state
  private isDragging = false;
  private isBoxSelecting = false;
  private dragMoved = false;
  private downClientX = 0;
  private downClientY = 0;
  private lastClickAt = 0;
  private lastClickUid: number | null = null;
  private boxStartX = 0;
  private boxStartY = 0;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private readonly keysPressed = new Set<string>();

  // Performance telemetry (rolling 90-frame ring buffer)
  private readonly frameTimes: number[] = [];
  private readonly cpuTimes: number[] = [];
  private lastRafTime = 0;
  private visibleCount = 0;
  private destroyed = false;
  private resizeObserver: ResizeObserver | null = null;
  private rendererType = "initializing";

  constructor(hostEl: HTMLElement, callbacks: IsoRendererCallbacks = {}, assetsBaseUrl = "/assets") {
    this.hostEl = hostEl;
    this.callbacks = callbacks;
    this.atlasLoader = new AtlasLoader(assetsBaseUrl, 340);
    this.camera = new CameraController(hostEl.clientWidth || 1280, hostEl.clientHeight || 720);
  }

  async init(): Promise<void> {
    const app = new Application();
    await app.init({
      resizeTo: this.hostEl,
      antialias: true,
      backgroundColor: 0x3b6d1e,
      powerPreference: "high-performance",
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
      preference: "webgl"
    });

    if (this.destroyed) {
      app.destroy(true);
      return;
    }

    this.app = app;
    this.rendererType = app.renderer.name ?? "webgl";
    this.hostEl.innerHTML = "";
    this.hostEl.appendChild(app.canvas);
    app.canvas.style.display = "block";
    app.canvas.style.width = "100%";
    app.canvas.style.height = "100%";

    this.entityLayer.sortableChildren = true;
    this.flyingLayer.sortableChildren = true;
    this.ghostSprite.visible = false;
    this.ghostSprite.alpha = 0.72;
    this.ghostSprite.anchor.set(0.5, 1.0);

    this.worldRoot.addChild(this.terrainLayer);
    this.worldRoot.addChild(this.gridLayer);
    this.worldRoot.addChild(this.hoverLayer);
    this.worldRoot.addChild(this.entityLayer);
    this.worldRoot.addChild(this.flyingLayer);
    this.worldRoot.addChild(this.ghostSprite);
    this.worldRoot.addChild(this.projectileLayer);
    this.worldRoot.addChild(this.vfxLayer);
    app.stage.addChild(this.worldRoot);
    app.stage.addChild(this.selectBoxLayer);

    this.camera.resize(this.hostEl.clientWidth || 1280, this.hostEl.clientHeight || 720);
    this.buildTerrainSlots();
    await this.setBiome(this.currentBiome);
    this.bindInput(app.canvas);

    this.resizeObserver = new ResizeObserver(() => {
      if (!this.destroyed && this.hostEl.clientWidth > 0 && this.hostEl.clientHeight > 0) {
        this.camera.resize(this.hostEl.clientWidth, this.hostEl.clientHeight);
      }
    });
    this.resizeObserver.observe(this.hostEl);

    this.lastRafTime = performance.now();
    app.ticker.add(() => this.onRenderFrame());
  }

  setRenderAlpha(alpha: number): void {
    this.renderAlpha = Math.max(0, Math.min(1, alpha));
  }

  setProjectiles(list: readonly RenderProjectileData[]): void {
    this.projectiles = list;
  }

  setPlacementPreview(preview: PlacementPreview | null): void {
    this.placementPreview = preview;
    if (!preview) {
      this.ghostSprite.visible = false;
    } else {
      void this.atlasLoader.load(preview.imgName).then((atlas) => {
        if (!atlas || !this.placementPreview || this.placementPreview.imgName !== preview.imgName) return;
        const anim = atlas.meta.animations["f1"] ?? Object.values(atlas.meta.animations)[0];
        const fk = anim?.frames[0] ?? Object.keys(atlas.meta.frames)[0];
        const tex = fk ? atlas.textures.get(fk)?.texture : undefined;
        if (tex) this.ghostSprite.texture = tex;
      });
    }
    if (this.hoveredTile) this.drawHoverOverlay(this.hoveredTile.tx, this.hoveredTile.ty);
  }

  setSpellPreview(preview: SpellPreview | null): void {
    this.spellPreview = preview;
    if (this.hoveredTile) this.drawHoverOverlay(this.hoveredTile.tx, this.hoveredTile.ty);
  }

  spawnFloatingText(tx: number, ty: number, label: string, color = 0xffe484): void {
    if (this.destroyed || this.floatingTexts.length > 60) return;
    const pos = tileToScreen(tx, ty);
    const txt = new Text({
      text: label,
      style: {
        fontFamily: "Nunito, Arial Rounded MT Bold, sans-serif",
        fontSize: 16,
        fontWeight: "900",
        fill: color,
        stroke: { color: 0x1a0d04, width: 4 }
      }
    });
    txt.anchor.set(0.5, 1.0);
    txt.x = pos.x + (Math.random() * 24 - 12);
    txt.y = pos.y - 42;
    this.vfxLayer.addChild(txt);
    this.floatingTexts.push({ text: txt, vx: 0, vy: -48, lifeMs: 0, maxLifeMs: 1100 });
  }

  spawnSpellBurst(tx: number, ty: number, radiusTiles: number, color = 0xff7b29): void {
    if (this.destroyed) return;
    const pos = tileToScreen(tx, ty);
    const g = new Graphics();
    this.vfxLayer.addChild(g);
    this.spellEffects.push({
      g,
      wx: pos.x,
      wy: pos.y,
      maxRadiusPx: radiusTiles * ISO_TILE_WIDTH * 0.55,
      color,
      lifeMs: 0,
      maxLifeMs: 750
    });
    this.camera.triggerShake(8);
  }

  spawnCommandPulse(tx: number, ty: number, color = 0x4ade80): void {
    if (this.destroyed) return;
    const pos = tileToScreen(tx, ty);
    const g = new Graphics();
    this.vfxLayer.addChild(g);
    this.spellEffects.push({
      g,
      wx: pos.x,
      wy: pos.y,
      maxRadiusPx: 34,
      color,
      lifeMs: 0,
      maxLifeMs: 420
    });
  }

  private buildTerrainSlots(): void {
    this.terrainLayer.removeChildren();
    this.terrainSprites.length = 0;

    for (let row = 0; row < EXPANSION_GRID_DIM; row++) {
      for (let col = 0; col < EXPANSION_GRID_DIM; col++) {
        const expId = row * EXPANSION_GRID_DIM + col + 1;
        const southTx = col * EXPANSION_SIZE_TILES + (EXPANSION_SIZE_TILES - 1);
        const southTy = row * EXPANSION_SIZE_TILES + (EXPANSION_SIZE_TILES - 1);
        const pos = tileToScreen(southTx, southTy);

        const sp = new Sprite(Texture.EMPTY);
        sp.anchor.set(0.5, 1.0);
        sp.x = pos.x;
        sp.y = pos.y + ISO_TILE_HEIGHT * 0.5;
        this.terrainLayer.addChild(sp);
        this.terrainSprites.push({ expId, col, row, sprite: sp });
      }
    }
    this.refreshTerrainVisuals();
  }

  async setBiome(biome: TerrainSkin): Promise<void> {
    this.currentBiome = biome;
    const atlas = await this.atlasLoader.load(biome);
    if (!atlas || this.destroyed) return;

    const anim = atlas.meta.animations["f1"] ?? Object.values(atlas.meta.animations)[0];
    const firstKey = anim?.frames[0] ?? Object.keys(atlas.meta.frames)[0];
    const entry = firstKey ? atlas.textures.get(firstKey) : undefined;
    if (!entry) return;

    for (const slot of this.terrainSprites) {
      slot.sprite.texture = entry.texture;
      slot.sprite.width = EXPANSION_SIZE_TILES * ISO_TILE_WIDTH;
      slot.sprite.height = EXPANSION_SIZE_TILES * ISO_TILE_HEIGHT;
    }
    this.refreshTerrainVisuals();
  }

  setOwnedExpansions(expansions: readonly number[]): void {
    this.ownedExpansions = new Set(expansions);
    this.refreshTerrainVisuals();
    this.redrawGrid();
  }

  setShowGrid(enabled: boolean): void {
    this.showGrid = enabled;
    this.redrawGrid();
  }

  private refreshTerrainVisuals(): void {
    for (const slot of this.terrainSprites) {
      const owned = this.ownedExpansions.has(slot.expId);
      slot.sprite.tint = owned ? 0xffffff : 0xb2c29b;
      slot.sprite.alpha = owned ? 1.0 : 0.72;
    }
  }

  private redrawGrid(): void {
    this.gridLayer.clear();
    for (const expId of this.ownedExpansions) {
      const idx = expId - 1;
      const row = Math.floor(idx / EXPANSION_GRID_DIM);
      const col = idx % EXPANSION_GRID_DIM;
      const x0 = col * EXPANSION_SIZE_TILES;
      const y0 = row * EXPANSION_SIZE_TILES;
      const x1 = x0 + EXPANSION_SIZE_TILES;
      const y1 = y0 + EXPANSION_SIZE_TILES;

      const pN = tileToScreen(x0, y0);
      const pE = tileToScreen(x1, y0);
      const pS = tileToScreen(x1, y1);
      const pW = tileToScreen(x0, y1);

      this.gridLayer
        .moveTo(pN.x, pN.y - ISO_TILE_HEIGHT * 0.5)
        .lineTo(pE.x, pE.y - ISO_TILE_HEIGHT * 0.5)
        .lineTo(pS.x, pS.y - ISO_TILE_HEIGHT * 0.5)
        .lineTo(pW.x, pW.y - ISO_TILE_HEIGHT * 0.5)
        .closePath()
        .stroke({ width: 3, color: 0xf7d154, alpha: 0.45 });
    }

    if (!this.showGrid) return;

    for (const expId of this.ownedExpansions) {
      const idx = expId - 1;
      const row = Math.floor(idx / EXPANSION_GRID_DIM);
      const col = idx % EXPANSION_GRID_DIM;
      const x0 = col * EXPANSION_SIZE_TILES;
      const y0 = row * EXPANSION_SIZE_TILES;
      const x1 = x0 + EXPANSION_SIZE_TILES;
      const y1 = y0 + EXPANSION_SIZE_TILES;

      for (let i = 0; i <= EXPANSION_SIZE_TILES; i++) {
        const a = tileToScreen(x0 + i, y0);
        const b = tileToScreen(x0 + i, y1);
        this.gridLayer.moveTo(a.x, a.y - ISO_TILE_HEIGHT * 0.5).lineTo(b.x, b.y - ISO_TILE_HEIGHT * 0.5);
        const c = tileToScreen(x0, y0 + i);
        const d = tileToScreen(x1, y0 + i);
        this.gridLayer.moveTo(c.x, c.y - ISO_TILE_HEIGHT * 0.5).lineTo(d.x, d.y - ISO_TILE_HEIGHT * 0.5);
      }
      this.gridLayer.stroke({ width: 1, color: 0xffffff, alpha: 0.16 });
    }
  }

  clearEntities(): void {
    for (const vis of this.visuals.values()) {
      vis.container.parent?.removeChild(vis.container);
      vis.container.destroy({ children: true });
    }
    this.visuals.clear();
    this.selectedUids.clear();
    this.projectiles = [];
    if (this.hadProjectiles) {
      this.projectileLayer.clear();
      this.hadProjectiles = false;
    }
  }

  async preloadSprites(imgNames: Iterable<string>): Promise<void> {
    const unique = new Set<string>();
    for (const n of imgNames) {
      if (n) unique.add(n);
    }
    await Promise.all(Array.from(unique, (id) => this.atlasLoader.load(id)));
  }

  setEntities(entities: readonly RenderEntityData[]): void {
    const incomingIds = new Set<number>();
    for (const ent of entities) {
      incomingIds.add(ent.uid);
      const existing = this.visuals.get(ent.uid);
      if (existing) {
        if (existing.data.type !== ent.type || existing.data.flying !== ent.flying) {
          existing.container.parent?.removeChild(existing.container);
          existing.container.destroy({ children: true });
          this.visuals.delete(ent.uid);
          this.createEntityVisual(ent);
          continue;
        }
        const imgChanged = existing.data.imgName !== ent.imgName;
        existing.data = ent;
        if (imgChanged) {
          existing.atlas = this.atlasLoader.getIfLoaded(ent.imgName);
          existing.loadingAtlas = false;
          existing.lastFrameKey = "";
          existing.sprite.texture = Texture.EMPTY;
        }
        this.positionEntityVisual(existing, this.renderAlpha);
        this.updateStatusOverlays(existing);
      } else {
        this.createEntityVisual(ent);
      }
    }

    for (const [uid, vis] of this.visuals) {
      if (!incomingIds.has(uid)) {
        vis.container.parent?.removeChild(vis.container);
        vis.container.destroy({ children: true });
        this.visuals.delete(uid);
      }
    }
  }

  setSelectedEntities(uids: readonly number[]): void {
    for (const prevId of this.selectedUids) {
      const prev = this.visuals.get(prevId);
      if (prev) prev.selectionRing.visible = false;
    }
    this.selectedUids = new Set(uids);
    for (const uid of this.selectedUids) {
      const vis = this.visuals.get(uid);
      if (vis) {
        this.drawSelectionRing(vis);
        vis.selectionRing.visible = true;
      }
    }
  }

  private createEntityVisual(ent: RenderEntityData): void {
    const container = new Container();
    const selectionRing = new Graphics();
    selectionRing.visible = this.selectedUids.has(ent.uid) || Boolean(ent.selected);

    const sprite = new Sprite(Texture.EMPTY);
    const hpBar = new Graphics();
    hpBar.visible = false;
    const collectBadge = new Graphics();
    collectBadge.visible = false;

    container.addChild(selectionRing);
    container.addChild(sprite);
    container.addChild(hpBar);
    container.addChild(collectBadge);

    const targetLayer = ent.flying ? this.flyingLayer : this.entityLayer;
    targetLayer.addChild(container);

    const vis: EntityVisual = {
      data: ent,
      container,
      sprite,
      selectionRing,
      hpBar,
      collectBadge,
      atlas: this.atlasLoader.getIfLoaded(ent.imgName),
      loadingAtlas: false,
      animElapsed: Math.random() * 2,
      lastFrameKey: "",
      lastOverlaySig: ""
    };

    this.visuals.set(ent.uid, vis);
    this.positionEntityVisual(vis, 1);
    if (selectionRing.visible) this.drawSelectionRing(vis);
    this.updateStatusOverlays(vis);
    if (vis.atlas) this.updateSpriteAnimation(vis, 0);
  }

  private positionEntityVisual(vis: EntityVisual, alpha: number): void {
    const { tx, ty, prevTx, prevTy, width, height, type } = vis.data;
    const itx = prevTx !== undefined ? prevTx + (tx - prevTx) * alpha : tx;
    const ity = prevTy !== undefined ? prevTy + (ty - prevTy) * alpha : ty;
    const pos = tileToScreen(itx, ity);
    const nextX = pos.x;
    const nextY = type === "u" ? pos.y - ISO_TILE_HEIGHT * 0.5 : pos.y + ISO_TILE_HEIGHT * 0.5;
    if (vis.container.x !== nextX) vis.container.x = nextX;
    if (vis.container.y !== nextY) vis.container.y = nextY;

    const centerTx = itx - (width - 1) * 0.5;
    const centerTy = ity - (height - 1) * 0.5;
    const nextZ = (centerTx + centerTy) * 1000 + (type === "u" ? 120 : 0) + (centerTx - centerTy) * 0.01;
    if (vis.container.zIndex !== nextZ) vis.container.zIndex = nextZ;
  }

  private updateStatusOverlays(vis: EntityVisual): void {
    const d = vis.data;
    const isSel = this.selectedUids.has(d.uid);
    const sig = `${Math.round(d.hp)}/${d.maxHp}|${isSel ? 1 : 0}|${d.team}|${d.collectReady ? 1 : 0}|${d.frozen ? 1 : 0}|${d.poisoned ? 1 : 0}|${d.shielded ? 1 : 0}|${Math.round((d.limitRatio ?? 0) * 20)}`;
    if (vis.lastOverlaySig === sig) return;
    vis.lastOverlaySig = sig;

    if (d.frozen) vis.sprite.tint = 0x7dd3fc;
    else if (d.poisoned) vis.sprite.tint = 0x86efac;
    else if (d.shielded) vis.sprite.tint = 0xfef08a;
    else vis.sprite.tint = 0xffffff;

    const showHp = d.hp < d.maxHp || d.team === "enemy" || isSel;
    vis.hpBar.visible = showHp && d.maxHp > 1;
    if (vis.hpBar.visible) {
      const g = vis.hpBar;
      g.clear();
      const bw = d.type === "b" ? 54 : 36;
      const yOff = d.type === "b" ? -Math.max(70, d.height * 34) : -74;
      const ratio = Math.max(0, Math.min(1, d.hp / Math.max(1, d.maxHp)));
      const fillCol = d.team === "enemy" ? 0xef4444 : ratio > 0.45 ? 0x22c55e : 0xf59e0b;
      g.rect(-bw / 2, yOff, bw, 5).fill({ color: 0x111827, alpha: 0.85 });
      g.rect(-bw / 2 + 1, yOff + 1, Math.max(0, (bw - 2) * ratio), 3).fill({ color: fillCol });
      if (d.limitRatio && d.limitRatio > 0) {
        g.rect(-bw / 2, yOff + 6, bw, 3).fill({ color: 0x0f172a, alpha: 0.85 });
        g.rect(-bw / 2, yOff + 6, bw * Math.min(1, d.limitRatio), 3).fill({ color: 0x38bdf8 });
      }
    }

    vis.collectBadge.visible = Boolean(d.collectReady);
    if (vis.collectBadge.visible) {
      const g = vis.collectBadge;
      g.clear();
      const yOff = -Math.max(84, d.height * 38);
      g.circle(0, yOff, 11).fill({ color: 0xfacc15 }).stroke({ width: 2.5, color: 0x78350f });
    }
  }

  private drawSelectionRing(vis: EntityVisual): void {
    const g = vis.selectionRing;
    g.clear();
    const { width, height, type, team } = vis.data;
    const color = team === "enemy" ? 0xf87171 : 0x4ade80;
    if (type === "u") {
      g.ellipse(0, 0, 26, 13).stroke({ width: 2.5, color, alpha: 0.95 });
      g.ellipse(0, 0, 26, 13).fill({ color, alpha: 0.18 });
    } else {
      const halfW = width * ISO_TILE_WIDTH * 0.5;
      const halfH = height * ISO_TILE_HEIGHT * 0.5;
      g.moveTo(0, 0)
        .lineTo(halfW, -halfH)
        .lineTo(0, -halfH * 2)
        .lineTo(-halfW, -halfH)
        .closePath()
        .fill({ color: 0xf7d154, alpha: 0.18 })
        .stroke({ width: 2.5, color: 0xf7d154, alpha: 0.95 });
    }
  }

  private onRenderFrame(): void {
    const now = performance.now();
    const dtMs = Math.max(0.1, now - this.lastRafTime);
    this.lastRafTime = now;

    this.frameTimes.push(dtMs);
    if (this.frameTimes.length > 90) this.frameTimes.shift();

    // Let simulation fixed-step clock advance before rendering interpolated positions
    this.callbacks.onTickFrame?.(dtMs);

    // Keyboard WASD/arrow camera panning
    const panSpeed = (620 * dtMs) / 1000;
    let panX = 0;
    let panY = 0;
    if (this.keysPressed.has("KeyW") || this.keysPressed.has("ArrowUp")) panY += panSpeed;
    if (this.keysPressed.has("KeyS") || this.keysPressed.has("ArrowDown")) panY -= panSpeed;
    if (this.keysPressed.has("KeyA") || this.keysPressed.has("ArrowLeft")) panX += panSpeed;
    if (this.keysPressed.has("KeyD") || this.keysPressed.has("ArrowRight")) panX -= panSpeed;
    if (panX !== 0 || panY !== 0) {
      this.camera.panByScreenDelta(panX, panY);
    }

    const camTf = this.camera.getWorldTransform();
    this.worldRoot.x = camTf.x;
    this.worldRoot.y = camTf.y;
    this.worldRoot.scale.set(camTf.scale);

    // Frustum-cull the 5x5 terrain expansion sprites (each 2160x1080) so off-screen islands incur zero fillrate
    const terrainBounds = this.camera.getVisibleWorldBounds(48);
    const halfTerrainW = EXPANSION_SIZE_TILES * ISO_TILE_WIDTH * 0.5;
    const fullTerrainH = EXPANSION_SIZE_TILES * ISO_TILE_HEIGHT;
    for (const slot of this.terrainSprites) {
      const sp = slot.sprite;
      sp.visible =
        sp.x + halfTerrainW >= terrainBounds.minX &&
        sp.x - halfTerrainW <= terrainBounds.maxX &&
        sp.y >= terrainBounds.minY &&
        sp.y - fullTerrainH <= terrainBounds.maxY;
    }

    const bounds = this.camera.getVisibleWorldBounds(360);
    const dtSec = dtMs / 1000;
    let visible = 0;

    for (const vis of this.visuals.values()) {
      if (vis.data.type === "u") {
        this.positionEntityVisual(vis, this.renderAlpha);
      }
      const cx = vis.container.x;
      const cy = vis.container.y;
      const inView = cx >= bounds.minX && cx <= bounds.maxX && cy >= bounds.minY && cy <= bounds.maxY;

      vis.container.visible = inView;
      if (!inView) continue;
      visible += 1;

      if (!vis.atlas) {
        const cached = this.atlasLoader.getIfLoaded(vis.data.imgName);
        if (cached) {
          vis.atlas = cached;
        } else if (!vis.loadingAtlas && vis.data.imgName) {
          vis.loadingAtlas = true;
          void this.atlasLoader.load(vis.data.imgName).then((loaded) => {
            vis.atlas = loaded;
            vis.loadingAtlas = false;
          });
        }
      }

      if (vis.atlas) {
        this.updateSpriteAnimation(vis, dtSec);
      }
    }
    this.visibleCount = visible;

    this.renderProjectiles();
    this.updateVfx(dtMs);

    const cpuMs = performance.now() - now;
    this.cpuTimes.push(cpuMs);
    if (this.cpuTimes.length > 90) this.cpuTimes.shift();
  }

  private renderProjectiles(): void {
    const g = this.projectileLayer;
    if (this.projectiles.length === 0) {
      if (this.hadProjectiles) {
        g.clear();
        this.hadProjectiles = false;
      }
      return;
    }
    this.hadProjectiles = true;
    g.clear();
    for (const p of this.projectiles) {
      const a = tileToScreen(p.fromTx, p.fromTy);
      const b = tileToScreen(p.toTx, p.toTy);
      const t = Math.max(0, Math.min(1, p.progress));
      if (p.kind === "beam") {
        g.moveTo(a.x, a.y - 45)
          .lineTo(b.x, b.y - 32)
          .stroke({ width: 6, color: p.color, alpha: 0.85 });
        g.moveTo(a.x, a.y - 45)
          .lineTo(b.x, b.y - 32)
          .stroke({ width: 2, color: 0xffffff, alpha: 0.95 });
      } else {
        const arcHeight = p.kind === "rock" ? 95 : 55;
        const x = a.x + (b.x - a.x) * t;
        const y = a.y - 38 + (b.y - a.y) * t - Math.sin(t * Math.PI) * arcHeight;
        const r = p.kind === "rock" ? 7 : p.kind === "energy_ball" ? 8 : 4;
        g.circle(x, y, r).fill({ color: p.color });
      }
    }
  }

  private updateVfx(dtMs: number): void {
    const dtSec = dtMs / 1000;
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i]!;
      ft.lifeMs += dtMs;
      ft.text.y += ft.vy * dtSec;
      ft.text.alpha = Math.max(0, 1 - ft.lifeMs / ft.maxLifeMs);
      if (ft.lifeMs >= ft.maxLifeMs) {
        ft.text.parent?.removeChild(ft.text);
        ft.text.destroy();
        this.floatingTexts.splice(i, 1);
      }
    }

    for (let i = this.spellEffects.length - 1; i >= 0; i--) {
      const se = this.spellEffects[i]!;
      se.lifeMs += dtMs;
      const p = Math.min(1, se.lifeMs / se.maxLifeMs);
      se.g.clear();
      const rx = se.maxRadiusPx * (0.25 + 0.75 * p);
      const ry = rx * 0.5;
      se.g
        .ellipse(se.wx, se.wy, rx, ry)
        .fill({ color: se.color, alpha: (1 - p) * 0.35 })
        .stroke({ width: 4, color: se.color, alpha: 1 - p });
      if (se.lifeMs >= se.maxLifeMs) {
        se.g.parent?.removeChild(se.g);
        se.g.destroy();
        this.spellEffects.splice(i, 1);
      }
    }
  }

  private updateSpriteAnimation(vis: EntityVisual, dtSec: number): void {
    const atlas = vis.atlas;
    if (!atlas) return;
    const { type, orientation, animState, scale, enlarged, hp, maxHp } = vis.data;

    let rootFrameNum = 1;
    let flipX: 1 | -1 = 1;
    if (type === "u") {
      const dirF = directionFrame(orientation || 5);
      flipX = directionScaleX(orientation || 5);
      rootFrameNum = animState * 5 + dirF;
      if (!atlas.meta.animations[`f${rootFrameNum}`]) {
        rootFrameNum = dirF;
      }
    } else {
      rootFrameNum = (orientation || 0) + 1;
    }

    const anim =
      atlas.meta.animations[`f${rootFrameNum}`] ??
      atlas.meta.animations["f1"] ??
      Object.values(atlas.meta.animations)[0];
    if (!anim || anim.frames.length === 0) return;

    let frameKey: string;
    if (type === "b") {
      // In Social Empires Flash SWFs, building/tree/farm sub-timelines store damage,
      // chop, or growth states (NOT looping animations). Hold frame 0 when intact so
      // trees, mines, farms, and structures never flicker at 24 FPS!
      if (anim.frames.length > 1 && hp < maxHp && maxHp > 0) {
        const dmgRatio = Math.max(0, Math.min(0.99, 1 - hp / maxHp));
        const idx = Math.min(anim.frames.length - 1, Math.floor(dmgRatio * anim.frames.length));
        frameKey = anim.frames[idx]!;
      } else {
        frameKey = anim.frames[0]!;
      }
    } else if (anim.frames.length === 1) {
      frameKey = anim.frames[0]!;
    } else {
      vis.animElapsed += dtSec;
      const frameIdx = Math.floor(vis.animElapsed * atlas.meta.fps) % anim.frames.length;
      frameKey = anim.frames[frameIdx]!;
    }

    const effScale = (scale ?? 1) * (enlarged ? 1.45 : 1);
    const cacheSig = `${frameKey}:${flipX}:${effScale.toFixed(2)}`;
    if (vis.lastFrameKey === cacheSig) return;
    vis.lastFrameKey = cacheSig;

    const frameEntry = atlas.textures.get(frameKey);
    if (!frameEntry) return;

    const sp = vis.sprite;
    sp.texture = frameEntry.texture;

    if (type === "u") {
      sp.anchor.set(
        frameEntry.rect.w > 0 ? frameEntry.rect.anchorX / frameEntry.rect.w : 0.5,
        frameEntry.rect.h > 0 ? frameEntry.rect.anchorY / frameEntry.rect.h : 0.85
      );
      sp.x = 0;
      sp.y = 0;
      sp.scale.set(flipX * effScale, effScale);
    } else {
      sp.anchor.set(0.5, 1.0);
      sp.x = 0;
      sp.y = 0;
      sp.scale.set(effScale, effScale);
    }
  }

  private bindInput(canvas: HTMLCanvasElement): void {
    const onPointerDown = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;

      // Always reset drag state for EVERY mouse button (including right-click!)
      this.dragMoved = false;
      this.downClientX = e.clientX;
      this.downClientY = e.clientY;

      if (e.button === 0 && e.shiftKey) {
        this.isBoxSelecting = true;
        this.boxStartX = sx;
        this.boxStartY = sy;
        canvas.setPointerCapture(e.pointerId);
        return;
      }

      if (e.button === 0 || e.button === 1) {
        this.isDragging = true;
        this.lastPointerX = e.clientX;
        this.lastPointerY = e.clientY;
        canvas.setPointerCapture(e.pointerId);
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;

      if (this.isBoxSelecting) {
        this.selectBoxLayer.clear();
        const x = Math.min(this.boxStartX, sx);
        const y = Math.min(this.boxStartY, sy);
        const w = Math.abs(sx - this.boxStartX);
        const h = Math.abs(sy - this.boxStartY);
        this.selectBoxLayer
          .rect(x, y, w, h)
          .fill({ color: 0x4ade80, alpha: 0.16 })
          .stroke({ width: 2, color: 0x4ade80, alpha: 0.9 });
        return;
      }

      if (this.isDragging) {
        const totalDist = Math.hypot(e.clientX - this.downClientX, e.clientY - this.downClientY);
        if (totalDist > 8) {
          this.dragMoved = true;
        }
        if (this.dragMoved) {
          const dx = e.clientX - this.lastPointerX;
          const dy = e.clientY - this.lastPointerY;
          this.camera.panByScreenDelta(dx, dy);
        }
        this.lastPointerX = e.clientX;
        this.lastPointerY = e.clientY;
        return;
      }

      const world = this.camera.screenToWorld(sx, sy);
      const t = screenToTile(world.x, world.y);
      const tx = Math.floor(t.tx);
      const ty = Math.floor(t.ty);
      if (!this.hoveredTile || this.hoveredTile.tx !== tx || this.hoveredTile.ty !== ty) {
        this.hoveredTile = { tx, ty };
        this.drawHoverOverlay(tx, ty);
        this.callbacks.onTileHover?.(tx, ty);
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;

      if (this.isBoxSelecting) {
        this.isBoxSelecting = false;
        this.selectBoxLayer.clear();
        if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
        const x0 = Math.min(this.boxStartX, sx);
        const y0 = Math.min(this.boxStartY, sy);
        const x1 = Math.max(this.boxStartX, sx);
        const y1 = Math.max(this.boxStartY, sy);
        const uids: number[] = [];
        for (const vis of this.visuals.values()) {
          if (vis.data.type !== "u" || vis.data.team !== "player") continue;
          const sp = this.camera.worldToScreen(vis.container.x, vis.container.y - 24);
          if (sp.x >= x0 && sp.x <= x1 && sp.y >= y0 && sp.y <= y1) {
            uids.push(vis.data.uid);
          }
        }
        this.setSelectedEntities(uids);
        this.callbacks.onBoxSelect?.(uids);
        return;
      }

      if (this.isDragging) {
        this.isDragging = false;
        if (canvas.hasPointerCapture(e.pointerId)) {
          canvas.releasePointerCapture(e.pointerId);
        }
      }

      const isClick = e.button === 2 || !this.dragMoved;
      if (isClick) {
        const world = this.camera.screenToWorld(sx, sy);
        const hit = this.pickEntityAtWorld(world.x, world.y);
        const t = screenToTile(world.x, world.y);

        const nowMs = performance.now();
        const doubleClick =
          e.button === 0 &&
          hit !== null &&
          this.lastClickUid === hit.uid &&
          nowMs - this.lastClickAt < 380;
        if (e.button === 0) {
          this.lastClickAt = nowMs;
          this.lastClickUid = hit ? hit.uid : null;
        }

        this.callbacks.onTileClick?.(Math.floor(t.tx), Math.floor(t.ty), e.button, hit, {
          ctrlKey: e.ctrlKey || e.metaKey,
          shiftKey: e.shiftKey,
          doubleClick
        });
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      this.camera.zoomAtScreenPoint(factor, sx, sy);
    };

    const onContextMenu = (e: MouseEvent) => e.preventDefault();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === "Escape") {
        this.callbacks.onEscape?.();
        return;
      }
      this.keysPressed.add(e.code);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      this.keysPressed.delete(e.code);
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
  }

  private drawHoverOverlay(tx: number, ty: number): void {
    this.hoverLayer.clear();
    if (tx < 0 || ty < 0 || tx >= 100 || ty >= 100) {
      this.ghostSprite.visible = false;
      return;
    }

    const p = tileToScreen(tx, ty);

    if (this.spellPreview) {
      this.ghostSprite.visible = false;
      const rx = this.spellPreview.radiusTiles * ISO_TILE_WIDTH * 0.52;
      const ry = rx * 0.5;
      this.hoverLayer
        .ellipse(p.x, p.y, rx, ry)
        .fill({ color: this.spellPreview.color, alpha: 0.22 })
        .stroke({ width: 3, color: this.spellPreview.color, alpha: 0.95 });
      return;
    }

    if (this.placementPreview) {
      const { width, height, valid } = this.placementPreview;
      const halfW = width * ISO_TILE_WIDTH * 0.5;
      const halfH = height * ISO_TILE_HEIGHT * 0.5;
      const col = valid ? 0x22c55e : 0xef4444;
      const baseY = p.y + ISO_TILE_HEIGHT * 0.5;
      this.hoverLayer
        .moveTo(p.x, baseY)
        .lineTo(p.x + halfW, baseY - halfH)
        .lineTo(p.x, baseY - halfH * 2)
        .lineTo(p.x - halfW, baseY - halfH)
        .closePath()
        .fill({ color: col, alpha: 0.3 })
        .stroke({ width: 3, color: col, alpha: 0.95 });
      this.ghostSprite.visible = true;
      this.ghostSprite.x = p.x;
      this.ghostSprite.y = baseY;
      this.ghostSprite.tint = valid ? 0xc6ffce : 0xff9e9e;
      return;
    }

    this.ghostSprite.visible = false;
    const hw = ISO_TILE_WIDTH * 0.5;
    const hh = ISO_TILE_HEIGHT * 0.5;
    this.hoverLayer
      .moveTo(p.x, p.y - hh)
      .lineTo(p.x + hw, p.y)
      .lineTo(p.x, p.y + hh)
      .lineTo(p.x - hw, p.y)
      .closePath()
      .fill({ color: 0xffffff, alpha: 0.14 })
      .stroke({ width: 1.5, color: 0xffe484, alpha: 0.75 });
  }

  private pickEntityAtWorld(wx: number, wy: number): RenderEntityData | null {
    const unitHits: EntityVisual[] = [];
    const bldgHits: EntityVisual[] = [];

    for (const vis of this.visuals.values()) {
      if (!vis.container.visible) continue;
      const sp = vis.sprite;
      if (sp.texture === Texture.EMPTY) continue;

      if (vis.data.type === "u") {
        // Flip-safe generous hitbox so villagers, knights, archers, and trolls are always easy to click
        const rawW = Math.max(58, Math.abs(sp.width) + 16);
        const rawH = Math.max(78, Math.abs(sp.height) + 16);
        const effAnchorX = sp.scale.x < 0 ? 1 - sp.anchor.x : sp.anchor.x;
        const x0 = vis.container.x - rawW * effAnchorX;
        const y0 = vis.container.y - rawH * Math.max(0.75, sp.anchor.y);
        if (wx >= x0 && wx <= x0 + rawW && wy >= y0 && wy <= y0 + rawH) {
          unitHits.push(vis);
        }
      } else {
        // Trim outer 12% horizontal transparent margins on large structures so units nearby stay clickable
        const fullW = Math.abs(sp.width);
        const fullH = Math.abs(sp.height);
        const padX = fullW > 140 ? fullW * 0.12 : 0;
        const x0 = vis.container.x - fullW * sp.anchor.x + padX;
        const x1 = vis.container.x + fullW * (1 - sp.anchor.x) - padX;
        const y0 = vis.container.y - fullH * sp.anchor.y;
        const y1 = vis.container.y + fullH * (1 - sp.anchor.y);
        if (wx >= x0 && wx <= x1 && wy >= y0 && wy <= y1) {
          bldgHits.push(vis);
        }
      }
    }

    // Units always take click priority over overlapping building sprite rectangles
    if (unitHits.length > 0) {
      unitHits.sort((a, b) => b.container.zIndex - a.container.zIndex);
      return unitHits[0]!.data;
    }
    if (bldgHits.length > 0) {
      bldgHits.sort((a, b) => b.container.zIndex - a.container.zIndex);
      return bldgHits[0]!.data;
    }
    return null;
  }

  getMetrics(): RendererMetrics {
    const n = this.frameTimes.length;
    if (n === 0) {
      return {
        fps: 0,
        frameTimeMs: 0,
        p95FrameMs: 0,
        cpuTimeMs: 0,
        visibleEntities: this.visibleCount,
        totalEntities: this.visuals.size,
        loadedAtlases: this.atlasLoader.loadedCount,
        rendererType: this.rendererType
      };
    }
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / n;
    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    const p95 = sorted[Math.min(n - 1, Math.floor(n * 0.95))] ?? avg;
    const cpuAvg =
      this.cpuTimes.length > 0
        ? this.cpuTimes.reduce((a, b) => a + b, 0) / this.cpuTimes.length
        : 0;
    return {
      fps: Math.round(1000 / Math.max(0.1, avg)),
      frameTimeMs: Number(avg.toFixed(2)),
      p95FrameMs: Number(p95.toFixed(2)),
      cpuTimeMs: Number(cpuAvg.toFixed(2)),
      visibleEntities: this.visibleCount,
      totalEntities: this.visuals.size,
      loadedAtlases: this.atlasLoader.loadedCount,
      rendererType: this.rendererType
    };
  }

  destroy(): void {
    this.destroyed = true;
    this.resizeObserver?.disconnect();
    this.atlasLoader.destroy();
    this.app?.destroy(true);
    this.app = null;
  }
}
