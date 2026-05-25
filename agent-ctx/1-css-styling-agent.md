# Task 1 — CSS Styling Agent

## Task: V7.0 DISRUPTIVE AESTHETIC TRANSFORMATION — globals.css NEXUS styles

## Summary
Replaced the entire V6.0 NEXUS CSS section in globals.css with the V7.0 enhanced version containing all 26 required visual upgrades.

## File Modified
- `src/app/globals.css` — Lines 1758-2022 (V6.0 NEXUS) → Lines 1758-2093 (V7.0 NEXUS)

## Changes Made
All 26 required CSS classes implemented:
1. `.neon-price` — 3-layer neon text-shadow
2. `.nexus-row` — Glassmorphism with gradient, blur, accent border, ::before overlay, hover glow
3. `.nexus-row-gatillar` — Pulsating red glow + `nexusRowFirePulse` keyframe
4. `.nexus-row-atractivo` — Teal subtle glow + hover glow
5. `.nexus-banner` — Premium glassmorphism header + top neon line ::after
6. `.nx-sticky-hdr` — Gradient header with neon border, blur, shadow
7. `.cockpit-scroll-container` — Dark scrollable container
8. `.nx-hmap-block` — 3D heatmap blocks with hover scale + glow
9. `.score-ring` — SVG drop-shadow filter
10. `.micro-score-bar-track`/`.micro-score-bar-fill` — Enhanced micro bars
11. `.cockpit-row-card` — Desktop row hover
12. `.cockpit-row-flash` — Flash animation keyframe
13. `.nx-alert-flash` — 4-step amber flash animation
14. `.nx-ctx-sep` — Teal border-top separator
15. `.nx-dot`/`.nx-dot-fire`/`.nx-dot-teal`/`.nx-dot-gray` — Status dots + `dotFirePulse`
16. `.nx-shimmer` — Text shimmer for GATILLAR YA + `nxShimmer` keyframe
17. `.nexus-badge-fire` — Fire badge glow + hover
18. `.nexus-badge-teal` — Teal badge glow
19. `.nexus-grito` — Animated gradient border + `gritoBorderGlow` keyframe
20. `.nexus-prox`/`.nexus-prox-bar` — Proximity indicator
21. `.nexus-method` — Method badge with left accent
22. `.nexus-pill` — Small pill badge
23. `.nexus-score-gauge` — Score ring wrapper
24. `.nexus-vol-badge` — Volume injection badge
25. `.cockpit-heatmap` — Heatmap container
26. Light mode overrides for 4 NEXUS classes

## @keyframes Added
- `nexusRowFirePulse` — Red pulsating glow for GATILLAR rows
- `cockpitRowFlash` — Teal flash for heatmap click scroll
- `nxAlertFlash` — 4-step amber alert flash
- `dotFirePulse` — Fire dot pulsating glow
- `nxShimmer` — Text shimmer sweep
- `gritoBorderGlow` — Border opacity pulse

## Verification
- `bun run lint` passes with 0 errors (excluding upload/examples)
- No other CSS sections were modified
