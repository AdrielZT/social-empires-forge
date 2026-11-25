import { useEffect, useState } from "react";
import {
  ACTIVATE_NEST_CASH,
  ACTIVATE_NEST_GOLD,
  DRAGON_NEST_HAS_EGG,
  DRAGON_NEST_IDS,
  DRAGON_STEP_CASH_BIG,
  DRAGON_STEP_CASH_SMALL,
  MONSTER_NEST_IDS,
  MONSTER_STEP_CASH,
  NEST_STEP_COOLDOWN_SEC,
  NEST_TOTAL_STEPS
} from "@sef/engine-sim";
import { assetsBaseUrl } from "../api/paths.js";
import type { GameController } from "../engine/GameController.js";
import { useGameStore } from "../store/gameStore.js";
import { ClassicModalFrame } from "./ClassicFrame.js";
import { ItemThumb } from "./ItemThumb.js";
import { ResourceIcon } from "./GameIcons.js";

function formatCountdown(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

/**
 * Classic Social Empires 1.4.07 interior modal for Dragon Breeding Nest (`1233`)
 * and Monsters Nest (`1255`), faithfully combining `PopupInactiveNest.as`,
 * `PopupDragons.as`, and `PopupMonstersNest.as`.
 */
export function NestModal(props: { controller: GameController | null }) {
  const locale = useGameStore((s) => s.locale);
  const target = useGameStore((s) => s.activeNestModal);
  const setTarget = useGameStore((s) => s.setActiveNestModal);
  const activeSave = useGameStore((s) => s.activeSave);
  const itemsById = useGameStore((s) => s.itemsById);
  const adminMode = useGameStore((s) => s.adminMode);

  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (!target) return;
    const id = window.setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(id);
  }, [target]);

  if (!target || !activeSave) return null;

  const isDragon = target.kind === "dragon";
  const priv = activeSave.privateState;
  const isActive = Number(isDragon ? priv.dragonNestActive : priv.monsterNestActive) === 1;
  const rosterIds = isDragon ? DRAGON_NEST_IDS : MONSTER_NEST_IDS;
  const currentIdx = Math.max(
    0,
    Math.min(rosterIds.length - 1, Number(isDragon ? priv.dragonNumber : priv.monsterNumber) || 0)
  );
  const stepNumber = Math.max(0, Number(isDragon ? priv.stepNumber : priv.stepMonsterNumber) || 0);
  const lastTs = Number(isDragon ? priv.timeStampTakeCare : priv.timeStampTakeCareMonster) || 0;
  const remainingSec = lastTs > 0 ? Math.max(0, NEST_STEP_COOLDOWN_SEC - (nowSec - lastTs)) : 0;

  const currentUnitId = rosterIds[currentIdx]!;
  const currentDef = itemsById.get(currentUnitId);
  const hasEgg = isDragon ? (DRAGON_NEST_HAS_EGG[currentIdx] ?? true) : false;
  const speedCashCost = isDragon ? (hasEgg ? DRAGON_STEP_CASH_SMALL : DRAGON_STEP_CASH_BIG) : MONSTER_STEP_CASH;
  const readyToHatch = stepNumber >= NEST_TOTAL_STEPS;
  const canDoFreeStep = !readyToHatch && (remainingSec <= 0 || adminMode);

  const iconUrl = `${assetsBaseUrl()}/ui/externalized/RecuadroInfo/dragonnest.png`;
  const title = isDragon
    ? locale === "es"
      ? "Nido de Dragones (1.4.07)"
      : "Dragon Breeding Nest (1.4.07)"
    : locale === "es"
      ? "Nido de Monstruos (1.4.07)"
      : "Monsters Nest (1.4.07)";

  const handleActivate = async (withCash: boolean) => {
    const cmd = isDragon ? "activate_dragon" : "activate_monster";
    await props.controller?.sendCommands([{ cmd, args: [withCash ? 1 : 0] }]);
  };

  const handleTakeCare = async () => {
    const cmd = isDragon ? "next_step_dragon" : "next_step_monster";
    await props.controller?.sendCommands([{ cmd, args: [] }]);
  };

  const handleBuyStep = async () => {
    const cmd = isDragon ? "buy_step_dragon" : "buy_step_monster";
    await props.controller?.sendCommands([{ cmd, args: [] }]);
  };

  const handleHatch = async () => {
    if (!props.controller) return;
    await props.controller.hatchNestCreature(target.kind, target.tx, target.ty);
  };

  return (
    <ClassicModalFrame
      title={title}
      subtitle={
        isDragon
          ? locale === "es"
            ? "Cría y entrena los 6 dragones clásicos de Social Empires 1.4.07"
            : "Breed and raise the 6 classic Social Empires 1.4.07 dragons"
          : locale === "es"
            ? "Cría y entrena los 4 monstruos legendarios del Nido"
            : "Breed and raise the 4 legendary Nest monsters"
      }
      icon={<img src={iconUrl} alt="" className="h-7 w-7 rounded object-contain" />}
      maxWidthClass="max-w-3xl"
      onClose={() => setTarget(null)}
    >
      <div data-testid="nest-modal-body" className="p-5">
        {!isActive ? (
          /* Canonical `PopupInactiveNest.as`: activate nest with 100k Gold or 50 Cash */
          <div className="sp-inset rounded-2xl p-6 text-center">
            <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-2xl border-2 border-amber-400/60 bg-stone-950/70">
              {currentDef ? (
                <ItemThumb imgName={currentDef.imgName} alt={currentDef.name} itemType="u" className="h-20 w-20 object-contain" />
              ) : (
                <img src={iconUrl} alt="" className="h-16 w-16 object-contain" />
              )}
            </div>
            <h3 className="mt-3 text-lg font-black text-amber-300">
              {locale === "es" ? "¡Activa el Nido para comenzar la cría!" : "Activate the Nest to start breeding!"}
            </h3>
            <p className="mt-1.5 text-xs text-amber-100/80 max-w-md mx-auto">
              {isDragon
                ? locale === "es"
                  ? "Al activar el Nido de Dragones podrás cuidar huevos y alimentar dragones en 10 pasos para desbloquear los 6 dragones legendarios directamente en tu imperio."
                  : "Activate the Dragon Nest to care for eggs and raise all 6 legendary dragons directly into your empire."
                : locale === "es"
                  ? "Activa el Nido de Monstruos para criar las 4 criaturas especiales en tu imperio."
                  : "Activate the Monsters Nest to raise all 4 special monsters in your empire."}
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                data-testid="nest-activate-gold"
                onClick={() => void handleActivate(false)}
                className="sp-btn-gold flex items-center gap-2 rounded-xl px-5 py-2.5 text-xs font-black cursor-pointer"
              >
                <ResourceIcon type="g" className="h-4 w-4" />
                <span>
                  {locale === "es" ? "Activar" : "Activate"} ({ACTIVATE_NEST_GOLD.toLocaleString()})
                </span>
              </button>
              <button
                type="button"
                data-testid="nest-activate-cash"
                onClick={() => void handleActivate(true)}
                className="sp-btn-green flex items-center gap-2 rounded-xl px-5 py-2.5 text-xs font-black cursor-pointer"
              >
                <ResourceIcon type="c" className="h-4 w-4" />
                <span>
                  {locale === "es" ? "Activar" : "Activate"} ({ACTIVATE_NEST_CASH} Cash)
                </span>
              </button>
            </div>
            {adminMode && (
              <p className="mt-3 text-[11px] font-bold text-purple-300">
                {locale === "es"
                  ? "Modo Admin activo: puedes activar y probar el ciclo completo libremente."
                  : "Admin Mode active: you can activate and test the full cycle freely."}
              </p>
            )}
          </div>
        ) : (
          /* Canonical `PopupDragons.as` / `PopupMonstersNest.as` active breeding UI */
          <div className="space-y-4">
            {/* Roster strip */}
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {rosterIds.map((uid, idx) => {
                const uDef = itemsById.get(uid);
                const done = idx < currentIdx;
                const active = idx === currentIdx;
                return (
                  <div
                    key={uid}
                    className={`flex flex-col items-center rounded-xl border p-2 text-center ${
                      active
                        ? "border-amber-400 bg-amber-900/45 shadow-[0_0_16px_rgba(250,204,21,0.3)]"
                        : done
                          ? "border-emerald-500/60 bg-emerald-950/40 opacity-85"
                          : "border-amber-900/50 bg-stone-950/60 opacity-60"
                    }`}
                  >
                    <div className="relative flex h-12 w-12 items-center justify-center overflow-hidden rounded-lg bg-black/40">
                      {uDef && (
                        <ItemThumb imgName={uDef.imgName} alt={uDef.name} itemType="u" className="h-full w-full object-contain" />
                      )}
                      {done && (
                        <span className="absolute inset-0 flex items-center justify-center bg-emerald-950/65 text-base font-black text-emerald-300">
                          ✓
                        </span>
                      )}
                    </div>
                    <span className="mt-1 line-clamp-1 text-[10px] font-bold text-amber-100">
                      {uDef?.name ?? `#${uid}`}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Active Creature Showcase & Progress */}
            <div className="sp-inset flex flex-col sm:flex-row items-center gap-5 rounded-2xl p-4">
              <div className="flex h-32 w-32 shrink-0 items-center justify-center rounded-2xl border-2 border-amber-400/70 bg-gradient-to-b from-amber-950/70 to-stone-950">
                {currentDef && (
                  <ItemThumb
                    imgName={currentDef.imgName}
                    alt={currentDef.name}
                    itemType="u"
                    className="h-28 w-28 object-contain"
                  />
                )}
              </div>

              <div className="flex-1 w-full">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-base font-black text-amber-300">
                    {currentDef?.name ?? `#${currentUnitId}`}
                  </h3>
                  <span className="rounded-lg bg-amber-950/80 border border-amber-500/40 px-2 py-0.5 text-[11px] font-black text-amber-200">
                    {isDragon
                      ? hasEgg
                        ? locale === "es"
                          ? "Etapa: Cuidar Huevo"
                          : "Stage: Care for Egg"
                        : locale === "es"
                          ? "Etapa: Alimentar Cría"
                          : "Stage: Feed Dragon"
                      : locale === "es"
                        ? "Etapa: Entrenar Monstruo"
                        : "Stage: Train Monster"}
                  </span>
                </div>

                {currentDef && (
                  <div className="mt-1 flex flex-wrap gap-3 text-[11px] font-bold text-amber-100/80">
                    <span>HP {currentDef.life}</span>
                    <span>ATK {currentDef.attack}</span>
                    <span>DEF {currentDef.defense}</span>
                    <span>RNG {currentDef.attackRange}</span>
                  </div>
                )}

                {/* 10-step progress bar */}
                <div className="mt-3">
                  <div className="flex items-center justify-between text-xs font-extrabold text-amber-200">
                    <span>{locale === "es" ? "Progreso de cría" : "Breeding Progress"}</span>
                    <span>
                      {stepNumber} / {NEST_TOTAL_STEPS}
                    </span>
                  </div>
                  <div className="mt-1 h-4 w-full overflow-hidden rounded-full border border-amber-400/60 bg-stone-950">
                    <div
                      className="h-full bg-gradient-to-r from-amber-500 via-yellow-400 to-emerald-400 transition-all"
                      style={{ width: `${Math.min(100, (stepNumber / NEST_TOTAL_STEPS) * 100)}%` }}
                    />
                  </div>
                </div>

                {/* Action buttons */}
                <div className="mt-4 flex flex-wrap items-center gap-2.5">
                  {readyToHatch ? (
                    <button
                      type="button"
                      data-testid="nest-hatch-btn"
                      onClick={() => void handleHatch()}
                      className="sp-btn-gold flex items-center gap-2 rounded-xl px-5 py-2 text-xs font-black cursor-pointer animate-pulse"
                    >
                      <span>
                        {locale === "es"
                          ? `¡Recoger ${currentDef?.name ?? "Criatura"}!`
                          : `Claim ${currentDef?.name ?? "Creature"}!`}
                      </span>
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        data-testid="nest-care-btn"
                        disabled={!canDoFreeStep}
                        onClick={() => void handleTakeCare()}
                        className={`rounded-xl px-4 py-2 text-xs font-black ${
                          canDoFreeStep
                            ? "sp-btn-green cursor-pointer"
                            : "bg-stone-800 text-stone-400 border border-stone-700 cursor-not-allowed"
                        }`}
                      >
                        {canDoFreeStep
                          ? hasEgg
                            ? locale === "es"
                              ? "Cuidar Huevo (+1 paso)"
                              : "Care for Egg (+1 step)"
                            : locale === "es"
                              ? "Alimentar (+1 paso)"
                              : "Feed (+1 step)"
                          : `${locale === "es" ? "Espera" : "Wait"} ${formatCountdown(remainingSec)}`}
                      </button>

                      <button
                        type="button"
                        data-testid="nest-speedup-btn"
                        onClick={() => void handleBuyStep()}
                        className="sp-btn-gold flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-black cursor-pointer"
                      >
                        <ResourceIcon type="c" className="h-3.5 w-3.5" />
                        <span>
                          {locale === "es" ? "Acelerar" : "Speed Up"} ({speedCashCost} Cash)
                        </span>
                      </button>

                      {adminMode && (
                        <button
                          type="button"
                          onClick={() => void handleHatch()}
                          className="rounded-xl border border-purple-400/70 bg-purple-900/70 hover:bg-purple-800 px-3 py-2 text-xs font-black text-purple-100 cursor-pointer"
                        >
                          {locale === "es" ? "👑 Admin: Eclosionar ya" : "👑 Admin: Hatch Now"}
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </ClassicModalFrame>
  );
}
