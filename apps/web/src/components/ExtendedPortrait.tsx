import { useMemo } from "react";
import { getUiStrings } from "@sef/game-data";
import {
  COLLECT_VARIABLE_IDS,
  SUBCAT_BUILDING_FARM,
  SUBCAT_BUILDING_MILL,
  SUBCAT_BUILDING_MINE,
  type StanceMode
} from "@sef/engine-sim";
import { assetsBaseUrl } from "../api/paths.js";
import { useGameStore } from "../store/gameStore.js";
import { CornerRivets } from "./ClassicFrame.js";
import { ItemThumb } from "./ItemThumb.js";
import { HudIcon, ResourceIcon } from "./GameIcons.js";

const RESOURCE_NODE_SUBCATS = new Set([2, 3, 4, 125, 126, 127, 128]);

const TRAINABLE_BY_SUBCAT: Record<number, number[]> = {
  135: [500, 501], // Town Hall -> Villagers
  311: [502, 503, 506, 508], // Barracks / Infantry
  312: [516, 517, 518], // Archery Range
  313: [512, 513, 515], // Stables
  321: [508, 515, 516], // Castles
  341: [520, 521, 522] // Siege Workshops
};

const SPECIAL_HOTKEYS = ["Q", "E", "R", "F"];

interface SpecialInteriorConfig {
  labelEs: string;
  labelEn: string;
  iconFile: string;
}

function getSpecialInteriorConfig(itemId: number, subcat: number): SpecialInteriorConfig | null {
  if (itemId === 1233) {
    return { labelEs: "Entrar al Nido de Dragones", labelEn: "Enter Dragon Nest", iconFile: "dragonnest.png" };
  }
  if (itemId === 1255) {
    return { labelEs: "Entrar al Nido de Monstruos", labelEn: "Enter Monsters Nest", iconFile: "dragonnest.png" };
  }
  if (subcat === 132 || itemId === 23 || itemId === 188 || itemId === 189) {
    return { labelEs: "Abrir Mercado", labelEn: "Open Market", iconFile: "market.png" };
  }
  if (itemId === 486 || itemId === 239) {
    return { labelEs: "Entrar al Cementerio", labelEn: "Enter Graveyard", iconFile: "graveyard.png" };
  }
  if (itemId === 1284) {
    return { labelEs: "Abrir Almacén de Unidades", labelEn: "Open Unit Warehouse", iconFile: "warehouse.png" };
  }
  if (itemId === 416) {
    return { labelEs: "Abrir Academia de Magia", labelEn: "Open Wizardry Academy", iconFile: "magic.png" };
  }
  if (itemId === 1529) {
    return { labelEs: "Abrir Mezclador de Almas", labelEn: "Open Soul Mixer", iconFile: "soulmixer.png" };
  }
  if (itemId === 1463) {
    return { labelEs: "Abrir Máquina del Tiempo", labelEn: "Open Time Machine", iconFile: "timemachine.png" };
  }
  if (itemId === 1394) {
    return { labelEs: "Entrar al Templo de Bahamut", labelEn: "Enter Bahamut Temple", iconFile: "dragonnest.png" };
  }
  if (itemId === 373) {
    return { labelEs: "Abrir Máquina del Clima", labelEn: "Open Weather Machine", iconFile: "weather.png" };
  }
  if (itemId === 266 || itemId === 352) {
    return { labelEs: "Abrir Mercado de Aliados", labelEn: "Open Allies Market", iconFile: "market.png" };
  }
  if (itemId === 224 || itemId === 343) {
    return { labelEs: "Abrir Puerto", labelEn: "Open Harbor", iconFile: "harbour.png" };
  }
  if (itemId === 299 || itemId === 344) {
    return { labelEs: "Abrir Torre Zepelín", labelEn: "Open Zeppelin Tower", iconFile: "zeppelin.png" };
  }
  if (itemId === 1345 || itemId === 1346) {
    return { labelEs: "Entrar al Edificio de Dragones", labelEn: "Enter Dragon Facility", iconFile: "dragonnest.png" };
  }
  if (subcat === 139) {
    return { labelEs: "Entrar al Edificio Especial", labelEn: "Enter Special Building", iconFile: "allies.png" };
  }
  return null;
}

