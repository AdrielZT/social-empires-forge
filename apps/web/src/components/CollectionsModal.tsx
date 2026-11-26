import { useMemo, useState } from "react";
import { ClassicModalFrame } from "./ClassicFrame.js";
import { ItemThumb } from "./ItemThumb.js";
import { ResourceIcon } from "./GameIcons.js";
import { useGameStore } from "../store/gameStore.js";

interface CollectionEntry {
  category_id: number;
  category_lang_id: number;
  units: number[];
  rewards: number;
  cost: number;
  position: number;
}

const PAGE_SIZE = 3; // Canonical `popupCollections.as:45` displays 3 collections per page

/**
 * Canonical `popupCollections.as` (128 unit collections from `collections.json`):
 * - User Mode: uncollected units render greyed-out (`grayscale opacity-55`), can be unlocked
 *   by owning them in the kingdom or paying Cash, and claiming the collection reward once all 5 are unlocked.
 * - Admin Mode: every individual unit AND every collection reward has a direct "Reclamar" button
 *   to spawn and test it immediately in the kingdom.
 */
export function CollectionsModal(props: {
  onUnlockUnit: (unitId: number, cashCost: number, alsoSpawn: boolean) => Promise<void>;
  onClaimReward: (colId: number, rewardUnitId: number) => Promise<void>;
  onClose: () => void;
}) {
  const locale = useGameStore((s) => s.locale);
  const adminMode = useGameStore((s) => s.adminMode);
  const itemsById = useGameStore((s) => s.itemsById);
  const activeSave = useGameStore((s) => s.activeSave);
  const rawCollections = useGameStore((s) => s.collections);
  const locEs = useGameStore((s) => s.localizationEs);
  const locEn = useGameStore((s) => s.localizationEn);
  const es = locale === "es";

  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");

  const allCollections = useMemo<CollectionEntry[]>(() => {
    const arr = Array.isArray(rawCollections)
      ? (rawCollections as CollectionEntry[])
      : Array.isArray((rawCollections as { collections?: unknown[] })?.collections)
        ? ((rawCollections as { collections: CollectionEntry[] }).collections)
        : Object.values(rawCollections ?? {}).filter(
            (v): v is CollectionEntry => Boolean(v && typeof v === "object" && "units" in v)
          );
    return [...arr].sort((a, b) => (a.position ?? a.category_id) - (b.position ?? b.category_id));
  }, [rawCollections]);

  const ownedOrUnlockedUnits = useMemo(() => {
    const set = new Set<number>();
    const map0 = activeSave?.maps[0];
    if (map0) {
      for (const t of map0.items) {
        set.add(Number(t[0]));
      }
    }
    const ps = (activeSave?.privateState ?? {}) as Record<string, unknown>;
    if (Array.isArray(ps.collectedUnits)) {
      for (const id of ps.collectedUnits) set.add(Number(id));
    }
    return set;
  }, [activeSave]);

  const claimedSet = useMemo(() => {
    const ps = (activeSave?.privateState ?? {}) as Record<string, unknown>;
    return new Set<number>(
      Array.isArray(ps.claimedCollections) ? (ps.claimedCollections as number[]).map(Number) : []
    );
  }, [activeSave]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allCollections;
    return allCollections.filter((c) => {
      const rewardName = itemsById.get(c.rewards)?.name?.toLowerCase() ?? "";
      if (rewardName.includes(q)) return true;
      return c.units.some((uid) => (itemsById.get(uid)?.name?.toLowerCase() ?? "").includes(q));
    });
  }, [allCollections, search, itemsById]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const visible = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  return (
    <ClassicModalFrame
      theme="parchment"
      title={es ? `Colección de Unidades (${allCollections.length})` : `Unit Collections (${allCollections.length})`}
      subtitle={
        adminMode
          ? es
            ? "Modo Admin: reclama cualquier unidad individual o recompensa directamente en tu reino."
            : "Admin Mode: claim any individual unit or collection reward directly to your kingdom."
          : es
            ? "Modo Usuario: las unidades bloqueadas aparecen en gris hasta obtenerlas o completarlas."
            : "User Mode: locked units appear in grayscale until obtained or completed."
      }
      maxWidthClass="max-w-4xl"
      onClose={props.onClose}
    >
      <div className="p-4 flex flex-col gap-3 overflow-y-auto">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            placeholder={es ? "Buscar unidad o colección..." : "Search unit or collection..."}
            className="w-64 rounded-lg bg-white border border-[#c7a265] px-3 py-1.5 text-xs font-semibold text-[#3a1f07] placeholder:text-[#9a713c]"
          />
          <div className="flex items-center gap-2 text-xs text-[#4a2204]">
            <button
              type="button"
              disabled={safePage <= 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="sp-btn-gold rounded-lg px-3 py-1 font-black disabled:opacity-40 cursor-pointer"
            >
              ◀
            </button>
            <span className="font-black">
              {es ? "Página" : "Page"} {safePage + 1} / {totalPages}
            </span>
            <button
              type="button"
              disabled={safePage >= totalPages - 1}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              className="sp-btn-gold rounded-lg px-3 py-1 font-black disabled:opacity-40 cursor-pointer"
            >
              ▶
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          {visible.map((col) => {
            const locMap = es ? locEs : locEn;
            const colTitle =
              locMap[String(col.category_lang_id)] ??
              (es ? `Colección #${col.category_id}` : `Collection #${col.category_id}`);
            const rewardDef = itemsById.get(col.rewards);
            const unlockedCount = col.units.filter((u) => ownedOrUnlockedUnits.has(u)).length;
            const isComplete = unlockedCount >= col.units.length;
            const isClaimed = claimedSet.has(col.category_id);

            return (
              <div
                key={col.category_id}
                data-testid={`collection-row-${col.category_id}`}
                className="se-parchment-card rounded-xl p-3 flex flex-col gap-2"
              >
                <div className="flex items-center justify-between border-b border-[#e5cfa1] pb-1">
                  <div className="text-sm font-black text-[#4a2204]">
                    {colTitle}{" "}
                    <span className="text-xs font-bold text-[#7c4b1a]">
                      ({unlockedCount}/{col.units.length})
                    </span>
                  </div>
                  <div className="text-[11px] font-bold text-[#6b3c11]">
                    {es ? "Recompensa:" : "Reward:"}{" "}
                    <span className="font-black text-emerald-700">{rewardDef?.name ?? `#${col.rewards}`}</span>
                  </div>
                </div>

                <div className="grid grid-cols-6 gap-2 items-center">
                  {col.units.map((unitId) => {
                    const uDef = itemsById.get(unitId);
                    const unlocked = ownedOrUnlockedUnits.has(unitId);
                    const unitCashCost = Math.max(1, col.cost || 2);
                    return (
                      <div
                        key={unitId}
                        className="rounded-lg border border-[#dcc392] bg-[#fffdf7] p-1.5 flex flex-col items-center gap-1 text-center shadow-sm"
                      >
                        <div className={unlocked ? "" : "grayscale opacity-50 transition-opacity"}>
                          {uDef ? (
                            <ItemThumb imgName={uDef.imgName} alt={uDef.name} itemType="u" className="h-12 w-12" />
                          ) : (
                            <div className="h-12 w-12 rounded bg-stone-200" />
                          )}
                        </div>
                        <div className="text-[10px] font-black text-[#3a1f07] line-clamp-1 w-full">
                          {uDef?.name ?? `#${unitId}`}
                        </div>
                        {adminMode ? (
                          <button
                            type="button"
                            data-testid={`admin-claim-unit-${unitId}`}
                            onClick={() => void props.onUnlockUnit(unitId, 0, true)}
                            className="sp-btn-green w-full rounded py-0.5 text-[10px] font-black cursor-pointer"
                          >
                            {es ? "Reclamar" : "Claim"}
                          </button>
                        ) : unlocked ? (
                          <span className="text-[10px] font-black text-emerald-700">
                            ✓ {es ? "Obtenida" : "Owned"}
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void props.onUnlockUnit(unitId, unitCashCost, false)}
                            className="sp-btn-gold w-full rounded py-0.5 text-[10px] font-black cursor-pointer flex items-center justify-center gap-0.5"
                          >
                            <ResourceIcon type="cash" size={11} />
                            {unitCashCost}
                          </button>
                        )}
                      </div>
                    );
                  })}

                  {/* Reward Slot */}
                  <div className="rounded-lg border-2 border-[#d49b2a] bg-gradient-to-b from-[#fffbeb] to-[#fef08a]/50 p-1.5 flex flex-col items-center gap-1 text-center shadow">
                    <div className={isComplete || adminMode ? "" : "grayscale opacity-60"}>
                      {rewardDef ? (
                        <ItemThumb imgName={rewardDef.imgName} alt={rewardDef.name} itemType="u" className="h-12 w-12" />
                      ) : (
                        <div className="h-12 w-12 rounded bg-stone-200" />
                      )}
                    </div>
                    <div className="text-[10px] font-black text-[#4a2204] line-clamp-1 w-full">
                      {rewardDef?.name ?? `#${col.rewards}`}
                    </div>
                    <button
                      type="button"
                      disabled={!adminMode && (!isComplete || isClaimed)}
                      onClick={() => void props.onClaimReward(col.category_id, col.rewards)}
                      className={`w-full rounded py-0.5 text-[10px] font-black cursor-pointer ${
                        adminMode || (isComplete && !isClaimed)
                          ? "sp-btn-gold"
                          : "bg-stone-300 text-stone-600 cursor-not-allowed"
                      }`}
                    >
                      {isClaimed && !adminMode
                        ? es
                          ? "Reclamada"
                          : "Claimed"
                        : es
                          ? "Recompensa"
                          : "Claim"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </ClassicModalFrame>
  );
}
