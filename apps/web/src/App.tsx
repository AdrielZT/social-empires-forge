import { useState } from "react";
import type { Locale } from "@sef/shared-types";
import { getUiStrings } from "@sef/game-data";
import { RENDERER_ENGINE } from "@sef/engine-render";

export function App() {
  const [locale, setLocale] = useState<Locale>("es");
  const t = getUiStrings(locale);

  return (
    <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-b from-[#2f5b1a] to-[#1a330e] text-amber-50">
      <div className="rounded-2xl border-2 border-amber-500/60 bg-stone-900/85 px-8 py-6 shadow-2xl max-w-lg text-center">
        <h1 className="text-3xl font-black tracking-wide text-amber-300 drop-shadow">
          {t.appTitle}
        </h1>
        <p className="mt-2 text-sm text-amber-100/80">
          {t.loading} ({RENDERER_ENGINE})
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <button
            type="button"
            onClick={() => setLocale("es")}
            className={`px-3 py-1 rounded-lg text-xs font-bold cursor-pointer ${
              locale === "es" ? "bg-amber-500 text-stone-950" : "bg-stone-800 text-amber-200"
            }`}
          >
            ES
          </button>
          <button
            type="button"
            onClick={() => setLocale("en")}
            className={`px-3 py-1 rounded-lg text-xs font-bold cursor-pointer ${
              locale === "en" ? "bg-amber-500 text-stone-950" : "bg-stone-800 text-amber-200"
            }`}
          >
            EN
          </button>
        </div>
      </div>
    </div>
  );
}
