// ════════════════════════════════════════════════════════════════════════
// V3.5 — useLiveInstruments Hook (The Price Action Engine)
//
// Polls /api/letras every 60 seconds for live market data.
// Converts LiveInstrument[] → Instrument[] for seamless integration
// with the existing ARB-RADAR dashboard.
//
// V3.5 CHANGES:
// 1. REMOVED redundant client-side IOL L2 fetch (/api/iol-level2).
//    The server (/api/letras) already performs IOL enrichment.
//    Client-side fetch was overwriting valid data with zeros when
//    IOL was offline (weekends, after-hours).
// 2. Added hold-last-valid IOL data mechanism: when IOL is offline,
//    the last valid IOL fields are preserved instead of being zeroed.
// 3. Added iol_volume_notional / iol_volume_qty mapping from V3.5 API.
//
// V2.0.2 FIXES (preserved):
// 1. Persists active (LIVE) state to localStorage — survives tab changes
// 2. Tracks which tickers are LIVE vs OFFLINE
// 3. Includes delta_tir from API (live price vs last_close)
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
    expiry: live.fecha_vencimiento, // ISO format, will be displayed as-is
    days: live.days_to_expiry,
    price: live.last_price,
    change: live.change_pct,
    tna: live.tna * 100,       // convert decimal to percentage
    tem: live.tem * 100,       // convert decimal to percentage
    tir: live.tir * 100,       // V3.5 FIX: TIR is annualized, TEM is monthly — these are DIFFERENT rates
    gananciaDirecta: live.ganancia_directa * 100, // convert to percentage
    vsPlazoFijo,
    dm: undefined, // Not available from live data
    // V3.5: IOL Level 2 fields — populated by /api/letras server-side enrichment.
    // No client-side IOL fetch — server is the single source of truth.
    iolVolume: live.iol_volume_notional ?? live.iol_volume, // Prefer notional (ARS)
    iolVolumeNotional: live.iol_volume_notional, // V3.5: ARS notional volume
    iolVolumeQty: live.iol_volume_qty,           // V3.5: Quantity of titles traded
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

// ── V3.5: IOL Last-Valid Cache ────────────────────────────────────────
// When IOL is offline (weekends, after-hours), the server returns
// iol_status !== 'online' with zeroed IOL fields. This cache preserves
// the last valid IOL data per ticker so the UI doesn't flash zeros.

interface IOLLatestData {
  iolVolume: number;
  iolVolumeNotional: number;
  iolVolumeQty: number;
  iolBid: number;
  iolAsk: number;
  iolBidDepth: number;
  iolAskDepth: number;
  iolMarketPressure: number | undefined;
  iolStatus: 'online' | 'offline' | 'no_data';
}

/**
 * Merge IOL fields from a new fetch with the last valid IOL data.
 * Strategy:
 *   - If new data has iol_status === 'online', use it (fresh data wins).
 *   - If new data has iol_status !== 'online' AND we have cached data,
 *     keep the cached values (don't overwrite with zeros).
 *   - If no cached data exists, accept the zeros (first fetch, IOL never worked).
 */
function mergeIOLFields(
  inst: Instrument,
  lastValid: Map<string, IOLLatestData>,
): Instrument {
  const cached = lastValid.get(inst.ticker);
  if (!cached) return inst; // No previous data — accept as-is

  // If IOL is online in the new data, it's fresh — use it and update cache
  if (inst.iolStatus === 'online') {
    lastValid.set(inst.ticker, {
      iolVolume: inst.iolVolume ?? 0,
      iolVolumeNotional: inst.iolVolumeNotional ?? 0,
      iolVolumeQty: inst.iolVolumeQty ?? 0,
      iolBid: inst.iolBid ?? 0,
      iolAsk: inst.iolAsk ?? 0,
      iolBidDepth: inst.iolBidDepth ?? 0,
      iolAskDepth: inst.iolAskDepth ?? 0,
      iolMarketPressure: inst.iolMarketPressure,
      iolStatus: inst.iolStatus ?? 'offline',
    });
    return inst;
  }

  // IOL is offline/no_data in the new data — preserve last valid
  return {
    ...inst,
    iolVolume: cached.iolVolume || inst.iolVolume,
    iolVolumeNotional: cached.iolVolumeNotional || inst.iolVolumeNotional,
    iolVolumeQty: cached.iolVolumeQty || inst.iolVolumeQty,
    iolBid: cached.iolBid || inst.iolBid,
    iolAsk: cached.iolAsk || inst.iolAsk,
    iolBidDepth: cached.iolBidDepth || inst.iolBidDepth,
    iolAskDepth: cached.iolAskDepth || inst.iolAskDepth,
    iolMarketPressure: cached.iolMarketPressure ?? inst.iolMarketPressure,
  };
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
  const hasDataRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);
  // V3.5: AbortController to cancel in-flight fetches when a new one starts
  // Prevents race conditions where a slow old response overwrites fresher data
  const abortControllerRef = useRef<AbortController | null>(null);

  // V3.5: Last-valid IOL data cache — persists across fetches
  const lastValidIOLRef = useRef<Map<string, IOLLatestData>>(new Map());

  // V2.0.2: Wrap setActive to persist to localStorage
  const setActive = useCallback((value: boolean) => {
    persistActive(value);
    setActiveRaw(value);
  }, []);

  const fetchData = useCallback(async () => {
    // V3.5: Abort any in-flight fetch to prevent race conditions.
    // If a slow old fetch is still pending when we start a new one,
    // the old one must be cancelled so it doesn't overwrite fresh data.
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

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
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      });

      if (!res.ok) {
        throw new Error(`API returned ${res.status}`);
      }

      const data = await res.json() as LetrasApiResponse;

      if (!data.instruments || !Array.isArray(data.instruments)) {
        throw new Error('Invalid response format');
      }

      setLiveInstruments(data.instruments);

      // ── V3.5: Map instruments + hold-last-valid IOL ──────────────
      // The server (/api/letras) is the SINGLE source of truth for IOL data.
      // We NO LONGER call /api/iol-level2 from the client.
      // When IOL is offline (weekend/after-hours), the server returns
      // iol_status !== 'online' with zeroed IOL fields.
      // The mergeIOLFields() function preserves the last valid IOL data
      // so the radar doesn't flash zeros.
      const mappedInstruments = data.instruments
        .map(liveToInstrument)
        .map(inst => mergeIOLFields(inst, lastValidIOLRef.current));

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

      // ── V3.5: REMOVED client-side IOL L2 enrichment ─────────────
      // Previously, this block fetched /api/iol-level2 from the client
      // and merged IOL data into instruments. This was REDUNDANT because
      // /api/letras already performs IOL enrichment server-side.
      //
      // WORSE: when IOL was offline (weekends, after-hours), this
      // client-side fetch returned zeros and OVERWROTE the valid data
      // that /api/letras had preserved from the server-side enrichment.
      //
      // The server is now the single source of truth for IOL data.
      // The hold-last-valid mechanism (mergeIOLFields) ensures that
      // when IOL goes offline, the last valid data is preserved.

      setInstruments(mappedInstruments);
    } catch (err) {
      // V3.5: Ignore AbortError — this means a newer fetch cancelled this one
      if (err instanceof DOMException && err.name === 'AbortError') {
        return; // Silently ignore aborted requests
      }
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
      // Fetch immediately when activating
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
      hasDataRef.current = false;
      // V3.5: Keep lastValidIOLRef across deactivations — it's a cache,
      // not live state. If the user re-enables LIVE, the cache is still warm.
    }

    return () => {
      mountedRef.current = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      // V3.5: Abort any in-flight fetch on unmount
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
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
