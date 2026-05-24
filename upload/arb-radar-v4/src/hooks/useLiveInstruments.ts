// ════════════════════════════════════════════════════════════════════════
// V2.0.3 — useLiveInstruments Hook
//
// Polls /api/letras every 60 seconds for live market data.
// Converts LiveInstrument[] → Instrument[] for seamless integration
// with the existing ARB-RADAR dashboard.
//
// V2.0.2 FIXES:
// 1. Persists active (LIVE) state to localStorage — survives tab changes
// 2. Calls onNewInstruments callback when LIVE discovers new tickers
// 3. Tracks which tickers are LIVE vs OFFLINE
// 4. Includes delta_tir from API (live price vs last_close)
//
// V2.0.3 / V4.1.0 FIXES:
// 5. STALE indicator blinking fix — enhanced 4-tier stale strategy:
//    - Tier 1: refreshing_in_background is ALWAYS non-stale (hard guard)
//    - Tier 2: 10-second debounce prevents rapid on/off toggling
//    - Tier 3: 3-minute suppression after last fresh data
//    - Tier 4: Only show STALE when genuinely old + backend confirms
// 6. Track staleReason from API for smarter UI decisions
// ════════════════════════════════════════════════════════════════════════

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { Instrument, LiveInstrument, LetrasApiResponse } from '@/lib/types';

const POLL_INTERVAL = 60_000; // 60 seconds
const STATIC_EXPORT = process.env.NEXT_PUBLIC_STATIC_EXPORT;
const STORAGE_KEY_LIVE = 'arbradar_live_active';

// V4.0.9: Minimum time before we allow the frontend to show STALE again.
// Prevents rapid flickering when the backend does brief revalidations.
// Set to 3 minutes — if data was fresh less than 3 min ago, STALE is suppressed.
const STALE_SUPPRESSION_MS = 3 * 60_000;

// V4.1.0: Minimum time stale must remain in a given state before toggling.
// Prevents rapid on/off blinking (false positive visual noise).
const STALE_DISPLAY_DEBOUNCE_MS = 10_000; // 10 seconds

export interface LiveInstrumentsState {
  instruments: Instrument[];
  liveInstruments: LiveInstrument[];
  caucionProxy: { tna_promedio: number; tem_caucion: number; source: string } | null;
  loading: boolean;
  error: string | null;
  stale: boolean;
  staleReason: string | null;
  lastRefresh: Date | null;
  sources: {
    data912_notes: { ok: boolean; count: number; latency_ms: number } | null;
    data912_bonds: { ok: boolean; count: number; boncaps_matched: number; latency_ms: number } | null;
    argentinadatos: { ok: boolean; count: number; latency_ms: number } | null;
  } | null;
  stats: { total_instruments: number; lecaps: number; boncaps: number } | null;
  refresh: () => Promise<void>;
  active: boolean;
  setActive: (active: boolean) => void;
  /** Set of tickers that were updated by the last live fetch */
  liveTickers: Set<string>;
  /** Check if a specific ticker has live data from the API */
  isTickerLive: (ticker: string) => boolean;
  /** Map of ticker → delta_tir (from API: live price vs last_close) */
  deltaTIRMap: Map<string, number>;
}

/** Convert LiveInstrument → Instrument (ARB-RADAR internal format) */
function liveToInstrument(live: LiveInstrument): Instrument {
  const vsPlazoFijo = live.spread_neto > 0.005 ? 'SUPERIOR' :
                      live.spread_neto > 0 ? 'MARGINAL' :
                      live.spread_neto > -0.005 ? 'INFERIOR' : 'MUY INFERIOR';

  return {
    ticker: live.ticker,
    type: live.type,
    expiry: live.fecha_vencimiento, // ISO format, will be displayed as-is
    days: live.days_to_expiry,
    price: live.last_price,
    change: live.change_pct,
    tna: live.tna * 100,       // convert decimal to percentage
    tem: live.tem * 100,       // convert decimal to percentage
    tir: live.tem * 100,       // In ARB-RADAR, tir = TEM (monthly rate)
    gananciaDirecta: live.ganancia_directa * 100, // convert to percentage
    vsPlazoFijo,
    dm: undefined, // Not available from live data
    // V3.4: IOL Level 2 fields — populated by /api/letras enrichment or /api/iol-level2
    iolVolume: live.iol_volume,
    iolBid: live.iol_bid,
    iolAsk: live.iol_ask,
    iolBidDepth: live.iol_bid_depth,
    iolAskDepth: live.iol_ask_depth,
    iolMarketPressure: live.iol_market_pressure,
    iolStatus: live.iol_status,
    // V3.4: data912 notional volume — fallback for VOL column when IOL is offline
    data912Volume: live.volume,
  };
}

