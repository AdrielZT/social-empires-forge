import { useMemo, useState } from "react";
import { getUiStrings } from "@sef/game-data";
import type { GameItem } from "@sef/shared-types";
import { useGameStore } from "../store/gameStore.js";
import { HudIcon, ResourceIcon } from "./GameIcons.js";

const TABS = [
  { id: "1" },
  { id: "2" },
  { id: "3" },
  { id: "4" },
  { id: "5" },
  { id: "12" },
  { id: "all" }
];

export function ShopModal(props: { onSelectPlace: (item: GameItem) => void }) {
  const locale = useGameStore((s) => s.locale);
  const items = useGameStore((s) => s.items);
  const setActiveModal = useGameStore((s) => s.setActiveModal);
  const t = getUiStrings(locale);

  const [activeTab, setActiveTab] = useState<string>("1");
  const [query, setQuery] = useState("");
  const [onlyStore, setOnlyStore] = useState(true);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items
      .filter((it) => {
        if (it.onlyMobile || !it.imgName) return false;
        if (onlyStore && !it.inStore) return false;
        if (activeTab !== "all" && String(it.categoryId) !== activeTab) return false;
        if (q && !it.name.toLowerCase().includes(q) && !String(it.id).includes(q) && !it.groups.toLowerCase().includes(q)) {
          return false;
        }
        return true;
      })
      .sort((a, b) => a.minLevel - b.minLevel || a.displayOrder - b.displayOrder || a.id - b.id)
      .slice(0, 120);
  }, [items, activeTab, query, onlyStore]);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/65 p-4">
      <div className="flex max-h-[86vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border-2 border-amber-500/85 bg-gradient-to-b from-[#3b2412] to-[#1e1209] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-amber-500/40 bg-[#2b190b] px-5 py-3">
          <div className="flex items-center gap-3">
            <HudIcon name="shop" className="h-7 w-7" />
            <div>
              <h2 className="text-lg font-black text-amber-300">{t.hud.shop}</h2>
              <p className="text-xs text-amber-100/70">
                {locale === "es"
                  ? "Catálogo clásico Social Empires 1.4.07 (clic para colocar en tu imperio)"
                  : "Classic Social Empires 1.4.07 catalog (click to place in your empire)"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setActiveModal(null)}
            className="rounded-lg bg-red-800/80 hover:bg-red-700 px-3 py-1.5 text-sm font-black text-white cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Category Tabs + Search */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-500/30 bg-[#241509] px-4 py-2.5">
          <div className="flex flex-wrap gap-1.5">
            {TABS.map((tab) => {
              const label =
                tab.id === "all"
                  ? locale === "es"
                    ? "Todo"
                    : "All"
                  : t.categories[tab.id] ?? tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-extrabold cursor-pointer ${
                    activeTab === tab.id
                      ? "bg-amber-500 text-stone-950 shadow"
                      : "bg-stone-800/90 text-amber-100 hover:bg-stone-700"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 text-xs font-bold text-amber-200/80 cursor-pointer">
              <input
                type="checkbox"
                checked={!onlyStore}
                onChange={(e) => setOnlyStore(!e.target.checked)}
              />
              {locale === "es" ? "Mostrar todos (1,786)" : "Show all (1,786)"}
            </label>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={locale === "es" ? "Buscar dragón, torre, casa..." : "Search dragon, tower, house..."}
              className="w-52 rounded-lg border border-amber-500/40 bg-stone-900 px-3 py-1 text-xs text-amber-50 outline-none focus:border-amber-400"
            />
          </div>
        </div>

        {/* Item Cards Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 overflow-y-auto p-4">
          {filtered.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                props.onSelectPlace(item);
                setActiveModal(null);
              }}
              className="group flex flex-col items-center rounded-xl border border-amber-500/35 bg-stone-900/85 p-2.5 text-center transition hover:border-amber-400 hover:bg-stone-800/95 cursor-pointer"
            >
              <div className="relative flex h-20 w-20 items-center justify-center overflow-hidden rounded-lg bg-stone-950/70 border border-amber-500/20">
                <img
                  src={`/assets/ui/thumbs/${item.imgName}.jpg`}
                  loading="lazy"
                  alt={item.name}
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.opacity = "0.2";
                  }}
                  className="h-full w-full object-contain group-hover:scale-105 transition"
                />
                <span className="absolute right-1 top-1 rounded bg-black/75 px-1 text-[10px] font-bold text-amber-300">
                  {item.width}×{item.height}
                </span>
              </div>
              <div className="mt-1.5 line-clamp-1 text-xs font-black text-amber-200">{item.name}</div>
              <div className="mt-0.5 flex items-center justify-center gap-1.5 text-[10px] text-amber-100/75">
                {item.type === "u" ? (
                  <>
                    <span className="flex items-center gap-0.5">
                      <HudIcon name="sword" className="h-3 w-3" />
                      {item.attack}
                    </span>
                    <span className="flex items-center gap-0.5">
                      <HudIcon name="heart" className="h-3 w-3" />
                      {item.life}
                    </span>
                    <span className="flex items-center gap-0.5">
                      <HudIcon name="shield" className="h-3 w-3" />
                      {item.defense}
                    </span>
                  </>
                ) : item.collect > 0 ? (
                  <span className="flex items-center gap-1">
                    +{item.collect}
                    <ResourceIcon type={item.collectType || "g"} className="h-3 w-3" />
                  </span>
                ) : item.population > 0 ? (
                  <span className="flex items-center gap-1">
                    +{item.population}
                    <ResourceIcon type="pop" className="h-3 w-3" />
                  </span>
                ) : (
                  <span className="flex items-center gap-1">
                    <HudIcon name="heart" className="h-3 w-3" />
                    {item.life}
                  </span>
                )}
              </div>
              <div className="mt-1.5 flex w-full items-center justify-center gap-1 rounded-md bg-amber-600/90 group-hover:bg-amber-500 py-1 text-xs font-black text-stone-950">
                <ResourceIcon type={item.costType || "g"} className="h-3.5 w-3.5" />
                <span>{item.cost.toLocaleString()}</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
