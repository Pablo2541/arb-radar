'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Instrument, Config, Position, Transaction,
  SimulationRecord, ExternalHistoryRecord, MomentumData,
  LiveInstrument,
} from '@/lib/types';
import { useRadarStore, initializeStore } from '@/lib/store';
import type { AppTheme, TabId, ActivityItem } from '@/lib/store';
import { filterForCharts } from '@/lib/outlierFilter';
import { spreadVsCaucion, caucionTEMFromTNA, getCaucionForDays, analyzeCurveShape } from '@/lib/calculations';
import { useSessionHistory } from '@/hooks/useSessionHistory';
import { useLiveInstruments } from '@/hooks/useLiveInstruments';
import type { PriceHistoryFile } from '@/lib/priceHistory';

// ── V3.4-PRO: Static imports — Eliminates ChunkLoadError ──
// Dynamic imports caused ChunkLoadError in preview environments.
// All tabs now load eagerly — zero chunk fetch failures possible.
import ThresholdAlerts from '@/components/dashboard/ThresholdAlerts';
import MercadoTab from '@/components/dashboard/MercadoTab';
import CurvasTab from '@/components/dashboard/CurvasTab';
import CockpitTab from '@/components/dashboard/CockpitTab';
import EstrategiasTab from '@/components/dashboard/EstrategiasTab';
import CarteraTab from '@/components/dashboard/CarteraTab';
import HistorialTab from '@/components/dashboard/HistorialTab';
import HistoricoTab from '@/components/dashboard/HistoricoTab';
import ConfiguracionTab from '@/components/dashboard/ConfiguracionTab';
import OrderFlowAlert from '@/components/dashboard/OrderFlowAlert';

const TAB_CONFIG: { id: TabId; icon: string; label: string; shortcut: string }[] = [
  { id: 'mercado', icon: '📊', label: 'Mercado', shortcut: '1' },
  { id: 'cockpit', icon: '🎯', label: 'Cockpit', shortcut: '2' },
  { id: 'curvas', icon: '📈', label: 'Curvas', shortcut: '3' },
  { id: 'estrategias', icon: '⚡', label: 'Estrategias', shortcut: '5' },
  { id: 'cartera', icon: '💼', label: 'Cartera', shortcut: '6' },
  { id: 'historial', icon: '📋', label: 'Historial', shortcut: '8' },
  { id: 'historico', icon: '📈', label: 'Histórico', shortcut: 'H' },
  { id: 'configuracion', icon: '⚙️', label: 'Config', shortcut: '9' },
];

// ════════════════════════════════════════════════════════════════════════
// V3.3-PRO — Global Absorption Alert Banner
// Polls /api/market-pressure for wall detection alerts
// ════════════════════════════════════════════════════════════════════════

interface AbsorptionAlertData {
  ticker: string;
  wallSize: number;
  wallAvgMultiple: number;
  absorbedPct: number;
  alertType: 'WALL_DETECTED' | 'ABSORPTION_IMMINENT' | 'ABSORPTION_COMPLETE';
  alertMessage: string;
  priority: boolean;
}

