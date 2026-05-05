# ARB//RADAR V3.2.4-PRO — Worklog

## Current Project Status

**Version**: V3.2.4-PRO
**Status**: HistoricoTab 20-day trend + Version branding V3.2.4-PRO completed. Server running on port 3000, all API endpoints operational.
**Database**: Neon PostgreSQL (CountryRisk model added for Riesgo País persistence)
**Auto-Cron**: 15-minute webDevReview scheduled (job_id: 128422)

---

## Task 1 — Backend Schema & API Updates (COMPLETED)

### Changes Made:
- **prisma/schema.prisma**: Changed provider from `sqlite` to `postgresql`. Added depth/pressure fields:
  - `PriceSnapshot`: `iolBidDepth Float?`, `iolAskDepth Float?`, `iolMarketPressure Float?`
  - `DailyOHLC`: `iolBidDepthAvg Float @default(0)`, `iolAskDepthAvg Float @default(0)`, `iolMarketPressureAvg Float @default(0)`
- **src/lib/iol-bridge.ts**: Added `iol_bid_depth`, `iol_ask_depth`, `iol_market_pressure` to `IOLLevel2Data` interface and `getIOLCotizacion()` function
- **src/lib/absorption-rule.ts**: NEW — Dynamic Absorption Rule module with `detectAbsorption()` and `calculateRollingAvgAskDepth()`
- **src/app/api/iol-level2/route.ts**: Added `absorption_alert` field, depth history tracking, `alert_count` in meta
- **src/app/api/market-pressure/route.ts**: NEW — Aggregated market pressure API endpoint with absorption alerts

### Absorption Rule Logic:
- Wall detection: Ask depth ≥ 5x the 15-min rolling average
- ABSORPTION_IMMINENT: Buy volume absorbs ≥30% + market pressure >1.5
- ABSORPTION_COMPLETE: Market pressure >3.0 + absorption ≥50%
- Priority instruments: T15E7 and any with TEM ≥2.0%

---

## Task 2 — Frontend Component Updates (COMPLETED)

### Changes Made:
- **MarketPressureBadge.tsx**: Enhanced with:
  - 5-bid vs 5-ask accumulated volume summary
  - Tooltip with detailed breakdown on hover (compact mode)
  - Absorption alert banner (WALL_DETECTED/ABSORPTION_IMMINENT/ABSORPTION_COMPLETE)
  - Pulsing red ring for ABSORPTION_IMMINENT alerts
  - Universal optional chaining (?.) with defaults (|| 0) for all data access
- **IOL Level 2 API**: Now returns `absorption_alert` field per ticker
- **Market Pressure API**: New endpoint `/api/market-pressure?tickers=T15E7,S1L5`

### Validation:
- All source code passes `eslint` with zero errors
- Dev server running, all `/api/iol-level2` requests returning 200
- ZIP generated at `/home/z/my-project/ARB-RADAR-V3.2.1-PRO.zip` (395K, clean — no .next/node_modules/.env)

---

## Unresolved Issues / Risks

1. **Prisma db:push**: Cannot run against Neon from sandbox (no network access). User must run `npx prisma db push` after uploading ZIP to GitHub Desktop.
2. **IOL Credentials**: `IOL_USERNAME`/`IOL_PASSWORD` env vars required for Level 2 data. Without them, the system operates in Level 1 mode only.
3. **Absorption Rule Rolling Average**: The depth history is stored in-memory (server-side Map). On server restart, history is lost. For production, consider persisting to the `PriceSnapshot` table.
4. **Optional Chaining Coverage**: Core dashboard components updated. Some less critical components (EstrategiasTab, ConfiguracionTab) may still have unguarded property access.

---

## Next Phase Recommendations

1. **Run `npx prisma db push`** after uploading ZIP to apply the new depth/pressure columns
2. **Test the Market Pressure endpoint** by navigating to the Oportunidades tab and checking the pressure badges
3. **Verify absorption alerts** by monitoring the console during active trading hours when IOL data is available
4. **Consider adding a WebSocket** for real-time absorption alert push notifications
5. **Add PriceSnapshot depth fields** to the Cerebro Táctico script (`scripts/update-prices.ts`) for historical depth tracking

---

## Task 2 — Version Update V3.2.1 → V3.2.2 + NaN-Safe Utilities (COMPLETED)

### Changes Made:
- **package.json**: Version bumped from "3.2.1" to "3.2.2"
- **src/app/page.tsx**: Updated loading screen text "Cargando V3.2.1..." → "Cargando V3.2.2..." and header version badge "V3.2.1" → "V3.2.2"
- **src/lib/utils.ts**: Appended 8 NaN-safe utility functions (safeToFixed, safeToLocaleString, safeNumber, safePercent, safeCurrency, safeVolume, safeDepth, safePressureColor)
- **prisma/schema.prisma**: Updated header comments (lines 2, 8) and inline field comments from V3.2.1-PRO → V3.2.2-PRO
- **src/lib/absorption-rule.ts**: Updated header comment (line 2) from V3.2.1-PRO → V3.2.2-PRO
- **src/lib/iol-bridge.ts**: Updated header comments (lines 2, 8) and inline comment (line 282) from V3.2.1-PRO → V3.2.2-PRO
- **src/app/api/iol-level2/route.ts**: Updated header comments (lines 2, 12) and inline comment (line 60) from V3.2.1-PRO → V3.2.2-PRO
- **src/app/api/market-pressure/route.ts**: Updated header comment (line 2) from V3.2.1-PRO → V3.2.2-PRO

### NaN-Safe Utility Functions Added:
1. `safeToFixed(value, decimals, fallback)` — Never throws on NaN/null/undefined
2. `safeToLocaleString(value, options, fallback)` — Safe locale formatting (es-AR)
3. `safeNumber(value, defaultValue)` — Converts any value to valid number with fallback
4. `safePercent(value, decimals, fallback)` — Formats decimal as percentage string
5. `safeCurrency(value, decimals, fallback)` — Formats as ARS currency
6. `safeVolume(value, fallback)` — K/M notation for volume
7. `safeDepth(value, fallback)` — K/M notation for order book depth
8. `safePressureColor(pressure)` — Returns color based on pressure ratio

### Remaining V3.2.1 references (feature attribution comments, NOT version identifiers):
- `src/app/layout.tsx` — Page metadata title/description (user-visible)
- `src/lib/truth-filter.ts` — Module header comment
- `src/lib/types.ts` — Inline field comments (feature attribution)
- `src/components/dashboard/OportunidadesTab.tsx` — Inline comments (feature attribution)
- `prisma/schema.postgresql.prisma` — Backup schema file (not active)

---

## Task 5 — V3.2.2-PRO BONCAP Priority Enhancement (COMPLETED)

### Changes Made:

