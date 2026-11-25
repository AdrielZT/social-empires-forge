import { useMemo, useState } from "react";
import { ClassicModalFrame } from "./ClassicFrame.js";
import { ItemThumb } from "./ItemThumb.js";
import { ResourceIcon } from "./GameIcons.js";
import { useGameStore, type SpecialInteriorTarget } from "../store/gameStore.js";

const BAHAMUT_STEPS = [
  { idx: 0, labelEs: "Donar 100,000 Oro", labelEn: "Donate 100,000 Gold", cost: "100,000 g" },
  { idx: 1, labelEs: "Donar 100,000 Piedra", labelEn: "Donate 100,000 Stone", cost: "100,000 s" },
  { idx: 2, labelEs: "Donar 100,000 Madera", labelEn: "Donate 100,000 Wood", cost: "100,000 w" },
  { idx: 3, labelEs: "Donar 100,000 Comida", labelEn: "Donate 100,000 Food", cost: "100,000 f" },
  { idx: 4, labelEs: "Donar 50 Maná", labelEn: "Donate 50 Mana", cost: "50 m" },
  { idx: 5, labelEs: "Donar 50 Cash", labelEn: "Donate 50 Cash", cost: "50 c" },
  { idx: 6, labelEs: "Ofrenda del Dragón Rojo", labelEn: "Red Dragon Offering", cost: "Dragon" }
] as const;

/**
 * Generalized interactive interior modal for ALL `subcatFunctional = 139` buildings
 * plus `1529` Soul Mixer (`EP_SelfSoulMixer.as` / `PopupSoulMixer.as`) and `1394`
 * Supreme Bahamut Invocation Temple (`PopupBahamutSupremeInvocationTemple.as`).
 */
