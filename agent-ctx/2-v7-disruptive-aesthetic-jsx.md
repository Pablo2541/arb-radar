# Task ID: 2 — V7.0 Disruptive Aesthetic Transformation (JSX)

## Agent: JSX Visual Transformation Agent

## Task
Update CockpitTab.tsx JSX to create DRAMATIC, OBVIOUS visual changes for a premium quantitative terminal aesthetic.

## Work Log

### Changes Made (all targeted JSX edits, no logic changes):

1. **HEADER** (line ~798):
   - Added `relative` class to nexus-banner div for overlay positioning
   - Changed title from `◆ NEXUS TERMINAL — QUANT X` to `◈ COCKPIT TÁCTICO — QUANT X`
   - Added scanline overlay div after gradient-line-animated (repeating-linear-gradient with teal transparency)

2. **STALE WARNING** (line ~855):
   - Changed `px-3 py-1.5 rounded-lg` to `px-4 py-2 rounded-xl`
   - Changed `border-[#fb923c]/20` to `border-[#fb923c]/25`
   - Added inline `boxShadow: '0 0 15px rgba(251,146,60,0.1)'`

3. **SUMMARY BAR** (line ~889):
   - Added `glass` class to nexus-banner for backdrop blur
   - Added `style={{ borderLeft: '3px solid rgba(46,235,200,0.2)' }}` for neon accent

4. **HEATMAP** (line ~991):
   - Wrapped MarketHeatmapStrip in a `<div className="relative">` with gradient glow overlay (from-[#2eebc8]/5 via-transparent to-[#f472b6]/5)

5. **HORIZON FILTER** (line ~1009):
   - Changed active button from `'bg-app-accent-dim text-[#2eebc8] border border-app-accent-border'` to `'bg-[#2eebc8]/15 text-[#2eebc8] border border-[#2eebc8]/30 shadow-[0_0_10px_rgba(46,235,200,0.15)]'`

6. **EMPTY STATE SPINNER** (line ~1077):
   - Changed `w-4 h-4` to `w-5 h-5`
   - Added `style={{ boxShadow: '0 0 10px rgba(46,235,200,0.4)' }}`

7. **EL GRITO CARD** (line ~394):
   - Added `boxShadow: gatillarScores.length > 0 ? '0 0 30px rgba(248,113,113,0.15)' : '0 0 15px rgba(244,114,182,0.1)'` to outer div style

8. **MOBILE CARDS** (line ~1168):
   - Added `rounded-xl` class
   - Added `style={{ background: isGatillar ? 'linear-gradient(135deg, rgba(248,113,113,0.08), rgba(21,29,46,0.9))' : isAtractivoAction ? 'linear-gradient(135deg, rgba(46,235,200,0.05), rgba(21,29,46,0.9))' : 'linear-gradient(135deg, rgba(21,29,46,0.85), rgba(15,23,38,0.7))' }}`

9. **MOBILE PRICE** (line ~1235):
   - Added `style={{ textShadow: '0 0 6px rgba(46,235,200,0.3)' }}` to price span

10. **DESKTOP PRICE** (line ~1387):
    - Added `style={{ textShadow: '0 0 8px rgba(46,235,200,0.5), 0 0 20px rgba(46,235,200,0.2)' }}` to neon-price div

11. **DESKTOP ACTION SCORE BADGE** (line ~1480):
    - Changed `boxShadow: isGatillar ? asc.glow : 'none'` to `boxShadow: isGatillar ? '0 0 16px rgba(248,113,113,0.4), 0 0 30px rgba(248,113,113,0.15)' : isAtractivoAction ? '0 0 10px rgba(46,235,200,0.25)' : 'none'`

## Verification
- ESLint: 0 errors (verified)
- Dev server: compiles and serves correctly (HTTP 200)
- Decimal precision: `.toFixed(4)` for prices/S/R, `.toFixed(2)` for distances/percentages — all preserved
- No logic, hooks, state, or data handling changed — only visual/styling JSX

## Files Modified
- `/home/z/my-project/src/components/dashboard/CockpitTab.tsx` — 11 targeted JSX edits