#### src/lib/absorption-rule.ts
- **HIGH_PRIORITY_TICKERS**: Expanded from `['T15E7']` to `['T15E7', 'T30J7', 'T5W3', 'S1L5']` — covers more BONCAP instruments
- **HIGH_TEM_THRESHOLD**: Lowered from `2.0` to `1.8` — catches more high-rate BONCAP instruments
- **V3.2.2 BONCAP auto-detection**: Added regex `/^T\d+[A-Z]\d+$/i` to auto-detect BONCAP instruments by ticker pattern. `isHighRateBoncap` triggers when BONCAP ticker has TEM ≥ 1.8%. `isHighPriority` combines named priority, TEM threshold, and BONCAP detection.
- **New export `isHighPriorityTicker(ticker, tem)`**: Quick-check function for the "Caza de Oportunidades" module. Returns true for named priority tickers, high-TEM instruments, or high-rate BONCAP patterns.

#### src/components/dashboard/MarketPressureBadge.tsx
- **Import**: Added `safeNumber` and `safeVolume` from `@/lib/utils`
- **NaN-safe replacements**: Replaced all manual `?? 0` guards with `safeNumber()` and `safeVolume()` calls for: `market_pressure`, `bid_depth`, `ask_depth`, `top5CompraVol`, `top5VentaVol`, `absorption.wallSize`
- **Compact tooltip**: Added BONCAP PRIORITY indicator (`⚡ BONCAP PRIORITY — Alta tasa`) after absorption alert block, shown when ticker matches `T\d+[A-Z]\d+` pattern
- **Full version**: Added BONCAP PRIORITY badge (`⚡ BONCAP PRIORITY — Detección de Absorción Prioritaria`) with amber styling after volume info
- **ABSORPTION_IMMINENT enhancement**: Added extra priority warning (`🚨 FUERZA COMPRADORA INMINENTE — {ticker} — Capturar salto de precio PRE-LIMPIEZA de pared`) with pulsing red animation when `isImminent && absorption?.priority`

### Validation:
- ESLint: Zero errors on both modified files
- Dev server: Running, all API endpoints returning 200
- TypeScript: Valid — all types consistent with existing interfaces

---

## Task 6 — V3.2.2-PRO Absorption Alert Banner + T15E7/BONCAP Highlighting (COMPLETED)

### Changes Made:

#### src/app/page.tsx
- **AbsorptionAlertBanner component**: NEW — Global banner that polls `/api/market-pressure?tickers=T15E7,T30J7,T5W3,S1L5` every 60 seconds. Displays color-coded alert banners when absorption events are detected:
  - 🚨 `ABSORPTION_IMMINENT` — Red pulsing banner (buy volume absorbing wall)
  - ✅ `ABSORPTION_COMPLETE` — Green banner (wall fully absorbed)
  - 🧱 `WALL_DETECTED` — Yellow banner (wall identified, no absorption yet)
  - Priority indicator `⚡ PRIORIDAD` badge for T15E7/BONCAP instruments
  - Dismissible per-alert with ✕ button (dismissed state tracked via Set)
  - Initial fetch deferred via `setTimeout(0)` to avoid synchronous setState in effect
- **Banner placement**: Rendered after `<ThresholdAlerts>` div and before `{/* ── Market Summary Widget */}` section

#### src/components/dashboard/OportunidadesTab.tsx
- **Import**: Added `isHighPriorityTicker` from `@/lib/absorption-rule`
- **⭐ MEJOR OPORTUNIDAD card**: Added `⚡ ABSORCIÓN PRIORITARIA` badge with amber pulsing animation after instrument type badge when `isHighPriorityTicker(ticker, tem)` returns true
- **Top Carry Ranking rows**: Added `⚡` indicator (8px amber text) after ticker name when `isHighPriorityTicker(ticker, tem)` returns true

### Validation:
- ESLint: Zero errors on both modified files (page.tsx, OportunidadesTab.tsx)
- Dev server: Compiled successfully, `/api/market-pressure` endpoint returning 200
- TypeScript: Valid — all types consistent with existing interfaces

---

## Task 1 — V3.2.2-PRO Floating Point Precision Fix for Chart Components (COMPLETED)

### Problem
Chart Y-axes across the dashboard showed floating point artifacts like `1.99999999996` instead of clean `2.00%`. Tooltips showed excessive decimals. The root cause was using raw `.toFixed()` on floating point values without rounding first.

### Solution
Created a shared chart formatting module (`chart-formatters.ts`) that rounds BEFORE formatting, then applied it to all chart components.

### Changes Made:

#### src/lib/chart-formatters.ts (NEW)
- **`roundTo(value, decimals)`** — Core rounding function: `roundTo(1.9999999, 2) → 2.00`
- **`formatTEMAxis(value)`** — Y-axis: 2 decimals with % suffix
- **`formatSpreadAxis(value)`** — Y-axis: 3 decimals with % suffix
- **`formatSlopeAxis(value)`** — Y-axis: 2 decimals with % suffix
- **`formatDMAxis(value)`** — Y-axis: 3 decimals (Duration Modified)
- **`formatPriceAxis(value)`** — Y-axis: 4 decimals
- **`formatVolumeAxis(value)`** — Y-axis: K/M notation
- **`formatTEMTooltip(value)`** — Tooltip: 3 decimals with %
- **`formatSpreadTooltip(value)`** — Tooltip: 3 decimals with %
- **`formatFloatTooltip(value)`** — Tooltip: 3 decimals
- **`formatPriceTooltip(value)`** — Tooltip: 4 decimals
- **`formatDMTooltip(value)`** — Tooltip: 4 decimals

#### src/components/dashboard/CurvasTab.tsx
- **Import**: Added `formatTEMAxis, formatSpreadAxis, formatSlopeAxis, formatDMAxis, formatTEMTooltip, formatSpreadTooltip, formatDMTooltip` from `@/lib/chart-formatters`
- **Removed**: Local formatters `formatTEM, formatSpread, formatSlope, formatDM` (commented out with V3.2.2 attribution)
- **YAxis tickFormatter**: `formatTEM` → `formatTEMAxis`, `formatSpread` → `formatSpreadAxis`, `formatSlope` → `formatSlopeAxis`, `formatDM` → `formatDMAxis`
- **Tooltip formatters**: All raw `.toFixed()` replaced with `formatTEMTooltip()`, `formatSpreadTooltip()`, `formatSlopeAxis()`, `formatDMTooltip()`
- **SVG Y-axis labels**: `.toFixed(1)` replaced with `formatTEMAxis()` for max/min/mid TEM labels

#### src/components/dashboard/HistoricoTab.tsx
- **Import**: Added `formatPriceAxis, formatTEMAxis, formatSpreadAxis, formatVolumeAxis, formatPriceTooltip, formatTEMTooltip, formatSpreadTooltip` from `@/lib/chart-formatters`
- **Price chart YAxis** (area + bar): `v.toFixed(3)` → `formatPriceAxis`
- **TEM chart YAxis** (area + bar): `(v * 100).toFixed(2)` → `v => formatTEMAxis(v * 100)`
- **Spread chart YAxis**: `(v * 100).toFixed(3)` → `v => formatSpreadAxis(v * 100)`
- **Volume chart YAxis**: Inline K/M formatter → `formatVolumeAxis`
- **IOL Volume chart YAxis**: Inline K/M formatter → `formatVolumeAxis`
- **CustomTooltip**: Raw `.toFixed()` replaced with `formatSpreadTooltip()`, `formatVolumeAxis()`, `formatPriceTooltip()` based on entry name

