import { useMemo, useState } from "react";
import { computeEarlyUnlockCashCost } from "@sef/engine-sim";
import type { GameItem } from "@sef/shared-types";
import { useGameStore } from "../store/gameStore.js";
import { CornerRivets } from "./ClassicFrame.js";
import { ItemThumb } from "./ItemThumb.js";
import { HudIcon, ResourceIcon } from "./GameIcons.js";

const PAGE_SIZE = 8; // Canonical `BuildingWindow.as:37-45` (`numCols=4, numRows=2, maxButtons=8`)

interface StoreTabDef {
  id: string;
  labelEs: string;
  labelEn: string;
  icon: "star" | "home" | "trophy" | "shield" | "sword" | "crown" | "grid";
  accent: string;
}

const STORE_TABS: StoreTabDef[] = [
  { id: "12", labelEs: "Novedades", labelEn: "News", icon: "star", accent: "from-rose-500 to-red-700" },
  { id: "1", labelEs: "Edificios", labelEn: "Buildings", icon: "home", accent: "from-amber-400 to-amber-700" },
  { id: "4", labelEs: "Decoraciones", labelEn: "Decorations", icon: "trophy", accent: "from-yellow-400 to-amber-600" },
  { id: "2", labelEs: "Defensa", labelEn: "Defense", icon: "shield", accent: "from-stone-400 to-stone-700" },
  { id: "3", labelEs: "Ataque", labelEn: "Attack", icon: "sword", accent: "from-sky-400 to-blue-700" },
  { id: "5", labelEs: "Maravillas", labelEn: "Wonders", icon: "crown", accent: "from-purple-400 to-purple-700" },
  { id: "all", labelEs: "Todo", labelEn: "All", icon: "grid", accent: "from-emerald-400 to-emerald-700" }
];

const SUBCAT_FILTERS: Record<string, { id: string; labelEs: string; labelEn: string; match: (it: GameItem) => boolean }[]> = {
  "1": [
    { id: "all", labelEs: "Todo", labelEn: "All", match: () => true },
    { id: "houses", labelEs: "Casas", labelEn: "Houses", match: (i) => i.population > 0 || i.name.toLowerCase().includes("house") },
    { id: "resources", labelEs: "Recursos", labelEn: "Resources", match: (i) => i.collect > 0 || [121, 122, 123, 124].includes(i.subcatFunctional) },
    { id: "special", labelEs: "Especiales", labelEn: "Special", match: (i) => i.subcatFunctional === 139 || i.id === 1529 || i.id === 1233 || i.id === 1255 || i.id === 1394 }
  ]
};

/**
 * Authentic Social Empires 1.4.07 Shop Modal (`StoreMC` + `BuildingWindow.as`, 1:1 with `image_3.png`):
 * - Floating resource balance strip directly above the frame
 * - Ornate gold frame with faceted ruby corner gems & bright cream parchment interior
 * - Red-and-white striped market stall awning (`CONSTRUIR`) top-left
 * - Protruding illustrated category tabs above the gold top border with active golden pointer
 * - 4x2 ivory card grid (8 items/page) with yellow left/right pagination arrows & white speech-bubble hover tooltip
 */
