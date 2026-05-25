# Task 7b — Feature Agent: Watchlist + Price Alerts

## What was done
- Added Watchlist (Favorites) feature with useWatchlist() hook, star icons, filter toggle, counter badges
- Added Price Alert Thresholds feature with usePriceAlerts() hook, PriceAlertPopover, flash animation + beep
- Updated page.tsx to show watchlist count on Cockpit tab and price alert count in status bar
- Added CSS for price-alert-flash animation in globals.css
- Lint passes clean

## Files modified
1. `src/components/dashboard/CockpitTab.tsx` — New hooks, PriceAlertPopover component, star/bell icons in rows, filter toggle, counter badges
2. `src/app/page.tsx` — Added priceAlertsCount + watchlistCount state, tab badge, status bar counter
3. `src/app/globals.css` — Added price-alert-flash animation CSS

## Key architecture decisions
- useWatchlist() and usePriceAlerts() are defined at top of CockpitTab.tsx (not separate files)
- PriceAlertPopover uses shadcn/ui Popover + Input for the inline alert config UI
- Watchlist filter is integrated into the displayedScores pipeline alongside search
- Price alert threshold check runs in the same useEffect as GATILLAR YA detection
- Callbacks (onAlertsCountChange, onWatchlistCountChange) lift counts to page.tsx for tab badge + status bar
- localStorage keys: arbradar_watchlist, arbradar_price_alerts
