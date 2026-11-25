import { useState } from "react";
import { useGameStore } from "../store/gameStore.js";
import { CornerRivets } from "./ClassicFrame.js";
import { HudIcon, ResourceIcon, SpellSvgIcon } from "./GameIcons.js";

export function MagicBar(props: { onBuyMana: (useCash: boolean) => void }) {
  const [expanded, setExpanded] = useState(false);
  const locale = useGameStore((s) => s.locale);
  const magics = useGameStore((s) => s.magics);
  const mana = useGameStore((s) => s.resources.mana);
  const castingMagicId = useGameStore((s) => s.castingMagicId);
  const setCastingMagicId = useGameStore((s) => s.setCastingMagicId);
  const localizationEs = useGameStore((s) => s.localizationEs);

  return (
    <div className="pointer-events-auto flex flex-col items-start gap-2">
      {expanded && (
        <div className="sp-panel relative w-[490px] max-w-[92vw] rounded-2xl p-3.5">
          <CornerRivets />
          <div className="mb-2 flex items-center justify-between border-b border-amber-400/30 pb-1.5">
            <div className="flex items-center gap-1.5 text-xs font-black text-amber-300">
              <HudIcon name="magic" className="h-4 w-4" />
              <span>{locale === "es" ? "Libro de Hechizos (15 Magias)" : "Spellbook (15 Magics)"}</span>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-sky-200">
              <ResourceIcon type="mana" className="h-3.5 w-3.5" />
              <span>
                {mana} {locale === "es" ? "Maná" : "Mana"}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-5 gap-1.5">
            {magics.map((m) => {
              const name = locale === "es" ? localizationEs[`MAGIC_${m.id}_NAME`] ?? m.name : m.name;
              const desc = locale === "es" ? localizationEs[`MAGIC_${m.id}_DESC`] ?? m.description : m.description;
              const active = castingMagicId === m.id;
              const canCast = mana >= m.mana;
              return (
                <button
                  key={m.id}
                  type="button"
                  title={`${name} (${m.mana} ${locale === "es" ? "Maná" : "Mana"})\n${desc}`}
                  onClick={() => {
                    if (!canCast) return;
                    setCastingMagicId(active ? null : m.id);
                    setExpanded(false);
                  }}
                  disabled={!canCast}
                  className={`flex flex-col items-center rounded-xl border p-1.5 text-center transition ${
                    active
                      ? "border-amber-300 bg-sky-500/40 ring-2 ring-amber-300 cursor-pointer"
                      : canCast
                        ? "border-amber-400/45 bg-[#241b35]/95 hover:bg-sky-900/60 hover:border-amber-300 cursor-pointer"
                        : "border-stone-700/70 bg-slate-950/75 opacity-60 cursor-not-allowed"
                  }`}
                >
                  <SpellSvgIcon magicId={m.id} className="h-8 w-8" />
                  <span className="mt-1 line-clamp-2 min-h-[24px] text-[10px] leading-tight font-extrabold text-amber-100">
                    {name}
                  </span>
                  <span className="mt-0.5 flex items-center gap-0.5 text-[10px] font-black text-sky-300">
                    <ResourceIcon type="mana" className="h-3 w-3" />
                    {m.mana}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex items-center gap-1.5 rounded-xl border-2 border-amber-400/80 bg-gradient-to-b from-[#2c1f3d]/95 to-[#171229]/95 px-2.5 py-1.5 shadow-xl text-xs font-extrabold">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1.5 text-amber-100 hover:text-white cursor-pointer"
        >
          <HudIcon name="magic" className="h-4 w-4" />
          <span>{locale === "es" ? "Magia (15)" : "Magic (15)"}</span>
          <span className="flex items-center gap-0.5 rounded bg-sky-500/25 px-1.5 py-0.5 text-sky-300">
            <ResourceIcon type="mana" className="h-3.5 w-3.5" />
            {mana}
          </span>
        </button>
        <button
          type="button"
          onClick={() => props.onBuyMana(false)}
          title={locale === "es" ? "Comprar +5 Maná (20,000 Oro)" : "Buy +5 Mana (20,000 Gold)"}
          className="flex items-center gap-0.5 rounded-md bg-amber-600 hover:bg-amber-500 px-1.5 py-0.5 text-[11px] font-black text-stone-950 cursor-pointer"
        >
          <span>+5</span>
          <ResourceIcon type="g" className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={() => props.onBuyMana(true)}
          title={locale === "es" ? "Comprar +5 Maná (1 Cash)" : "Buy +5 Mana (1 Cash)"}
          className="flex items-center gap-0.5 rounded-md bg-emerald-600 hover:bg-emerald-500 px-1.5 py-0.5 text-[11px] font-black text-white cursor-pointer"
        >
          <span>+5</span>
          <ResourceIcon type="c" className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
