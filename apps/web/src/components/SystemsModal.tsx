import { useState } from "react";
import { computeMarketPrice } from "@sef/engine-sim";
import type { GameController } from "../engine/GameController.js";
import { useGameStore } from "../store/gameStore.js";

export function SystemsModal(props: { controller: GameController | null }) {
  const locale = useGameStore((s) => s.locale);
  const tab = useGameStore((s) => s.systemsTab);
  const setTab = useGameStore((s) => s.setSystemsTab);
  const setActiveModal = useGameStore((s) => s.setActiveModal);
  const activeSave = useGameStore((s) => s.activeSave);
  const goals = useGameStore((s) => s.goals);
  const itemsById = useGameStore((s) => s.itemsById);
  const collections = useGameStore((s) => s.collections);
  const setPlacingItemId = useGameStore((s) => s.setPlacingItemId);

  const [dartResult, setDartResult] = useState<string | null>(null);

  const map0 = activeSave?.maps[0];
  const priv = activeSave?.privateState ?? {};
  const rewardedMissions = Array.isArray(priv.rewardedMissions) ? (priv.rewardedMissions as number[]) : [];
  const deadHeroes = (priv.deadHeroes && typeof priv.deadHeroes === "object" ? priv.deadHeroes : {}) as Record<string, number>;
  const graveyard = (priv.graveyard && typeof priv.graveyard === "object" ? priv.graveyard : {}) as Record<string, number>;
  const potions = Number(priv.potion ?? 0);

  const handleMarketTrade = async (res: "w" | "s" | "f", action: "buy" | "sell") => {
    await props.controller?.sendCommands([{ cmd: "market_trade_resource", args: [res, action, 100] }]);
  };

  const handleClaimGoal = async (goalId: number, reward: number) => {
    await props.controller?.sendCommands([{ cmd: "reward_goal", args: [goalId, Math.max(100, reward), 25] }]);
  };

  const handleDailyBonus = async () => {
    await props.controller?.sendCommands([{ cmd: "win_bonus", args: [1000, 2] }]);
  };

  const handleShootDart = async () => {
    const prizes = [
      { label: "+500 🪙", gold: 500 },
      { label: "+1,200 🪙", gold: 1200 },
      { label: "+2,500 🪙", gold: 2500 }
    ];
    const pick = prizes[Math.floor(Math.random() * prizes.length)]!;
    await props.controller?.sendCommands([{ cmd: "gold_statue_conversion", args: [pick.gold] }]);
    setDartResult(pick.label);
  };

  const handleResurrect = async (unitId: number, usePotion: boolean) => {
    const ok = await props.controller?.sendCommands([
      { cmd: "resurrect_hero", args: [unitId, 50, 50, usePotion ? "1" : "0", 500] }
    ]);
    if (ok && useGameStore.getState().activeSave) {
      props.controller?.loadPersistentVillage(useGameStore.getState().activeSave!);
    }
  };

  const storedEntries = Object.entries(map0?.store ?? {}).filter(([, c]) => c > 0);
  const collectionCount = Object.keys(collections).length;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/65 p-4">
      <div className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border-2 border-amber-500/85 bg-gradient-to-b from-[#392412] to-[#1e1209] shadow-2xl text-amber-50">
        <div className="flex items-center justify-between border-b border-amber-500/40 bg-[#2b190b] px-5 py-3">
          <div className="flex items-center gap-2.5">
            <span className="text-2xl">🏛️</span>
            <h2 className="text-lg font-black text-amber-300">
              {locale === "es" ? "Sistemas del Imperio (1.4.07)" : "Empire Systems (1.4.07)"}
            </h2>
          </div>
          <button
            type="button"
            onClick={() => setActiveModal(null)}
            className="rounded-lg bg-red-800/80 hover:bg-red-700 px-3 py-1 text-sm font-black cursor-pointer"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5 border-b border-amber-500/30 bg-[#241509] px-4 py-2 text-xs font-extrabold">
          {(
            [
              ["goals", locale === "es" ? `📜 Objetivos (${goals.length})` : `📜 Goals (${goals.length})`],
              ["market", locale === "es" ? "⚖️ Mercado" : "⚖️ Market"],
              ["storage", locale === "es" ? `📦 Inventario (${storedEntries.length})` : `📦 Storage (${storedEntries.length})`],
              ["graveyard", locale === "es" ? "⚰️ Cementerio" : "⚰️ Graveyard"],
              ["specials", locale === "es" ? "🐉 Especiales 1.4.07" : "🐉 1.4.07 Specials"]
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`rounded-lg px-3 py-1.5 cursor-pointer ${
                tab === id ? "bg-amber-500 text-stone-950" : "bg-stone-800 text-amber-100 hover:bg-stone-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="overflow-y-auto p-4">
          {tab === "goals" && (
            <div className="space-y-2">
              {goals.filter((g) => g.id > 0 && g.title && g.title !== "none").slice(0, 40).map((g) => {
                const claimed = rewardedMissions.includes(g.id);
                return (
                  <div
                    key={g.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-stone-900/85 px-3.5 py-2.5 text-xs"
                  >
                    <div>
                      <div className="font-black text-amber-300">
                        #{g.id} {g.title}
                      </div>
                      <div className="text-[11px] text-amber-100/70">{g.description || g.instructions}</div>
                    </div>
                    <button
                      type="button"
                      disabled={claimed}
                      onClick={() => void handleClaimGoal(g.id, g.reward)}
                      className={`shrink-0 rounded-lg px-3 py-1.5 font-black cursor-pointer ${
                        claimed
                          ? "bg-emerald-900/50 text-emerald-300 cursor-default"
                          : "bg-amber-500 hover:bg-amber-400 text-stone-950"
                      }`}
                    >
                      {claimed
                        ? locale === "es"
                          ? "✓ Completado"
                          : "✓ Claimed"
                        : `🪙 +${Math.max(100, g.reward)}`}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {tab === "market" && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {(
                  [
                    ["w", locale === "es" ? "Madera" : "Wood", "🪵"],
                    ["s", locale === "es" ? "Piedra" : "Stone", "🪨"],
                    ["f", locale === "es" ? "Comida" : "Food", "🍖"]
                  ] as const
                ).map(([res, name, icon]) => {
                  const steps = map0?.resourcesTraded[res] ?? 0;
                  const buyP = computeMarketPrice(res, steps, "buy");
                  const sellP = computeMarketPrice(res, steps, "sell");
                  return (
                    <div key={res} className="rounded-xl border border-amber-500/40 bg-stone-900/90 p-4 text-center">
                      <div className="text-2xl">{icon}</div>
                      <div className="mt-1 text-sm font-black text-amber-300">{name} (×100)</div>
                      <div className="mt-3 flex flex-col gap-2 text-xs font-black">
                        <button
                          type="button"
                          onClick={() => void handleMarketTrade(res, "buy")}
                          className="rounded-lg bg-emerald-600 hover:bg-emerald-500 py-1.5 text-white cursor-pointer"
                        >
                          {locale === "es" ? "Comprar" : "Buy"} · 🪙{buyP}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleMarketTrade(res, "sell")}
                          className="rounded-lg bg-amber-600 hover:bg-amber-500 py-1.5 text-stone-950 cursor-pointer"
                        >
                          {locale === "es" ? "Vender" : "Sell"} · +🪙{sellP}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center justify-between rounded-xl border border-emerald-500/40 bg-stone-900/85 p-3 text-xs">
                <span>
                  💵 {locale === "es" ? "Cambiar 5 Cash por 2,500 Oro" : "Exchange 5 Cash for 2,500 Gold"}
                </span>
                <button
                  type="button"
                  onClick={() => void props.controller?.sendCommands([{ cmd: "exchange_cash", args: [] }])}
                  className="rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3 py-1.5 font-black text-white cursor-pointer"
                >
                  💵5 → 🪙2,500
                </button>
              </div>
            </div>
          )}

          {tab === "storage" && (
            <div>
              {storedEntries.length === 0 ? (
                <p className="text-center text-xs text-amber-100/70 py-8">
                  {locale === "es"
                    ? "Tu inventario está vacío. Selecciona cualquier edificio o unidad en tu aldea y pulsa Guardar."
                    : "Your storage is empty. Select any building or unit in your village and click Store."}
                </p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  {storedEntries.map(([idStr, count]) => {
                    const def = itemsById.get(Number(idStr));
                    if (!def) return null;
                    return (
                      <div key={idStr} className="rounded-xl border border-amber-500/35 bg-stone-900/90 p-2.5 text-center text-xs">
                        <img
                          src={`/assets/ui/thumbs/${def.imgName}.jpg`}
                          alt={def.name}
                          className="mx-auto h-14 w-14 rounded object-contain bg-stone-950"
                        />
                        <div className="mt-1 font-black text-amber-200 truncate">{def.name}</div>
                        <div className="text-[11px] text-amber-100/70">×{count}</div>
                        <div className="mt-2 flex gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              setPlacingItemId(def.id);
                              setActiveModal(null);
                            }}
                            className="flex-1 rounded bg-emerald-600 hover:bg-emerald-500 py-1 text-[11px] font-black cursor-pointer"
                          >
                            {locale === "es" ? "Colocar" : "Place"}
                          </button>
                          <button
                            type="button"
                            onClick={() => void props.controller?.sendCommands([{ cmd: "sell_stored_item", args: [def.id] }])}
                            className="rounded bg-red-900 hover:bg-red-800 px-2 py-1 text-[11px] font-black cursor-pointer"
                          >
                            💰
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {tab === "graveyard" && (
            <div className="space-y-3">
              <div className="rounded-xl border border-purple-500/40 bg-stone-900/85 p-3 text-xs">
                🧪 {locale === "es" ? "Pociones de resurrección disponibles:" : "Available resurrection potions:"}{" "}
                <span className="font-black text-purple-300">{potions}</span>
              </div>
              {Object.keys(deadHeroes).length === 0 && Object.keys(graveyard).length === 0 ? (
                <p className="text-center text-xs text-amber-100/70 py-6">
                  {locale === "es"
                    ? "Ningún héroe ni tropa caída esperando resurrección."
                    : "No fallen heroes or units awaiting resurrection."}
                </p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  {[...Object.entries(deadHeroes), ...Object.entries(graveyard)].map(([idStr, cnt]) => {
                    const def = itemsById.get(Number(idStr));
                    if (!def || cnt <= 0) return null;
                    return (
                      <div key={idStr} className="rounded-xl border border-purple-500/40 bg-stone-900 p-3 text-xs">
                        <div className="font-black text-amber-200">{def.name} (×{cnt})</div>
                        <div className="mt-2 flex gap-1.5">
                          <button
                            type="button"
                            onClick={() => void handleResurrect(def.id, false)}
                            className="flex-1 rounded bg-amber-500 py-1 font-black text-stone-950 cursor-pointer"
                          >
                            🪙 500
                          </button>
                          {potions > 0 && (
                            <button
                              type="button"
                              onClick={() => void handleResurrect(def.id, true)}
                              className="flex-1 rounded bg-purple-600 py-1 font-black text-white cursor-pointer"
                            >
                              🧪 1
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {tab === "specials" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="rounded-xl border border-amber-500/45 bg-stone-900/90 p-4">
                <h3 className="text-sm font-black text-amber-300">
                  🎁 {locale === "es" ? "Bono Diario (Daily Bonus)" : "Daily Bonus"}
                </h3>
                <p className="mt-1 text-amber-100/75">
                  {locale === "es"
                    ? "Reclama tu recompensa diaria clásica de Oro y Cash."
                    : "Claim your classic daily Gold & Cash reward."}
                </p>
                <button
                  type="button"
                  onClick={() => void handleDailyBonus()}
                  className="mt-3 rounded-lg bg-amber-500 hover:bg-amber-400 px-4 py-1.5 font-black text-stone-950 cursor-pointer"
                >
                  🎁 +1,000 🪙 & +2 💵
                </button>
              </div>

              <div className="rounded-xl border border-rose-500/45 bg-stone-900/90 p-4">
                <h3 className="text-sm font-black text-rose-300">
                  🎯 {locale === "es" ? "Minijuego de Dardos (Darts)" : "Darts Minigame"}
                </h3>
                <p className="mt-1 text-amber-100/75">
                  {locale === "es"
                    ? "Lanza un dardo a los globos clásicos para ganar premios."
                    : "Shoot a classic balloon dart to win instant prizes."}
                </p>
                <div className="mt-3 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleShootDart()}
                    className="rounded-lg bg-rose-600 hover:bg-rose-500 px-4 py-1.5 font-black text-white cursor-pointer"
                  >
                    🎯 {locale === "es" ? "Lanzar Dardo" : "Shoot Dart"}
                  </button>
                  {dartResult && <span className="font-black text-amber-300">{dartResult}</span>}
                </div>
              </div>

              <div className="rounded-xl border border-sky-500/45 bg-stone-900/90 p-4">
                <h3 className="text-sm font-black text-sky-300">
                  🐉 {locale === "es" ? `Colecciones de Unidades (${collectionCount})` : `Unit Collections (${collectionCount})`}
                </h3>
                <p className="mt-1 text-amber-100/75">
                  {locale === "es"
                    ? "Todas las 62 categorías clásicas de Dragones, Bahamut, Dioses, Elfos, Gladiadores y Fénix están cargadas desde config 1.4.07."
                    : "All 62 classic categories of Dragons, Bahamut, Gods, Elves, Gladiators, and Phoenix loaded from 1.4.07 config."}
                </p>
              </div>

              <div className="rounded-xl border border-purple-500/45 bg-stone-900/90 p-4">
                <h3 className="text-sm font-black text-purple-300">
                  ⚗️ {locale === "es" ? "Soul Mixer, Nido de Dragón y Forja Infernal" : "Soul Mixer, Dragon Nest & Hellforge"}
                </h3>
                <p className="mt-1 text-amber-100/75">
                  {locale === "es"
                    ? "Coloca Soul Mixer (3×3 corregido PR #40), Dragon Nest o Monster Nest desde la Tienda para fusionar e incubar unidades especiales."
                    : "Place Soul Mixer (PR #40 3×3 fixed), Dragon Nest, or Monster Nest from the Shop to fuse and hatch special units."}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
