import { useMemo } from "react";
import { getUiStrings } from "@sef/game-data";
import { useGameStore } from "../store/gameStore.js";

const TRAINABLE_BY_SUBCAT: Record<number, number[]> = {
  112: [500, 501], // Town Hall -> Villagers
  123: [502, 503, 504, 505], // Barracks
  125: [506, 507, 508, 515], // Castles / Knights
  126: [516, 517, 518, 519], // Archery / Stables / Siege
  127: [520, 521, 522, 523]
};

export function ExtendedPortrait(props: {
  onCollect: () => void;
  onUpgrade: () => void;
  onRotate: () => void;
  onStartMove: () => void;
  onStore: () => void;
  onSell: () => void;
  onTrainUnit: (unitId: number) => void;
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
    if (!def || def.type !== "b") return [];
    const ids = new Set<number>();
    if (def.trains > 0) ids.add(def.trains);
    for (const id of TRAINABLE_BY_SUBCAT[def.subcatFunctional] ?? []) ids.add(id);
    if (def.name.toLowerCase().includes("town hall")) {
      ids.add(500);
      ids.add(501);
    }
    if (def.name.toLowerCase().includes("barracks") || def.name.toLowerCase().includes("castle")) {
      ids.add(508);
      ids.add(515);
      ids.add(516);
    }
    return Array.from(ids)
      .map((id) => itemsById.get(id))
      .filter((x): x is NonNullable<typeof x> => Boolean(x));
  }, [def, itemsById]);

  if (!sel || !def) return null;

  return (
    <aside className="pointer-events-auto absolute right-3 top-16 z-20 w-76 rounded-2xl border-2 border-amber-500/85 bg-gradient-to-b from-[#3d2514]/95 to-[#201208]/95 p-3 shadow-2xl text-amber-50">
      {/* Header */}
      <div className="flex items-start gap-2.5">
        <img
          src={`/assets/ui/thumbs/${sel.imgName}.jpg`}
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
          alt={sel.name}
          className="h-14 w-14 rounded-xl border-2 border-amber-400/75 bg-stone-950 object-cover shrink-0"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-1">
            <h2 className="truncate text-sm font-black text-amber-300">
              {sel.name}
              {selectedCount > 1 ? ` (×${selectedCount})` : ""}
            </h2>
            <button
              type="button"
              onClick={props.onClose}
              className="text-xs text-amber-200/70 hover:text-white cursor-pointer"
            >
              ✕
            </button>
          </div>
          <div className="text-[11px] text-amber-100/75">
            #{def.id} · {def.type === "u" ? (locale === "es" ? "Unidad" : "Unit") : (locale === "es" ? "Edificio" : "Building")} · ({sel.tx}, {sel.ty})
          </div>
          {/* HP Bar */}
          <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-stone-950 border border-amber-500/30">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 to-lime-400 transition-all"
              style={{ width: `${Math.max(0, Math.min(100, (sel.hp / Math.max(1, sel.maxHp)) * 100))}%` }}
            />
          </div>
          <div className="mt-0.5 flex justify-between text-[10px] font-bold text-amber-200/80">
            <span>❤️ {sel.hp}/{sel.maxHp}</span>
            {sel.limitMax > 0 && <span className="text-sky-300">⚡ Limit {sel.limitGauge}/{sel.limitMax}</span>}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="mt-2 grid grid-cols-4 gap-1 text-center text-[11px] font-bold">
        <div className="rounded bg-stone-900/85 py-1 border border-amber-500/20">⚔️ {sel.attack}</div>
        <div className="rounded bg-stone-900/85 py-1 border border-amber-500/20">🛡️ {sel.defense}</div>
        <div className="rounded bg-stone-900/85 py-1 border border-amber-500/20">🎯 {sel.attackRange}</div>
        <div className="rounded bg-stone-900/85 py-1 border border-amber-500/20">👟 {sel.velocity}</div>
      </div>

      {/* Special Attacks (Phase 5 Data-Driven Behaviors) */}
      {sel.behavior && sel.behavior.specials.length > 0 && (
        <div className="mt-2 rounded-lg border border-sky-400/30 bg-slate-950/70 p-2">
          <div className="text-[10px] font-black uppercase tracking-wide text-sky-300">
            ✨ {locale === "es" ? "Ataques Especiales (AS3 1.4.07)" : "Special Attacks (AS3 1.4.07)"}
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {sel.behavior.specials.slice(0, 4).map((sp) => (
              <span
                key={sp.id}
                className="rounded bg-sky-900/70 px-1.5 py-0.5 text-[10px] font-bold text-sky-100 border border-sky-400/25"
              >
                {sp.kind.replace("_", " ")} (×{sp.damageMultiplier})
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Building Training Panel */}
      {playMode === "village" && def.type === "b" && trainableUnits.length > 0 && (
        <div className="mt-2.5">
          <div className="mb-1 text-[11px] font-black text-amber-200">
            ⚔️ {t.hud.train}
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {trainableUnits.slice(0, 6).map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => props.onTrainUnit(u.id)}
                className="flex items-center gap-1.5 rounded-lg border border-amber-500/35 bg-stone-900/90 hover:bg-amber-600/30 p-1 text-left cursor-pointer"
              >
                <img
                  src={`/assets/ui/thumbs/${u.imgName}.jpg`}
                  alt={u.name}
                  className="h-7 w-7 rounded object-cover bg-stone-950 shrink-0"
                />
                <div className="min-w-0 leading-tight">
                  <div className="truncate text-[10px] font-black text-amber-100">{u.name}</div>
                  <div className="text-[10px] font-bold text-amber-300">
                    {u.costType === "f" ? "🍖" : "🪙"}{u.cost}
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
              onClick={props.onCollect}
              className="col-span-2 rounded-lg bg-amber-500 hover:bg-amber-400 py-1.5 text-stone-950 cursor-pointer"
            >
              🪙 {t.hud.collect} (+{sel.collectAmount})
            </button>
          )}
          {upgradeDef && (
            <button
              type="button"
              onClick={props.onUpgrade}
              className="col-span-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 py-1.5 text-white cursor-pointer"
            >
              ⬆️ {t.hud.upgrade} → {upgradeDef.name} ({upgradeDef.cost})
            </button>
          )}
          {def.type === "b" && (
            <button
              type="button"
              onClick={props.onStartMove}
              className="rounded-lg bg-stone-800 hover:bg-stone-700 py-1 text-amber-100 cursor-pointer"
            >
              ✋ {t.hud.move}
            </button>
          )}
          <button
            type="button"
            onClick={props.onRotate}
            className="rounded-lg bg-stone-800 hover:bg-stone-700 py-1 text-amber-100 cursor-pointer"
          >
            🔄 {t.hud.rotate}
          </button>
          <button
            type="button"
            onClick={props.onStore}
            className="rounded-lg bg-stone-800 hover:bg-stone-700 py-1 text-sky-200 cursor-pointer"
          >
            📦 {t.hud.store}
          </button>
          <button
            type="button"
            onClick={props.onSell}
            className="rounded-lg bg-red-900/80 hover:bg-red-800 py-1 text-red-100 cursor-pointer"
          >
            💰 {t.hud.sell}
          </button>
        </div>
      )}

      {def.type === "u" && sel.team === "player" && (
        <p className="mt-2 rounded-lg bg-stone-950/70 px-2 py-1 text-[10px] text-emerald-200/85">
          {locale === "es"
            ? "Clic derecho en el suelo para mover, en enemigo para atacar o en árbol/piedra/granja para recolectar. Shift+Arrastrar selecciona escuadrón."
            : "Right-click ground to move, enemy to attack, or tree/rock/farm to harvest. Shift+Drag box-selects squad."}
        </p>
      )}
    </aside>
  );
}
