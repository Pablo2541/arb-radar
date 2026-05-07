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
import { startApiSequence, stopApiSequence, type ApiCallback } from '@/lib/api-orchestrator';
import { spreadVsCaucion, caucionTEMFromTNA, getCaucionForDays, analyzeCurveShape } from '@/lib/calculations';
import { useSessionHistory } from '@/hooks/useSessionHistory';
import { useLiveInstruments } from '@/hooks/useLiveInstruments';
import type { PriceHistoryFile } from '@/lib/priceHistory';

// ── V4.0 BLINDADO: Static imports — Eliminates ChunkLoadError ──
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
// V4.0 BLINDADO — Global Absorption Alert Banner
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
      // V4.0: Use the API orchestrator cache instead of direct fetch
      const { getCachedResult } = await import('@/lib/api-orchestrator');
      const cached = getCachedResult('market-pressure');
      if (cached && !cached.error && cached.data) {
        const json = cached.data as Record<string, unknown>;
        if (json.iol_available && json.alerts && Array.isArray(json.alerts) && json.alerts.length > 0) {
          setAlerts(json.alerts as AbsorptionAlertData[]);
        } else {
          setAlerts([]);
        }
      }
    } catch {
      // Silent fail
    }
  }, []);

  useEffect(() => {
    // V4.0: Check orchestrator cache every 30s (no direct API calls)
    const initialTimeout = setTimeout(() => fetchAlerts(), 25000);
    intervalRef.current = setInterval(fetchAlerts, 30_000);
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
  // V4.0 BLINDADO — Zustand Store (replaces ALL useState for shared state)
  // NO NEON DB — File persistence only
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
  const iolLevel2Online = useRadarStore(s => s.iolLevel2Online);
  const iolCredentialsExist = useRadarStore(s => s.iolCredentialsExist);
  const iolConnectionFailed = useRadarStore(s => s.iolConnectionFailed);
  const riesgoPaisAuto = useRadarStore(s => s.riesgoPaisAuto);
  // V4.0: File persistence indicators (replaces DB sync)
  const portfolioSource = useRadarStore(s => s.portfolioSource);
  const portfolioLastSaved = useRadarStore(s => s.portfolioLastSaved);
  // Market Truth indicator uses reactive hooks
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
  const [dolarLastUpdateTime, setDolarLastUpdateTime] = useState<string>('');
  // Track previous Riesgo País value for trend arrow
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
        // IOL Level 2 enrichment from /api/letras — real-time order book data
        iolVolume: liveInst.iol_volume ?? inst.iolVolume,
        iolBid: liveInst.iol_bid ?? inst.iolBid,
        iolAsk: liveInst.iol_ask ?? inst.iolAsk,
        iolBidDepth: liveInst.iol_bid_depth ?? inst.iolBidDepth,
        iolAskDepth: liveInst.iol_ask_depth ?? inst.iolAskDepth,
        iolMarketPressure: liveInst.iol_market_pressure ?? inst.iolMarketPressure,
        iolStatus: liveInst.iol_status ?? inst.iolStatus,
        // data912 volume as fallback for VOL column
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

  // ── Theme toggle (uses store) ──
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
      // Ctrl+L to toggle LIVE refresh mode (faster intervals)
      if (e.ctrlKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        const liveToggleEvent = new CustomEvent('arb-radar-toggle-live');
        window.dispatchEvent(liveToggleEvent);
      }
      // Ctrl+S to save portfolio to file
      if (e.ctrlKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        useRadarStore.getState().savePortfolioToFile();
      }
      // Show help modal on ? key
      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault();
        setShowHelp(prev => !prev);
      }
      // Close help on Escape
      if (e.key === 'Escape') {
        setShowHelp(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleTabChange, toggleTheme]);

  // ════════════════════════════════════════════════════════════════
  // V4.0 BLINDADO: Initialize store — File first, then localStorage fallback
  // No DB sync. Portfolio.json is the TRUTH file.
  // After initialization, auto-start the API orchestrator after 3s delay.
  // ════════════════════════════════════════════════════════════════
  const apiOrchestratorStartedRef = useRef(false);

  const handleApiResult = useCallback<ApiCallback>((name: string, data: unknown, error: boolean) => {
    if (error) return; // Silent — cached data or defaults will be used

    try {
      if (name === 'market-truth' && data && typeof data === 'object') {
        const mt = data as Record<string, unknown>;
        // ── Process RP ──
        const rp = mt.riesgo_pais as Record<string, unknown> | undefined;
        if (rp?.value && rp.value as number > 0) {
          const currentRP = useRadarStore.getState().riesgoPaisAuto ?? useRadarStore.getState().config.riesgoPais;
          if (prevRiesgoPaisRef.current !== null && currentRP !== (rp.value as number)) {
            setRiesgoPaisTrend((rp.value as number) > currentRP ? 'up' : (rp.value as number) < currentRP ? 'down' : 'flat');
          }
          prevRiesgoPaisRef.current = currentRP;
        }
        // ── Set full Market Truth data ──
        useRadarStore.getState().setMarketTruth(data);
      }

      if (name === 'iol-status' && data && typeof data === 'object') {
        const iolData = data as Record<string, unknown>;
        const store = useRadarStore.getState();
        if (iolData.token_status === 'not_configured') {
          store.setIolCredentialsExist(false);
          store.setIolConnectionFailed(false);
          store.setIolLevel2Online(false);
        } else if (iolData.token_status === 'invalid') {
          store.setIolCredentialsExist(true);
          store.setIolConnectionFailed(true);
          store.setIolLevel2Online(false);
        } else if (iolData.iol_available) {
          const hasOnlineData = Object.values(iolData.data as Record<string, { status: string }>)
            .some((td) => td.status === 'online');
          store.setIolCredentialsExist(true);
          store.setIolConnectionFailed(false);
          store.setIolLevel2Online(hasOnlineData);
        } else {
          store.setIolCredentialsExist(true);
          store.setIolConnectionFailed(true);
          store.setIolLevel2Online(false);
        }
      }
    } catch {
      // Silent — orchestrator results are best-effort
    }
  }, []);

  useEffect(() => {
    initializeStore().then(() => {
      const validInstruments = useRadarStore.getState().instruments;
      sessionHistory.addSnapshot(validInstruments);

      // Auto-start API orchestrator after 30-second delay
      // The sandbox is fragile — page compilation + API calls = crash.
      // Give the browser a full 30s to finish loading before hitting APIs.
      if (!apiOrchestratorStartedRef.current) {
        const startTimer = setTimeout(() => {
          apiOrchestratorStartedRef.current = true;
          startApiSequence(handleApiResult);
          console.log('[page] API orchestrator auto-started after initialization');
        }, 30000);
        return () => clearTimeout(startTimer);
      }
    });
    return () => {
      if (apiOrchestratorStartedRef.current) {
        stopApiSequence();
        apiOrchestratorStartedRef.current = false;
      }
    };
  }, []);

  // ── V4.0: Persist state changes (store handles localStorage only) ──
  const updateInstruments = useCallback((v: Instrument[]) => {
    useRadarStore.getState().setInstruments(v);
    sessionHistory.addSnapshot(useRadarStore.getState().instruments);
  }, [sessionHistory]);

  const updateConfig = useCallback((v: Config) => {
    useRadarStore.getState().setConfig(v);
  }, []);

  const updatePosition = useCallback((v: Position | null) => {
    useRadarStore.getState().setPosition(v);
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
  // V4.0 BLINDADO — RESET: Simplified nuke (no confirmation dialog)
  // ════════════════════════════════════════════════════════════════

  const handleReset = () => {
    useRadarStore.getState().nukeAll();
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

  // ── V4.0: FILE indicator color + label (replaces DB sync dot) ──
  const fileIndicator = useMemo(() => {
    switch (portfolioSource) {
      case 'file': return { dotColor: '#2eebc8', label: 'FILE', title: 'Portfolio cargado desde portfolio.json' };
      case 'localStorage': return { dotColor: '#fbbf24', label: 'FILE?', title: 'Portfolio desde localStorage (fallback — portfolio.json no disponible)' };
      case 'defaults': return { dotColor: '#6b7280', label: 'FILE✗', title: 'Portfolio por defecto — sin archivo ni localStorage' };
      default: return { dotColor: '#6b7280', label: 'FILE✗', title: 'Portfolio: estado desconocido' };
    }
  }, [portfolioSource]);

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
            Cargando V4.0 BLINDADO...
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
      <header className="sticky top-0 z-30 header-gradient-bg backdrop-blur-xl">
        {/* Top row: Logo + clock + indicators + toggles */}
        <div className="flex items-center justify-between px-5 py-2 border-b border-app-border/40">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-light tracking-wide">
              <span className="text-app-accent-text font-medium">ARB</span>
              <span className="text-app-text4 mx-0.5">{'//'}</span>
              <span className="text-app-pink font-medium">RADAR</span>
            </h1>
            <span className="text-[8px] text-app-text4 uppercase tracking-[0.2em] hidden sm:inline font-light">V4.0 — BLINDADO</span>
            {/* V4.0: FILE indicator — replaces DB sync dot */}
            <div className="flex items-center gap-1 hidden sm:flex" title={fileIndicator.title}>
              <div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: fileIndicator.dotColor, animation: portfolioSource === 'file' ? 'pulse 2s infinite' : 'none' }}
              />
              <span className="text-[7px] font-mono uppercase tracking-wider font-bold" style={{ color: fileIndicator.dotColor }}>
                {fileIndicator.label}
              </span>
            </div>
            {/* IOL Level 2 indicator — 3-state LED */}
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

              if (isOnline) {
                dotColor = '#a78bfa'; // purple
                label = 'L2';
                title = 'IOL Nivel 2: ONLINE — Volumen validado';
              } else if (noCreds) {
                dotColor = '#6b7280'; // gray
                label = 'L2✗';
                title = 'IOL Nivel 2: SIN CREDENCIALES — Configure IOL_USERNAME/IOL_PASSWORD en .env';
              } else if (connFailed) {
                dotColor = '#fb923c'; // orange
                label = 'L2⚠';
                title = 'IOL Nivel 2: CONEXIÓN FALLIDA — Credenciales presentes pero API no responde';
              } else {
                dotColor = '#6b7280'; // gray (default/unknown)
                label = 'L2✗';
                title = 'IOL Nivel 2: OFFLINE';
              }

              return (
                <div className="flex items-center gap-1 hidden sm:flex" title={title}>
                  <div
                    className={`w-2 h-2 rounded-full ${isOnline ? 'iol-dot-online' : connFailed ? 'iol-dot-error' : ''}`}
                    style={{ backgroundColor: dotColor }}
                  />
                  <span className="text-[7px] font-mono uppercase tracking-wider font-bold" style={{ color: dotColor }}>
                    {label}
                  </span>
                </div>
              );
            })()}
            {/* Market Truth Engine indicator — SWR stale aware (REACTIVE) */}
            {(() => {
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
            {/* Enhanced Market status indicator with pulsing badge */}
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[8px] font-bold tracking-wider ${marketOpen ? 'market-badge-open bg-[#2eebc8]/10 text-[#2eebc8]' : 'market-badge-closed bg-app-subtle/50 text-app-text4'}`}>
              <div className={`w-2 h-2 rounded-full ${marketOpen ? 'bg-[#2eebc8]' : 'bg-app-text4'} ${marketOpen ? 'iol-dot-online' : ''}`} />
              <span className="hidden sm:inline">{marketOpen ? 'MERCADO ABIERTO' : 'MERCADO CERRADO'}</span>
              <span className="sm:hidden">{marketOpen ? 'OPEN' : 'CLOSED'}</span>
              <span className="text-[7px] opacity-60 font-normal">10–17h</span>
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
        <div className="sticky top-0 z-20 bg-app-bg/85 backdrop-blur-md border-b border-app-border/60 border-app-accent/10 px-4 md:px-5 py-2 flex items-center justify-between flex-wrap gap-y-1">
          <div className="flex items-center gap-2 md:gap-3">
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
              <span className="text-[9px] text-app-text4 font-mono hidden sm:inline">
                {lastUpdate}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 md:gap-2 flex-wrap">
            {/* Last Updated Timestamp */}
            {(() => {
              const updateSource = dolarLastUpdateTime || lastUpdate;
              if (!updateSource) return null;
              return (
                <div className="flex items-center gap-1 text-[8px] text-app-text4 font-mono bg-app-subtle/40 px-2 py-1 rounded-md border border-app-border/40">
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                  <span>{updateSource}</span>
                </div>
              );
            })()}
            {/* Capital Disponible */}
            <div className="card-hover-lift flex items-center gap-1.5 text-[9px] bg-app-accent-dim/50 px-2.5 py-1.5 rounded-lg border border-app-accent-border/60">
              <span className="text-app-text3">Capital:</span>
              <span className="font-mono font-medium text-app-accent-text">
                ${config.capitalDisponible.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
              </span>
            </div>
            {/* Riesgo País — Market Truth Engine with confidence + SWR stale */}
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
                  {/* Confidence badge */}
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
            {/* MEP Rate — Market Truth Engine with confidence + SWR stale */}
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
                  {/* Confidence badge + source detail */}
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
            {/* V4.0 BLINDADO: Reset Button — Simplified (no confirmation dialog) */}
            <button
              onClick={handleReset}
              className="text-[9px] text-app-text4 hover:text-[#f87171] transition-colors px-1.5 py-1 rounded hover:bg-[#f87171]/10"
              title="☢ Reset — Borrar localStorage y recargar"
            >
              ☢
            </button>
          </div>
        </div>

        {/* Threshold Alerts */}
        <div className="px-4 md:px-6 lg:px-8 pt-2">
          <ThresholdAlerts instruments={sanitizedInstruments} config={config} position={position} momentumMap={momentumMap} />
        </div>

        {/* Global Absorption Alert Banner */}
        <AbsorptionAlertBanner />

        {/* Order Flow Imbalance Alert */}
        <OrderFlowAlert />

        {/* ── Market Summary Widget ── */}
        <div className="px-4 md:px-6 lg:px-8 py-1">
          <div className="glass-card card-shadow flex items-center gap-4 px-4 py-1.5 overflow-x-auto scrollbar-hide">
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
            {/* Average TEM */}
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
            {/* Best spread */}
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
            {/* Spread MEDIAN */}
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
            {/* Riesgo País Trend */}
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
            {/* MEP/CCL Brecha */}
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
            {/* Yield Curve Shape */}
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
            {/* IOL Level 2 Status */}
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

        {/* ════════════════════════════════════════════════════════════════
           V4.0 BLINDADO — QUICK STATS SUMMARY BAR
           Portfolio overview: Total Capital, Current Position, P&L, Portfolio TEM
           ════════════════════════════════════════════════════════════════ */}
        <div className="px-4 md:px-6 lg:px-8 py-1">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {(() => {
              const heldInstrument = position ? effectiveInstruments.find(i => i.ticker === position.ticker) : null;
              const investedAtMarket = position && heldInstrument ? position.vn * heldInstrument.price : 0;
              const totalCapital = config.capitalDisponible + investedAtMarket;
              const unrealizedPnL = (() => {
                if (!position || !heldInstrument) return 0;
                const valorActual = position.vn * heldInstrument.price;
                const costoEntrada = position.precioConComision
                  ? position.vn * position.precioConComision
                  : position.vn * position.entryPrice * (1 + config.comisionTotal / 2 / 100);
                return valorActual - costoEntrada;
              })();
              const realizedPnL = transactions.filter(tx => tx.type === 'SELL').reduce((sum, tx) => sum + (tx.pnl || 0), 0);
              const totalPnL = realizedPnL + unrealizedPnL;
              const portfolioTEM = position && heldInstrument ? heldInstrument.tem : 0;

              return (
                <>
                  {/* Total Capital */}
                  <div className="quick-stat-card">
                    <div className="text-[8px] text-app-text4 uppercase tracking-wider font-medium mb-0.5">Capital Total</div>
                    <div className="text-[13px] font-mono font-semibold text-app-accent-text number-transition">
                      ${totalCapital.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                    </div>
                    <div className="text-[7px] text-app-text4 mt-0.5">
                      Efectivo: ${config.capitalDisponible.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                    </div>
                  </div>
                  {/* Current Position */}
                  <div className="quick-stat-card">
                    <div className="text-[8px] text-app-text4 uppercase tracking-wider font-medium mb-0.5">Posición</div>
                    <div className="text-[13px] font-mono font-semibold number-transition">
                      {position ? (
                        <span className="text-[#2eebc8]">{position.ticker}</span>
                      ) : (
                        <span className="text-app-text4">Sin posición</span>
                      )}
                    </div>
                    {position && heldInstrument && (
                      <div className="text-[7px] text-app-text4 mt-0.5">
                        {position.vn.toLocaleString()} VN · ${heldInstrument.price.toFixed(2)}
                      </div>
                    )}
                  </div>
                  {/* P&L Total */}
                  <div className="quick-stat-card">
                    <div className="text-[8px] text-app-text4 uppercase tracking-wider font-medium mb-0.5">P&L Total</div>
                    <div className={`text-[13px] font-mono font-semibold number-transition ${totalPnL >= 0 ? 'text-[#2eebc8]' : 'text-[#f87171]'}`}>
                      {totalPnL >= 0 ? '+' : ''}${totalPnL.toLocaleString('es-AR', { maximumFractionDigits: 0, minimumFractionDigits: 0 })}
                    </div>
                    <div className="text-[7px] text-app-text4 mt-0.5">
                      Realizado: ${realizedPnL.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                    </div>
                  </div>
                  {/* Portfolio TEM */}
                  <div className="quick-stat-card">
                    <div className="text-[8px] text-app-text4 uppercase tracking-wider font-medium mb-0.5">TEM Portafolio</div>
                    <div className={`text-[13px] font-mono font-semibold number-transition ${portfolioTEM > 2 ? 'text-[#2eebc8]' : portfolioTEM > 0 ? 'text-[#fbbf24]' : 'text-app-text4'}`}>
                      {portfolioTEM > 0 ? `${portfolioTEM.toFixed(2)}%` : '—'}
                    </div>
                    {position && heldInstrument && (
                      <div className="text-[7px] text-app-text4 mt-0.5">
                        Carry: {(heldInstrument.tem - (caucionTEMFromTNA(getCaucionForDays(config, heldInstrument.days)))).toFixed(3)}%
                      </div>
                    )}
                  </div>
                </>
              );
            })()}
          </div>
        </div>

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

      {/* ── Footer (V4.0 BLINDADO — Compact + Professional) ── */}
      <div className="gradient-separator" />
      <footer className="mt-auto footer-compact backdrop-blur-sm px-4 md:px-6 py-1.5 flex items-center justify-between flex-wrap gap-y-0.5 gap-x-4">
        <div className="text-[7px] text-app-text4 font-mono flex items-center gap-2">
          <span className="version-pulse-dot" />
          <span className="font-semibold tracking-wide">ARB//RADAR</span>
          <span className="text-app-border/60">·</span>
          <span>V4.0 BLINDADO</span>
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
              <span className="text-[#2eebc8] font-medium">{position.ticker}</span>
            </>
          )}
        </div>
        <div className="text-[7px] text-app-text4 font-mono flex items-center gap-2.5">
          <span className="hidden sm:inline-flex items-center gap-0.5">
            <kbd className="px-1 py-0 rounded text-[6px]">Alt</kbd>
            <span>+</span>
            <kbd className="px-1 py-0 rounded text-[6px]">1-9</kbd>
            <span className="ml-0.5">Tabs</span>
          </span>
          <span className="hidden sm:inline-flex items-center gap-0.5">
            <kbd className="px-1 py-0 rounded text-[6px]">Alt</kbd>
            <span>+</span>
            <kbd className="px-1 py-0 rounded text-[6px]">T</kbd>
            <span className="ml-0.5">Tema</span>
          </span>
          <span className="hidden sm:inline-flex items-center gap-0.5">
            <kbd className="px-1 py-0 rounded text-[6px]">Ctrl</kbd>
            <span>+</span>
            <kbd className="px-1 py-0 rounded text-[6px]">S</kbd>
            <span className="ml-0.5">Guardar</span>
          </span>
          <span className="inline-flex items-center gap-0.5">
            <kbd className="px-1 py-0 rounded text-[6px]">?</kbd>
            <span className="ml-0.5">Ayuda</span>
          </span>
          <button onClick={() => setShowHelp(true)} className="hover:text-[#2eebc8] transition-colors cursor-pointer ml-1 text-[8px]">⌨️</button>
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
                  <span className="text-app-text2">Guardar portfolio a archivo</span>
                  <div className="flex items-center gap-1">
                    <kbd className="px-1.5 py-0.5 rounded bg-app-subtle/80 text-app-text3 font-mono text-[10px] border border-app-border/60">Ctrl</kbd>
                    <span className="text-app-text4">+</span>
                    <kbd className="px-1.5 py-0.5 rounded bg-app-subtle/80 text-app-text3 font-mono text-[10px] border border-app-border/60">S</kbd>
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

            {/* LIVE shortcuts */}
            <div className="mb-4">
              <div className="text-[10px] uppercase tracking-wider text-[#2eebc8] font-semibold mb-2">Datos en Vivo</div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-app-text2">Toggle LIVE on/off</span>
                  <div className="flex items-center gap-1">
                    <kbd className="px-1.5 py-0.5 rounded bg-app-subtle/80 text-app-text3 font-mono text-[10px] border border-app-border/60">Ctrl</kbd>
                    <span className="text-app-text4">+</span>
                    <kbd className="px-1.5 py-0.5 rounded bg-app-subtle/80 text-app-text3 font-mono text-[10px] border border-app-border/60">L</kbd>
                  </div>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-app-text2">Ver detalle de instrumento</span>
                  <span className="text-app-text3 text-[10px]">Clic en ticker</span>
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
    </div>
  );
}

export default function Home() {
  return <HomeContent />;
}
