import { useState } from "react";
import { useGameStore } from "../store/gameStore.js";

const SPELL_ICONS: Record<number, string> = {
  2: "🔥",
  3: "☄️",
  4: "❄️",
  5: "💚",
  6: "🗿",
  7: "🌋",
  8: "☠️",
  9: "🛡️",
  10: "🐻‍❄️",
  11: "⚡",
  12: "🐉",
  13: "💥",
  14: "⏩",
  15: "🎯",
  16: "🕳️"
};

export function MagicBar(props: { onBuyMana: (useCash: boolean) => void }) {
  const [expanded, setExpanded] = useState(false);
  const locale = useGameStore((s) => s.locale);
  const magics = useGameStore((s) => s.magics);
  const mana = useGameStore((s) => s.resources.mana);
  const castingMagicId = useGameStore((s) => s.castingMagicId);
  const setCastingMagicId = useGameStore((s) => s.setCastingMagicId);
  const localizationEs = useGameStore((s) => s.localizationEs);

  return (
    <div className="pointer-events-auto flex flex-col items-start gap-1.5">
      {expanded && (
        <div className="grid grid-cols-5 gap-1.5 rounded-2xl border-2 border-sky-400/70 bg-[#131a2c]/95 p-2.5 shadow-2xl max-w-md">
          {magics.map((m) => {
            const name = locale === "es" ? localizationEs[`MAGIC_${m.id}_NAME`] ?? m.name : m.name;
            const desc = locale === "es" ? localizationEs[`MAGIC_${m.id}_DESC`] ?? m.description : m.description;
            const active = castingMagicId === m.id;
            const canCast = mana >= m.mana;
            return (
              <button
                key={m.id}
                type="button"
                title={`${name} (${m.mana} Maná)\n${desc}`}
                onClick={() => setCastingMagicId(active ? null : m.id)}
                disabled={!canCast}
                className={`flex flex-col items-center rounded-xl border p-1.5 text-center transition cursor-pointer ${
                  active
                    ? "border-amber-300 bg-sky-500/40 ring-2 ring-amber-300"
                    : canCast
                      ? "border-sky-400/40 bg-slate-900/90 hover:bg-sky-900/60"
                      : "border-slate-700 bg-slate-950/70 opacity-45 cursor-not-allowed"
                }`}
              >
                <span className="text-lg">{SPELL_ICONS[m.id] ?? "✨"}</span>
                <span className="mt-0.5 line-clamp-1 text-[9px] font-bold text-sky-100">{name}</span>
                <span className="text-[10px] font-black text-sky-300">💧{m.mana}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="flex items-center gap-1.5 rounded-xl border-2 border-sky-500/75 bg-[#121c33]/95 px-2.5 py-1.5 shadow-xl text-xs font-extrabold">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1.5 text-sky-200 hover:text-white cursor-pointer"
        >
          <span>🔮</span>
          <span>{locale === "es" ? "Magia (15)" : "Magic (15)"}</span>
          <span className="rounded bg-sky-500/25 px-1.5 py-0.5 text-sky-300">💧{mana}</span>
        </button>
        <button
          type="button"
          onClick={() => props.onBuyMana(false)}
          title={locale === "es" ? "Comprar +5 Maná (20,000 Oro)" : "Buy +5 Mana (20,000 Gold)"}
          className="rounded-md bg-sky-600 hover:bg-sky-500 px-1.5 py-0.5 text-[11px] font-black text-white cursor-pointer"
        >
          +5 🪙
        </button>
        <button
          type="button"
          onClick={() => props.onBuyMana(true)}
          title={locale === "es" ? "Comprar +5 Maná (1 Cash)" : "Buy +5 Mana (1 Cash)"}
          className="rounded-md bg-emerald-600 hover:bg-emerald-500 px-1.5 py-0.5 text-[11px] font-black text-white cursor-pointer"
        >
          +5 💵
        </button>
      </div>
    </div>
  );
}
