# Task 2: Deep UI/UX Redesign of CockpitTab.tsx + globals.css

## Summary
Completed a comprehensive UI/UX redesign of the cockpit table for extreme legibility, targeting scalper use-cases requiring sub-1-second decision-making.

## Files Modified
1. `/home/z/my-project/src/components/dashboard/CockpitTab.tsx`
2. `/home/z/my-project/src/app/globals.css`

## Changes Applied in CockpitTab.tsx (18 items)

### Desktop Header (already pre-applied)
- Changed grid-cols from `[28px_1fr_64px_52px_52px_64px_52px_52px_64px_52px_1fr]` to `[36px_1fr_88px_64px_60px_80px_72px_72px_80px_60px_1fr]`
- Changed px-3 py-2.5 → px-4 py-3.5, gap-1.5 → gap-2, text-[8px] → text-[9px]

### Desktop Data Row Grid
- Changed grid-cols to match new header proportions
- Added py-4 for row breathing space
- Changed gap-1.5 → gap-2

### Row Container
- Changed md:px-0 → md:px-1

### containIntrinsicSize (already pre-applied)
- Changed '0 56px' → '0 88px'

### Rank Badge Desktop (already pre-applied)
- text-[9px] → text-[10px], width/height 24→30, fontSize 9→10

### Ticker Name Desktop
- text-[11px] → text-sm

### Price Cell Desktop
- text-[11px] text-app-text2 → text-base font-bold text-app-text
- fmtNum(price, 4) → fmtNum(price, 2)

### TEM Cell Desktop
- text-[11px] text-app-text2 → text-sm font-semibold text-app-text2

### VOL Cell Desktop
- text-[11px] text-app-text2 → text-sm font-semibold text-app-text2

### S/R Cercano Desktop
- text-[11px] → text-sm
- text-[8px] → text-[10px] for label
- .toFixed(4) → .toFixed(2)

### Distancia S/R Desktop (MOST IMPORTANT)
- Added dramatic cell background with bg-[#f87171]/15 border for veryNearSR
- Added bg-[#fbbf24]/10 border for nearSR
- text-[11px] relative → text-base font-bold relative rounded-md px-1.5 py-1 -mr-1.5
- Left indicator bar: w-1 h-3 → w-1.5 h-4, enhanced glow shadows

### Volume Injection Desktop
- px-1.5 py-0.5 rounded-md text-[9px] → px-2.5 py-1 rounded-lg text-[11px]
- Added boxShadow with pulse glow

### Spread Neto Desktop
- text-[11px] → text-sm, fmtPct(score.spreadNeto, 3) → fmtPct(score.spreadNeto, 2)

### Cockpit Score Desktop
- text-base → text-xl

### Action Score Badge Desktop
- px-2 py-1 text-[9px] → px-2.5 py-1.5 text-[11px]
- gap-1 → gap-1.5
- ScoreRing size 22 → 28

### Context Row Desktop
- mt-1.5 pt-1.5 → mt-2 pt-2
- grid-cols-[28px_1fr] → grid-cols-[36px_1fr]
- gap-1.5 → gap-2
- All text-[8px] → text-[10px] for ΔTIR/Presion/Upside
- fmtPct(score.deltaTIR, 3) → fmtPct(score.deltaTIR, 2) (both desktop and mobile)
- text-[7px] → text-[9px] for action score reason and verdict reason

### Mobile Card Changes
- Ticker: text-[11px] → text-sm
- Price: fmtNum(price, 4) → fmtNum(price, 2)
- S/R level: .toFixed(3) → .toFixed(2)
- Spread: fmtPct(score.spreadNeto, 3) → fmtPct(score.spreadNeto, 2)
- ΔTIR: fmtPct(score.deltaTIR, 3) → fmtPct(score.deltaTIR, 2)
- Price/TEM/VOL row: text-[10px] → text-xs
- Context row labels: text-[8px] → text-[10px]
- Action score reason: text-[7px] → text-[9px]

## Changes Applied in globals.css (8 items)

1. **cockpit-scroll-container**: max-height 70vh → 78vh
2. **cockpit-context-separator**: border-top opacity 0.06→0.1, background 0.015→0.02
3. **rank-badge**: width/height 28px→32px, font-size 11px→12px
4. **table-header-enhanced**: gradient opacity 0.04→0.06, border opacity 0.1→0.15
5. **ticker-dot**: width/height 6px→8px
6. **NEW**: Added desktop row padding media query for cockpit-row-hover (padding-top/bottom: 0.625rem)
7. **cockpit-heatmap-block**: height 8px→10px
8. **cockpit-mobile-card**: padding 0.75rem→1rem

## Lint Result
- No errors in modified files. Pre-existing error in examples/websocket/frontend.tsx is unrelated.
