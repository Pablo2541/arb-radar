
---

## Phase 11: V1.5.2 CSS Fixes + Metadata + Dollar Variation (Cron Review Session)

### Task 11.1: Fix Page Title and Metadata (BUG)
- **File**: `src/app/layout.tsx`
- **Issue**: Page title was "Z.ai Code Scaffold - AI-Powered Development" — wrong branding
- **Fix**: Updated all metadata to ARB//RADAR branding:
  - Title: "ARB//RADAR V1.5 — Arbitraje Argentino"
  - Description: Spanish-language LECAP/BONCAP arbitrage dashboard
  - Keywords: arbitraje, LECAP, BONCAP, Argentina, tasas, curvas, dólar MEP, CCL
  - Authors: "ARB Radar"
  - Favicon: Changed to `/logo.svg` (local)

### Task 11.2: Fix HTML Language Attribute (BUG)
- **File**: `src/app/layout.tsx`
- **Issue**: `<html lang="en">` — app is in Spanish
- **Fix**: Changed to `<html lang="es" suppressHydrationWarning>`

### Task 11.3: Add Dollar Variation Badge (NEW FEATURE)
- **File**: `src/lib/types.ts` — Added `variacion?: number` to DolarRate
- **File**: `src/components/dashboard/MercadoTab.tsx` — Added `fmtVar()` helper:
  - Positive: ▲ green (#2eebc8), Negative: ▼ red (#f87171), Zero: → gray
  - Applied to all 5 dollar cards (Oficial, Tarjeta, MEP, CCL, Blue)

### Task 11.4: V1.5.2 Dark Mode CSS Fixes (carried from previous session)
- CurvasTab: All chart tooltips forced to dark bg (#111827) with white text
- CurvasTab: Pendiente chart X-axis = category ticker labels in white
- MercadoTab: All chart tooltips forced dark bg with white text
- CarteraTab: Both select dropdowns forced bg-[#111827] text-white

### Lint: Clean | Build: Passing | Server: Running (port 3000)

### Unresolved Issues
- Sandbox kills background processes every ~30-45s
- Market status doesn't account for Argentine holidays
- CarteraTab cosmetic JSX warning (non-blocking)

### Priority Recommendations
1. Add MEP/CCL spread calculation as arbitrage signal
2. Add "Dólar Cripto" card as 6th dollar type
3. Add export-to-PNG for charts
4. Add data snapshot with Argentina timezone
5. Production deployment for stable hosting