export function ShopModal(props: {
  onSelectPlace: (item: GameItem) => void;
  onUnlockEarly: (item: GameItem, cashCost: number) => void;
}) {
  const locale = useGameStore((s) => s.locale);
  const items = useGameStore((s) => s.items);
  const resources = useGameStore((s) => s.resources);
  const activeSave = useGameStore((s) => s.activeSave);
  const adminMode = useGameStore((s) => s.adminMode);
  const setAdminMode = useGameStore((s) => s.setAdminMode);
  const setActiveModal = useGameStore((s) => s.setActiveModal);
  const es = locale === "es";

  const [activeTab, setActiveTab] = useState<string>("1");
  const [subFilter, setSubFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [adminShowHidden, setAdminShowHidden] = useState(false);
  const [page, setPage] = useState(0);
  const [hoveredItem, setHoveredItem] = useState<GameItem | null>(null);

  const playerLevel = resources.level;
  const playerRace = activeSave?.maps[0]?.race ?? "h";
  const unlockedEarlySet = useMemo(() => {
    const raw = activeSave?.privateState?.unlockedEarlyBuildings;
    return new Set(Array.isArray(raw) ? raw.map(Number) : []);
  }, [activeSave]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const subDef = (SUBCAT_FILTERS[activeTab] ?? []).find((s) => s.id === subFilter);
    const list = items.filter((it) => {
      if (it.onlyMobile || !it.imgName) return false;
      if (!adminMode) {
        if (!it.inStore) return false;
        if (it.race !== playerRace && it.race !== "a" && it.race !== "n") return false;
        if (it.storeLevel > 0 && it.storeLevel > playerLevel) return false;
      } else if (!adminShowHidden && !it.inStore) {
        return false;
      }
      if (activeTab !== "all" && String(it.categoryId) !== activeTab) return false;
      if (subDef && !subDef.match(it)) return false;
      if (
        q &&
        !it.name.toLowerCase().includes(q) &&
        !String(it.id).includes(q) &&
        !it.groups.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });

    list.sort((a, b) => {
      const aLocked = !adminMode && a.minLevel > playerLevel && !unlockedEarlySet.has(a.id) ? 1 : 0;
      const bLocked = !adminMode && b.minLevel > playerLevel && !unlockedEarlySet.has(b.id) ? 1 : 0;
      if (aLocked !== bLocked) return aLocked - bLocked;
      return a.minLevel - b.minLevel || a.displayOrder - b.displayOrder || a.id - b.id;
    });
    return list;
  }, [items, activeTab, subFilter, query, adminMode, adminShowHidden, playerLevel, playerRace, unlockedEarlySet]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageItems = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  // Also count locked items across current view for User Mode clarity
  const subTabs = SUBCAT_FILTERS[activeTab] ?? [];

  return (
    <div className="fixed inset-0 z-40 flex flex-col items-center justify-center bg-black/55 p-3 backdrop-blur-[1px]">
      {/* Floating Resource Bar Above Store Modal (exact 1:1 with `image_3.png`) */}
      <div className="mb-7 flex flex-wrap items-center justify-center gap-3 rounded-full bg-black/55 px-4 py-1.5 text-xs font-black text-white shadow-lg border border-amber-400/40">
        <span className="flex items-center gap-1">
          <ResourceIcon type="g" size={18} /> {Math.floor(resources.coins).toLocaleString()}
        </span>
        <span className="flex items-center gap-1">
          <ResourceIcon type="w" size={18} /> {Math.floor(resources.wood).toLocaleString()}
        </span>
        <span className="flex items-center gap-1">
          <ResourceIcon type="f" size={18} /> {Math.floor(resources.food).toLocaleString()}
        </span>
        <span className="flex items-center gap-1">
          <ResourceIcon type="s" size={18} /> {Math.floor(resources.stone).toLocaleString()}
        </span>
        <span className="flex items-center gap-1 text-emerald-300">
          <ResourceIcon type="c" size={18} /> {Math.floor(resources.cash).toLocaleString()}
        </span>

        {/* Quick User / Admin Mode Switch styled cleanly like the blue Get More Cash pill */}
        <div className="ml-1 flex overflow-hidden rounded-full border border-sky-200 bg-sky-950/90 text-[10px] font-black shadow">
          <button
            type="button"
            data-testid="shop-mode-user"
            onClick={() => {
              setAdminMode(false);
              setAdminShowHidden(false);
              setPage(0);
            }}
            className={`px-2.5 py-1 cursor-pointer transition ${
              !adminMode ? "sp-btn-blue" : "text-sky-200 hover:text-white"
            }`}
          >
            👤 {es ? "Usuario" : "User"}
          </button>
          <button
            type="button"
            data-testid="shop-mode-admin"
            onClick={() => {
              setAdminMode(true);
              setPage(0);
            }}
            className={`px-2.5 py-1 cursor-pointer transition ${
              adminMode ? "bg-purple-600 text-white" : "text-sky-200 hover:text-white"
            }`}
          >
            👑 Admin
          </button>
        </div>

        {adminMode && (
          <label className="flex items-center gap-1 text-[10px] font-bold text-purple-200 cursor-pointer">
            <input
              type="checkbox"
              data-testid="shop-show-all"
              checked={adminShowHidden}
              onChange={(e) => {
                setAdminShowHidden(e.target.checked);
                setPage(0);
              }}
              className="accent-purple-400"
            />
            <span>{es ? "Ocultos" : "Hidden"}</span>
          </label>
        )}
      </div>

      {/* Main Ornate Gold & Cream Parchment Store Frame (`StoreMC`, 1:1 with `image_3.png`) */}
      <div className="se-ornate-frame relative flex w-full max-w-[740px] flex-col rounded-2xl pt-4 pb-3 px-4">
        <CornerRivets />

        {/* Top-Left Red & White Striped Canopy Awning + CONSTRUIR Ribbon */}
        <div className="pointer-events-none absolute -left-3 -top-9 z-20 flex flex-col items-center">
          <div className="se-awning h-6 w-28 rounded-t-xl" />
          <div className="se-ornate-gold-rim -mt-1 rounded-md px-3 py-0.5 text-xs font-black tracking-wider text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
            {es ? "CONSTRUIR" : "BUILD"}
          </div>
        </div>

        {/* Protruding Illustrated Category Tabs Above Top Border (`image_3.png`) */}
        <div className="absolute -top-9 left-28 right-10 z-20 flex items-end justify-center gap-2">
          {STORE_TABS.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setActiveTab(tab.id);
                  setSubFilter("all");
                  setPage(0);
                }}
                className={`group relative flex flex-col items-center cursor-pointer transition-transform ${
                  active ? "-translate-y-1 scale-105" : "hover:-translate-y-0.5"
                }`}
              >
                {active && (
                  <span className="mb-0.5 text-[11px] leading-none text-amber-400 drop-shadow-[0_1px_1px_rgba(0,0,0,0.9)]">
                    ▼
                  </span>
                )}
                <div
                  className={`flex h-9 w-10 items-center justify-center rounded-xl border-2 bg-gradient-to-b shadow-md ${tab.accent} ${
                    active ? "border-yellow-200 ring-2 ring-amber-400" : "border-[#5c2c06]"
                  }`}
                >
                  <HudIcon name={tab.icon} className="h-5 w-5 text-white drop-shadow" />
                </div>
                <span
                  className={`mt-0.5 rounded px-1.5 py-0.5 text-[10px] font-black leading-none shadow-sm ${
                    active
                      ? "bg-[#fef08a] text-[#3a1a03] border border-[#b45309]"
                      : "bg-[#fff8e1]/95 text-[#4a2204] border border-[#cfa045]"
                  }`}
                >
                  {es ? tab.labelEs : tab.labelEn}
                </span>
              </button>
            );
          })}
        </div>

        {/* Top-Right Close Button */}
        <button
          type="button"
          data-testid="modal-close"
          onClick={() => setActiveModal(null)}
          aria-label="Cerrar"
          className="sp-btn-red absolute -right-3 -top-3 z-30 flex h-8 w-8 items-center justify-center rounded-full text-sm font-black cursor-pointer"
        >
          ✕
        </button>

        {/* Subcategory Pill Bar + Compact Search */}
        <div className="mt-3 mb-2.5 flex flex-wrap items-center justify-between gap-2 border-b border-[#d4ae6a] pb-2">
          <div className="flex flex-wrap items-center gap-1">
            {subTabs.length > 0 ? (
              subTabs.map((sub) => (
                <button
                  key={sub.id}
                  type="button"
                  onClick={() => {
                    setSubFilter(sub.id);
                    setPage(0);
                  }}
                  className={`rounded-md px-2.5 py-0.5 text-[11px] font-black cursor-pointer transition ${
                    subFilter === sub.id
                      ? "bg-white text-[#3a1f07] border border-[#b47b19] shadow-sm"
                      : "text-[#6b3c11] hover:bg-[#fff8e0]"
                  }`}
                >
                  {es ? sub.labelEs : sub.labelEn}
                </button>
              ))
            ) : (
              <span className="text-[11px] font-black text-[#6b3c11]">
                {adminMode
                  ? es ? `👑 Catálogo Admin (${filtered.length} ítems)` : `👑 Admin Catalog (${filtered.length} items)`
                  : es ? `Nivel ${playerLevel} · ${filtered.length} ítems` : `Level ${playerLevel} · ${filtered.length} items`}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <input
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
              placeholder={es ? "Buscar..." : "Search..."}
              className="w-40 rounded-md border border-[#c7a265] bg-white px-2.5 py-1 text-xs font-semibold text-[#3a1f07] placeholder:text-[#9a713c] focus:border-amber-600 focus:outline-none"
            />
            <span className="text-[11px] font-black text-[#6b3c11]">
              {safePage + 1}/{totalPages}
            </span>
          </div>
        </div>

        {/* Classic 4x2 Card Grid with Left/Right Yellow Pagination Arrows (`image_3.png`) */}
        <div className="relative flex items-center gap-2">
          <button
            type="button"
            disabled={safePage <= 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            aria-label={es ? "Página anterior" : "Previous page"}
            className="flex h-16 w-6 shrink-0 items-center justify-center rounded-md border border-[#b47b19] bg-gradient-to-b from-[#fef08a] to-[#eab308] text-sm font-black text-[#5c2c06] shadow cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed"
          >
            ◀
          </button>

          <div className="grid flex-1 grid-cols-2 sm:grid-cols-4 gap-2.5 min-h-[350px]">
            {pageItems.map((it) => {
              const isLocked = !adminMode && it.minLevel > playerLevel && !unlockedEarlySet.has(it.id);
              const earlyCash = isLocked ? computeEarlyUnlockCashCost(it.minLevel) : 0;
              const canAffordEarly = resources.cash >= earlyCash;
              const isNew = it.minLevel >= playerLevel && it.minLevel <= playerLevel + 2;

              return (
                <div
                  key={it.id}
                  data-testid={isLocked ? `shop-item-locked-${it.id}` : `shop-item-${it.id}`}
                  onMouseEnter={() => setHoveredItem(it)}
                  onMouseLeave={() => setHoveredItem((cur) => (cur?.id === it.id ? null : cur))}
                  className={`se-parchment-card relative flex flex-col justify-between rounded-xl p-2 transition ${
                    isLocked ? "opacity-90" : ""
                  }`}
                >
                  {/* Item Name Header */}
                  <div className="truncate text-center text-[11px] font-black text-[#3a1f07]" title={it.name}>
                    {it.name}
                  </div>

                  {/* Crisp White Thumbnail Stage */}
                  <div className="relative my-1 flex h-[86px] w-full items-center justify-center rounded-lg bg-white/90 border border-[#ede0c4]">
                    {isNew && !isLocked && (
                      <span className="absolute left-1 top-1 rounded bg-red-600 px-1 py-0.5 text-[8px] font-black uppercase text-white shadow">
                        NEW
                      </span>
                    )}
                    {it.minLevel > 1 && (
                      <span
                        className={`absolute right-1 top-1 rounded px-1 py-0.5 text-[8px] font-black shadow ${
                          isLocked ? "bg-red-700 text-white" : "bg-emerald-700 text-white"
                        }`}
                      >
                        Nv.{it.minLevel}
                      </span>
                    )}
                    <ItemThumb
                      imgName={it.imgName}
                      alt={it.name}
                      itemType={it.type}
                      className={`h-[74px] w-[74px] object-contain ${isLocked ? "grayscale opacity-65" : ""}`}
                    />
                  </div>

                  {/* EXP + COST Footer matching `image_3.png` */}
                  <div className="space-y-0.5 text-[10px]">
                    <div className="flex items-center justify-between text-[#6b3c11] font-bold">
                      <span>{es ? "EXP. GANADA:" : "XP EARNED:"}</span>
                      <span className="font-black text-[#3a1f07]">{it.xp} exp</span>
                    </div>

                    {isLocked ? (
                      <button
                        type="button"
                        data-testid={`btn-unlock-early-${it.id}`}
                        disabled={!canAffordEarly}
                        onClick={() => props.onUnlockEarly(it, earlyCash)}
                        className={`mt-1 flex w-full items-center justify-center gap-1 rounded-md py-1 text-[10px] font-black ${
                          canAffordEarly
                            ? "sp-btn-green cursor-pointer"
                            : "bg-stone-300 text-stone-600 cursor-not-allowed"
                        }`}
                      >
                        <span>🔒 Nv.{it.minLevel} ·</span>
                        <ResourceIcon type="c" size={12} />
                        <span>{earlyCash}</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          props.onSelectPlace(it);
                          setActiveModal(null);
                        }}
                        className="mt-0.5 flex w-full items-center justify-between rounded-md border border-[#d49b2a] bg-gradient-to-b from-[#fff5cc] to-[#f8d76e] px-2 py-0.5 text-[10px] font-black text-[#3a1f07] hover:brightness-105 cursor-pointer shadow-sm"
                      >
                        <span>{es ? "COSTE:" : "COST:"}</span>
                        <span className="flex items-center gap-1">
                          <span>{it.cost.toLocaleString()}</span>
                          <ResourceIcon type={it.costType || "g"} size={14} />
                        </span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <button
            type="button"
            disabled={safePage >= totalPages - 1}
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            aria-label={es ? "Página siguiente" : "Next page"}
            className="flex h-16 w-6 shrink-0 items-center justify-center rounded-md border border-[#b47b19] bg-gradient-to-b from-[#fef08a] to-[#eab308] text-sm font-black text-[#5c2c06] shadow cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed"
          >
            ▶
          </button>
        </div>

        {/* Classic Crisp White Speech-Bubble Hover Tooltip (`image_3.png`) */}
        {hoveredItem && (
          <div className="se-speech-tooltip pointer-events-none absolute -top-4 right-4 z-30 w-56 rounded-xl px-3 py-2 text-[11px] leading-snug">
            <div className="font-black text-[#3a1f07]">{hoveredItem.name}</div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] font-bold text-[#5c300a]">
              <span>❤️ HP: {hoveredItem.life}</span>
              {hoveredItem.attack > 0 && <span>⚔️ ATK: {hoveredItem.attack}</span>}
              {hoveredItem.population > 0 && <span>👥 +{hoveredItem.population}</span>}
              {hoveredItem.collect > 0 && (
                <span>
                  💰 +{hoveredItem.collect} ({hoveredItem.collectType || "g"})
                </span>
              )}
              <span>📐 {hoveredItem.width}×{hoveredItem.height}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
