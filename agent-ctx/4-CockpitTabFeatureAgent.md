# Task 4 — CockpitTab Feature Agent

## Task
Add 3 major features to the CockpitTab component:
1. Ticker Search/Filter
2. Sound Alert Toggle for GATILLAR YA
3. Export Cockpit Data to CSV

## Work Summary

### Feature 1: Ticker Search/Filter
- Added `searchQuery` state + `displayedScores` useMemo (case-insensitive partial match on `sortedScores`)
- Search input with `Search` icon from lucide-react + shadcn `Input` component in horizon filter row
- Styled consistently: small (h-7), monospace, teal focus ring, dark theme
- Empty state shows contextual message when search returns no results
- All rendered data now uses `displayedScores` (table, El Grito card, summary counts, methodology)

### Feature 2: Sound Alert Toggle for GATILLAR YA
- `soundEnabled` state from localStorage (`arbradar_cockpit_sound`)
- `audioCtxRef` (useRef<AudioContext>) to avoid recreating AudioContext
- `prevGatillarRef` (useRef<Set<string>>) to track previous GATILLAR YA tickers
- `playBeep()` using Web Audio API: OscillatorNode, square wave, 880Hz, 0.15 gain, 250ms
- Transition detection: plays beep only when NEW tickers enter GATILLAR YA state (not on first load)
- Toggle button in header: Bell (active, red) / BellOff (muted, gray)
- Reset prevGatillarRef when sound disabled to prevent stale triggers

### Feature 3: CSV Export
- `handleExportCSV` callback generates CSV from `displayedScores`
- 12 columns: Ticker, Type, Price, TEM, Volume, S/R Cercano, Distancia %, Inyección, Spread, CockpitScore, ActionScore, ActionLabel
- Blob + URL.createObjectURL + createElement('a') download pattern
- Filename: `arb-radar-cockpit-YYYY-MM-DD.csv`
- Download button with `Download` icon + shadcn `Button` (ghost, sm)
- Disabled when no data; "CSV" label hidden on mobile

### Files Modified
- `src/components/dashboard/CockpitTab.tsx` — all 3 features added
- `worklog.md` — work record appended

### Verification
- ESLint: 0 errors (`bun run lint -- --ignore-pattern 'upload/**' --ignore-pattern 'examples/**'`)
- Dev server: compiles and serves correctly on port 3000
