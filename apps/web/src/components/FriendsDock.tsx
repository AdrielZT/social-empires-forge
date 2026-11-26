import { useMemo, useState } from "react";
import { assetsBaseUrl } from "../api/paths.js";
import type { GameController } from "../engine/GameController.js";
import { useGameStore } from "../store/gameStore.js";

export interface NeighborCardEntry {
  id: string;
  name: string;
  level: number;
  mapKey: string;
  isKing: boolean;
  avatarUrl?: string;
  badgeText?: string;
}

/**
 * Classic Social Empires 1.4.07 Friends & King strip (`GUI/FriendsWindow.as` +
 * `GUI/FriendButton.as` + `popups/PopOverVisit.as`), rendered seamlessly inside
 * the left section of the unified bottom cream parchment bar (1:1 with `image.png`).
 */
export function FriendsDock(props: { controller: GameController | null; onOpenGoals?: () => void }) {
  const locale = useGameStore((s) => s.locale);
  const resources = useGameStore((s) => s.resources);
  const activeSave = useGameStore((s) => s.activeSave);
  const savedEmpires = useGameStore((s) => s.savedEmpires);
  const playMode = useGameStore((s) => s.playMode);
  const visitingNeighbor = useGameStore((s) => s.visitingNeighbor);

  const [offset, setOffset] = useState(0);
  const [selectedCard, setSelectedCard] = useState<NeighborCardEntry | null>(null);

  const neighbors = useMemo<NeighborCardEntry[]>(() => {
    const lvl = resources.level;
    const kingMapKey = lvl <= 10 ? "Arthur30" : lvl <= 20 ? "Arthur31" : "Arthur32";
    const kingLevel = Math.max(10, Math.round(lvl * 1.2));
    const list: NeighborCardEntry[] = [
      {
        id: "king_arthur",
        name: locale === "es" ? "Arthur" : "King Arthur",
        level: kingLevel,
        mapKey: kingMapKey,
        isKing: true,
        avatarUrl: `${assetsBaseUrl()}/ui/images_new/thumbrey.jpg`,
        badgeText: locale === "es" ? "Vecino" : "King"
      },
      {
        id: "friend_acidcaos",
        name: "AcidCaos",
        level: 35,
        mapKey: "friend/AcidCaos",
        isKing: false,
        badgeText: locale === "es" ? "Imperio" : "Empire"
      }
    ];

    const activePid = activeSave?.playerInfo.pid;
    for (const emp of savedEmpires) {
      if (emp.pid === activePid) continue;
      list.push({
        id: `save_${emp.pid}`,
        name: emp.name,
        level: emp.level,
        mapKey: `save:${emp.pid}`,
        isKing: false,
        badgeText: locale === "es" ? "Vecino" : "Neighbor"
      });
    }
    return list;
  }, [resources.level, locale, activeSave?.playerInfo.pid, savedEmpires]);

  if (playMode !== "village" && playMode !== "visit") return null;

  const visibleCount = 5;
  const maxOffset = Math.max(0, neighbors.length - visibleCount);
  const clampedOffset = Math.min(offset, maxOffset);
  const visibleSlice = neighbors.slice(clampedOffset, clampedOffset + visibleCount);

  // Fill remaining slots up to 5 with classic "Agregar amigo" empty parchment cards
  const emptySlots = Math.max(0, 4 - visibleSlice.length);

  return (
    <div data-testid="friends-dock" className="relative flex h-full items-center gap-1.5 px-1">
      {/* Classic PopOverVisit anchored cleanly above selected friend/King */}
      {selectedCard && (
        <div
          data-testid="friend-visit-popover"
          className="se-ornate-frame absolute bottom-full left-4 mb-3 z-30 w-52 rounded-xl p-2.5 text-center shadow-2xl"
        >
          <div className="flex items-center justify-between gap-1 border-b border-[#d4a95a] pb-1">
            <span className="truncate text-xs font-black text-[#4a2204]">{selectedCard.name}</span>
            <button
              type="button"
              onClick={() => setSelectedCard(null)}
              className="sp-btn-red flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-black cursor-pointer"
            >
              ✕
            </button>
          </div>
          <div className="mt-1 text-[10px] font-bold text-[#7c4b1a]">
            {locale === "es" ? `Nivel ${selectedCard.level}` : `Level ${selectedCard.level}`} ·{" "}
            {selectedCard.isKing
              ? locale === "es"
                ? "Rey Arturo"
                : "King Arthur"
              : locale === "es"
                ? "Imperio Vecino"
                : "Neighbor Empire"}
          </div>
          <div className="mt-2 flex gap-1.5">
            <button
              type="button"
              data-testid="btn-visit-neighbor"
              onClick={() => {
                const target = selectedCard;
                setSelectedCard(null);
                void props.controller?.visitNeighbor({
                  id: target.id,
                  name: target.name,
                  level: target.level,
                  mapKey: target.mapKey,
                  isKing: target.isKing
                });
              }}
              className="sp-btn-green flex-1 rounded-lg py-1 text-[11px] font-black cursor-pointer"
            >
              {locale === "es" ? "Visitar" : "Visit"}
            </button>
          </div>
        </div>
      )}

      {/* Left Yellow Navigation Arrow */}
      <button
        type="button"
        disabled={clampedOffset <= 0}
        onClick={() => setOffset((o) => Math.max(0, o - 1))}
        aria-label={locale === "es" ? "Amigos anteriores" : "Previous friends"}
        className="flex h-14 w-5 shrink-0 items-center justify-center rounded-md border border-[#b47b19] bg-gradient-to-b from-[#fef08a] to-[#eab308] text-xs font-black text-[#5c2c06] shadow cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
      >
        ◀
      </button>

      {/* Vertical Cream Neighbor Cards (1:1 with `image.png`) */}
      <div className="flex items-center gap-1.5">
        {visibleSlice.map((card) => {
          const isVisitingThis = visitingNeighbor?.id === card.id;
          const isSelected = selectedCard?.id === card.id;
          return (
            <button
              key={card.id}
              type="button"
              data-testid={card.isKing ? "friend-card-king" : `friend-card-${card.id}`}
              onClick={() => setSelectedCard(isSelected ? null : card)}
              title={
                locale === "es"
                  ? `${card.name} (Nv.${card.level}) — Clic para visitar`
                  : `${card.name} (Lv.${card.level}) — Click to visit`
              }
              className={`relative flex h-[78px] w-[62px] flex-col items-center justify-between rounded-lg border-2 p-1 transition cursor-pointer shadow-sm ${
                isVisitingThis
                  ? "border-emerald-600 bg-emerald-50 ring-2 ring-emerald-400"
                  : card.isKing
                    ? "border-[#c98b1e] bg-gradient-to-b from-[#fffef7] to-[#f8e7b5] hover:border-[#9a5b08]"
                    : "border-[#a67638] bg-gradient-to-b from-[#fffdf7] to-[#efe0b8] hover:border-[#b45309]"
              }`}
            >
              {/* Name on top */}
              <span className="w-full truncate text-center text-[9px] font-black leading-none text-[#3d1f07]">
                {card.name}
              </span>

              {/* Portrait Frame + Golden Star Level Badge on top-right */}
              <div className="relative h-11 w-11 overflow-hidden rounded border border-[#b88635] bg-[#d9c79e]">
                {card.avatarUrl ? (
                  <img
                    src={card.avatarUrl}
                    alt={card.name}
                    className="h-full w-full object-cover"
                    draggable={false}
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-gradient-to-b from-[#6b4423] to-[#3b210e] text-xs font-black text-amber-200">
                    {card.name.slice(0, 2).toUpperCase()}
                  </div>
                )}
              </div>

              {/* Golden Star Level Badge */}
              <span className="absolute right-0.5 top-3.5 flex h-5 w-5 items-center justify-center rounded-full border border-[#78350f] bg-gradient-to-b from-[#fef08a] via-[#facc15] to-[#ca8a04] text-[8px] font-black text-[#3b1a04] shadow">
                {card.level}
              </span>

              {/* Footer Subtitle */}
              <span className="w-full truncate text-center text-[8px] font-extrabold leading-none text-[#784919]">
                {card.badgeText ?? (locale === "es" ? "Vecino" : "Neighbor")}
              </span>
            </button>
          );
        })}

        {/* Classic Empty Neighbor Slots */}
        {Array.from({ length: emptySlots }).map((_, idx) => (
          <div
            key={`empty-${idx}`}
            className="hidden sm:flex h-[78px] w-[62px] flex-col items-center justify-between rounded-lg border border-dashed border-[#c7a265] bg-[#f7ebd0]/65 p-1 opacity-75"
          >
            <span className="text-[8px] font-bold text-[#8a602e]">
              {locale === "es" ? "Vecino" : "Friend"}
            </span>
            <div className="flex h-10 w-10 items-center justify-center rounded border border-[#d4b680] bg-[#efe1be] text-lg font-black text-[#b58a48]">
              +
            </div>
            <span className="text-[7px] font-bold text-[#9a713c]">
              {locale === "es" ? "Libre" : "Open"}
            </span>
          </div>
        ))}
      </div>

      {/* Right Yellow Navigation Arrow */}
      <button
        type="button"
        disabled={clampedOffset >= maxOffset}
        onClick={() => setOffset((o) => Math.min(maxOffset, o + 1))}
        aria-label={locale === "es" ? "Siguientes amigos" : "Next friends"}
        className="flex h-14 w-5 shrink-0 items-center justify-center rounded-md border border-[#b47b19] bg-gradient-to-b from-[#fef08a] to-[#eab308] text-xs font-black text-[#5c2c06] shadow cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
      >
        ▶
      </button>
    </div>
  );
}