function AbsorptionAlertBanner() {
  const [alerts, setAlerts] = useState<AbsorptionAlertData[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchAlerts = useCallback(async () => {
    try {
      // Query top instruments by TEM (most likely to have walls)
      const tickers = 'T15E7,T30J7,T5W3,S1L5';
      const res = await fetch(`/api/market-pressure?tickers=${tickers}`);
      if (!res.ok) return;
      const json = await res.json();
      if (json.iol_available && json.alerts && json.alerts.length > 0) {
        setAlerts(json.alerts);
      } else {
        setAlerts([]);
      }
    } catch {
      // Silent fail
    }
  }, []);

  useEffect(() => {
    const initialTimeout = setTimeout(() => fetchAlerts(), 0);
    intervalRef.current = setInterval(fetchAlerts, 60_000);
    return () => {
      clearTimeout(initialTimeout);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchAlerts]);

  const visibleAlerts = alerts.filter(a => !dismissed.has(a.ticker + a.alertType));

  if (visibleAlerts.length === 0) return null;

  return (
    <div className="px-4 md:px-6 lg:px-8 space-y-1">
      {visibleAlerts.map((alert, idx) => {
        const isImminent = alert.alertType === 'ABSORPTION_IMMINENT';
        const isComplete = alert.alertType === 'ABSORPTION_COMPLETE';
        const bgClass = isImminent 
          ? 'bg-[#f87171]/10 border-[#f87171]/30' 
          : isComplete 
            ? 'bg-[#2eebc8]/10 border-[#2eebc8]/30'
            : 'bg-[#fbbf24]/8 border-[#fbbf24]/20';
        const textClass = isImminent 
          ? 'text-[#f87171]' 
          : isComplete 
            ? 'text-[#2eebc8]'
            : 'text-[#fbbf24]';
        const emoji = isImminent ? '🚨' : isComplete ? '✅' : '🧱';

        return (
          <div 
            key={`${alert.ticker}-${alert.alertType}-${idx}`}
            className={`flex items-center justify-between p-2.5 rounded-lg border ${bgClass} ${isImminent ? 'animate-pulse' : ''}`}
          >
            <div className="flex items-center gap-2">
              <span className="text-sm">{emoji}</span>
              <span className={`text-[10px] font-bold uppercase tracking-wider ${textClass}`}>
                {alert.alertType.replace('_', ' ')}
              </span>
              <span className="text-[10px] font-mono text-app-text">
                {alert.ticker}
              </span>
              {alert.priority && (
                <span className="text-[8px] px-1.5 py-0.5 rounded bg-[#fbbf24]/10 text-[#fbbf24] border border-[#fbbf24]/30 font-bold">
                  ⚡ PRIORIDAD
                </span>
              )}
              <span className="text-[9px] text-app-text3 font-mono">
                {(alert.wallAvgMultiple ?? 0).toFixed(1)}x avg · {(alert.absorbedPct ?? 0).toFixed(0)}% absorbed
              </span>
            </div>
            <button
              onClick={() => setDismissed(prev => new Set([...prev, alert.ticker + alert.alertType]))}
              className="text-app-text4 hover:text-app-text2 text-xs transition-colors ml-2"
              title="Descartar alerta"
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ── Inner Content ──

function HomeContent() {
  // ════════════════════════════════════════════════════════════════
  // V3.0 — Zustand Store (replaces ALL useState for shared state)
  // ════════════════════════════════════════════════════════════════
  const instruments = useRadarStore(s => s.instruments);
  const config = useRadarStore(s => s.config);
  const position = useRadarStore(s => s.position);
  const transactions = useRadarStore(s => s.transactions);
  const simulations = useRadarStore(s => s.simulations);
  const externalHistory = useRadarStore(s => s.externalHistory);
  const lastUpdate = useRadarStore(s => s.lastUpdate);
  const rawInput = useRadarStore(s => s.rawInput);
  const mepRate = useRadarStore(s => s.mepRate);
  const cclRate = useRadarStore(s => s.cclRate);
  const priceHistory = useRadarStore(s => s.priceHistory);
  const activeTab = useRadarStore(s => s.activeTab);
  const theme = useRadarStore(s => s.theme);
  const mounted = useRadarStore(s => s.mounted);
  const currentTime = useRadarStore(s => s.currentTime);
  const dbAvailable = useRadarStore(s => s.dbAvailable);
  const lastDbSyncStatus = useRadarStore(s => s.lastDbSyncStatus);
  const iolLevel2Online = useRadarStore(s => s.iolLevel2Online);
  const iolCredentialsExist = useRadarStore(s => s.iolCredentialsExist);
  const iolConnectionFailed = useRadarStore(s => s.iolConnectionFailed);
  const riesgoPaisAuto = useRadarStore(s => s.riesgoPaisAuto);
  // V3.4.1: MT indicator uses reactive hooks (not getState())
  const marketTruth = useRadarStore(s => s.marketTruth);
  const marketTruthStale = useRadarStore(s => s.marketTruthStale);

  // ── Store setters ──
  const setActiveTab = useRadarStore(s => s.setActiveTab);
  const setInstruments = useRadarStore(s => s.setInstruments);
  const setConfig = useRadarStore(s => s.setConfig);
  const setPosition = useRadarStore(s => s.setPosition);
  const setTransactions = useRadarStore(s => s.setTransactions);
  const setSimulations = useRadarStore(s => s.setSimulations);
  const setExternalHistory = useRadarStore(s => s.setExternalHistory);
  const setLastUpdate = useRadarStore(s => s.setLastUpdate);
  const setRawInput = useRadarStore(s => s.setRawInput);
  const setMepRate = useRadarStore(s => s.setMepRate);
  const setCclRate = useRadarStore(s => s.setCclRate);
  const setPriceHistory = useRadarStore(s => s.setPriceHistory);
  const setCurrentTime = useRadarStore(s => s.setCurrentTime);


  // ── Local-only state (NOT in store) ──
  const [tabTransition, setTabTransition] = useState(false);
  const [isTabLoading, setIsTabLoading] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [showHelp, setShowHelp] = useState(false);
  const [showNukeConfirm, setShowNukeConfirm] = useState(false);
  const [dolarLastUpdateTime, setDolarLastUpdateTime] = useState<string>('');
  // V3.3-PRO: Track previous Riesgo País value for trend arrow
  const prevRiesgoPaisRef = useRef<number | null>(null);
  const [riesgoPaisTrend, setRiesgoPaisTrend] = useState<'up' | 'down' | 'flat' | null>(null);

  // ════════════════════════════════════════════════════════════════
  // V2.0.3 — GLOBAL LIVE DATA (moved from MercadoTab to page.tsx)
  // All tabs now share the same live data source.
  // ════════════════════════════════════════════════════════════════
  const liveData = useLiveInstruments();

  // V2.0.3: Build liveDataMap for quick ticker → LiveInstrument lookup
  const liveDataMap = useMemo(() => {
    const map = new Map<string, LiveInstrument>();
    for (const li of liveData.liveInstruments) {
      map.set(li.ticker, li);
    }
    return map;
  }, [liveData.liveInstruments]);

  // V2.0.3: Effective instruments — merge live prices into manual instruments
  // When LIVE is active, instruments get updated prices/TEM/TIR from the API
  const effectiveInstruments = useMemo(() => {
    if (!liveData.active || liveData.instruments.length === 0) return instruments;

    // Merge: update existing instruments with live data, add new ones from live
    const manualTickerSet = new Set(instruments.map(i => i.ticker));
    const updated = instruments.map(inst => {
      const liveInst = liveDataMap.get(inst.ticker);
      if (!liveInst) return inst; // No live data for this ticker, keep manual
      return {
        ...inst,
        price: liveInst.last_price,
        change: liveInst.change_pct,
        tna: liveInst.tna * 100,
        tem: liveInst.tem * 100,
        tir: liveInst.tem * 100,
        days: liveInst.days_to_expiry,
        // V3.4: IOL Level 2 enrichment from /api/letras — real-time order book data
        iolVolume: liveInst.iol_volume ?? inst.iolVolume,
        iolBid: liveInst.iol_bid ?? inst.iolBid,
        iolAsk: liveInst.iol_ask ?? inst.iolAsk,
        iolBidDepth: liveInst.iol_bid_depth ?? inst.iolBidDepth,
        iolAskDepth: liveInst.iol_ask_depth ?? inst.iolAskDepth,
        iolMarketPressure: liveInst.iol_market_pressure ?? inst.iolMarketPressure,
        iolStatus: liveInst.iol_status ?? inst.iolStatus,
        // V3.4: data912 volume as fallback for VOL column
        data912Volume: liveInst.volume ?? inst.data912Volume,
      };
    });

    // Add truly new instruments from LIVE that aren't in manual list
    const newLiveInstruments = liveData.instruments.filter(
      li => !manualTickerSet.has(li.ticker)
    );
    if (newLiveInstruments.length > 0) {
      updated.push(...newLiveInstruments);
    }

    return updated;
  }, [liveData.active, liveData.instruments, liveDataMap, instruments]);

  // ── Loading progress bar animation ──
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    let start: number | null = null;
    const duration = 2000; // 2 seconds
    const step = (timestamp: number) => {
      if (!start) start = timestamp;
      const elapsed = timestamp - start;
      const progress = Math.min((elapsed / duration) * 100, 100);
      setLoadProgress(progress);
      if (progress < 100) {
        progressRef.current = requestAnimationFrame(step) as unknown as ReturnType<typeof setInterval>;
      }
    };
    progressRef.current = requestAnimationFrame(step) as unknown as ReturnType<typeof setInterval>;
    return () => {
      if (progressRef.current) cancelAnimationFrame(progressRef.current as unknown as number);
    };
  }, []);

  // V1.3 — Session History (Momentum Module)
  const sessionHistory = useSessionHistory();

  // ── Theme toggle (V3.0 — uses store) ──
  const toggleTheme = useCallback(() => {
    const current = useRadarStore.getState().theme;
    useRadarStore.getState().setTheme(current === 'dark' ? 'light' : 'dark');
  }, []);

  // ── Tab change with transition + skeleton loading ──
  const handleTabChange = useCallback((tabId: TabId) => {
    if (tabId === activeTab) return;
    setIsTabLoading(true);
    setTabTransition(true);
    setTimeout(() => {
      setActiveTab(tabId);
      setTabTransition(false);
    }, 150);
    // Show skeleton for 200ms after tab switch
    setTimeout(() => {
      setIsTabLoading(false);
    }, 350);
  }, [activeTab, setActiveTab]);

  // ── Real-time clock ──
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(now.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, [setCurrentTime]);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;

      if (e.altKey && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const idx = parseInt(e.key) - 1;
        if (idx < TAB_CONFIG.length) {
          handleTabChange(TAB_CONFIG[idx].id);
        }
      }
      if (e.altKey && e.key.toLowerCase() === 't') {
        e.preventDefault();
        toggleTheme();
      }
      // Show help modal on ? key
      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault();
        setShowHelp(prev => !prev);
      }
      // Close help on Escape
      if (e.key === 'Escape') {
        setShowHelp(false);
        setShowNukeConfirm(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleTabChange, toggleTheme]);

  // ── V3.0: Initialize store (DB first, then localStorage fallback) ──
  // V3.4: After init, force sync all local data to cloud DB (no debounce)
  useEffect(() => {
    initializeStore().then(() => {
      const validInstruments = useRadarStore.getState().instruments;
      sessionHistory.addSnapshot(validInstruments);
      // V3.4: Force immediate DB sync — push all localStorage data to cloud
      useRadarStore.getState().forceSyncToDb().catch(() => {
        // Silent fail — DB unavailable, localStorage is the fallback
      });
    });
  }, []);

  // ── V3.4: Proactive IOL Level 2 availability check on startup ──
  // Calls /api/iol-level2 with a test ticker to detect IOL status.
  // Sets 3-state LED: online (purple pulsing), no credentials (gray), connection failed (orange)
  useEffect(() => {
    const checkIOL = async () => {
      try {
        const res = await fetch('/api/iol-level2?tickers=T5W3', {
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) {
          // API error — likely credentials exist but connection failed
          const store = useRadarStore.getState();
          store.setIolCredentialsExist(true);
          store.setIolConnectionFailed(true);
          store.setIolLevel2Online(false);
          return;
        }
        const data = await res.json();

        if (data.token_status === 'not_configured') {
          // No credentials in .env
          const store = useRadarStore.getState();
          store.setIolCredentialsExist(false);
          store.setIolConnectionFailed(false);
          store.setIolLevel2Online(false);
        } else if (data.token_status === 'invalid') {
          // Credentials exist but auth failed
          const store = useRadarStore.getState();
          store.setIolCredentialsExist(true);
          store.setIolConnectionFailed(true);
          store.setIolLevel2Online(false);
        } else if (data.iol_available) {
          // IOL is online — check if any ticker has actual data
          const hasOnlineData = Object.values(data.data as Record<string, { status: string }>)
            .some((td) => td.status === 'online');
          const store = useRadarStore.getState();
          store.setIolCredentialsExist(true);
          store.setIolConnectionFailed(false);
          store.setIolLevel2Online(hasOnlineData);
        } else {
          // iol_available is false but token isn't explicitly invalid
          const store = useRadarStore.getState();
          store.setIolCredentialsExist(true);
          store.setIolConnectionFailed(true);
          store.setIolLevel2Online(false);
        }
      } catch {
        // Network error — can't determine status, leave as defaults
      }
    };
    checkIOL();
    // V3.4.3: Re-check IOL status every 60s to recover from transient failures
    const iolInterval = setInterval(checkIOL, 60_000);
    return () => clearInterval(iolInterval);
  }, []);

  // ── V3.0: Persist state changes (store handles localStorage + DB) ──
  const updateInstruments = useCallback((v: Instrument[]) => {
    useRadarStore.getState().setInstruments(v);
    sessionHistory.addSnapshot(useRadarStore.getState().instruments);
    // Activity feed removed — no layout shift
  }, [sessionHistory]);

  const updateConfig = useCallback((v: Config) => {
    useRadarStore.getState().setConfig(v);
  }, []);

  const updatePosition = useCallback((v: Position | null) => {
    useRadarStore.getState().setPosition(v);
    // Activity feed removed — no layout shift
  }, []);

  const updateTransactions = useCallback((v: Transaction[]) => {
    useRadarStore.getState().setTransactions(v);
  }, []);

  const updateLastUpdate = useCallback((v: string) => {
    useRadarStore.getState().setLastUpdate(v);
  }, []);

  const updateRawInput = useCallback((v: string) => {
    useRadarStore.getState().setRawInput(v);
  }, []);

  const updateExternalHistory = useCallback((v: ExternalHistoryRecord[]) => {
    useRadarStore.getState().setExternalHistory(v);
  }, []);

  const updatePriceHistory = useCallback((v: PriceHistoryFile) => {
    useRadarStore.getState().setPriceHistory(v);
  }, []);

  // ── MEP/CCL Rate callbacks from MercadoTab ──
  const handleMepRate = useCallback((rate: number) => {
    useRadarStore.getState().setMepRate(rate);
  }, []);
  const handleCclRate = useCallback((rate: number) => {
    useRadarStore.getState().setCclRate(rate);
  }, []);
  const handleDolarUpdate = useCallback((timestamp: string) => {
    setDolarLastUpdateTime(timestamp);
    // Activity feed removed — no layout shift
  }, []);

  // V2.0.3: Sync new LIVE instruments to the permanent instruments list
  // This runs in a useEffect (NOT during render) to avoid side effects in render
  const handleSyncLiveInstruments = useCallback((newInstruments: Instrument[]) => {
    const currentInstruments = useRadarStore.getState().instruments;
    const existingTickers = new Set(currentInstruments.map(i => i.ticker));
    const trulyNew = newInstruments.filter(i => !existingTickers.has(i.ticker));
    if (trulyNew.length === 0) return;
    const updated = [...currentInstruments, ...trulyNew];
    useRadarStore.getState().setInstruments(updated);
    // Activity feed removed — no layout shift
  }, []);

  // V2.0.3: Sync new LIVE instruments via useEffect (not during render!)
  useEffect(() => {
    if (!liveData.active || liveData.instruments.length === 0) return;
    const existingTickers = new Set(instruments.map(i => i.ticker));
    const trulyNew = liveData.instruments.filter(li => !existingTickers.has(li.ticker));
    if (trulyNew.length > 0) {
      handleSyncLiveInstruments(trulyNew);
    }
  }, [liveData.active, liveData.instruments, instruments, handleSyncLiveInstruments]);

  // ════════════════════════════════════════════════════════════════
  // V3.0 — LIVE OFF PERSISTENCE
  // When LIVE is turned off, the effectiveInstruments revert to
  // the store's `instruments` (old prices). We need to capture
  // the last LIVE-merged state and persist it so prices don't
  // "reset" when the user disconnects LIVE.
  // ════════════════════════════════════════════════════════════════
  const lastLiveEffectiveRef = useRef<Instrument[]>([]);
  const prevLiveActiveRef = useRef(false);

  // Keep ref updated while LIVE is active (captures every price tick)
  useEffect(() => {
    if (liveData.active && effectiveInstruments.length > 0) {
      lastLiveEffectiveRef.current = effectiveInstruments;
    }
  }, [liveData.active, effectiveInstruments]);

  // On LIVE → OFF transition: persist last LIVE-merged instruments to store
  useEffect(() => {
    if (prevLiveActiveRef.current && !liveData.active && lastLiveEffectiveRef.current.length > 0) {
      const lastLive = lastLiveEffectiveRef.current;
      const currentStore = useRadarStore.getState().instruments;
      // Only persist if prices actually changed (avoid unnecessary writes)
      const hasChanges = lastLive.some(li => {
        const si = currentStore.find(s => s.ticker === li.ticker);
        return si && (Math.abs(si.price - li.price) > 0.0001 || Math.abs(si.tem - li.tem) > 0.001);
      });
      if (hasChanges) {
        useRadarStore.getState().setInstruments(lastLive);
        // Activity feed removed — no layout shift
      }
    }
    prevLiveActiveRef.current = liveData.active;
  }, [liveData.active]);

  // V3.0: Sanitized instruments for footer/curves (filter outliers for charts)
  const sanitizedInstruments = useMemo(() =>
    filterForCharts(effectiveInstruments.filter(i => i.days >= 1)),
    [effectiveInstruments]
  );

  // ── Curve shape computed for Market Summary ──
  const curveShape = useMemo(() => analyzeCurveShape(sanitizedInstruments), [sanitizedInstruments]);

  // ════════════════════════════════════════════════════════════════
  // V3.0 — NUKE BUTTON: Hard Reset via store.nukeAll()
  // ════════════════════════════════════════════════════════════════

  const handleReset = () => {
    setShowNukeConfirm(true);
  };

  const handleNukeConfirm = () => {
    useRadarStore.getState().nukeAll();
  };

  const handleNukeCancel = () => {
    setShowNukeConfirm(false);
  };

  // ── Momentum ──
  const snapshotCount = sessionHistory.getSnapshotCount();
  const momentumMap = useMemo<Map<string, MomentumData>>(() => {
    return sessionHistory.calculateMomentum(instruments, config.comisionTotal, config);
  }, [instruments, config, snapshotCount, sessionHistory]);

  // ── Market status ──
  const marketOpen = useMemo(() => {
    const now = new Date();
    const hour = now.getHours();
    const day = now.getDay();
    return day >= 1 && day <= 5 && hour >= 10 && hour < 17;
  }, [currentTime]);

  // ── DB Sync indicator color ──
  const dbSyncDotColor = useMemo(() => {
    if (!dbAvailable) return '#6b7280'; // gray — DB not configured
    switch (lastDbSyncStatus) {
      case 'syncing': return '#fbbf24'; // yellow
      case 'error': return '#f87171'; // red
      case 'success': return '#2eebc8'; // green
      default: return '#6b7280'; // gray — idle
    }
  }, [dbAvailable, lastDbSyncStatus]);

  // V3.3-PRO: Market Truth Engine — Replaces old /api/country-risk polling
  // Fetches RP + MEP with multi-source consensus and confidence levels
  useEffect(() => {
    const fetchMarketTruth = async () => {
      try {
        const res = await fetch('/api/market-truth');
        if (!res.ok) return;
        const data = await res.json();

        // ── Process RP ──
        if (data.riesgo_pais?.value && data.riesgo_pais.value > 0) {
          const currentRP = useRadarStore.getState().riesgoPaisAuto ?? useRadarStore.getState().config.riesgoPais;
          if (prevRiesgoPaisRef.current !== null && currentRP !== data.riesgo_pais.value) {
            setRiesgoPaisTrend(data.riesgo_pais.value > currentRP ? 'up' : data.riesgo_pais.value < currentRP ? 'down' : 'flat');
          }
          prevRiesgoPaisRef.current = currentRP;
        }

        // ── Set full Market Truth data ──
        useRadarStore.getState().setMarketTruth(data);

        // ── Activity log ──
        const rp = data.riesgo_pais;
        const mep = data.mep;
        // Activity feed removed — RP/MEP updates shown in status bar
      } catch {
        // silent — fallback to old /api/country-risk
        try {
          const res = await fetch('/api/country-risk');
          if (!res.ok) return;
          const data = await res.json();
          if (data.value && data.value > 0) {
            const currentRP = useRadarStore.getState().riesgoPaisAuto ?? useRadarStore.getState().config.riesgoPais;
            if (prevRiesgoPaisRef.current !== null && currentRP !== data.value) {
              setRiesgoPaisTrend(data.value > currentRP ? 'up' : data.value < currentRP ? 'down' : 'flat');
            }
            prevRiesgoPaisRef.current = currentRP;
            useRadarStore.getState().setRiesgoPaisAuto(data.value);
          }
        } catch {
          // completely silent
        }
      }
    };

    // PRIORITY HYDRATION: Fire immediately, no delay — cache must be warm on entry
    fetchMarketTruth();
    const interval = setInterval(fetchMarketTruth, 60 * 1000); // V3.4: 60s refresh — aligned with engine cache TTL (user directive)
    return () => {
      clearInterval(interval);
    };
  }, []);

  // ── Loading Screen ──
  if (!mounted) {
    return (
      <div className="min-h-screen bg-app-bg flex items-center justify-center motion-safe:animate-fadeIn">
        <div className="text-center flex flex-col items-center gap-6">
          {/* Logo */}
          <h1 className="text-3xl font-light tracking-widest">
            <span className="text-app-accent-text font-semibold">ARB</span>
            <span className="text-app-text4 mx-0.5">{'//'}</span>
            <span className="text-app-pink font-semibold">RADAR</span>
          </h1>

          {/* Radar Animation */}
          <div className="relative w-24 h-24 flex items-center justify-center motion-reduce:hidden">
            <div className="radar-ring" />
            <div className="radar-ring" />
            <div className="radar-ring" />
            <div className="radar-dot" />
          </div>

          {/* Progress Bar */}
          <div className="w-48 h-1 bg-app-subtle rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-none"
              style={{
                width: `${loadProgress}%`,
                background: 'linear-gradient(90deg, #2eebc8, #f472b6)',
              }}
            />
          </div>

          {/* Shimmer Loading Text */}
          <p className="text-shimmer text-sm font-light tracking-wider motion-reduce:animate-none motion-reduce:text-app-text3">
            Cargando V3.4.3 PRO...
          </p>
        </div>
      </div>
    );
  }

  // ── Tab Content ──
  const renderContent = () => {
    switch (activeTab) {
      case 'mercado':
        return <MercadoTab instruments={effectiveInstruments} config={config} position={position} momentumMap={momentumMap} priceHistory={priceHistory} onMepRate={handleMepRate} onCclRate={handleCclRate} onDolarUpdate={handleDolarUpdate} liveData={liveData} liveDataMap={liveDataMap} riesgoPaisAuto={riesgoPaisAuto} />;
      case 'cockpit':
        return <CockpitTab instruments={effectiveInstruments} config={config} position={position} liveDataMap={liveDataMap} isLive={liveData.active} />;
      case 'curvas':
        return <CurvasTab instruments={sanitizedInstruments} config={config} position={position} momentumMap={momentumMap} />;
      case 'estrategias':
        return <EstrategiasTab instruments={effectiveInstruments} config={config} position={position} momentumMap={momentumMap} priceHistory={priceHistory} />;
      case 'cartera':
        return <CarteraTab instruments={effectiveInstruments} config={config} setConfig={updateConfig} position={position} setPosition={updatePosition} transactions={transactions} setTransactions={updateTransactions} externalHistory={externalHistory} setExternalHistory={updateExternalHistory} momentumMap={momentumMap} priceHistory={priceHistory} liveDataMap={liveDataMap} isLive={liveData.active} />;
      case 'historial': {
        // ════════════════════════════════════════════════════════════════
        // V2.0.3 — SSOT: Cartera is the single source of truth
        // All financial intelligence (Capital Neto, P&L) is computed here
        // from the same effectiveInstruments that all tabs use.
        // ════════════════════════════════════════════════════════════════
        const heldInstrument = position ? effectiveInstruments.find(i => i.ticker === position.ticker) : null;

        // Capital Neto SSOT = cash + invested (at current market price — LIVE if available)
        const investedAtMarket = position && heldInstrument
          ? position.vn * heldInstrument.price
          : 0;
        const capitalNetoSSOT = config.capitalDisponible + investedAtMarket;

        // P&L Total SSOT = realized (from SELL transactions) + unrealized (current position)
        const realizedPnL = transactions
          .filter(tx => tx.type === 'SELL')
          .reduce((sum, tx) => sum + (tx.pnl || 0), 0);

        const unrealizedPnL = (() => {
          if (!position || !heldInstrument) return 0;
          const valorActual = position.vn * heldInstrument.price;
          const costoEntrada = position.precioConComision
            ? position.vn * position.precioConComision
            : position.vn * position.entryPrice * (1 + config.comisionTotal / 2 / 100);
          return valorActual - costoEntrada;
        })();

        const pnlTotalSSOT = realizedPnL + unrealizedPnL;

        return <HistorialTab
          transactions={transactions}
          instruments={effectiveInstruments}
          config={config}
          position={position}
          externalHistory={externalHistory}
          setExternalHistory={updateExternalHistory}
          capitalNetoSSOT={capitalNetoSSOT}
          pnlTotalSSOT={pnlTotalSSOT}
          realizedPnL={realizedPnL}
          unrealizedPnL={unrealizedPnL}
        />;
      }
      case 'historico':
        return <HistoricoTab instruments={effectiveInstruments} />;
      case 'configuracion':
        return <ConfiguracionTab rawInput={rawInput} setRawInput={updateRawInput} config={config} setConfig={updateConfig} instruments={instruments} setInstruments={updateInstruments} setLastUpdate={updateLastUpdate} position={position} setPosition={updatePosition} transactions={transactions} setTransactions={updateTransactions} simulations={simulations} setSimulations={setSimulations} externalHistory={externalHistory} setExternalHistory={updateExternalHistory} priceHistory={priceHistory} setPriceHistory={updatePriceHistory} snapshots={sessionHistory.getSnapshots()} onRestoreSnapshots={(snaps) => sessionHistory.restoreSnapshots(snaps)} />;
    }
  };

  return (
    <div className="min-h-screen bg-app-bg text-app-text flex flex-col">
      {/* ── Header / Tab Bar ── */}
      <header className="sticky top-0 z-30 bg-app-card/90 backdrop-blur-xl">
        {/* Top row: Logo + clock + indicators + toggles */}
        <div className="flex items-center justify-between px-5 py-2 border-b border-app-border/40">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-light tracking-wide">
              <span className="text-app-accent-text font-medium">ARB</span>
              <span className="text-app-text4 mx-0.5">{'//'}</span>
              <span className="text-app-pink font-medium">RADAR</span>
            </h1>
            <span className="text-[8px] text-app-text4 uppercase tracking-[0.2em] hidden sm:inline font-light">V3.4.3 — PRO TERMINAL</span>
            {/* V3.0: DB Sync indicator dot */}
            <div className="w-1.5 h-1.5 rounded-full hidden sm:block" style={{ backgroundColor: dbSyncDotColor }} title={dbAvailable ? `DB: ${lastDbSyncStatus}` : 'DB: no configurado'} />
            {/* V3.4: IOL Level 2 indicator — 3-state LED */}
            {(() => {
              // 3-state LED logic:
              // Online: credentials present AND API succeeds → "L2" purple pulsing
              // No credentials: .env vars empty → "L2✗" gray
              // Connection failed: credentials exist but API errors → "L2⚠" orange
              const isOnline = iolLevel2Online;
              const noCreds = !iolCredentialsExist && !iolConnectionFailed;
              const connFailed = iolCredentialsExist && iolConnectionFailed;

              let dotColor: string;
              let label: string;
              let title: string;
              let pulse: boolean;

              if (isOnline) {
                dotColor = '#a78bfa'; // purple
                label = 'L2';
                title = 'IOL Nivel 2: ONLINE — Volumen validado';
                pulse = true;
              } else if (noCreds) {
                dotColor = '#6b7280'; // gray
                label = 'L2✗';
                title = 'IOL Nivel 2: SIN CREDENCIALES — Configure IOL_USERNAME/IOL_PASSWORD en .env';
                pulse = false;
              } else if (connFailed) {
                dotColor = '#fb923c'; // orange
                label = 'L2⚠';
                title = 'IOL Nivel 2: CONEXIÓN FALLIDA — Credenciales presentes pero API no responde';
                pulse = false;
              } else {
                dotColor = '#6b7280'; // gray (default/unknown)
                label = 'L2✗';
                title = 'IOL Nivel 2: OFFLINE';
                pulse = false;
              }

              return (
                <div className="flex items-center gap-1 hidden sm:flex" title={title}>
                  <div
                    className={`w-1.5 h-1.5 rounded-full ${pulse ? 'animate-pulse' : ''}`}
                    style={{ backgroundColor: dotColor }}
                  />
                  <span className="text-[7px] font-mono uppercase tracking-wider" style={{ color: dotColor }}>
                    {label}
                  </span>
                </div>
              );
            })()}
            {/* V3.4.1-PRO: Market Truth Engine indicator — SWR stale aware (REACTIVE) */}
            {(() => {
              // V3.4.1: Uses reactive Zustand hooks instead of getState()
              const mt = marketTruth;
              const isStale = marketTruthStale;
              const mtOnline = mt !== null;
              const rpConf = mt?.riesgo_pais?.confidence;
              const mepConf = mt?.mep?.confidence;
              const allHigh = rpConf === 'ALTA' && mepConf === 'ALTA';
              const anyLow = rpConf === 'BAJA' || rpConf === 'CRITICA' || mepConf === 'BAJA' || mepConf === 'CRITICA';
              const dotColor = !mtOnline ? '#6b7280' : isStale ? '#fb923c' : allHigh ? '#2eebc8' : anyLow ? '#f87171' : '#fbbf24';
              const label = !mtOnline ? 'MT' : isStale ? 'STALE' : 'MT';
              return (
                <div className="flex items-center gap-1 hidden sm:flex" title={mtOnline ? `Market Truth: RP ${rpConf} · MEP ${mepConf}${isStale ? ' (STALE)' : ''}` : 'Market Truth: OFFLINE'}>
                  <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: dotColor, animation: mtOnline && !isStale ? 'pulse 2s infinite' : 'none' }} />
                  <span className="text-[7px] font-mono uppercase tracking-wider" style={{ color: dotColor }}>{label}</span>
                </div>
              );
            })()}
            {/* Market status indicator */}
            <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[8px] font-medium ${marketOpen ? 'bg-[#2eebc8]/10 text-[#2eebc8]' : 'bg-app-subtle/50 text-app-text4'}`}>
              <div className={`w-1.5 h-1.5 rounded-full ${marketOpen ? 'bg-[#2eebc8] animate-pulse' : 'bg-app-text4'}`} />
              {marketOpen ? 'MERCADO ABIERTO' : 'MERCADO CERRADO'}
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Real-time clock */}
            <div className="text-[10px] font-mono text-app-text3 tracking-wider">
              {currentTime}
            </div>
            {/* Theme toggle */}
            <button
              onClick={toggleTheme}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-app-subtle/60 hover:bg-app-hover border border-app-border/60 transition-all duration-200"
              title="Alternar tema (Alt+T)"
            >
              <span className="text-xs text-app-text3">
                {theme === 'dark' ? '🌙' : '☀️'}
              </span>
              <div className={`w-8 h-4 rounded-full transition-colors relative ${theme === 'dark' ? 'bg-app-accent' : 'bg-app-gold'}`}>
                <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform duration-200 ${theme === 'dark' ? 'left-0.5' : 'left-[14px]'}`} />
              </div>
            </button>
          </div>
        </div>

        {/* Tab bar */}
        <nav className="flex items-center overflow-x-auto scrollbar-hide px-3">
          {TAB_CONFIG.map((tab) => (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              className={`group shrink-0 flex items-center gap-1.5 px-3.5 py-2.5 text-[11px] font-medium whitespace-nowrap transition-all duration-200 border-b-2 -mb-[1px] rounded-t-lg relative ${
                activeTab === tab.id
                  ? 'border-[#2eebc8] text-app-text bg-app-accent-dim/30'
                  : 'border-transparent text-app-text3 hover:text-app-text2 hover:bg-app-subtle/30'
              }`}
              title={`Alt+${tab.shortcut}`}
            >
              <span className="text-sm">{tab.icon}</span>
              <span>{tab.label}</span>
              {/* Shortcut hint on hover */}
              <span className={`ml-1 text-[8px] font-mono transition-opacity ${activeTab === tab.id ? 'opacity-0' : 'opacity-0 group-hover:opacity-50'}`}>
                {tab.shortcut}
              </span>
            </button>
          ))}
        </nav>
        {/* ── Animated Gradient Accent Line ── */}
        <div className="gradient-line-animated" />
      </header>

      {/* ── Main Content ── */}
      <main className="flex-1 overflow-y-auto">
        {/* Status Bar */}
        <div className="sticky top-0 z-20 bg-app-bg/85 backdrop-blur-md border-b border-app-border/60 border-app-accent/10 px-5 py-2 flex items-center justify-between flex-wrap gap-y-1">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-light text-app-text2">
              {activeTab === 'mercado' && '📊 Mercado'}
              {activeTab === 'cockpit' && '🎯 Cockpit Táctico'}
              {activeTab === 'curvas' && '📈 Curvas'}
              {activeTab === 'estrategias' && '⚡ Estrategias'}
              {activeTab === 'cartera' && '💼 Cartera'}
              {activeTab === 'historial' && '📋 Historial'}
              {activeTab === 'configuracion' && '⚙️ Configuración'}
              {activeTab === 'historico' && '📈 Histórico'}
            </h2>
            {lastUpdate && (
              <span className="text-[9px] text-app-text4 font-mono">
                {lastUpdate}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* Capital Disponible */}
            <div className="card-hover-lift flex items-center gap-1.5 text-[9px] bg-app-accent-dim/50 px-2.5 py-1.5 rounded-lg border border-app-accent-border/60">
              <span className="text-app-text3">Capital:</span>
              <span className="font-mono font-medium text-app-accent-text">
                ${config.capitalDisponible.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
              </span>
            </div>
            {/* Riesgo País — V3.3-PRO: Market Truth Engine with confidence + SWR stale */}
            {(() => {
              const rp = riesgoPaisAuto ?? config.riesgoPais;
              const rpColor = rp > 700 ? '#f87171' : rp > 550 ? '#f472b6' : rp > 400 ? '#fbbf24' : '#2eebc8';
              const rpLabel = rp > 700 ? 'PELIGROSO' : rp > 550 ? 'ALTO' : rp > 400 ? 'MODERADO' : 'EXCELENTE';
              const rpConf = useRadarStore.getState().rpConfidence;
              const rpConfColor = rpConf === 'ALTA' ? '#2eebc8' : rpConf === 'MEDIA' ? '#fbbf24' : rpConf === 'BAJA' ? '#f87171' : '#6b7280';
              const isStale = useRadarStore.getState().marketTruthStale;
              return (
                <div className={`card-hover-lift flex items-center gap-1.5 text-[9px] ${isStale ? 'bg-[#fb923c]/5 border-[#fb923c]/20' : 'bg-app-subtle/60 border-app-border/60'} px-2.5 py-1.5 rounded-lg border`}>
                  <span className="text-app-text3">RP:</span>
                  <span className={`font-mono font-medium ${isStale ? 'opacity-60' : ''}`} style={{ color: rpColor }}>
                    {rp}pb
                  </span>
                  <span className={`text-[7px] font-bold uppercase tracking-wider ${isStale ? 'opacity-60' : ''}`} style={{ color: rpColor }}>
                    {rpLabel}
                  </span>
                  {riesgoPaisTrend === 'up' && <span className="text-[8px] text-[#f87171]">↑</span>}
                  {riesgoPaisTrend === 'down' && <span className="text-[8px] text-[#2eebc8]">↓</span>}
                  {/* V3.3-PRO: Confidence badge */}
                  {rpConf && (
                    <span className="text-[7px] font-bold px-1 py-0.5 rounded border leading-none" style={{ color: rpConfColor, borderColor: rpConfColor + '40', backgroundColor: rpConfColor + '15' }}>
                      {rpConf}
                    </span>
                  )}
                  {isStale && (
                    <span className="text-[6px] font-bold px-1 py-0.5 rounded border leading-none text-[#fb923c] border-[#fb923c]/30 bg-[#fb923c]/10">
                      STALE
                    </span>
                  )}
                </div>
              );
            })()}
            {/* MEP Rate — V3.3-PRO: Market Truth Engine with confidence + SWR stale */}
            {(() => {
              const mepVal = useRadarStore.getState().mepConsensus ?? mepRate;
              const mepConf = useRadarStore.getState().mepConfidence;
              const mepConfColor = mepConf === 'ALTA' ? '#2eebc8' : mepConf === 'MEDIA' ? '#fbbf24' : mepConf === 'BAJA' ? '#f87171' : '#6b7280';
              const isStale = useRadarStore.getState().marketTruthStale;
              if (!mepVal) return null;
              return (
                <div className={`card-hover-lift flex items-center gap-1.5 text-[9px] ${isStale ? 'bg-[#fb923c]/5 border-[#fb923c]/20' : 'bg-app-subtle/60 border-app-border/60'} px-2.5 py-1.5 rounded-lg border`}>
                  <span className="text-app-text3">MEP:</span>
                  <span className={`font-mono font-medium ${mepVal > 1550 ? 'text-[#f87171]' : mepVal > 1450 ? 'text-[#fbbf24]' : 'text-[#2eebc8]'} ${isStale ? 'opacity-60' : ''}`}>
                    ${mepVal.toFixed(0)}
                  </span>
                  {/* V3.3-PRO: Confidence badge + source detail */}
                  {mepConf && (
                    <span className="text-[7px] font-bold px-1 py-0.5 rounded border leading-none" style={{ color: mepConfColor, borderColor: mepConfColor + '40', backgroundColor: mepConfColor + '15' }}>
                      {mepConf}
                    </span>
                  )}
                  {isStale && (
                    <span className="text-[6px] font-bold px-1 py-0.5 rounded border leading-none text-[#fb923c] border-[#fb923c]/30 bg-[#fb923c]/10">
                      STALE
                    </span>
                  )}
                </div>
              );
            })()}
            {/* Position indicator */}
            {position && (
              <div className="card-hover-lift hidden sm:flex items-center gap-1.5 text-[9px] bg-app-subtle/60 px-2.5 py-1.5 rounded-lg border border-app-border/60">
                <span className="text-app-text3">Pos:</span>
                <span className="font-mono font-medium text-[#2eebc8]">{position.ticker}</span>
                <span className="text-app-text4 font-mono">{position.vn.toLocaleString()} VN</span>
              </div>
            )}
            {/* Commission */}
            <div className="card-hover-lift hidden sm:flex items-center gap-1 text-[9px] text-app-text4 bg-app-subtle/60 px-2 py-1.5 rounded-lg border border-app-border/60">
              <span>Com RT:</span>
              <span className="font-mono">{config.comisionTotal}%</span>
            </div>
            {/* Instrument count */}
            <div className="hidden sm:block text-[9px] text-app-text4 font-mono">
              {effectiveInstruments.length} inst.
              {priceHistory && ' · 📜'}
            </div>
            {/* V3.0: Nuke Button — Hard Reset */}
            <button
              onClick={handleReset}
              className="text-[9px] text-app-text4 hover:text-[#f87171] transition-colors px-1.5 py-1 rounded hover:bg-[#f87171]/10"
              title="☢ Limpieza profunda — Borrar TODO y recargar"
            >
              ☢
            </button>
          </div>
        </div>

        {/* Threshold Alerts */}
        <div className="px-4 md:px-6 lg:px-8 pt-2">
          <ThresholdAlerts instruments={sanitizedInstruments} config={config} position={position} momentumMap={momentumMap} />
        </div>

        {/* V3.3-PRO: Global Absorption Alert Banner */}
        <AbsorptionAlertBanner />

        {/* V3.3-PRO: Order Flow Imbalance Alert */}
        <OrderFlowAlert />

        {/* ── Market Summary Widget (Enhanced V1.6.2) ── */}
        <div className="px-4 md:px-6 lg:px-8 py-1">
          <div className="glass-card flex items-center gap-4 px-4 py-1.5 overflow-x-auto scrollbar-hide">
            {/* Total instruments */}
            <div className="flex items-center gap-1.5 shrink-0">
              <svg width="8" height="8" viewBox="0 0 8 8"><circle cx="4" cy="4" r="4" fill="#2eebc8" opacity="0.7" /></svg>
              <span className="text-[9px] text-app-text4 uppercase tracking-wider">Instrumentos</span>
              <span className="text-[11px] font-mono font-medium text-app-text">{sanitizedInstruments.length}</span>
              <span className="text-[8px] text-app-text4 font-mono">({sanitizedInstruments.filter(i => i.type === 'LECAP').length}L / {sanitizedInstruments.filter(i => i.type === 'BONCAP').length}B)</span>
              {liveData.active && (
                <span className="inline-flex items-center gap-1 text-[8px] text-[#2eebc8] font-mono">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#2eebc8] animate-pulse" />LIVE
                </span>
              )}
            </div>
            <div className="w-px h-3 bg-app-border/40 shrink-0" />
            {/* Average TEM — V2.0.3: Use sanitized instruments (days >= 1) */}
            {(() => {
              const avgTEM = sanitizedInstruments.length > 0 ? sanitizedInstruments.reduce((s, i) => s + i.tem, 0) / sanitizedInstruments.length : 0;
              const dotColor = avgTEM > 2.5 ? '#2eebc8' : avgTEM > 1.8 ? '#fbbf24' : '#f87171';
              return (
                <div className="flex items-center gap-1.5 shrink-0">
                  <svg width="8" height="8" viewBox="0 0 8 8"><circle cx="4" cy="4" r="4" fill={dotColor} opacity="0.7" /></svg>
                  <span className="text-[9px] text-app-text4 uppercase tracking-wider">TEM prom</span>
                  <span className="text-[11px] font-mono font-medium text-app-accent-text">{avgTEM.toFixed(2)}%</span>
                </div>
              );
            })()}
            <div className="w-px h-3 bg-app-border/40 shrink-0" />
            {/* Best spread — V2.0.3: Use sanitized instruments */}
            {(() => {
              const spreads = sanitizedInstruments.map(inst => ({ ticker: inst.ticker, spread: spreadVsCaucion(inst.tem, config, inst.days) }));
              const bestSpread = spreads.reduce((best, s) => s.spread > best.spread ? s : best, spreads[0] || { ticker: '-', spread: 0 });
              const dotColor = bestSpread.spread > 0.3 ? '#2eebc8' : bestSpread.spread > 0.1 ? '#fbbf24' : '#f87171';
              return (
                <div className="flex items-center gap-1.5 shrink-0">
                  <svg width="8" height="8" viewBox="0 0 8 8"><circle cx="4" cy="4" r="4" fill={dotColor} opacity="0.7" /></svg>
                  <span className="text-[9px] text-app-text4 uppercase tracking-wider">Mejor spread</span>
                  <span className="text-[11px] font-mono font-medium text-[#2eebc8]">+{bestSpread.spread.toFixed(3)}%</span>
                  <span className="text-[8px] text-app-text4 font-mono">{bestSpread.ticker}</span>
                </div>
              );
            })()}
            <div className="w-px h-3 bg-app-border/40 shrink-0" />
            {/* V3.3-PRO: Spread MEDIAN — more robust metric than best spread */}
            {(() => {
              const spreads = sanitizedInstruments.map(inst => spreadVsCaucion(inst.tem, config, inst.days)).filter(s => isFinite(s));
              const sorted = [...spreads].sort((a, b) => a - b);
              const median = sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : 0;
              const dotColor = median > 0.2 ? '#2eebc8' : median > 0.05 ? '#fbbf24' : '#f87171';
              return (
                <div className="flex items-center gap-1.5 shrink-0">
                  <svg width="8" height="8" viewBox="0 0 8 8"><circle cx="4" cy="4" r="4" fill={dotColor} opacity="0.7" /></svg>
                  <span className="text-[9px] text-app-text4 uppercase tracking-wider">Mediana spread</span>
                  <span className="text-[11px] font-mono font-medium" style={{ color: dotColor }}>+{median.toFixed(3)}%</span>
                </div>
              );
            })()}
            <div className="w-px h-3 bg-app-border/40 shrink-0" />
            {/* V3.3-PRO: Riesgo País Trend in Market Summary */}
            {(() => {
              const rp = riesgoPaisAuto ?? config.riesgoPais;
              const rpColor = rp > 700 ? '#f87171' : rp > 550 ? '#f472b6' : rp > 400 ? '#fbbf24' : '#2eebc8';
              return (
                <div className="flex items-center gap-1.5 shrink-0">
                  <svg width="8" height="8" viewBox="0 0 8 8"><circle cx="4" cy="4" r="4" fill={rpColor} opacity="0.7" /></svg>
                  <span className="text-[9px] text-app-text4 uppercase tracking-wider">RP</span>
                  <span className="text-[11px] font-mono font-medium" style={{ color: rpColor }}>{rp}pb</span>
                  {riesgoPaisTrend === 'up' && <span className="text-[9px] text-[#f87171]">↑</span>}
                  {riesgoPaisTrend === 'down' && <span className="text-[9px] text-[#2eebc8]">↓</span>}
                </div>
              );
            })()}
            <div className="w-px h-3 bg-app-border/40 shrink-0" />
            {/* TRAMPA count */}
            {(() => {
              const trampaCount = sanitizedInstruments.filter(inst => {
                const caucionTNA = getCaucionForDays(config, inst.days);
                const caucionTEM = caucionTEMFromTNA(caucionTNA);
                return inst.tem < caucionTEM;
              }).length;
              return (
                <div className="flex items-center gap-1.5 shrink-0">
                  <svg width="8" height="8" viewBox="0 0 8 8"><circle cx="4" cy="4" r="4" fill={trampaCount > 0 ? '#f87171' : '#2eebc8'} opacity="0.7" /></svg>
                  <span className="text-[9px] text-app-text4 uppercase tracking-wider">TRAMPA</span>
                  <span className={`text-[11px] font-mono font-medium ${trampaCount > 0 ? 'text-[#f87171]' : 'text-[#2eebc8]'}`}>{trampaCount}</span>
                </div>
              );
            })()}
            {/* Position carry */}
            {position && (() => {
              const heldInst = sanitizedInstruments.find(i => i.ticker === position.ticker);
              const carryPct = heldInst ? heldInst.tem - caucionTEMFromTNA(getCaucionForDays(config, heldInst.days)) : 0;
              return (
                <>
                  <div className="w-px h-3 bg-app-border/40 shrink-0" />
                  <div className="flex items-center gap-1.5 shrink-0">
                    <svg width="8" height="8" viewBox="0 0 8 8"><circle cx="4" cy="4" r="4" fill={carryPct >= 0 ? '#2eebc8' : '#f87171'} opacity="0.7" /></svg>
                    <span className="text-[9px] text-app-text4 uppercase tracking-wider">Carry</span>
                    <span className={`text-[11px] font-mono font-medium ${carryPct >= 0 ? 'text-[#2eebc8]' : 'text-[#f87171]'}`}>{carryPct >= 0 ? '+' : ''}{carryPct.toFixed(3)}%</span>
                  </div>
                </>
              );
            })()}
            {/* V1.6.2: MEP/CCL Brecha */}
            {mepRate && cclRate && (() => {
              const brecha = Math.abs(cclRate - mepRate);
              const brechaPct = ((cclRate - mepRate) / mepRate * 100);
              const dotColor = brechaPct < 2 ? '#2eebc8' : brechaPct < 5 ? '#fbbf24' : '#f87171';
              return (
                <>
                  <div className="w-px h-3 bg-app-border/40 shrink-0" />
                  <div className="flex items-center gap-1.5 shrink-0">
                    <svg width="8" height="8" viewBox="0 0 8 8"><circle cx="4" cy="4" r="4" fill={dotColor} opacity="0.7" /></svg>
                    <span className="text-[9px] text-app-text4 uppercase tracking-wider">MEP/CCL</span>
                    <span className={`text-[11px] font-mono font-medium`} style={{ color: dotColor }}>{brechaPct >= 0 ? '+' : ''}{brechaPct.toFixed(1)}%</span>
                    <span className="text-[8px] text-app-text4 font-mono">(${brecha.toFixed(0)})</span>
                  </div>
                </>
              );
            })()}
            {/* V1.6.2: Yield Curve Shape */}
            {(() => {
              const shapeColor = curveShape.shape === 'NORMAL' ? '#2eebc8' : curveShape.shape === 'PLANA' ? '#fbbf24' : curveShape.shape === 'INVERTIDA' ? '#f87171' : '#f472b6';
              return (
                <>
                  <div className="w-px h-3 bg-app-border/40 shrink-0" />
                  <div className="flex items-center gap-1.5 shrink-0">
                    <svg width="8" height="8" viewBox="0 0 8 8"><circle cx="4" cy="4" r="4" fill={shapeColor} opacity="0.7" /></svg>
                    <span className="text-[9px] text-app-text4 uppercase tracking-wider">Curva</span>
                    <span className="text-[11px] font-mono font-medium" style={{ color: shapeColor }}>{curveShape.shape.replace('_', ' ')}</span>
                  </div>
                </>
              );
            })()}
            {/* V3.1: IOL Level 2 Status */}
            {(() => {
              const iolCount = effectiveInstruments.filter(i => i.iolStatus === 'online').length;
              const iolAlerts = effectiveInstruments.filter(i => i.iolLiquidityAlert).length;
              const iolColor = iolCount > 0 ? '#a78bfa' : '#6b7280';
              return (
                <>
                  <div className="w-px h-3 bg-app-border/40 shrink-0" />
                  <div className="flex items-center gap-1.5 shrink-0">
                    <svg width="8" height="8" viewBox="0 0 8 8"><circle cx="4" cy="4" r="4" fill={iolColor} opacity="0.7" /></svg>
                    <span className="text-[9px] text-app-text4 uppercase tracking-wider">IOL L2</span>
                    <span className="text-[11px] font-mono font-medium" style={{ color: iolColor }}>{iolCount > 0 ? `${iolCount}` : 'OFF'}</span>
                    {iolAlerts > 0 && (
                      <span className="text-[9px] text-[#fbbf24] font-mono">⚠{iolAlerts}</span>
                    )}
                  </div>
                </>
              );
            })()}
          </div>
        </div>

        {/* Activity Feed Widget: REMOVED — was causing layout shift on auto-open/close */}

        {/* Page Content with fade transition */}
        <div className={`p-4 md:p-6 lg:p-8 transition-opacity duration-150 animate-fadeInUp ${tabTransition ? 'opacity-0' : 'opacity-100'}`}>
          {isTabLoading ? (
            <div className="space-y-5 animate-fadeIn motion-reduce:animate-none">
              {/* Skeleton Header Bar */}
              <div className="skeleton h-6 w-full rounded" />

              {/* Skeleton Metric Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="skeleton h-20 rounded-xl" />
                <div className="skeleton h-20 rounded-xl" />
                <div className="skeleton h-20 rounded-xl" />
              </div>

              {/* Skeleton Table Header */}
              <div className="skeleton h-8 w-full rounded" />

              {/* Skeleton Table Rows */}
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="skeleton h-10 w-full rounded" />
                ))}
              </div>
            </div>
          ) : (
            renderContent()
          )}
        </div>
      </main>

      {/* ── Footer (Enhanced V1.6.2) ── */}
      <div className="gradient-separator" />
      <footer className="mt-auto bg-app-card/80 backdrop-blur-sm px-5 py-2.5 flex items-center justify-between flex-wrap gap-y-1 gap-x-3">
        <div className="text-[8px] text-app-text4 font-mono flex items-center gap-2">
          <span className="version-pulse-dot" />
          <span>ARB//RADAR V3.4 — PRO TERMINAL</span>
          <span className="text-app-border/60">·</span>
          <span>{sanitizedInstruments.length} inst.</span>
          {dolarLastUpdateTime && (
            <>
              <span className="text-app-border/60">·</span>
              <span>USD {dolarLastUpdateTime}</span>
            </>
          )}
          {position && (
            <>
              <span className="text-app-border/60">·</span>
              <span className="text-[#2eebc8]">{position.ticker}</span>
            </>
          )}
        </div>
        <div className="text-[8px] text-app-text4 font-mono flex items-center gap-3">
          <span>Alt+1-9: Tabs</span>
          <span>Alt+T: Tema</span>
          <button onClick={() => setShowHelp(true)} className="hover:text-[#2eebc8] transition-colors cursor-pointer">?: Ayuda</button>
        </div>
      </footer>

      {/* ── Keyboard Shortcut Help Modal ── */}
      {showHelp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setShowHelp(false)}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div className="relative glass-card-accent p-6 w-full max-w-lg mx-4 animate-scale-in" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-medium text-app-text">
                <span className="text-[#2eebc8] mr-2">⌨️</span>Atajos de Teclado
              </h3>
              <button onClick={() => setShowHelp(false)} className="text-app-text4 hover:text-app-text transition-colors p-1 rounded-full hover:bg-app-subtle/50">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>

            {/* Navigation shortcuts */}
            <div className="mb-4">
              <div className="text-[10px] uppercase tracking-wider text-[#2eebc8] font-semibold mb-2">Navegación</div>
              <div className="space-y-1.5">
                {TAB_CONFIG.map((tab, i) => (
                  <div key={tab.id} className="flex items-center justify-between text-xs">
                    <span className="text-app-text2">{tab.icon} {tab.label}</span>
                    <div className="flex items-center gap-1">
                      <kbd className="px-1.5 py-0.5 rounded bg-app-subtle/80 text-app-text3 font-mono text-[10px] border border-app-border/60">Alt</kbd>
                      <span className="text-app-text4">+</span>
                      <kbd className="px-1.5 py-0.5 rounded bg-app-subtle/80 text-app-text3 font-mono text-[10px] border border-app-border/60">{i + 1}</kbd>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* General shortcuts */}
            <div className="mb-4">
              <div className="text-[10px] uppercase tracking-wider text-[#f472b6] font-semibold mb-2">General</div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-app-text2">Alternar tema claro/oscuro</span>
                  <div className="flex items-center gap-1">
                    <kbd className="px-1.5 py-0.5 rounded bg-app-subtle/80 text-app-text3 font-mono text-[10px] border border-app-border/60">Alt</kbd>
                    <span className="text-app-text4">+</span>
                    <kbd className="px-1.5 py-0.5 rounded bg-app-subtle/80 text-app-text3 font-mono text-[10px] border border-app-border/60">T</kbd>
                  </div>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-app-text2">Mostrar/ocultar ayuda</span>
                  <kbd className="px-1.5 py-0.5 rounded bg-app-subtle/80 text-app-text3 font-mono text-[10px] border border-app-border/60">?</kbd>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-app-text2">Cerrar diálogo</span>
                  <kbd className="px-1.5 py-0.5 rounded bg-app-subtle/80 text-app-text3 font-mono text-[10px] border border-app-border/60">Esc</kbd>
                </div>
              </div>
            </div>

            {/* Mercado shortcuts */}
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#fbbf24] font-semibold mb-2">Mercado</div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-app-text2">Ver detalle de instrumento</span>
                  <span className="text-app-text3 text-[10px]">Clic en ticker</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-app-text2">Reintentar cotización dólar</span>
                  <span className="text-app-text3 text-[10px]">Botón 🔄</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-app-text2">Exportar tabla a CSV</span>
                  <span className="text-app-text3 text-[10px]">Botón ⬇</span>
                </div>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-app-border/40 text-[9px] text-app-text4 text-center">
              Presioná <kbd className="px-1 py-0.5 rounded bg-app-subtle/80 font-mono text-[9px] border border-app-border/60">?</kbd> o <kbd className="px-1 py-0.5 rounded bg-app-subtle/80 font-mono text-[9px] border border-app-border/60">Esc</kbd> para cerrar
            </div>
          </div>
        </div>
      )}

      {/* ── V3.0: Nuke Confirmation Dialog ── */}
      {showNukeConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={handleNukeCancel}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div className="relative glass-card-accent p-6 w-full max-w-md mx-4 animate-scale-in" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center gap-3 mb-5">
              <div className="w-12 h-12 rounded-full bg-[#f87171]/10 border border-[#f87171]/30 flex items-center justify-center text-2xl">
                ☢
              </div>
              <div>
                <h3 className="text-lg font-semibold text-[#f87171]">Limpieza Profunda</h3>
                <p className="text-[10px] text-app-text4">Esta acción no se puede deshacer</p>
              </div>
            </div>

            {/* Warning body */}
            <div className="space-y-3 mb-6">
              <div className="bg-[#f87171]/5 border border-[#f87171]/20 rounded-lg p-3">
                <p className="text-sm text-app-text2 leading-relaxed">
                  Se ejecutará <code className="text-[#f87171] font-mono text-xs bg-[#f87171]/10 px-1.5 py-0.5 rounded">localStorage.clear()</code> y la página se recargará desde cero.
                </p>
              </div>

              <div className="text-xs text-app-text3 space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-[#f87171]">✗</span>
                  <span>Todas las operaciones (compras/ventas) serán eliminadas</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[#f87171]">✗</span>
                  <span>La posición actual será eliminada</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[#f87171]">✗</span>
                  <span>Historial de precios y snapshots serán eliminados</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[#f87171]">✗</span>
                  <span>Configuración custom será eliminada</span>
                </div>
              </div>

              <div className="bg-app-subtle/30 rounded-lg p-2.5 text-center">
                <span className="text-[10px] text-app-text4">Estado post-nuke:</span>
                <div className="text-sm font-mono text-[#2eebc8] mt-0.5">
                  Capital: $390.000 · Posición: ninguna · Operaciones: 0
                </div>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-3">
              <button
                onClick={handleNukeCancel}
                className="flex-1 px-4 py-2.5 rounded-lg bg-app-subtle/60 text-app-text3 text-sm font-medium hover:bg-app-subtle/80 transition-colors border border-app-border/60"
              >
                Cancelar
              </button>
              <button
                onClick={handleNukeConfirm}
                className="flex-1 px-4 py-2.5 rounded-lg bg-[#f87171] text-white text-sm font-semibold hover:bg-[#ef4444] transition-colors shadow-lg shadow-[#f87171]/20"
              >
                ☢ Nuke — Borrar Todo
              </button>
            </div>

            <div className="mt-3 text-center text-[9px] text-app-text4">
              Presioná <kbd className="px-1 py-0.5 rounded bg-app-subtle/80 font-mono text-[9px] border border-app-border/60">Esc</kbd> para cancelar
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Home() {
  return <HomeContent />;
}
