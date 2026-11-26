import type { ReactNode } from "react";

export function CornerRivets() {
  return (
    <>
      <span className="se-ruby-gem pointer-events-none absolute -left-1.5 -top-1.5 z-20" aria-hidden="true" />
      <span className="se-ruby-gem pointer-events-none absolute -right-1.5 -top-1.5 z-20" aria-hidden="true" />
      <span className="se-ruby-gem pointer-events-none absolute -bottom-1.5 -left-1.5 z-20" aria-hidden="true" />
      <span className="se-ruby-gem pointer-events-none absolute -bottom-1.5 -right-1.5 z-20" aria-hidden="true" />
    </>
  );
}

export function OrnateCornerGems() {
  return <CornerRivets />;
}

/**
 * Classic Socialpoint ornate gold-and-ruby modal frame matching Social Empires 1.4.07.
 * Supports both `"wood"` (default for legacy dark-text modals) and `"parchment"` (1:1 cream parchment).
 */
export function ClassicModalFrame(props: {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  maxWidthClass?: string;
  theme?: "wood" | "parchment";
  onClose: () => void;
  children: ReactNode;
}) {
  const isParchment = props.theme === "parchment";
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4 backdrop-blur-[1px]">
      <div
        className={`relative flex max-h-[88vh] w-full ${props.maxWidthClass ?? "max-w-4xl"} flex-col rounded-2xl ${
          isParchment ? "se-ornate-frame text-[#3a1f07]" : "sp-panel text-amber-50"
        }`}
      >
        <CornerRivets />
        <div
          className={`flex items-center justify-between rounded-t-xl px-5 py-2.5 ${
            isParchment ? "se-parchment-header" : "sp-header"
          }`}
        >
          <div className="flex items-center gap-3">
            {props.icon}
            <div>
              <h2
                className={`text-lg font-black tracking-tight ${
                  isParchment
                    ? "text-[#4a2204] drop-shadow-[0_1px_0_rgba(255,255,255,0.65)]"
                    : "text-amber-300 drop-shadow-[0_1px_1px_rgba(0,0,0,0.85)]"
                }`}
              >
                {props.title}
              </h2>
              {props.subtitle && (
                <p className={`text-xs ${isParchment ? "text-[#6b3c11] font-semibold" : "text-amber-100/80"}`}>
                  {props.subtitle}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            data-testid="modal-close"
            onClick={props.onClose}
            aria-label="Cerrar"
            className="sp-btn-red flex h-8 w-8 items-center justify-center rounded-full text-sm font-black cursor-pointer"
          >
            ✕
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-b-xl">{props.children}</div>
      </div>
    </div>
  );
}
