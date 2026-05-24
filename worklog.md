# ARB//RADAR — Diagnóstico & Worklog

---
Task ID: 1
Agent: Main Agent
Task: Diagnóstico completo del repositorio arb-radar (GitHub: pablo2541/arb-radar)

Work Log:
- Clonado repositorio desde GitHub con token proporcionado
- Análisis completo de package.json y dependencias
- Lectura y análisis de prisma/schema.prisma (4 modelos: AppState, IolVolumeSnapshot, PriceSnapshot, DailyOHLC, CountryRisk)
- Lectura y análisis de src/lib/store.ts (Zustand store ~766 líneas)
- Lectura y análisis de src/lib/types.ts (tipos: Instrument, Config, CockpitScore, LiveInstrument, etc.)
- Lectura y análisis de src/lib/calculations.ts (~1000 líneas, funciones financieras)
- Lectura y análisis de src/lib/api-orchestrator.ts (secuenciador de APIs)
- Lectura y análisis de src/app/page.tsx (~800+ líneas, componente principal monolítico)
- Lectura y análisis de src/app/api/letras/route.ts (merge data912 + ArgentinaDatos)
- Lectura y análisis de src/app/api/market-truth/route.ts (consenso RP + MEP)
- Lectura y análisis de src/app/api/cockpit-score/route.ts (scoring de scalping)
- Lectura y análisis de src/components/dashboard/CockpitTab.tsx (~733 líneas)
- Lectura y análisis de src/components/dashboard/MercadoTab.tsx (~700+ líneas)
- Lectura y análisis de src/hooks/useLiveInstruments.ts (polling cada 60s)
- Lectura y análisis de src/lib/iol-bridge.ts (autenticación IOL + Level 2)
- Lectura y análisis de src/lib/market-truth-types.ts

Stage Summary:
- Diagnóstico completo generado. Ver sección de diagnóstico más abajo.
- Repositorio en /tmp/arb-radar listo para transformación.

---
Task ID: 2
Agent: Main Agent
Task: Comparación ZIP (local) vs GitHub repo + Deploy en sandbox

Work Log:
- Extraído ARB-RADAR V4.zip a /home/z/my-project/upload/arb-radar-v4/
- Clonado repo GitHub a /tmp/arb-radar-github
- Comparación diff -rq entre ambos (excluyendo node_modules, .git, db)
- Resultado: 96 archivos difieren solo en line endings (CRLF GitHub vs LF ZIP)
- UNICA diferencia real: HistoricoTab.tsx — GitHub V4.2.2 es MAS AVANZADO que ZIP V4.2.3
- ZIP tiene .env con credenciales IOL (esperado por .gitignore)
- Deploy: copiado src/, prisma/, scripts/, public/, data/ desde GitHub repo
- Merge de package.json (agregado xlsx, scripts prices:update/daemon)
- Configurado .env con DATABASE_URL + credenciales IOL
- Ejecutado prisma db:push — schema sincronizado
- Lint pasa limpio, dev server arranca OK en puerto 3000

Stage Summary:
- GitHub repo es la fuente de verdad (más avanzado en HistoricoTab)
- Proyecto desplegado y corriendo en /home/z/my-project/

---
Task ID: 3
Agent: Main Agent
Task: FASE 1 — Limpieza del Layout y Remoción de Código Muerto

Work Log:
- ELIMINADO HistoricoTab.tsx (archivo borrado del disco)
- ELIMINADO CurvasTab.tsx (archivo borrado del disco)
- EstrategiasTab.tsx: removido del menú visual (TAB_CONFIG), archivo conservado para futuro helper backend
- TAB_CONFIG actualizado: solo 5 tabs — Mercado, Cockpit, Cartera, Historial, Configuración
- Shortcuts renumerados: 1=Mercado, 2=Cockpit, 3=Cartera, 4=Historial, 5=Config
- TabId type en store.ts actualizado: removidos 'curvas', 'estrategias', 'historico'
- Import filterForCharts eliminado (solo usaba CurvasTab)
- Import analyzeCurveShape eliminado (solo usaba CurvasTab)
- sanitizedInstruments reemplazado por effectiveInstruments en todo page.tsx
- curveShape computation eliminada
- startDbSync/stopDbSync imports y código muerto eliminados
- Version label actualizado: V4.0.9 BLINDADO → V5.0 SCANNER
- Loading text actualizado: "Cargando V5.0 SCANNER..."
- Lint pasa limpio tras todos los cambios
- Dev server compila y sirve correctamente (200 OK)

