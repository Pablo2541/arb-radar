---
Task ID: 1
Agent: Main Agent
Task: Fix market hours from 17:00 to 18:00 + fix TIR data accuracy bugs

Work Log:
- Found `isMarketHours()` in `scripts/update-prices.ts` line 208: changed `hour < 17` → `hour < 18`
- Found `marketOpen` in `src/app/page.tsx` line 571: changed `hour < 17` → `hour < 18`
- Changed badge label from "10–17h" → "10–18h" in page.tsx line 777
- Fixed IOL avg daily volume estimation from 7 hours to 8 hours (line 469)
- Fixed PriceSnapshot `tir` field: was storing `inst.tna` (TNA value) → now stores `inst.tir` (TIR value) in line 832
- Fixed storeInstruments `tir` field: was storing `inst.tem * 100` (TEM value) → now stores `inst.tir * 100` (TIR value) in line 1043
- Verified data pipeline: API endpoints `/api/price-history` and `/api/price-history?type=tickers` both return data correctly
- DB has 15 tickers, 15 OHLC records, 30 snapshots — all accessible via API
- Ticker consistency confirmed: same tickers in IOL API, DB, and Dashboard

Stage Summary:
- Market hours extended from 17:00 → 18:00 (both daemon script and frontend badge)
- TIR data accuracy fixed (was storing wrong values in 2 places)
- IOL volume estimation updated from 7h to 8h trading window
- Data pipeline verified working: daemon writes → DB stores → API reads → Frontend displays