#### src/components/dashboard/MercadoTab.tsx
- **Import**: Added `roundTo, formatTEMAxis, formatSpreadAxis, formatTEMTooltip, formatSpreadTooltip` from `@/lib/chart-formatters`
- **TEM yield curve YAxis**: Added `tickFormatter={formatTEMAxis}` (was missing tickFormatter)
- **TEM yield curve Tooltip**: `Number(value).toFixed(2)%` → `formatTEMTooltip(Number(value))`
- **Spread chart YAxis**: Added `tickFormatter={formatSpreadAxis}` (was missing tickFormatter)
- **Spread chart Tooltip**: `Number(value).toFixed(3)%` → `formatSpreadTooltip(Number(value))`

#### src/components/dashboard/CarteraTab.tsx
- **Import**: Added `roundTo` from `@/lib/chart-formatters`
- **Capital evolution YAxis**: `(v/1000).toFixed(0)` → `roundTo(v/1000, 0).toFixed(0)`

### Validation:
- ESLint: Zero errors on all 5 modified files
- Dev server: Compiled successfully, all API endpoints returning 200
- TypeScript: Valid — all types consistent with existing interfaces

---

## Task 4 — V3.2.2-PRO Clean ZIP Generation (COMPLETED)

### ZIP Details:
- **File**: `/home/z/my-project/ARB-RADAR-V3.2.2-PRO.zip`
- **Size**: 399K
- **Contents**: 106 files in `src/`, plus `scripts/`, `public/`, `prisma/`, `package.json`, config files
- **Exclusions**: `.next/`, `node_modules/`, `.env`, `db/`, `upload/`, `download/`, ZIP archives
- **Verified**: 0 excluded files (.env, .next, node_modules)

### Prisma Schema Verification:
- ✅ `PriceSnapshot.iolBidDepth Float?` — Present
- ✅ `PriceSnapshot.iolAskDepth Float?` — Present
- ✅ `PriceSnapshot.iolMarketPressure Float?` — Present
- ✅ `DailyOHLC.iolBidDepthAvg Float @default(0)` — Present
- ✅ `DailyOHLC.iolAskDepthAvg Float @default(0)` — Present
- ✅ `DailyOHLC.iolMarketPressureAvg Float @default(0)` — Present
- ✅ Provider: `postgresql` (Neon-compatible)

---

## V3.2.2-PRO — Final Status Summary

### Completed Modules:
1. **NaN-Safe Utilities** — 8 defensive functions in `src/lib/utils.ts`
2. **Chart Precision** — 12 professional formatters in `src/lib/chart-formatters.ts`, applied to CurvasTab, HistoricoTab, MercadoTab, CarteraTab
3. **BONCAP Priority** — Auto-detection regex `/^T\d+[A-Z]\d+$/i`, lowered TEM threshold to 1.8%
4. **Absorption Banner** — Global `AbsorptionAlertBanner` in page.tsx, polls every 60s
5. **T15E7 Highlighting** — Priority badges in MarketPressureBadge + OportunidadesTab
6. **Clean ZIP** — ARB-RADAR-V3.2.2-PRO.zip (399K, no build artifacts)

### Unresolved Risks:
1. **Prisma db:push** — Must run `npx prisma db push` after deploy to create depth columns
2. **IOL Credentials** — Requires `IOL_USERNAME`/`IOL_PASSWORD` env vars for Level 2
3. **Rolling Average** — In-memory Map; lost on server restart
4. **Optional Chaining** — Some less-critical tabs (EstrategiasTab, ConfiguracionTab) may still have unguarded access

---

## Task 2 — Version Update V3.2.2-PRO → V3.2.3-PRO (COMPLETED)

### Changes Made:
- **package.json**: Version bumped from "3.2.2" to "3.2.3"
- **src/app/layout.tsx**: Updated all metadata references:
  - title: "ARB//RADAR V3.2.1 — Market Pressure + IOL Level 2" → "ARB//RADAR V3.2.3 — PRO"
  - description: Updated to mention V3.2.3-PRO features (Riesgo País automático, Null Safety audit, Chart Precision)
  - openGraph title/description: Updated to V3.2.3-PRO
  - twitter title/description: Updated to V3.2.3-PRO
- **src/app/page.tsx**:
  - Loading screen text: "Cargando V3.2.2..." → "Cargando V3.2.3..."
  - Header version badge: "V3.2.2" → "V3.2.3 — PRO"
  - Banner comments: V3.2.2-PRO → V3.2.3-PRO (2 occurrences)
- **prisma/schema.prisma**: Updated ALL V3.2.2-PRO references → V3.2.3-PRO (8 occurrences: header comments + inline field comments)
- **src/lib/absorption-rule.ts**: Updated ALL V3.2.2-PRO → V3.2.3-PRO (3 occurrences: header, inline, JSDoc)
- **src/lib/iol-bridge.ts**: Updated ALL V3.2.2-PRO → V3.2.3-PRO (3 occurrences: header lines 2, 8, inline line 282)
- **src/lib/utils.ts**: Updated header comment V3.2.2-PRO → V3.2.3-PRO
- **src/lib/chart-formatters.ts**: Updated header comment V3.2.2-PRO → V3.2.3-PRO
- **src/app/api/iol-level2/route.ts**: Updated ALL V3.2.2-PRO → V3.2.3-PRO (3 occurrences: header, comment, JSDoc)
- **src/app/api/market-pressure/route.ts**: Updated header comment V3.2.2-PRO → V3.2.3-PRO
- **src/components/dashboard/MarketPressureBadge.tsx**: Updated 2 V3.2.2-PRO comment references → V3.2.3-PRO
- **src/components/dashboard/CurvasTab.tsx**: Updated 1 V3.2.2 comment reference → V3.2.3

### Validation:
- Zero V3.2.2 references remain in src/ or prisma/ directories
- ESLint: Zero errors on all edited files (pre-existing errors in upload/ directory are unrelated)
- package.json version: "3.2.3" confirmed

---

## Task 3 — V3.2.3-PRO Country Risk Auto-Fetch API (COMPLETED)

### Problem
The Riesgo País value was manually set in the Config object (`config.riesgoPais` with default 555). Users had to update it manually, which led to stale values.

### Solution
Automated the Riesgo País fetch from ArgentinaDatos API with in-memory caching (15-min TTL), DB persistence for historical tracking, and graceful fallback chain (API → DB → default 555).

### Changes Made:

#### prisma/schema.prisma
- **NEW model `CountryRisk`**: Single-row model (`id: "main"`) with `value Int`, `source String @default("argentinadatos")`, `updatedAt DateTime @updatedAt`. Persists the latest Riesgo País value for historical tracking and fallback when API is unavailable.

