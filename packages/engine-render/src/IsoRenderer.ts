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

const SUBCAT_BUILDING_FARM = 122;

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
  animSeq?: number; // Increments per attack/special to restart clip from frame 0
  velocity?: number;
  speed2x?: boolean;
  subcatFunctional?: number;
  hp: number;
  maxHp: number;
  flying: boolean;
  scale?: number;
  selected?: boolean;
  team?: "player" | "enemy" | "neutral";
  limitRatio?: number;
  collectReady?: boolean;
  collectType?: string;
  buildingVisualState?: "idle" | "working_male" | "working_female" | "ready_male" | "ready_female" | "loop";
  statusBadge?: "collect" | "zzz" | "ready_nest" | null;
  biomeIndex?: number;
  garrisonCount?: number;
  inCombat?: boolean;
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

export type NumberParticleKind =
  | "damage_self"
  | "damage_enemy"
  | "heal"
  | "absorbed"
  | "gold"
  | "wood"
  | "stone"
  | "food"
  | "xp"
  | "mana"
  | "info";

/**
 * Exact Social Empires 1.4.07 `NumberParticle.as:172-230` color palette.
 */
export const NUMBER_PARTICLE_COLORS: Readonly<Record<NumberParticleKind, number>> = {
  damage_self: 0xff2424, // Constants.COST_DAMAGE_SELF (16711680)
  damage_enemy: 0xffffff, // Crisp white with heavy dark outline (crit -> gold)
  heal: 0x22ff55, // Constants.COST_HEAL (65280)
  absorbed: 0x00afef, // Constants.COST_ABSORBED (44975)
  gold: 0xffc400, // CostType.GOLD (16761856)
  wood: 0xe08a3c, // CostType.WOOD (12875048 brightened for dark ground)
  stone: 0xd6d3d1, // CostType.STONE
  food: 0xff5c72, // CostType.FOOD
  xp: 0x38bdf8, // Constants.COST_XP
  mana: 0x38bdf8, // Constants.COST_MANA (2595484)
  info: 0xffe484
};

export interface IsoRendererCallbacks {
  onEntitySelect?: (entity: RenderEntityData | null, additive: boolean) => void;
  onBoxSelect?: (uids: number[]) => void;
  onTileHover?: (tx: number, ty: number, hoveredEntity: RenderEntityData | null) => void;
  onTileClick?: (
    tx: number,
    ty: number,
    button: number,
    hitEntity: RenderEntityData | null,
    modifiers?: ClickModifiers
  ) => void;
  onExpansionClick?: (expId: number) => void;
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
  lastAnimState: number;
  lastAnimSeq: number;
  lastFrameKey: string;
  lastOverlaySig: string;
  spriteTopOffset: number;
}

