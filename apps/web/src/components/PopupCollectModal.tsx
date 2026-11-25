import { COLLECT_MINUTES, computeProducerYield } from "@sef/engine-sim";
import { assetsBaseUrl } from "../api/paths.js";
import type { GameController } from "../engine/GameController.js";
import { useGameStore } from "../store/gameStore.js";
import { ClassicModalFrame } from "./ClassicFrame.js";
import { ResourceIcon } from "./GameIcons.js";

function formatDuration(minutes: number, locale: "es" | "en"): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.round(minutes / 60);
  return locale === "es" ? `${h} h` : `${h} hr`;
}

/**
 * Classic Social Empires 1.4.07 `PopupCollect` (`popups/PopupCollect.as`) for variable-time
 * producer buildings (Gold Mines, Stone Mines, Lumber Mills, Windmills) when villagers are inside.
 */
export function PopupCollectModal(props: { controller: GameController | null }) {
  const locale = useGameStore((s) => s.locale);
  const target = useGameStore((s) => s.collectPickerTarget);
  const setTarget = useGameStore((s) => s.setCollectPickerTarget);

  if (!target) return null;

  const resChar =
    target.collectType === "w" || target.collectType === "s" || target.collectType === "f"
      ? target.collectType
      : "g";
  const base = assetsBaseUrl();

  const handleChoose = async (cpIndex: number) => {
    if (!props.controller) return;
    await props.controller.activateProducerJob(target.uid, target.tx, target.ty, target.itemId, cpIndex);
    setTarget(null);
  };

  return (
    <ClassicModalFrame
      title={target.name}
      subtitle={
        locale === "es"
          ? `Elige el tiempo de trabajo (${target.workerCount} ${target.workerCount === 1 ? "aldeano dentro" : "aldeanos dentro · +20% extra c/u"})`
          : `Choose production duration (${target.workerCount} ${target.workerCount === 1 ? "villager inside" : "villagers inside · +20% each extra"})`
      }
      icon={<ResourceIcon type={resChar} className="h-6 w-6" />}
      maxWidthClass="max-w-2xl"
      onClose={() => setTarget(null)}
    >
      <div data-testid="popup-collect-modal" className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4">
        {COLLECT_MINUTES.map((mins, idx) => {
          const cpIndex = idx + 1;
          const amount = computeProducerYield(target.baseCollect, target.workerCount, cpIndex);
          const imgUrl = `${base}/ui/images_new/collect_${resChar}${idx}.jpg`;
          return (
            <button
              key={cpIndex}
              type="button"
              data-testid={`collect-option-${cpIndex}`}
              onClick={() => void handleChoose(cpIndex)}
              className="sp-card group flex flex-col items-center rounded-xl p-3 text-center transition hover:scale-[1.02] cursor-pointer"
            >
              <div className="sp-inset h-24 w-24 overflow-hidden rounded-lg">
                <img
                  src={imgUrl}
                  alt={formatDuration(mins, locale)}
                  className="h-full w-full object-cover group-hover:scale-105 transition"
                />
              </div>
              <div className="mt-2 text-xs font-black text-amber-200">{formatDuration(mins, locale)}</div>
              <div className="sp-btn-gold mt-1.5 flex w-full items-center justify-center gap-1 rounded-lg py-1 text-xs font-black">
                <ResourceIcon type={resChar} className="h-3.5 w-3.5" />
                <span>+{amount.toLocaleString()}</span>
              </div>
            </button>
          );
        })}
      </div>
    </ClassicModalFrame>
  );
}
