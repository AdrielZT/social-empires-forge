import { useMemo, useState } from "react";
import { assetsBaseUrl } from "../api/paths.js";
import type { GameController } from "../engine/GameController.js";
import { useGameStore } from "../store/gameStore.js";
import { CornerRivets } from "./ClassicFrame.js";

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
 * Classic Social Empires 1.4.07 bottom Friends & King strip (`GUI/FriendsWindow.as` +
 * `GUI/FriendButton.as` + `popups/PopOverVisit.as`).
 * Always includes King Arthur (`Arthur30`/`Arthur31`/`Arthur32` by player level + `thumbrey.jpg`),
 * classic neighbor `AcidCaos`, and other locally saved empires — WITHOUT triggering any tutorial.
 */
export function FriendsDock(props: { controller: GameController | null }) {
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
        name: locale === "es" ? "El Rey" : "King Arthur",
        level: kingLevel,
        mapKey: kingMapKey,
        isKing: true,
        avatarUrl: `${assetsBaseUrl()}/ui/images_new/thumbrey.jpg`,
        badgeText: locale === "es" ? "REY" : "KING"
      },
      {
        id: "friend_acidcaos",
        name: "AcidCaos",
        level: 35,
        mapKey: "friend/AcidCaos",
        isKing: false
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
        isKing: false
      });
    }
    return list;
  }, [resources.level, locale, activeSave?.playerInfo.pid, savedEmpires]);

  if (playMode !== "village" && playMode !== "visit") return null;

  const visibleCount = 4;
  const maxOffset = Math.max(0, neighbors.length - visibleCount);
  const clampedOffset = Math.min(offset, maxOffset);
  const visibleSlice = neighbors.slice(clampedOffset, clampedOffset + visibleCount);

  return (
    <div
      data-testid="friends-dock"
      className="sp-panel pointer-events-auto relative flex items-center gap-1 rounded-2xl px-2 py-1.5"
    >
      <CornerRivets />

      {/* Classic PopOverVisit anchored above selected friend/King */}
      {selectedCard && (
        <div
          data-testid="friend-visit-popover"
          className="sp-panel absolute bottom-full left-2 mb-2 z-30 w-52 rounded-xl border border-amber-400/75 p-2.5 text-center shadow-2xl"
        >
          <div className="flex items-center justify-between gap-1">
            <span className="truncate text-xs font-black text-amber-300">{selectedCard.name}</span>
            <button
              type="button"
              onClick={() => setSelectedCard(null)}
              className="sp-btn-red flex h-4 w-4 items-center justify-center rounded text-[9px] font-black cursor-pointer"
            >
              ✕
            </button>
          </div>
          <div className="mt-0.5 text-[10px] font-bold text-amber-100/80">
            {locale === "es" ? `Nivel ${selectedCard.level}` : `Level ${selectedCard.level}`}
            {selectedCard.isKing ? (locale === "es" ? " · Reino Real" : " · Royal Empire") : ""}
          </div>
          <button
            type="button"
            data-testid="btn-visit-neighbor"
            onClick={() => {
              const card = selectedCard;
              setSelectedCard(null);
              void props.controller?.visitNeighbor({
                id: card.id,
                name: card.name,
                level: card.level,
                mapKey: card.mapKey,
                isKing: card.isKing
              });
            }}
            className="sp-btn-gold mt-2 w-full rounded-lg py-1.5 text-xs font-black cursor-pointer"
          >
            {locale === "es" ? "Visitar Imperio" : "Visit Empire"}
          </button>
        </div>
      )}

      {/* Left scroll arrow */}
      <button
        type="button"
        disabled={clampedOffset <= 0}
        onClick={() => setOffset(Math.max(0, clampedOffset - 1))}
        className={`sp-btn-stone flex h-11 w-5 items-center justify-center rounded-lg text-[10px] font-black ${
          clampedOffset <= 0 ? "opacity-40 cursor-not-allowed" : "cursor-pointer"
        }`}
        title={locale === "es" ? "Amigos anteriores" : "Previous friends"}
      >
        ◀
      </button>

      {/* Friend & King cards */}
      <div className="flex items-center gap-1.5">
        {visibleSlice.map((entry) => {
          const isCurrentVisit = visitingNeighbor?.id === entry.id;
          return (
            <button
              key={entry.id}
              type="button"
              data-testid={entry.isKing ? "friend-card-king" : `friend-card-${entry.id}`}
              onClick={() => setSelectedCard(selectedCard?.id === entry.id ? null : entry)}
              className={`relative flex w-14 flex-col items-center rounded-xl border p-1 transition cursor-pointer ${
                isCurrentVisit
                  ? "border-emerald-400 bg-emerald-950/80"
                  : entry.isKing
                    ? "border-amber-400/80 bg-gradient-to-b from-amber-900/80 to-stone-950 hover:border-amber-300"
                    : "border-amber-600/50 bg-[#2d1a0b] hover:border-amber-400"
              }`}
              title={`${entry.name} (Nv. ${entry.level})`}
            >
              <div className="relative h-8 w-8 overflow-hidden rounded-lg border border-amber-400/60 bg-stone-900 flex items-center justify-center">
                {entry.avatarUrl ? (
                  <img src={entry.avatarUrl} alt={entry.name} className="h-full w-full object-cover" />
                ) : (
                  <span className="text-xs font-black text-amber-300">
                    {entry.name.slice(0, 2).toUpperCase()}
                  </span>
                )}
              </div>
              <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full border border-amber-200 bg-amber-500 px-0.5 text-[9px] font-black text-stone-950 shadow">
                {entry.level}
              </span>
              <span className="mt-0.5 w-full truncate text-center text-[9px] font-extrabold text-amber-100 leading-tight">
                {entry.name}
              </span>
            </button>
          );
        })}

        {/* Classic Add Neighbor slot (fills up to 3 cards minimum) */}
        {visibleSlice.length < 3 && (
          <button
            type="button"
            onClick={() => {
              useGameStore.getState().setActiveModal("worldMap");
            }}
            className="flex h-[54px] w-14 flex-col items-center justify-center rounded-xl border border-dashed border-amber-500/45 bg-stone-950/45 px-1 text-center text-[9px] font-bold text-amber-300/80 hover:border-amber-400 cursor-pointer"
            title={locale === "es" ? "Crear o importar más imperios vecinos" : "Create or import more neighbor empires"}
          >
            <span className="text-sm leading-none">+</span>
            <span className="mt-0.5 leading-tight">{locale === "es" ? "Vecino" : "Add"}</span>
          </button>
        )}
      </div>

      {/* Right scroll arrow */}
      <button
        type="button"
        disabled={clampedOffset >= maxOffset}
        onClick={() => setOffset(Math.min(maxOffset, clampedOffset + 1))}
        className={`sp-btn-stone flex h-11 w-5 items-center justify-center rounded-lg text-[10px] font-black ${
          clampedOffset >= maxOffset ? "opacity-40 cursor-not-allowed" : "cursor-pointer"
        }`}
        title={locale === "es" ? "Más amigos" : "More friends"}
      >
        ▶
      </button>
    </div>
  );
}