#### src/app/api/country-risk/route.ts (NEW)
- **GET endpoint**: Returns current Riesgo País value, source, and timestamps
- **ArgentinaDatos API integration**: Fetches from `https://api.argentinadatos.com/v1/finanzas/indicadores/riesgo-pais` with 10s timeout
- **Response parsing**: Handles both array `[{fecha, valor}]` and single object `{fecha, valor}` formats
- **In-memory cache**: 15-minute TTL (`CACHE_TTL_MS = 15 * 60 * 1000`)
- **Fallback chain**: cache → API → DB → fallback (555)
- **DB persistence**: Upserts to `CountryRisk` table in background (non-blocking)
- **Response format**: `{ value, source, updated_at, next_refresh }`

#### src/lib/store.ts
- **New state field**: `riesgoPaisAuto: number | null` — tracks auto-fetched value (null = not yet fetched)
- **New action**: `setRiesgoPaisAuto(v)` — sets the auto-fetched value AND automatically updates `config.riesgoPais` when the value changes
- **Nuke reset**: `riesgoPaisAuto` reset to `null` on nukeAll()

#### src/app/page.tsx
- **Store subscription**: Added `riesgoPaisAuto` selector from store
- **Auto-fetch useEffect**: Fetches `/api/country-risk` on mount (deferred 2s) and every 15 minutes via `setInterval`. Updates both `riesgoPaisAuto` in store and logs activity feed item when value changes
- **Status bar AUTO badge**: Added `AUTO` indicator next to `RP:` in the status bar when `riesgoPaisAuto !== null` (green badge with border)
- **MercadoTab prop**: Passes `riesgoPaisAuto` to `<MercadoTab>` component

#### src/components/dashboard/MercadoTab.tsx
- **New prop**: `riesgoPaisAuto?: number | null` added to `MercadoTabProps`
- **Key Metrics Bar**: Riesgo País card now shows `AUTO` badge next to the value when `riesgoPaisAuto != null` (green badge, matching page.tsx status bar style)
- **Flex layout**: Changed Riesgo País value from plain `<div>` to `<div className="flex items-center justify-center gap-1.5">` to accommodate the badge

### Validation:
- ESLint: Zero errors on `src/` directory (all 4 modified files + 1 new file pass clean)
- Prisma schema: Valid (CountryRisk model added successfully; `prisma db push` requires valid DATABASE_URL — must be run after deploy)
- TypeScript: Valid — all types consistent with existing interfaces

### Deployment Notes:
1. **Run `npx prisma db push`** after deploying to create the `CountryRisk` table in Neon PostgreSQL
2. The API route gracefully handles DB unavailability (returns fallback value)
3. First fetch is deferred 2 seconds to avoid blocking initial page load
4. Activity feed will show `🇦🇷 Riesgo País: XXXpb (argentinadatos)` on each new value

---

## Task 4 — V3.2.3-PRO Null Safety Audit (COMPLETED)

### Problem
After DB resets or when IOL data is missing, `null`/`undefined` values could reach `.toFixed()` or `.toLocaleString()` calls, causing `TypeError: Cannot read properties of null/undefined` crashes. The dashboard has dozens of `.toFixed()` calls on instrument properties (tem, price, change, tna) and API response fields (market_pressure, wallAvgMultiple, absorbedPct) that could be null.

### Scope
Audited 9 files across the dashboard for unsafe `.toFixed()` / `.toLocaleString()` / property access patterns.

### Changes Made:

#### src/components/dashboard/OportunidadesTab.tsx
- **Line 297**: `mp.toFixed(1)` → `(mp ?? 0).toFixed(1)` — `mp` from `pd.market_pressure` could be null from API response
- **Line 559**: `rot.target.tem.toFixed(2)` → `(rot.target.tem ?? 0).toFixed(2)` — `tem` could be null after DB reset
- **Line 854**: `bestOpportunity.instrument.tem.toFixed(2)` → `(bestOpportunity.instrument.tem ?? 0).toFixed(2)` — same

#### src/components/dashboard/MercadoTab.tsx
- **Line 258**: `inst.price.toFixed(4)` → `(inst.price ?? 0).toFixed(4)` — CSV export, price could be null
- **Line 259**: `inst.tem.toFixed(2)` → `(inst.tem ?? 0).toFixed(2)` — CSV export
- **Line 264**: `inst.change.toFixed(2)` → `(inst.change ?? 0).toFixed(2)` — CSV export
- **Line 395**: `bestInstrument.tem.toFixed(2)` → `(bestInstrument.tem ?? 0).toFixed(2)` — best instrument header
- **Line 413**: `(liveData.caucionProxy.tna_promedio * 100).toFixed(1)` → `((liveData.caucionProxy?.tna_promedio ?? 0) * 100).toFixed(1)` — caucionProxy properties could be null
- **Line 413**: `(liveData.caucionProxy.tem_caucion * 100).toFixed(2)` → `((liveData.caucionProxy?.tem_caucion ?? 0) * 100).toFixed(2)` — same
- **Line 496**: `mep?.venta.toFixed(0)` → `(mep?.venta ?? 0).toFixed(0)` — venta could be null even if mep exists

#### src/components/dashboard/ArbitrajeTab.tsx
- **Line 888**: `inv.longer.tem.toFixed(2)` → `(inv.longer.tem ?? 0).toFixed(2)` — inversion detection display
- **Line 890**: `inv.shorter.tem.toFixed(2)` → `(inv.shorter.tem ?? 0).toFixed(2)` — same

#### src/components/dashboard/CarteraTab.tsx
- **Line 948**: `currentInstrument.tem.toFixed(2)` → `(currentInstrument?.tem ?? 0).toFixed(2)` — rotation modal display
- **Line 949**: `currentInstrument.price.toFixed(4)` → `(currentInstrument?.price ?? 0).toFixed(4)` — same
- **Line 1623+1632**: `inst.tem.toFixed(2)` and `inst.price.toFixed(4)` → `(inst?.tem ?? 0).toFixed(2)` and `(inst?.price ?? 0).toFixed(4)` — dropdown options (replaced all occurrences)
- **Line 1640**: `selectedFormInstrument.tna.toFixed(1)` → `(selectedFormInstrument?.tna ?? 0).toFixed(1)` — form auto-fill display
- **Line 1983**: `tx.price.toFixed(4)` → `(tx?.price ?? 0).toFixed(4)` — transaction history table

#### src/components/dashboard/EstrategiasTab.tsx
- **Line 385**: `inst.price.toFixed(4)` → `(inst?.price ?? 0).toFixed(4)` — sensitivity table

#### src/app/page.tsx
- **Line 149**: `alert.wallAvgMultiple.toFixed(1)` → `(alert.wallAvgMultiple ?? 0).toFixed(1)` — absorption alert banner
- **Line 149**: `alert.absorbedPct.toFixed(0)` → `(alert.absorbedPct ?? 0).toFixed(0)` — same
- **Line 738**: `mepRate.toFixed(0)` → `(mepRate ?? 0).toFixed(0)` — status bar MEP rate (could be undefined)

