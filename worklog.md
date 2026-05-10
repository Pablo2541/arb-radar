# ARB//RADAR PRO TERMINAL — Worklog

## V3.5-PRO Phase 1 — Price Action Engine: Eliminar Doble Enrichment + Parser Case-Insensitive + Volumen Notional

**Date**: 2025-05-10
**Agent**: Main Agent (Senior Quant Developer)

### Task ID: V3.5-Phase1
### Task: Refactor architecture to fix volume loss bug, add case-insensitive IOL parser, normalize volume to ARS notional

### Forensic Diagnosis (pre-refactor):
Identified 5 root-cause bugs in V3.4.3:
1. **CRITICAL**: Double enrichment — `useLiveInstruments.ts` fetched `/api/iol-level2` and OVERWROTE server-provided IOL data with zeros on failure
2. **HIGH**: `iol_volume` was `cantidadOperada` (quantity of titles), NOT ARS notional — misleading for comparison
3. **CRITICAL**: `PriceSnapshot` and `DailyOHLC` models exist in Prisma schema but NO writer exists — volume never persisted to history tables
4. **MEDIUM**: IOL token expires between server and client calls, causing client enrichment to fail
5. **MEDIUM**: IOL API parser not case-insensitive — PascalCase responses break field access

### Work Log:
- **iol-bridge.ts**: Added `normalizeResponseKeys()` — deep key normalizer that lowercases first char of every key (handles PascalCase/camelCase IOL API variations)
- **iol-bridge.ts**: Applied normalization to `getIOLCotizacion()` after `res.json()` — all field access now case-insensitive
- **iol-bridge.ts**: Added `iol_volume_notional` field (ARS) separated from `iol_volume` (cantidadOperada) in `IOLLevel2Data` interface
- **iol-bridge.ts**: Updated 404 empty-data return to include `iol_volume_notional: 0`
- **iol-bridge.ts**: Changed silent `catch {}` to `console.error()` for diagnostics
- **types.ts**: Added `iolVolumeNotional?: number` to `Instrument` interface
- **types.ts**: Added `iol_volume_notional?: number` to `LiveInstrument` interface
- **types.ts**: Clarified comments: `iolVolume` = quantity of titles (NOT ARS)
- **/api/letras**: Added `iol_volume_notional` to inline `LiveInstrument` type
- **/api/letras**: Maps `l2.iol_volume_notional` in IOL enrichment loop
- **/api/letras**: Updated comments to state it's the SOLE source of truth for IOL data
- **/api/iol-level2**: Added `volume_notional: number` to `TickerLevel2Data`
- **/api/iol-level2**: Maps `l2.iol_volume_notional` in `enrichLevel2Data()`
- **/api/iol-level2**: Added `volume_notional: 0` to all error/empty data objects
- **useLiveInstruments.ts**: REMOVED 60-line client-side IOL Level 2 enrichment block (the double-fetch bug)
- **useLiveInstruments.ts**: Added detailed comment explaining why client no longer calls `/api/iol-level2`
- **useLiveInstruments.ts**: Added `iolVolumeNotional: live.iol_volume_notional` mapping
- **MercadoTab.tsx**: Volume column now shows ARS notional (primary) with green "ARS" badge, or quantity with purple "QTY" badge (fallback)
- **CockpitTab.tsx**: Volume column uses `iolVolumeNotional` priority → `data912Volume` → `iolVolume` fallback
- **page.tsx**: Maps `iolVolumeNotional` from live data

### Stage Summary:
- **Double enrichment bug ELIMINATED** — `/api/letras` is now the SOLE source of truth for IOL data
- **Case-insensitive parser** — `normalizeResponseKeys()` handles all IOL API key variations
- **Volume normalized to ARS** — `iol_volume_notional` provides real notional volume for display
- **Lint clean** — no new errors introduced (pre-existing errors in shadcn/ui chart components remain)
- **Pushed to GitHub** — commit `8da9280` on `main` branch

### Files Changed:
1. `src/lib/iol-bridge.ts` — +normalizeResponseKeys, +iol_volume_notional, error logging
2. `src/lib/types.ts` — +iolVolumeNotional, +iol_volume_notional fields
3. `src/app/api/letras/route.ts` — maps iol_volume_notional, V3.5 comments
4. `src/app/api/iol-level2/route.ts` — +volume_notional field in all paths
5. `src/hooks/useLiveInstruments.ts` — removed double enrichment block, +iolVolumeNotional
6. `src/components/dashboard/MercadoTab.tsx` — ARS notional volume display with badges
7. `src/components/dashboard/CockpitTab.tsx` — notional ARS priority
8. `src/app/page.tsx` — maps iolVolumeNotional

### Unresolved Issues / Next Steps:
- **Phase 2**: Create API Orchestrator that writes `PriceSnapshot` and consolidates `DailyOHLC` — currently NO writer exists for these tables
- **Phase 2**: Integrate BondTerminal (Riesgo País), Data912, ArgentinaDatos as formal macro sources
- **truth-filter.ts**: Currently uses `iol_volume` (quantity) for confirmation logic — consider using `iol_volume_notional` for more accurate liquidity assessment
- **HistoricoTab.tsx**: Uses `iolVolume` from DB OHLC data — needs `iolVolumeNotional` field in `DailyOHLC` schema (Phase 2 migration)
- **Validation**: Monday 11:00 AM when markets open — verify full pipeline with real IOL data