function formatSecTimer(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

export function ExtendedPortrait(props: {
  onCollect: () => void;
  onUpgrade: () => void;
  onRotate: () => void;
  onStartMove: () => void;
  onStore: () => void;
  onSell: () => void;
  onTrainUnit: (unitId: number) => void;
  onTriggerSpecial: (specialIndex: number) => void;
  onTriggerLimit: () => void;
  onChangeStance: (stance: StanceMode) => void;
  onStopUnits: () => void;
  onOpenSpecialInterior: () => void;
  onOpenCollectPicker: () => void;
  onPopWorker: (all: boolean) => void;
  onClose: () => void;
}) {
  const locale = useGameStore((s) => s.locale);
  const sel = useGameStore((s) => s.selectedSummary);
  const selectedCount = useGameStore((s) => s.selectedUids.length);
  const itemsById = useGameStore((s) => s.itemsById);
  const playMode = useGameStore((s) => s.playMode);
  const t = getUiStrings(locale);

  const def = sel ? itemsById.get(sel.itemId) ?? null : null;
  const upgradeDef = def && def.upgradesTo > 0 ? itemsById.get(def.upgradesTo) ?? null : null;

  const trainableUnits = useMemo(() => {
    if (!sel || !def || def.type !== "b" || sel.team !== "player") return [];
    if (RESOURCE_NODE_SUBCATS.has(def.subcatFunctional)) return [];

    const ids = new Set<number>();
    if (def.trains > 0) ids.add(def.trains);
    for (const id of TRAINABLE_BY_SUBCAT[def.subcatFunctional] ?? []) ids.add(id);

    const low = def.name.toLowerCase();
    if (low.includes("town hall")) {
      ids.add(500);
      ids.add(501);
    }
    if (low.includes("barracks") || low.includes("castle")) {
      ids.add(508);
      ids.add(515);
      ids.add(516);
    }
    if (low.includes("archery")) {
      ids.add(516);
      ids.add(517);
    }
    if (low.includes("stable")) {
      ids.add(512);
      ids.add(515);
    }
    return Array.from(ids)
      .map((id) => itemsById.get(id))
      .filter((x): x is NonNullable<typeof x> => Boolean(x));
  }, [sel, def, itemsById]);

  if (!sel || !def) return null;

  const isResourceNode = def.type === "b" && RESOURCE_NODE_SUBCATS.has(def.subcatFunctional);
  const isFarm = def.type === "b" && def.subcatFunctional === SUBCAT_BUILDING_FARM;
  const isWorkProducer =
    def.type === "b" &&
    (def.subcatFunctional === SUBCAT_BUILDING_MINE ||
      def.subcatFunctional === SUBCAT_BUILDING_MILL ||
      COLLECT_VARIABLE_IDS.has(def.id));
  const specialInterior = def.type === "b" ? getSpecialInteriorConfig(def.id, def.subcatFunctional) : null;

  const limitPct = sel.limitMax > 0 ? Math.min(100, Math.round((sel.limitGauge / sel.limitMax) * 100)) : 0;
  const limitReady = sel.limitMax > 0 && sel.limitGauge >= sel.limitMax;

  const prodPct =
    sel.productionDurationSec > 0
      ? Math.min(100, Math.round((sel.productionElapsedSec / sel.productionDurationSec) * 100))
      : 0;
  const prodRemainingSec = Math.max(0, sel.productionDurationSec - sel.productionElapsedSec);

  return (
    <aside
      data-testid="extended-portrait"
      className="sp-panel pointer-events-auto absolute right-3 top-16 z-20 w-80 max-h-[calc(100vh-170px)] overflow-y-auto rounded-2xl p-3.5 text-amber-50"
    >
      <CornerRivets />
      {/* Header */}
      <div className="flex items-start gap-2.5">
        <div className="sp-inset h-14 w-14 overflow-hidden rounded-xl shrink-0">
          <ItemThumb imgName={sel.imgName} alt={sel.name} itemType={sel.type} className="h-full w-full object-cover" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-1">
            <h2 className="truncate text-sm font-black text-amber-300 drop-shadow-[0_1px_1px_rgba(0,0,0,0.85)]">
              {sel.name}
              {selectedCount > 1 ? ` (×${selectedCount})` : ""}
            </h2>
            <button
              type="button"
              onClick={props.onClose}
              title={locale === "es" ? "Deseleccionar (Esc)" : "Deselect (Esc)"}
              className="sp-btn-red flex h-5 w-5 items-center justify-center rounded text-[10px] font-black cursor-pointer"
            >
              ✕
            </button>
          </div>
          <div className="text-[11px] text-amber-100/80">
            #{def.id} ·{" "}
            {sel.team === "enemy"
              ? locale === "es"
                ? "Enemigo"
                : "Enemy"
              : isResourceNode
                ? locale === "es"
                  ? "Recurso"
                  : "Resource"
                : def.type === "u"
                  ? locale === "es"
                    ? "Unidad"
                    : "Unit"
                  : locale === "es"
                    ? "Edificio"
                    : "Building"}{" "}
            · ({sel.tx}, {sel.ty})
          </div>
          {/* Classic BarraVidaMC style HP Bar */}
          <div className="mt-1.5 h-3 w-full overflow-hidden rounded-full bg-[#450d0d] border border-amber-400/55 shadow-inner">
            <div
              className={`h-full transition-all ${
                sel.team === "enemy"
                  ? "bg-gradient-to-b from-rose-400 via-red-500 to-red-700"
                  : "bg-gradient-to-b from-lime-300 via-emerald-500 to-emerald-700"
              }`}
              style={{ width: `${Math.max(0, Math.min(100, (sel.hp / Math.max(1, sel.maxHp)) * 100))}%` }}
            />
          </div>
          <div className="mt-0.5 flex items-center justify-between text-[10px] font-bold text-amber-200/90">
            <span className="flex items-center gap-1">
              <HudIcon name="heart" className="h-3 w-3" />
              {sel.hp}/{sel.maxHp}
            </span>
            {sel.limitMax > 0 && (
              <span className={`flex items-center gap-0.5 ${limitReady ? "text-amber-300 animate-pulse" : "text-sky-300"}`}>
                <HudIcon name="speed" className="h-3 w-3" />
                Limit {limitPct}%
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Classic `EP_SelfCustomActionBuilding` Special Building Interior Button */}
      {playMode === "village" && sel.team === "player" && specialInterior && (
        <button
          type="button"
          data-testid="btn-enter-special-building"
          onClick={props.onOpenSpecialInterior}
          className="sp-btn-gold mt-2.5 flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-black cursor-pointer"
        >
          <img
            src={`${assetsBaseUrl()}/ui/externalized/RecuadroInfo/${specialInterior.iconFile}`}
            alt=""
            className="h-6 w-6 rounded object-contain"
          />
          <span>{locale === "es" ? specialInterior.labelEs : specialInterior.labelEn}</span>
        </button>
      )}

      {/* Canonical `EP_SelfResourceBuilding`: Garrisoned Villagers & Production / 30s Farm Sowing Progress */}
      {playMode === "village" && sel.team === "player" && (isWorkProducer || isFarm) && (
        <div data-testid="resource-building-panel" className="sp-inset mt-2.5 rounded-xl p-2.5 text-xs">
          <div className="flex items-center justify-between font-black text-amber-200">
            <span>
              {isFarm
                ? locale === "es"
                  ? "Campo de Cultivo"
                  : "Crop Field"
                : locale === "es"
                  ? "Aldeanos trabajando"
                  : "Working Villagers"}
            </span>
            <span className="text-emerald-300">
              {sel.garrison.length} / {Math.max(1, sel.unitCapacity)}
            </span>
          </div>

          {sel.garrison.length === 0 ? (
            <p className="mt-1 text-[10px] text-amber-100/75 leading-snug">
              {isFarm
                ? locale === "es"
                  ? "Envía un aldeano (Tab) a este campo para que entre a sembrar durante 30 segundos."
                  : "Send a villager (Tab) to this field to enter and sow for 30 seconds."
                : locale === "es"
                  ? "Envía aldeanos (Tab) para que entren dentro del edificio y produzcan recursos."
                  : "Send villagers (Tab) to enter inside the building and produce resources."}
            </p>
          ) : (
            <div className="mt-2 space-y-2">
              {/* Show progress bar if farm sowing OR variable producer active */}
              {sel.productionDurationSec > 0 && (
                <div>
                  <div className="flex items-center justify-between text-[10px] font-bold">
                    <span className="text-amber-100/85">
                      {sel.collectReady
                        ? locale === "es"
                          ? "¡Listo para recolectar!"
                          : "Ready to collect!"
                        : isFarm
                          ? locale === "es"
                            ? "Sembrando..."
                            : "Sowing..."
                          : locale === "es"
                            ? "Produciendo..."
                            : "Producing..."}
                    </span>
                    <span className="text-amber-300">
                      {sel.collectReady ? "100%" : formatSecTimer(prodRemainingSec)}
                    </span>
                  </div>
                  <div className="mt-1 h-2.5 w-full overflow-hidden rounded-full border border-amber-500/50 bg-stone-950">
                    <div
                      className={`h-full transition-all ${
                        sel.collectReady ? "bg-amber-400" : "bg-emerald-500"
                      }`}
                      style={{ width: `${sel.collectReady ? 100 : prodPct}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Variable producer waiting for production choice */}
              {isWorkProducer && sel.productionCp === 0 && !sel.collectReady && (
                <button
                  type="button"
                  data-testid="btn-choose-production"
                  onClick={props.onOpenCollectPicker}
                  className="sp-btn-gold w-full rounded-lg py-1.5 text-xs font-black cursor-pointer"
                >
                  {locale === "es" ? "Elegir Producción (5m / 1h / 4h / 8h)" : "Choose Production (5m / 1h / 4h / 8h)"}
                </button>
              )}

              {/* Eject villagers back onto map (`pop_unit`) */}
              <div className="flex gap-1.5">
                <button
                  type="button"
                  data-testid="btn-pop-worker"
                  onClick={() => props.onPopWorker(false)}
                  className="sp-btn-stone flex-1 rounded-lg py-1 text-[10px] font-black cursor-pointer"
                >
                  {locale === "es" ? "Sacar 1 aldeano" : "Eject 1"}
                </button>
                {sel.garrison.length > 1 && (
                  <button
                    type="button"
                    onClick={() => props.onPopWorker(true)}
                    className="sp-btn-stone flex-1 rounded-lg py-1 text-[10px] font-black cursor-pointer"
                  >
                    {locale === "es" ? "Sacar todos" : "Eject All"}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Stats */}
      {!isResourceNode && (
        <div className="mt-2 grid grid-cols-4 gap-1 text-center text-[11px] font-bold">
          <div className="sp-inset flex items-center justify-center gap-1 rounded py-1" title={locale === "es" ? "Ataque" : "Attack"}>
            <HudIcon name="sword" className="h-3.5 w-3.5" />
            <span>{sel.attack}</span>
          </div>
          <div className="sp-inset flex items-center justify-center gap-1 rounded py-1" title={locale === "es" ? "Defensa" : "Defense"}>
            <HudIcon name="shield" className="h-3.5 w-3.5" />
            <span>{sel.defense}</span>
          </div>
          <div className="sp-inset flex items-center justify-center gap-1 rounded py-1" title={locale === "es" ? "Alcance" : "Range"}>
            <HudIcon name="range" className="h-3.5 w-3.5" />
            <span>{sel.attackRange}</span>
          </div>
          <div className="sp-inset flex items-center justify-center gap-1 rounded py-1" title={locale === "es" ? "Velocidad" : "Speed"}>
            <HudIcon name="speed" className="h-3.5 w-3.5" />
            <span>{sel.velocity}</span>
          </div>
        </div>
      )}

      {/* Stance Selector (QoL mapped 1:1 to IA.CONDITION_AGGRESSIVE / DEFENSIVE / HOLD_POSITION) */}
      {def.type === "u" && sel.team === "player" && (
        <div className="mt-2 grid grid-cols-4 gap-1 text-[10px] font-black">
          {(
            [
              ["aggressive", locale === "es" ? "Agresivo" : "Aggr."],
              ["defensive", locale === "es" ? "Defensa" : "Def."],
              ["stand", locale === "es" ? "Quieto" : "Hold"]
            ] as const
          ).map(([st, label]) => (
            <button
              key={st}
              type="button"
              onClick={() => props.onChangeStance(st)}
              className={`rounded-md py-1 cursor-pointer ${sel.stance === st ? "sp-btn-gold" : "sp-btn-stone"}`}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            onClick={props.onStopUnits}
            title={locale === "es" ? "Detener tropas (X)" : "Stop units (X)"}
            className="sp-btn-red rounded-md py-1 cursor-pointer"
          >
            {locale === "es" ? "Alto (X)" : "Stop (X)"}
          </button>
        </div>
      )}

      {/* Interactive Special Attacks & Limit Attack (`PortraitSpecialAttack` / `PortraitLimitAttack`) */}
      {sel.team === "player" && ((sel.behavior && sel.behavior.specials.length > 0) || sel.limitMax > 0) && (
        <div className="sp-inset mt-2 rounded-xl p-2">
          <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-wide text-sky-300">
            <span>{locale === "es" ? "Habilidades 1.4.07" : "1.4.07 Abilities"}</span>
            <span className="text-amber-300/75">Q/E/R/F · T</span>
          </div>
          {sel.behavior && sel.behavior.specials.length > 0 && (
            <div className="mt-1.5 grid grid-cols-2 gap-1.5">
              {sel.behavior.specials.slice(0, 4).map((sp, idx) => {
                const cdSec = sel.specialCooldownSecs[idx] ?? 0;
                const ready = cdSec <= 0;
                return (
                  <button
                    key={sp.id}
                    type="button"
                    disabled={!ready}
                    onClick={() => props.onTriggerSpecial(idx)}
                    className={`flex items-center justify-between rounded-lg px-2 py-1 text-[10px] font-extrabold transition ${
                      ready
                        ? "border border-sky-400/70 bg-sky-900/75 hover:bg-sky-700/80 text-sky-50 cursor-pointer"
                        : "border border-stone-700 bg-stone-900/80 text-stone-400 cursor-not-allowed"
                    }`}
                  >
                    <span className="truncate">
                      [{SPECIAL_HOTKEYS[idx]}] {sp.name ?? sp.kind.replace("_", " ")}
                    </span>
                    <span className="ml-1 shrink-0 font-black text-amber-300">
                      {ready ? `×${sp.damageMultiplier}` : `${cdSec}s`}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {sel.limitMax > 0 && (
            <div className="mt-2">
              <button
                type="button"
                disabled={!limitReady}
                data-testid="btn-limit-attack"
                onClick={props.onTriggerLimit}
                className={`relative w-full overflow-hidden rounded-lg py-1.5 text-xs font-black transition ${
                  limitReady
                    ? "sp-btn-gold animate-pulse cursor-pointer"
                    : "border border-sky-500/40 bg-slate-900/90 text-sky-200/80 cursor-not-allowed"
                }`}
              >
                {!limitReady && (
                  <span
                    className="pointer-events-none absolute inset-y-0 left-0 bg-sky-500/35 transition-all"
                    style={{ width: `${limitPct}%` }}
                  />
                )}
                <span className="relative z-10">
                  {limitReady
                    ? locale === "es"
                      ? "⚡ ¡ACTIVAR LIMIT! (T)"
                      : "⚡ ACTIVATE LIMIT! (T)"
                    : `LIMIT ${sel.limitGauge}/${sel.limitMax} (${limitPct}%)`}
                </span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Building Training Panel */}
      {playMode === "village" && def.type === "b" && trainableUnits.length > 0 && (
        <div className="mt-2.5">
          <div className="mb-1 flex items-center gap-1 text-[11px] font-black text-amber-200">
            <HudIcon name="sword" className="h-3.5 w-3.5" />
            <span>{t.hud.train}</span>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {trainableUnits.slice(0, 6).map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => props.onTrainUnit(u.id)}
                className="sp-card flex items-center gap-1.5 rounded-lg p-1 text-left cursor-pointer"
              >
                <div className="sp-inset h-7 w-7 overflow-hidden rounded shrink-0">
                  <ItemThumb imgName={u.imgName} alt={u.name} itemType="u" className="h-full w-full object-cover" />
                </div>
                <div className="min-w-0 leading-tight">
                  <div className="truncate text-[10px] font-black text-amber-100">{u.name}</div>
                  <div className="flex items-center gap-0.5 text-[10px] font-bold text-amber-300">
                    <ResourceIcon type={u.costType || "g"} className="h-3 w-3" />
                    <span>{u.cost}</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Contextual Actions */}
      {playMode === "village" && sel.team === "player" && (
        <div className="mt-2.5 grid grid-cols-2 gap-1.5 text-xs font-extrabold">
          {sel.collectReady && (
            <button
              type="button"
              data-testid="btn-collect-building"
              onClick={props.onCollect}
              className="sp-btn-gold col-span-2 flex items-center justify-center gap-1.5 rounded-lg py-1.5 cursor-pointer"
            >
              <ResourceIcon type={sel.collectType || "g"} className="h-4 w-4" />
              <span>
                {t.hud.collect} (+{sel.collectAmount})
              </span>
            </button>
          )}
          {upgradeDef && (
            <button
              type="button"
              onClick={props.onUpgrade}
              className="sp-btn-green col-span-2 rounded-lg py-1.5 cursor-pointer"
            >
              {t.hud.upgrade} → {upgradeDef.name} ({upgradeDef.cost})
            </button>
          )}
          {def.type === "b" && (
            <button type="button" onClick={props.onStartMove} className="sp-btn-stone rounded-lg py-1 cursor-pointer">
              {t.hud.move}
            </button>
          )}
          <button type="button" onClick={props.onRotate} className="sp-btn-stone rounded-lg py-1 cursor-pointer">
            {t.hud.rotate}
          </button>
          <button type="button" onClick={props.onStore} className="sp-btn-stone rounded-lg py-1 text-sky-200 cursor-pointer">
            {t.hud.store}
          </button>
          <button type="button" onClick={props.onSell} className="sp-btn-red rounded-lg py-1 cursor-pointer">
            {t.hud.sell}
          </button>
        </div>
      )}

      {/* Contextual RTS guidance */}
      {def.type === "u" && sel.team === "player" && (
        <p className="sp-inset mt-2 rounded-lg px-2.5 py-1.5 text-[10px] leading-snug text-emerald-200/90">
          {locale === "es"
            ? "Clic izq./der.: mover, talar/recolectar, entrar en minas/granjas o atacar · Ctrl+1..9 guarda grupo."
            : "Left/Right click: move, harvest, enter mines/farms, or attack · Ctrl+1..9 saves squad group."}
        </p>
      )}

      {isResourceNode && (
        <p className="sp-inset mt-2 rounded-lg px-2.5 py-1.5 text-[10px] leading-snug text-amber-200/90">
          {def.subcatFunctional === 128
            ? locale === "es"
              ? "Mena agotada en regeneración (3 horas para volver a brotar)."
              : "Depleted ore regenerating (3 hours until restored)."
            : locale === "es"
              ? `Recurso recolectable (+${sel.collectAmount}). Selecciona un aldeano (Tab) y haz clic aquí.`
              : `Harvestable resource (+${sel.collectAmount}). Select a villager (Tab) and click here.`}
        </p>
      )}

      {sel.team === "enemy" && (
        <p className="mt-2 rounded-lg bg-red-950/80 border border-red-500/45 px-2.5 py-1.5 text-[10px] leading-snug text-red-200">
          {locale === "es"
            ? "Objetivo hostil. Selecciona tus tropas (o pulsa 'Ejército') y haz clic aquí para atacar."
            : "Hostile target. Select your troops (or click 'Army') and click here to attack."}
        </p>
      )}
    </aside>
  );
}
