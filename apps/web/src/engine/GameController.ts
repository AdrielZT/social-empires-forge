import {
  tileToExpansionId,
  type CommandPayload,
  type SaveFile,
  type TerrainSkin
} from "@sef/shared-types";
import {
  BattleEngine,
  FixedStepClock,
  OccupancyGrid,
  SUBCAT_BUILDING_TOWNHALL,
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
import { useGameStore, type PlayMode, type SelectedEntitySummary } from "../store/gameStore.js";

const RESOURCE_SUBCATS = new Set([2, 3, 4, 122, 125, 126, 127]);
const WILD_NEUTRAL_SUBCATS = new Set([74, 75, 125, 126, 127, 811]);

function isHarvestableResourceSubcat(subcat: number): boolean {
  return RESOURCE_SUBCATS.has(subcat);
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
  private saveTupleToUid = new Map<number, number>(); // entity uid -> index in save.maps[0].items
  private collectedCooldownUntil = new Map<number, number>(); // building uid -> timestamp ms
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

  loadPersistentVillage(save: SaveFile): void {
    const store = useGameStore.getState();
    store.setActiveSave(save);
    store.setPlayMode("village");
    store.setBattleStatus(null);
    store.setSelection([], null);
    store.setControlGroups({});
    store.setActiveMusic("village");
    this.renderer.setBoxSelectDefault(store.boxSelectInVillage);

    this.renderer.clearEntities();
    this.grid = new OccupancyGrid();
    this.battle = new BattleEngine(this.grid, store.itemsById, store.behaviorsById);
    this.saveTupleToUid.clear();
    this.collectedCooldownUntil.clear();

    const map0 = save.maps[0];
    const ownedExps = new Set(useGameStore.getState().expansions);
    const preloadNames = new Set<string>();
    if (map0) {
      map0.items.forEach((tuple, idx) => {
        const [itemId, tx, ty, orientation] = tuple;
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
          // Authentic village stances (`IA.as`):
          // - Wild trolls outside owned land guard their camp defensively (leash 20 tiles)
          // - Villagers remain in survive/stand state ready for harvest/move orders
          // - Player soldiers guard defensively and obey all click orders
          if (team === "enemy" && !ownedExps.has(tileToExpansionId(tx, ty))) {
            this.battle!.setUnitsStance([ent.uid], "defensive");
          } else if (team === "player" && isVillagerEntity(ent)) {
            this.battle!.setUnitsStance([ent.uid], "stand");
          } else if (team === "player" && ent.type === "u") {
            this.battle!.setUnitsStance([ent.uid], "defensive");
          }

          this.saveTupleToUid.set(ent.uid, idx);
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
    store.setPlayMode(mode);
    store.setSelection([], null);
    store.setControlGroups({});
    store.setActiveMusic(mode === "pvp" ? "assault" : "quest");
    this.audio.playMusic(mode === "pvp" ? "assault" : "quest", 600);
    this.renderer.setBoxSelectDefault(true);

    this.renderer.clearEntities();
    this.grid = new OccupancyGrid();
    this.battle = new BattleEngine(this.grid, store.itemsById, store.behaviorsById);
    this.saveTupleToUid.clear();

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

  async sendCommands(commands: CommandPayload[]): Promise<boolean> {
    const store = useGameStore.getState();
    const save = store.activeSave;
    if (!save) return false;

    const packetId = `pkt_${Date.now()}_${this.packetSeq++}`;
    try {
      const body = await gameApi.executeCommands(save.playerInfo.pid, packetId, commands);
      if (!body) return false;

      if (body.save) {
        store.setActiveSave(body.save);
      }
      for (const ev of body.events ?? []) {
        if (ev.type === "sfx" && ev.name) {
          void this.audio.playSfx(ev.name, 0.85);
        } else if (ev.type === "level_up" && ev.level) {
          this.renderer.spawnFloatingText(50, 50, `¡NIVEL ${ev.level}!`, 0xfacc15);
          this.notify(store.locale === "es" ? `¡Subiste al Nivel ${ev.level}!` : `Reached Level ${ev.level}!`);
        }
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

  async buyAndPlace(itemId: number, tx: number, ty: number): Promise<void> {
    const store = useGameStore.getState();
    const def = store.itemsById.get(itemId);
    if (!def) return;
    const ok = await this.sendCommands([{ cmd: "buy", args: [itemId, tx, ty, 0] }]);
    if (ok && this.battle && store.playMode === "village") {
      const ent = this.battle.spawnFromItem(itemId, tx, ty, "player", def.type === "u" ? 4 : 0);
      if (ent && store.activeSave?.maps[0]) {
        this.saveTupleToUid.set(ent.uid, store.activeSave.maps[0].items.length - 1);
      }
      this.renderer.spawnFloatingText(tx, ty, `+${def.xp} XP`, 0x38bdf8);
      store.setPlacingItemId(null);
      this.renderer.setPlacementPreview(null);
      this.syncRendererSnapshot(1);
    }
  }

  async trainUnitFromSelected(unitId: number): Promise<void> {
    const store = useGameStore.getState();
    const sel = store.selectedSummary;
    if (!sel || !this.battle) return;
    // Find nearest open tile around building
    let spawnTx = sel.tx + 1;
    let spawnTy = sel.ty + 1;
    outer: for (let r = 1; r <= 4; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          const cx = sel.tx + dx;
          const cy = sel.ty + dy;
          if (this.grid.inBounds(cx, cy) && this.grid.get(cx, cy) === 0) {
            spawnTx = cx;
            spawnTy = cy;
            break outer;
          }
        }
      }
    }
    const ok = await this.sendCommands([
      { cmd: "push_queue_unit", args: [sel.tx, sel.ty, sel.itemId, unitId] },
      { cmd: "pop_queue_unit", args: [sel.tx, sel.ty, sel.itemId, spawnTx, spawnTy] }
    ]);
    if (ok) {
      const ent = this.battle.spawnFromItem(unitId, spawnTx, spawnTy, "player", 4);
      if (ent) {
        this.renderer.spawnFloatingText(spawnTx, spawnTy, `${ent.name}!`, 0x4ade80);
      }
      this.syncRendererSnapshot(1);
    }
  }

  async collectSelectedBuilding(): Promise<void> {
    const sel = useGameStore.getState().selectedSummary;
    if (!sel) return;
    const ok = await this.sendCommands([{ cmd: "collect_new", args: [sel.tx, sel.ty, sel.itemId, 2] }]);
    if (ok) {
      this.collectedCooldownUntil.set(sel.uid, performance.now() + 30000);
      const resLabel =
        sel.collectType === "w"
          ? "Madera"
          : sel.collectType === "s"
            ? "Piedra"
            : sel.collectType === "f"
              ? "Comida"
              : "Oro";
      this.renderer.spawnFloatingText(sel.tx, sel.ty, `+${sel.collectAmount} ${resLabel}`, 0xfacc15);
      this.syncRendererSnapshot(1);
    }
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

  async sellSelected(): Promise<void> {
    const sel = useGameStore.getState().selectedSummary;
    if (!sel) return;
    const ok = await this.sendCommands([{ cmd: "sell", args: [sel.tx, sel.ty, sel.itemId, "SELL"] }]);
    if (ok && useGameStore.getState().activeSave) {
      this.loadPersistentVillage(useGameStore.getState().activeSave!);
    }
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

    // Dynamic contextual RTS cursor (`attack`, `harvest`, `move`, `collect`, `boxSelect`, `default`)
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
        if (def && isHarvestableResourceSubcat(def.subcatFunctional) && hasVillager) {
          this.setContextualCursor(CURSORS.harvest);
          return;
        }
      }
      if (!hitEntity) {
        this.setContextualCursor(CURSORS.move);
        return;
      }
    }

    if (hitEntity?.collectReady) {
      this.setContextualCursor(CURSORS.collect);
      return;
    }

    const boxDefault = store.playMode !== "village" || store.boxSelectInVillage;
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

    // 2. Harvest Tree (125), Stone (126), Gold (127), or Farm (122)
    // Canonical `IsoUnit.CanHarvest` (`IsoUnit.as:2791-2805`): only villagers harvest;
    // any military units selected alongside villagers escort to the perimeter.
    if (hitEntity && hitEntity.type === "b") {
      const def = store.itemsById.get(hitEntity.itemId);
      if (def && isHarvestableResourceSubcat(def.subcatFunctional)) {
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
          this.renderer.spawnNumberParticle(
            hitEntity.tx,
            hitEntity.ty,
            "gold",
            store.locale === "es" ? "Recolectar" : "Harvest"
          );
          void this.audio.playSfx(
            def.collectType === "w" ? SFX_NAMES.lumber : def.collectType === "f" ? SFX_NAMES.farm : SFX_NAMES.rock,
            0.65
          );
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

    // Right-click: cancel active tool OR issue RTS Move/Attack/Harvest order
    if (button === 2) {
      if (store.placingItemId !== null || store.castingMagicId !== null || store.movingEntityUid !== null) {
        this.handleEscape();
        return;
      }
      if (this.battle && store.selectedUids.length > 0) {
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

    const selectedPlayerUnits = this.battle
      ? store.selectedUids.filter((id) => {
          const e = this.battle?.entities.get(id);
          return e && e.alive && e.type === "u" && e.team === "player";
        })
      : [];

    // Canonical `Config.DOUBLECLICK_SELECTION_RADIUS = 10` (`Config.as:224`):
    // Double-click selects nearby friendly units of the same type (or all if >0 within radius 10)
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
        if (def && isHarvestableResourceSubcat(def.subcatFunctional) && hasVillager) {
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
            if (resEnt) {
              void this.sendCommands([{ cmd: "collect_new", args: [Math.round(resEnt.tx), Math.round(resEnt.ty), resEnt.itemId, 2] }]);
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

  private isBuildingCollectReady(e: SimEntity, nowMs: number): boolean {
    if (e.type !== "b" || e.team !== "player" || e.collectAmount <= 0) return false;
    if (WILD_NEUTRAL_SUBCATS.has(e.subcatFunctional)) return false;
    const cd = this.collectedCooldownUntil.get(e.uid) ?? 0;
    return nowMs >= cd;
  }

  private syncRendererSnapshot(_alpha: number): void {
    if (!this.battle) return;
    const renderList: RenderEntityData[] = [];
    const selectedSet = new Set(useGameStore.getState().selectedUids);
    const nowMs = performance.now();

    for (const e of this.battle.entities.values()) {
      if (!e.alive && e.dyingTicks <= 0) continue;
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
        collectReady: this.isBuildingCollectReady(e, nowMs),
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
    if (!e) return null;
    const save = useGameStore.getState().activeSave;
    const tupleIdx = this.saveTupleToUid.get(uid);
    const attrs = tupleIdx !== undefined ? save?.maps[0]?.items[tupleIdx]?.[7] : undefined;
    const queue = Array.isArray(attrs?.queue) ? (attrs.queue as number[]) : [];

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
      limitGauge: e.limitGauge,
      limitMax: e.limitMax,
      specialCooldownSecs: e.specialCooldownTicks.map((ticks) => Math.ceil(ticks / 30)),
      collectReady: this.isBuildingCollectReady(e, performance.now()),
      collectAmount: e.collectAmount,
      collectType: e.collectType,
      queue,
      behavior: e.behavior
    };
  }

  private refreshSelectedSummary(): void {
    const store = useGameStore.getState();
    if (store.selectedUids.length === 0) return;
    const summary = this.buildEntitySummary(store.selectedUids[0]!);
    store.setSelection(store.selectedUids, summary);
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
