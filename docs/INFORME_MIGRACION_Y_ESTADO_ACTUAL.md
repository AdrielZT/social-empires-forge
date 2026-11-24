# Social Empires Forge — Informe Técnico de Migración y Estado Actual

**Fecha:** 24 de Noviembre de 2026  
**Repositorio GitHub:** [`AdrielZT/social-empires-forge`](https://github.com/AdrielZT/social-empires-forge) (Rama `main`, Commit `246be0d`)  
**Despliegue Online en Vivo ($0 USD):** [https://adrielzt.github.io/social-empires-forge/](https://adrielzt.github.io/social-empires-forge/)  
**Lanzador Local Windows:** `Jugar Social Empires.bat` + `scripts/launch-windows.ps1` (Fastify + SQLite WAL)  
**Versión Objetivo Preservada:** **Social Empires v1.4.07** (Canónico: `AcidCaos/socialemperors@nerroth-rewrite`, commit `54df29e`)  

---

## 1. Resumen Ejecutivo de lo Realizado

En esta primera etapa se completó la migración estructural integral de **Social Empires (1.4.07)** desde el repositorio de preservación comunitario hacia una arquitectura web moderna, desacoplada, 100 % tipada en TypeScript y libre de la dependencia de Flash Player o emuladores lentos.

### Hitos Técnicos Principales Logrados:
1. **Pipeline de Assets Automatizado y Reproducible (`tools/asset-pipeline`):**
   - Extracción de **1,588 sprites** (1,547 híbridos bitmap + 41 vectoriales renderizados con JPEXS FFDec).
   - Generación de Texture Atlases WebP óptimos con metadatos JSON y pivotes isométricos.
   - Extracción de **8 biomas de terreno**, **35 efectos de sonido SFX** y **7 pistas de música oficiales**.
   - Descompilación completa de **1,924 clases de ActionScript 3 (AS3)** para servir como especificación canónica 1:1 del comportamiento del juego.
   - Respaldo del paquete compilado en Google Drive: `social-empires-forge-assets-1.4.07.tar.gz` (720.8 MB).
2. **Arquitectura Modular en Monorepo (`pnpm`):**
   - `@sef/shared-types`: Tipos TypeScript y esquemas Zod para mapas, ítems y paquetes de comandos.
   - `@sef/game-data`: 1,587 ítems, 206 objetivos (goals), 228 misiones, 15 magias, 62 colecciones, 100 niveles, 42 mapas indexados, tablas de precios y localización (`en` / `es`).
   - `@sef/engine-sim`: Motor determinista headless con reloj de paso fijo a 30 Hz (`FixedStepClock`), grid de ocupación 100×100 (`OccupancyGrid`), pathfinding A* multi-hilo, simulación de combate (`BattleEngine`), proyectiles, estados alterados y ejecución autoritativa de los 128 comandos de Social Empires (`applyCommand`). Zero dependencias de DOM/Node.
   - `@sef/engine-render`: Renderizador nativo en PixiJS v8 (WebGL2/WebGPU) con carga bajo demanda de texturas (`AtlasLoader`), control de cámara con pan/zoom (`CameraController`), culling por frustum y rendimiento verificado a 60–144+ FPS (CPU 0.9–2.5 ms/frame).
   - `@sef/engine-audio`: Motor Web Audio API (`AudioManager`) para música estéreo y SFX espaciados.
   - `@sef/server`: Servidor Node.js 22 + Fastify con persistencia SQLite WAL (`SaveRepository`), backups atómicos, caché de idempotencia (PR #48) e importación/exportación de archivos `.save.json`.
   - `@sef/web`: Aplicación cliente React 19 + Tailwind CSS v4 + Zustand, con soporte para español por defecto, iconos vectoriales SVG para Windows 10, y adaptador dual (`gameApi.ts`).
3. **Doble Modo de Ejecución:**
   - **Local:** Servidor Fastify + SQLite WAL, lanzado mediante `Jugar Social Empires.bat` o `pnpm dev`.
   - **Online ($0 en GitHub Pages):** Motor determinista ejecutándose en el navegador con persistencia en **IndexedDB** (`social-empires-forge`), exportación/importación de `.save.json` vía Blob en el cliente, y despliegue continuo en cada `git push` vía GitHub Actions.
4. **Verificación de Calidad y Tests:**
   - `pnpm typecheck`: 8 de 8 proyectos pasan sin errores.
   - `pnpm test`: 17 de 17 tests unitarios en Vitest en verde.
   - `pnpm test:e2e` & `scratch/verify-static-pages.mjs`: Tests E2E en Chromium headless pasan con 0 errores de consola y 0 peticiones HTTP fallidas.

---

## 2. Mapa del Código Fuente y Ubicación de Recursos

### Código Fuente del Proyecto (`/home/antigravity/AdrielZT/social-empires-forge`)
```
social-empires-forge/
├── apps/
│   ├── server/             # Backend Fastify + SQLite WAL (SaveRepository.ts, index.ts)
│   └── web/                # Cliente React 19 (HUD, modales, GameController.ts, api/gameApi.ts)
├── packages/
│   ├── shared-types/       # Contratos y tipos Zod (mapas, items, savefile, commands)
│   ├── game-data/          # Tablas JSON compiladas (items, magics, goals, maps, localization)
│   ├── engine-sim/         # Simulación desacoplada (BattleEngine, OccupancyGrid, applyCommand, A*)
│   ├── engine-render/      # Renderizador isométrico PixiJS v8 (IsoRenderer, AtlasLoader, Camera)
│   └── engine-audio/       # Audio Web Audio API (AudioManager, SFX, tracks)
├── tools/
│   └── asset-pipeline/     # Scripts de extracción (Python Pillow + JPEXS FFDec + TypeScript)
├── .github/workflows/
│   └── deploy-pages.yml    # Workflow de despliegue automático a GitHub Pages
├── scripts/
│   ├── prepare-pages.mjs   # Preparador de bundle estático con indexación de mapas y .nojekyll
│   └── launch-windows.ps1  # Script de inicio para Windows con autorebuild
└── Jugar Social Empires.bat # Lanzador de doble clic para usuarios Windows
```

### Ubicación del Código Fuente Original en ActionScript 3 (Referencia Canónica 1:1)
En la carpeta `.cache/decompiled-as3/scripts/scripts/` se encuentra el código descompilado íntegro del cliente original `SocialEmpires1.4.07sec_fixed.swf`. Las clases clave para comparar son:
- **Movimiento y Unidades:**
  - `core/isoengine/IsoUnit.as` (máquina de estados de unidades, caminar, morir, recolectar, congelar).
  - `core/isoengine/IsoElement.as` (posicionamiento isométrico, orientación en 8 direcciones, bounding box).
  - `core/isoengine/IsoBuilding.as` (edificios, producción, recolección).
  - `core/isoengine/IsoFightingElement.as` (cálculo de daño, armadura, rango, vida).
  - `core/isoengine/IsoEngine.as` (bucle principal del motor isométrico original).
- **Combate e Inteligencia Artificial:**
  - `battle/IA.as` (IA base de persecución y combate).
  - `battle/IAWithAgro.as` (IA con detección de rango y agresividad).
  - `battle/IADragon.as` (comportamiento específico de dragones).
  - `battle/Squad.as` (formaciones, agrupamiento y separación de tropas para evitar solapamiento).
  - `battle/projectiles/` (física y trayectorias de flechas, rocas y rayos).
- **Unidades Especiales y Habilidades:**
  - `core/isoengine/delegates/` (444 clases: `DragonRedDelegate.as`, `BahamutDragonDelegate.as`, `ArthurDelegate.as`, etc.).
  - `core/isoengine/isounits/` (166 clases de unidades especiales).
  - `core/attacks/specials/` (arquetipos de ataques especiales y barra de Limit).
  - `core/magic/MagicManager.as` (los 15 hechizos mágicos clásicos).
- **Servidor Original Comunitario:**
  - `.cache/upstream-source/nerroth-rewrite/op.py` (los 128 opcodes del servidor de referencia).

---

## 3. Síntomas y Áreas Identificadas para el Pulido y Calibración Fiel

Aunque la base estructural ya funciona a 60 FPS tanto en local como en la web, en las pruebas jugables iniciales se identificaron aspectos donde la experiencia difiere de lo que el jugador recuerda del juego Flash de 2012:

1. **Movimiento, Pathfinding y Respuesta de Tropas:**
   - **Solapamiento y Colisiones:** Las unidades a veces se amontonan de forma poco natural en un solo tile en lugar de mantener la separación suave que hacía `Squad.as`.
   - **Tiempos de Animación y Giros:** La velocidad de reproducción de los fotogramas de caminata y ataque debe ajustarse a las duraciones exactas de los frames del SWF original según el atributo `velocity` de cada unidad.
   - **Puntos de Pivote Isométrico:** Ciertas unidades o edificios tienen un leve desfase de píxeles respecto a la base del tile isométrica (definido en las matrices de transformación de `IsoElement.as`).
2. **Combate e Inteligencia Artificial:**
   - **Comportamiento de Aggro y Enfoque:** Calibrar el radio de visión de `IAWithAgro.as` para que los enemigos no persigan indefinidamente ni ignoren amenazas cercanas.
   - **Prioridad de Objetivos:** Ajustar el targeting (los aldeanos deben huir o defenderse según su configuración clásica; las unidades militares deben priorizar agresores y edificios defensivos).
   - **Lógica de Ataques Especiales:** Calibrar los tiempos de enfriamiento (cooldown) y activación de la barra de Limit en dragones y héroes.
3. **Fidelidad Visual, UI y Calidad de Vida (QoL):**
   - **Barras de Vida y Daño Flotante:** Replicar exactamente el aspecto de las barras clásicas de vida (`BarraVidaMC.as` / `BarraVidaEnemyMC.as`) y la animación/fuente de los números de daño flotante.
   - **Popups e Interfaz Clásica:** Acercar la estética de la tienda, mercado y modales al marco clásico marrón con remaches dorados de Socialpoint, preservando la nitidez SVG en pantallas modernas.
   - **Selección y Comandos:** Mejorar el feedback visual (círculo de selección en el suelo, cursor contextual de ataque/recolección/movimiento) para que responda idéntico al clic de 2012.

---

## 4. Reglas Críticas para la Siguiente Etapa

Para evitar regresiones o deuda técnica en las siguientes fases:
1. **Presupuesto Estricto de $0 USD:** No introducir servicios de pago, APIs externas con costo ni tarjetas de crédito.
2. **Fidelidad Canónica 1.4.07:** No inventar mecánicas nuevas ni consultar documentos no canónicos (`DESIGN.md`). El referente de verdad es el código AS3 descompilado en `.cache/decompiled-as3/`.
3. **Validación Continua:** Cada cambio debe compilar limpiamente (`pnpm typecheck`), pasar los tests unitarios (`pnpm test`) y no generar errores de consola ni peticiones HTTP rotas en el navegador.
4. **Despliegue Transparente:** Mantener la compatibilidad dual: el servidor local (`Jugar Social Empires.bat` / Fastify) y la versión estática online (GitHub Pages + IndexedDB) deben mantenerse siempre sincronizados.
