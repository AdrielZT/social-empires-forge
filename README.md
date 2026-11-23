# Social Empires Forge

Migración nativa, moderna y desacoplada a tecnologías web (**60+ FPS**, WebGL2/WebGPU, TypeScript estricto) del juego clásico **Social Empires (versión 1.4.07)**, preservando intacta su esencia, arte original, animaciones, audio, balance y sistemas de juego.

## Características Implementadas

- **Renderizador Isométrico 60–144+ FPS (`@sef/engine-render`):** PixiJS v8 (WebGL2/WebGPU) con proyección fiel `108×54 px` verificada contra el AS3 original (`Config.as` / `IsoElement.as`), interpolación suave sobre simulación fija a 30 Hz, *frustum culling*, *depth sorting* multi-tile exacto, caché LRU de VRAM, los **8 biomas de terreno** y capa VFX (proyectiles parabólicos, rayos láser/dragón, explosiones de hechizos y textos flotantes).
- **Motor de Simulación Determinista (`@sef/engine-sim`):** Desacoplado del DOM (`FixedStepClock` a 30 Hz), grid `100×100` con 25 expansiones `20×20`, economía clásica, mercado dinámico, colas de entrenamiento, descuentos de Herrería/Universidad, pathfinding **A\*** con soporte de unidades voladoras, combate RTS, **los 15 Hechizos Mágicos**, y comportamiento data-driven de las **771 unidades** (extraído de las 1,924 clases AS3 descompiladas: 263 `IsoSpecialUnit`/`IsoLimitUnit`, 302 `Delegates`, 224 con Barra Limit).
- **Backend Local Autoritativo (`@sef/server`):** Node.js 22 + Fastify v5 + **SQLite en modo WAL** (`node:sqlite`), backups rotativos automáticos (máx. 30 cada 10 min), deduplicación idempotente de paquetes reintentados (PR #48), fixes de dimensiones 3×3 para *Soul Mixer* y *University* (PR #40), e **importación/exportación 100% compatible con `.save.json`** de `AcidCaos/socialemperors`.
- **Audio Clásico (`@sef/engine-audio`):** Web Audio API con *voice pooling* para los **35 SFX** extraídos de `120608_dynamic.swf` y *crossfade* para las **7 pistas musicales MP3**.
- **Interfaz Clásica Bilingüe (`ES` / `EN`) (`@sef/web`):** React 19 + Tailwind CSS v4 + Zustand con barra de recursos, Tienda de **1,786 ítems**, barra de 15 Magias, Mapa Mundial (**36 Campañas/Quests + Arthur 30–32**, **5 Arenas de Supervivencia**, **PvP Asíncrono + Ranking**, matriz 5×5 de expansiones), Hub de Sistemas (**206 Objetivos**, Mercado, Inventario, Cementerio/Héroes, Bono Diario, Dardos, 62 Colecciones) y Minimapa interactivo.

## Requisitos y Arranque Local

### Windows (Lanzador de doble clic — Recomendado)
1. Descarga o clona este repositorio (`git clone https://github.com/AdrielZT/social-empires-forge.git` o **Code -> Download ZIP**).
2. Haz doble clic en **`Jugar Social Empires.bat`**.
   - Verifica e instala **Node.js 22 LTS** / `pnpm` si hace falta, detecta automáticamente el paquete `social-empires-forge-assets-1.4.07.tar.gz` en tu carpeta `Descargas` (o abre tu Google Drive para descargarlo), compila la web una sola vez, arranca el servidor local y abre el juego en tu navegador automáticamente.

### Arranque manual (Windows / macOS / Linux)
- Node.js `>= 22`, `pnpm >= 9`, Python 3 (`Pillow`) y Java 21 (solo si regeneras assets localmente).

```bash
# 1. Instalar dependencias del monorepo
pnpm install

# 2. Ejecutar el pipeline reproducible de datos, audio, sprites WebP y comportamientos AS3
#    (Alternativa rápida: descomprimir `social-empires-forge-assets-1.4.07.tar.gz` en `assets/generated/`)
pnpm assets:pipeline

# 3. Opción A — Modo desarrollo (Hot Reload en http://127.0.0.1:5173)
pnpm dev

# 3. Opción B — Producción en un solo servidor (http://127.0.0.1:5050)
pnpm build
pnpm start
```

## Controles en Juego

- **Arrastrar clic izquierdo / `WASD` / Flechas:** Mover cámara.
- **Rueda del ratón / `+` `−`:** Zoom suave anclado al cursor.
- **Clic izquierdo:** Seleccionar edificio/unidad o colocar construcción/hechizo.
- **`Shift` + Arrastrar clic izquierdo:** Selección RTS por caja de escuadrón.
- **Clic derecho (con tropas/aldeanos seleccionados):** Mover al suelo, atacar enemigo o recolectar árboles/rocas/granjas. Cancelar colocación/hechizo.

## Comandos de Verificación y Respaldo

```bash
pnpm typecheck            # Validación TypeScript estricta en los 8 workspaces
pnpm test                 # Suite Vitest (geometría, simulación, 15 magias, SQLite y comandos)
pnpm assets:verify        # Verificación SHA-256 y cobertura 100% de assets
pnpm test:e2e             # Pruebas E2E reales en Chrome + capturas + telemetría FPS
pnpm assets:backup-drive  # Respaldo opcional del bundle compilado en Google Drive
```

## Atribución y Preservación

Basado en el proyecto de preservación comunitaria [`AcidCaos/socialemperors`](https://github.com/AcidCaos/socialemperors) (rama `nerroth-rewrite`, licencia GNU GPLv3), integrando los fixes técnicos de los PR #40 y #48. Social Empires es propiedad intelectual original de Socialpoint (2011, discontinuado). Este repositorio no redistribuye archivos `.swf` propietarios y está destinado exclusivamente a la preservación y ejecución local.