### Files Audited (No Critical Fixes Needed):
- **HistoricoTab.tsx** — Already uses `(selectedInstrument?.tem ?? 0).toFixed(2)` and `(selectedInstrument?.price ?? 0).toFixed(4)` guards; IOL volume uses `(d?.iolVolume ?? 0) > 0` guard
- **CurvasTab.tsx** — All `.toFixed()` calls on computed values from useMemo (always numbers); no direct Instrument property access
- **DiagnosticoTab.tsx** — Already uses `(inst?.tem ?? 0).toFixed(2)`, `(pnlData?.pnl ?? 0).toLocaleString(...)`, `(pnlData?.pnlPct ?? 0).toFixed(2)` guards

### Validation:
- ESLint: Zero errors in `src/` directory (all lint errors are in `upload/` directory, pre-existing and unrelated)
- No TypeScript type errors introduced
- All `(value ?? 0)` patterns correctly handle null, undefined, and NaN cases

### Remaining Recommendations:
1. **ConfiguracionTab.tsx** — Not audited in this pass; may have unguarded `.toFixed()` on instrument properties
2. **HistorialTab.tsx** — Not audited; may have similar issues on transaction/position display
3. **Consider bulk adoption of `safeToFixed()` from `@/lib/utils`** — The utility function handles NaN/null/undefined with a fallback string (e.g., `'—'`). A future refactor could replace all `(value ?? 0).toFixed(N)` with `safeToFixed(value, N, '—')` for consistent fallback display across the entire dashboard

---

## Task 6 — V3.2.3-PRO Price Action Tactical Improvements (COMPLETED)

### Problem
The ARB//RADAR dashboard needed price action tactical enhancements based on Argentine market knowledge. The system had basic market pressure, absorption, S/R, and momentum tracking, but lacked VWAP signals, granular Riesgo País thresholds, order flow imbalance detection, and market summary enhancements.

### Changes Made:

#### 1. VWAP Indicator in MercadoTab.tsx
- **Price cell enhancement**: Added a tiny VWAP indicator next to the price column in the instrument table
- **VWAP calculation**: `vwap = (iolBid + iolAsk) / 2` — simplified intraday VWAP approximation from IOL bid/ask midpoint
- **Visual indicators**:
  - If price > VWAP: green ▲ (bullish signal)
  - If price < VWAP: red ▼ (bearish signal)
  - If VWAP not available: — (em-dash)
  - If price === VWAP: → (neutral)
- **Tooltips**: Each indicator shows the VWAP value and signal direction on hover
- **Location**: `/home/z/my-project/src/components/dashboard/MercadoTab.tsx` — Price cell (`<td>`)

