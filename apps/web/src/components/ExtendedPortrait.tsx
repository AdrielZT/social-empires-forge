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
import { ItemThumb } from "./ItemThumb.js";
import { HudIcon, ResourceIcon } from "./GameIcons.js";

const TRAINABLE_BY_SUBCAT: Record<number, number[]> = {
  135: [500, 501],
  111: [508, 515, 516],
  112: [516, 517],
  113: [512, 515],
  114: [518, 519],
  115: [510, 511]
};

const RESOURCE_NODE_SUBCATS = new Set([2, 3, 4, 125, 126, 127]);
const SPECIAL_HOTKEYS = ["Q", "E", "R", "F"];

interface SpecialInteriorConfig {
  labelEs: string;
  labelEn: string;
  iconFile: string;
}

function getSpecialInteriorConfig(itemId: number, subcat: number): SpecialInteriorConfig | null {
  if (itemId === 1233) return { labelEs: "ENTRAR", labelEn: "ENTER", iconFile: "dragonnest.png" };
  if (itemId === 1255) return { labelEs: "ENTRAR", labelEn: "ENTER", iconFile: "dragonnest.png" };
  if (subcat === 132 || itemId === 23 || itemId === 188 || itemId === 189) {
    return { labelEs: "MERCADO", labelEn: "MARKET", iconFile: "market.png" };
  }
  if (itemId === 486 || itemId === 239) return { labelEs: "ENTRAR", labelEn: "ENTER", iconFile: "graveyard.png" };
  if (itemId === 1284) return { labelEs: "ALMACÉN", labelEn: "STORAGE", iconFile: "warehouse.png" };
  if (itemId === 416) return { labelEs: "MAGIA", labelEn: "MAGIC", iconFile: "magic.png" };
  if (itemId === 1529) return { labelEs: "ENTRAR", labelEn: "ENTER", iconFile: "soulmixer.png" };
  if (itemId === 1463) return { labelEs: "ENTRAR", labelEn: "ENTER", iconFile: "timemachine.png" };
  if (itemId === 1394) return { labelEs: "ENTRAR", labelEn: "ENTER", iconFile: "dragonnest.png" };
  if (itemId === 373) return { labelEs: "CLIMA", labelEn: "WEATHER", iconFile: "weather.png" };
  if (itemId === 266 || itemId === 352) return { labelEs: "MERCADO", labelEn: "MARKET", iconFile: "market.png" };
  if (itemId === 224 || itemId === 343) return { labelEs: "PUERTO", labelEn: "HARBOR", iconFile: "harbour.png" };
  if (itemId === 299 || itemId === 344) return { labelEs: "ZEPELÍN", labelEn: "ZEPPELIN", iconFile: "zeppelin.png" };
  if (itemId === 1345 || itemId === 1346) return { labelEs: "ENTRAR", labelEn: "ENTER", iconFile: "dragonnest.png" };
  if (subcat === 139) return { labelEs: "ENTRAR", labelEn: "ENTER", iconFile: "allies.png" };
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

/**
 * Authentic Social Empires 1.4.07 Extended Portrait (`EP_Market_MC`, `EP_UnitMC`, `EP_NewBarracksMC`,
 * `EP_Farm_MC`) integrated directly INSIDE the left zone of the unified bottom parchment bar
 * (1:1 with `image_5.png` — replaces the Friends strip while an entity is selected).
 */
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

  const hpPct = Math.max(0, Math.min(100, (sel.hp / Math.max(1, sel.maxHp)) * 100));
  const limitPct = sel.limitMax > 0 ? Math.min(100, Math.round((sel.limitGauge / sel.limitMax) * 100)) : 0;
  const limitReady = sel.limitMax > 0 && sel.limitGauge >= sel.limitMax;
  const prodRemainingSec = Math.max(0, sel.productionDurationSec - sel.productionElapsedSec);

  return (
    <div
      data-testid="extended-portrait"
      className="relative flex h-[86px] min-w-[430px] max-w-[540px] flex-1 items-center gap-2.5 px-2 py-1 text-[#3a1f07]"
    >
      {/* Left: Framed Square Portrait + HP Bar Directly Underneath (`image_5.png`) */}
      <div className="flex w-[68px] shrink-0 flex-col items-center">
        <div className="relative h-[62px] w-[62px] overflow-hidden rounded-md border-2 border-[#b47b19] bg-white shadow-inner">
          <ItemThumb imgName={sel.imgName} alt={sel.name} itemType={sel.type} className="h-full w-full object-contain p-0.5" />
          <button
            type="button"
            onClick={props.onClose}
            title={locale === "es" ? "Volver a Amigos (Esc)" : "Back to Friends (Esc)"}
            className="sp-btn-red absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-black cursor-pointer"
          >
            ✕
          </button>
        </div>
        <div className="mt-0.5 h-3.5 w-full overflow-hidden rounded-sm border border-[#5c2c06] bg-[#521010] relative">
          <div
            className={`h-full transition-all ${
              sel.team === "enemy"
                ? "bg-gradient-to-b from-rose-400 to-red-600"
                : "bg-gradient-to-b from-lime-400 to-emerald-600"
            }`}
            style={{ width: `${hpPct}%` }}
          />
          <span className="absolute inset-0 flex items-center justify-center text-[9px] font-black text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.95)]">
            {sel.hp}/{sel.maxHp}
          </span>
        </div>
      </div>

      {/* Middle: Entity Name + Contextual Center Action Area (`image_5.png`) */}
      <div className="flex min-w-0 flex-1 flex-col justify-between h-full py-0.5">
        <div className="flex items-center justify-between gap-1">
          <h2 className="truncate text-xs font-black text-[#3b1d06]">
            {sel.name}
            {selectedCount > 1 ? ` (×${selectedCount})` : ""}
          </h2>
          {sel.type === "u" && (
            <div className="flex items-center gap-1.5 text-[10px] font-black text-[#5c300a]">
              <span className="flex items-center gap-0.5" title="ATK">
                <HudIcon name="sword" className="h-3 w-3" /> {sel.attack}
              </span>
              <span className="flex items-center gap-0.5" title="DEF">
                <HudIcon name="shield" className="h-3 w-3" /> {sel.defense}
              </span>
              <span className="flex items-center gap-0.5" title="RNG">
                <HudIcon name="range" className="h-3 w-3" /> {sel.attackRange}
              </span>
            </div>
          )}
        </div>

        {/* Center Interactive Content */}
        <div className="flex flex-1 items-center justify-center gap-2 overflow-x-auto">
          {/* 1. Special Building Interior CTA — Exact `image_5.png` Big Icon + Green ENTER Button */}
          {playMode === "village" && sel.team === "player" && specialInterior && (
            <button
              type="button"
              data-testid="btn-enter-special-building"
              onClick={props.onOpenSpecialInterior}
              className="group flex flex-col items-center justify-center gap-0.5 cursor-pointer"
            >
              <img
                src={`${assetsBaseUrl()}/ui/externalized/RecuadroInfo/${specialInterior.iconFile}`}
                alt=""
                className="h-9 w-auto object-contain drop-shadow group-hover:scale-105 transition-transform"
                draggable={false}
              />
              <span className="sp-btn-green rounded-md px-4 py-0.5 text-[11px] font-black tracking-wide uppercase">
                {locale === "es" ? specialInterior.labelEs : specialInterior.labelEn}
              </span>
            </button>
          )}

          {/* 2. Collect Ready CTA */}
          {playMode === "village" && sel.team === "player" && sel.collectReady && (
            <button
              type="button"
              data-testid="btn-collect-building"
              onClick={props.onCollect}
              className="sp-btn-gold flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-black cursor-pointer"
            >
              <ResourceIcon type={sel.collectType || "g"} size={18} />
              <span>
                {locale === "es" ? "Recolectar" : "Collect"} +{sel.collectAmount}
              </span>
            </button>
          )}

          {/* 3. Farm / Work Producer Garrison & Progress */}
          {playMode === "village" && sel.team === "player" && (isWorkProducer || isFarm) && (
            <div data-testid="resource-building-panel" className="flex items-center gap-1.5 text-[10px] font-bold">
              <div className="rounded border border-[#cfa96e] bg-white/80 px-2 py-1">
                <div className="text-[#4a2204]">
                  {isFarm
                    ? locale === "es" ? "Cultivo" : "Crop"
                    : locale === "es" ? "Aldeanos" : "Workers"}:{" "}
                  <span className="text-emerald-700 font-black">
                    {sel.garrison.length}/{Math.max(1, sel.unitCapacity)}
                  </span>
                </div>
                {sel.productionDurationSec > 0 && (
                  <div className="text-[9px] text-[#7c4b1a]">
                    {sel.collectReady
                      ? locale === "es" ? "¡Listo!" : "Ready!"
                      : formatSecTimer(prodRemainingSec)}
                  </div>
                )}
              </div>
              {isWorkProducer && sel.garrison.length > 0 && sel.productionCp === 0 && !sel.collectReady && (
                <button
                  type="button"
                  data-testid="btn-choose-production"
                  onClick={props.onOpenCollectPicker}
                  className="sp-btn-gold rounded-md px-2 py-1 text-[10px] font-black cursor-pointer"
                >
                  {locale === "es" ? "Producir" : "Produce"}
                </button>
              )}
              {sel.garrison.length > 0 && (
                <button
                  type="button"
                  data-testid="btn-pop-worker"
                  onClick={() => props.onPopWorker(false)}
                  className="se-icon-btn rounded-md px-2 py-1 text-[10px] font-black cursor-pointer"
                >
                  {locale === "es" ? "Sacar" : "Eject"}
                </button>
              )}
            </div>
          )}

          {/* 4. Barracks / Town Hall Unit Training Row */}
          {playMode === "village" && sel.team === "player" && !specialInterior && trainableUnits.length > 0 && (
            <div className="flex items-center gap-1">
              {trainableUnits.slice(0, 4).map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => props.onTrainUnit(u.id)}
                  title={`${u.name} (${u.cost} ${u.costType})`}
                  className="se-parchment-card flex flex-col items-center rounded-md px-1.5 py-0.5 cursor-pointer"
                >
                  <ItemThumb imgName={u.imgName} alt={u.name} itemType="u" className="h-8 w-8 object-contain" />
                  <span className="flex items-center gap-0.5 text-[9px] font-black text-[#4a2204]">
                    <ResourceIcon type={u.costType || "g"} size={10} />
                    {u.cost}
                  </span>
                </button>
              ))}
              {sel.queue.length > 0 && (
                <span className="rounded bg-amber-200 border border-[#b47b19] px-1.5 py-0.5 text-[9px] font-black text-[#4a2204]">
                  ⏳{sel.queue.length}
                </span>
              )}
            </div>
          )}

          {/* 5. Player Unit Controls: Stances + Special Abilities + Limit Bar */}
          {sel.type === "u" && sel.team === "player" && (
            <div className="flex flex-col gap-1 w-full">
              <div className="flex items-center gap-1">
                {(["aggressive", "defensive", "stand"] as StanceMode[]).map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => props.onChangeStance(st)}
                    className={`rounded px-1.5 py-0.5 text-[9px] font-black cursor-pointer ${
                      sel.stance === st ? "se-icon-btn-active" : "se-icon-btn"
                    }`}
                  >
                    {st === "aggressive"
                      ? locale === "es" ? "Agresivo" : "Aggr."
                      : st === "defensive"
                        ? locale === "es" ? "Defensivo" : "Def."
                        : locale === "es" ? "Quieto" : "Stand"}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={props.onStopUnits}
                  className="sp-btn-red rounded px-1.5 py-0.5 text-[9px] font-black cursor-pointer"
                >
                  {locale === "es" ? "Parar" : "Stop"}
                </button>
              </div>

              {(sel.behavior?.specials?.length || sel.limitMax > 0) && (
                <div className="flex items-center gap-1 overflow-x-auto">
                  {sel.behavior?.specials?.slice(0, 3).map((sp, idx) => {
                    const cd = sel.specialCooldownSecs[idx] ?? 0;
                    return (
                      <button
                        key={sp.kind + idx}
                        type="button"
                        disabled={cd > 0}
                        onClick={() => props.onTriggerSpecial(idx)}
                        className={`rounded px-1.5 py-0.5 text-[9px] font-black whitespace-nowrap ${
                          cd > 0
                            ? "bg-stone-300 text-stone-600 cursor-not-allowed"
                            : "sp-btn-gold cursor-pointer"
                        }`}
                      >
                        [{SPECIAL_HOTKEYS[idx]}] {cd > 0 ? `${cd}s` : sp.name ?? sp.kind}
                      </button>
                    );
                  })}
                  {sel.limitMax > 0 && (
                    <button
                      type="button"
                      disabled={!limitReady}
                      onClick={props.onTriggerLimit}
                      className={`rounded px-2 py-0.5 text-[9px] font-black whitespace-nowrap ${
                        limitReady ? "sp-btn-red animate-pulse cursor-pointer" : "bg-sky-200 text-sky-900 border border-sky-400"
                      }`}
                    >
                      LIMIT {limitPct}%
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 6. Enemy / Natural Resource Hint */}
          {(sel.team === "enemy" || isResourceNode) && (
            <span className="text-[10px] font-bold text-[#6b3c11] text-center leading-tight">
              {sel.team === "enemy"
                ? locale === "es"
                  ? "Enemigo — selecciona tropas (Ejército) y haz clic para atacar."
                  : "Enemy — select troops (Army) and click to attack."
                : locale === "es"
                  ? "Recurso natural — envía aldeanos para recolectar."
                  : "Natural resource — send villagers to harvest."}
            </span>
          )}
        </div>
      </div>

      {/* Right: Classic 2x2 Square Iconic Tool Grid (`Move`, `Rotate`, `Store`, `Sell`, `Upgrade`) matching `image_5.png` */}
      {playMode === "village" && sel.team === "player" && !isResourceNode && (
        <div className="grid shrink-0 grid-cols-2 gap-1 border-l border-[#cfa045] pl-2">
          <button
            type="button"
            onClick={props.onStartMove}
            title={locale === "es" ? "Mover" : "Move"}
            className="se-icon-btn flex h-8 w-8 flex-col items-center justify-center rounded-md text-[8px] font-black cursor-pointer"
          >
            <HudIcon name="move" className="h-3.5 w-3.5" />
            <span>{locale === "es" ? "Mover" : "Move"}</span>
          </button>
          <button
            type="button"
            onClick={props.onRotate}
            title={locale === "es" ? "Rotar" : "Rotate"}
            className="se-icon-btn flex h-8 w-8 flex-col items-center justify-center rounded-md text-[8px] font-black cursor-pointer"
          >
            <HudIcon name="rotate" className="h-3.5 w-3.5" />
            <span>{locale === "es" ? "Rotar" : "Turn"}</span>
          </button>
          {upgradeDef ? (
            <button
              type="button"
              onClick={props.onUpgrade}
              title={`${locale === "es" ? "Mejorar" : "Upgrade"} → ${upgradeDef.name}`}
              className="sp-btn-green flex h-8 w-8 flex-col items-center justify-center rounded-md text-[8px] font-black cursor-pointer"
            >
              <span>⬆</span>
              <span>{locale === "es" ? "Subir" : "Up"}</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={props.onStore}
              title={locale === "es" ? "Guardar en Almacén" : "Store in Warehouse"}
              className="se-icon-btn flex h-8 w-8 flex-col items-center justify-center rounded-md text-[8px] font-black cursor-pointer"
            >
              <HudIcon name="storage" className="h-3.5 w-3.5" />
              <span>{locale === "es" ? "Almac." : "Store"}</span>
            </button>
          )}
          <button
            type="button"
            onClick={props.onSell}
            title={locale === "es" ? "Vender" : "Sell"}
            className="sp-btn-red flex h-8 w-8 flex-col items-center justify-center rounded-md text-[8px] font-black cursor-pointer"
          >
            <HudIcon name="sell" className="h-3.5 w-3.5" />
            <span>{locale === "es" ? "Vender" : "Sell"}</span>
          </button>
        </div>
      )}
    </div>
  );
}
