// ════════════════════════════════════════════════════════════════════════
// V2.0.2 — useLiveInstruments Hook
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
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  // V2.0.2: Wrap setActive to persist to localStorage + check IOL status
  const setActive = useCallback((value: boolean) => {
    persistActive(value);
    setActiveRaw(value);

    // V3.2: When LIVE is activated, check IOL Level 2 status
    if (value) {
      fetch('/api/iol/status')
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (data?.ok) {
            // Import store dynamically to avoid circular deps
            import('@/lib/store').then(({ useRadarStore }) => {
              useRadarStore.getState().setIolLevel2Online(data.online === true);
            });
          }
        })
        .catch(() => { /* IOL status check failed silently */ });
    }
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // For static export, we can't use the server-side merge, so fetch both endpoints directly
      if (STATIC_EXPORT) {
        // Fallback for static export: fetch only arg_notes (limited, but better than nothing)
        const res = await fetch('https://data912.com/live/arg_notes', {
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) throw new Error(`API returned ${res.status}`);
        // For static export, we can't merge with ArgentinaDatos, so just return empty
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
      setInstruments(data.instruments.map(liveToInstrument));
      setCaucionProxy(data.caucion_proxy ?? null);

      // V2.0.1: Track which tickers are live from the API
      const newLiveTickers = new Set(data.instruments.map(i => i.ticker));
      setLiveTickers(newLiveTickers);

      // V2.0.2: Build delta_tir map from API response
      // delta_tir is computed in /api/letras: TIR(live_price) - TIR(last_close)
      const newDeltaTIRMap = new Map<string, number>();
      for (const inst of data.instruments) {
        if (inst.delta_tir != null && isFinite(inst.delta_tir)) {
          newDeltaTIRMap.set(inst.ticker, inst.delta_tir * 100); // convert decimal to percentage
        }
      }
      setDeltaTIRMap(newDeltaTIRMap);

      // V2.0.1: Handle new sources structure
      setSources(data.sources ?? null);
      setStats(data.stats ?? null);
      setLastRefresh(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch live data');
    } finally {
      if (mountedRef.current) setLoading(false);
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

      // V3.2: Check IOL Level 2 status every 5 minutes while LIVE
      const iolInterval = setInterval(() => {
        fetch('/api/iol/status')
          .then(res => res.ok ? res.json() : null)
          .then(data => {
            if (data?.ok) {
              import('@/lib/store').then(({ useRadarStore }) => {
                useRadarStore.getState().setIolLevel2Online(data.online === true);
              });
            }
          })
          .catch(() => { /* ignore */ });
      }, 300_000); // 5 minutes

      return () => {
        mountedRef.current = false;
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        clearInterval(iolInterval);
      };
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