export function SpecialBuildingModal(props: {
  target: SpecialInteriorTarget;
  onSoulMixerMix: (u1: number, u2: number, resultId: number) => Promise<void>;
  onSoulMixerClaim: (speedUpCash?: number) => Promise<void>;
  onBahamutStep: (stepIdx: number) => Promise<void>;
  onBahamutClaim: () => Promise<void>;
  onOpenSystems: (tab: "goals" | "market" | "storage" | "graveyard" | "specials") => void;
  onChangeBiome: (biome: string) => void;
  onClose: () => void;
}) {
  const locale = useGameStore((s) => s.locale);
  const items = useGameStore((s) => s.items);
  const itemsById = useGameStore((s) => s.itemsById);
  const activeSave = useGameStore((s) => s.activeSave);
  const adminMode = useGameStore((s) => s.adminMode);
  const es = locale === "es";

  const [soul1, setSoul1] = useState<number>(508);
  const [soul2, setSoul2] = useState<number>(510);

  const ps = (activeSave?.privateState ?? {}) as Record<string, unknown>;
  const activeMix = ps.soulMixer as
    | { unit1: number; unit2: number; resultUnitId: number; startedAt: number; readyAt: number }
    | null
    | undefined;
  const bahamutSteps = Array.isArray(ps.bahamutTempleSteps)
    ? (ps.bahamutTempleSteps as number[])
    : [];

  const fusableUnits = useMemo(
    () => items.filter((i) => i.type === "u" && i.attack > 0 && i.life >= 120).slice(0, 48),
    [items]
  );

  const fusionResult = useMemo(() => {
    const pool = items.filter((i) => i.type === "u" && i.life >= 600 && i.attack >= 25);
    if (pool.length === 0) return itemsById.get(649) ?? fusableUnits[0];
    const hash = (soul1 * 31 + soul2 * 17) % pool.length;
    return pool[hash] ?? pool[0];
  }, [items, itemsById, fusableUnits, soul1, soul2]);

  // 1. SOUL MIXER (1529) — `PopupSoulMixer.as`
  if (props.target.itemId === 1529) {
    const nowSec = Math.floor(Date.now() / 1000);
    const remainingSec = activeMix ? Math.max(0, activeMix.readyAt - nowSec) : 0;
    const u1Def = itemsById.get(activeMix?.unit1 ?? soul1);
    const u2Def = itemsById.get(activeMix?.unit2 ?? soul2);
    const resDef = itemsById.get(activeMix?.resultUnitId ?? fusionResult?.id ?? 649);

    return (
      <ClassicModalFrame
        title={es ? "Mezclador de Almas" : "Soul Mixer"}
        subtitle={
          es
            ? "Fusiona dos almas de guerreros para crear una unidad legendaria."
            : "Fuse two warrior souls to forge a legendary unit."
        }
        maxWidthClass="max-w-3xl"
        onClose={props.onClose}
      >
        <div className="p-5 flex flex-col gap-4 overflow-y-auto">
          <div className="grid grid-cols-3 gap-4 items-center">
            {/* Soul Slot 1 */}
            <div className="sp-card rounded-xl p-3 flex flex-col items-center gap-2">
              <span className="text-xs font-bold uppercase text-amber-300">
                {es ? "Alma 1" : "Soul 1"}
              </span>
              {u1Def && <ItemThumb imgName={u1Def.imgName} alt={u1Def.name} itemType="u" className="h-16 w-16" />}
              <select
                disabled={Boolean(activeMix)}
                value={soul1}
                onChange={(e) => setSoul1(Number(e.target.value))}
                className="w-full rounded bg-stone-900 border border-amber-500/40 px-2 py-1 text-xs text-amber-100"
              >
                {fusableUnits.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} (HP {u.life})
                  </option>
                ))}
              </select>
            </div>

            {/* Result Preview */}
            <div className="sp-inset rounded-xl p-4 flex flex-col items-center gap-2 border-2 border-purple-400/60">
              <span className="text-xs font-black uppercase tracking-wider text-purple-300">
                {es ? "Resultado de Fusión" : "Fusion Result"}
              </span>
              {resDef && <ItemThumb imgName={resDef.imgName} alt={resDef.name} itemType="u" className="h-20 w-20" />}
              <div className="text-sm font-black text-amber-200 text-center">{resDef?.name ?? "Legend"}</div>
              {resDef && (
                <div className="text-[11px] text-amber-100/80">
                  HP {resDef.life} · ATK {resDef.attack}
                </div>
              )}
            </div>

            {/* Soul Slot 2 */}
            <div className="sp-card rounded-xl p-3 flex flex-col items-center gap-2">
              <span className="text-xs font-bold uppercase text-amber-300">
                {es ? "Alma 2" : "Soul 2"}
              </span>
              {u2Def && <ItemThumb imgName={u2Def.imgName} alt={u2Def.name} itemType="u" className="h-16 w-16" />}
              <select
                disabled={Boolean(activeMix)}
                value={soul2}
                onChange={(e) => setSoul2(Number(e.target.value))}
                className="w-full rounded bg-stone-900 border border-amber-500/40 px-2 py-1 text-xs text-amber-100"
              >
                {fusableUnits.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} (HP {u.life})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center justify-center gap-3 pt-2">
            {!activeMix ? (
              <button
                type="button"
                data-testid="soul-mixer-start"
                onClick={() => void props.onSoulMixerMix(soul1, soul2, resDef?.id ?? 649)}
                className="sp-btn-green rounded-xl px-6 py-2.5 text-sm font-black cursor-pointer"
              >
                {adminMode
                  ? es
                    ? "Fusionar Almas (Instantáneo Admin)"
                    : "Mix Souls (Instant Admin)"
                  : es
                    ? "Iniciar Mezcla de Almas (2m)"
                    : "Start Mixing Souls (2m)"}
              </button>
            ) : remainingSec > 0 ? (
              <div className="flex items-center gap-3">
                <span className="text-sm font-bold text-amber-200">
                  {es ? `Mezclando... ${remainingSec}s` : `Mixing... ${remainingSec}s`}
                </span>
                <button
                  type="button"
                  onClick={() => void props.onSoulMixerClaim(adminMode ? 0 : 2)}
                  className="sp-btn-gold rounded-xl px-5 py-2 text-sm font-black cursor-pointer flex items-center gap-1.5"
                >
                  <ResourceIcon type="cash" size={14} />
                  {adminMode
                    ? es
                      ? "Reclamar Ahora (Admin)"
                      : "Claim Now (Admin)"
                    : es
                      ? "Acelerar (2 Cash)"
                      : "Speed Up (2 Cash)"}
                </button>
              </div>
            ) : (
              <button
                type="button"
                data-testid="soul-mixer-claim"
                onClick={() => void props.onSoulMixerClaim(0)}
                className="sp-btn-gold rounded-xl px-6 py-2.5 text-sm font-black cursor-pointer"
              >
                {es ? "¡Reclamar Unidad Fusionada!" : "Claim Fused Unit!"}
              </button>
            )}
          </div>
        </div>
      </ClassicModalFrame>
    );
  }

  // 2. SUPREME BAHAMUT INVOCATION TEMPLE (1394) — `PopupBahamutSupremeInvocationTemple.as`
  if (props.target.itemId === 1394) {
    const bahamutDef = itemsById.get(749) ?? itemsById.get(739) ?? itemsById.get(649);
    const allDone = bahamutSteps.length >= BAHAMUT_STEPS.length;

    return (
      <ClassicModalFrame
        title={es ? "Templo de Invocación de Bahamut Supremo" : "Supreme Bahamut Invocation Temple"}
        subtitle={
          es
            ? "Completa los 7 rituales sagrados para invocar al Dragón Bahamut Supremo."
            : "Complete the 7 sacred rituals to summon the Supreme Bahamut Dragon."
        }
        maxWidthClass="max-w-3xl"
        onClose={props.onClose}
      >
        <div className="p-5 flex flex-col gap-4 overflow-y-auto">
          <div className="sp-inset rounded-xl p-4 flex items-center gap-4">
            {bahamutDef && <ItemThumb imgName={bahamutDef.imgName} alt={bahamutDef.name} itemType="u" className="h-20 w-20" />}
            <div className="flex-1">
              <div className="text-lg font-black text-amber-300">
                {bahamutDef?.name ?? "Bahamut Supreme"}
              </div>
              <div className="text-xs text-amber-100/80">
                HP {bahamutDef?.life ?? 5000} · ATK {bahamutDef?.attack ?? 200} ·{" "}
                {es ? `Progreso: ${bahamutSteps.length}/${BAHAMUT_STEPS.length}` : `Progress: ${bahamutSteps.length}/${BAHAMUT_STEPS.length}`}
              </div>
            </div>
            {(allDone || adminMode) && (
              <button
                type="button"
                data-testid="bahamut-claim"
                onClick={() => void props.onBahamutClaim()}
                className="sp-btn-gold rounded-xl px-4 py-2.5 text-xs font-black cursor-pointer"
              >
                {adminMode && !allDone
                  ? es
                    ? "Invocar Ahora (Admin)"
                    : "Summon Now (Admin)"
                  : es
                    ? "¡Invocar a Bahamut!"
                    : "Summon Bahamut!"}
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {BAHAMUT_STEPS.map((st) => {
              const done = bahamutSteps.includes(st.idx);
              return (
                <div
                  key={st.idx}
                  className={`sp-card rounded-xl px-3.5 py-2.5 flex items-center justify-between gap-2 ${
                    done ? "border-emerald-400/70 opacity-85" : ""
                  }`}
                >
                  <div>
                    <div className="text-xs font-black text-amber-200">
                      {st.idx + 1}. {es ? st.labelEs : st.labelEn}
                    </div>
                    <div className="text-[11px] text-amber-100/70">{st.cost}</div>
                  </div>
                  {done ? (
                    <span className="rounded-lg bg-emerald-600/80 px-2.5 py-1 text-[11px] font-black text-white">
                      ✓ {es ? "Listo" : "Done"}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void props.onBahamutStep(st.idx)}
                      className="sp-btn-green rounded-lg px-3 py-1 text-xs font-black cursor-pointer"
                    >
                      {adminMode ? (es ? "Completar (Admin)" : "Complete") : es ? "Donar" : "Donate"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </ClassicModalFrame>
    );
  }

  // 3. GENERALIZED `subcatFunctional = 139` BUILDINGS (Weather Machine, Wizardry, Time Machine, Allies Market, Round Table, Rider Academy, Dragon Taming, etc.)
  const isWeather = props.target.itemId === 373;
  const isAlliesMarket = props.target.itemId === 266 || props.target.itemId === 352;
  const bDef = itemsById.get(props.target.itemId);

  return (
    <ClassicModalFrame
      title={props.target.name}
      subtitle={
        es
          ? `Interior interactivo del edificio especial (#${props.target.itemId})`
          : `Interactive interior of special building (#${props.target.itemId})`
      }
      maxWidthClass="max-w-xl"
      onClose={props.onClose}
    >
      <div className="p-5 flex flex-col gap-4">
        <div className="sp-inset rounded-xl p-4 flex items-center gap-4">
          {bDef && <ItemThumb imgName={bDef.imgName} alt={bDef.name} itemType="b" className="h-18 w-18" />}
          <div>
            <div className="text-base font-black text-amber-300">{props.target.name}</div>
            <p className="text-xs text-amber-100/80 mt-1">
              {isWeather
                ? es
                  ? "Cambia el bioma y clima de tu reino al instante."
                  : "Change your kingdom's biome and weather instantly."
                : isAlliesMarket
                  ? es
                    ? "Intercambia recursos con aliados en el mercado del imperio."
                    : "Trade resources with allies in the empire market."
                  : es
                    ? "Edificio especial activo en tu reino. Gestiona sus funciones, almacén y bonificaciones desde aquí."
                    : "Active special building in your kingdom. Manage its functions, storage, and bonuses here."}
            </p>
          </div>
        </div>

        {isWeather ? (
          <div className="grid grid-cols-3 gap-2">
            {[
              { id: "terreno", label: es ? "Pradera" : "Grassland" },
              { id: "terrenodesierto", label: es ? "Desierto" : "Desert" },
              { id: "terrenohielo", label: es ? "Hielo" : "Ice" },
              { id: "terrenoselva", label: es ? "Selva" : "Jungle" },
              { id: "terrenomineral", label: es ? "Volcán" : "Volcano" },
              { id: "terrenonubes", label: es ? "Nubes" : "Clouds" }
            ].map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => {
                  props.onChangeBiome(b.id);
                  props.onClose();
                }}
                className="sp-btn-gold rounded-xl py-2 px-3 text-xs font-black cursor-pointer"
              >
                {b.label}
              </button>
            ))}
          </div>
        ) : (
          <div className="flex flex-wrap justify-end gap-2">
            {isAlliesMarket && (
              <button
                type="button"
                onClick={() => {
                  props.onClose();
                  props.onOpenSystems("market");
                }}
                className="sp-btn-gold rounded-xl px-4 py-2 text-xs font-black cursor-pointer"
              >
                {es ? "Abrir Mercado" : "Open Market"}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                props.onClose();
                props.onOpenSystems("specials");
              }}
              className="sp-btn-green rounded-xl px-4 py-2 text-xs font-black cursor-pointer"
            >
              {es ? "Ver Panel de Sistemas Especiales" : "Open Special Systems Panel"}
            </button>
          </div>
        )}
      </div>
    </ClassicModalFrame>
  );
}
