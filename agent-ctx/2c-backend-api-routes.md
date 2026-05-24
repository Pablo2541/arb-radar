# Task 2-c: Backend API Routes

## Completed Work

### Files Created

1. **`/home/z/my-project/src/app/api/letras/route.ts`**
   - Live data merge from data912 (arg_notes + arg_bonds) + ArgentinaDatos (letras + plazoFijo)
   - In-memory cache with 55s TTL and stale-while-revalidate pattern
   - Merges LECAPs from arg_notes and BONCAPs from arg_bonds with ArgentinaDatos metadata
   - Computes TIR, TEM, TNA, spread_neto, ganancia_directa, payback_days, delta_tir
   - Caución proxy derived from average plazo fijo TNA minus 2pp haircut
   - Rate-limited external API calls with 400ms delays and 3s timeouts

2. **`/home/z/my-project/src/app/api/dolar/route.ts`**
   - Proxy to dolarapi.com/v1/dolares
   - 5-minute cache TTL
   - Graceful fallback to stale data on fetch failure

3. **`/home/z/my-project/src/app/api/cockpit-score/route.ts`**
   - Depends on `@/lib/types` (CockpitScore, Instrument, Config) and `@/lib/calculations` (calculateCockpitScore)
   - Fetches from /api/letras internally, transforms into CockpitScore objects
   - Supports `?horizon=N` query parameter (default 45 days)
   - 50s cache TTL with stale fallback
   - Returns verdict summary counts (SALTO_TACTICO, PUNTO_CARAMELO, etc.)

## Dependencies (NOT YET CREATED by this agent)

- `src/lib/types.ts` — Must export: `CockpitScore`, `Instrument`, `Config` types
- `src/lib/calculations.ts` — Must export: `calculateCockpitScore` function

These are expected to be provided by another agent or task.
