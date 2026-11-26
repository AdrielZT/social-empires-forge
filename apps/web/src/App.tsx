import { useEffect, useRef, useState } from "react";
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
import { HudIcon, HudSpriteIcon, ResourceIcon } from "./components/GameIcons.js";
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [dockCollapsed, setDockCollapsed] = useState(false);

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
  const selectedSummary = useGameStore((s) => s.selectedSummary);
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
  const es = locale === "es";

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

      {/* ====================================================================
          TOP HUD BAR (1:1 with `image.png`):
          Top-Left Avatar + Star Level Badge + Population + 5 Glossy Resource Bars
          Top-Right Circular Golden "Menú" Button + Clean Settings Dropdown
         ==================================================================== */}
      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-2 px-3 pt-2">
        {/* Top-Left: Avatar Frame + Level Star + Population + Horizontal 5 Resource Bars */}
        <div className="pointer-events-auto flex items-start gap-2.5">
          {/* Avatar + Overlapping Golden Star Level Badge + Population Pill Underneath */}
          <div className="flex flex-col items-center">
            <div className="relative">
              <div className="h-[52px] w-[52px] overflow-hidden rounded-lg border-2 border-[#e4a938] bg-[#4a280d] shadow-lg ring-1 ring-[#2b1506]">
                <img
                  src={`${assetsBaseUrl()}/ui/images_new/thumbrey.jpg`}
                  alt={activeSave?.playerInfo.name ?? t.appTitle}
                  className="h-full w-full object-cover"
                  draggable={false}
                />
              </div>
              {/* Overlapping Classic Golden Star Level Badge */}
              <div
                data-testid="hud-level-badge"
                title={`${activeSave?.playerInfo.name ?? t.appTitle} · XP ${resources.xp.toLocaleString()}/${nextLvlXp.toLocaleString()}`}
                className="absolute -bottom-2 -left-2 flex h-7 w-7 items-center justify-center rounded-full border-2 border-[#78350f] bg-gradient-to-b from-[#fef08a] via-[#facc15] to-[#ca8a04] text-xs font-black text-[#3a1a03] shadow-md"
              >
                {resources.level}
              </div>
            </div>

            {/* Compact XP Progress Bar */}
            <div
              title={`${resources.xp.toLocaleString()} / ${nextLvlXp.toLocaleString()} XP`}
              className="mt-2.5 h-1.5 w-[56px] overflow-hidden rounded-full border border-[#d49b2a] bg-[#1e1005]"
            >
              <div className="h-full bg-gradient-to-r from-sky-400 to-cyan-300 transition-all" style={{ width: `${xpPct}%` }} />
            </div>

            {/* Population Counter Directly Below Avatar (`194/225` in `image.png`) */}
            <div className="se-resource-bar mt-1 flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black text-white">
              <ResourceIcon type="pop" size={14} />
              <span>
                {resources.population}/{resources.maxPopulation}
              </span>
            </div>
          </div>

          {/* 5 Horizontal Glossy Resource Bars (Gold, Wood, Food, Stone, Cash) */}
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            <ClassicResourceBar iconType="g" value={resources.coins} title={t.resources.gold} />
            <ClassicResourceBar iconType="w" value={resources.wood} title={t.resources.wood} />
            <ClassicResourceBar iconType="f" value={resources.food} title={t.resources.food} />
            <ClassicResourceBar iconType="s" value={resources.stone} title={t.resources.stone} />
            <ClassicResourceBar iconType="c" value={resources.cash} title={t.resources.cash} widthClass="w-[82px]" />

            {/* Subtle Admin Mode Indicator Pill (1-click toggle matching `Apoyar` green pill position in `image.png`) */}
            <button
              type="button"
              data-testid="toggle-admin-mode"
              onClick={() => {
                clickSfx();
                setAdminMode(!adminMode);
              }}
              title={
                es
                  ? adminMode
                    ? "Modo Admin activo (todo desbloqueado). Clic para cambiar a Modo Usuario."
                    : "Modo Usuario activo (progresión por nivel). Clic para activar Modo Admin."
                  : adminMode
                    ? "Admin Mode active. Click to switch to User Mode."
                    : "User Mode active. Click to switch to Admin Mode."
              }
              className={`rounded-full border-2 px-3 py-0.5 text-[11px] font-black shadow-md transition cursor-pointer ${
                adminMode
                  ? "border-amber-200 bg-gradient-to-b from-purple-500 to-purple-800 text-white"
                  : "border-emerald-200 bg-gradient-to-b from-emerald-500 to-emerald-700 text-white"
              }`}
            >
              {adminMode ? (es ? "👑 Admin" : "👑 Admin") : es ? "👤 Usuario" : "👤 User"}
            </button>
          </div>
        </div>

        {/* Top-Right: Authentic Circular Golden "Menú" Button + Clean Dropdown (`image.png`) */}
        <div className="pointer-events-auto relative flex flex-col items-end gap-1">
          <button
            type="button"
            data-testid="btn-hud-menu"
            onClick={() => {
              clickSfx();
              setMenuOpen((v) => !v);
            }}
            className="flex flex-col items-center cursor-pointer group"
          >
            <div className="se-ornate-gold-rim flex h-11 w-11 flex-col items-center justify-center gap-1 rounded-full group-hover:brightness-110 transition">
              <span className="block h-[2.5px] w-5 rounded-full bg-white shadow" />
              <span className="block h-[2.5px] w-5 rounded-full bg-white shadow" />
              <span className="block h-[2.5px] w-5 rounded-full bg-white shadow" />
            </div>
            <span className="mt-0.5 text-[10px] font-black text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)]">
              {es ? "Menú" : "Menu"}
            </span>
          </button>

          {/* Compact Telemetry Pill (subtle, matching `260 en línea` badge position in `image.png`) */}
          <div
            data-testid="fps-badge"
            className="rounded-full border border-[#d49b2a]/70 bg-black/60 px-2.5 py-0.5 text-[10px] font-bold text-emerald-300 shadow"
          >
            ● {metrics.fps} FPS · CPU {metrics.cpuTimeMs}ms · {metrics.visibleEntities}/{metrics.totalEntities} · {metrics.loadedAtlases} atl · {metrics.rendererType}
          </div>

          {/* Clean Dropdown Menu for Settings (Language, Biome, Audio, Grid) */}
          {menuOpen && (
            <div className="se-ornate-frame absolute right-0 top-16 z-30 w-60 rounded-2xl p-3 text-xs">
              <CornerRivets />
              <div className="mb-2 flex items-center justify-between border-b border-[#cfa045] pb-1.5 font-black text-[#4a2204]">
                <span>{es ? "Ajustes del Imperio" : "Empire Settings"}</span>
                <button
                  type="button"
                  onClick={() => setMenuOpen(false)}
                  className="sp-btn-red flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-black cursor-pointer"
                >
                  ✕
                </button>
              </div>

              <div className="flex flex-col gap-2">
                {/* Language */}
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[#5c300a]">{es ? "Idioma" : "Language"}</span>
                  <div className="flex overflow-hidden rounded-md border border-[#b47b19]">
                    <button
                      type="button"
                      onClick={() => {
                        clickSfx();
                        setLocale("es");
                      }}
                      className={`px-2 py-0.5 text-[10px] font-black cursor-pointer ${locale === "es" ? "sp-btn-gold" : "bg-white text-[#5c300a]"}`}
                    >
                      ES
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        clickSfx();
                        setLocale("en");
                      }}
                      className={`px-2 py-0.5 text-[10px] font-black cursor-pointer ${locale === "en" ? "sp-btn-gold" : "bg-white text-[#5c300a]"}`}
                    >
                      EN
                    </button>
                  </div>
                </div>

                {/* Audio + Grid */}
                <div className="grid grid-cols-3 gap-1">
                  <button
                    type="button"
                    onClick={() => setMusicEnabled(!musicEnabled)}
                    className={`rounded-lg py-1 text-[10px] font-black cursor-pointer ${musicEnabled ? "sp-btn-green" : "se-icon-btn opacity-75"}`}
                  >
                    🎵 {es ? "Música" : "Music"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSfxEnabled(!sfxEnabled)}
                    className={`rounded-lg py-1 text-[10px] font-black cursor-pointer ${sfxEnabled ? "sp-btn-green" : "se-icon-btn opacity-75"}`}
                  >
                    🔊 SFX
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowGrid(!showGrid)}
                    className={`rounded-lg py-1 text-[10px] font-black cursor-pointer ${showGrid ? "sp-btn-gold" : "se-icon-btn"}`}
                  >
                    # {es ? "Reja" : "Grid"}
                  </button>
                </div>

                {/* Biome Picker */}
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold text-[#5c300a]">{es ? "Bioma del Reino" : "Kingdom Biome"}</label>
                  <select
                    value={activeBiome}
                    onChange={(e) => {
                      const skin = e.target.value as TerrainSkin;
                      setActiveBiome(skin);
                      const idx = ALL_BIOMES.indexOf(skin);
                      if (idx >= 0) void controllerRef.current?.sendCommands([{ cmd: "set_skin", args: [idx] }]);
                    }}
                    className="rounded-md border border-[#b47b19] bg-white px-2 py-1 text-[11px] font-bold text-[#3a1f07] cursor-pointer"
                  >
                    {ALL_BIOMES.map((b) => (
                      <option key={b} value={b}>
                        {t.biomes[b] ?? b}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Neighbor Visit Banner (NO tutorial triggered) */}
      {playMode === "visit" && visitingNeighbor && (
        <div
          data-testid="visit-banner"
          className="se-ornate-frame pointer-events-auto absolute left-1/2 top-16 z-25 -translate-x-1/2 flex items-center gap-3 rounded-2xl px-4 py-1.5 text-xs font-black"
        >
          <span className="text-[#4a2204]">
            {es
              ? `👑 Visitando a ${visitingNeighbor.name} (Nv. ${visitingNeighbor.level})`
              : `👑 Visiting ${visitingNeighbor.name} (Lv. ${visitingNeighbor.level})`}
          </span>
          <span className="rounded bg-emerald-100 border border-emerald-500 px-2 py-0.5 text-emerald-800">
            {es ? `Ayudas: ${visitingNeighbor.assistsRemaining}/5` : `Assists: ${visitingNeighbor.assistsRemaining}/5`}
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
            <span>{es ? "Volver a mi Imperio" : "Return Home"}</span>
          </button>
        </div>
      )}

      {/* Active Mode / Tool Banner */}
      {(placingDef || movingEntityUid !== null || castingMagicId !== null || (playMode === "village" && cursorTool === "bulldoze")) && (
        <div className="se-ornate-frame pointer-events-auto absolute left-1/2 top-16 z-25 -translate-x-1/2 flex items-center gap-3 rounded-xl px-4 py-1.5 text-xs font-black">
          <span>
            {placingDef
              ? es
                ? `Colocando: ${placingDef.name} (clic izq. coloca, clic der. o Esc cancela)`
                : `Placing: ${placingDef.name} (left-click place, right-click or Esc cancels)`
              : movingEntityUid !== null
                ? es
                  ? "Modo Mover: haz clic en la nueva posición (Esc cancela)"
                  : "Move Mode: click destination tile (Esc cancels)"
                : castingMagicId !== null
                  ? es
                    ? "Modo Hechizo: haz clic en el objetivo para lanzar magia (Esc cancela)"
                    : "Spell Mode: click target area to cast (Esc cancels)"
                  : es
                    ? "🔨 Eliminar / Vender: haz clic en tu edificio o unidad (Esc sale)"
                    : "🔨 Delete / Sell Tool: click your building or unit to sell (Esc exits)"}
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
        <div className="se-ornate-frame pointer-events-auto absolute left-1/2 top-16 z-20 -translate-x-1/2 flex items-center gap-4 rounded-2xl px-4 py-1.5 text-xs font-black">
          <span className="flex items-center gap-1.5 text-[#4a2204]">
            <HudIcon name="sword" className="h-4 w-4" />
            {battleStatus.title}
          </span>
          {battleStatus.mode === "survival" && <span className="text-rose-700">Wave {battleStatus.wave}</span>}
          <span className="flex items-center gap-1 text-emerald-700">
            <HudIcon name="shield" className="h-3.5 w-3.5" />
            {battleStatus.playerUnitsAlive}
          </span>
          <span className="text-red-700">
            {es ? "Enemigos:" : "Enemies:"} {battleStatus.enemiesRemaining}
          </span>
          <button
            type="button"
            onClick={() => void controllerRef.current?.returnToVillage(false)}
            className="sp-btn-gold flex items-center gap-1 rounded-lg px-2.5 py-1 cursor-pointer"
          >
            <HudIcon name="home" className="h-3.5 w-3.5" />
            <span>{es ? "Volver a Aldea" : "Return Home"}</span>
          </button>
        </div>
      )}

      {/* Victory / Defeat Modal */}
      {battleStatus?.finished && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="se-ornate-frame relative w-full max-w-md rounded-2xl p-6 text-center">
            <CornerRivets />
            <h2 className="text-2xl font-black text-[#4a2204]">
              {battleStatus.finished === "victory"
                ? es ? "¡VICTORIA!" : "VICTORY!"
                : es ? "DERROTA" : "DEFEAT"}
            </h2>
            <p className="mt-2 flex items-center justify-center gap-2 text-sm font-bold text-[#5c300a]">
              {battleStatus.finished === "victory" || battleStatus.lootGold > 0 ? (
                <>
                  <span>{es ? "Recompensa:" : "Reward:"}</span>
                  <span className="flex items-center gap-1 font-black text-amber-700">
                    +{battleStatus.lootGold}
                    <ResourceIcon type="g" size={16} />
                  </span>
                  <span className="font-black text-sky-700">· +{battleStatus.lootXp} XP</span>
                </>
              ) : (
                <span>
                  {es
                    ? "Tus tropas regresan a la aldea para reagruparse."
                    : "Your troops return home to regroup."}
                </span>
              )}
            </p>
            <button
              type="button"
              onClick={() => void controllerRef.current?.returnToVillage(true)}
              className="sp-btn-green mt-5 inline-flex items-center gap-2 rounded-xl px-6 py-2.5 text-sm font-black cursor-pointer"
            >
              <HudIcon name="home" className="h-4 w-4" />
              <span>{es ? "Recoger y Volver al Imperio" : "Claim & Return to Empire"}</span>
            </button>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <div className="se-ornate-frame pointer-events-none absolute left-1/2 bottom-36 z-30 -translate-x-1/2 rounded-xl px-4 py-1.5 text-xs font-black text-[#3a1f07]">
          {toast}
        </div>
      )}

      {/* ====================================================================
          UNIFIED BOTTOM PARCHMENT BAR (1:1 with `image.png` & `image_5.png`):
          - Floating Magic Quick-Slots & Control Groups directly above center
          - Left: Friends & King strip (OR Integrated ExtendedPortrait when selected!)
          - Right: Clean 2x4 Iconic Action Grid (Tools, World, Collections, Build, Army, Goals, Market, Storage)
          - Bottom-Right: Compact Ornate Minimap + Zoom Controls
         ==================================================================== */}
      <footer className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex items-end justify-center px-3 pb-2">
        {/* Center Unified Bar + Floating Quick-Slots */}
        <div className="flex flex-col items-center gap-1.5">
          {/* Control Groups (`[1]..[9]`) + Magic Quick-Slots Floating Above Bar (`image.png`) */}
          <div className="flex items-center gap-2">
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
                      es
                        ? `Grupo ${num} (${uids.length} tropas) · Doble clic centra`
                        : `Group ${num} (${uids.length} units) · Double-click centers`
                    }
                    className="se-icon-btn flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-black cursor-pointer"
                  >
                    <span className="text-[#78350f]">[{num}]</span>
                    <span className="text-emerald-700">×{uids.length}</span>
                  </button>
                ))}
              </div>
            )}

            <MagicBar
              onBuyMana={(useCash) =>
                void controllerRef.current?.sendCommands([{ cmd: "buy_mana", args: [useCash ? 1 : 0] }])
              }
            />
          </div>

          {/* Unified Cream Parchment & Ornate Gold-Ruby Dock */}
          <div className="pointer-events-auto relative">
            {/* King Arthur Mascot + "Objetivos" Badge standing on top-left corner (`image.png` & `image_5.png`) */}
            {!dockCollapsed && (
              <button
                type="button"
                onClick={() => {
                  clickSfx();
                  setSystemsTab("goals");
                  setActiveModal(activeModal === "systems" ? null : "systems");
                }}
                title={es ? "Abrir Objetivos del Reino" : "Open Kingdom Goals"}
                className="group absolute -top-[58px] left-5 z-20 hidden md:flex flex-col items-center cursor-pointer"
              >
                <div className="h-12 w-12 overflow-hidden rounded-full border-2 border-[#facc15] bg-[#4a2204] shadow-lg group-hover:scale-105 transition-transform">
                  <img
                    src={`${assetsBaseUrl()}/ui/images_new/thumbrey.jpg`}
                    alt="Rey Arturo"
                    className="h-full w-full object-cover"
                    draggable={false}
                  />
                </div>
                <span className="sp-btn-blue -mt-2 rounded-full px-2.5 py-0.5 text-[10px] font-black leading-none">
                  {t.hud.goals}
                </span>
              </button>
            )}

            {/* Minimize / Expand Tab on Top-Left Edge */}
            <button
              type="button"
              onClick={() => setDockCollapsed((c) => !c)}
              title={dockCollapsed ? (es ? "Mostrar barra" : "Show dock") : es ? "Minimizar barra" : "Minimize dock"}
              className="absolute -top-4 left-1.5 z-20 flex h-4 w-7 items-center justify-center rounded-t-md border-x-2 border-t-2 border-[#d49b2a] bg-[#5c300a] text-[9px] font-black text-amber-200 cursor-pointer"
            >
              {dockCollapsed ? "▲" : "▼"}
            </button>

            {!dockCollapsed && (
              <div className="se-ornate-frame relative flex items-center gap-2 rounded-xl px-2 py-1.5">
                <CornerRivets />

                {/* LEFT ZONE: Switches between Friends & King strip AND Integrated ExtendedPortrait (`image_5.png`) */}
                <div className="flex items-center">
                  {selectedSummary ? (
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
                  ) : (
                    <FriendsDock
                      controller={controllerRef.current}
                      onOpenGoals={() => {
                        clickSfx();
                        setSystemsTab("goals");
                        setActiveModal("systems");
                      }}
                    />
                  )}
                </div>

                {/* Vertical Golden Divider */}
                <div className="h-[78px] w-[2px] shrink-0 bg-gradient-to-b from-[#d49b2a] via-[#8c5212] to-[#d49b2a] opacity-70" />

                {/* RIGHT ZONE: Classic 2x4 Iconic Illustrated Buttons + Explicit Cursor Tools (`image.png` & `image_5.png`) */}
                <div className="grid grid-cols-4 gap-x-1.5 gap-y-1 pr-1">
                  {/* Cell 1: Cursor Tools Strip (Normal / Area / Sell) */}
                  <div className="flex flex-col items-center justify-center">
                    <div className="flex items-center gap-0.5">
                      <button
                        type="button"
                        data-testid="tool-cursor-normal"
                        onClick={() => {
                          clickSfx();
                          setCursorTool("normal");
                        }}
                        title={es ? "Cursor normal (Esc)" : "Normal cursor (Esc)"}
                        className={`flex h-7 w-7 items-center justify-center rounded border cursor-pointer ${
                          cursorTool === "normal" ? "se-icon-btn-active" : "se-icon-btn"
                        }`}
                      >
                        <HudIcon name="cursor" className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        data-testid="tool-cursor-box"
                        onClick={() => {
                          clickSfx();
                          setCursorTool(cursorTool === "box_select" ? "normal" : "box_select");
                        }}
                        title={es ? "Selección en área" : "Box area select"}
                        className={`flex h-7 w-7 items-center justify-center rounded border cursor-pointer ${
                          cursorTool === "box_select" ? "se-icon-btn-active" : "se-icon-btn"
                        }`}
                      >
                        <HudIcon name="boxSelect" className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        data-testid="tool-cursor-bulldoze"
                        onClick={() => {
                          clickSfx();
                          setCursorTool(cursorTool === "bulldoze" ? "normal" : "bulldoze");
                        }}
                        title={es ? "Eliminar / Vender" : "Delete / Sell"}
                        className={`flex h-7 w-7 items-center justify-center rounded border cursor-pointer ${
                          cursorTool === "bulldoze" ? "sp-btn-red" : "se-icon-btn text-red-700"
                        }`}
                      >
                        <HudIcon name="sell" className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <span className="mt-0.5 text-[9px] font-black leading-none text-[#4a2204]">
                      {es ? "Herramientas" : "Tools"}
                    </span>
                  </div>

                  {/* Cell 2: Mundo (World Map) */}
                  <DockIconButton
                    testId="btn-worldmap"
                    label={es ? "Mundo" : "World"}
                    onClick={() => {
                      clickSfx();
                      setActiveModal(activeModal === "worldMap" ? null : "worldMap");
                    }}
                    icon={<HudSpriteIcon file="btn_world.webp" className="h-7 w-7 object-contain" fallback={<HudIcon name="map" className="h-6 w-6" />} />}
                  />

                  {/* Cell 3: Colecciones */}
                  <DockIconButton
                    testId="btn-collections"
                    label={es ? "Colecciones" : "Collections"}
                    disabled={playMode !== "village"}
                    onClick={() => {
                      clickSfx();
                      setActiveModal(activeModal === "collections" ? null : "collections");
                    }}
                    icon={<ResourceIcon type="xp" size={26} />}
                  />

                  {/* Cell 4: Construir (Shop — red/white market stall!) */}
                  <DockIconButton
                    testId="btn-shop"
                    label={es ? "Construir" : "Build"}
                    disabled={playMode !== "village"}
                    onClick={() => {
                      clickSfx();
                      setActiveModal(activeModal === "shop" ? null : "shop");
                    }}
                    icon={<HudSpriteIcon file="btn_store.webp" className="h-7 w-auto object-contain" fallback={<HudIcon name="shop" className="h-6 w-6" />} />}
                  />

                  {/* Cell 5: Ejército */}
                  <DockIconButton
                    testId="btn-army"
                    label={es ? "Ejército" : "Army"}
                    disabled={playMode === "visit"}
                    onClick={() => {
                      clickSfx();
                      controllerRef.current?.selectAllPlayerArmy();
                    }}
                    icon={<HudIcon name="army" className="h-6 w-6 text-[#5c300a]" />}
                  />

                  {/* Cell 6: Objetivos */}
                  <DockIconButton
                    testId="btn-systems"
                    label={t.hud.goals}
                    onClick={() => {
                      clickSfx();
                      setSystemsTab("goals");
                      setActiveModal(activeModal === "systems" ? null : "systems");
                    }}
                    icon={<HudIcon name="goals" className="h-6 w-6 text-emerald-700" />}
                  />

                  {/* Cell 7: Mercado */}
                  <DockIconButton
                    testId="btn-market"
                    label={es ? "Mercado" : "Market"}
                    onClick={() => {
                      clickSfx();
                      setSystemsTab("market");
                      setActiveModal("systems");
                    }}
                    icon={<HudIcon name="market" className="h-6 w-6 text-[#92400e] drop-shadow-[0_1px_0_rgba(255,255,255,0.6)]" />}
                  />

                  {/* Cell 8: Almacén / Regalos */}
                  <DockIconButton
                    testId="btn-storage"
                    label={es ? "Almacén" : "Storage"}
                    onClick={() => {
                      clickSfx();
                      setSystemsTab("storage");
                      setActiveModal("systems");
                    }}
                    icon={<HudSpriteIcon file="btn_gift.webp" className="h-7 w-7 object-contain" fallback={<HudIcon name="storage" className="h-6 w-6" />} />}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Bottom-Right Corner: Compact Minimap + Zoom Controls */}
        <div className="pointer-events-auto absolute bottom-2 right-2.5 hidden lg:flex flex-col items-end gap-1">
          <Minimap controller={controllerRef.current} />
          <div className="se-ornate-frame flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-[10px] font-black">
            {hoveredTile && (
              <span className="mr-1 text-[#5c300a]">
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
              className="se-icon-btn h-5 w-5 rounded font-black cursor-pointer"
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
              className="se-icon-btn h-5 w-5 rounded font-black cursor-pointer"
            >
              −
            </button>
            <button
              type="button"
              title={es ? "Centrar cámara (H / Espacio)" : "Center camera (H / Space)"}
              onClick={() => {
                clickSfx();
                controllerRef.current?.centerOnHome();
              }}
              className="sp-btn-gold flex h-5 items-center justify-center rounded px-1 font-black cursor-pointer"
            >
              <HudIcon name="center" className="h-3 w-3" />
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
          <div className="se-ornate-frame relative rounded-2xl px-6 py-4 text-center">
            <CornerRivets />
            <div className="text-base font-black text-[#4a2204]">
              {error ? `Error: ${error}` : t.loading}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Classic Social Empires 1.4.07 glossy top resource counter bar with protruding SWF icon on the left (`image.png`).
 */
function ClassicResourceBar(props: {
  iconType: "g" | "w" | "s" | "f" | "c";
  value: number;
  title: string;
  widthClass?: string;
}) {
  return (
    <div
      title={props.title}
      className={`se-resource-bar relative flex h-[26px] ${props.widthClass ?? "w-[98px]"} items-center justify-end rounded-md pr-2 pl-6 text-xs font-black text-white`}
    >
      <div className="pointer-events-none absolute -left-2.5 top-1/2 -translate-y-1/2">
        <ResourceIcon type={props.iconType} size={26} />
      </div>
      <span className="truncate tracking-tight drop-shadow-[0_1px_1px_rgba(0,0,0,0.9)]">
        {Math.floor(props.value).toLocaleString()}
      </span>
    </div>
  );
}

/**
 * Classic 1.4.07 iconic illustrated button inside the right 2x4 grid of the bottom parchment dock (`image.png` & `image_5.png`).
 */
function DockIconButton(props: {
  testId?: string;
  label: string;
  icon: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={props.testId}
      disabled={props.disabled}
      onClick={props.onClick}
      className="group flex flex-col items-center justify-center rounded-lg px-1 py-0.5 hover:bg-amber-300/35 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
    >
      <div className="flex h-7 w-9 items-center justify-center group-hover:scale-110 transition-transform">
        {props.icon}
      </div>
      <span className="mt-0.5 text-[9px] font-black leading-none text-[#4a2204] whitespace-nowrap">
        {props.label}
      </span>
    </button>
  );
}
