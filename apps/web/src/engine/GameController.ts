import {
  tileToExpansionId,
  type CommandPayload,
  type RawMapItemTuple,
  type SaveFile,
  type TerrainSkin
} from "@sef/shared-types";
import {
  BattleEngine,
  COLLECT_MINUTES,
  COLLECT_VARIABLE_IDS,
  FixedStepClock,
  ID_BUILDING_REGEN_GOLD,
  ID_BUILDING_REGEN_STONE,
  NEST_STEP_COOLDOWN_SEC,
  NEST_TOTAL_STEPS,
  OccupancyGrid,
  REGEN_ORE_DURATION_SEC,
  SUBCAT_BUILDING_FARM,
  SUBCAT_BUILDING_MILL,
  SUBCAT_BUILDING_MINE,
  SUBCAT_BUILDING_TOWNHALL,
  SUBCAT_RESOURCE_GOLD,
  SUBCAT_RESOURCE_STONE,
  computeProducerYield,
  computeSellRefund,
  getMatchingAnimalBuildingIds,
  isCapturableAnimalSubcat,
  isEnterableWorkBuildingSubcat,
  isNaturalResourceSubcat,
  type SimEntity,
  type SimVisualEvent,
  type StanceMode
} from "@sef/engine-sim";
import {
  IsoRenderer,
  type ClickModifiers,
  type NumberParticleKind,
  type RenderEntityData,
  type RenderProjectileData
} from "@sef/engine-render";
import { AudioManager, SFX_NAMES } from "@sef/engine-audio";
import { gameApi } from "../api/gameApi.js";
import { assetsBaseUrl, audioBaseUrl } from "../api/paths.js";
import {
  useGameStore,
  type LevelUpNotice,
  type SelectedEntitySummary
} from "../store/gameStore.js";

const WILD_NEUTRAL_SUBCATS = new Set([74, 75, 125, 126, 127, 128, 811]);
const ALL_BIOME_SKINS: TerrainSkin[] = [
  "terreno",
  "terrenodesierto",
  "terrenohielo",
  "terrenomar2",
  "terrenomineral",
  "terrenonubes",
  "terrenoselva",
  "islandbigboss3"
];
const SPECIAL_INTERIOR_IDS = new Set([23, 188, 189, 224, 239, 299, 416, 486, 1233, 1255, 1284, 1345, 1346, 1394, 1463, 1529]);

function isWorkableOrHarvestableTarget(subcat: number, itemId: number): boolean {
  return isNaturalResourceSubcat(subcat) || isEnterableWorkBuildingSubcat(subcat) || COLLECT_VARIABLE_IDS.has(itemId);
}

function isVillagerEntity(ent: SimEntity): boolean {
  return ent.type === "u" && (ent.itemId === 500 || ent.itemId === 501 || ent.subcatFunctional === 71);
}