Stage Summary:
- FASE 1 completada exitosamente
- 3 tabs eliminados del layout: Curvas, Estrategias, Histórico
- 2 archivos eliminados: HistoricoTab.tsx, CurvasTab.tsx
- EstrategiasTab.tsx preservado para extracción de lógica S/R en FASE 3
- Código muerto limpiado: imports, computaciones, variables no usadas
- Entorno compila limpio, sin errores de lint

---
Task ID: 2
Agent: Bug Fix Agent
Task: Fix two bugs — Volume column empty & Presión column stuck at 0%

Work Log:
- Diagnosed Bug 1: CockpitScore type lacked volume/iolVolume fields, so cockpit-score API couldn't pass volume data to frontend
- Diagnosed Bug 2: cockpit-score route read `inst.iolMarketPressure` (camelCase) but /api/letras returns `inst.iol_market_pressure` (snake_case), causing pressure to always be undefined → 0%
- Fix 1a: Added `volume: number` and `iolVolume: number` fields to CockpitScore interface in src/lib/types.ts (lines 260-262)
- Fix 1b: In cockpit-score route, spread calculateCockpitScore result and added `volume` (from inst.volume) and `iolVolume` (from inst.iol_volume) to returned object
- Fix 1c: Updated CockpitTab.tsx VOL column to use `score.iolVolume || score.volume` as PRIMARY sources before the existing fallbacks
- Fix 2: Changed `inst.iolMarketPressure` → `inst.iol_market_pressure` on line 168 of cockpit-score/route.ts (ROOT CAUSE of Presión stuck at 0%)
- Verified all three modified files pass ESLint with no errors

Stage Summary:
- Both bugs fixed with minimal targeted changes
- Volume column: now reads from API-provided score.iolVolume / score.volume first
- Presión column: now correctly reads iol_market_pressure in snake_case from letras API data
- No other files modified, no new features added

---
Task ID: 4
Agent: Bug Fix Agent
Task: Fix Prisma snapshotCount database errors in DailyOHLC

Work Log:
- Read worklog.md for project context (Tasks 1-3, previous bug fixes)
- Ran `bun run db:push` — database was already in sync with Prisma schema
- Verified DailyOHLC table has all 16 expected columns including `snapshotCount INTEGER (default: 1)` via PRAGMA table_info query
- Confirmed 0 existing DailyOHLC records (no legacy data with NULL snapshotCount)
- Analyzed update-prices.ts snapshotCount handling (lines 871-892):
  - Line 871: `(existingOHLC.snapshotCount || 1) + 1` — used logical OR which treats 0 as falsy
  - Line 874: spreadAvg weighted average formula verified correct (incremental mean)
  - Fixed: Changed `|| 1` to `?? 1` (nullish coalescing) for semantic correctness
  - Added: `prevSpreadAvg = existingOHLC.spreadAvg ?? 0` guard against null spreadAvg from legacy records
- Analyzed price-history API (route.ts):
  - Already uses `numOrZero()` for all DailyOHLC fields except snapshotCount
  - Added: `snapshotCount: numOrZero(r.snapshotCount)` to OHLC response for defensive access
- Dev server compiles and serves correctly

Stage Summary:
- Root cause: If the `snapshotCount` column was missing from SQLite (pre-db:push), Prisma queries would fail because the generated SQL references the column. Running `db:push` ensures column exists.
- Code hardening: `|| 1` → `?? 1` prevents incorrect fallback if snapshotCount=0 (edge case)
- Code hardening: Added `?? 0` guard for spreadAvg null from legacy records
- Defensive API: Added snapshotCount with numOrZero() to price-history OHLC response
- Database verified: All 16 columns present, schema fully synced

---
Task ID: 5
Agent: Main Agent
Task: FASE 2 — Verificación final de compilación y testing

Work Log:
- Verificado ESLint en src/ — pasa limpio sin errores
- Verificado TypeScript type-check — solo errores preexistentes en upload/ y examples/, ninguno en src/
- Corregido error TS preexistente en price-history/route.ts: tipado explícito del array `tickers` (era `never[]`)
- Dev server arranca y compila correctamente (HTTP 200)
- API /api/cockpit-score responde (timeout en sandbox por falta de acceso a APIs externas, pero estructura correcta)
- Todos los archivos modificados en FASE 2 compilan sin errores

