# Social Empires Forge

Migración moderna, modular y nativa a tecnologías web (60+ FPS, WebGL2/WebGPU) del juego clásico **Social Empires (versión 1.4.07)**, manteniendo intacta su esencia, arte, balance y mecánicas originales.

## Arquitectura del Monorepo

- `packages/shared-types` — Contratos TypeScript + esquemas Zod (configuración, partidas, comandos, eventos, coordenadas isométricas, i18n `es`/`en`).
- `packages/game-data` — Datos compilados y validados de Social Empires 1.4.07 (`items`, `globals`, `magics`, `goals`, `missions`, `collections`, `maps`, `quests`, localización bilingüe).
- `packages/engine-sim` — Motor de simulación puro y determinista (30 Hz fijos, cero dependencias DOM): grid `100×100`, expansiones `20×20`, economía, pathfinding A\*, combate RTS, 15 hechizos, IA, habilidades data-driven y modos de juego.
- `packages/engine-render` — Renderizador isométrico 60–144+ FPS con **PixiJS v8** (WebGPU/WebGL2), interpolación suave, frustum culling, depth sorting multi-tile y streaming LRU de Texture Atlases WebP.
- `packages/engine-audio` — Motor Web Audio API con pooling para los 35 SFX originales y crossfade para las 7 pistas musicales.
- `apps/web` — Cliente web responsive (**Vite + React 19 + Tailwind CSS v4 + Zustand**) con HUD y popups clásicos bilingües (`ES`/`EN`).
- `apps/server` — Backend local autoritativo (**Node.js 22 + Fastify + SQLite WAL**) con soporte de los 128 comandos clásicos, backups atómicos e importación/exportación `.save.json`.
- `tools/asset-pipeline` — Pipeline reproducible que sincroniza `AcidCaos/socialemperors@nerroth-rewrite` y compila localmente los sprites SWF a WebP Atlases + pivotes JSON + audio + referencia AS3.

## Arranque Rápido

```bash
pnpm install
pnpm assets:pipeline
pnpm dev
```

## Atribución y Preservación

Este proyecto utiliza los datos de configuración, mapas y assets preservados por la comunidad en [`AcidCaos/socialemperors`](https://github.com/AcidCaos/socialemperors) (rama `nerroth-rewrite`, licencia GNU GPLv3), con correcciones técnicas documentadas en los PRs comunitarios (#40 y #48). Social Empires es una creación original de Socialpoint (2011, discontinuado); este repositorio no redistribuye archivos `.swf` propietarios y está destinado exclusivamente a la preservación y ejecución local.
