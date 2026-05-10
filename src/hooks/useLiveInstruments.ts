// ════════════════════════════════════════════════════════════════════════
// V3.5 — useLiveInstruments Hook (The Price Action Engine)
//
// Polls /api/letras every 60 seconds for live market data.
// Converts LiveInstrument[] → Instrument[] for seamless integration
// with the existing ARB-RADAR dashboard.
//
// V3.5 KEY CHANGES:
// 1. REMOVED duplicate IOL fetch from client — the server /api/letras
//    already performs IOL Level-2 enrichment. The old client-side
//    fetch to /api/iol-level2 would overwrite valid server-enriched
//    data with zeros when IOL was offline (weekends, off-hours).
// 2. Maps iol_volume_notional and iol_volume_qty from API response
// 3. Preserves last valid data when API returns stale/error — SWR pattern
//
// V2.0.2 ORIGINAL FIXES (preserved):
// 1. Persists active (LIVE) state to localStorage — survives tab changes
// 2. Calls onNewInstruments callback when LIVE discovers new tickers
// 3. Tracks which tickers are LIVE vs OFFLINE
// 4. Includes delta_tir from API (live price vs last_close)
// ════════════════════════════════════════════════════════════════════════

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { Instrument, LiveInstrument, LetrasApiResponse } from '@/lib/types';

const POLL_INTERVAL = 60_000; // 60 seconds
const STATIC_EXPORT = process.env.NEXT_PUBLIC_STATIC_EXPORT;
const STORAGE_KEY_LIVE = 'arbradar_live_active';

export interface LiveInstrumentsState {
  instruments: Instrument[];
  liveInstruments: LiveInstrument[];
  caucionProxy: { tna_promedio: number; tem_caucion: number; source: string } | null;
  loading: boolean;
  error: string | null;
  stale: boolean;
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
    expiry: live.fecha_vencimiento,
    days: live.days_to_expiry,
    price: live.last_price,
    change: live.change_pct,
    tna: live.tna * 100,
    tem: live.tem * 100,
    tir: live.tem * 100,
    gananciaDirecta: live.ganancia_directa * 100,
    vsPlazoFijo,
    dm: undefined,
    // V3.4: IOL Level 2 fields — populated by /api/letras enrichment
    iolVolume: live.iol_volume,
    iolBid: live.iol_bid,
    iolAsk: live.iol_ask,
    iolBidDepth: live.iol_bid_depth,
    iolAskDepth: live.iol_ask_depth,
    iolMarketPressure: live.iol_market_pressure,
    iolStatus: live.iol_status,
    // V3.4: data912 notional volume — fallback for VOL column when IOL is offline
    data912Volume: live.volume,
    // V3.5: IOL Volume Separation — PRIMARY volume for radar comparison
    iolVolumeNotional: live.iol_volume_notional,  // ARS monto from IOL
    iolVolumeQty: live.iol_volume_qty,            // títulos from IOL
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
  const [active, setActiveRaw] = useState<boolean>(getPersistedActive);
  const [liveTickers, setLiveTickers] = useState<Set<string>>(new Set());
  const [deltaTIRMap, setDeltaTIRMap] = useState<Map<string, number>>(new Map());
  const [stale, setStale] = useState(false);
  const hasDataRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  const setActive = useCallback((value: boolean) => {
    persistActive(value);
    setActiveRaw(value);
  }, []);

  const fetchData = useCallback(async () => {
    // SWR: Only show full loading spinner on first fetch (no existing data)
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

      // ── V3.5: Single source of truth — /api/letras ──────────────
      // The server route already performs:
      //   1. data912 merge (notes + bonds)
      //   2. ArgentinaDatos merge (VPV + vencimiento)
      //   3. IOL Level-2 enrichment (if credentials configured)
      //   4. SWR stale cache on total source failure
      //
      // NO MORE client-side IOL fetch — it was overwriting valid
      // server-enriched data with zeros when IOL was offline.
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

      // SWR: Data is fresh again
      setStale(false);

      // Check if API itself reports stale data
      if ((data as unknown as Record<string, unknown>).stale === true) {
        setStale(true);
      }

      // ── V3.5: NO MORE client-side IOL enrichment ────────────────
      // Previously, this block fetched /api/iol-level2 from the client
      // and merged IOL data. This was REDUNDANT because /api/letras
      // already enriches with IOL data server-side. Worse, when IOL
      // was offline (weekends/off-hours), this client fetch returned
      // zeros that OVERWROTE the valid server-enriched data.
      //
      // The fix: trust the server. /api/letras is the single source
      // of truth. If IOL is offline, the server leaves iol_* fields
      // as undefined (not zeros), preserving data912/ArgDatos values.
      // ─────────────────────────────────────────────────────────────

      setInstruments(mappedInstruments);
    } catch (err) {
      // SWR: If we have existing data, mark as stale but DON'T clear it
      if (hasDataRef.current) {
        setStale(true);
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
      fetchData();
      intervalRef.current = setInterval(fetchData, POLL_INTERVAL);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      // V2.0.2: Do NOT clear liveTickers when deactivating — 
      // we keep them to show "DATA OFFLINE" indicators
      setInstruments([]);
      setLiveInstruments([]);
      setStale(false);
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