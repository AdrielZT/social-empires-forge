import { useEffect, useState } from "react";
import { SURVIVAL_BIOMES, type GameController } from "../engine/GameController.js";
import { gameApi } from "../api/gameApi.js";
import { useGameStore } from "../store/gameStore.js";
import { HudIcon, ResourceIcon } from "./GameIcons.js";

export function WorldMapModal(props: { controller: GameController | null }) {
  const locale = useGameStore((s) => s.locale);
  const availableMaps = useGameStore((s) => s.availableMaps);
  const expansions = useGameStore((s) => s.expansions);
  const activeSave = useGameStore((s) => s.activeSave);
  const savedEmpires = useGameStore((s) => s.savedEmpires);
  const setActiveModal = useGameStore((s) => s.setActiveModal);
  const refreshSavedEmpires = useGameStore((s) => s.refreshSavedEmpires);

  const [tab, setTab] = useState<"quests" | "survival" | "pvp" | "expansions" | "empires">("quests");
  const [newName, setNewName] = useState("");
  const [ranking, setRanking] = useState<{ pid: string; name: string; level: number; wins: number; losses: number }[]>([]);

  const questMaps = availableMaps.filter((m) => m.category === "quest" || m.key.startsWith("Arthur"));

  useEffect(() => {
    if (tab === "pvp") {
      void gameApi.fetchPvpRanking().then((rows) => setRanking(rows));
    }
  }, [tab]);

  const handleCreateEmpire = async () => {
    const created = await gameApi.createSave(newName.trim() || "Nuevo Imperio");
    if (created) {
      await refreshSavedEmpires();
      props.controller?.loadPersistentVillage(created);
      setNewName("");
      setActiveModal(null);
    }
  };

  const handleLoadEmpire = async (pid: string) => {
    const loaded = await gameApi.loadSave(pid);
    if (loaded) {
      props.controller?.loadPersistentVillage(loaded);
      setActiveModal(null);
    }
  };

  const handleImportSave = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const imported = await gameApi.importSave(text);
      if (imported) {
        await refreshSavedEmpires();
        props.controller?.loadPersistentVillage(imported);
        setActiveModal(null);
      }
    } catch {
      // Invalid save file
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/65 p-4">
      <div className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border-2 border-amber-500/85 bg-gradient-to-b from-[#392412] to-[#1e1209] shadow-2xl text-amber-50">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-amber-500/40 bg-[#2b190b] px-5 py-3">
          <div className="flex items-center gap-2.5">
            <HudIcon name="map" className="h-6 w-6" />
            <h2 className="text-lg font-black text-amber-300">
              {locale === "es" ? "Mapa Mundial, Campañas y Modos" : "World Map, Campaigns & Modes"}
            </h2>
          </div>
          <button
            type="button"
            onClick={() => setActiveModal(null)}
            className="rounded-lg bg-red-800/80 hover:bg-red-700 px-3 py-1 text-sm font-black cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Mode Tabs */}
        <div className="flex flex-wrap gap-1.5 border-b border-amber-500/30 bg-[#241509] px-4 py-2 text-xs font-extrabold">
          {(
            [
              ["quests", locale === "es" ? `Campañas (${questMaps.length})` : `Quests (${questMaps.length})`],
              ["survival", locale === "es" ? "Supervivencia (5)" : "Survival (5)"],
              ["pvp", locale === "es" ? "Asalto PvP" : "PvP Assault"],
              ["expansions", locale === "es" ? `Expansiones (${expansions.length}/25)` : `Expansions (${expansions.length}/25)`],
              ["empires", locale === "es" ? "Partidas (.save.json)" : "Saves (.save.json)"]
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`rounded-lg px-3 py-1.5 cursor-pointer ${
                tab === id ? "bg-amber-500 text-stone-950" : "bg-stone-800 text-amber-100 hover:bg-stone-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="overflow-y-auto p-4">
          {tab === "quests" && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
              {questMaps.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => void props.controller?.startBattleMap(m.key, "quest", m.label)}
                  className="flex flex-col items-start rounded-xl border border-amber-500/40 bg-stone-900/90 hover:bg-amber-700/30 p-3 text-left cursor-pointer"
                >
                  <span className="text-sm font-black text-amber-300">{m.label}</span>
                  <span className="mt-1 text-[11px] text-amber-100/70">
                    {locale === "es" ? "Desplegar ejército →" : "Deploy army →"}
                  </span>
                </button>
              ))}
            </div>
          )}

          {tab === "survival" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {SURVIVAL_BIOMES.map((arena) => (
                <button
                  key={arena.id}
                  type="button"
                  onClick={() => props.controller?.startSurvivalArena(arena.id)}
                  className="flex flex-col rounded-xl border border-rose-500/50 bg-stone-900/90 hover:bg-rose-950/60 p-4 text-left cursor-pointer"
                >
                  <span className="text-base font-black text-rose-300">
                    #{arena.id} {locale === "es" ? arena.nameEs : arena.nameEn}
                  </span>
                  <span className="mt-1 text-xs text-amber-100/75">
                    {locale === "es"
                      ? "Oleadas infinitas · Recompensas progresivas de Oro y XP"
                      : "Escalating waves · Progressive Gold & XP rewards"}
                  </span>
                </button>
              ))}
            </div>
          )}

          {tab === "pvp" && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/50 bg-stone-900/90 p-4">
                <div>
                  <h3 className="text-base font-black text-amber-300">
                    {locale === "es" ? "Asalto PvP Asíncrono Local" : "Local Asynchronous PvP Raid"}
                  </h3>
                  <p className="text-xs text-amber-100/75">
                    {locale === "es"
                      ? "Enfrenta tu ejército contra otros imperios locales o rivales clásicos (AcidCaos / Arthur) y gana honor y botín."
                      : "Deploy your army against other local empires or classic rivals (AcidCaos / Arthur) to earn honor & loot."}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    void props.controller?.startBattleMap("friend/AcidCaos", "pvp", locale === "es" ? "Asalto PvP" : "PvP Assault")
                  }
                  className="inline-flex items-center gap-1.5 rounded-xl bg-red-600 hover:bg-red-500 px-5 py-2.5 text-sm font-black text-white shadow cursor-pointer"
                >
                  <HudIcon name="sword" className="h-4 w-4" />
                  <span>{locale === "es" ? "Buscar Rival" : "Find Opponent"}</span>
                </button>
              </div>

              <div className="rounded-xl border border-amber-500/30 bg-stone-950/75 p-3">
                <h4 className="mb-2 text-xs font-black uppercase tracking-wide text-amber-300">
                  {locale === "es" ? "Ranking Local" : "Local Ranking"}
                </h4>
                <div className="space-y-1 text-xs">
                  {ranking.map((r, i) => (
                    <div key={r.pid} className="flex items-center justify-between rounded bg-stone-900 px-3 py-1.5">
                      <span className="font-bold">
                        #{i + 1} {r.name} (Nv. {r.level})
                      </span>
                      <span className="text-emerald-300 font-black">
                        {r.wins}W / {r.losses}L
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {tab === "expansions" && (
            <div className="flex flex-col items-center">
              <p className="mb-3 text-xs text-amber-100/80">
                {locale === "es"
                  ? "Matriz 5×5 del mundo (100×100 tiles). Haz clic en una expansión disponible para comprarla con Oro."
                  : "5×5 world matrix (100×100 tiles). Click an unowned expansion to buy it with Gold."}
              </p>
              <div className="grid grid-cols-5 gap-2">
                {Array.from({ length: 25 }, (_, i) => i + 1).map((expId) => {
                  const owned = expansions.includes(expId);
                  return (
                    <button
                      key={expId}
                      type="button"
                      disabled={owned}
                      onClick={() => void props.controller?.expandTerritory(expId, false)}
                      className={`flex flex-col items-center justify-center h-14 w-16 rounded-xl border text-xs font-black cursor-pointer ${
                        owned
                          ? "border-emerald-400 bg-emerald-700/50 text-emerald-100 cursor-default"
                          : "border-amber-500/50 bg-stone-900 hover:bg-amber-600/40 text-amber-200"
                      }`}
                    >
                      <span>#{expId}</span>
                      <span className="mt-0.5 flex items-center justify-center text-[10px] font-normal">
                        {owned ? (locale === "es" ? "Tuyo" : "Owned") : <ResourceIcon type="g" className="h-3.5 w-3.5" />}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {tab === "empires" && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/35 bg-stone-900/85 p-3">
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder={locale === "es" ? "Nombre del nuevo imperio..." : "New empire name..."}
                  className="flex-1 rounded-lg border border-amber-500/40 bg-stone-950 px-3 py-1.5 text-xs text-amber-50"
                />
                <button
                  type="button"
                  onClick={() => void handleCreateEmpire()}
                  className="rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3.5 py-1.5 text-xs font-black text-white cursor-pointer"
                >
                  + {locale === "es" ? "Crear Imperio" : "Create Empire"}
                </button>
                <label className="rounded-lg bg-sky-700 hover:bg-sky-600 px-3.5 py-1.5 text-xs font-black text-white cursor-pointer">
                  {locale === "es" ? "Importar .save.json" : "Import .save.json"}
                  <input type="file" accept=".json" onChange={(e) => void handleImportSave(e)} className="hidden" />
                </label>
                {activeSave && (
                  <button
                    type="button"
                    onClick={() => gameApi.exportSaveDownload(activeSave)}
                    className="rounded-lg bg-amber-600 hover:bg-amber-500 px-3.5 py-1.5 text-xs font-black text-stone-950 cursor-pointer"
                  >
                    {locale === "es" ? "Exportar .save.json" : "Export .save.json"}
                  </button>
                )}
              </div>

              <div className="space-y-1.5">
                {savedEmpires.map((emp) => {
                  const isCurrent = activeSave?.playerInfo.pid === emp.pid;
                  return (
                    <div
                      key={emp.pid}
                      className={`flex items-center justify-between rounded-xl border px-3.5 py-2.5 text-xs ${
                        isCurrent ? "border-amber-400 bg-amber-900/30" : "border-stone-700 bg-stone-900/80"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-black text-amber-200">{emp.name}</span>
                        <span className="flex items-center gap-1 text-amber-100/75">
                          · Nv.{emp.level} · <ResourceIcon type="g" className="h-3.5 w-3.5" />
                          {Math.floor(emp.coins).toLocaleString()} · <ResourceIcon type="c" className="h-3.5 w-3.5" />
                          {emp.cash}
                        </span>
                      </div>
                      {!isCurrent ? (
                        <button
                          type="button"
                          onClick={() => void handleLoadEmpire(emp.pid)}
                          className="rounded-lg bg-amber-500 hover:bg-amber-400 px-3 py-1 font-black text-stone-950 cursor-pointer"
                        >
                          {locale === "es" ? "Cargar" : "Load"}
                        </button>
                      ) : (
                        <span className="rounded bg-emerald-600/40 px-2 py-0.5 font-bold text-emerald-200">
                          {locale === "es" ? "Activo" : "Active"}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
