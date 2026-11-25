import { useMemo } from "react";
import { assetsBaseUrl } from "../api/paths.js";
import { useGameStore } from "../store/gameStore.js";
import { CornerRivets } from "./ClassicFrame.js";
import { ItemThumb } from "./ItemThumb.js";
import { ResourceIcon } from "./GameIcons.js";

/**
 * Classic Social Empires 1.4.07 `PopupLevelUp` (`popups/PopupLevelUp.as:55-237`):
 * - Uses official externalized `PopupLevelUp/unit_left_1..6.png`, `unit_right_1..6.png`, `background.png`
 * - Displays achieved level, rank title, exact `levels.json` reward (+Mana from L36+),
 *   and newly unlocked store buildings & units for that level.
 */
export function LevelUpModal(props: { onOpenShop: () => void }) {
  const locale = useGameStore((s) => s.locale);
  const levelUpQueue = useGameStore((s) => s.levelUpQueue);
  const dismissLevelUp = useGameStore((s) => s.dismissLevelUp);
  const items = useGameStore((s) => s.items);
  const activeSave = useGameStore((s) => s.activeSave);

  const current = levelUpQueue[0] ?? null;
  const race = activeSave?.maps[0]?.race ?? "h";

  const unlockedItems = useMemo(() => {
    if (!current) return [];
    const matched = items.filter(
      (it) =>
        it.minLevel === current.level &&
        it.inStore &&
        !it.onlyMobile &&
        Boolean(it.imgName) &&
        (it.race === race || it.race === "a" || it.race === "n")
    );
    // Prioritize buildings first (matching PopupLevelUp.as), then units
    matched.sort((a, b) => {
      if (a.type !== b.type) return a.type === "b" ? -1 : 1;
      return a.displayOrder - b.displayOrder || a.id - b.id;
    });
    return matched.slice(0, 8);
  }, [current, items, race]);

  if (!current) return null;

  const base = assetsBaseUrl();
  const artTier = Math.max(1, Math.min(6, Math.ceil(current.level / 10)));
  const bgUrl = `${base}/ui/externalized/PopupLevelUp/background.png`;
  const leftUnitUrl = `${base}/ui/externalized/PopupLevelUp/unit_left_${artTier}.png`;
  const rightUnitUrl = `${base}/ui/externalized/PopupLevelUp/unit_right_${artTier}.png`;

  const rewardLabel =
    current.rewardType === "c"
      ? "Cash"
      : current.rewardType === "g"
        ? locale === "es"
          ? "Oro"
          : "Gold"
        : current.rewardType === "w"
          ? locale === "es"
            ? "Madera"
            : "Wood"
          : current.rewardType === "s"
            ? locale === "es"
              ? "Piedra"
              : "Stone"
            : locale === "es"
              ? "Comida"
              : "Food";

  return (
    <div
      data-testid="level-up-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-[2px]"
    >
      <div className="sp-panel relative w-full max-w-2xl overflow-hidden rounded-2xl border-2 border-amber-400/80 shadow-[0_24px_80px_rgba(0,0,0,0.85)]">
        <CornerRivets />

        {/* Classic celebratory banner with official PopupLevelUp art */}
        <div
          className="relative flex flex-col items-center justify-center px-6 pt-5 pb-4 text-center"
          style={{
            backgroundImage: `linear-gradient(to bottom, rgba(46,24,7,0.72), rgba(24,13,5,0.92)), url("${bgUrl}")`,
            backgroundSize: "cover",
            backgroundPosition: "center"
          }}
        >
          <img
            src={leftUnitUrl}
            alt=""
            className="pointer-events-none hidden sm:block absolute left-2 bottom-0 h-36 object-contain drop-shadow-[0_6px_12px_rgba(0,0,0,0.75)]"
          />
          <img
            src={rightUnitUrl}
            alt=""
            className="pointer-events-none hidden sm:block absolute right-2 bottom-0 h-36 object-contain drop-shadow-[0_6px_12px_rgba(0,0,0,0.75)]"
          />

          <div className="relative z-10 flex h-16 w-16 items-center justify-center rounded-full border-4 border-amber-300 bg-gradient-to-b from-amber-300 via-amber-500 to-amber-700 text-3xl font-black text-white shadow-[0_0_24px_rgba(250,204,21,0.65)]">
            {current.level}
          </div>

          <h2 className="relative z-10 mt-2 text-2xl font-black tracking-wide text-amber-300 drop-shadow-[0_2px_4px_rgba(0,0,0,0.95)]">
            {locale === "es" ? `¡SUBISTE AL NIVEL ${current.level}!` : `LEVEL ${current.level} REACHED!`}
          </h2>
          <p className="relative z-10 mt-0.5 text-sm font-extrabold text-amber-100">
            {locale === "es" ? `Nuevo Rango: ${current.rankName}` : `New Rank: ${current.rankName}`}
          </p>

          {/* Classic Level Reward Badges */}
          <div className="relative z-10 mt-3 flex flex-wrap items-center justify-center gap-2.5">
            {current.rewardAmount > 0 && (
              <div
                data-testid="level-up-reward"
                className="flex items-center gap-2 rounded-xl border-2 border-amber-400/80 bg-gradient-to-b from-amber-900/90 to-stone-950/95 px-4 py-1.5 shadow-lg"
              >
                <ResourceIcon type={current.rewardType || "c"} className="h-5 w-5" />
                <span className="text-sm font-black text-amber-200">
                  +{current.rewardAmount} {rewardLabel}
                </span>
              </div>
            )}
            {current.manaBonus > 0 && (
              <div className="flex items-center gap-2 rounded-xl border-2 border-sky-400/80 bg-gradient-to-b from-sky-900/90 to-slate-950/95 px-4 py-1.5 shadow-lg">
                <ResourceIcon type="mana" className="h-5 w-5" />
                <span className="text-sm font-black text-sky-200">
                  +{current.manaBonus} {locale === "es" ? "Maná" : "Mana"}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Newly Unlocked Buildings & Units Section */}
        <div className="bg-[#241307] px-5 py-4">
          <div className="text-center text-xs font-black uppercase tracking-wider text-amber-300/95">
            {locale === "es"
              ? `Nuevos edificios y unidades desbloqueados (${unlockedItems.length})`
              : `New Buildings & Units Unlocked (${unlockedItems.length})`}
          </div>

          {unlockedItems.length > 0 ? (
            <div
              data-testid="level-up-unlocked-grid"
              className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2.5 max-h-56 overflow-y-auto pr-1"
            >
              {unlockedItems.map((it) => (
                <div
                  key={it.id}
                  className="sp-card flex flex-col items-center rounded-xl p-2 text-center"
                >
                  <div className="sp-inset flex h-16 w-16 items-center justify-center overflow-hidden rounded-lg">
                    <ItemThumb
                      imgName={it.imgName}
                      alt={it.name}
                      itemType={it.type}
                      className="h-full w-full object-contain"
                    />
                  </div>
                  <div className="mt-1 line-clamp-1 text-[11px] font-black text-amber-200">{it.name}</div>
                  <div className="text-[10px] font-bold text-amber-100/70">
                    {it.type === "u"
                      ? locale === "es"
                        ? "Unidad"
                        : "Unit"
                      : locale === "es"
                        ? "Edificio"
                        : "Building"}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-center text-xs text-amber-100/75">
              {locale === "es"
                ? "¡Tu imperio se hace más fuerte! Sigue subiendo de nivel para desbloquear nuevos edificios y dragones."
                : "Your empire grows stronger! Keep leveling up to unlock more buildings and dragons."}
            </p>
          )}

          {/* Footer Actions */}
          <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
            {unlockedItems.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  dismissLevelUp();
                  props.onOpenShop();
                }}
                className="sp-btn-green rounded-xl px-5 py-2 text-xs font-black cursor-pointer"
              >
                {locale === "es" ? "Ver en la Tienda" : "View in Shop"}
              </button>
            )}
            <button
              type="button"
              data-testid="level-up-close"
              onClick={() => dismissLevelUp()}
              className="sp-btn-gold rounded-xl px-6 py-2 text-xs font-black cursor-pointer"
            >
              {levelUpQueue.length > 1
                ? locale === "es"
                  ? `Siguiente nivel (${levelUpQueue.length - 1} más)`
                  : `Next Level (${levelUpQueue.length - 1} more)`
                : locale === "es"
                  ? "¡Continuar!"
                  : "Continue!"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