/** Read persisted LIVE state from localStorage */
function getPersistedActive(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const stored = localStorage.getItem(STORAGE_KEY_LIVE);
    return stored === 'true';
  } catch {
    return false;
  }
}

/** Persist LIVE state to localStorage */
function persistActive(value: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY_LIVE, String(value));
  } catch {
    // Storage unavailable
  }
}

export function useLiveInstruments(): LiveInstrumentsState {
  const [liveInstruments, setLiveInstruments] = useState<LiveInstrument[]>([]);
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [caucionProxy, setCaucionProxy] = useState<{ tna_promedio: number; tem_caucion: number; source: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [sources, setSources] = useState<LiveInstrumentsState['sources']>(null);
  const [stats, setStats] = useState<LiveInstrumentsState['stats']>(null);
  // V2.0.2: Initialize active from localStorage
  const [active, setActiveRaw] = useState<boolean>(getPersistedActive);
  const [liveTickers, setLiveTickers] = useState<Set<string>>(new Set());
  const [deltaTIRMap, setDeltaTIRMap] = useState<Map<string, number>>(new Map());
  const [stale, setStale] = useState(false);
  const [staleReason, setStaleReason] = useState<string | null>(null);
  const hasDataRef = useRef(false);
  const lastFreshRef = useRef<number>(0); // V4.0.9: timestamp of last successful non-stale fetch
  // V4.1.0: Track last stale state change time to debounce rapid oscillation
  const lastStaleToggleRef = useRef<number>(0);
  // V4.1.0: Ref mirror of stale state so fetchData can read current value
  // without needing stale in its dependency array (avoids interval reset loop)
  const staleRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  // Keep staleRef in sync with stale state
  useEffect(() => {
    staleRef.current = stale;
  }, [stale]);

  // V2.0.2: Wrap setActive to persist to localStorage
  const setActive = useCallback((value: boolean) => {
    persistActive(value);
    setActiveRaw(value);
  }, []);

  const fetchData = useCallback(async () => {
    // SWR: Only show full loading spinner on first fetch (no existing data)
    // On subsequent fetches, just mark as stale while revalidating in background
    const isFirstFetch = !hasDataRef.current;
    if (isFirstFetch) {
      setLoading(true);
    }
    setError(null);

    try {
      // For static export, we can't use the server-side merge
      if (STATIC_EXPORT) {
        const res = await fetch('https://data912.com/live/arg_notes', {
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) throw new Error(`API returned ${res.status}`);
        setLiveInstruments([]);
        setInstruments([]);
        setLiveTickers(new Set());
        return;
      }

      const res = await fetch('/api/letras', {
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) {
        throw new Error(`API returned ${res.status}`);
      }

      const data = await res.json() as LetrasApiResponse;

      if (!data.instruments || !Array.isArray(data.instruments)) {
        throw new Error('Invalid response format');
      }

      setLiveInstruments(data.instruments);
      const mappedInstruments = data.instruments.map(liveToInstrument);
      setCaucionProxy(data.caucion_proxy ?? null);

      // Mark data as available
      hasDataRef.current = data.instruments.length > 0;

      // Track which tickers are live from the API
      const newLiveTickers = new Set(data.instruments.map(i => i.ticker));
      setLiveTickers(newLiveTickers);

      // Build delta_tir map from API response
      const newDeltaTIRMap = new Map<string, number>();
      for (const inst of data.instruments) {
        if (inst.delta_tir != null && isFinite(inst.delta_tir)) {
          newDeltaTIRMap.set(inst.ticker, inst.delta_tir * 100);
        }
      }
      setDeltaTIRMap(newDeltaTIRMap);

      // Handle sources structure
      setSources(data.sources ?? null);
      setStats(data.stats ?? null);
      setLastRefresh(new Date());

      // V4.1.0: Stale handling — enhanced 4-tier strategy to eliminate flickering:
      // 1. If backend says "refreshing_in_background" → completely ignore STALE.
      //    Data is still valid, just being revalidated. No visual change at all.
      // 2. Debounce: Don't toggle stale state more than once per 10 seconds.
      // 3. If backend says truly stale BUT data was fresh <3 min ago → suppress STALE.
      // 4. Only show STALE if data was fresh >3 min ago AND backend confirms stale.
      const apiReportsStale = (data as unknown as Record<string, unknown>).stale === true;
      const staleReasonFromAPI = (data as unknown as Record<string, unknown>).stale_reason as string | undefined;
      const now = Date.now();

      // Always track the API's stale_reason for UI context
      setStaleReason(staleReasonFromAPI ?? null);

      if (staleReasonFromAPI === 'refreshing_in_background') {
        // Tier 1: Background refresh is NOT stale — data is still valid.
        // Completely ignore the stale flag. No visual change.
        // V4.1.0: Also prevent any debounce override — refreshing_in_background
        // is ALWAYS non-stale, period.
        setStale(false);
        // Don't reset lastFreshRef — data is still from the same freshness epoch
      } else if (apiReportsStale) {
        // Tier 2+3+4: Backend reports real stale. Check suppression and debounce.
        const timeSinceFresh = now - lastFreshRef.current;
        const timeSinceLastToggle = now - lastStaleToggleRef.current;

        if (timeSinceFresh < STALE_SUPPRESSION_MS) {
          // Tier 3: Too recent to show STALE — suppress the visual indicator
          setStale(false);
        } else if (timeSinceLastToggle < STALE_DISPLAY_DEBOUNCE_MS) {
          // Tier 2 (NEW): Debounce — don't toggle stale within 10 seconds
          // of the last toggle. Prevents rapid on/off blinking.
          // Keep current stale state as-is.
        } else {
          // Tier 4: Data is genuinely old AND backend confirms stale AND
          // debounce period has passed → show STALE
          setStale(true);
          lastStaleToggleRef.current = now;
        }
      } else {
        // Backend says fresh → record timestamp and clear stale
        lastFreshRef.current = now;
        const timeSinceLastToggle = now - lastStaleToggleRef.current;
        if (timeSinceLastToggle >= STALE_DISPLAY_DEBOUNCE_MS || !staleRef.current) {
          setStale(false);
          lastStaleToggleRef.current = now;
        }
        // If within debounce window, keep current stale state (don't flicker off)
      }

      // V4.0.8: REMOVED frontend IOL Level 2 enrichment.
      // The backend /api/letras now does IOL enrichment in Phase 2
      // (non-blocking, after core data is saved FRESH). The previous
      // frontend enrichment was redundant, added 10+ seconds of latency,
      // and blocked the main data pipeline. IOL data now arrives via
      // the backend's async Phase 2 update.

      setInstruments(mappedInstruments);
    } catch (err) {
      // SWR: If we have existing data, mark as stale but DON'T clear it
      if (hasDataRef.current) {
        // V4.1.0: Apply same 3-minute suppression + debounce to network errors
        const timeSinceFresh = Date.now() - lastFreshRef.current;
        const timeSinceLastToggle = Date.now() - lastStaleToggleRef.current;
        if (timeSinceFresh >= STALE_SUPPRESSION_MS && timeSinceLastToggle >= STALE_DISPLAY_DEBOUNCE_MS) {
          setStale(true);
          lastStaleToggleRef.current = Date.now();
        }
        // Keep existing data visible — don't set error that would block UI
      } else {
        setError(err instanceof Error ? err.message : 'Failed to fetch live data');
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  // Start/stop polling based on active state
  useEffect(() => {
    mountedRef.current = true;

    if (active) {
      // Fetch immediately when activating
      lastFreshRef.current = 0; // Reset freshness tracking on activate
      fetchData();

      // Then poll every 60 seconds
      intervalRef.current = setInterval(fetchData, POLL_INTERVAL);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      // V2.0.2: Do NOT clear liveTickers when deactivating — 
      // we keep them to show "DATA OFFLINE" indicators
      // Clear the instruments list though (go back to manual data)
      setInstruments([]);
      setLiveInstruments([]);
      setStale(false);
      setStaleReason(null);
      hasDataRef.current = false;
    }

    return () => {
      mountedRef.current = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [active, fetchData]);

  const isTickerLive = useCallback((ticker: string) => {
    return liveTickers.has(ticker);
  }, [liveTickers]);

  return {
    instruments,
    liveInstruments,
    caucionProxy,
    loading,
    error,
    stale,
    staleReason,
    lastRefresh,
    sources,
    stats,
    refresh: fetchData,
    active,
    setActive,
    liveTickers,
    isTickerLive,
    deltaTIRMap,
  };
}