interface FloatingTextItem {
  text: Text;
  vx: number;
  vy: number;
  gravity: number;
  baseScale: number;
  crit: boolean;
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

/**
 * Exact `IsoUnit.directionFrame` (`IsoUnit.as:401-404`):
 * orientations 1..5 map directly to 1..5; mirrored orientations 6..8 map to 2..4.
 */
export function directionFrame(orientation: number): number {
  return orientation > 5 ? orientation - 4 : Math.max(1, Math.min(5, orientation));
}

/**
 * Exact `IsoUnit.directionScaleX` (`IsoUnit.as:406-409`):
 * orientations 6..8 are horizontally mirrored (`-1`).
 */
export function directionScaleX(orientation: number): 1 | -1 {
  return orientation > 5 ? -1 : 1;
}

/**
 * Computes frame index for a sprite animation respecting Social Empires 1.4.07 rules:
 * - Dying (`animState === 3`) plays once and holds final frame.
 * - Attack/special plays cleanly from frame 0 per `animSeq`.
 * - Walking scales gently with unit `velocity` and `speed2x`.
 */
export function computeAnimationFrameIndex(
  animState: number,
  frameCount: number,
  animElapsedSec: number,
  fps: number,
  velocity = 3,
  speed2x = false
): number {
  if (frameCount <= 1) return 0;
  let rate = fps;
  if (animState === 1) {
    const velRatio = Math.max(0.75, Math.min(2.1, (velocity || 3) / 3.0));
    rate = fps * velRatio * (speed2x ? 1.75 : 1.0);
  }
  const rawIdx = Math.max(0, Math.floor(animElapsedSec * rate));
  if (animState === 3 || animState === 2 || animState >= 6) {
    // One-shot animations (die, single attack swing, special attack) hold last frame cleanly
    return Math.min(frameCount - 1, rawIdx);
  }
  return rawIdx % frameCount;
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
  private readonly expansionMarkersLayer = new Container();
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
  private boxSelectDefault = false;
  private selectedUids = new Set<number>();
  private hoveredEntityUid: number | null = null;
  private hoveredTile: { tx: number; ty: number } | null = null;
  private placementPreview: PlacementPreview | null = null;
  private spellPreview: SpellPreview | null = null;
  private renderAlpha = 1;

  // Input state
  private isDragging = false;
  private dragButton = 0;
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
  private panVelX = 0;
  private panVelY = 0;
  private hoverPickThrottle = 0;

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
    this.worldRoot.addChild(this.expansionMarkersLayer);
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

  /**
   * Controls whether left-click drag draws a troop selection marquee (true, default in Battle)
   * or pans the camera (false, default in Village). Right-drag & middle-drag always pan.
   */
  setBoxSelectDefault(enabled: boolean): void {
    this.boxSelectDefault = enabled;
  }

  setCursorStyle(cursorCss: string): void {
    if (this.app?.canvas) {
      this.app.canvas.style.cursor = cursorCss;
    }
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

  /**
   * Spawns a floating combat/resource number faithful to `core/NumberParticle.as`
   * (30 frames = 1.0s lifespan, upward float with slight gravity, 1.3x crit scale,
   * solid alpha for first 500ms then linear fade).
   */
  spawnNumberParticle(
    tx: number,
    ty: number,
    kind: NumberParticleKind,
    label: string,
    crit = false
  ): void {
    if (this.destroyed || this.floatingTexts.length > 72) return;
    const pos = tileToScreen(tx, ty);
    const fillCol = crit && kind === "damage_enemy" ? 0xffe066 : NUMBER_PARTICLE_COLORS[kind];
    const baseScale = crit ? 1.32 : 1.05;

    const txt = new Text({
      text: label,
      style: {
        fontFamily: "Nunito, Arial Rounded MT Bold, Trebuchet MS, sans-serif",
        fontSize: crit ? 20 : 17,
        fontWeight: "900",
        fill: fillCol,
        stroke: { color: 0x160a03, width: crit ? 5 : 4 }
      }
    });
    txt.anchor.set(0.5, 1.0);
    txt.x = pos.x + (Math.random() * 22 - 11);
    txt.y = pos.y - 46;
    txt.scale.set(baseScale * (crit ? 1.25 : 1.0));
    this.vfxLayer.addChild(txt);
    this.floatingTexts.push({
      text: txt,
      vx: (Math.random() - 0.5) * 8,
      vy: -62, // 2 px/frame * 30 FPS (`NumberParticle.as:44`)
      gravity: 12,
      baseScale,
      crit,
      lifeMs: 0,
      maxLifeMs: 1000 // 30 frames @ 30 FPS (`NumberParticle.as:13`)
    });
  }

  spawnFloatingText(tx: number, ty: number, label: string, color = 0xffe484): void {
    if (this.destroyed || this.floatingTexts.length > 72) return;
    const pos = tileToScreen(tx, ty);
    const txt = new Text({
      text: label,
      style: {
        fontFamily: "Nunito, Arial Rounded MT Bold, Trebuchet MS, sans-serif",
        fontSize: 16,
        fontWeight: "900",
        fill: color,
        stroke: { color: 0x1a0d04, width: 4 }
      }
    });
    txt.anchor.set(0.5, 1.0);
    txt.x = pos.x + (Math.random() * 24 - 12);
    txt.y = pos.y - 44;
    this.vfxLayer.addChild(txt);
    this.floatingTexts.push({
      text: txt,
      vx: 0,
      vy: -56,
      gravity: 10,
      baseScale: 1.0,
      crit: false,
      lifeMs: 0,
      maxLifeMs: 1050
    });
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

    // Rebuild canonical `btnBuyExpandTileMC` ("En venta / Clic para comprar") signs on adjacent locked quadrants
    for (const child of this.expansionMarkersLayer.removeChildren()) {
      child.destroy({ children: true });
    }
    const ownedCoords = new Set<string>();
    for (const slot of this.terrainSprites) {
      if (this.ownedExpansions.has(slot.expId)) {
        ownedCoords.add(`${slot.col},${slot.row}`);
      }
    }
    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1]
    ] as const;

    for (const slot of this.terrainSprites) {
      if (this.ownedExpansions.has(slot.expId)) continue;
      const isAdjacent = dirs.some(([dc, dr]) => ownedCoords.has(`${slot.col + dc},${slot.row + dr}`));
      if (!isAdjacent) continue;

      const centerTx = slot.col * EXPANSION_SIZE_TILES + EXPANSION_SIZE_TILES * 0.5;
      const centerTy = slot.row * EXPANSION_SIZE_TILES + EXPANSION_SIZE_TILES * 0.5;
      const pos = tileToScreen(centerTx, centerTy);

      const sign = new Container();
      sign.x = pos.x;
      sign.y = pos.y;
      sign.eventMode = "static";
      sign.cursor = "pointer";

      // Subtle dashed golden boundary diamond for the buyable 20x20 expansion
      const c0 = tileToScreen(slot.col * EXPANSION_SIZE_TILES, slot.row * EXPANSION_SIZE_TILES);
      const c1 = tileToScreen((slot.col + 1) * EXPANSION_SIZE_TILES, slot.row * EXPANSION_SIZE_TILES);
      const c2 = tileToScreen((slot.col + 1) * EXPANSION_SIZE_TILES, (slot.row + 1) * EXPANSION_SIZE_TILES);
      const c3 = tileToScreen(slot.col * EXPANSION_SIZE_TILES, (slot.row + 1) * EXPANSION_SIZE_TILES);
      const border = new Graphics();
      border
        .moveTo(c0.x - pos.x, c0.y - pos.y)
        .lineTo(c1.x - pos.x, c1.y - pos.y)
        .lineTo(c2.x - pos.x, c2.y - pos.y)
        .lineTo(c3.x - pos.x, c3.y - pos.y)
        .closePath()
        .fill({ color: 0xfacc15, alpha: 0.05 })
        .stroke({ width: 2.5, color: 0xfde047, alpha: 0.45 });
      sign.addChild(border);

      // Authentic `btnBuyExpandTileMC`: warm wooden signpost + tilted plank "EN VENTA" + white pill "Clic para comprar"
      const bg = new Graphics();
      // Wooden post
      bg.roundRect(-6, 12, 12, 24, 3).fill({ color: 0xb97a3d }).stroke({ width: 1.5, color: 0x5c3412 });
      // Slightly tilted wooden board
      bg.moveTo(-42, -26)
        .lineTo(42, -29)
        .lineTo(40, 12)
        .lineTo(-40, 14)
        .closePath()
        .fill({ color: 0xd99b52 })
        .stroke({ width: 2, color: 0x6b3c14 });
      // Top highlight plank & nail
      bg.moveTo(-39, -23).lineTo(39, -26).stroke({ width: 2, color: 0xf4c77f, alpha: 0.7 });
      bg.circle(0, -20, 4).fill({ color: 0xc2b296 }).stroke({ width: 1.2, color: 0x4a2c0e });
      // Clean white rounded pill underneath ("Clic para comprar")
      bg.roundRect(-48, 22, 96, 19, 6)
        .fill({ color: 0xfffef8, alpha: 0.96 })
        .stroke({ width: 1.4, color: 0xc9b58e });
      sign.addChild(bg);

      const title = new Text({
        text: "EN VENTA",
        style: {
          fontFamily: "Nunito, Arial Rounded MT Bold, sans-serif",
          fontSize: 13,
          fontWeight: "900",
          fill: 0x5c3412
        }
      });
      title.anchor.set(0.5, 0.5);
      title.y = -4;
      sign.addChild(title);

      const sub = new Text({
        text: "Clic para comprar",
        style: {
          fontFamily: "Nunito, sans-serif",
          fontSize: 9.5,
          fontWeight: "800",
          fill: 0x1c1208
        }
      });
      sub.anchor.set(0.5, 0.5);
      sub.y = 31.5;
      sign.addChild(sub);

      const expId = slot.expId;
      sign.on("pointerover", () => {
        sign.scale.set(1.06);
      });
      sign.on("pointerout", () => {
        sign.scale.set(1.0);
      });
      sign.on("pointertap", (ev) => {
        ev.stopPropagation();
        this.callbacks.onExpansionClick?.(expId);
      });

      this.expansionMarkersLayer.addChild(sign);
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
    this.hoveredEntityUid = null;
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
    const prevSet = this.selectedUids;
    this.selectedUids = new Set(uids);
    for (const prevId of prevSet) {
      const prev = this.visuals.get(prevId);
      if (prev) {
        prev.selectionRing.visible = this.selectedUids.has(prevId);
        this.updateStatusOverlays(prev);
      }
    }
    for (const uid of this.selectedUids) {
      const vis = this.visuals.get(uid);
      if (vis) {
        this.drawSelectionRing(vis);
        vis.selectionRing.visible = true;
        this.updateStatusOverlays(vis);
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
      animElapsed: ent.animState === 0 ? Math.random() * 1.5 : 0,
      lastAnimState: ent.animState,
      lastAnimSeq: ent.animSeq ?? 0,
      lastFrameKey: "",
      lastOverlaySig: "",
      spriteTopOffset: ent.type === "b" ? Math.max(66, ent.height * 36) : 70
    };

    this.visuals.set(ent.uid, vis);
    this.positionEntityVisual(vis, 1);
    if (selectionRing.visible) this.drawSelectionRing(vis);
    this.updateStatusOverlays(vis);
    if (vis.atlas) this.updateSpriteAnimation(vis, 0);
  }

  /**
   * Exact 1:1 isometric placement & z-ordering (`Utils.TileToPixel`, `Utils.assignZIndex`, `IsoElement.setGraphic`):
   * - Units (`type === "u"`) stand centered at the diamond midpoint `(pos.x, pos.y)` so feet & selection ring align 1:1.
   * - Buildings (`type === "b"`) anchor their south footprint corner at `(pos.x, pos.y + 27)`.
   * - Farms (`SUBCATFUNC_BUILDING_FARM = 122`) subtract `20000` from zIndex so units walk cleanly on top.
   */
  private positionEntityVisual(vis: EntityVisual, alpha: number): void {
    const { tx, ty, prevTx, prevTy, width, height, type, subcatFunctional } = vis.data;
    const itx = prevTx !== undefined ? prevTx + (tx - prevTx) * alpha : tx;
    const ity = prevTy !== undefined ? prevTy + (ty - prevTy) * alpha : ty;
    const pos = tileToScreen(itx, ity);
    const nextX = pos.x;
    const nextY = type === "u" ? pos.y : pos.y + ISO_TILE_HEIGHT * 0.5;
    if (vis.container.x !== nextX) vis.container.x = nextX;
    if (vis.container.y !== nextY) vis.container.y = nextY;

    const centerTx = itx - (width - 1) * 0.5;
    const centerTy = ity - (height - 1) * 0.5;
    const farmOffset = type === "b" && subcatFunctional === SUBCAT_BUILDING_FARM ? -20000 : 0;
    const nextZ =
      farmOffset +
      (centerTx + centerTy) * 1000 +
      (type === "u" ? 140 : 0) +
      (centerTx - centerTy) * 0.01;
    if (vis.container.zIndex !== nextZ) vis.container.zIndex = nextZ;
  }

  /**
   * Classic Social Empires `BarraVidaMC` / `BarraVidaEnemyMC` & `LimitBarMC` overlays
   * (`IsoFightingElement.as:162-182, 826-841` & `IsoInteractiveElement.as:321-340`):
   * - Shown only when damaged, selected, hovered, or actively in combat.
   * - Positioned dynamically at `-spriteTopOffset - 6` above the real sprite crown.
   */
  private updateStatusOverlays(vis: EntityVisual): void {
    const d = vis.data;
    const isSel = this.selectedUids.has(d.uid);
    const isHov = this.hoveredEntityUid === d.uid;
    const showHp = (d.hp < d.maxHp || isSel || isHov || Boolean(d.inCombat)) && d.maxHp > 1;
    const yTop = Math.round(vis.spriteTopOffset);

    const badge = d.statusBadge ?? (d.collectReady ? "collect" : null);
    const sig = `${Math.round(d.hp)}/${d.maxHp}|${showHp ? 1 : 0}|${isSel ? 1 : 0}|${d.team}|${badge ?? ""}|${d.collectType ?? ""}|${d.frozen ? 1 : 0}|${d.poisoned ? 1 : 0}|${d.shielded ? 1 : 0}|${Math.round((d.limitRatio ?? 0) * 20)}|${yTop}`;
    if (vis.lastOverlaySig === sig) return;
    vis.lastOverlaySig = sig;

    if (d.frozen) vis.sprite.tint = 0x7dd3fc;
    else if (d.poisoned) vis.sprite.tint = 0x86efac;
    else if (d.shielded) vis.sprite.tint = 0xfef08a;
    else vis.sprite.tint = 0xffffff;

    vis.hpBar.visible = showHp;
    if (vis.hpBar.visible) {
      const g = vis.hpBar;
      g.clear();
      const bw = d.type === "b" ? Math.min(82, Math.max(54, d.width * 24)) : d.limitRatio !== undefined && d.maxHp >= 500 ? 48 : 38;
      const bh = 7;
      const yOff = -yTop - 8;
      const ratio = Math.max(0, Math.min(1, d.hp / Math.max(1, d.maxHp)));

      // Beveled Socialpoint dark-bronze frame
      g.roundRect(-bw / 2 - 1, yOff - 1, bw + 2, bh + 2, 2)
        .fill({ color: 0x1c0f06, alpha: 0.92 })
        .stroke({ width: 1, color: d.team === "enemy" ? 0x7f1d1d : 0xd4a24c, alpha: 0.9 });

      // Depleted red damage track (`barraRoja`)
      g.rect(-bw / 2 + 1, yOff + 1, bw - 2, bh - 2).fill({ color: 0x5c1111 });

      // Remaining health fill (`BarraVidaMC` green vs `BarraVidaEnemyMC` crimson)
      const fillW = Math.max(0, (bw - 2) * ratio);
      if (fillW > 0) {
        const mainCol =
          d.team === "enemy"
            ? 0xef4444
            : ratio > 0.45
              ? 0x22c55e
              : ratio > 0.22
                ? 0xf59e0b
                : 0xef4444;
        const hiCol = d.team === "enemy" ? 0xfca5a5 : ratio > 0.45 ? 0x86efac : 0xfde68a;
        g.rect(-bw / 2 + 1, yOff + 1, fillW, bh - 2).fill({ color: mainCol });
        g.rect(-bw / 2 + 1, yOff + 1, fillW, 1.5).fill({ color: hiCol, alpha: 0.65 });
      }

      // Limit Gauge bar (`LimitBarMC`) directly underneath for Limit units
      if (d.limitRatio && d.limitRatio > 0) {
        const clamped = Math.min(1, d.limitRatio);
        const ready = clamped >= 0.999;
        g.rect(-bw / 2, yOff + bh + 2, bw, 4).fill({ color: 0x0f172a, alpha: 0.9 });
        g.rect(-bw / 2 + 1, yOff + bh + 3, (bw - 2) * clamped, 2).fill({
          color: ready ? 0xfacc15 : 0x38bdf8
        });
      }
    }

    vis.collectBadge.visible = badge !== null;
    if (vis.collectBadge.visible) {
      const g = vis.collectBadge;
      g.clear();
      const yOff = -yTop - 22;
      if (badge === "collect") {
        // Canonical `IconCollect.as` crisp white floating speech bubble (`image.png` top-right farms)
        const ct = (d.collectType || "g").toLowerCase();
        // Bottom speech-bubble pointer
        g.moveTo(-5, yOff + 11)
          .lineTo(5, yOff + 11)
          .lineTo(0, yOff + 18)
          .closePath()
          .fill({ color: 0xffffff })
          .stroke({ width: 1.5, color: 0x6b7280 });
        // Crisp white rounded square bubble
        g.roundRect(-15, yOff - 14, 30, 26, 6)
          .fill({ color: 0xffffff, alpha: 0.97 })
          .stroke({ width: 1.8, color: 0x9ca3af });

        if (ct === "w") {
          // Wood log icon
          g.roundRect(-8, yOff - 4, 16, 7, 3).fill({ color: 0xb45309 }).stroke({ width: 1.4, color: 0x451a03 });
          g.circle(5.5, yOff - 0.5, 3).fill({ color: 0xfde68a }).stroke({ width: 1, color: 0x78350f });
        } else if (ct === "s") {
          // Stone icon
          g.moveTo(-7, yOff + 4)
            .lineTo(-5, yOff - 5)
            .lineTo(4, yOff - 6)
            .lineTo(8, yOff + 1)
            .lineTo(4, yOff + 6)
            .closePath()
            .fill({ color: 0x94a3b8 })
            .stroke({ width: 1.4, color: 0x334155 });
        } else if (ct === "f") {
          // Classic red steak/meat food icon matching `image.png`
          g.ellipse(0, yOff - 1, 9.5, 6.2).fill({ color: 0xdc2626 }).stroke({ width: 1.5, color: 0x7f1d1d });
          g.ellipse(-1, yOff - 1.5, 5.8, 3.2).fill({ color: 0xfca5a5, alpha: 0.75 });
          g.circle(3, yOff - 1, 2).fill({ color: 0xffffff });
        } else if (ct === "c") {
          // Cash bill icon
          g.roundRect(-9, yOff - 5, 18, 10, 2).fill({ color: 0x22c55e }).stroke({ width: 1.4, color: 0x14532d });
          g.circle(0, yOff, 2.8).fill({ color: 0xfef08a });
        } else {
          // Gold ingot/coin icon
          g.roundRect(-8, yOff - 4, 16, 8, 2).fill({ color: 0xfacc15 }).stroke({ width: 1.5, color: 0x92400e });
          g.roundRect(-5, yOff - 6, 10, 4, 1.5).fill({ color: 0xfef08a }).stroke({ width: 1, color: 0xb45309 });
        }
      } else if (badge === "zzz") {
        // Canonical `PopupCollect.addIconZZ` / `NestsManager` idle-attention bubble
        g.roundRect(-14, yOff - 10, 28, 20, 8)
          .fill({ color: 0x1e3a8a, alpha: 0.95 })
          .stroke({ width: 2, color: 0x93c5fd });
        // Crisp stylized 'Z' glyph inside bubble
        g.moveTo(-6, yOff - 4)
          .lineTo(6, yOff - 4)
          .lineTo(-6, yOff + 4)
          .lineTo(6, yOff + 4)
          .stroke({ width: 2.4, color: 0xfef08a });
      } else if (badge === "ready_nest") {
        // Ready-to-hatch / ready-to-care nest star badge
        g.circle(0, yOff, 13)
          .fill({ color: 0x10b981 })
          .stroke({ width: 2.5, color: 0xfef08a });
        g.moveTo(0, yOff - 6)
          .lineTo(0, yOff + 1)
          .stroke({ width: 3, color: 0xffffff });
        g.circle(0, yOff + 5, 1.8).fill({ color: 0xffffff });
      }
    }
  }

  private drawSelectionRing(vis: EntityVisual): void {
    const g = vis.selectionRing;
    g.clear();
    const { width, height, type, team } = vis.data;
    const color = team === "enemy" ? 0xf87171 : 0x4ade80;
    if (type === "u") {
      g.ellipse(0, 0, 27, 13.5).fill({ color, alpha: 0.16 });
      g.ellipse(0, 0, 27, 13.5).stroke({ width: 2.5, color, alpha: 0.95 });
      g.ellipse(0, 0, 22, 10.5).stroke({ width: 1, color: 0xffffff, alpha: 0.45 });
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

    // Advance fixed-step simulation before rendering interpolated positions
    this.callbacks.onTickFrame?.(dtMs);

    // Smooth WASD/Arrow camera panning with acceleration/damping
    const dtSec = Math.min(0.1, dtMs / 1000);
    let inX = 0;
    let inY = 0;
    if (this.keysPressed.has("KeyW") || this.keysPressed.has("ArrowUp")) inY += 1;
    if (this.keysPressed.has("KeyS") || this.keysPressed.has("ArrowDown")) inY -= 1;
    if (this.keysPressed.has("KeyA") || this.keysPressed.has("ArrowLeft")) inX += 1;
    if (this.keysPressed.has("KeyD") || this.keysPressed.has("ArrowRight")) inX -= 1;

    const maxPanSpeed = 680;
    const damp = 1 - Math.exp(-14 * dtSec);
    this.panVelX += (inX * maxPanSpeed - this.panVelX) * damp;
    this.panVelY += (inY * maxPanSpeed - this.panVelY) * damp;
    if (Math.abs(this.panVelX) > 2 || Math.abs(this.panVelY) > 2) {
      this.camera.panByScreenDelta(this.panVelX * dtSec, this.panVelY * dtSec);
    } else {
      this.panVelX = 0;
      this.panVelY = 0;
    }

    // Advance smooth zoom / pan-to-target camera transitions
    this.camera.update(dtMs);

    const camTf = this.camera.getWorldTransform();
    this.worldRoot.x = camTf.x;
    this.worldRoot.y = camTf.y;
    this.worldRoot.scale.set(camTf.scale);

    // Frustum-cull the 5x5 terrain expansion sprites
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
      if (vis.collectBadge.visible) {
        vis.collectBadge.y = Math.sin(now * 0.0055 + vis.data.uid) * 5.5;
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
      ft.text.x += ft.vx * dtSec;
      ft.text.y += ft.vy * dtSec;
      ft.vy += ft.gravity * dtSec;
      // Canonical `NumberParticle.as:255`: alpha = min(1, remaining * 2 / maxLife)
      const remaining = Math.max(0, ft.maxLifeMs - ft.lifeMs);
      ft.text.alpha = Math.min(1, (remaining * 2) / ft.maxLifeMs);
      if (ft.crit && ft.lifeMs < 160) {
        const pop = 1 + 0.25 * (1 - ft.lifeMs / 160);
        ft.text.scale.set(ft.baseScale * pop);
      } else if (ft.crit) {
        ft.text.scale.set(ft.baseScale);
      }
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
    const { type, orientation, animState, animSeq, velocity, speed2x, scale, enlarged, hp, maxHp, width } = vis.data;

    // Reset animation elapsed timer on state transition or new attack swing (`IsoUnit.as:2744-2765`)
    const curSeq = animSeq ?? 0;
    if (vis.lastAnimState !== animState || vis.lastAnimSeq !== curSeq) {
      vis.lastAnimState = animState;
      vis.lastAnimSeq = curSeq;
      vis.animElapsed = 0;
    }

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
      const animMode = atlas.meta.animMode;
      const subcat = vis.data.subcatFunctional ?? 0;
      const bState = vis.data.buildingVisualState;
      if (orientation === 1 && !atlas.meta.animations["f2"]) {
        flipX = -1;
      }

      if ((animMode === "loop" || bState === "loop") && anim.frames.length > 1) {
        // Canonical nested-animated buildings (Dragon Nest 1233_criadero, Monster Nest 1255_monsternest, etc.)
        vis.animElapsed += dtSec;
        const fps = Math.max(4, Math.min(30, atlas.meta.fps || 14));
        const idx = Math.floor(vis.animElapsed * fps) % anim.frames.length;
        frameKey = anim.frames[idx]!;
      } else if ((animMode === "farm" || subcat === SUBCAT_BUILDING_FARM) && anim.frames.length >= 22) {
        // Canonical `IsoElement.as:1065-1111`: 45-frame farm SWF timeline
        // 0=empty, 1..20=male sowing, 21..42=female sowing, 43=male ready, 44=female ready
        if (bState === "working_male") {
          vis.animElapsed += dtSec;
          const span = Math.min(20, anim.frames.length - 1);
          const idx = 1 + (Math.floor(vis.animElapsed * 10) % Math.max(1, span));
          frameKey = anim.frames[idx]!;
        } else if (bState === "working_female") {
          vis.animElapsed += dtSec;
          const start = Math.min(21, anim.frames.length - 1);
          const span = Math.max(1, Math.min(22, anim.frames.length - 2 - start));
          const idx = start + (Math.floor(vis.animElapsed * 10) % span);
          frameKey = anim.frames[idx]!;
        } else if (bState === "ready_male") {
          frameKey = anim.frames[Math.min(43, anim.frames.length - 1)]!;
        } else if (bState === "ready_female") {
          frameKey = anim.frames[Math.min(44, anim.frames.length - 1)]!;
        } else {
          frameKey = anim.frames[0]!;
        }
      } else if ((animMode === "tree" || subcat === 125) && anim.frames.length > 1) {
        // Canonical `IsoElement.as`: tree frame corresponds to biome skin index
        const idx = Math.abs(vis.data.biomeIndex ?? 0) % anim.frames.length;
        frameKey = anim.frames[idx]!;
      } else if ((animMode === "ranch" || subcat === 123) && anim.frames.length > 1) {
        const idx = Math.min(anim.frames.length - 1, Math.max(0, vis.data.garrisonCount ?? 0));
        frameKey = anim.frames[idx]!;
      } else if (anim.frames.length > 1 && hp < maxHp && maxHp > 0) {
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
      const frameIdx = computeAnimationFrameIndex(
        animState,
        anim.frames.length,
        vis.animElapsed,
        atlas.meta.fps,
        velocity,
        speed2x
      );
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
      const ax = frameEntry.rect.w > 0 ? frameEntry.rect.anchorX / frameEntry.rect.w : 0.5;
      const ay = frameEntry.rect.h > 0 ? frameEntry.rect.anchorY / frameEntry.rect.h : 0.88;
      sp.anchor.set(ax, ay);
      sp.x = 0;
      sp.y = 0;
      sp.scale.set(flipX * effScale, effScale);
      const topH = Math.max(44, Math.min(220, frameEntry.rect.h * ay * effScale));
      if (Math.abs(vis.spriteTopOffset - topH) > 4) {
        vis.spriteTopOffset = topH;
        this.updateStatusOverlays(vis);
      }
    } else {
      // Compensate asymmetric horizontal trim when `extract_sprites.py` preserved negative `anchorX`
      let bx = 0.5;
      if (frameEntry.rect.w > 0 && frameEntry.rect.anchorX < 0) {
        const trimLeft = -frameEntry.rect.anchorX;
        const expectedFootW = width * ISO_TILE_WIDTH;
        if (frameEntry.rect.w + trimLeft <= expectedFootW + 24) {
          bx = Math.max(0.3, Math.min(0.7, (expectedFootW * 0.5 - trimLeft) / frameEntry.rect.w));
        }
      }
      sp.anchor.set(bx, 1.0);
      sp.x = 0;
      sp.y = 0;
      sp.scale.set(flipX * effScale, effScale);
      const topH = Math.max(52, Math.min(360, frameEntry.rect.h * effScale));
      if (Math.abs(vis.spriteTopOffset - topH) > 4) {
        vis.spriteTopOffset = topH;
        this.updateStatusOverlays(vis);
      }
    }
  }

  private bindInput(canvas: HTMLCanvasElement): void {
    const onPointerDown = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;

      this.dragMoved = false;
      this.downClientX = e.clientX;
      this.downClientY = e.clientY;
      this.dragButton = e.button;

      const wantBoxSelect =
        e.button === 0 &&
        !this.placementPreview &&
        !this.spellPreview &&
        (e.shiftKey || this.boxSelectDefault);

      if (wantBoxSelect) {
        this.isBoxSelecting = true;
        this.boxStartX = sx;
        this.boxStartY = sy;
        canvas.setPointerCapture(e.pointerId);
        return;
      }

      if (e.button === 0 || e.button === 1 || e.button === 2) {
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
        const totalDist = Math.hypot(e.clientX - this.downClientX, e.clientY - this.downClientY);
        if (totalDist > 7) {
          this.dragMoved = true;
          this.selectBoxLayer.clear();
          const x = Math.min(this.boxStartX, sx);
          const y = Math.min(this.boxStartY, sy);
          const w = Math.abs(sx - this.boxStartX);
          const h = Math.abs(sy - this.boxStartY);
          this.selectBoxLayer
            .rect(x, y, w, h)
            .fill({ color: 0x4ade80, alpha: 0.16 })
            .stroke({ width: 2, color: 0x4ade80, alpha: 0.92 });
        }
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
      const nowMs = performance.now();
      const tileChanged = !this.hoveredTile || this.hoveredTile.tx !== tx || this.hoveredTile.ty !== ty;

      if (tileChanged || nowMs - this.hoverPickThrottle > 45) {
        this.hoverPickThrottle = nowMs;
        const hit = this.pickEntityAtWorld(world.x, world.y);
        const prevHov = this.hoveredEntityUid;
        this.hoveredEntityUid = hit ? hit.uid : null;
        if (prevHov !== this.hoveredEntityUid) {
          if (prevHov !== null) {
            const pv = this.visuals.get(prevHov);
            if (pv) this.updateStatusOverlays(pv);
          }
          if (this.hoveredEntityUid !== null) {
            const nv = this.visuals.get(this.hoveredEntityUid);
            if (nv) this.updateStatusOverlays(nv);
          }
        }
        if (tileChanged) {
          this.hoveredTile = { tx, ty };
          this.drawHoverOverlay(tx, ty);
        }
        this.callbacks.onTileHover?.(tx, ty, hit);
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
        if (this.dragMoved) {
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
        // Short click without drag falls through to normal click handling below!
      }

      if (this.isDragging) {
        this.isDragging = false;
        if (canvas.hasPointerCapture(e.pointerId)) {
          canvas.releasePointerCapture(e.pointerId);
        }
      }

      const isClick = !this.dragMoved && (e.button === 0 || e.button === 2);
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
      this.dragButton = 0;
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.14 : 1 / 1.14;
      this.camera.smoothZoomAtScreenPoint(factor, sx, sy);
    };

    const onContextMenu = (e: MouseEvent) => e.preventDefault();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) {
        return;
      }
      if (e.code === "Escape") {
        this.callbacks.onEscape?.();
        return;
      }
      // Don't pan with WASD if Ctrl/Meta is held (e.g., Ctrl+S / Ctrl+A)
      if (!e.ctrlKey && !e.metaKey) {
        this.keysPressed.add(e.code);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      this.keysPressed.delete(e.code);
    };
    const onBlur = () => {
      this.keysPressed.clear();
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
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
    const clickTile = screenToTile(wx, wy);

    for (const vis of this.visuals.values()) {
      if (!vis.container.visible) continue;
      const sp = vis.sprite;
      if (sp.texture === Texture.EMPTY) continue;

      if (vis.data.type === "u") {
        const rawW = Math.max(52, Math.abs(sp.width) + 12);
        const rawH = Math.max(70, Math.abs(sp.height) + 12);
        const effAnchorX = sp.scale.x < 0 ? 1 - sp.anchor.x : sp.anchor.x;
        const x0 = vis.container.x - rawW * effAnchorX;
        const y0 = vis.container.y - rawH * Math.max(0.75, sp.anchor.y);
        if (wx >= x0 && wx <= x0 + rawW && wy >= y0 && wy <= y0 + rawH) {
          unitHits.push(vis);
        }
      } else {
        // 1. Exact isometric footprint diamond check `[tx, tx + width) x [ty, ty + height)`
        const inFootprint =
          clickTile.tx >= vis.data.tx - 0.15 &&
          clickTile.tx <= vis.data.tx + vis.data.width + 0.15 &&
          clickTile.ty >= vis.data.ty - 0.15 &&
          clickTile.ty <= vis.data.ty + vis.data.height + 0.15;

        if (inFootprint) {
          bldgHits.push(vis);
          continue;
        }

        // 2. Tightened visual body core (trims wide transparent padding and tall spire overhangs)
        const fullW = Math.abs(sp.width);
        const fullH = Math.abs(sp.height);
        const padX = fullW * 0.3;
        const padTop = fullH * 0.25;
        const x0 = vis.container.x - fullW * sp.anchor.x + padX;
        const x1 = vis.container.x + fullW * (1 - sp.anchor.x) - padX;
        const y0 = vis.container.y - fullH * sp.anchor.y + padTop;
        const y1 = vis.container.y + fullH * (1 - sp.anchor.y) - fullH * 0.05;
        if (x1 > x0 && y1 > y0 && wx >= x0 && wx <= x1 && wy >= y0 && wy <= y1) {
          bldgHits.push(vis);
        }
      }
    }

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