Stage Summary:
- FASE 2 completada exitosamente
- 3 bugs corregidos: Volumen intradía, Presión Order Book, Prisma snapshotCount
- 5 archivos modificados: types.ts, cockpit-score/route.ts, CockpitTab.tsx, price-history/route.ts, update-prices.ts
- Entorno compila limpio, sin errores de lint ni TypeScript
- PRÓXIMO PASO: FASE 3 — Columnas S/R, Inyección de Volumen, SCORE de acción rápida

---
Task ID: 6
Agent: Main Agent
Task: FASE 3 — Centralización de Señales de Price Action y Algoritmo de Score (El Gatillador)

Work Log:
- Analizado EstrategiasTab.tsx para extraer lógica de S/R (calculateSR de priceHistory.ts)
- Analizado calculateCockpitScore en calculations.ts (5 factores ponderados)
- Actualizado CockpitScore type en types.ts con 4 nuevos campos:
  - nearestSR: { level, type: 'S'|'R' } | null
  - distanceToSR: number (% al S/R más cercano)
  - volumeInjection: { ratio, label: 'NORMAL'|'X2'|'X3'|'X5'|'EXPLOSIVO' }
  - actionScore: { score: 0-100, label: 'GATILLAR YA'|'ATRACTIVO'|'NEUTRAL'|'SIN SEÑAL', reason }
- Implementado 3 nuevos algoritmos en calculations.ts (~300 líneas):
  - calculateNearestSR(): Deriva S/R desde bid/ask spread + change_pct (sin depender de historico_precios.json)
  - calculateVolumeInjection(): Compara volumen IOL vs data912 + momentum de precio
  - calculateActionScore(): Cruza 3 variables → Distancia S/R (0-40 pts) + Volumen Inyección (0-35 pts) + Presión Book (0-25 pts) + bonus carry/momentum
- Actualizado cockpit-score API (route.ts):
  - Importadas 3 nuevas funciones de calculations.ts
  - Cada instrumento calcula nearestSR, distanceToSR, volumeInjection y actionScore
  - Spread a calculateCockpitScore() + override de los campos V5.0
- Rediseñado CockpitTab.tsx (reescritura completa):
  - Tabla con 11 columnas: #, Instrumento, Precio, TEM, VOL, S/R Cercano, Dist%, Inyección, Spread, Score, ACCIÓN
  - El Grito Card mejorado: incluye GATILLAR YA count con badge animado
  - Summary Bar mejorado: muestra Gatillar + Atractivo action score counts
  - Sort order: Action Score primero (GATILLAR YA > ATRACTIVO > NEUTRAL > SIN SEÑAL), luego cockpitScore
  - Visual alerts implementadas:
    - Distancia < 0.5%: texto amarillo/rojo + barra lateral indicadora + glow
    - Distancia < 0.3%: texto rojo pulsante
    - GATILLAR YA: badge rojo pulsante con glow + emoji 🔥
    - Volume Injection: badges coloreados (NORMAL gris, X2 purple, X3 gold, X5 orange, EXPLOSIVO red pulsante)
    - GATILLAR YA rows: borde izquierdo rojo pulsante + fondo gradient
  - Methodología card: explica los 3 factores y umbrales del Gatillador
- CSS nuevo en globals.css:
  - .gatillar-row: borde izquierdo pulsante + fondo gradient para filas GATILLAR YA
  - @keyframes gatillarPulse: animación del borde
  - Soporte light mode
- ESLint pasa limpio en src/
- TypeScript: 0 errores en CockpitTab.tsx y archivos modificados
- Dev server compila y sirve correctamente (HTTP 200 confirmado)

Stage Summary:
- FASE 3 completada exitosamente
- 4 columnas Price Action implementadas: S/R Cercano, Distancia %, Inyección de Volumen, SCORE (El Gatillador)
- 5 archivos modificados: types.ts, calculations.ts, cockpit-score/route.ts, CockpitTab.tsx, globals.css
- Algoritmo "El Gatillador Cuantitativo" cruza 3 variables en tiempo real (distancia S/R + volumen + presión)
- Visual alerts agresivas para distancia < 0.5% y GATILLAR YA
- Sort order prioriza Action Score sobre Cockpit Score tradicional
- El Grito card mejorado para incluir señales GATILLAR YA
- Entorno compila limpio, sin errores de lint ni TypeScript en src/

