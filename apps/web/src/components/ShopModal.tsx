import { useMemo, useState } from "react";
import { getUiStrings } from "@sef/game-data";
import { computeEarlyUnlockCashCost } from "@sef/engine-sim";
import type { GameItem } from "@sef/shared-types";
import { useGameStore } from "../store/gameStore.js";
import { ClassicModalFrame } from "./ClassicFrame.js";
import { ItemThumb } from "./ItemThumb.js";
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
  const t = getUiStrings(locale);

  const [activeTab, setActiveTab] = useState<string>("1");
  const [query, setQuery] = useState("");
  const [adminShowHidden, setAdminShowHidden] = useState(false);

  const playerLevel = resources.level;
  const playerRace = activeSave?.maps[0]?.race ?? "h";
  const unlockedEarlySet = useMemo(() => {
    const raw = activeSave?.privateState?.unlockedEarlyBuildings;
    return new Set(Array.isArray(raw) ? raw.map(Number) : []);
  }, [activeSave]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = items.filter((it) => {
      if (it.onlyMobile || !it.imgName) return false;
      if (!adminMode) {
        // Canonical `BuildingWindow.as:114-127`: store-only, race-filtered, hide storeLevel > playerLevel
        if (!it.inStore) return false;
        if (it.race !== playerRace && it.race !== "a" && it.race !== "n") return false;
        if (it.storeLevel > 0 && it.storeLevel > playerLevel) return false;
      } else if (!adminShowHidden && !it.inStore) {
        return false;
      }
      if (activeTab !== "all" && String(it.categoryId) !== activeTab) return false;
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

    // Canonical `BuildingWindow.as:368-378`: unlocked items first, locked items (+10000) after
    list.sort((a, b) => {
      const aLocked = !adminMode && a.minLevel > playerLevel && !unlockedEarlySet.has(a.id) ? 1 : 0;
      const bLocked = !adminMode && b.minLevel > playerLevel && !unlockedEarlySet.has(b.id) ? 1 : 0;
      if (aLocked !== bLocked) return aLocked - bLocked;
      return a.minLevel - b.minLevel || a.displayOrder - b.displayOrder || a.id - b.id;
    });
    return list.slice(0, 140);
  }, [items, activeTab, query, adminMode, adminShowHidden, playerLevel, playerRace, unlockedEarlySet]);

  return (
    <ClassicModalFrame
      title={t.hud.shop}
      subtitle={
        adminMode
          ? locale === "es"
            ? "👑 MODO ADMIN ACTIVO — Todo el catálogo 1.4.07 desbloqueado sin perder tu partida"
            : "👑 ADMIN MODE ACTIVE — Full 1.4.07 catalog unlocked without losing your save"
          : locale === "es"
            ? `👤 Modo Usuario (Nivel ${playerLevel}) — Progresión clásica 1.4.07 con desbloqueo anticipado por Cash`
            : `👤 User Mode (Level ${playerLevel}) — Classic 1.4.07 progression with Cash early unlock`
      }
      icon={<HudIcon name="shop" className="h-7 w-7" />}
      maxWidthClass="max-w-5xl"
      onClose={() => setActiveModal(null)}
    >
      {/* Category Tabs + User/Admin Mode Toggle + Search */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-500/30 bg-[#2b180a] px-4 py-2.5">
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
                  activeTab === tab.id ? "sp-btn-gold" : "sp-btn-stone"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Instant non-destructive User / Admin mode switch */}
          <div className="sp-inset flex overflow-hidden rounded-lg border border-amber-500/40 text-[11px] font-black">
            <button
              type="button"
              data-testid="shop-mode-user"
              onClick={() => setAdminMode(false)}
              className={`px-2.5 py-1 cursor-pointer transition ${
                !adminMode ? "bg-amber-500 text-stone-950" : "text-amber-200/80 hover:text-amber-100"
              }`}
            >
              {locale === "es" ? "👤 Usuario" : "👤 User"}
            </button>
            <button
              type="button"
              data-testid="shop-mode-admin"
              onClick={() => setAdminMode(true)}
              className={`px-2.5 py-1 cursor-pointer transition ${
                adminMode ? "bg-purple-500 text-white" : "text-purple-200/80 hover:text-purple-100"
              }`}
            >
              {locale === "es" ? "👑 Admin" : "👑 Admin"}
            </button>
          </div>

          {adminMode && (
            <label className="flex items-center gap-1 text-xs font-bold text-purple-200 cursor-pointer">
              <input
                type="checkbox"
                data-testid="shop-show-all"
                checked={adminShowHidden}
                onChange={(e) => setAdminShowHidden(e.target.checked)}
              />
              {locale === "es" ? `Ocultos (${items.length})` : `Hidden (${items.length})`}
            </label>
          )}

          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={locale === "es" ? "Buscar dragón, torre, casa..." : "Search dragon, tower, house..."}
            className="sp-inset w-44 rounded-lg px-3 py-1 text-xs text-amber-50 outline-none focus:border-amber-400"
          />
        </div>
      </div>

      {/* Item Cards Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 overflow-y-auto p-4">
        {filtered.map((item) => {
          const isLocked = !adminMode && item.minLevel > playerLevel && !unlockedEarlySet.has(item.id);
          const unlockCash = computeEarlyUnlockCashCost(item.minLevel);

          return (
            <div
              key={item.id}
              data-testid={isLocked ? `shop-item-locked-${item.id}` : `shop-item-${item.id}`}
              className={`sp-card group relative flex flex-col items-center rounded-xl p-2.5 text-center transition ${
                isLocked ? "opacity-85 border-stone-600/80" : ""
              }`}
            >
              <button
                type="button"
                disabled={isLocked}
                onClick={() => {
                  if (isLocked) return;
                  props.onSelectPlace(item);
                  setActiveModal(null);
                }}
                className={`flex w-full flex-col items-center ${isLocked ? "cursor-not-allowed" : "cursor-pointer"}`}
              >
                <div className="sp-inset relative flex h-20 w-20 items-center justify-center overflow-hidden rounded-lg">
                  <ItemThumb
                    imgName={item.imgName}
                    alt={item.name}
                    itemType={item.type}
                    className={`h-full w-full object-contain transition ${
                      isLocked ? "grayscale opacity-60" : "group-hover:scale-105"
                    }`}
                  />
                  <span className="absolute right-1 top-1 rounded bg-black/75 px-1 text-[10px] font-bold text-amber-300">
                    {item.width}×{item.height}
                  </span>
                  {item.minLevel > 1 && (
                    <span
                      className={`absolute left-1 top-1 rounded px-1 text-[9px] font-black ${
                        isLocked ? "bg-red-900/95 text-amber-200" : "bg-black/75 text-emerald-300"
                      }`}
                    >
                      Nv.{item.minLevel}
                    </span>
                  )}
                  {isLocked && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/45">
                      <span className="text-lg">🔒</span>
                      <span className="rounded bg-black/80 px-1.5 py-0.5 text-[9px] font-black text-amber-300">
                        {locale === "es" ? `Nivel ${item.minLevel}` : `Level ${item.minLevel}`}
                      </span>
                    </div>
                  )}
                </div>

                <div className="mt-1.5 line-clamp-1 text-xs font-black text-amber-200">{item.name}</div>
                <div className="mt-0.5 flex items-center justify-center gap-1.5 text-[10px] text-amber-100/80">
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

                {!isLocked && (
                  <div className="sp-btn-gold mt-1.5 flex w-full items-center justify-center gap-1 rounded-md py-1 text-xs font-black">
                    <ResourceIcon type={item.costType || "g"} className="h-3.5 w-3.5" />
                    <span>{item.cost.toLocaleString()}</span>
                  </div>
                )}
              </button>

              {isLocked && (
                <button
                  type="button"
                  data-testid={`shop-unlock-${item.id}`}
                  onClick={() => props.onUnlockEarly(item, unlockCash)}
                  className="sp-btn-green mt-1.5 flex w-full items-center justify-center gap-1 rounded-md py-1 text-[11px] font-black cursor-pointer"
                >
                  <span>{locale === "es" ? "Desbloquear" : "Unlock"}</span>
                  <ResourceIcon type="c" className="h-3.5 w-3.5" />
                  <span>{unlockCash}</span>
                </button>
              )}
            </div>
          );
        })}
      </div>
    </ClassicModalFrame>
  );
}
