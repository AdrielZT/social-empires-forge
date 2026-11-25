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
import { Minimap } from "./components/Minimap.js";
import { CornerRivets } from "./components/ClassicFrame.js";
import { HudIcon, ResourceIcon } from "./components/GameIcons.js";

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
  const resources = useGameStore((s) => s.resources);
  const activeBiome = useGameStore((s) => s.activeBiome);
  const musicEnabled = useGameStore((s) => s.musicEnabled);
  const sfxEnabled = useGameStore((s) => s.sfxEnabled);
  const showGrid = useGameStore((s) => s.showGrid);
  const boxSelectInVillage = useGameStore((s) => s.boxSelectInVillage);
  const controlGroups = useGameStore((s) => s.controlGroups);
  const activeModal = useGameStore((s) => s.activeModal);
  const placingItemId = useGameStore((s) => s.placingItemId);
  const movingEntityUid = useGameStore((s) => s.movingEntityUid);
  const castingMagicId = useGameStore((s) => s.castingMagicId);
  const battleStatus = useGameStore((s) => s.battleStatus);
  const hoveredTile = useGameStore((s) => s.hoveredTile);
  const metrics = useGameStore((s) => s.metrics);
  const itemsById = useGameStore((s) => s.itemsById);

  const setLocale = useGameStore((s) => s.setLocale);
  const setActiveBiome = useGameStore((s) => s.setActiveBiome);
  const setMusicEnabled = useGameStore((s) => s.setMusicEnabled);
  const setSfxEnabled = useGameStore((s) => s.setSfxEnabled);
  const setShowGrid = useGameStore((s) => s.setShowGrid);
  const setBoxSelectInVillage = useGameStore((s) => s.setBoxSelectInVillage);
  const setActiveModal = useGameStore((s) => s.setActiveModal);
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
      controllerRef.current?.renderer.setBoxSelectDefault(boxSelectInVillage);
    } else {
      controllerRef.current?.renderer.setBoxSelectDefault(true);
    }
  }, [playMode, boxSelectInVillage]);

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

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#2b5216]">
      {/* Full-viewport 60+ FPS WebGL2/WebGPU Isometric Canvas (dynamic contextual SVG cursors) */}
      <div ref={canvasHostRef} className="absolute inset-0 h-full w-full" />

      {/* Top Classic Resource & Empire Bar */}
      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <div className="sp-panel pointer-events-auto relative flex items-center gap-2.5 rounded-xl px-3.5 py-1.5">
          <CornerRivets />
          <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-amber-300 bg-gradient-to-b from-amber-400 to-amber-700 text-sm font-black text-white shadow">
            {resources.level}
          </div>
          <div className="leading-tight">
            <div className="text-xs font-black text-amber-300 drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]">
              {activeSave?.playerInfo.name ?? t.appTitle}
            </div>
            <div className="text-[11px] text-amber-100/85">
              {t.resources.xp}: {resources.xp.toLocaleString()} · {t.modes[playMode]}
            </div>
          </div>
        </div>

        {/* Classic Resource Counters (Crisp cross-platform SVG icons) */}
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

        {/* FPS Telemetry & Language Toggle */}
        <div className="pointer-events-auto flex items-center gap-2">
          <div
            data-testid="fps-badge"
            className="rounded-lg border border-emerald-400/45 bg-stone-950/88 px-2.5 py-1 text-[11px] font-bold text-emerald-300 shadow"
          >
            {metrics.fps} FPS · CPU {metrics.cpuTimeMs}ms · {metrics.visibleEntities}/{metrics.totalEntities} · {metrics.loadedAtlases} atl · {metrics.rendererType}
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

      {/* Active Mode / Tool Banner */}
      {(placingDef || movingEntityUid !== null || castingMagicId !== null) && (
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
                : locale === "es"
                  ? "Modo Hechizo: haz clic en el objetivo para lanzar magia (Esc cancela)"
                  : "Spell Mode: click target area to cast (Esc cancels)"}
          </span>
          <button
            type="button"
            onClick={() => {
              setPlacingItemId(null);
              setMovingEntityUid(null);
              setCastingMagicId(null);
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
        <div className="sp-panel pointer-events-none absolute left-1/2 bottom-28 z-30 -translate-x-1/2 rounded-xl px-4 py-2 text-xs font-extrabold text-amber-200">
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
        onClose={() => {
          setSelection([], null);
          controllerRef.current?.renderer.setSelectedEntities([]);
        }}
      />

      {/* Bottom Classic Action Bar + Control Groups + Magic Bar + Minimap */}
      <footer className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex items-end justify-between gap-2 px-3 py-2.5">
        {/* Left: Magic Bar */}
        <MagicBar
          onBuyMana={(useCash) =>
            void controllerRef.current?.sendCommands([{ cmd: "buy_mana", args: [useCash ? 1 : 0] }])
          }
        />

        {/* Center: Control Group Chips (QoL 1..9) + Classic Action Buttons */}
        <div className="flex flex-col items-center gap-1.5">
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

          <div className="sp-panel pointer-events-auto relative flex items-center justify-center gap-1 rounded-2xl px-3 py-1.5 text-xs font-black">
            <CornerRivets />
            {playMode === "village" && (
              <button
                type="button"
                data-testid="btn-shop"
                onClick={() => {
                  clickSfx();
                  setActiveModal(activeModal === "shop" ? null : "shop");
                }}
                className="sp-btn-gold flex items-center gap-1 whitespace-nowrap rounded-xl px-2.5 py-1.5 cursor-pointer"
              >
                <HudIcon name="shop" className="h-4 w-4 shrink-0" />
                <span>{t.hud.shop}</span>
              </button>
            )}

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

            <button
              type="button"
              data-testid="btn-systems"
              onClick={() => {
                clickSfx();
                setSystemsTab("goals");
                setActiveModal(activeModal === "systems" ? null : "systems");
              }}
              className="sp-btn-green flex items-center gap-1 whitespace-nowrap rounded-xl px-2.5 py-1.5 cursor-pointer"
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
              <span>{locale === "es" ? "Mercado" : "Market"}</span>
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
              <span>{t.hud.storage}</span>
            </button>

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
              className="sp-inset max-w-[126px] rounded-xl px-2 py-1.5 text-amber-100"
            >
              {ALL_BIOMES.map((b) => (
                <option key={b} value={b}>
                  {t.biomes[b] ?? b}
                </option>
              ))}
            </select>

            {playMode === "village" && (
              <button
                type="button"
                data-testid="btn-drag-mode"
                onClick={() => {
                  clickSfx();
                  setBoxSelectInVillage(!boxSelectInVillage);
                }}
                title={
                  locale === "es"
                    ? boxSelectInVillage
                      ? "Arrastre izq.: Caja de selección (clic para volver a mover cámara)"
                      : "Arrastre izq.: Mover cámara (clic para activar caja de selección)"
                    : boxSelectInVillage
                      ? "Left-drag: Box select (click to switch to camera pan)"
                      : "Left-drag: Camera pan (click to switch to box select)"
                }
                className={`whitespace-nowrap rounded-xl px-2 py-1.5 text-[11px] font-black cursor-pointer ${
                  boxSelectInVillage ? "sp-btn-gold" : "sp-btn-stone"
                }`}
              >
                {boxSelectInVillage ? (locale === "es" ? "⬚ Sel." : "⬚ Box") : locale === "es" ? "✋ Cam." : "✋ Pan"}
              </button>
            )}

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
        />
      )}
      {activeModal === "worldMap" && <WorldMapModal controller={controllerRef.current} />}
      {activeModal === "systems" && <SystemsModal controller={controllerRef.current} />}

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