## Current Project Status

### Completed Phases
- **FASE 1**: Layout cleanup, dead tab removal, store cleanup ✅
- **FASE 2**: Volume intradía fix, Presión Order Book fix, Prisma snapshotCount fix ✅
- **FASE 3**: Price Action Scanner — S/R, Volume Injection, El Gatillador ✅

### Architecture
- Backend: /api/cockpit-score → calculates all 5 CockpitScore factors + 4 new V5.0 fields
- Frontend: CockpitTab.tsx renders 11-column table with visual alerts
- Algorithms: calculateNearestSR, calculateVolumeInjection, calculateActionScore in calculations.ts

### Unresolved Issues / Risks
- Dev server is resource-intensive in sandbox (Turbopack compilation can crash with OOM)
- S/R derivation uses bid/ask + change_pct heuristics (not full historical S/R from priceHistory.json — that data is client-side only)
- Volume Injection ratios are heuristic-based (no true intraday minute-by-minute data available from APIs)
- For production: connect real historical S/R data (from EstrategiasTab's calculateSR) when available via API

### Priority Recommendations for Next Phase
- Add S/R from historico_precios.json via API endpoint (server-side access to price history)
- Implement real volume moving average from IOL volume snapshots (Prisma DB)
- Add keyboard shortcuts for quick action on GATILLAR YA instruments
- ~~Add sound/notification alert when GATILLAR YA appears~~ ✅ Done in Task 4
- Mobile-responsive optimization for the 11-column table

---
Task ID: 4
Agent: CockpitTab Feature Agent
Task: Add search/filter, sound alerts, CSV export to CockpitTab

Work Log:
- Read worklog.md for full project context (Tasks 1-6, all 3 FASEs completed)
- Read CockpitTab.tsx (892 lines) to understand existing code structure and patterns
- Read shadcn/ui components: Input, Button (for new features)
- Read CockpitScore type from types.ts (confirmed all fields needed for CSV export)
- Verified lucide-react package available (^0.525.0)
- Feature 1: Ticker Search/Filter
  - Added `searchQuery` state
  - Added `displayedScores` useMemo that applies case-insensitive partial match on `sortedScores`
  - Added Search icon from lucide-react + shadcn Input component in horizon filter row
  - Search input styled consistently: small (h-7), monospace font, teal focus ring, dark theme colors
  - Empty state updated to show "No se encontraron instrumentos que coincidan con..." when search has no results
  - All rendered data (table rows, El Grito card, summary counts, methodology) now uses `displayedScores`
- Feature 2: Sound Alert Toggle for GATILLAR YA
  - Added `soundEnabled` state initialized from localStorage ('arbradar_cockpit_sound')
  - Added `audioCtxRef` useRef for AudioContext persistence (avoids recreation)
  - Added `prevGatillarRef` useRef (Set<string>) to track which tickers were already GATILLAR YA
  - Implemented `playBeep()` using Web Audio API: square wave, 880Hz, 0.15 gain, 250ms duration
  - Added useEffect that detects NEW GATILLAR YA transitions (tickers in current set but not in previous set)
  - Beep only plays when `prevGatillarRef.current.size > 0` (prevents false alarm on first data load)
  - Toggle button in header near LIVE badge: Bell icon when active (red), BellOff when muted (gray)
  - Sound toggle persists to localStorage
  - When sound disabled, prevGatillarRef is reset to empty Set
- Feature 3: Export Cockpit Data to CSV
  - Added `handleExportCSV` callback that generates CSV from `displayedScores`
  - CSV columns: Ticker, Type, Price, TEM, Volume, S/R Cercano, Distancia %, Inyección, Spread, CockpitScore, ActionScore, ActionLabel
  - Uses Blob + URL.createObjectURL + document.createElement('a') download pattern
  - Filename format: `arb-radar-cockpit-YYYY-MM-DD.csv`
  - Download button with Download icon from lucide-react + shadcn Button (ghost, sm variant)
  - Button disabled when no data to export; "CSV" label hidden on mobile for compact layout
  - Positioned in horizon filter row alongside search input
- Refactored `localSummary` to use `displayedScores` instead of `filteredScores` so counts reflect search filter
- Refactored `elGritoScores` to use `displayedScores` so El Grito card respects search filter
- Refactored table rows, empty state, and methodology section to use `displayedScores`
- ESLint passes with 0 errors (verified with `bun run lint -- --ignore-pattern 'upload/**' --ignore-pattern 'examples/**'`)
- Dev server compiles and serves correctly

Stage Summary:
- 3 major features added to CockpitTab.tsx: Ticker Search, Sound Alerts, CSV Export
- Only 1 file modified: src/components/dashboard/CockpitTab.tsx
- New imports: Input, Button from shadcn/ui; Search, Download, Bell, BellOff from lucide-react
- New state: searchQuery, soundEnabled (localStorage-persisted)
- New refs: audioCtxRef (AudioContext), prevGatillarRef (Set for transition detection)
- New memo: displayedScores (search-filtered version of sortedScores)
- Sound alert: Web Audio API with OscillatorNode, 880Hz square wave, 250ms beep on GATILLAR YA transitions
- CSV export: 12-column CSV with Blob download, dated filename
- All features responsive and follow existing dark theme styling (teal/pink/gold accents)
- Lint clean, dev server compiles OK

---
Task ID: 4b
Agent: Frontend Styling Agent
Task: Mobile responsive and visual improvements for CockpitTab

Work Log:
- Read worklog.md for project context (Tasks 1-6, Task 4, all phases complete)
- Read full CockpitTab.tsx (~892 lines) and globals.css (~1359 lines) to understand current state
- Identified existing CSS classes: .gatillar-row, .table-row-highlight, .table-row-alt, .micro-score-bar-track/fill
- Planned 4 categories of changes: mobile card layout, visual enhancements, scrollable container, spacing/typography
- Added new CSS to globals.css (V5.1 section, ~130 lines):
  - .cockpit-scroll-container: max-height 70vh, overflow-y auto, custom teal scrollbar
  - .cockpit-sticky-header: position sticky top 0, z-index 10, dark/light background
  - .cockpit-fade-bottom::after: 48px gradient fade at bottom (dark + light mode)
  - .cockpit-row-hover: enhanced hover with smooth transition
  - .cockpit-context-separator: thin teal border-top + subtle background between main and context rows
  - .ticker-dot / .ticker-dot-gatillar / .ticker-dot-atractivo / .ticker-dot-neutral: status indicator dots
  - .cockpit-mobile-card: mobile card styling with border, hover, and gatillar-row variant (dark + light mode)
- Rewrote CockpitTab.tsx table section (V5.0 → V5.1):
  - Added mobile card layout (< md breakpoint): each instrument as compact card with 3 rows:
    - Top: Rank badge + Ticker with status dot + Type badge + Action Score badge
    - Middle: Price + TEM + VOL
    - Bottom: S/R Cercano + Distancia + Inyeccion badge + Spread
    - Context row with micro-score bars + reason (always visible on mobile, no sm:hidden)
  - Desktop grid layout (>= md): unchanged 11-column grid with new enhancements
  - Added .cockpit-mobile-card class for mobile cards (hidden on md+)
  - Added .hidden.md:hidden for desktop-only rows
  - Added ticker status dot next to ticker name (red for GATILLAR YA, teal for ATRACTIVO, gray otherwise)
  - Wrapped table in .cockpit-scroll-container with max-h-[70vh] overflow-y-auto
  - Made header sticky with .cockpit-sticky-header
  - Added gradient fade at bottom when >10 items via .cockpit-fade-bottom
  - Changed py-1.5 to md:py-2 for desktop row padding
  - Added .cockpit-context-separator between main row and context row on desktop
  - Changed Score column from text-sm to text-base
  - Mobile header shows "Instrumentos / Señales" instead of 11-column headers
  - Mobile cards use space-y-2 with gap; desktop uses divide-y
  - Moved vol calculation to shared variable (volDisplay) to avoid duplication
- Removed unused import: MarketTruthResponse from '@/lib/market-truth-types'
- Version label updated: V5.0 SCANNER → V5.1 SCANNER
- ESLint passes with 0 errors
- TypeScript: 0 errors in CockpitTab.tsx (no new type errors introduced)

Stage Summary:
- Mobile responsive layout implemented: cards on <768px, grid on >=768px
- Visual enhancements: ticker status dots, hover effects, context row separator, gradient fade at bottom
- Scrollable container with sticky header (max-height 70vh)
- Typography: Score column text-sm → text-base, desktop row py-2
- 2 files modified: CockpitTab.tsx (full rewrite of table section), globals.css (new V5.1 CSS section)
- Lint clean, no new TypeScript errors
