import { useState } from "react";
import { useGameStore } from "../store/gameStore.js";
import { CornerRivets } from "./ClassicFrame.js";
import { HudIcon, ResourceIcon, SpellSvgIcon } from "./GameIcons.js";

/**
 * Compact 1.4.07 Spell Quick-Slots floating cleanly above the center of the unified bottom dock
 * (matching the square quick-action icons above the bottom bar in `image.png`), with expandable 15-magic spellbook.
 */
export function MagicBar(props: { onBuyMana: (useCash: boolean) => void }) {
  const [expanded, setExpanded] = useState(false);
  const locale = useGameStore((s) => s.locale);
  const magics = useGameStore((s) => s.magics);
  const mana = useGameStore((s) => s.resources.mana);
  const castingMagicId = useGameStore((s) => s.castingMagicId);
  const setCastingMagicId = useGameStore((s) => s.setCastingMagicId);
  const localizationEs = useGameStore((s) => s.localizationEs);

  const quickSpells = magics.slice(0, 4);

  return (
    <div className="pointer-events-auto relative flex flex-col items-center gap-1.5">
      {expanded && (
        <div className="se-ornate-frame absolute bottom-full mb-2 z-30 w-[500px] max-w-[92vw] rounded-2xl p-3">
          <CornerRivets />
          <div className="mb-2 flex items-center justify-between border-b border-[#cfa045] pb-1.5">
            <div className="flex items-center gap-1.5 text-xs font-black text-[#4a2204]">
              <HudIcon name="magic" className="h-4 w-4" />
              <span>{locale === "es" ? "Libro de Hechizos (15 Magias)" : "Spellbook (15 Magics)"}</span>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] font-black text-sky-900">
              <ResourceIcon type="mana" size={14} />
              <span>
                {mana} {locale === "es" ? "Maná" : "Mana"}
              </span>
              <button
                type="button"
                onClick={() => props.onBuyMana(false)}
                title={locale === "es" ? "+5 Maná (20,000 Oro)" : "+5 Mana (20,000 Gold)"}
                className="sp-btn-gold flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-black cursor-pointer"
              >
                +5 <ResourceIcon type="g" size={12} />
              </button>
              <button
                type="button"
                onClick={() => props.onBuyMana(true)}
                title={locale === "es" ? "+5 Maná (1 Cash)" : "+5 Mana (1 Cash)"}
                className="sp-btn-green flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-black cursor-pointer"
              >
                +5 <ResourceIcon type="c" size={12} />
              </button>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="sp-btn-red flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-black cursor-pointer"
              >
                ✕
              </button>
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
                      ? "border-amber-600 bg-amber-200 ring-2 ring-amber-500 cursor-pointer"
                      : canCast
                        ? "se-parchment-card cursor-pointer"
                        : "border-[#d8c59e] bg-[#ece0c2] opacity-55 cursor-not-allowed"
                  }`}
                >
                  <SpellSvgIcon magicId={m.id} className="h-8 w-8" />
                  <span className="mt-1 line-clamp-2 min-h-[22px] text-[10px] leading-tight font-black text-[#3a1f07]">
                    {name}
                  </span>
                  <span className="mt-0.5 flex items-center gap-0.5 text-[10px] font-black text-sky-700">
                    <ResourceIcon type="mana" size={11} />
                    {m.mana}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Compact Square Quick-Slots Floating Above Bottom Bar (1:1 with `image.png`) */}
      <div className="flex items-center gap-1 rounded-lg border-2 border-[#d49b2a] bg-[#3b2009]/90 p-1 shadow-lg">
        {quickSpells.map((m) => {
          const name = locale === "es" ? localizationEs[`MAGIC_${m.id}_NAME`] ?? m.name : m.name;
          const active = castingMagicId === m.id;
          const canCast = mana >= m.mana;
          return (
            <button
              key={m.id}
              type="button"
              disabled={!canCast}
              onClick={() => canCast && setCastingMagicId(active ? null : m.id)}
              title={`${name} (${m.mana} ${locale === "es" ? "Maná" : "Mana"})`}
              className={`relative flex h-9 w-9 items-center justify-center rounded border transition ${
                active
                  ? "border-yellow-300 bg-sky-600 ring-2 ring-yellow-300 cursor-pointer"
                  : canCast
                    ? "border-[#e4b34a] bg-gradient-to-b from-[#fff8de] to-[#e9cf8b] hover:brightness-105 cursor-pointer"
                    : "border-[#876b3b] bg-[#d4c49e]/60 opacity-55 cursor-not-allowed"
              }`}
            >
              <SpellSvgIcon magicId={m.id} className="h-7 w-7" />
              <span className="absolute -bottom-0.5 right-0 rounded bg-[#1e3a8a]/90 px-1 text-[8px] font-black text-sky-100">
                {m.mana}
              </span>
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          title={locale === "es" ? "Abrir Libro de 15 Magias" : "Open 15-Spell Book"}
          className="flex h-9 items-center gap-1 rounded border border-[#e4b34a] bg-gradient-to-b from-[#38bdf8] to-[#1d4ed8] px-2 text-[10px] font-black text-white shadow hover:brightness-110 cursor-pointer"
        >
          <ResourceIcon type="mana" size={13} />
          <span>{mana}</span>
          <span className="text-[9px] opacity-90">{expanded ? "▼" : "▲"}</span>
        </button>
      </div>
    </div>
  );
}
