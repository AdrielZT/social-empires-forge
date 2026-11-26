import { ClassicModalFrame } from "./ClassicFrame.js";
import { ResourceIcon } from "./GameIcons.js";
import { useGameStore } from "../store/gameStore.js";

/**
 * Canonical `PopupExpand.as`: triggered when clicking any "EN VENTA" locked expansion
 * quadrant on the map. Uses `expansion_prices` scaling and persists via `expand` command.
 */
export function PopupExpandModal(props: {
  expId: number;
  onExpand: (expId: number, withCash: boolean) => Promise<void>;
  onClose: () => void;
}) {
  const locale = useGameStore((s) => s.locale);
  const resources = useGameStore((s) => s.resources);
  const expansions = useGameStore((s) => s.expansions);
  const adminMode = useGameStore((s) => s.adminMode);
  const es = locale === "es";

  const ownedCount = Math.max(1, expansions.length);
  const goldCost = adminMode ? 0 : Math.min(250000, 1500 * ownedCount * ownedCount);
  const cashCost = adminMode ? 0 : Math.min(50, Math.max(2, ownedCount * 2));
  const canAffordGold = adminMode || resources.coins >= goldCost;
  const canAffordCash = adminMode || resources.cash >= cashCost;

  return (
    <ClassicModalFrame
      theme="parchment"
      title={es ? `Expandir Territorio (#${props.expId})` : `Expand Territory (#${props.expId})`}
      subtitle={
        es
          ? "Desbloquea 20×20 casillas nuevas para construir y expandir tu imperio."
          : "Unlock a new 20×20 tile quadrant to build and grow your empire."
      }
      maxWidthClass="max-w-md"
      onClose={props.onClose}
    >
      <div className="p-5 flex flex-col gap-4">
        <div className="se-parchment-card rounded-xl p-4 text-center">
          <div className="text-xs uppercase tracking-wider text-[#8c5212] font-black mb-1">
            {es ? "Cuadrante de Terreno" : "Terrain Quadrant"} #{props.expId}
          </div>
          <p className="text-sm font-semibold text-[#4a2204]">
            {es
              ? `Actualmente posees ${ownedCount} / 25 territorios. Compra este terreno para reclamar sus recursos y derrotar a los enemigos.`
              : `You currently own ${ownedCount} / 25 territories. Buy this land to claim its resources and clear enemy camps.`}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            disabled={!canAffordGold}
            onClick={() => {
              void props.onExpand(props.expId, false).then(() => props.onClose());
            }}
            className={`sp-btn-gold flex flex-col items-center justify-center gap-1 rounded-xl py-3 px-3 font-black cursor-pointer ${
              !canAffordGold ? "opacity-50 cursor-not-allowed" : ""
            }`}
          >
            <span className="text-xs uppercase tracking-wide">
              {es ? "Comprar con Oro" : "Buy with Gold"}
            </span>
            <span className="flex items-center gap-1.5 text-base">
              <ResourceIcon type="gold" size={16} />
              {adminMode ? (es ? "GRATIS" : "FREE") : goldCost.toLocaleString()}
            </span>
          </button>

          <button
            type="button"
            disabled={!canAffordCash}
            onClick={() => {
              void props.onExpand(props.expId, true).then(() => props.onClose());
            }}
            className={`sp-btn-green flex flex-col items-center justify-center gap-1 rounded-xl py-3 px-3 font-black cursor-pointer ${
              !canAffordCash ? "opacity-50 cursor-not-allowed" : ""
            }`}
          >
            <span className="text-xs uppercase tracking-wide">
              {es ? "Comprar con Cash" : "Buy with Cash"}
            </span>
            <span className="flex items-center gap-1.5 text-base">
              <ResourceIcon type="cash" size={16} />
              {adminMode ? (es ? "GRATIS" : "FREE") : cashCost.toLocaleString()}
            </span>
          </button>
        </div>
      </div>
    </ClassicModalFrame>
  );
}