function svgCursor(svg: string, hotX = 6, hotY = 6, fallback = "pointer"): string {
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${hotX} ${hotY}, ${fallback}`;
}

const CURSORS = {
  default: "grab",
  boxSelect: "crosshair",
  bulldoze: svgCursor(
    `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><circle cx="14" cy="14" r="11" fill="rgba(220,38,38,0.88)" stroke="#fef08a" stroke-width="2"/><path d="M9 9l10 10M19 9L9 19" stroke="#ffffff" stroke-width="2.6" stroke-linecap="round"/></svg>`,
    14,
    14,
    "not-allowed"
  ),
  attack: svgCursor(
    `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><path d="M23 4l-11 11-3-3 11-11h3v3z" fill="#ef4444" stroke="#450a0a" stroke-width="1.6"/><path d="M8 14l6 6-2.5 2.5-2-2-3.5 3.5-2-2 3.5-3.5-2-2L8 14z" fill="#fbbf24" stroke="#451a03" stroke-width="1.5"/></svg>`,
    4,
    22,
    "crosshair"
  ),
  harvest: svgCursor(
    `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><path d="M7 22L20 9" stroke="#92400e" stroke-width="3.2" stroke-linecap="round"/><path d="M14 5c4-1 8 1 9 5-4 1-7-1-9-5z" fill="#facc15" stroke="#78350f" stroke-width="1.5"/></svg>`,
    18,
    8,
    "pointer"
  ),
  move: svgCursor(
    `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><circle cx="14" cy="14" r="9" fill="rgba(74,222,128,0.22)" stroke="#4ade80" stroke-width="2.2"/><path d="M14 7v14M7 14h14" stroke="#bbf7d0" stroke-width="2"/></svg>`,
    14,
    14,
    "pointer"
  ),
  collect: svgCursor(
    `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><circle cx="14" cy="14" r="10" fill="#facc15" stroke="#78350f" stroke-width="2.2"/><circle cx="14" cy="14" r="5.5" fill="#fef08a" stroke="#b45309" stroke-width="1.4"/></svg>`,
    14,
    14,
    "pointer"
  ),
  spell: "crosshair"
} as const;

const SURVIVAL_BIOMES: { id: number; nameEs: string; nameEn: string; biome: TerrainSkin }[] = [
  { id: 1, nameEs: "Arena Clásica", nameEn: "Classic Arena", biome: "terreno" },
  { id: 2, nameEs: "Arena de Egipto", nameEn: "Egypt Arena", biome: "terrenodesierto" },
  { id: 3, nameEs: "Arena Glacial", nameEn: "Frost Arena", biome: "terrenohielo" },
  { id: 4, nameEs: "Arena Mineral", nameEn: "Mineral Arena", biome: "terrenomineral" },
  { id: 5, nameEs: "Arena de la Selva", nameEn: "Jungle Arena", biome: "terrenoselva" }
];

const SPELL_COLORS: Record<number, number> = {
  2: 0xff5722,
  3: 0x94a3b8,
  4: 0x38bdf8,
  5: 0x4ade80,
  6: 0xd97706,
  7: 0x991b1b,
  8: 0x84cc16,
  9: 0xfacc15,
  10: 0xe0f2fe,
  11: 0xf97316,
  12: 0xef4444,
  13: 0x60a5fa,
  14: 0x34d399,
  15: 0xa78bfa,
  16: 0x6b21a8
};

export { SURVIVAL_BIOMES };

/**
 * Orchestrates the 30 Hz deterministic simulation (`BattleEngine` + `FixedStepClock`),
 * 60-144+ FPS `IsoRenderer`, `AudioManager`, RTS control groups/hotkeys, and dual persistence.
 */
export class GameController {
  readonly renderer: IsoRenderer;
  readonly audio: AudioManager;
  readonly clock = new FixedStepClock(1000 / 30);

  grid = new OccupancyGrid();
  battle: BattleEngine | null = null;
  private packetSeq = 1;
  private survivalWaveTimer = 0;
  private lastHudSyncAt = 0;
  private lastRegenCheckAt = 0;
  private collectedCooldownUntil = new Map<number, number>(); // passive building uid -> timestamp ms
  private lastGroupRecallKey = -1;
  private lastGroupRecallAt = 0;
  private idleVillagerCycleIdx = 0;
  private lastCursor = "";
  private readonly keyHandler: (e: KeyboardEvent) => void;

  constructor(hostEl: HTMLElement) {
    this.audio = new AudioManager(audioBaseUrl());
    this.renderer = new IsoRenderer(
      hostEl,
      {
        onEntitySelect: (ent, additive) => this.handleEntitySelect(ent, additive),
        onBoxSelect: (uids) => this.handleBoxSelect(uids),
        onTileHover: (tx, ty, hit) => this.handleTileHover(tx, ty, hit),
        onTileClick: (tx, ty, button, hit, mods) => void this.handleTileClick(tx, ty, button, hit, mods),
        onExpansionClick: (expId) => {
          const st = useGameStore.getState();
          if (st.playMode === "village") {
            st.setExpandModalExpId(expId);
            void this.audio.playSfx(SFX_NAMES.buttonClick, 0.7);
          }
        },
        onEscape: () => this.handleEscape(),
        onTickFrame: (dtMs) => this.onAnimationFrame(dtMs)
      },
      assetsBaseUrl()
    );
    this.keyHandler = (e) => this.handleGlobalKeyDown(e);
    window.addEventListener("keydown", this.keyHandler);
  }

  async init(): Promise<void> {
    await this.renderer.init();
    const save = await useGameStore.getState().bootstrapCatalogs();
    if (save) {
      this.loadPersistentVillage(save);
    }
  }

  private findSaveTuple(itemId: number, tx: number, ty: number): RawMapItemTuple | null {
    const map0 = useGameStore.getState().activeSave?.maps[0];
    if (!map0) return null;
    const rtx = Math.round(tx);
    const rty = Math.round(ty);
    for (const tuple of map0.items) {
      if (tuple[0] === itemId && tuple[1] === rtx && tuple[2] === rty) {
        return tuple;
      }
    }
    return null;
  }

  private findFreeTileNear(originTx: number, originTy: number, maxRadius = 4): { tx: number; ty: number } {
    for (let r = 1; r <= maxRadius; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          const cx = originTx + dx;
          const cy = originTy + dy;
          if (this.grid.inBounds(cx, cy) && this.grid.get(cx, cy) === 0) {
            return { tx: cx, ty: cy };
          }
        }
      }
    }
    return { tx: Math.min(98, originTx + 1), ty: Math.min(98, originTy + 1) };
  }

  loadPersistentVillage(save: SaveFile): void {
    const store = useGameStore.getState();
    store.setActiveSave(save);
    store.setPlayMode("village");
    store.setVisitingNeighbor(null);
    store.setBattleStatus(null);
    store.setSelection([], null);
    store.setControlGroups({});
    store.setActiveMusic("village");
    this.renderer.setBoxSelectDefault(store.cursorTool === "box_select");

    this.renderer.clearEntities();
    this.grid = new OccupancyGrid();
    this.battle = new BattleEngine(this.grid, store.itemsById, store.behaviorsById);
    this.collectedCooldownUntil.clear();

    const map0 = save.maps[0];
    const ownedExps = new Set(useGameStore.getState().expansions);
    const preloadNames = new Set<string>();
    if (map0) {
      map0.items.forEach((tuple) => {
        const [itemId, tx, ty, orientation, , , garrison] = tuple;
        const def = store.itemsById.get(itemId);
        if (!def || !def.imgName) return;

        // Classify neutral resources/animals vs enemy trolls vs player empire entities
        const isEnemy = def.race === "t" || def.race === "e";
        const isNeutral = !isEnemy && (def.race === "n" || WILD_NEUTRAL_SUBCATS.has(def.subcatFunctional));
        const team = isEnemy ? "enemy" : isNeutral ? "neutral" : "player";

        const ent = this.battle!.spawnFromItem(
          itemId,
          tx,
          ty,
          team,
          def.type === "u" ? (orientation >= 1 && orientation <= 8 ? orientation : 4) : orientation
        );
        if (ent) {
          if (Array.isArray(garrison) && garrison.length > 0) {
            ent.garrison = garrison.map(Number);
          }

          // Authentic village stances (`IA.as`)
          if (team === "enemy" && !ownedExps.has(tileToExpansionId(tx, ty))) {
            this.battle!.setUnitsStance([ent.uid], "defensive");
          } else if (team === "player" && isVillagerEntity(ent)) {
            this.battle!.setUnitsStance([ent.uid], "stand");
          } else if (team === "player" && ent.type === "u") {
            this.battle!.setUnitsStance([ent.uid], "defensive");
          }

          if (tx >= 36 && tx <= 64 && ty >= 36 && ty <= 64) {
            preloadNames.add(def.imgName);
          }
        }
      });
    }

    this.renderer.setOwnedExpansions(useGameStore.getState().expansions);
    void this.renderer.setBiome(useGameStore.getState().activeBiome);
    this.renderer.camera.centerOnTile(50, 50);
    this.syncRendererSnapshot(1);
    void this.renderer.preloadSprites(preloadNames);
  }

  selectAllPlayerArmy(): void {
    if (!this.battle) return;
    const store = useGameStore.getState();
    const uids: number[] = [];
    for (const e of this.battle.entities.values()) {
      if (e.alive && e.team === "player" && e.type === "u" && !isVillagerEntity(e)) {
        uids.push(e.uid);
      }
    }
    if (uids.length === 0) {
      for (const e of this.battle.entities.values()) {
        if (e.alive && e.team === "player" && e.type === "u") uids.push(e.uid);
      }
    }
    if (uids.length === 0) {
      this.notify(store.locale === "es" ? "No tienes unidades disponibles" : "No units available");
      return;
    }
    this.renderer.setSelectedEntities(uids);
    this.handleBoxSelect(uids);
    const first = this.battle.entities.get(uids[0]!);
    if (first) this.renderer.camera.smoothCenterOnTile(first.tx, first.ty);
    this.notify(
      store.locale === "es"
        ? `Ejército seleccionado (${uids.length}). Haz clic en un enemigo para atacar o en el suelo para mover.`
        : `Army selected (${uids.length}). Click an enemy to attack or ground to move.`
    );
  }

  /**
   * Smoothly centers camera on Town Hall (Village) or living player army centroid (Battle).
   */
  centerOnHome(): void {
    if (!this.battle) return;
    const mode = useGameStore.getState().playMode;
    if (mode === "village") {
      for (const e of this.battle.entities.values()) {
        if (e.alive && e.team === "player" && e.subcatFunctional === SUBCAT_BUILDING_TOWNHALL) {
          this.renderer.camera.smoothCenterOnTile(e.tx, e.ty);
          return;
        }
      }
      this.renderer.camera.smoothCenterOnTile(50, 50);
      return;
    }
    let sx = 0;
    let sy = 0;
    let cnt = 0;
    for (const e of this.battle.entities.values()) {
      if (e.alive && e.team === "player" && e.type === "u") {
        sx += e.tx;
        sy += e.ty;
        cnt += 1;
      }
    }
    if (cnt > 0) {
      this.renderer.camera.smoothCenterOnTile(sx / cnt, sy / cnt);
    } else {
      this.renderer.camera.smoothCenterOnTile(50, 50);
    }
  }

  /**
   * Cycles through idle player villagers (`Tab` hotkey), selecting and smoothly centering on them.
   */
  selectNextIdleVillager(): void {
    if (!this.battle) return;
    const store = useGameStore.getState();
    const idle: SimEntity[] = [];
    for (const e of this.battle.entities.values()) {
      if (e.alive && e.team === "player" && isVillagerEntity(e) && e.harvestTargetUid === null && e.path.length === 0) {
        idle.push(e);
      }
    }
    if (idle.length === 0) {
      this.notify(store.locale === "es" ? "No hay aldeanos ociosos" : "No idle villagers");
      return;
    }
    const pick = idle[this.idleVillagerCycleIdx % idle.length]!;
    this.idleVillagerCycleIdx += 1;
    this.renderer.setSelectedEntities([pick.uid]);
    store.setSelection([pick.uid], this.buildEntitySummary(pick.uid));
    this.renderer.camera.smoothCenterOnTile(pick.tx, pick.ty);
    void this.audio.playSfx(SFX_NAMES.buttonClick, 0.6);
  }

  /**
   * Assigns current living player units to numeric control group `1..9` (`Ctrl+1..9`).
   */
  assignControlGroup(groupNum: number): void {
    if (!this.battle || groupNum < 1 || groupNum > 9) return;
    const store = useGameStore.getState();
    const aliveUnits = store.selectedUids.filter((uid) => {
      const e = this.battle?.entities.get(uid);
      return e && e.alive && e.team === "player" && e.type === "u";
    });
    if (aliveUnits.length === 0) return;
    const nextGroups = { ...store.controlGroups, [groupNum]: aliveUnits };
    store.setControlGroups(nextGroups);
    void this.audio.playSfx(SFX_NAMES.buttonClick, 0.7);
    this.notify(
      store.locale === "es"
        ? `Grupo ${groupNum} guardado (${aliveUnits.length} tropas)`
        : `Control group ${groupNum} saved (${aliveUnits.length} units)`
    );
  }

  /**
   * Recalls control group `1..9`; double-tap smoothly centers camera on the group's centroid.
   */
  recallControlGroup(groupNum: number, forceCenter = false): void {
    if (!this.battle || groupNum < 1 || groupNum > 9) return;
    const store = useGameStore.getState();
    const raw = store.controlGroups[groupNum] ?? [];
    const alive = raw.filter((uid) => {
      const e = this.battle?.entities.get(uid);
      return e && e.alive && e.team === "player";
    });
    if (alive.length !== raw.length) {
      const next = { ...store.controlGroups };
      if (alive.length === 0) delete next[groupNum];
      else next[groupNum] = alive;
      store.setControlGroups(next);
    }
    if (alive.length === 0) return;

    this.renderer.setSelectedEntities(alive);
    this.handleBoxSelect(alive);

    const now = performance.now();
    const isDoubleTap = forceCenter || (this.lastGroupRecallKey === groupNum && now - this.lastGroupRecallAt < 380);
    this.lastGroupRecallKey = groupNum;
    this.lastGroupRecallAt = now;

    if (isDoubleTap) {
      let sx = 0;
      let sy = 0;
      for (const uid of alive) {
        const e = this.battle.entities.get(uid)!;
        sx += e.tx;
        sy += e.ty;
      }
      this.renderer.camera.smoothCenterOnTile(sx / alive.length, sy / alive.length);
    }
  }

  triggerSelectedSpecial(specialIndex: number): void {
    if (!this.battle) return;
    const sel = useGameStore.getState().selectedSummary;
    if (!sel || sel.team !== "player") return;
    const evs = this.battle.triggerSpecialAbility(sel.uid, specialIndex);
    if (evs.length > 0) {
      this.processSimEvents(evs);
      this.refreshSelectedSummary();
    }
  }

  triggerSelectedLimit(): void {
    if (!this.battle) return;
    const sel = useGameStore.getState().selectedSummary;
    if (!sel || sel.team !== "player") return;
    const evs = this.battle.triggerLimitAttack(sel.uid);
    if (evs.length > 0) {
      this.processSimEvents(evs);
      this.refreshSelectedSummary();
    }
  }

  changeSelectedStance(stance: StanceMode): void {
    if (!this.battle) return;
    const store = useGameStore.getState();
    const uids = store.selectedUids.filter((uid) => {
      const e = this.battle?.entities.get(uid);
      return e && e.alive && e.team === "player" && e.type === "u";
    });
    if (uids.length === 0) return;
    this.battle.setUnitsStance(uids, stance);
    void this.audio.playSfx(SFX_NAMES.buttonClick, 0.6);
    this.refreshSelectedSummary();
  }

  stopSelectedUnits(): void {
    if (!this.battle) return;
    const store = useGameStore.getState();
    const uids = store.selectedUids.filter((uid) => {
      const e = this.battle?.entities.get(uid);
      return e && e.alive && e.team === "player" && e.type === "u";
    });
    if (uids.length === 0) return;
    this.battle.stopUnits(uids);
    void this.audio.playSfx(SFX_NAMES.buttonClick, 0.55);
  }

  private handleGlobalKeyDown(e: KeyboardEvent): void {
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement ||
      e.target instanceof HTMLSelectElement
    ) {
      return;
    }
    const store = useGameStore.getState();
    if (store.activeModal !== null) return;

    // Control groups: Ctrl+1..9 assign, 1..9 recall (double-tap centers camera)
    if (e.code.startsWith("Digit") && e.code.length === 6) {
      const num = Number(e.code.charAt(5));
      if (num >= 1 && num <= 9) {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) {
          this.assignControlGroup(num);
        } else {
          this.recallControlGroup(num);
        }
        return;
      }
    }

    if (e.ctrlKey || e.metaKey || e.altKey) return;

    switch (e.code) {
      case "KeyH":
      case "Space":
        e.preventDefault();
        this.centerOnHome();
        break;
      case "Tab":
        e.preventDefault();
        this.selectNextIdleVillager();
        break;
      case "KeyG":
        store.setShowGrid(!store.showGrid);
        break;
      case "KeyB":
        if (store.playMode === "village") {
          store.setCursorTool(store.cursorTool === "bulldoze" ? "normal" : "bulldoze");
        }
        break;
      case "KeyM":
        if (store.playMode === "village") {
          store.setCursorTool(store.cursorTool === "box_select" ? "normal" : "box_select");
        }
        break;
      case "F2":
        e.preventDefault();
        this.selectAllPlayerArmy();
        break;
      case "KeyX":
        if (store.selectedUids.length > 0 && store.selectedSummary?.type === "u") {
          this.stopSelectedUnits();
        }
        break;
      case "KeyQ":
        this.triggerSelectedSpecial(0);
        break;
      case "KeyE":
        this.triggerSelectedSpecial(1);
        break;
      case "KeyR":
        this.triggerSelectedSpecial(2);
        break;
      case "KeyF":
        this.triggerSelectedSpecial(3);
        break;
      case "KeyT":
        this.triggerSelectedLimit();
        break;
    }
  }

  private handleEscape(): void {
    const store = useGameStore.getState();
    if (store.placingItemId !== null || store.castingMagicId !== null || store.movingEntityUid !== null) {
      store.setPlacingItemId(null);
      store.setCastingMagicId(null);
      store.setMovingEntityUid(null);
      this.renderer.setPlacementPreview(null);
      this.renderer.setSpellPreview(null);
      return;
    }
    if (store.cursorTool !== "normal") {
      store.setCursorTool("normal");
      return;
    }
    if (store.activeNestModal !== null) {
      store.setActiveNestModal(null);
      return;
    }
    if (store.collectPickerTarget !== null) {
      store.setCollectPickerTarget(null);
      return;
    }
    if (store.activeModal !== null) {
      store.setActiveModal(null);
      return;
    }
    store.setSelection([], null);
    this.renderer.setSelectedEntities([]);
  }

  /**
   * Launches any of the 36 Campaign Quests, Arthur maps, or PvP rival maps
   * by deploying the player's living army onto the target battlefield.
   */
  async startBattleMap(mapKey: string, mode: "quest" | "pvp", title: string): Promise<void> {
    const store = useGameStore.getState();
    const save = store.activeSave;
    if (!save) return;

    let enemySave: SaveFile | null = null;
    if (mode === "pvp") {
      enemySave = await gameApi.fetchPvpMatch(save.playerInfo.pid);
    } else {
      enemySave = await gameApi.fetchMap(mapKey);
    }
    if (!enemySave || !enemySave.maps[0]) {
      this.notify(store.locale === "es" ? "No se pudo cargar el mapa" : "Failed to load battle map");
      return;
    }

    store.setActiveModal(null);
    store.setVisitingNeighbor(null);
    store.setPlayMode(mode);
    store.setSelection([], null);
    store.setControlGroups({});
    store.setActiveMusic(mode === "pvp" ? "assault" : "quest");
    this.audio.playMusic(mode === "pvp" ? "assault" : "quest", 600);
    this.renderer.setBoxSelectDefault(true);

    this.renderer.clearEntities();
    this.grid = new OccupancyGrid();
    this.battle = new BattleEngine(this.grid, store.itemsById, store.behaviorsById);

    const enemyMap = enemySave.maps[0];
    const preloadNames = new Set<string>();
    let enemiesCount = 0;
    let sumEx = 0;
    let sumEy = 0;
    let combatPts = 0;
    for (const tuple of enemyMap.items) {
      const [itemId, tx, ty, orientation] = tuple;
      const def = store.itemsById.get(itemId);
      if (!def || !def.imgName) continue;
      const isCombatEnemy = def.type === "u" || def.attack > 0 || def.subcatFunctional === 112;
      const team = isCombatEnemy ? "enemy" : "neutral";
      const ent = this.battle.spawnFromItem(itemId, tx, ty, team, def.type === "u" ? 4 : orientation);
      if (ent && isCombatEnemy) {
        enemiesCount += 1;
        sumEx += tx;
        sumEy += ty;
        combatPts += 1;
        preloadNames.add(def.imgName);
      }
    }

    // Deploy player's combat units near the enemy camp centroid so battle starts in view
    const campTx = combatPts > 0 ? Math.round(sumEx / combatPts) : 46;
    const campTy = combatPts > 0 ? Math.round(sumEy / combatPts) : 50;
    const deployBaseTx = Math.max(8, Math.min(84, campTx + 6));
    const deployBaseTy = Math.max(8, Math.min(84, campTy + 4));

    const playerMap = save.maps[0];
    const armyIds: number[] = [];
    if (playerMap) {
      for (const tuple of playerMap.items) {
        const def = store.itemsById.get(tuple[0]);
        if (def && def.type === "u" && def.attack > 0 && def.race !== "t") {
          armyIds.push(def.id);
        }
      }
    }
    if (armyIds.length < 6) {
      armyIds.push(508, 508, 515, 515, 516, 649); // Starter Knights, Archers & Guardian Dragon vanguard
    }

    const deployedUids: number[] = [];
    const maxDeploy = Math.min(24, armyIds.length);
    for (let i = 0; i < maxDeploy; i++) {
      const unitItemId = armyIds[i]!;
      const tx = Math.max(2, Math.min(97, deployBaseTx + (i % 5) * 2));
      const ty = Math.max(2, Math.min(97, deployBaseTy + Math.floor(i / 5) * 2));
      const ent = this.battle.spawnFromItem(unitItemId, tx, ty, "player", 2);
      if (ent) {
        deployedUids.push(ent.uid);
        preloadNames.add(ent.imgName);
      }
    }

    // Reveal full battlefield expansions on quest/PvP islands (classic behavior)
    const allExps = Array.from({ length: 25 }, (_, i) => i + 1);
    this.renderer.setOwnedExpansions(mode === "quest" ? allExps : enemyMap.expansions.length > 0 ? enemyMap.expansions : allExps);
    const skins: TerrainSkin[] = ["terreno", "terrenodesierto", "terrenohielo", "terrenomar2", "terrenomineral", "terrenonubes", "terrenoselva", "islandbigboss3"];
    const biome = skins[enemyMap.skin] ?? "terreno";
    store.setActiveBiome(biome);
    void this.renderer.setBiome(biome);
    this.renderer.camera.centerOnTile(Math.round((campTx + deployBaseTx) * 0.5), Math.round((campTy + deployBaseTy) * 0.5));

    store.setBattleStatus({
      mode,
      title,
      questId: mode === "quest" ? mapKey.replace(/^quest\//, "") : undefined,
      wave: 1,
      enemiesRemaining: enemiesCount,
      playerUnitsAlive: deployedUids.length,
      lootGold: mode === "pvp" ? 2500 : 1800,
      lootXp: mode === "pvp" ? 220 : 180,
      finished: null
    });

    // Important: sync visuals BEFORE setting selection so unit ellipses render cleanly
    this.syncRendererSnapshot(1);
    this.renderer.setSelectedEntities(deployedUids);
    this.handleBoxSelect(deployedUids);
    if (deployedUids.length > 0) {
      store.setControlGroups({ 1: deployedUids });
    }
    void this.renderer.preloadSprites(preloadNames);
    this.notify(
      store.locale === "es"
        ? `¡Batalla iniciada! ${deployedUids.length} tropas en Grupo [1]. Arrastra para seleccionar, clic derecho mueve/ataca.`
        : `Battle started! ${deployedUids.length} troops in Group [1]. Drag to box-select, right-click to move/attack.`
    );
  }

  startSurvivalArena(mapId: number): void {
    const store = useGameStore.getState();
    const save = store.activeSave;
    const arena = SURVIVAL_BIOMES.find((b) => b.id === mapId) ?? SURVIVAL_BIOMES[0]!;
    if (!save) return;

    store.setActiveModal(null);
    store.setPlayMode("survival");
    store.setControlGroups({});
    store.setActiveBiome(arena.biome);
    store.setActiveMusic("survival");
    this.audio.playMusic("survival", 600);
    this.renderer.setBoxSelectDefault(true);

    this.renderer.clearEntities();
    this.grid = new OccupancyGrid();
    this.battle = new BattleEngine(this.grid, store.itemsById, store.behaviorsById);
    this.survivalWaveTimer = 0;

    // Deploy player's best units at center of arena
    const armyIds: number[] = [];
    for (const tuple of save.maps[0]?.items ?? []) {
      const def = store.itemsById.get(tuple[0]);
      if (def && def.type === "u" && def.attack > 0 && def.race !== "t") armyIds.push(def.id);
    }
    if (armyIds.length < 6) armyIds.push(508, 508, 515, 515, 533, 649);

    const deployed: number[] = [];
    const preloadNames = new Set<string>();
    for (let i = 0; i < Math.min(18, armyIds.length); i++) {
      const ent = this.battle.spawnFromItem(armyIds[i]!, 47 + (i % 5) * 2, 48 + Math.floor(i / 5) * 2, "player", 4);
      if (ent) {
        deployed.push(ent.uid);
        preloadNames.add(ent.imgName);
      }
    }

    this.spawnSurvivalWave(1);

    this.renderer.setOwnedExpansions([13]);
    void this.renderer.setBiome(arena.biome);
    this.renderer.camera.centerOnTile(50, 50);
    store.setBattleStatus({
      mode: "survival",
      title: store.locale === "es" ? arena.nameEs : arena.nameEn,
      survivalMapId: arena.id,
      wave: 1,
      enemiesRemaining: 6,
      playerUnitsAlive: deployed.length,
      lootGold: 0,
      lootXp: 0,
      finished: null
    });
    this.syncRendererSnapshot(1);
    this.renderer.setSelectedEntities(deployed);
    this.handleBoxSelect(deployed);
    void this.renderer.preloadSprites(preloadNames);
  }

  private spawnSurvivalWave(wave: number): void {
    if (!this.battle) return;
    const store = useGameStore.getState();
    const enemyPool = [526, 527, 528, 529, 530, 649].filter((id) => store.itemsById.has(id));
    const fallbackIds = store.items.filter((i) => i.type === "u" && i.attack > 0).slice(0, 12).map((i) => i.id);
    const pool = enemyPool.length > 0 ? enemyPool : fallbackIds;

    const count = 4 + wave * 2;
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count;
      const tx = Math.round(50 + Math.cos(angle) * 10);
      const ty = Math.round(50 + Math.sin(angle) * 10);
      const id = pool[i % pool.length]!;
      this.battle.spawnFromItem(id, tx, ty, "enemy", 5);
    }
    this.notify(
      store.locale === "es" ? `¡Oleada ${wave} de Supervivencia!` : `Survival Wave ${wave} incoming!`
    );
    void this.audio.playSfx(SFX_NAMES.newTown, 0.7);
  }

  async returnToVillage(claimRewards = false): Promise<void> {
    const store = useGameStore.getState();
    const status = store.battleStatus;
    if (claimRewards && status && store.activeSave) {
      if (status.mode === "quest" && status.finished === "victory") {
        await this.sendCommands([
          { cmd: "end_quest", args: [status.questId ?? "0", 1, status.lootGold, status.lootXp, 0] }
        ]);
      } else if (status.mode === "pvp" && status.finished === "victory") {
        await this.sendCommands([
          { cmd: "pvp_end_attack_new", args: [1, status.lootGold, status.lootXp, 250, 250, 250] }
        ]);
      } else if (status.mode === "survival" && status.lootGold > 0) {
        await this.sendCommands([
          { cmd: "gold_statue_conversion", args: [status.lootGold] }
        ]);
      }
    }
    const latest = useGameStore.getState().activeSave;
    if (latest) {
      this.loadPersistentVillage(latest);
      this.audio.playMusic("village", 600);
    }
  }

  async visitNeighbor(neighbor: {
    id: string;
    name: string;
    level: number;
    mapKey: string;
    isKing: boolean;
  }): Promise<void> {
    const store = useGameStore.getState();
    let targetSave: SaveFile | null = null;
    if (neighbor.mapKey.startsWith("save:")) {
      const pid = neighbor.mapKey.slice("save:".length);
      targetSave = await gameApi.loadSave(pid);
    } else {
      targetSave = await gameApi.fetchMap(neighbor.mapKey);
    }
    if (!targetSave || !targetSave.maps[0]) {
      this.notify(store.locale === "es" ? "No se pudo cargar el imperio vecino" : "Failed to load neighbor empire");
      return;
    }

    store.setActiveModal(null);
    store.setCursorTool("normal");
    store.setSelection([], null);
    store.setControlGroups({});
    store.setPlayMode("visit");
    store.setVisitingNeighbor({
      ...neighbor,
      assistsRemaining: 5
    });
    this.renderer.setBoxSelectDefault(false);

    this.renderer.clearEntities();
    this.grid = new OccupancyGrid();
    this.battle = new BattleEngine(this.grid, store.itemsById, store.behaviorsById);

    const map0 = targetSave.maps[0];
    const preloadNames = new Set<string>();
    for (const tuple of map0.items) {
      const [itemId, tx, ty, orientation, , , garrison] = tuple;
      const def = store.itemsById.get(itemId);
      if (!def || !def.imgName) continue;
      const ent = this.battle.spawnFromItem(
        itemId,
        tx,
        ty,
        "neutral",
        def.type === "u" ? (orientation >= 1 && orientation <= 8 ? orientation : 4) : orientation
      );
      if (ent) {
        if (Array.isArray(garrison) && garrison.length > 0) {
          ent.garrison = garrison.map(Number);
        }
        if (tx >= 36 && tx <= 64 && ty >= 36 && ty <= 64) {
          preloadNames.add(def.imgName);
        }
      }
    }

    const exps = map0.expansions.length > 0 ? map0.expansions : [13];
    this.renderer.setOwnedExpansions(exps);
    const biome = ALL_BIOME_SKINS[map0.skin] ?? "terreno";
    store.setActiveBiome(biome);
    void this.renderer.setBiome(biome);
    this.renderer.camera.centerOnTile(50, 50);
    this.syncRendererSnapshot(1);
    void this.renderer.preloadSprites(preloadNames);
    void this.audio.playSfx(SFX_NAMES.newTown, 0.7);
    this.notify(
      store.locale === "es"
        ? `Visitando a ${neighbor.name}. Haz clic en sus edificios para ayudar (+10 Oro, +3 XP).`
        : `Visiting ${neighbor.name}. Click buildings to assist (+10 Gold, +3 XP).`
    );
  }

  returnFromVisit(): void {
    const latest = useGameStore.getState().activeSave;
    if (latest) {
      this.loadPersistentVillage(latest);
      this.audio.playMusic("village", 600);
    }
  }

  async sendCommands(commands: CommandPayload[]): Promise<boolean> {
    const store = useGameStore.getState();
    const save = store.activeSave;
    if (!save) return false;

    const packetId = `pkt_${Date.now()}_${this.packetSeq++}`;
    try {
      const body = await gameApi.executeCommands(save.playerInfo.pid, packetId, commands, store.adminMode);
      if (!body) return false;

      if (body.save) {
        store.setActiveSave(body.save);
      }

      const levelUps: LevelUpNotice[] = [];
      for (const ev of body.events ?? []) {
        if (ev.type === "sfx" && ev.name) {
          void this.audio.playSfx(ev.name, 0.85);
        } else if (ev.type === "level_up" && ev.level) {
          this.renderer.spawnFloatingText(50, 50, `¡NIVEL ${ev.level}!`, 0xfacc15);
          levelUps.push({
            level: ev.level,
            rankName: ev.rankName,
            rewardType: ev.rewardType,
            rewardAmount: ev.rewardAmount,
            manaBonus: ev.manaBonus
          });
        }
      }
      if (levelUps.length > 0) {
        store.enqueueLevelUps(levelUps);
      }

      if (body.result !== "ok" && body.error) {
        this.notify(body.error);
        return false;
      }
      return true;
    } catch (err) {
      this.notify(err instanceof Error ? err.message : "Network error");
      return false;
    }
  }

  async unlockBuildingEarly(itemId: number, cashCost: number): Promise<void> {
    const store = useGameStore.getState();
    const def = store.itemsById.get(itemId);
    const ok = await this.sendCommands([{ cmd: "unlock_building", args: [itemId, cashCost] }]);
    if (ok && def) {
      this.notify(
        store.locale === "es"
          ? `¡${def.name} desbloqueado anticipadamente!`
          : `${def.name} unlocked early!`
      );
    }
  }

  async buyAndPlace(itemId: number, tx: number, ty: number): Promise<void> {
    const store = useGameStore.getState();
    const def = store.itemsById.get(itemId);
    if (!def) return;
    const ok = await this.sendCommands([{ cmd: "buy", args: [itemId, tx, ty, 0] }]);
    if (ok && this.battle && store.playMode === "village") {
      this.battle.spawnFromItem(itemId, tx, ty, "player", def.type === "u" ? 4 : 0);
      this.renderer.spawnFloatingText(tx, ty, `+${def.xp} XP`, 0x38bdf8);
      store.setPlacingItemId(null);
      this.renderer.setPlacementPreview(null);
      this.syncRendererSnapshot(1);
    }
  }

  openSpecialBuildingInterior(itemId: number, subcat: number, tx: number, ty: number): boolean {
    const store = useGameStore.getState();
    const def = store.itemsById.get(itemId);
    const name = def?.name ?? `Building #${itemId}`;
    if (itemId === 1233) {
      store.setActiveNestModal({ kind: "dragon", tx, ty });
      void this.audio.playSfx(SFX_NAMES.buttonClick, 0.75);
      return true;
    }
    if (itemId === 1255) {
      store.setActiveNestModal({ kind: "monster", tx, ty });
      void this.audio.playSfx(SFX_NAMES.buttonClick, 0.75);
      return true;
    }
    if (subcat === 132 || itemId === 23 || itemId === 188 || itemId === 189) {
      store.setSystemsTab("market");
      store.setActiveModal("systems");
      void this.audio.playSfx(SFX_NAMES.buttonClick, 0.75);
      return true;
    }
    if (itemId === 486 || itemId === 239) {
      store.setSystemsTab("graveyard");
      store.setActiveModal("systems");
      void this.audio.playSfx(SFX_NAMES.buttonClick, 0.75);
      return true;
    }
    if (itemId === 1284) {
      store.setSystemsTab("storage");
      store.setActiveModal("systems");
      void this.audio.playSfx(SFX_NAMES.buttonClick, 0.75);
      return true;
    }
    // Harbor (224/343), Zeppelin (299/344), Survival Arena (1283) -> World Map / Expeditions
    if (itemId === 224 || itemId === 343 || itemId === 299 || itemId === 344 || itemId === 1283) {
      store.setActiveModal("worldMap");
      void this.audio.playSfx(SFX_NAMES.buttonClick, 0.75);
      return true;
    }
    // Generalized special interactive interior for Soul Mixer (1529), Supreme Bahamut Temple (1394), and ALL subcat=139 buildings
    if (itemId === 1529 || itemId === 1394 || subcat === 139 || SPECIAL_INTERIOR_IDS.has(itemId)) {
      store.setSpecialInteriorTarget({ itemId, subcatFunctional: subcat, tx, ty, name });
      void this.audio.playSfx(SFX_NAMES.buttonClick, 0.75);
      return true;
    }
    return false;
  }

  async soulMixerMix(unitId1: number, unitId2: number, resultUnitId: number): Promise<void> {
    const store = useGameStore.getState();
    const ok = await this.sendCommands([
      { cmd: "soul_mixer_mix", args: [unitId1, unitId2, resultUnitId, store.adminMode ? 1 : 0] }
    ]);
    if (ok) {
      this.audio.playSfx(SFX_NAMES.collect, 0.7);
      this.notify(
        store.locale === "es"
          ? "¡Mezcla de almas iniciada!"
          : "Soul fusion started!"
      );
    }
  }

  async soulMixerClaim(speedUpCash = 0): Promise<void> {
    const store = useGameStore.getState();
    const ok = await this.sendCommands([{ cmd: "soul_mixer_claim", args: [speedUpCash, 50, 50] }]);
    if (ok) {
      this.audio.playSfx(SFX_NAMES.levelUp, 0.75);
      const save = useGameStore.getState().activeSave;
      if (save) this.loadPersistentVillage(save);
      this.notify(
        store.locale === "es"
          ? "¡Unidad fusionada invocada en tu reino!"
          : "Fused unit summoned to your kingdom!"
      );
    }
  }

  async bahamutTempleStep(stepIdx: number): Promise<void> {
    const store = useGameStore.getState();
    const ok = await this.sendCommands([
      { cmd: "bahamut_temple_step", args: [stepIdx, store.adminMode ? 1 : 0] }
    ]);
    if (ok) {
      this.audio.playSfx(SFX_NAMES.collect, 0.7);
      this.notify(
        store.locale === "es"
          ? `¡Paso #${stepIdx + 1} del Templo de Bahamut completado!`
          : `Bahamut Temple step #${stepIdx + 1} completed!`
      );
    }
  }

  async bahamutTempleClaim(): Promise<void> {
    const store = useGameStore.getState();
    const ok = await this.sendCommands([
      { cmd: "bahamut_temple_claim", args: [store.adminMode ? 1 : 0, 52, 52] }
    ]);
    if (ok) {
      this.audio.playSfx(SFX_NAMES.levelUp, 0.85);
      const save = useGameStore.getState().activeSave;
      if (save) this.loadPersistentVillage(save);
      this.notify(
        store.locale === "es"
          ? "¡Bahamut Supremo invocado en tu reino!"
          : "Supreme Bahamut summoned to your kingdom!"
      );
    }
  }

  async unlockCollectionUnit(unitId: number, cashCost: number, alsoSpawn: boolean): Promise<void> {
    const store = useGameStore.getState();
    const tx = 48 + Math.floor(Math.random() * 5);
    const ty = 48 + Math.floor(Math.random() * 5);
    const ok = await this.sendCommands([
      { cmd: "collection_unlock_unit", args: [unitId, cashCost, alsoSpawn ? 1 : 0, tx, ty] }
    ]);
    if (ok) {
      this.audio.playSfx(SFX_NAMES.collect, 0.7);
      if (alsoSpawn) {
        const save = useGameStore.getState().activeSave;
        if (save) this.loadPersistentVillage(save);
      }
      this.notify(
        store.locale === "es"
          ? alsoSpawn
            ? "¡Unidad reclamada e invocada en el reino!"
            : "¡Unidad desbloqueada en tu colección!"
          : alsoSpawn
            ? "Unit claimed and spawned in your kingdom!"
            : "Unit unlocked in your collection!"
      );
    }
  }

  async claimCollectionReward(colId: number, rewardUnitId: number): Promise<void> {
    const store = useGameStore.getState();
    const tx = 49 + Math.floor(Math.random() * 4);
    const ty = 49 + Math.floor(Math.random() * 4);
    const ok = await this.sendCommands([
      { cmd: "collection_claim_reward", args: [colId, rewardUnitId, tx, ty] }
    ]);
    if (ok) {
      this.audio.playSfx(SFX_NAMES.levelUp, 0.8);
      const save = useGameStore.getState().activeSave;
      if (save) this.loadPersistentVillage(save);
      this.notify(
        store.locale === "es"
          ? "¡Recompensa de colección invocada en tu reino!"
          : "Collection reward summoned to your kingdom!"
      );
    }
  }

  async hatchNestCreature(kind: "dragon" | "monster", nestTx: number, nestTy: number): Promise<void> {
    const store = useGameStore.getState();
    const spawn = this.findFreeTileNear(nestTx, nestTy, 5);
    const cmd = kind === "dragon" ? "next_dragon" : "next_monster";
    const prevCount = store.activeSave?.maps[0]?.items.length ?? 0;
    const ok = await this.sendCommands([{ cmd, args: [spawn.tx, spawn.ty] }]);
    if (ok && this.battle && store.playMode === "village") {
      const updated = useGameStore.getState().activeSave?.maps[0];
      if (updated && updated.items.length > prevCount) {
        const newest = updated.items[updated.items.length - 1]!;
        const spawned = this.battle.spawnFromItem(newest[0], newest[1], newest[2], "player", 4);
        if (spawned) {
          this.renderer.spawnFloatingText(newest[1], newest[2], `¡${spawned.name}!`, 0xfacc15);
          this.notify(
            store.locale === "es"
              ? `¡${spawned.name} se ha unido a tu imperio!`
              : `${spawned.name} joined your empire!`
          );
        }
      }
      this.syncRendererSnapshot(1);
    }
  }

  async activateProducerJob(uid: number, tx: number, ty: number, itemId: number, cpIndex: number): Promise<void> {
    const ok = await this.sendCommands([{ cmd: "activate", args: [tx, ty, itemId, cpIndex] }]);
    if (ok) {
      const mins = COLLECT_MINUTES[Math.max(0, Math.min(3, cpIndex - 1))] ?? 5;
      this.renderer.spawnFloatingText(tx, ty, `⏱ ${mins < 60 ? `${mins}m` : `${mins / 60}h`}`, 0x38bdf8);
      this.refreshSelectedSummary();
      this.syncRendererSnapshot(1);
      void uid;
    }
  }

  openCollectPickerForSelected(): void {
    const sel = useGameStore.getState().selectedSummary;
    if (!sel || !this.battle) return;
    const ent = this.battle.entities.get(sel.uid);
    if (!ent) return;
    useGameStore.getState().setCollectPickerTarget({
      uid: ent.uid,
      itemId: ent.itemId,
      tx: Math.round(ent.tx),
      ty: Math.round(ent.ty),
      name: ent.name,
      collectType: ent.collectType,
      baseCollect: Math.max(10, ent.collectAmount),
      workerCount: Math.max(1, ent.garrison.length)
    });
  }

  async popWorkerFromSelected(all: boolean): Promise<void> {
    const store = useGameStore.getState();
    const sel = store.selectedSummary;
    if (!sel || !this.battle) return;
    const ent = this.battle.entities.get(sel.uid);
    if (!ent || ent.garrison.length === 0) return;

    const toPop = all ? [...ent.garrison] : [ent.garrison[0]!];
    const commands: CommandPayload[] = [];
    const spawns: { id: number; tx: number; ty: number }[] = [];
    for (const unitId of toPop) {
      const spot = this.findFreeTileNear(Math.round(ent.tx), Math.round(ent.ty), 5);
      commands.push({ cmd: "pop_unit", args: [Math.round(ent.tx), Math.round(ent.ty), ent.itemId, unitId, spot.tx, spot.ty] });
      spawns.push({ id: unitId, tx: spot.tx, ty: spot.ty });
    }

    const ok = await this.sendCommands(commands);
    if (ok) {
      for (const sp of spawns) {
        const gIdx = ent.garrison.indexOf(sp.id);
        if (gIdx >= 0) ent.garrison.splice(gIdx, 1);
        const spawned = this.battle.spawnFromItem(sp.id, sp.tx, sp.ty, "player", 4);
        if (spawned && isVillagerEntity(spawned)) {
          this.battle.setUnitsStance([spawned.uid], "stand");
        }
      }
      this.refreshSelectedSummary();
      this.syncRendererSnapshot(1);
    }
  }

  async trainUnitFromSelected(unitId: number): Promise<void> {
    const store = useGameStore.getState();
    const sel = store.selectedSummary;
    if (!sel || !this.battle) return;
    const spot = this.findFreeTileNear(sel.tx, sel.ty, 4);
    const ok = await this.sendCommands([
      { cmd: "push_queue_unit", args: [sel.tx, sel.ty, sel.itemId, unitId] },
      { cmd: "pop_queue_unit", args: [sel.tx, sel.ty, sel.itemId, spot.tx, spot.ty] }
    ]);
    if (ok) {
      const ent = this.battle.spawnFromItem(unitId, spot.tx, spot.ty, "player", 4);
      if (ent) {
        if (isVillagerEntity(ent)) this.battle.setUnitsStance([ent.uid], "stand");
        this.renderer.spawnFloatingText(spot.tx, spot.ty, `${ent.name}!`, 0x4ade80);
      }
      this.syncRendererSnapshot(1);
    }
  }

  async collectBuildingEntity(ent: SimEntity): Promise<void> {
    const store = useGameStore.getState();
    const info = this.getBuildingProductionInfo(ent, Math.floor(Date.now() / 1000));
    const tx = Math.round(ent.tx);
    const ty = Math.round(ent.ty);
    const fallbackSpawn = this.findFreeTileNear(tx, ty, 4);
    const prevGarrisonLen = ent.garrison.length;

    const ok = await this.sendCommands([
      {
        cmd: "collect_new",
        args: [tx, ty, ent.itemId, info.cpIndex > 0 ? info.cpIndex : 2, fallbackSpawn.tx, fallbackSpawn.ty]
      }
    ]);
    if (ok) {
      if (ent.subcatFunctional !== SUBCAT_BUILDING_FARM && !COLLECT_VARIABLE_IDS.has(ent.itemId)) {
        this.collectedCooldownUntil.set(ent.uid, performance.now() + 30000);
      }
      // Sync farm garrison in case insufficient wood caused farmer ejection
      const updatedTuple = this.findSaveTuple(ent.itemId, tx, ty);
      if (updatedTuple) {
        const nextGarrison = updatedTuple[6].map(Number);
        if (prevGarrisonLen > nextGarrison.length && ent.subcatFunctional === SUBCAT_BUILDING_FARM) {
          const ejectedId = ent.garrison[0] ?? 500;
          ent.garrison = nextGarrison;
          const v = this.battle?.spawnFromItem(ejectedId, fallbackSpawn.tx, fallbackSpawn.ty, "player", 4);
          if (v && this.battle) this.battle.setUnitsStance([v.uid], "stand");
          this.notify(
            store.locale === "es"
              ? "Madera insuficiente para resembrar: el aldeano salió del campo."
              : "Not enough wood to replant: villager left the field."
          );
        } else {
          ent.garrison = nextGarrison;
        }
      }

      const resLabel =
        ent.collectType === "w"
          ? store.locale === "es" ? "Madera" : "Wood"
          : ent.collectType === "s"
            ? store.locale === "es" ? "Piedra" : "Stone"
            : ent.collectType === "f"
              ? store.locale === "es" ? "Comida" : "Food"
              : store.locale === "es" ? "Oro" : "Gold";
      this.renderer.spawnFloatingText(tx, ty, `+${info.effectiveAmount} ${resLabel}`, 0xfacc15);
      this.refreshSelectedSummary();
      this.syncRendererSnapshot(1);
    }
  }

  async collectSelectedBuilding(): Promise<void> {
    const sel = useGameStore.getState().selectedSummary;
    if (!sel || !this.battle) return;
    const ent = this.battle.entities.get(sel.uid);
    if (!ent) return;
    await this.collectBuildingEntity(ent);
  }

  async upgradeSelectedBuilding(): Promise<void> {
    const store = useGameStore.getState();
    const sel = store.selectedSummary;
    if (!sel) return;
    const ok = await this.sendCommands([{ cmd: "upgrade", args: [sel.tx, sel.ty, sel.itemId] }]);
    if (ok && useGameStore.getState().activeSave) {
      this.loadPersistentVillage(useGameStore.getState().activeSave!);
    }
  }

  async rotateSelected(): Promise<void> {
    const store = useGameStore.getState();
    const sel = store.selectedSummary;
    if (!sel || !this.battle) return;
    const nextOrient = sel.type === "u" ? ((sel.orientation % 8) + 1) : (sel.orientation === 0 ? 1 : 0);
    const ent = this.battle.entities.get(sel.uid);
    if (ent) ent.orientation = nextOrient;
    if (store.playMode === "village") {
      await this.sendCommands([{ cmd: "orient", args: [sel.tx, sel.ty, nextOrient, sel.itemId] }]);
    }
    this.refreshSelectedSummary();
  }

  async storeSelected(): Promise<void> {
    const sel = useGameStore.getState().selectedSummary;
    if (!sel) return;
    const ok = await this.sendCommands([{ cmd: "store_item", args: [sel.tx, sel.ty, sel.itemId] }]);
    if (ok && useGameStore.getState().activeSave) {
      this.loadPersistentVillage(useGameStore.getState().activeSave!);
    }
  }

  async sellEntityDirectly(ent: SimEntity): Promise<void> {
    const store = useGameStore.getState();
    if (ent.subcatFunctional === SUBCAT_BUILDING_TOWNHALL) {
      this.notify(store.locale === "es" ? "No puedes vender tu Ayuntamiento" : "You cannot sell your Town Hall");
      return;
    }
    const def = store.itemsById.get(ent.itemId);
    const refund = def ? computeSellRefund(def) : { costType: "g", amount: 0 };
    const tx = Math.round(ent.tx);
    const ty = Math.round(ent.ty);
    const ok = await this.sendCommands([{ cmd: "sell", args: [tx, ty, ent.itemId, "SELL"] }]);
    if (ok && this.battle) {
      ent.alive = false;
      ent.dyingTicks = 0;
      if (ent.type === "b") {
        this.grid.vacate(ent.uid, tx, ty, ent.width, ent.height);
      } else {
        this.battle.unitOccupancy.release(ent.uid);
      }
      if (store.selectedUids.includes(ent.uid)) {
        store.setSelection([], null);
        this.renderer.setSelectedEntities([]);
      }
      if (refund.amount > 0) {
        this.renderer.spawnFloatingText(tx, ty, `+${refund.amount}`, 0xfacc15);
      }
      this.syncRendererSnapshot(1);
    }
  }

  async sellSelected(): Promise<void> {
    const sel = useGameStore.getState().selectedSummary;
    if (!sel || !this.battle) return;
    const ent = this.battle.entities.get(sel.uid);
    if (!ent) return;
    await this.sellEntityDirectly(ent);
  }

  async expandTerritory(expId: number, withCash = false): Promise<void> {
    const ok = await this.sendCommands([{ cmd: "expand", args: [expId, withCash ? 1 : 0] }]);
    if (ok) {
      this.renderer.setOwnedExpansions(useGameStore.getState().expansions);
      this.notify(
        useGameStore.getState().locale === "es"
          ? `¡Territorio #${expId} expandido!`
          : `Territory #${expId} expanded!`
      );
    }
  }

  private async castMagicAt(magicId: number, tx: number, ty: number): Promise<void> {
    const store = useGameStore.getState();
    const def = store.magics.find((m) => m.id === magicId);
    if (!def || !this.battle) return;

    const ok = await this.sendCommands([{ cmd: "use_magic", args: [magicId, def.mana] }]);
    if (!ok) return;

    const evs = this.battle.castMagicSpell(magicId, tx, ty, "player", 1);
    this.processSimEvents(evs);
    store.setCastingMagicId(null);
    this.renderer.setSpellPreview(null);
  }

  private handleEntitySelect(ent: RenderEntityData | null, additive: boolean): void {
    const store = useGameStore.getState();
    if (!ent) {
      store.setSelection([], null);
      return;
    }
    void this.audio.playSfx(SFX_NAMES.buttonClick, 0.7);
    const nextUids = additive
      ? Array.from(new Set([...store.selectedUids, ent.uid]))
      : [ent.uid];
    this.renderer.setSelectedEntities(nextUids);
    store.setSelection(nextUids, this.buildEntitySummary(ent.uid));
  }

  private handleBoxSelect(uids: number[]): void {
    const store = useGameStore.getState();
    if (uids.length > 0) void this.audio.playSfx(SFX_NAMES.buttonClick, 0.7);
    store.setSelection(uids, uids.length > 0 ? this.buildEntitySummary(uids[0]!) : null);
  }

  private setContextualCursor(cursor: string): void {
    if (this.lastCursor !== cursor) {
      this.lastCursor = cursor;
      this.renderer.setCursorStyle(cursor);
    }
  }

  private handleTileHover(tx: number, ty: number, hitEntity: RenderEntityData | null = null): void {
    const store = useGameStore.getState();
    store.setHoveredTile({ tx, ty });

    if (store.castingMagicId !== null) {
      this.setContextualCursor(CURSORS.spell);
      this.renderer.setSpellPreview({
        magicId: store.castingMagicId,
        radiusTiles: 5.5,
        color: SPELL_COLORS[store.castingMagicId] ?? 0x38bdf8
      });
      return;
    }

    if (store.placingItemId !== null) {
      this.setContextualCursor(CURSORS.spell);
      const def = store.itemsById.get(store.placingItemId);
      if (def) {
        const expId = tileToExpansionId(tx, ty);
        const owned = store.expansions.includes(expId);
        const free = this.grid.canPlace(tx, ty, def.width, def.height);
        this.renderer.setPlacementPreview({
          imgName: def.imgName,
          width: def.width,
          height: def.height,
          valid: owned && free
        });
      }
      return;
    }

    if (store.movingEntityUid !== null && this.battle) {
      this.setContextualCursor(CURSORS.spell);
      const ent = this.battle.entities.get(store.movingEntityUid);
      if (ent) {
        const expId = tileToExpansionId(tx, ty);
        const owned = store.expansions.includes(expId);
        const free = this.grid.canPlace(tx, ty, ent.width, ent.height, ent.uid);
        this.renderer.setPlacementPreview({
          imgName: ent.imgName,
          width: ent.width,
          height: ent.height,
          valid: owned && free
        });
      }
      return;
    }

    if (store.playMode === "village" && store.cursorTool === "bulldoze") {
      this.setContextualCursor(CURSORS.bulldoze);
      return;
    }

    if (store.playMode === "visit") {
      this.setContextualCursor(hitEntity && hitEntity.type === "b" ? CURSORS.collect : CURSORS.default);
      return;
    }

    // Dynamic contextual RTS cursor
    const hasSelectedUnits =
      this.battle !== null &&
      store.selectedUids.some((id) => {
        const e = this.battle?.entities.get(id);
        return e && e.alive && e.type === "u" && e.team === "player";
      });

    if (hasSelectedUnits) {
      if (hitEntity && hitEntity.team === "enemy") {
        this.setContextualCursor(CURSORS.attack);
        return;
      }
      if (hitEntity && hitEntity.type === "b") {
        const def = store.itemsById.get(hitEntity.itemId);
        const hasVillager = store.selectedUids.some((id) => {
          const e = this.battle?.entities.get(id);
          return e && e.alive && isVillagerEntity(e);
        });
        if (def && isWorkableOrHarvestableTarget(def.subcatFunctional, def.id) && hasVillager) {
          this.setContextualCursor(CURSORS.harvest);
          return;
        }
      }
      if (!hitEntity) {
        this.setContextualCursor(CURSORS.move);
        return;
      }
    }

    if (hitEntity?.collectReady || hitEntity?.statusBadge === "zzz" || hitEntity?.statusBadge === "ready_nest") {
      this.setContextualCursor(CURSORS.collect);
      return;
    }

    const boxDefault = store.playMode !== "village" || store.cursorTool === "box_select";
    this.setContextualCursor(boxDefault ? CURSORS.boxSelect : CURSORS.default);
  }

  private issueUnitOrder(
    playerUnits: number[],
    tx: number,
    ty: number,
    hitEntity: RenderEntityData | null
  ): boolean {
    if (!this.battle || playerUnits.length === 0) return false;
    const store = useGameStore.getState();

    // 1. Attack enemy unit or enemy building
    if (hitEntity && hitEntity.team === "enemy") {
      this.battle.orderAttack(playerUnits, hitEntity.uid);
      this.renderer.spawnCommandPulse(hitEntity.tx, hitEntity.ty, 0xef4444);
      this.renderer.spawnNumberParticle(
        hitEntity.tx,
        hitEntity.ty,
        "damage_self",
        store.locale === "es" ? "¡Atacar!" : "Attack!"
      );
      void this.audio.playSfx(SFX_NAMES.sword1, 0.7);
      return true;
    }

    // 2. Harvest Tree (125), Stone (126), Gold (127), OR enter Producer Building (121/124) / Farm (122)
    // Phase 4 Fix (`IsoUnit.as:2222-2240`): NEVER play Lumber/Rock/Farm SFX when issuing order;
    // SFX plays ONLY upon arrival in `BattleEngine.tickWorkerHarvest`!
    if (hitEntity && hitEntity.type === "b") {
      const def = store.itemsById.get(hitEntity.itemId);
      if (def && isWorkableOrHarvestableTarget(def.subcatFunctional, def.id)) {
        const workers: number[] = [];
        const escorts: number[] = [];
        for (const id of playerUnits) {
          const e = this.battle.entities.get(id);
          if (!e) continue;
          if (isVillagerEntity(e)) workers.push(id);
          else escorts.push(id);
        }
        if (workers.length > 0) {
          this.battle.orderHarvestGroup(workers, hitEntity.uid);
          if (escorts.length > 0) {
            this.battle.orderMove(escorts, hitEntity.tx, hitEntity.ty);
          }
          this.renderer.spawnCommandPulse(hitEntity.tx, hitEntity.ty, 0xfacc15);
          const actionLabel = isEnterableWorkBuildingSubcat(def.subcatFunctional)
            ? def.subcatFunctional === SUBCAT_BUILDING_FARM
              ? store.locale === "es" ? "Sembrar" : "Sow"
              : store.locale === "es" ? "Trabajar" : "Work"
            : store.locale === "es" ? "Recolectar" : "Harvest";
          this.renderer.spawnNumberParticle(hitEntity.tx, hitEntity.ty, "gold", actionLabel);
          void this.audio.playSfx(SFX_NAMES.buttonClick, 0.45);
          return true;
        }
      }
    }

    // 3. Move to target tile (canonical Squad square/spiral formation)
    if (tx >= 0 && ty >= 0 && tx < 100 && ty < 100) {
      this.battle.orderMove(playerUnits, tx, ty);
      this.renderer.spawnCommandPulse(tx, ty, 0x4ade80);
      void this.audio.playSfx(SFX_NAMES.buttonClick, 0.5);
      return true;
    }
    return false;
  }

  private async handleTileClick(
    tx: number,
    ty: number,
    button: number,
    hitEntity: RenderEntityData | null,
    mods: ClickModifiers = { ctrlKey: false, shiftKey: false, doubleClick: false }
  ): Promise<void> {
    const store = useGameStore.getState();

    // Right-click: cancel active tool/bulldoze OR issue RTS Move/Attack/Harvest order
    if (button === 2) {
      if (
        store.placingItemId !== null ||
        store.castingMagicId !== null ||
        store.movingEntityUid !== null ||
        store.cursorTool === "bulldoze"
      ) {
        this.handleEscape();
        return;
      }
      if (this.battle && store.selectedUids.length > 0 && store.playMode !== "visit") {
        const playerUnits = store.selectedUids.filter((id) => {
          const e = this.battle?.entities.get(id);
          return e && e.alive && e.type === "u" && e.team === "player";
        });
        if (playerUnits.length > 0) {
          this.issueUnitOrder(playerUnits, tx, ty, hitEntity);
        }
      }
      return;
    }

    if (button !== 0) return;

    // Neighbor Visit Mode (`PopOverVisit` — read-only with friendly assists, NO tutorial!)
    if (store.playMode === "visit") {
      const visit = store.visitingNeighbor;
      if (hitEntity && hitEntity.type === "b" && visit) {
        if (visit.assistsRemaining <= 0) {
          this.notify(
            store.locale === "es"
              ? `Ya ayudaste al máximo a ${visit.name} en esta visita.`
              : `No assists remaining for ${visit.name} on this visit.`
          );
          return;
        }
        const ok = await this.sendCommands([{ cmd: "neighbor_assist", args: [visit.id] }]);
        if (ok) {
          store.setVisitingNeighbor({ ...visit, assistsRemaining: visit.assistsRemaining - 1 });
          this.renderer.spawnNumberParticle(hitEntity.tx, hitEntity.ty, "gold", "+10 Oro");
          this.renderer.spawnNumberParticle(hitEntity.tx, hitEntity.ty - 0.6, "xp", "+3 XP");
        }
      }
      return;
    }

    // Left-click when casting spell
    if (store.castingMagicId !== null) {
      await this.castMagicAt(store.castingMagicId, tx, ty);
      return;
    }

    // Left-click when placing building/unit from shop
    if (store.placingItemId !== null) {
      const def = store.itemsById.get(store.placingItemId);
      if (!def) return;
      const expId = tileToExpansionId(tx, ty);
      if (!store.expansions.includes(expId) || !this.grid.canPlace(tx, ty, def.width, def.height)) {
        this.notify(store.locale === "es" ? "Terreno bloqueado o fuera de tu imperio" : "Blocked or outside owned land");
        return;
      }
      await this.buyAndPlace(def.id, tx, ty);
      return;
    }

    // Left-click when moving an existing building
    if (store.movingEntityUid !== null && this.battle) {
      const ent = this.battle.entities.get(store.movingEntityUid);
      if (ent) {
        const expId = tileToExpansionId(tx, ty);
        if (store.expansions.includes(expId) && this.grid.canPlace(tx, ty, ent.width, ent.height, ent.uid)) {
          const oldTx = Math.round(ent.tx);
          const oldTy = Math.round(ent.ty);
          const ok = await this.sendCommands([{ cmd: "move", args: [oldTx, oldTy, ent.itemId, tx, ty, ent.orientation] }]);
          if (ok) {
            this.grid.vacate(ent.uid, oldTx, oldTy, ent.width, ent.height);
            ent.tx = tx;
            ent.ty = ty;
            ent.prevTx = tx;
            ent.prevTy = ty;
            this.grid.occupy(ent.uid, tx, ty, ent.width, ent.height);
            store.setMovingEntityUid(null);
            this.renderer.setPlacementPreview(null);
            this.refreshSelectedSummary();
          }
        }
      }
      return;
    }

    // Explicit Bulldoze / Delete / Sell Cursor Tool (`CURSOR_BULLDOZE`, `GuiManager.as:1252`)
    if (store.playMode === "village" && store.cursorTool === "bulldoze" && this.battle) {
      if (!hitEntity || hitEntity.team !== "player") {
        this.notify(
          store.locale === "es"
            ? "Haz clic en un edificio o unidad tuya para vender/eliminar (Esc sale del modo)."
            : "Click one of your buildings or units to sell/delete (Esc exits tool)."
        );
        return;
      }
      const ent = this.battle.entities.get(hitEntity.uid);
      if (ent) {
        await this.sellEntityDirectly(ent);
      }
      return;
    }

    const selectedPlayerUnits = this.battle
      ? store.selectedUids.filter((id) => {
          const e = this.battle?.entities.get(id);
          return e && e.alive && e.type === "u" && e.team === "player";
        })
      : [];

    // Canonical double-click on player units -> select nearby same-type units
    if (mods.doubleClick && hitEntity && hitEntity.type === "u" && hitEntity.team === "player" && this.battle) {
      const nearbySameType: number[] = [];
      for (const e of this.battle.entities.values()) {
        if (
          e.alive &&
          e.team === "player" &&
          e.type === "u" &&
          e.itemId === hitEntity.itemId &&
          Math.hypot(e.tx - hitEntity.tx, e.ty - hitEntity.ty) <= 10
        ) {
          nearbySameType.push(e.uid);
        }
      }
      this.renderer.setSelectedEntities(nearbySameType);
      this.handleBoxSelect(nearbySameType);
      return;
    }

    // Double-click on a special building opens its interior directly
    if (
      mods.doubleClick &&
      store.playMode === "village" &&
      hitEntity &&
      hitEntity.type === "b" &&
      hitEntity.team === "player"
    ) {
      const def = store.itemsById.get(hitEntity.itemId);
      if (def && this.openSpecialBuildingInterior(def.id, def.subcatFunctional, Math.round(hitEntity.tx), Math.round(hitEntity.ty))) {
        return;
      }
    }

    // Classic Social Empires left-click commanding when player units are selected
    if (selectedPlayerUnits.length > 0) {
      if (hitEntity && hitEntity.team === "enemy") {
        this.issueUnitOrder(selectedPlayerUnits, tx, ty, hitEntity);
        return;
      }
      if (hitEntity && hitEntity.type === "b") {
        const def = store.itemsById.get(hitEntity.itemId);
        const hasVillager = selectedPlayerUnits.some((id) => {
          const e = this.battle?.entities.get(id);
          return e ? isVillagerEntity(e) : false;
        });
        if (def && isWorkableOrHarvestableTarget(def.subcatFunctional, def.id) && hasVillager) {
          this.issueUnitOrder(selectedPlayerUnits, tx, ty, hitEntity);
          return;
        }
      }
      if (!hitEntity) {
        this.issueUnitOrder(selectedPlayerUnits, tx, ty, null);
        return;
      }
    }

    if (hitEntity) {
      this.handleEntitySelect(hitEntity, mods.ctrlKey || mods.shiftKey);

      // Direct click on player building with active ZZZ (choose producer job) or Collect Ready badge
      if (store.playMode === "village" && hitEntity.type === "b" && hitEntity.team === "player" && this.battle) {
        const ent = this.battle.entities.get(hitEntity.uid);
        if (ent) {
          if (hitEntity.statusBadge === "zzz" && COLLECT_VARIABLE_IDS.has(ent.itemId) && ent.garrison.length > 0) {
            this.openCollectPickerForSelected();
            return;
          }
          if (hitEntity.collectReady && (ent.subcatFunctional === SUBCAT_BUILDING_FARM || COLLECT_VARIABLE_IDS.has(ent.itemId))) {
            await this.collectBuildingEntity(ent);
            return;
          }
        }
      }

      if (hitEntity.team === "enemy") {
        this.notify(
          store.locale === "es"
            ? "Selecciona tus tropas (o pulsa 'Ejército') y haz clic en este enemigo para atacar."
            : "Select your troops (or click 'Army') and click this enemy to attack."
        );
      }
    } else {
      this.renderer.setSelectedEntities([]);
      this.handleEntitySelect(null, false);
    }
  }

  private onAnimationFrame(dtMs: number): void {
    if (!this.battle) return;

    let ticked = false;
    const alpha = this.clock.advance(dtMs, () => {
      ticked = true;
      const events = this.battle!.step();
      if (events.length > 0) this.processSimEvents(events);
      this.checkBattleProgress();
    });

    this.renderer.setRenderAlpha(alpha);
    if (ticked) {
      this.syncRendererSnapshot(alpha);
    }

    const now = performance.now();
    if (now - this.lastHudSyncAt > 250) {
      this.lastHudSyncAt = now;
      useGameStore.getState().setMetrics(this.renderer.getMetrics());
      this.refreshSelectedSummary();
    }

    // Periodic check (every 5s) for completed 3h stone/gold regeneration craters
    if (now - this.lastRegenCheckAt > 5000) {
      this.lastRegenCheckAt = now;
      this.checkRegeneratingNodes();
    }
  }

  private checkRegeneratingNodes(): void {
    const store = useGameStore.getState();
    if (store.playMode !== "village" || !this.battle || !store.activeSave?.maps[0]) return;
    const nowSec = Math.floor(Date.now() / 1000);
    for (const tuple of store.activeSave.maps[0].items) {
      const [itemId, tx, ty, , ts] = tuple;
      if ((itemId === ID_BUILDING_REGEN_GOLD || itemId === ID_BUILDING_REGEN_STONE) && nowSec - ts >= REGEN_ORE_DURATION_SEC) {
        void this.sendCommands([{ cmd: "finish_regen", args: [tx, ty, itemId] }]).then((ok) => {
          if (ok && useGameStore.getState().activeSave) {
            this.loadPersistentVillage(useGameStore.getState().activeSave!);
          }
        });
        break;
      }
    }
  }

  private processSimEvents(events: readonly SimVisualEvent[]): void {
    const store = useGameStore.getState();
    for (const ev of events) {
      switch (ev.type) {
        case "damage": {
          if (!ev.throttled && ev.amount > 0) {
            const kind: NumberParticleKind = ev.targetTeam === "player" ? "damage_self" : "damage_enemy";
            this.renderer.spawnNumberParticle(
              ev.tx,
              ev.ty,
              kind,
              ev.crit ? `-${ev.amount}!` : `-${ev.amount}`,
              Boolean(ev.crit)
            );
          }
          if (ev.absorbed && ev.absorbed > 0) {
            this.renderer.spawnNumberParticle(
              ev.tx,
              ev.ty - 0.3,
              "absorbed",
              store.locale === "es" ? `Escudo -${ev.absorbed}` : `Shield -${ev.absorbed}`
            );
          }
          break;
        }
        case "heal":
          this.renderer.spawnNumberParticle(ev.tx, ev.ty, "heal", `+${ev.amount}`);
          break;
        case "spell_cast":
          this.renderer.spawnSpellBurst(ev.tx, ev.ty, ev.radius, SPELL_COLORS[ev.magicId] ?? 0x38bdf8);
          break;
        case "limit_cast":
          this.renderer.spawnSpellBurst(ev.tx, ev.ty, ev.radius, 0xfacc15);
          this.renderer.spawnNumberParticle(ev.tx, ev.ty, "gold", "⚡ LIMIT!", true);
          break;
        case "sfx":
          void this.audio.playSfx(ev.name, 0.75);
          break;
        case "worker_enter_building": {
          // Remove entered villager from active selection
          if (store.selectedUids.includes(ev.workerUid)) {
            const remaining = store.selectedUids.filter((id) => id !== ev.workerUid);
            this.renderer.setSelectedEntities(remaining);
            store.setSelection(remaining, remaining.length > 0 ? this.buildEntitySummary(remaining[0]!) : null);
          }
          if (store.playMode === "village") {
            void this.sendCommands([
              {
                cmd: "push_unit",
                args: [ev.buildingTx, ev.buildingTy, ev.buildingItemId, ev.workerItemId, ev.workerTx, ev.workerTy]
              }
            ]).then((ok) => {
              if (!ok) return;
              const bEnt = this.battle?.entities.get(ev.buildingUid);
              if (!bEnt) return;
              if (ev.subcatFunctional === SUBCAT_BUILDING_FARM) {
                this.renderer.spawnFloatingText(
                  ev.buildingTx,
                  ev.buildingTy,
                  store.locale === "es" ? "¡Sembrando! (30s)" : "Sowing! (30s)",
                  0x4ade80
                );
              } else if (COLLECT_VARIABLE_IDS.has(ev.buildingItemId)) {
                const tuple = this.findSaveTuple(ev.buildingItemId, ev.buildingTx, ev.buildingTy);
                const cp = Number(tuple?.[7]?.cp ?? 0);
                if (cp === 0) {
                  useGameStore.getState().setCollectPickerTarget({
                    uid: bEnt.uid,
                    itemId: bEnt.itemId,
                    tx: ev.buildingTx,
                    ty: ev.buildingTy,
                    name: bEnt.name,
                    collectType: bEnt.collectType,
                    baseCollect: Math.max(10, bEnt.collectAmount),
                    workerCount: Math.max(1, bEnt.garrison.length)
                  });
                }
              }
              this.refreshSelectedSummary();
              this.syncRendererSnapshot(1);
            });
          }
          break;
        }
        case "harvest": {
          const kind: NumberParticleKind =
            ev.resourceType === "w"
              ? "wood"
              : ev.resourceType === "s"
                ? "stone"
                : ev.resourceType === "f"
                  ? "food"
                  : "gold";
          const label =
            ev.resourceType === "w"
              ? store.locale === "es" ? "Madera" : "Wood"
              : ev.resourceType === "s"
                ? store.locale === "es" ? "Piedra" : "Stone"
                : ev.resourceType === "f"
                  ? store.locale === "es" ? "Comida" : "Food"
                  : store.locale === "es" ? "Oro" : "Gold";
          this.renderer.spawnNumberParticle(ev.tx, ev.ty, kind, `+${ev.amount} ${label}`);
          if (store.playMode === "village") {
            const resEnt = this.battle?.entities.get(ev.resourceUid);
            const rTx = Math.round(ev.tx);
            const rTy = Math.round(ev.ty);
            const itemId = ev.itemId ?? resEnt?.itemId;
            if (itemId !== undefined) {
              const batch: CommandPayload[] = [{ cmd: "collect_new", args: [rTx, rTy, itemId, 2] }];
              if (ev.depleted) {
                batch.push({ cmd: "sell", args: [rTx, rTy, itemId, "HARVEST"] });
                const subcat = ev.subcatFunctional ?? resEnt?.subcatFunctional ?? 0;
                if (subcat === SUBCAT_RESOURCE_STONE) {
                  batch.push({ cmd: "spawn_regen_node", args: [rTx, rTy, ID_BUILDING_REGEN_STONE] });
                  this.battle?.spawnFromItem(ID_BUILDING_REGEN_STONE, rTx, rTy, "neutral", 0);
                } else if (subcat === SUBCAT_RESOURCE_GOLD) {
                  batch.push({ cmd: "spawn_regen_node", args: [rTx, rTy, ID_BUILDING_REGEN_GOLD] });
                  this.battle?.spawnFromItem(ID_BUILDING_REGEN_GOLD, rTx, rTy, "neutral", 0);
                }
                if (store.selectedUids.includes(ev.resourceUid)) {
                  store.setSelection([], null);
                  this.renderer.setSelectedEntities([]);
                }
              }
              void this.sendCommands(batch);
            }
          }
          break;
        }
        case "death":
          if (ev.team === "enemy") {
            const xp = Math.max(10, ev.xp || 25);
            this.renderer.spawnNumberParticle(ev.tx, ev.ty, "xp", `+${xp} XP`);
            if (store.playMode === "village") {
              void this.sendCommands([{ cmd: "gold_statue_conversion", args: [Math.max(25, xp * 2)] }]);
            }
          }
          break;
      }
    }
  }

  private checkBattleProgress(): void {
    const store = useGameStore.getState();
    const status = store.battleStatus;
    if (!status || status.finished || !this.battle) return;

    let enemiesAlive = 0;
    let playerUnitsAlive = 0;
    for (const e of this.battle.entities.values()) {
      if (!e.alive) continue;
      if (e.team === "enemy" && (e.type === "u" || e.attack > 0 || e.subcatFunctional === 112)) {
        enemiesAlive += 1;
      } else if (e.team === "player" && e.type === "u") {
        playerUnitsAlive += 1;
      }
    }

    if (status.mode === "survival") {
      if (enemiesAlive === 0) {
        this.survivalWaveTimer += 1;
        if (this.survivalWaveTimer >= 60) {
          this.survivalWaveTimer = 0;
          const nextWave = status.wave + 1;
          this.spawnSurvivalWave(nextWave);
          store.setBattleStatus({
            ...status,
            wave: nextWave,
            enemiesRemaining: 4 + nextWave * 2,
            playerUnitsAlive,
            lootGold: status.lootGold + 400 * status.wave,
            lootXp: status.lootXp + 60 * status.wave
          });
        }
        return;
      }
      if (playerUnitsAlive === 0) {
        store.setBattleStatus({ ...status, enemiesRemaining: enemiesAlive, playerUnitsAlive: 0, finished: "defeat" });
        return;
      }
    } else {
      if (enemiesAlive === 0) {
        void this.audio.playSfx(SFX_NAMES.achievement, 0.9);
        store.setBattleStatus({ ...status, enemiesRemaining: 0, playerUnitsAlive, finished: "victory" });
        return;
      }
      if (playerUnitsAlive === 0) {
        store.setBattleStatus({ ...status, enemiesRemaining: enemiesAlive, playerUnitsAlive: 0, finished: "defeat" });
        return;
      }
    }

    if (enemiesAlive !== status.enemiesRemaining || playerUnitsAlive !== status.playerUnitsAlive) {
      store.setBattleStatus({ ...status, enemiesRemaining: enemiesAlive, playerUnitsAlive });
    }
  }

  private getBuildingProductionInfo(
    e: SimEntity,
    nowSec: number
  ): {
    collectReady: boolean;
    effectiveAmount: number;
    cpIndex: number;
    elapsedSec: number;
    durationSec: number;
    visualState: RenderEntityData["buildingVisualState"];
    statusBadge: RenderEntityData["statusBadge"];
  } {
    const store = useGameStore.getState();
    const priv = store.activeSave?.privateState ?? {};
    const tuple = store.playMode === "village" ? this.findSaveTuple(e.itemId, e.tx, e.ty) : null;

    // 1. Dragon Breeding Nest (1233) & Monsters Nest (1255) (`NestsManager.as`)
    if (e.itemId === 1233 && e.team === "player") {
      const active = Number(priv.dragonNestActive ?? 0) === 1;
      const step = Number(priv.stepNumber ?? 0);
      const lastTs = Number(priv.timeStampTakeCare ?? 0);
      const ready = active && (step >= NEST_TOTAL_STEPS || lastTs === 0 || nowSec - lastTs >= NEST_STEP_COOLDOWN_SEC);
      return {
        collectReady: false,
        effectiveAmount: 0,
        cpIndex: 0,
        elapsedSec: 0,
        durationSec: 0,
        visualState: "loop",
        statusBadge: ready ? "ready_nest" : !active ? "zzz" : null
      };
    }
    if (e.itemId === 1255 && e.team === "player") {
      const active = Number(priv.monsterNestActive ?? 0) === 1;
      const step = Number(priv.stepMonsterNumber ?? 0);
      const lastTs = Number(priv.timeStampTakeCareMonster ?? 0);
      const ready = active && (step >= NEST_TOTAL_STEPS || lastTs === 0 || nowSec - lastTs >= NEST_STEP_COOLDOWN_SEC);
      return {
        collectReady: false,
        effectiveAmount: 0,
        cpIndex: 0,
        elapsedSec: 0,
        durationSec: 0,
        visualState: "loop",
        statusBadge: ready ? "ready_nest" : !active ? "zzz" : null
      };
    }

    // 2. Crop Fields / Farms (`subcat 122`): exact 30-second sowing cycle when villager is inside
    if (e.subcatFunctional === SUBCAT_BUILDING_FARM && e.team === "player") {
      if (e.garrison.length === 0) {
        return {
          collectReady: false,
          effectiveAmount: e.collectAmount,
          cpIndex: 0,
          elapsedSec: 0,
          durationSec: 30,
          visualState: "idle",
          statusBadge: null
        };
      }
      const isFemale = e.garrison[0] === 501;
      const startTs = tuple ? tuple[4] : nowSec;
      const durationSec = 30;
      const elapsedSec = Math.max(0, nowSec - startTs);
      const ready = elapsedSec >= durationSec;
      return {
        collectReady: ready,
        effectiveAmount: e.collectAmount,
        cpIndex: 0,
        elapsedSec,
        durationSec,
        visualState: ready
          ? isFemale ? "ready_female" : "ready_male"
          : isFemale ? "working_female" : "working_male",
        statusBadge: ready ? "collect" : null
      };
    }

    // 3. Variable Producer Buildings (Gold Mines, Stone Mines, Lumber Mills, Windmills)
    if (COLLECT_VARIABLE_IDS.has(e.itemId) && e.team === "player") {
      if (e.garrison.length === 0) {
        return {
          collectReady: false,
          effectiveAmount: e.collectAmount,
          cpIndex: 0,
          elapsedSec: 0,
          durationSec: 0,
          visualState: "idle",
          statusBadge: null
        };
      }
      const cpIndex = Number(tuple?.[7]?.cp ?? 0);
      if (cpIndex <= 0) {
        return {
          collectReady: false,
          effectiveAmount: e.collectAmount,
          cpIndex: 0,
          elapsedSec: 0,
          durationSec: 0,
          visualState: "idle",
          statusBadge: "zzz"
        };
      }
      const mins = COLLECT_MINUTES[Math.max(0, Math.min(3, cpIndex - 1))] ?? 5;
      const durationSec = mins * 60;
      const startTs = tuple ? tuple[4] : nowSec;
      const elapsedSec = Math.max(0, nowSec - startTs);
      const ready = elapsedSec >= durationSec;
      const effectiveAmount = computeProducerYield(e.collectAmount, e.garrison.length, cpIndex);
      return {
        collectReady: ready,
        effectiveAmount,
        cpIndex,
        elapsedSec,
        durationSec,
        visualState: "idle",
        statusBadge: ready ? "collect" : null
      };
    }

    // 4. Other passive income buildings (Houses, Wonders, etc.)
    const passiveReady =
      e.type === "b" &&
      e.team === "player" &&
      e.collectAmount > 0 &&
      !WILD_NEUTRAL_SUBCATS.has(e.subcatFunctional) &&
      e.subcatFunctional !== SUBCAT_BUILDING_MINE &&
      e.subcatFunctional !== SUBCAT_BUILDING_MILL &&
      performance.now() >= (this.collectedCooldownUntil.get(e.uid) ?? 0);

    return {
      collectReady: passiveReady,
      effectiveAmount: e.collectAmount,
      cpIndex: 0,
      elapsedSec: 0,
      durationSec: 0,
      visualState: undefined,
      statusBadge: passiveReady ? "collect" : null
    };
  }

  private syncRendererSnapshot(_alpha: number): void {
    if (!this.battle) return;
    const renderList: RenderEntityData[] = [];
    const store = useGameStore.getState();
    const selectedSet = new Set(store.selectedUids);
    const nowSec = Math.floor(Date.now() / 1000);
    const biomeIdx = Math.max(0, ALL_BIOME_SKINS.indexOf(store.activeBiome));

    for (const e of this.battle.entities.values()) {
      if (!e.alive && e.dyingTicks <= 0) continue;
      const prod = e.type === "b" ? this.getBuildingProductionInfo(e, nowSec) : null;
      renderList.push({
        uid: e.uid,
        itemId: e.itemId,
        imgName: e.imgName,
        name: e.name,
        type: e.type,
        tx: e.tx,
        ty: e.ty,
        prevTx: e.prevTx,
        prevTy: e.prevTy,
        width: e.width,
        height: e.height,
        orientation: e.orientation,
        animState: e.animState,
        animSeq: e.animSeq,
        velocity: e.velocity,
        speed2x: e.status.speed2xTicks > 0,
        subcatFunctional: e.subcatFunctional,
        hp: e.hp,
        maxHp: e.maxHp,
        flying: e.flying,
        scale: e.behavior?.scale ?? 1,
        selected: selectedSet.has(e.uid),
        team: e.team,
        limitRatio: e.behavior?.hasLimitBar && e.limitMax > 0 ? e.limitGauge / e.limitMax : 0,
        collectReady: prod ? prod.collectReady : false,
        collectType: e.collectType,
        buildingVisualState: prod?.visualState,
        statusBadge: prod?.statusBadge ?? null,
        biomeIndex: biomeIdx,
        garrisonCount: e.garrison.length,
        inCombat: e.inCombatTicks > 0,
        frozen: e.status.frozenTicks > 0,
        poisoned: e.status.poisonTicks > 0,
        shielded: e.status.shieldHp > 0,
        enlarged: e.status.enlargedTicks > 0
      });
    }

    const projList: RenderProjectileData[] = this.battle.projectiles.map((p) => ({
      id: p.id,
      kind: p.kind,
      fromTx: p.x,
      fromTy: p.y,
      toTx: p.targetTx,
      toTy: p.targetTy,
      progress: p.progress,
      color: p.color
    }));

    this.renderer.setEntities(renderList);
    this.renderer.setProjectiles(projList);
  }

  private buildEntitySummary(uid: number): SelectedEntitySummary | null {
    const e: SimEntity | undefined = this.battle?.entities.get(uid);
    if (!e || !e.alive) return null;
    const tuple = this.findSaveTuple(e.itemId, e.tx, e.ty);
    const attrs = tuple?.[7];
    const queue = Array.isArray(attrs?.queue) ? (attrs.queue as number[]) : [];
    const nowSec = Math.floor(Date.now() / 1000);
    const prod = e.type === "b" ? this.getBuildingProductionInfo(e, nowSec) : null;

    return {
      uid: e.uid,
      itemId: e.itemId,
      imgName: e.imgName,
      name: e.name,
      type: e.type,
      team: e.team,
      tx: Math.round(e.tx),
      ty: Math.round(e.ty),
      hp: Math.round(e.hp),
      maxHp: Math.round(e.maxHp),
      attack: e.attack,
      defense: e.defense,
      attackRange: e.attackRange,
      velocity: e.velocity,
      orientation: e.orientation,
      animState: e.animState,
      stance: e.stance,
      subcatFunctional: e.subcatFunctional,
      limitGauge: e.limitGauge,
      limitMax: e.limitMax,
      specialCooldownSecs: e.specialCooldownTicks.map((ticks) => Math.ceil(ticks / 30)),
      collectReady: prod ? prod.collectReady : false,
      collectAmount: prod ? prod.effectiveAmount : e.collectAmount,
      collectType: e.collectType,
      unitCapacity: e.unitCapacity,
      garrison: [...e.garrison],
      productionCp: prod?.cpIndex ?? 0,
      productionElapsedSec: prod?.elapsedSec ?? 0,
      productionDurationSec: prod?.durationSec ?? 0,
      statusBadge: prod?.statusBadge ?? null,
      queue,
      behavior: e.behavior
    };
  }

  private refreshSelectedSummary(): void {
    const store = useGameStore.getState();
    if (store.selectedUids.length === 0) return;
    const summary = this.buildEntitySummary(store.selectedUids[0]!);
    store.setSelection(summary ? store.selectedUids : [], summary);
  }

  private notify(msg: string): void {
    useGameStore.getState().setToast(msg);
    window.setTimeout(() => {
      if (useGameStore.getState().toast === msg) {
        useGameStore.getState().setToast(null);
      }
    }, 3400);
  }

  destroy(): void {
    window.removeEventListener("keydown", this.keyHandler);
    this.renderer.destroy();
    this.audio.destroy();
  }
}
