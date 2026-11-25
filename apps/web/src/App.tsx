import { useEffect, useRef } from "react";
import type { TerrainSkin } from "@sef/shared-types";
import { getUiStrings } from "@sef/game-data";
import { SFX_NAMES } from "@sef/engine-audio";
import { GameController } from "./engine/GameController.js";
import { useGameStore } from "./store/gameStore.js";
import { ShopModal } from "./components/ShopModal.js";
import { MagicBar } from "./components/MagicBar.js";
import { ExtendedPortrait } from "./components/ExtendedPortrait.js";
import { WorldMapModal } from "./components/WorldMapModal.js";
import { SystemsModal } from "./components/SystemsModal.js";
import { LevelUpModal } from "./components/LevelUpModal.js";
import { NestModal } from "./components/NestModal.js";
import { PopupCollectModal } from "./components/PopupCollectModal.js";
import { PopupExpandModal } from "./components/PopupExpandModal.js";
import { SpecialBuildingModal } from "./components/SpecialBuildingModal.js";
import { CollectionsModal } from "./components/CollectionsModal.js";
import { FriendsDock } from "./components/FriendsDock.js";
import { Minimap } from "./components/Minimap.js";
import { CornerRivets } from "./components/ClassicFrame.js";
import { HudIcon, ResourceIcon } from "./components/GameIcons.js";
import { assetsBaseUrl } from "./api/paths.js";

const ALL_BIOMES: TerrainSkin[] = [
  "terreno",
  "terrenodesierto",
  "terrenohielo",
  "terrenomar2",
  "terrenomineral",
  "terrenonubes",
  "terrenoselva",
  "islandbigboss3"
];