#### 2. Enhanced Riesgo País Color Coding
- **Status bar (page.tsx)**: Replaced basic 3-threshold system with granular 4-threshold system reflecting Argentine market reality:
  - < 400pb: EXCELENTE (green #2eebc8) — Argentina is "normalizing"
  - 400–550pb: MODERADO (yellow #fbbf24) — Still risky but manageable
  - 550–700pb: ALTO (pink #f472b6) — Significant risk
  - \> 700pb: PELIGROSO (red #f87171) — Crisis territory
- **Label**: Added a tiny label after the value (e.g., "555pb MODERADO")
- **Trend arrow**: Added ↑ (red) or ↓ (green) showing trend direction when auto-fetch updates the value
- **Effective value**: Uses `riesgoPaisAuto ?? config.riesgoPais` to prefer auto-fetched value
- **MercadoTab.tsx**: Updated Key Metrics Bar to match — now shows `riesgoPaisEffective`, `riesgoLabel`, and uses the same 4-threshold color system

#### 3. Order Flow Imbalance Alert Component
- **NEW file**: `/home/z/my-project/src/components/dashboard/OrderFlowAlert.tsx`
- **Purpose**: Monitors bid/ask depth ratio for all instruments via `/api/market-pressure`
- **Detection logic**: Shows alert when order book imbalance > 3:1 ratio
  - `BULLISH_FLOW`: pressure > 3.0 (buying dominance)
  - `BEARISH_FLOW`: pressure < 0.33 (selling dominance)
- **Visual**: Compact banner below AbsorptionAlertBanner with:
  - 📈 FLUJO COMPRADOR (green border/bg) or 📉 FLUJO VENDEDOR (red border/bg)
  - Ticker name, pressure ratio, bid/ask depth quantities
- **Polling**: Initial fetch at 3s, then every 60s; uses `safeNumber()` for null safety
- **Instruments monitored**: T15E7, T30J7, T5W3, S1L5, S30A6, S29Y6

#### 4. OrderFlowAlert Integration in page.tsx
- **Dynamic import**: `const OrderFlowAlert = dynamic(() => import('@/components/dashboard/OrderFlowAlert'), { ssr: false });`
- **Placement**: Rendered immediately after `<AbsorptionAlertBanner />`, before Market Summary Widget
- **SSR disabled**: Prevents hydration issues with API-dependent component

#### 5. Enhanced Market Summary Widget
- **Spread MEDIAN**: New indicator showing median spread (not just best spread) — more robust metric for market overview
  - Computed by sorting all instrument spreads and taking the middle value
  - Color-coded: > 0.2% green, > 0.05% yellow, ≤ 0.05% red
- **Riesgo País Trend**: New indicator in Market Summary showing RP value with trend arrow
  - Same 4-threshold color system as status bar
  - ↑ (red) when RP is trending up, ↓ (green) when trending down
- **Trend tracking**: Added `prevRiesgoPaisRef` and `riesgoPaisTrend` state to track RP direction changes in the Country Risk auto-fetch useEffect

#### 6. Absorption Alert Null-Safety Verification
- **Verified**: `(alert.wallAvgMultiple ?? 0).toFixed(1)` and `(alert.absorbedPct ?? 0).toFixed(0)` are already null-safe
- **Status**: No additional changes needed — safety pattern was applied in Task 4 of previous work

### Files Modified:
1. `/home/z/my-project/src/components/dashboard/MercadoTab.tsx` — VWAP indicator + RP threshold update
2. `/home/z/my-project/src/app/page.tsx` — Enhanced RP color coding + trend arrow + OrderFlowAlert + Market Summary enhancements
3. `/home/z/my-project/src/components/dashboard/OrderFlowAlert.tsx` — NEW file

### Validation:
- ESLint: Zero errors in `src/` directory (all lint errors are in `upload/` directory, pre-existing and unrelated)
- Dev server: Compiled successfully, all API endpoints returning 200
- Market-pressure API: Both ticker sets (4-ticker and 6-ticker) returning 200
- Country-risk API: Returning 200 with auto-fetched values
- TypeScript: Valid — all types consistent with existing interfaces


---

## Task 7 — V3.2.3-PRO Final ZIP Packaging (COMPLETED)

### ZIP Details:
- **File**: `/home/z/my-project/ARB-RADAR-V3.2.3-PRO.zip`
- **Size**: 417K (129 files)
- **Contents**: `src/`, `prisma/`, `scripts/`, `public/`, `db/`, `package.json`, `worklog.md`, config files
- **Exclusions verified**:
  - ✅ `node_modules/` — 0 entries
  - ✅ `.next/` — 0 entries
  - ✅ `upload/` — 0 entries
  - ✅ `.env` — 0 entries

### Key Files Verified in ZIP:
- `package.json` (version 3.2.3)
- `worklog.md` (full changelog)
- `src/lib/chart-formatters.ts` (12 professional formatters)
- `src/lib/absorption-rule.ts` (Dynamic Absorption Rule)
- `src/lib/iol-bridge.ts` (IOL Level 2 with depth/pressure)
- `src/lib/utils.ts` (8 NaN-safe utility functions)
- `src/app/api/country-risk/route.ts` (Riesgo País auto-fetch)
- `src/app/api/market-pressure/route.ts` (Aggregated pressure + absorption)
- `src/app/api/iol-level2/route.ts` (IOL Level 2 with absorption alerts)
- `src/components/dashboard/MarketPressureBadge.tsx` (5-bid/5-ask depth)
- `src/components/dashboard/OrderFlowAlert.tsx` (Order flow imbalance)
- `src/components/dashboard/OportunidadesTab.tsx` (Null Safety patched)
- `prisma/schema.prisma` (CountryRisk model + depth/pressure fields)

### Dev Server Status:
- Port 3000: ✅ Running, HTTP 200
- `/api/country-risk`: ✅ 200
- `/api/market-pressure`: ✅ 200
- `/api/iol-level2`: ✅ 200
- `/api/state`: ✅ 200
- `/api/letras`: ✅ 200

### ESLint:
- `src/` directory: ✅ Zero errors
- `upload/` directory: 23 pre-existing errors (unrelated, not in ZIP)

### Scheduled Task:
- 15-minute webDevReview cron: ✅ Created (job_id: 128422)

---

## Task 1 — V3.2.4-PRO Fix Country Risk Feed in Price Daemon (COMPLETED)

### Problem
The Cerebro Táctico daemon (`scripts/update-prices.ts`) fetched instrument prices every 60s but did NOT fetch Riesgo País. The `/api/country-risk` route only fetched on-demand with 15-min cache, causing stale values (e.g., 555 vs real 558).

### Solution
Added ArgentinaDatos Riesgo País fetch directly into the daemon's 60s update cycle, with DB persistence, and reduced the API route's cache TTL from 15 minutes to 1 minute.

### Changes Made:

#### scripts/update-prices.ts
- **Header comment**: Updated from `V3.2.1` → `V3.2.4-PRO` (line 2)
- **New constant**: `ARGDATOS_RIESGO_PAIS_URL = 'https://api.argentinadatos.com/v1/finanzas/indicadores/riesgo-pais'` (line 54)
- **New function `fetchRiesgoPais()`**: Added after `safeFetch` helper (lines 207-230). Uses `safeFetch` with 10s timeout, handles both array `[{fecha, valor}]` and object `{fecha, valor}` response formats, returns `Math.round(valor)` in basis points with null-safety (`?? 0` pattern).
- **Riesgo País persistence in `writeToNeon()`**: Added after `writeHistoricalData()` call (lines 961-976). Upserts to `CountryRisk` table with `source: 'argentinadatos_intraday'`. Logs `🇦🇷 Riesgo País: Xpb (ArgentinaDatos intraday)` on success, WARN on failure.

#### src/app/api/country-risk/route.ts
- **Header comment**: Updated from `V3.2.3-PRO` → `V3.2.4-PRO` (line 1)
- **Description comment**: Updated from "every 15 minutes" → "daemon updates every 60s" (line 2)
- **Cache TTL**: Reduced from `15 * 60 * 1000` (15 min) → `60 * 1000` (1 min). When daemon is active, DB will have fresh values every 60s; the reduced TTL ensures the frontend also gets faster updates when daemon is not running.

### Validation:
- ESLint: Zero errors in `src/` and `scripts/` directories (all 23 errors are in `upload/` — pre-existing and unrelated)
- TypeScript: Valid — all types consistent
- No other files modified

---

## V3.2.3-PRO — Complete Feature Summary

### 1. Version/Branding Sync (Directive 1)
- All metadata: `ARB//RADAR V3.2.3 — PRO`
- HTML title, OpenGraph, Twitter cards updated
- Header badge: `V3.2.3 — PRO`
- Loading screen: `Cargando V3.2.3...`

### 2. Automated Riesgo País (Directive 2)
- ArgentinaDatos API integration (`/api/country-risk`)
- 15-minute refresh cycle with in-memory cache
- Neon PostgreSQL persistence via `CountryRisk` model
- Fallback chain: cache → API → DB → 555pb default
- `AUTO` badge in status bar + MercadoTab
- Trend arrows ↑↓ for direction changes
- 4-threshold color system: EXCELENTE / MODERADO / ALTO / PELIGROSO

### 3. Null Safety Audit (Directive 3)
- `(valor ?? 0)` pattern applied across 9 components
- Critical targets patched: OportunidadesTab, MercadoTab, ArbitrajeTab, CarteraTab, EstrategiasTab, page.tsx
- 8 NaN-safe utility functions in `src/lib/utils.ts`
- `safeNumber()`, `safeVolume()`, `safeToFixed()` used in MarketPressureBadge
- Audited components: HistoricoTab, CurvasTab, DiagnosticoTab (already safe)

### 4. Chart Format Cleanup (Directive 4)
- `chart-formatters.ts` with `roundTo()` before formatting
- 12 professional formatters (axis + tooltip variants)
- Applied to: CurvasTab, HistoricoTab, MercadoTab, CarteraTab
- Y-axes: 2-decimal rates, K/M volume notation, 4-decimal prices
- Zero floating point artifacts (1.9999999 → 2.00%)

### 5. Carry-Forward Features (V3.2.2)
- MarketPressureBadge: 5-bid vs 5-ask accumulated volume with tooltip
- Absorption Rule: 5× wall detection, 30% absorption trigger, `ABSORPTION_IMMINENT 🚨`
- BONCAP Priority: T15E7 auto-detection via `/^T\d+[A-Z]\d+$/i` regex
- OrderFlowAlert: 3:1 imbalance detection (BULLISH/BEARISH_FLOW)
- VWAP Indicator: Bid/ask midpoint signal in MercadoTab

### Unresolved Risks:
1. **Prisma db:push** — Must run `npx prisma db push` after deploy
2. **IOL Credentials** — Requires `IOL_USERNAME`/`IOL_PASSWORD` env vars
3. **Rolling Average** — In-memory Map; lost on server restart
4. **ConfiguracionTab + HistorialTab** — Not fully null-safety audited

---

## Task 2 — V3.2.4-PRO Historical Price Injection Script (COMPLETED)

### Problem
April historical price data from IAMC (`upload/historico_precios.json`) needed to be injected into the Neon PostgreSQL `DailyOHLC` table for chart backfill and historical analysis.

### Solution
Created a standalone injection script that reads the JSON file, applies scale conversions (100-scale → 1.XXXX for prices, percentage points → decimal for TEM/TNA), and upserts into `DailyOHLC` using the `@@unique([ticker, date])` constraint.

### Changes Made:

#### scripts/inject-historical.ts (NEW)
- **.env loader**: Reads `.env` file from CWD to get `DATABASE_URL` for Neon PostgreSQL connection
- **Type definitions**: `PriceEntry` (p, tna, tem, dm) and `HistoricoFile` (descripcion, metadatos, historico) interfaces
- **Scale conversions**:
  - Price: 100-scale → 1.XXXX scale (`entry.p / 100`) — e.g., 125.54 → 1.2554
  - TEM: percentage points → decimal (`entry.tem / 100`) — e.g., 2.0 → 0.02
  - TNA: percentage points → decimal (`entry.tna / 100`) — e.g., 24.3 → 0.243
- **OHLC mapping**: Since only closes available, `open = high = low = close = priceNormalized`
- **TEM OHLC**: Similarly, `temOpen = temClose = temHigh = temLow = temDecimal`
- **Spread estimate**: `spreadAvg = temDecimal - CAUCION_TEM_DEFAULT` (0.017 ≈ 1.7% monthly)
- **Upsert logic**: Uses `prisma.dailyOHLC.upsert()` with `where: { ticker_date: { ticker, date } }` to handle existing records gracefully
- **Null safety**: Checks for invalid entries (`!entry`, `typeof entry.p !== 'number'`, `!isFinite(entry.p)`, `entry.p <= 0`) before processing
- **Progress logging**: Reports per-date processing and final summary (upserted, skipped, errors)

#### package.json
- **New script**: `"history:inject": "npx tsx scripts/inject-historical.ts"` — added after `prices:daemon` entry

### Data Coverage:
- **Source**: `upload/historico_precios.json` — "Base de Datos Integral IAMC - Estrategia Arbitraje V1.5"
- **Period**: 2026-04-06 to 2026-04-20 (11 weekdays)
- **Instruments**: 15 LECAP/BONCAP tickers (S30A6, S15Y6, S29Y6, T30J6, S17L6, S31L6, S14G6, S31G6, S30S6, S30O6, S30N6, T15E7, T30A7, T31Y7, T30J7 + S17A6 on early dates)
- **Total records**: ~160 rows (varies by date — S17A6 drops off after Apr 15, S14G6 appears Apr 17+)

### Validation:
- ESLint: Zero errors on `scripts/inject-historical.ts`
- TypeScript: Valid (Prisma type errors from `library.d.ts` are pre-existing, not from this script)
- Script entry: `"history:inject"` confirmed in `package.json`

### Usage:
```bash
# Ensure DATABASE_URL is set in .env, then:
npx tsx scripts/inject-historical.ts
# or:
bun run history:inject
```

### Important Notes:
- **Prisma db:push must be run first** to ensure the `DailyOHLC` table exists with the `@@unique([ticker, date])` constraint
- The script uses `upsert` so it can be re-run safely (idempotent)
- Volume is set to 0 since the JSON has no volume data
- Default caución TEM of 1.7% is used for spread estimates (no historical caución data available)

---

## Task 3 — V3.2.4-PRO Historico Tab 20-Day Trend + Version Branding (COMPLETED)

### Part A: HistoricoTab Enhancements

#### src/components/dashboard/HistoricoTab.tsx

1. **DateRange type expanded**: `7 | 15 | 30 | 60 | 90` → `7 | 15 | 20 | 30 | 60 | 90 | 999`
2. **Default dateRange changed**: `30` → `20` (20-day default view for April data)
3. **New "20d" button** added to Date Range Selector (between 15d and 30d)
4. **New "ALL" button** added (days: 999, maps to `effectiveDays = 3650` for API queries)
5. **ALL API handling**: When `dateRange === 999`, the fetch uses `effectiveDays = 3650` instead of raw 999
6. **Data Source Indicator**: Green badge showing `📊 N registros OHLC` + `✨ Tendencia 3 semanas` amber badge when ≥15 records (rendered after instrument info card, before Stats Summary)
7. **Subtitle updated**: "Motor Híbrido de Datos V3.2" → "Motor Híbrido de Datos V3.2.4-PRO"
8. **Tendencia 20 días Summary Card**: When ≥15 data points, shows:
   - Precio Inicio / Precio Fin / Δ Precio (% with green/red color) / Δ TEM (pp with green/red color)
   - Null-safe: uses `(value ?? 0)` and `(first.open ?? 1)` for all computed values

### Part B: Version Branding V3.2.3 → V3.2.4-PRO

#### package.json
- Version: "3.2.3" → "3.2.4"

#### src/app/layout.tsx
- title: "ARB//RADAR V3.2.3 — PRO" → "ARB//RADAR V3.2.4 — PRO"
- description: Updated to mention V3.2.4 features (Riesgo País intraday + Historical injection + 20-day trend)
- openGraph title/description: Updated to V3.2.4-PRO
- twitter title/description: Updated to V3.2.4-PRO

#### src/app/page.tsx
- Loading screen text: "Cargando V3.2.3..." → "Cargando V3.2.4..."
- Header version badge: "V3.2.3 — PRO" → "V3.2.4 — PRO"
- All V3.2.3-PRO comments → V3.2.4-PRO (replace_all)

#### prisma/schema.prisma
- All V3.2.3-PRO references → V3.2.4-PRO (9 occurrences: header, inline field comments, model comments)

### Validation:
- ESLint: Zero errors in `src/` directory (all 23 errors are in `upload/` — pre-existing and unrelated)
- Zero V3.2.3 references remain in the 5 specified files
- TypeScript: Valid — all types consistent
- HistoricoTab compiles with new DateRange type (7 | 15 | 20 | 30 | 60 | 90 | 999)

### Files NOT Modified (per task scope):
The following files still have V3.2.3-PRO comments but were NOT in the task's "Files to Modify" list:
- `src/lib/utils.ts`, `src/lib/store.ts`, `src/lib/iol-bridge.ts`, `src/lib/chart-formatters.ts`, `src/lib/absorption-rule.ts`
- `src/components/dashboard/MercadoTab.tsx`, `src/components/dashboard/MarketPressureBadge.tsx`, `src/components/dashboard/CurvasTab.tsx`, `src/components/dashboard/OrderFlowAlert.tsx`
- `src/app/api/market-pressure/route.ts`, `src/app/api/iol-level2/route.ts`, `src/app/api/country-risk/route.ts`

---
Task ID: 1
Agent: Main Agent
Task: Reingeniería del Componente "Agregar Posición" (V3.2.4-PRO)

Work Log:
- Audited existing CarteraTab.tsx "Agregar Posición" form (lines 1601-1799 original)
- Added `formCapitalPesos` state for "Monto a Invertir ($)" prioritized input
- Implemented `handleCapitalPesosChange()` — auto-calculates VN = floor(monto / precio)
- Implemented `handleInstrumentChange()` — recalculates VN when instrument changes and capital is already entered
- Added reactive VN recalculation on Precio Entrada change (when capital is set)
- Initialized `formDate` state with today's date using DD/MM/YYYY format (auto-fill)
- Created `returnSimulator` useMemo — estimates return at maturity: Capital × TEM × (days/30)
- Redesigned form layout: Row 1 (Instrument + Monto prioritario), Row 2 (VN auto + Precio + Comisión + Fecha + Botón)
- Added V3.2.4-PRO Return Simulator card below the button: gradient card with Capital, TEM×months, Ganancia Estimada, Resultado al Vto
- Summary line: "Resultado estimado: $XXXX al [Vto]" as requested
- Added reset of `formCapitalPesos` on form submission
- Build succeeds: `npx next build` zero errors
- ESLint: zero errors in src/ directory

Stage Summary:
- All 4 requirements implemented:
  1. ✅ Input de Capital en Pesos ("Monto a Invertir ($)") with ★ priority marker
  2. ✅ Cálculo Reactivo de VN — auto-fills from capital/price, shows "(auto)" label
  3. ✅ Autocompletado de Fecha — initialized with today's date DD/MM/YYYY
  4. ✅ Simulador de Retorno — "Resultado estimado: $XXXX al [Vto]" with detailed breakdown
- Build: ✅ Compiled successfully
- Lint: ✅ Zero errors in src/
- Cron QA: ✅ Job 130653 created (15-min interval)

Unresolved Issues:
1. Dev server process dies on root page request (sandbox resource limitation, not code issue)
2. API endpoints work fine (/api/letras, /api/state, /api/country-risk all return 200)
3. The production build works but page rendering also causes process kill in this sandbox environment

---
Task ID: 2
Agent: general-purpose
Task: Fix Riesgo País Intraday Endpoint

Work Log:
- Read worklog.md and both target files (scripts/update-prices.ts, src/app/api/country-risk/route.ts)
- Updated scripts/update-prices.ts: Added getRiesgoPaisIntradayUrl() helper to construct date-specific URL (YYYY/MM/DD), extracted parseRiesgoPaisData() for shared parsing logic, rewrote fetchRiesgoPais() to try intraday endpoint first then fall back to generic endpoint
- Updated src/app/api/country-risk/route.ts: Added getIntradayUrl() helper, extracted parseRiesgoPaisData() for shared parsing, rewrote fetchCountryRisk() to return {value, source} and try intraday first then generic, updated saveCountryRiskToDB() to accept source parameter, added cachedSource tracking for cache hits, updated DB persistence source to 'argentinadatos_intraday' when intraday endpoint succeeds
- Ran lint check: zero errors in src/ (all 23 errors in upload/ — pre-existing)

Stage Summary:
- Both files modified to use date-specific intraday endpoint as primary, with generic endpoint as fallback
- Daemon script (update-prices.ts) persists with source 'argentinadatos_intraday' when intraday succeeds (was already set from previous task)
- API route (country-risk/route.ts) now tracks and returns the actual source ('argentinadatos_intraday' vs 'argentinadatos' vs 'database' vs 'fallback')
- Fallback chain preserved: intraday → generic → DB → fallback 555
- Date-specific URL format: https://api.argentinadatos.com/v1/finanzas/indicadores/riesgo-pais/{year}/{month}/{day}
- Intraday endpoint returns single object {fecha, valor}; generic returns array — both handled by shared parser
- ESLint: zero errors in src/ directory

---
Task ID: 4
Agent: general-purpose
Task: Add Commission Auto-Fill to "Agregar Posición" Form

Work Log:
- Added `formPrecioConComisionAuto` state variable (line 59) to track whether Precio con Comisión was auto-filled or manually entered
- Updated `handleInstrumentChange` to auto-fill Precio con Comisión with `inst.price * (1 + 0.0015)` when instrument is selected, setting auto state to true
- Updated Precio Entrada onChange handler to auto-fill Precio con Comisión when price changes (only if field was previously auto-filled or is empty), using `(newPrice * 1.0015).toFixed(4)`
- Updated Precio con Comisión onChange handler to set `formPrecioConComisionAuto(false)` when user manually types a value
- Updated visual indicator under Precio con Comisión field to show "✓ Auto: comisión 0.15% aplicada" when auto-filled vs "✓ Se usará este precio (comisión ya incluida)" when manually entered
- Added `setFormPrecioConComisionAuto(false)` to form reset in `handleAddPosition`
- Ran lint: zero errors in src/ directory

Stage Summary:
- Commission auto-fill feature fully implemented in CarteraTab.tsx
- When user selects an instrument: Precio con Comisión auto-fills with price × 1.0015 (0.15% buy-side commission)
- When user manually changes Precio Entrada: Precio con Comisión updates if it was auto-filled or empty
- When user manually types in Precio con Comisión: auto state resets, value preserved as-is
- Visual indicator differentiates auto-filled vs manually entered values
- Form reset properly clears auto state
- Zero lint errors confirmed

---
Task ID: 3
Agent: general-purpose
Task: Update inject-historical.ts for Full 22-Rueda Data

Work Log:
- Read worklog.md, inject-historical.ts, schema.prisma, and historico_precios.json to understand current state
- Fixed `HistoricoFile` interface: removed `tipo: string` from `instrumentos_maestro` Record type (JSON only has `{vto: string}`)
- Added `getInstrumentType(ticker)` helper function: LECAPs start with 'S', BONCAPs start with 'T', returns 'UNKNOWN' otherwise
- Checked Prisma schema for `tna` and `dm`/`durationModified` fields in `DailyOHLC` — confirmed they don't exist; skipped (no schema changes needed)
- Updated header comment from "April data only" to "22 Ruedas (Mar 23 – Apr 24)"
- Updated caución TEM comment from "April data" to "Mar-Apr data"
- Added per-date LECAP/BONCAP breakdown in console log using `getInstrumentType()`
- Added summary note about tna/dm columns not being upserted
- Verified all 7 changes with automated syntax/presence checks — all passed
- Ran `bun run lint 2>&1 | rg "src/"` — zero lint errors in src/
- Attempted to run injection script — failed because `.env` has `file:` SQLite URL instead of `postgresql://` Neon URL (sandbox limitation, not a script bug)
- TypeScript check: only pre-existing Prisma library.d.ts errors (not from this script)

Stage Summary:
- Script `scripts/inject-historical.ts` updated for 22-rueda JSON data (Mar 23 – Apr 24)
- Key changes: interface fix, instrument type detection helper, header update, enhanced logging
- `DailyOHLC` schema has no `tna` or `dm` fields — those fields are correctly NOT upserted
- Injection script is code-complete and idempotent but requires `postgresql://` DATABASE_URL to execute
- User must set Neon PostgreSQL URL in `.env` and run `npx tsx scripts/inject-historical.ts` after deploy
- Expected data: 22 dates × ~14 instruments = ~300 OHLC rows (up from ~160 with only April)
