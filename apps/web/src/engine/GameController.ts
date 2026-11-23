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
  type SimEntity,
  type SimVisualEvent
} from "@sef/engine-sim";
import {
  IsoRenderer,
  type ClickModifiers,
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
 * 60-144+ FPS `IsoRenderer`, `AudioManager`, and authoritative SQLite command syncing.
 * Keeps React HUD cleanly decoupled from the per-frame render loop.
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

  constructor(hostEl: HTMLElement) {
    this.audio = new AudioManager(audioBaseUrl());
    this.renderer = new IsoRenderer(
      hostEl,
      {
        onEntitySelect: (ent, additive) => this.handleEntitySelect(ent, additive),
        onBoxSelect: (uids) => this.handleBoxSelect(uids),
        onTileHover: (tx, ty) => this.handleTileHover(tx, ty),
        onTileClick: (tx, ty, button, hit, mods) => void this.handleTileClick(tx, ty, button, hit, mods),
        onEscape: () => this.handleEscape(),
        onTickFrame: (dtMs) => this.onAnimationFrame(dtMs)
      },
      assetsBaseUrl()
    );
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
    store.setActiveMusic("village");

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
          // Authentic village stances:
          // - Wild trolls outside owned land guard their camp defensively (never attack trees!)
          // - Villagers wait calmly for player harvest/move orders
          // - Player soldiers defend nearby threats and obey all click orders
          if (team === "enemy" && !ownedExps.has(tileToExpansionId(tx, ty))) {
            ent.stance = "defensive";
          } else if (team === "player" && isVillagerEntity(ent)) {
            ent.stance = "stand";
          } else if (team === "player" && ent.type === "u") {
            ent.stance = "defensive";
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
      // Fallback: select all player units including villagers
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
    if (first) this.renderer.camera.centerOnTile(first.tx, first.ty);
    this.notify(
      store.locale === "es"
        ? `Ejército seleccionado (${uids.length}). Haz clic en un enemigo para atacar o en el suelo para mover.`
        : `Army selected (${uids.length}). Click an enemy to attack or ground to move.`
    );
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
    store.setActiveMusic(mode === "pvp" ? "assault" : "quest");
    this.audio.playMusic(mode === "pvp" ? "assault" : "quest", 600);

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
    void this.renderer.preloadSprites(preloadNames);
    this.notify(
      store.locale === "es"
        ? `¡Batalla iniciada! ${deployedUids.length} tropas desplegadas. Clic derecho para atacar/mover.`
        : `Battle started! ${deployedUids.length} troops deployed. Right-click to move/attack.`
    );
  }

  startSurvivalArena(mapId: number): void {
    const store = useGameStore.getState();
    const save = store.activeSave;
    const arena = SURVIVAL_BIOMES.find((b) => b.id === mapId) ?? SURVIVAL_BIOMES[0]!;
    if (!save) return;

    store.setActiveModal(null);
    store.setPlayMode("survival");
    store.setActiveBiome(arena.biome);
    store.setActiveMusic("survival");
    this.audio.playMusic("survival", 600);

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

  private handleTileHover(tx: number, ty: number): void {
    const store = useGameStore.getState();
    store.setHoveredTile({ tx, ty });

    if (store.castingMagicId !== null) {
      this.renderer.setSpellPreview({
        magicId: store.castingMagicId,
        radiusTiles: 5.5,
        color: SPELL_COLORS[store.castingMagicId] ?? 0x38bdf8
      });
      return;
    }

    if (store.placingItemId !== null) {
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
    }
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
      this.renderer.spawnFloatingText(
        hitEntity.tx,
        hitEntity.ty,
        store.locale === "es" ? "Atacar!" : "Attack!",
        0xf87171
      );
      void this.audio.playSfx(SFX_NAMES.sword1, 0.7);
      return true;
    }

    // 2. Harvest Tree (125), Stone (126), Gold (127), or Farm (122)
    if (hitEntity && hitEntity.type === "b") {
      const def = store.itemsById.get(hitEntity.itemId);
      if (def && isHarvestableResourceSubcat(def.subcatFunctional)) {
        const workers = playerUnits.filter((id) => {
          const e = this.battle?.entities.get(id);
          return e ? isVillagerEntity(e) : false;
        });
        const harvesters = workers.length > 0 ? workers : playerUnits;
        for (const wUid of harvesters) {
          this.battle.orderHarvest(wUid, hitEntity.uid);
        }
        this.renderer.spawnCommandPulse(hitEntity.tx, hitEntity.ty, 0xfacc15);
        this.renderer.spawnFloatingText(
          hitEntity.tx,
          hitEntity.ty,
          store.locale === "es" ? "Recolectar" : "Harvest",
          0xfacc15
        );
        void this.audio.playSfx(
          def.collectType === "w" ? SFX_NAMES.lumber : def.collectType === "f" ? SFX_NAMES.farm : SFX_NAMES.rock,
          0.65
        );
        return true;
      }
    }

    // 3. Move to target tile
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

    // Classic Social Empires Left-Click Selection & Commanding:
    const selectedPlayerUnits = this.battle
      ? store.selectedUids.filter((id) => {
          const e = this.battle?.entities.get(id);
          return e && e.alive && e.type === "u" && e.team === "player";
        })
      : [];

    // Double-click a friendly unit -> select all friendly units of the same type
    if (mods.doubleClick && hitEntity && hitEntity.type === "u" && hitEntity.team === "player" && this.battle) {
      const sameTypeUids: number[] = [];
      for (const e of this.battle.entities.values()) {
        if (e.alive && e.team === "player" && e.type === "u" && e.itemId === hitEntity.itemId) {
          sameTypeUids.push(e.uid);
        }
      }
      this.renderer.setSelectedEntities(sameTypeUids);
      this.handleBoxSelect(sameTypeUids);
      return;
    }

    // If friendly unit(s) are already selected, left-clicking an enemy, a harvestable resource,
    // or empty ground issues the order directly (just like classic Social Empires!)
    if (selectedPlayerUnits.length > 0) {
      if (hitEntity && hitEntity.team === "enemy") {
        this.issueUnitOrder(selectedPlayerUnits, tx, ty, hitEntity);
        return;
      }
      if (hitEntity && hitEntity.type === "b") {
        const def = store.itemsById.get(hitEntity.itemId);
        if (def && isHarvestableResourceSubcat(def.subcatFunctional)) {
          this.issueUnitOrder(selectedPlayerUnits, tx, ty, hitEntity);
          return;
        }
      }
      if (!hitEntity) {
        this.issueUnitOrder(selectedPlayerUnits, tx, ty, null);
        return;
      }
    }

    // Otherwise, select the clicked entity (or deselect if clicking empty ground with a building selected)
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
        case "damage":
          this.renderer.spawnFloatingText(ev.tx, ev.ty, ev.crit ? `-${ev.amount}!` : `-${ev.amount}`, ev.crit ? 0xf97316 : 0xfef08a);
          break;
        case "heal":
          this.renderer.spawnFloatingText(ev.tx, ev.ty, `+${ev.amount}`, 0x4ade80);
          break;
        case "spell_cast":
          this.renderer.spawnSpellBurst(ev.tx, ev.ty, ev.radius, SPELL_COLORS[ev.magicId] ?? 0x38bdf8);
          break;
        case "sfx":
          void this.audio.playSfx(ev.name, 0.75);
          break;
        case "harvest": {
          const label =
            ev.resourceType === "w"
              ? store.locale === "es" ? "Madera" : "Wood"
              : ev.resourceType === "s"
                ? store.locale === "es" ? "Piedra" : "Stone"
                : ev.resourceType === "f"
                  ? store.locale === "es" ? "Comida" : "Food"
                  : store.locale === "es" ? "Oro" : "Gold";
          this.renderer.spawnFloatingText(ev.tx, ev.ty, `+${ev.amount} ${label}`, 0xfacc15);
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
            this.renderer.spawnFloatingText(ev.tx, ev.ty, `+${xp} XP`, 0x38bdf8);
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
        hp: e.hp,
        maxHp: e.maxHp,
        flying: e.flying,
        scale: e.behavior?.scale ?? 1,
        selected: selectedSet.has(e.uid),
        team: e.team,
        limitRatio: e.behavior?.hasLimitBar && e.behavior.limitMax > 0 ? e.limitGauge / e.behavior.limitMax : 0,
        collectReady: this.isBuildingCollectReady(e, nowMs),
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
      limitGauge: e.limitGauge,
      limitMax: e.behavior?.limitMax ?? 0,
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
    this.renderer.destroy();
    this.audio.destroy();
  }
}