export function App() {
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<GameController | null>(null);

  const locale = useGameStore((s) => s.locale);
  const loading = useGameStore((s) => s.loading);
  const error = useGameStore((s) => s.error);
  const toast = useGameStore((s) => s.toast);
  const activeSave = useGameStore((s) => s.activeSave);
  const playMode = useGameStore((s) => s.playMode);
  const adminMode = useGameStore((s) => s.adminMode);
  const cursorTool = useGameStore((s) => s.cursorTool);
  const visitingNeighbor = useGameStore((s) => s.visitingNeighbor);
  const levels = useGameStore((s) => s.levels);
  const resources = useGameStore((s) => s.resources);
  const activeBiome = useGameStore((s) => s.activeBiome);
  const musicEnabled = useGameStore((s) => s.musicEnabled);
  const sfxEnabled = useGameStore((s) => s.sfxEnabled);
  const showGrid = useGameStore((s) => s.showGrid);
  const controlGroups = useGameStore((s) => s.controlGroups);
  const activeModal = useGameStore((s) => s.activeModal);
  const specialInteriorTarget = useGameStore((s) => s.specialInteriorTarget);
  const expandModalExpId = useGameStore((s) => s.expandModalExpId);
  const placingItemId = useGameStore((s) => s.placingItemId);
  const movingEntityUid = useGameStore((s) => s.movingEntityUid);
  const castingMagicId = useGameStore((s) => s.castingMagicId);
  const battleStatus = useGameStore((s) => s.battleStatus);
  const hoveredTile = useGameStore((s) => s.hoveredTile);
  const metrics = useGameStore((s) => s.metrics);
  const itemsById = useGameStore((s) => s.itemsById);

  const setLocale = useGameStore((s) => s.setLocale);
  const setAdminMode = useGameStore((s) => s.setAdminMode);
  const setCursorTool = useGameStore((s) => s.setCursorTool);
  const setActiveBiome = useGameStore((s) => s.setActiveBiome);
  const setMusicEnabled = useGameStore((s) => s.setMusicEnabled);
  const setSfxEnabled = useGameStore((s) => s.setSfxEnabled);
  const setShowGrid = useGameStore((s) => s.setShowGrid);
  const setActiveModal = useGameStore((s) => s.setActiveModal);
  const setSpecialInteriorTarget = useGameStore((s) => s.setSpecialInteriorTarget);
  const setExpandModalExpId = useGameStore((s) => s.setExpandModalExpId);
  const setSystemsTab = useGameStore((s) => s.setSystemsTab);
  const setPlacingItemId = useGameStore((s) => s.setPlacingItemId);
  const setMovingEntityUid = useGameStore((s) => s.setMovingEntityUid);
  const setCastingMagicId = useGameStore((s) => s.setCastingMagicId);
  const setSelection = useGameStore((s) => s.setSelection);

  const t = getUiStrings(locale);

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;
    const ctrl = new GameController(host);
    controllerRef.current = ctrl;
    void ctrl.init();

    const unlockOnce = () => {
      ctrl.audio.unlock();
      ctrl.audio.playMusic(useGameStore.getState().activeMusic, 600);
      window.removeEventListener("pointerdown", unlockOnce);
    };
    window.addEventListener("pointerdown", unlockOnce);

    return () => {
      window.removeEventListener("pointerdown", unlockOnce);
      ctrl.destroy();
      controllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    void controllerRef.current?.renderer.setBiome(activeBiome);
  }, [activeBiome]);

  useEffect(() => {
    controllerRef.current?.renderer.setShowGrid(showGrid);
  }, [showGrid]);

  useEffect(() => {
    if (playMode === "village") {
      controllerRef.current?.renderer.setBoxSelectDefault(cursorTool === "box_select");
    } else if (playMode === "visit") {
      controllerRef.current?.renderer.setBoxSelectDefault(false);
    } else {
      controllerRef.current?.renderer.setBoxSelectDefault(true);
    }
  }, [playMode, cursorTool]);

  useEffect(() => {
    controllerRef.current?.audio.setMusicEnabled(musicEnabled);
  }, [musicEnabled]);

  useEffect(() => {
    controllerRef.current?.audio.setSfxEnabled(sfxEnabled);
  }, [sfxEnabled]);

  const clickSfx = () => {
    void controllerRef.current?.audio.playSfx(SFX_NAMES.buttonClick, 0.75);
  };

  const placingDef = placingItemId !== null ? itemsById.get(placingItemId) : null;
  const activeGroupEntries = Object.entries(controlGroups)
    .map(([k, uids]) => [Number(k), uids] as const)
    .filter(([, uids]) => uids.length > 0)
    .sort((a, b) => a[0] - b[0]);

  const curLvlXp = Number(levels[Math.max(0, resources.level - 1)]?.exp_required ?? 0);
  const nextLvlXp = Number(levels[resources.level]?.exp_required ?? curLvlXp + 100);
  const xpPct =
    nextLvlXp > curLvlXp
      ? Math.max(0, Math.min(100, Math.round(((resources.xp - curLvlXp) / (nextLvlXp - curLvlXp)) * 100)))
      : 100;

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#2b5216]">
      {/* Full-viewport 60+ FPS WebGL2/WebGPU Isometric Canvas */}
      <div ref={canvasHostRef} className="absolute inset-0 h-full w-full" />

      {/* Top Classic Resource & Empire Bar */}
      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <div className="sp-panel pointer-events-auto relative flex items-center gap-2.5 rounded-xl px-3.5 py-1.5">
          <CornerRivets />
          <div
            data-testid="hud-level-badge"
            className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-amber-300 bg-gradient-to-b from-amber-400 to-amber-700 text-sm font-black text-white shadow"
          >
            {resources.level}
          </div>
          <div className="leading-tight min-w-[125px]">
            <div className="flex items-center justify-between gap-2 text-xs font-black text-amber-300 drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]">
              <span className="truncate max-w-[120px]">{activeSave?.playerInfo.name ?? t.appTitle}</span>
              <span className="text-[10px] font-bold text-amber-100/75">{t.modes[playMode]}</span>
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-amber-100/85">
              <span>
                {resources.xp.toLocaleString()}/{nextLvlXp.toLocaleString()} {t.resources.xp}
              </span>
            </div>
            <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-stone-950/90 border border-amber-500/40">
              <div
                className="h-full bg-gradient-to-r from-sky-400 to-cyan-300 transition-all"
                style={{ width: `${xpPct}%` }}
              />
            </div>
          </div>
        </div>

        {/* Classic Resource Counters */}
        <div className="sp-panel pointer-events-auto relative flex flex-wrap items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-extrabold">
          <CornerRivets />
          <ResourcePill iconType="g" label={t.resources.gold} value={resources.coins} color="text-amber-300" />
          <ResourcePill iconType="w" label={t.resources.wood} value={resources.wood} color="text-orange-300" />
          <ResourcePill iconType="s" label={t.resources.stone} value={resources.stone} color="text-stone-200" />
          <ResourcePill iconType="f" label={t.resources.food} value={resources.food} color="text-rose-300" />
          <ResourcePill iconType="c" label={t.resources.cash} value={resources.cash} color="text-emerald-300" />
          <span className="sp-inset flex items-center gap-1 rounded-md px-2 py-0.5 text-sky-200">
            <ResourceIcon type="pop" className="h-4 w-4" />
            <span>
              {resources.population}/{resources.maxPopulation}
            </span>
          </span>
        </div>

        {/* Instant User/Admin Switch + FPS Telemetry + Language Toggle */}
        <div className="pointer-events-auto flex items-center gap-2">
          <button
            type="button"
            data-testid="toggle-admin-mode"
            onClick={() => {
              clickSfx();
              setAdminMode(!adminMode);
            }}
            title={
              locale === "es"
                ? adminMode
                  ? "Modo Admin activo (todo desbloqueado). Clic para volver a Modo Usuario sin perder la partida."
                  : "Modo Usuario activo (progresión por nivel). Clic para activar Modo Admin sin perder la partida."
                : adminMode
                  ? "Admin Mode active (everything unlocked). Click to return to User Mode without losing your save."
                  : "User Mode active (level progression). Click to switch to Admin Mode without losing your save."
            }
            className={`rounded-lg border px-2.5 py-1 text-[11px] font-black shadow transition cursor-pointer ${
              adminMode
                ? "border-purple-300 bg-gradient-to-b from-purple-600 to-purple-900 text-white"
                : "border-amber-500/60 bg-stone-950/90 text-amber-200 hover:border-amber-300"
            }`}
          >
            {adminMode
              ? locale === "es" ? "👑 Modo Admin" : "👑 Admin Mode"
              : locale === "es" ? "👤 Modo Usuario" : "👤 User Mode"}
          </button>

          <div
            data-testid="fps-badge"
            className="hidden xl:block rounded-lg border border-emerald-400/45 bg-stone-950/88 px-2.5 py-1 text-[11px] font-bold text-emerald-300 shadow"
          >
            {metrics.fps} FPS · CPU {metrics.cpuTimeMs}ms · {metrics.visibleEntities}/{metrics.totalEntities} · {metrics.loadedAtlases} atl · {metrics.rendererType}
          </div>
          {/* Keep fps-badge always present in DOM even on narrower viewports */}
          <div className="xl:hidden rounded-lg border border-emerald-400/45 bg-stone-950/88 px-2 py-1 text-[10px] font-bold text-emerald-300 shadow">
            {metrics.fps} FPS · {metrics.loadedAtlases} atl
          </div>

          <div className="sp-panel flex overflow-hidden rounded-lg text-xs font-black">
            <button
              type="button"
              onClick={() => {
                clickSfx();
                setLocale("es");
              }}
              className={`px-2 py-1 cursor-pointer ${locale === "es" ? "bg-amber-500 text-stone-950" : "text-amber-200"}`}
            >
              ES
            </button>
            <button
              type="button"
              onClick={() => {
                clickSfx();
                setLocale("en");
              }}
              className={`px-2 py-1 cursor-pointer ${locale === "en" ? "bg-amber-500 text-stone-950" : "text-amber-200"}`}
            >
              EN
            </button>
          </div>
        </div>
      </header>

      {/* Neighbor Visit Banner (NO tutorial triggered) */}
      {playMode === "visit" && visitingNeighbor && (
        <div
          data-testid="visit-banner"
          className="sp-panel pointer-events-auto absolute left-1/2 top-16 z-25 -translate-x-1/2 flex items-center gap-3 rounded-2xl border-2 border-amber-400/80 px-4 py-2 text-xs font-black text-amber-100"
        >
          <span className="text-amber-300">
            {locale === "es"
              ? `👑 Visitando a ${visitingNeighbor.name} (Nv. ${visitingNeighbor.level})`
              : `👑 Visiting ${visitingNeighbor.name} (Lv. ${visitingNeighbor.level})`}
          </span>
          <span className="rounded bg-stone-950/80 px-2 py-0.5 text-emerald-300">
            {locale === "es"
              ? `Ayudas: ${visitingNeighbor.assistsRemaining}/5`
              : `Assists: ${visitingNeighbor.assistsRemaining}/5`}
          </span>
          <button
            type="button"
            data-testid="btn-return-from-visit"
            onClick={() => {
              clickSfx();
              controllerRef.current?.returnFromVisit();
            }}
            className="sp-btn-gold flex items-center gap-1 rounded-lg px-3 py-1 cursor-pointer"
          >
            <HudIcon name="home" className="h-3.5 w-3.5" />
            <span>{locale === "es" ? "Volver a mi Imperio" : "Return Home"}</span>
          </button>
        </div>
      )}

      {/* Active Mode / Tool Banner */}
      {(placingDef || movingEntityUid !== null || castingMagicId !== null || (playMode === "village" && cursorTool === "bulldoze")) && (
        <div className="sp-panel pointer-events-auto absolute left-1/2 top-16 z-25 -translate-x-1/2 flex items-center gap-3 rounded-xl px-4 py-2 text-xs font-black text-amber-200">
          <span>
            {placingDef
              ? locale === "es"
                ? `Colocando: ${placingDef.name} (clic izq. para colocar, clic der. o Esc cancela)`
                : `Placing: ${placingDef.name} (left-click place, right-click or Esc cancels)`
              : movingEntityUid !== null
                ? locale === "es"
                  ? "Modo Mover: haz clic en la nueva posición (Esc cancela)"
                  : "Move Mode: click destination tile (Esc cancels)"
                : castingMagicId !== null
                  ? locale === "es"
                    ? "Modo Hechizo: haz clic en el objetivo para lanzar magia (Esc cancela)"
                    : "Spell Mode: click target area to cast (Esc cancels)"
                  : locale === "es"
                    ? "🔨 Herramienta Eliminar / Vender: haz clic en un edificio o unidad tuya (Esc o clic der. sale)"
                    : "🔨 Delete / Sell Tool: click your building or unit to sell (Esc or right-click exits)"}
          </span>
          <button
            type="button"
            onClick={() => {
              setPlacingItemId(null);
              setMovingEntityUid(null);
              setCastingMagicId(null);
              setCursorTool("normal");
              controllerRef.current?.renderer.setPlacementPreview(null);
              controllerRef.current?.renderer.setSpellPreview(null);
            }}
            className="sp-btn-red rounded px-2 py-0.5 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Battle / Quest / Survival / PvP Status Overlay */}
      {battleStatus && (
        <div className="sp-panel pointer-events-auto absolute left-1/2 top-16 z-20 -translate-x-1/2 flex items-center gap-4 rounded-2xl px-4 py-2 text-xs font-black">
          <span className="flex items-center gap-1.5 text-amber-300">
            <HudIcon name="sword" className="h-4 w-4" />
            {battleStatus.title}
          </span>
          {battleStatus.mode === "survival" && <span className="text-rose-300">Wave {battleStatus.wave}</span>}
          <span className="flex items-center gap-1 text-emerald-300">
            <HudIcon name="shield" className="h-3.5 w-3.5" />
            {battleStatus.playerUnitsAlive}
          </span>
          <span className="text-red-300">
            {locale === "es" ? "Enemigos:" : "Enemies:"} {battleStatus.enemiesRemaining}
          </span>
          <button
            type="button"
            onClick={() => void controllerRef.current?.returnToVillage(false)}
            className="sp-btn-stone flex items-center gap-1 rounded-lg px-2.5 py-1 cursor-pointer"
          >
            <HudIcon name="home" className="h-3.5 w-3.5" />
            <span>{locale === "es" ? "Volver a Aldea" : "Return Home"}</span>
          </button>
        </div>
      )}

      {/* Victory / Defeat Modal */}
      {battleStatus?.finished && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65">
          <div className="sp-panel relative w-full max-w-md rounded-2xl p-6 text-center">
            <CornerRivets />
            <h2 className="text-2xl font-black text-amber-300">
              {battleStatus.finished === "victory"
                ? locale === "es"
                  ? "¡VICTORIA!"
                  : "VICTORY!"
                : locale === "es"
                  ? "DERROTA"
                  : "DEFEAT"}
            </h2>
            <p className="mt-2 flex items-center justify-center gap-2 text-sm text-amber-100/90">
              {battleStatus.finished === "victory" || battleStatus.lootGold > 0 ? (
                <>
                  <span>{locale === "es" ? "Recompensa:" : "Reward:"}</span>
                  <span className="flex items-center gap-1 font-black text-amber-300">
                    +{battleStatus.lootGold}
                    <ResourceIcon type="g" className="h-4 w-4" />
                  </span>
                  <span className="font-black text-sky-300">· +{battleStatus.lootXp} XP</span>
                </>
              ) : (
                <span>
                  {locale === "es"
                    ? "Tus tropas regresan a la aldea para reagruparse."
                    : "Your troops return home to regroup."}
                </span>
              )}
            </p>
            <button
              type="button"
              onClick={() => void controllerRef.current?.returnToVillage(true)}
              className="sp-btn-gold mt-5 inline-flex items-center gap-2 rounded-xl px-6 py-2.5 text-sm font-black cursor-pointer"
            >
              <HudIcon name="home" className="h-4 w-4" />
              <span>{locale === "es" ? "Recoger y Volver al Imperio" : "Claim & Return to Empire"}</span>
            </button>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <div className="sp-panel pointer-events-none absolute left-1/2 bottom-32 z-30 -translate-x-1/2 rounded-xl px-4 py-2 text-xs font-extrabold text-amber-200">
          {toast}
        </div>
      )}

      {/* Contextual Extended Portrait */}
      <ExtendedPortrait
        onCollect={() => void controllerRef.current?.collectSelectedBuilding()}
        onUpgrade={() => void controllerRef.current?.upgradeSelectedBuilding()}
        onRotate={() => void controllerRef.current?.rotateSelected()}
        onStartMove={() => {
          const sel = useGameStore.getState().selectedSummary;
          if (sel) setMovingEntityUid(sel.uid);
        }}
        onStore={() => void controllerRef.current?.storeSelected()}
        onSell={() => void controllerRef.current?.sellSelected()}
        onTrainUnit={(uid) => void controllerRef.current?.trainUnitFromSelected(uid)}
        onTriggerSpecial={(idx) => controllerRef.current?.triggerSelectedSpecial(idx)}
        onTriggerLimit={() => controllerRef.current?.triggerSelectedLimit()}
        onChangeStance={(st) => controllerRef.current?.changeSelectedStance(st)}
        onStopUnits={() => controllerRef.current?.stopSelectedUnits()}
        onOpenSpecialInterior={() => {
          const sel = useGameStore.getState().selectedSummary;
          if (sel) {
            controllerRef.current?.openSpecialBuildingInterior(sel.itemId, sel.subcatFunctional, sel.tx, sel.ty);
          }
        }}
        onOpenCollectPicker={() => controllerRef.current?.openCollectPickerForSelected()}
        onPopWorker={(all) => void controllerRef.current?.popWorkerFromSelected(all)}
        onClose={() => {
          setSelection([], null);
          controllerRef.current?.renderer.setSelectedEntities([]);
        }}
      />

      {/* Bottom Classic Dock: Magic + Friends & King + Classic Action Bar & Cursor Tools + Minimap */}
      <footer className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex items-end justify-between gap-2 px-3 py-2">
        {/* Left: Magic Bar */}
        <MagicBar
          onBuyMana={(useCash) =>
            void controllerRef.current?.sendCommands([{ cmd: "buy_mana", args: [useCash ? 1 : 0] }])
          }
        />

        {/* Center: Control Groups + Classic Action Bar + Classic Friends & King Strip */}
        <div className="flex flex-col items-center gap-1.5 min-w-0">
          {activeGroupEntries.length > 0 && (
            <div data-testid="control-groups-bar" className="pointer-events-auto flex items-center gap-1">
              {activeGroupEntries.map(([num, uids]) => (
                <button
                  key={num}
                  type="button"
                  data-testid={`group-chip-${num}`}
                  onClick={() => controllerRef.current?.recallControlGroup(num, false)}
                  onDoubleClick={() => controllerRef.current?.recallControlGroup(num, true)}
                  title={
                    locale === "es"
                      ? `Grupo ${num} (${uids.length} tropas) · Doble clic centra cámara`
                      : `Group ${num} (${uids.length} units) · Double-click centers camera`
                  }
                  className="sp-btn-stone flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-black cursor-pointer"
                >
                  <span className="text-amber-300">[{num}]</span>
                  <span className="text-emerald-300">×{uids.length}</span>
                </button>
              ))}
            </div>
          )}

          {/* Classic Bottom Row: Friends & King coexisting cleanly with Action Dock & Explicit Cursor Tools */}
          <div className="flex flex-wrap items-end justify-center gap-1.5">
            <FriendsDock controller={controllerRef.current} />

            <div className="sp-panel pointer-events-auto relative flex flex-wrap items-center justify-center gap-1 rounded-2xl px-2.5 py-1.5 text-xs font-black">
              <CornerRivets />

              {/* Classic Shop, World Map & Unit Collections primary accesses */}
              {playMode === "village" && (
                <button
                  type="button"
                  data-testid="btn-shop"
                  onClick={() => {
                    clickSfx();
                    setActiveModal(activeModal === "shop" ? null : "shop");
                  }}
                  className="sp-btn-gold flex items-center gap-1.5 whitespace-nowrap rounded-xl px-2.5 py-1 cursor-pointer"
                >
                  <img
                    src={`${assetsBaseUrl()}/ui/hud/btn_store.webp`}
                    alt=""
                    className="h-5 w-auto object-contain drop-shadow-[0_1px_1px_rgba(0,0,0,0.85)]"
                    draggable={false}
                  />
                  <span>{t.hud.shop}</span>
                </button>
              )}

              <button
                type="button"
                data-testid="btn-worldmap"
                onClick={() => {
                  clickSfx();
                  setActiveModal(activeModal === "worldMap" ? null : "worldMap");
                }}
                className="sp-btn-red flex items-center gap-1 whitespace-nowrap rounded-xl px-2.5 py-1.5 cursor-pointer"
              >
                <HudIcon name="map" className="h-4 w-4 shrink-0" />
                <span>{t.hud.worldMap}</span>
              </button>

              {playMode === "village" && (
                <button
                  type="button"
                  data-testid="btn-collections"
                  onClick={() => {
                    clickSfx();
                    setActiveModal(activeModal === "collections" ? null : "collections");
                  }}
                  className="sp-btn-gold flex items-center gap-1 whitespace-nowrap rounded-xl px-2.5 py-1.5 cursor-pointer"
                >
                  <ResourceIcon type="xp" size={16} />
                  <span>{locale === "es" ? "Colecciones" : "Collections"}</span>
                </button>
              )}

              {playMode !== "visit" && (
                <button
                  type="button"
                  data-testid="btn-army"
                  onClick={() => {
                    clickSfx();
                    controllerRef.current?.selectAllPlayerArmy();
                  }}
                  title={locale === "es" ? "Seleccionar todo tu ejército (F2)" : "Select your army (F2)"}
                  className="sp-btn-stone flex items-center gap-1 whitespace-nowrap rounded-xl px-2 py-1.5 text-amber-100 cursor-pointer"
                >
                  <HudIcon name="army" className="h-4 w-4 shrink-0" />
                  <span>{locale === "es" ? "Ejército" : "Army"}</span>
                </button>
              )}

              <button
                type="button"
                data-testid="btn-systems"
                onClick={() => {
                  clickSfx();
                  setSystemsTab("goals");
                  setActiveModal(activeModal === "systems" ? null : "systems");
                }}
                className="sp-btn-green flex items-center gap-1 whitespace-nowrap rounded-xl px-2 py-1.5 cursor-pointer"
              >
                <HudIcon name="goals" className="h-4 w-4 shrink-0" />
                <span>{t.hud.goals}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  clickSfx();
                  setSystemsTab("market");
                  setActiveModal("systems");
                }}
                className="sp-btn-stone flex items-center gap-1 whitespace-nowrap rounded-xl px-2 py-1.5 cursor-pointer"
              >
                <HudIcon name="market" className="h-4 w-4 shrink-0" />
                <span className="hidden lg:inline">{locale === "es" ? "Mercado" : "Market"}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  clickSfx();
                  setSystemsTab("storage");
                  setActiveModal("systems");
                }}
                className="sp-btn-stone flex items-center gap-1 whitespace-nowrap rounded-xl px-2 py-1.5 text-sky-200 cursor-pointer"
              >
                <HudIcon name="storage" className="h-4 w-4 shrink-0" />
                <span className="hidden lg:inline">{t.hud.storage}</span>
              </button>

              {/* Explicit Classic Cursor Tools Group (`GuiManager.as`: Normal / Delete-Sell / Area Select) */}
              {playMode === "village" && (
                <div
                  data-testid="cursor-tools-group"
                  className="sp-inset flex items-center gap-0.5 rounded-xl p-0.5 border border-amber-500/40"
                >
                  <button
                    type="button"
                    data-testid="tool-cursor-normal"
                    onClick={() => {
                      clickSfx();
                      setCursorTool("normal");
                    }}
                    title={locale === "es" ? "Cursor Normal (seleccionar y mover cámara)" : "Normal Cursor (select & pan)"}
                    className={`rounded-lg px-2 py-1 text-[11px] font-black cursor-pointer ${
                      cursorTool === "normal" ? "sp-btn-gold" : "text-amber-200/80 hover:text-amber-100"
                    }`}
                  >
                    {locale === "es" ? "🖱️ Normal" : "🖱️ Normal"}
                  </button>
                  <button
                    type="button"
                    data-testid="tool-cursor-bulldoze"
                    onClick={() => {
                      clickSfx();
                      setCursorTool(cursorTool === "bulldoze" ? "normal" : "bulldoze");
                    }}
                    title={locale === "es" ? "Eliminar / Vender edificio o unidad (B)" : "Delete / Sell building or unit (B)"}
                    className={`rounded-lg px-2 py-1 text-[11px] font-black cursor-pointer ${
                      cursorTool === "bulldoze" ? "sp-btn-red" : "text-rose-200/85 hover:text-rose-100"
                    }`}
                  >
                    {locale === "es" ? "🔨 Vender" : "🔨 Sell"}
                  </button>
                  <button
                    type="button"
                    data-testid="tool-cursor-box"
                    onClick={() => {
                      clickSfx();
                      setCursorTool(cursorTool === "box_select" ? "normal" : "box_select");
                    }}
                    title={locale === "es" ? "Selección en área / cantidades (M)" : "Area / multi-unit box selection (M)"}
                    className={`rounded-lg px-2 py-1 text-[11px] font-black cursor-pointer ${
                      cursorTool === "box_select" ? "sp-btn-gold" : "text-emerald-200/85 hover:text-emerald-100"
                    }`}
                  >
                    {locale === "es" ? "⬚ Área" : "⬚ Area"}
                  </button>
                </div>
              )}

              <select
                value={activeBiome}
                onChange={(e) => {
                  clickSfx();
                  const biome = e.target.value as TerrainSkin;
                  setActiveBiome(biome);
                  const skinIdx = ALL_BIOMES.indexOf(biome);
                  if (playMode === "village" && skinIdx >= 0) {
                    void controllerRef.current?.sendCommands([{ cmd: "set_skin", args: [skinIdx] }]);
                  }
                }}
                className="sp-inset max-w-[110px] rounded-xl px-1.5 py-1.5 text-[11px] text-amber-100"
              >
                {ALL_BIOMES.map((b) => (
                  <option key={b} value={b}>
                    {t.biomes[b] ?? b}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => setMusicEnabled(!musicEnabled)}
                title={t.hud.music}
                className={`rounded-xl p-1.5 cursor-pointer ${musicEnabled ? "sp-btn-green" : "sp-btn-stone opacity-70"}`}
              >
                <HudIcon name={musicEnabled ? "soundOn" : "soundOff"} className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setSfxEnabled(!sfxEnabled)}
                title={t.hud.sfx}
                className={`rounded-xl p-1.5 cursor-pointer ${sfxEnabled ? "sp-btn-green" : "sp-btn-stone opacity-70"}`}
              >
                <HudIcon name={sfxEnabled ? "sfxOn" : "sfxOff"} className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setShowGrid(!showGrid)}
                title={locale === "es" ? "Mostrar/ocultar cuadrícula (G)" : "Toggle grid (G)"}
                className={`rounded-xl p-1.5 cursor-pointer ${showGrid ? "sp-btn-gold" : "sp-btn-stone"}`}
              >
                <HudIcon name="grid" className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Right: Minimap + Camera Zoom */}
        <div className="pointer-events-auto flex flex-col items-end gap-1.5">
          <Minimap controller={controllerRef.current} />
          <div className="sp-panel flex items-center gap-1 rounded-xl px-2 py-1 text-[11px] font-bold">
            {hoveredTile && (
              <span className="mr-1 text-amber-200/80">
                ({hoveredTile.tx},{hoveredTile.ty})
              </span>
            )}
            <button
              type="button"
              onClick={() =>
                controllerRef.current?.renderer.camera.smoothZoomAtScreenPoint(
                  1.22,
                  (controllerRef.current.renderer.camera.viewportW || 1280) * 0.5,
                  (controllerRef.current.renderer.camera.viewportH || 720) * 0.5
                )
              }
              className="sp-btn-stone h-6 w-6 rounded font-black cursor-pointer"
            >
              +
            </button>
            <button
              type="button"
              onClick={() =>
                controllerRef.current?.renderer.camera.smoothZoomAtScreenPoint(
                  1 / 1.22,
                  (controllerRef.current.renderer.camera.viewportW || 1280) * 0.5,
                  (controllerRef.current.renderer.camera.viewportH || 720) * 0.5
                )
              }
              className="sp-btn-stone h-6 w-6 rounded font-black cursor-pointer"
            >
              −
            </button>
            <button
              type="button"
              title={locale === "es" ? "Centrar cámara (H / Espacio)" : "Center camera (H / Space)"}
              onClick={() => {
                clickSfx();
                controllerRef.current?.centerOnHome();
              }}
              className="sp-btn-gold flex h-6 items-center justify-center rounded px-1.5 font-black cursor-pointer"
            >
              <HudIcon name="center" className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </footer>

      {/* Modals */}
      {activeModal === "shop" && (
        <ShopModal
          onSelectPlace={(item) => {
            clickSfx();
            setPlacingItemId(item.id);
          }}
          onUnlockEarly={(item, cashCost) => {
            clickSfx();
            void controllerRef.current?.unlockBuildingEarly(item.id, cashCost);
          }}
        />
      )}
      {activeModal === "worldMap" && <WorldMapModal controller={controllerRef.current} />}
      {activeModal === "systems" && <SystemsModal controller={controllerRef.current} />}
      {activeModal === "collections" && (
        <CollectionsModal
          onUnlockUnit={(unitId, cashCost, alsoSpawn) =>
            controllerRef.current?.unlockCollectionUnit(unitId, cashCost, alsoSpawn) ?? Promise.resolve()
          }
          onClaimReward={(colId, rewardUnitId) =>
            controllerRef.current?.claimCollectionReward(colId, rewardUnitId) ?? Promise.resolve()
          }
          onClose={() => setActiveModal(null)}
        />
      )}
      {specialInteriorTarget && (
        <SpecialBuildingModal
          target={specialInteriorTarget}
          onSoulMixerMix={(u1, u2, resId) =>
            controllerRef.current?.soulMixerMix(u1, u2, resId) ?? Promise.resolve()
          }
          onSoulMixerClaim={(cash) =>
            controllerRef.current?.soulMixerClaim(cash) ?? Promise.resolve()
          }
          onBahamutStep={(idx) =>
            controllerRef.current?.bahamutTempleStep(idx) ?? Promise.resolve()
          }
          onBahamutClaim={() =>
            controllerRef.current?.bahamutTempleClaim() ?? Promise.resolve()
          }
          onOpenSystems={(tab) => {
            setSystemsTab(tab);
            setActiveModal("systems");
          }}
          onChangeBiome={(b) => setActiveBiome(b as TerrainSkin)}
          onClose={() => setSpecialInteriorTarget(null)}
        />
      )}
      {expandModalExpId !== null && (
        <PopupExpandModal
          expId={expandModalExpId}
          onExpand={(expId, withCash) =>
            controllerRef.current?.expandTerritory(expId, withCash) ?? Promise.resolve()
          }
          onClose={() => setExpandModalExpId(null)}
        />
      )}
      <NestModal controller={controllerRef.current} />
      <PopupCollectModal controller={controllerRef.current} />
      <LevelUpModal
        onOpenShop={() => {
          clickSfx();
          setActiveModal("shop");
        }}
      />

      {/* Loading / Error Overlay */}
      {(loading || error) && (
        <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-black/55">
          <div className="sp-panel relative rounded-2xl px-6 py-4 text-center">
            <CornerRivets />
            <div className="text-base font-black text-amber-300">
              {error ? `Error: ${error}` : t.loading}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ResourcePill(props: { iconType: "g" | "w" | "s" | "f" | "c"; label: string; value: number; color: string }) {
  return (
    <span className={`sp-inset flex items-center gap-1.5 rounded-md px-2 py-0.5 ${props.color}`}>
      <ResourceIcon type={props.iconType} className="h-4 w-4" />
      <span className="hidden md:inline font-semibold text-amber-100/75">{props.label}:</span>
      <span>{Math.floor(props.value).toLocaleString()}</span>
    </span>
  );
}
