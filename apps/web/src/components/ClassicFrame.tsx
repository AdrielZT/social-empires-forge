import type { ReactNode } from "react";

export function CornerRivets() {
  return (
    <>
      <span className="sp-rivet pointer-events-none absolute left-1.5 top-1.5 z-10" aria-hidden="true" />
      <span className="sp-rivet pointer-events-none absolute right-1.5 top-1.5 z-10" aria-hidden="true" />
      <span className="sp-rivet pointer-events-none absolute bottom-1.5 left-1.5 z-10" aria-hidden="true" />
      <span className="sp-rivet pointer-events-none absolute bottom-1.5 right-1.5 z-10" aria-hidden="true" />
    </>
  );
}

/**
 * Classic Socialpoint wood-and-gold riveted popup frame matching Social Empires 1.4.07 modals.
 */
export function ClassicModalFrame(props: {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  maxWidthClass?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/65 p-4 backdrop-blur-[1px]">
      <div
        className={`sp-panel relative flex max-h-[86vh] w-full ${props.maxWidthClass ?? "max-w-4xl"} flex-col overflow-hidden rounded-2xl text-amber-50`}
      >
        <CornerRivets />
        <div className="sp-header flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            {props.icon}
            <div>
              <h2 className="text-lg font-black tracking-tight text-amber-300 drop-shadow-[0_1px_1px_rgba(0,0,0,0.85)]">
                {props.title}
              </h2>
              {props.subtitle && <p className="text-xs text-amber-100/80">{props.subtitle}</p>}
            </div>
          </div>
          <button
            type="button"
            data-testid="modal-close"
            onClick={props.onClose}
            aria-label="Cerrar"
            className="sp-btn-red flex h-8 w-8 items-center justify-center rounded-lg text-sm font-black cursor-pointer"
          >
            ✕
          </button>
        </div>
        {props.children}
      </div>
    </div>
  );
}