---

## V3.4.2 — Windows Native Fix

**Date**: 2025-07-19
**Agent**: Main Agent

### Task ID: V3.4.2
### Task: Fix Windows incompatibility, eliminate phantom dependencies, simplify Prisma configuration

### Work Log:
- Deleted `prisma.config.ts` — it imported `defineConfig` from `prisma/config` which doesn't exist in Prisma 6.x, causing "module not found" errors
- Cleaned up `prisma/schema.prisma` — kept standard `url = env("DATABASE_URL")` which works perfectly with Prisma 6.x (v6.19.2). No prisma.config.ts needed.
- Deleted 8 bash scripts: `prisma-helper.sh`, `server-supervisor.sh`, `run-dev.sh`, `.radar-daemon.sh`, `daemon.sh`, `start-server.sh`, `start-bun.sh`, `.start-dev.sh`
- Deleted `start-server.js` (old V3.3.1 artifact)
- Created `scripts/prisma-run.js` — cross-platform Node.js helper that:
  - Reads .env file directly (bypasses system env overrides)
  - Strips quotes from DATABASE_URL (Windows .env compatibility)
  - Validates URL starts with `postgresql://` and contains `@`
  - Warns if `sslmode=require` is missing
  - Sets DATABASE_URL in process.env and spawns Prisma CLI
  - Works on Windows CMD, PowerShell, and Unix shells
- Updated `package.json`:
  - Version bumped to 3.4.2
  - All `bash prisma-helper.sh` calls replaced with `node scripts/prisma-run.js`
  - `postinstall` changed from `bash prisma-helper.sh generate` to `npx prisma generate`
  - `build` changed from `bash prisma-helper.sh generate && next build` to `npx prisma generate && next build`
- Updated `db.ts`:
  - Added `cleanDatabaseUrl()` function that strips quotes, trims whitespace, validates URL structure
  - Auto-appends `sslmode=require` if missing (Neon DB requires SSL)
  - Added eslint-disable comments for server-side require() calls
- Updated `.env`:
  - Added `?sslmode=require` to DATABASE_URL
  - Clear V3.4.2 comments explaining Windows CMD vs PowerShell quote behavior

### Stage Summary:
- **All bash dependencies eliminated** — project runs natively on Windows CMD/PowerShell
- **Phantom prisma.config.ts removed** — no more "module not found" errors
- **Prisma P1012 error fixed** — standard `url = env("DATABASE_URL")` works with Prisma 6.x
- **db:push works**: `node scripts/prisma-run.js db push` → "The database is already in sync"
- **prisma validate works**: Schema is valid
- **Dev server starts**: All APIs respond (letras, market-truth, state, iol-level2)
- **Lint clean**: No errors in main project files (only old archived code in upload/ folder)

### Verification Results:
- ✅ `node scripts/prisma-run.js db push` — succeeds
- ✅ `node scripts/prisma-run.js validate` — schema valid
- ✅ Dev server starts on port 3000
- ✅ APIs respond: `/api/letras`, `/api/market-truth`, `/api/state`, `/api/iol-level2`
- ✅ `db.ts` auto-appends sslmode=require
- ✅ No .sh files in project root
- ✅ No prisma.config.ts

### Files Changed:
1. **DELETED**: `prisma.config.ts`, `prisma-helper.sh`, `server-supervisor.sh`, `run-dev.sh`, `.radar-daemon.sh`, `daemon.sh`, `start-server.sh`, `start-bun.sh`, `.start-dev.sh`, `start-server.js`
2. **CREATED**: `scripts/prisma-run.js`
3. **MODIFIED**: `prisma/schema.prisma`, `package.json`, `src/lib/db.ts`, `.env`

### ZIP Generation & Verification (Post-Fix):
- Updated all version labels from V3.4.1/V3.3/V3.4 → V3.4.2 across 7 source files
- Eliminated all V3.3.1 references from the project (only existed in deleted start-server.js)
- Generated clean ZIP: `ARB-RADAR-V3.4.2-PRO-TERMINAL.zip` (2.7 MB)
- ZIP excludes: node_modules, .next, .git, skills/, old ZIPs, db/custom.db, dev.log
- Verified via extraction simulation:
  - ✅ No .sh files (except .zscripts which are sandbox infrastructure)
  - ✅ No prisma.config.ts
  - ✅ No V3.3.1 references
  - ✅ package.json version: "3.4.2"
  - ✅ db:push uses: "node scripts/prisma-run.js db push"
  - ✅ schema.prisma uses standard url = env("DATABASE_URL")
  - ✅ .env includes sslmode=require
  - ✅ All 4 migration scripts present in scripts/ directory

### Unresolved Issues / Risks:
- None for V3.4.2 specifically — this was a targeted fix for Windows compatibility
- The `upload/` directory contains old archived code with lint errors — could be cleaned up but not blocking
- Future: consider adding a `prisma-run.bat` wrapper for even more explicit Windows support
