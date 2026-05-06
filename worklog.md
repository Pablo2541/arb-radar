---
Task ID: 1
Agent: Main Agent
Task: ARB//RADAR V3.4 PRO TERMINAL — Final Packaging & Compliance Check

Work Log:
- Explored full codebase: page.tsx, store.ts, types.ts, CockpitTab.tsx, useLiveInstruments.ts, iol-bridge.ts, calculations.ts, sampleData.ts, all API routes, prisma schema
- Fixed effectiveInstruments merge in page.tsx to include IOL Level 2 fields (iolVolume, iolBid, iolAsk, iolBidDepth, iolAskDepth, iolMarketPressure, iolStatus) and data912Volume from live data
- Added `data912Volume` field to Instrument type (types.ts) — fallback for VOL column when IOL is offline
- Updated CockpitTab VOL column to use IOL volume (primary) → data912 volume (fallback) → "—" (no data)
- Updated liveToInstrument() in useLiveInstruments.ts to map data912Volume from live.volume
- Verified .env has IOL_USERNAME and IOL_PASSWORD fields ready for user to fill
- Verified L2 LED 3-state logic (online/no credentials/failed) in page.tsx
- Verified forceSyncToDb() called on mount for Zustand → localStorage → Neon DB persistence
- Verified externalHistory and simulations are persisted to DB
- Verified no hardcoded 554pb/558pb anywhere in codebase
- Verified riesgoPais default is 528 (current value) in all 3 locations
- Verified commission is IMMUTABLE at 0.15% (price × 1.0015) across all files
- Generated ARB-RADAR-V3.4-PRO-TERMINAL.zip at /home/z/ (340KB, 158 files)

Stage Summary:
- V3.4 package ready for delivery
- IOL connectivity: .env ready, L2 LED linked to credential validation, VOL mapped to /api/letras enrichment
- Neon persistence: Zustand → localStorage → Neon DB flow verified, forceSyncToDb() active
- No hardcoded 554/558, riesgoPais=528 default, commission 0.15% IMMUTABLE
- ZIP: /home/z/ARB-RADAR-V3.4-PRO-TERMINAL.zip (340KB)

---
Task ID: 2
Agent: Main Agent
Task: ZIP regeneration and V3.4 compliance re-verification

Work Log:
- User reported not finding the ZIP file
- Verified ZIP exists at /home/z/ARB-RADAR-V3.4-PRO-TERMINAL.zip
- Ran comprehensive V3.4 compliance audit via Explore agent — ALL 8 sub-requirements PASS
- Regenerated fresh ZIP excluding .next, node_modules, bun.lock, .git, download/, skills/, images, old ZIPs
- New ZIP: /home/z/ARB-RADAR-V3.4-PRO-TERMINAL.zip (314 KB, 151 files)
- Also copied to /home/z/my-project/download/ARB-RADAR-V3.4-PRO-TERMINAL.zip for easy access
- Created QA cron job (every 15 min, webDevReview)

Stage Summary:
- V3.4 compliance: FULL (8/8 requirements pass)
- ZIP locations: /home/z/ARB-RADAR-V3.4-PRO-TERMINAL.zip AND /home/z/my-project/download/ARB-RADAR-V3.4-PRO-TERMINAL.zip
- Dev server running, IOL L2 APIs responding (200 status codes)
- QA cron active for ongoing maintenance
