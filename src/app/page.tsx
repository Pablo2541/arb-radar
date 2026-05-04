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

// ── Dynamic imports for memory efficiency ──
// Tabs are compiled on-demand, reducing initial compile memory from ~1.2GB to ~400MB
import dynamic from 'next/dynamic';
import ThresholdAlerts from '@/components/dashboard/ThresholdAlerts';

// Light tabs — loaded eagerly (small bundle)
import MercadoTab from '@/components/dashboard/MercadoTab';
import CurvasTab from '@/components/dashboard/CurvasTab';

// Loading skeleton for lazy-loaded tabs (defined before dynamic imports for hoisting)
function TabSkeleton() {
  return (
    <div className="p-6 animate-pulse space-y-4">
      <div className="h-6 bg-app-subtle/50 rounded w-48" />
      <div className="h-32 bg-app-subtle/30 rounded-lg" />
      <div className="grid grid-cols-3 gap-3">
        {[1,2,3].map(i => <div key={i} className="h-20 bg-app-subtle/20 rounded-lg" />)}
      </div>
      <div className="h-48 bg-app-subtle/20 rounded-lg" />
    </div>
  );
}

// Heavy tabs — loaded lazily (only compiled when user navigates to them)
const OportunidadesTab = dynamic(() => import('@/components/dashboard/OportunidadesTab'), { ssr: false, loading: TabSkeleton });
const ArbitrajeTab = dynamic(() => import('@/components/dashboard/ArbitrajeTab'), { ssr: false, loading: TabSkeleton });
const EstrategiasTab = dynamic(() => import('@/components/dashboard/EstrategiasTab'), { ssr: false, loading: TabSkeleton });
const CarteraTab = dynamic(() => import('@/components/dashboard/CarteraTab'), { ssr: false, loading: TabSkeleton });
const DiagnosticoTab = dynamic(() => import('@/components/dashboard/DiagnosticoTab'), { ssr: false, loading: TabSkeleton });
const HistorialTab = dynamic(() => import('@/components/dashboard/HistorialTab'), { ssr: false, loading: TabSkeleton });
const HistoricoTab = dynamic(() => import('@/components/dashboard/HistoricoTab'), { ssr: false, loading: TabSkeleton });
const ConfiguracionTab = dynamic(() => import('@/components/dashboard/ConfiguracionTab'), { ssr: false, loading: TabSkeleton });

const TAB_CONFIG: { id: TabId; icon: string; label: string; shortcut: string }[] = [
  { id: 'mercado', icon: '📊', label: 'Mercado', shortcut: '1' },
  { id: 'oportunidades', icon: '🎯', label: 'Oportunidades', shortcut: '2' },
  { id: 'curvas', icon: '📈', label: 'Curvas', shortcut: '3' },
  { id: 'arbitraje', icon: '🔄', label: 'Arbitraje', shortcut: '4' },
  { id: 'estrategias', icon: '⚡', label: 'Estrategias', shortcut: '5' },
  { id: 'cartera', icon: '💼', label: 'Cartera', shortcut: '6' },
  { id: 'diagnostico', icon: '🩺', label: 'Diagnóstico', shortcut: '7' },
  { id: 'historial', icon: '📋', label: 'Historial', shortcut: '8' },
  { id: 'historico', icon: '📈', label: 'Histórico', shortcut: 'H' },
  { id: 'configuracion', icon: '⚙️', label: 'Config', shortcut: '9' },
];

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
  const activityFeed = useRadarStore(s => s.activityFeed);
  const dbAvailable = useRadarStore(s => s.dbAvailable);
  const lastDbSyncStatus = useRadarStore(s => s.lastDbSyncStatus);
  const iolLevel2Online = useRadarStore(s => s.iolLevel2Online);

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
  const addActivity = useRadarStore(s => s.addActivity);
  const clearActivityFeed = useRadarStore(s => s.clearActivityFeed);

  // ── Local-only state (NOT in store) ──
  const [tabTransition, setTabTransition] = useState(false);
  const [isTabLoading, setIsTabLoading] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [showHelp, setShowHelp] = useState(false);
  const [showNukeConfirm, setShowNukeConfirm] = useState(false);
  const [dolarLastUpdateTime, setDolarLastUpdateTime] = useState<string>('');

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
  useEffect(() => {
    initializeStore().then(() => {
      const validInstruments = useRadarStore.getState().instruments;
      sessionHistory.addSnapshot(validInstruments);
    });
  }, []);

  // ── V3.0: Persist state changes (store handles localStorage + DB) ──
  const updateInstruments = useCallback((v: Instrument[]) => {
    useRadarStore.getState().setInstruments(v);
    sessionHistory.addSnapshot(useRadarStore.getState().instruments);
    useRadarStore.getState().addActivity({ icon: '📊', message: 'Datos actualizados', type: 'data' });
  }, [sessionHistory]);

  const updateConfig = useCallback((v: Config) => {
    useRadarStore.getState().setConfig(v);
  }, []);

  const updatePosition = useCallback((v: Position | null) => {
    useRadarStore.getState().setPosition(v);
    useRadarStore.getState().addActivity({ icon: '💼', message: `Posición modificada: ${v?.ticker ?? 'cerrada'}`, type: 'position' });
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
    useRadarStore.getState().addActivity({ icon: '💱', message: 'Cotización dólar actualizada', type: 'dolar' });
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
    useRadarStore.getState().addActivity({ icon: '📡', message: `${trulyNew.length} instrumento(s) nuevo(s) desde LIVE: ${trulyNew.map(i => i.ticker).join(', ')}`, type: 'data' });
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
        useRadarStore.getState().addActivity({ icon: '💾', message: 'Precios LIVE preservados al desconectar', type: 'data' });
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
            Cargando V3.2.1...
          </p>
        </div>
      </div>
    );
  }

  // ── Tab Content ──
  const renderContent = () => {
    switch (activeTab) {
      case 'mercado':
        return <MercadoTab instruments={effectiveInstruments} config={config} position={position} momentumMap={momentumMap} priceHistory={priceHistory} onMepRate={handleMepRate} onCclRate={handleCclRate} onDolarUpdate={handleDolarUpdate} liveData={liveData} liveDataMap={liveDataMap} />;
      case 'oportunidades':
        return <OportunidadesTab instruments={effectiveInstruments} config={config} position={position} momentumMap={momentumMap} priceHistory={priceHistory} liveDataMap={liveDataMap} isLive={liveData.active} />;
      case 'curvas':
        return <CurvasTab instruments={sanitizedInstruments} config={config} position={position} momentumMap={momentumMap} />;
      case 'arbitraje':
        return <ArbitrajeTab instruments={effectiveInstruments} config={config} position={position} momentumMap={momentumMap} priceHistory={priceHistory} />;
      case 'estrategias':
        return <EstrategiasTab instruments={effectiveInstruments} config={config} position={position} momentumMap={momentumMap} priceHistory={priceHistory} />;
      case 'cartera':
        return <CarteraTab instruments={effectiveInstruments} config={config} setConfig={updateConfig} position={position} setPosition={updatePosition} transactions={transactions} setTransactions={updateTransactions} externalHistory={externalHistory} setExternalHistory={updateExternalHistory} momentumMap={momentumMap} priceHistory={priceHistory} liveDataMap={liveDataMap} isLive={liveData.active} />;
      case 'diagnostico':
        return <DiagnosticoTab instruments={effectiveInstruments} config={config} position={position} mepRate={mepRate} momentumMap={momentumMap} priceHistory={priceHistory} />;
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
            <span className="text-[8px] text-app-text4 uppercase tracking-[0.2em] hidden sm:inline font-light">V3.2.1</span>
            {/* V3.0: DB Sync indicator dot */}
            <div className="w-1.5 h-1.5 rounded-full hidden sm:block" style={{ backgroundColor: dbSyncDotColor }} title={dbAvailable ? `DB: ${lastDbSyncStatus}` : 'DB: no configurado'} />
            {/* V3.1: IOL Level 2 indicator dot */}
            <div className={`flex items-center gap-1 hidden sm:flex ${iolLevel2Online ? 'text-[#a78bfa]' : 'text-app-text4'}`} title={iolLevel2Online ? 'IOL Nivel 2: ONLINE — Volumen validado' : 'IOL Nivel 2: OFFLINE — Sin datos de volumen'}>
              <div className={`w-1.5 h-1.5 rounded-full ${iolLevel2Online ? 'bg-[#a78bfa] animate-pulse' : 'bg-app-text4'}`} />
              <span className="text-[7px] font-mono uppercase tracking-wider">{iolLevel2Online ? 'L2' : 'L2✗'}</span>
            </div>
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
      <main className="flex-1 overflow-auto">
        {/* Status Bar */}
        <div className="sticky top-0 z-20 bg-app-bg/85 backdrop-blur-md border-b border-app-border/60 border-app-accent/10 px-5 py-2 flex items-center justify-between flex-wrap gap-y-1">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-light text-app-text2">
              {activeTab === 'mercado' && '📊 Mercado'}
              {activeTab === 'oportunidades' && '🎯 Oportunidades'}
              {activeTab === 'curvas' && '📈 Curvas'}
              {activeTab === 'arbitraje' && '🔄 Arbitraje'}
              {activeTab === 'estrategias' && '⚡ Estrategias'}
              {activeTab === 'cartera' && '💼 Cartera'}
              {activeTab === 'diagnostico' && '🩺 Diagnóstico'}
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
            {/* Riesgo País */}
            <div className="card-hover-lift flex items-center gap-1.5 text-[9px] bg-app-subtle/60 px-2.5 py-1.5 rounded-lg border border-app-border/60">
              <span className="text-app-text3">RP:</span>
              <span className="font-mono font-medium" style={{ color: config.riesgoPais > 650 ? '#f87171' : config.riesgoPais > 550 ? '#f472b6' : config.riesgoPais > 450 ? '#fbbf24' : '#2eebc8' }}>
                {config.riesgoPais}pb
              </span>
            </div>
            {/* MEP Rate */}
            {mepRate && (
              <div className="card-hover-lift flex items-center gap-1.5 text-[9px] bg-app-subtle/60 px-2.5 py-1.5 rounded-lg border border-app-border/60">
                <span className="text-app-text3">MEP:</span>
                <span className={`font-mono font-medium ${mepRate > 1550 ? 'text-[#f87171]' : mepRate > 1450 ? 'text-[#fbbf24]' : 'text-[#2eebc8]'}`}>
                  ${mepRate.toFixed(0)}
                </span>
              </div>
            )}
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

        {/* ── Activity Feed Widget (V1.6.2) ── */}
        {activityFeed.length > 0 && (
          <div className="px-4 md:px-6 lg:px-8 py-0.5">
            <div className="glass-card px-4 py-2 max-h-32 overflow-y-auto custom-scrollbar">
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="text-[8px] text-app-text4 uppercase tracking-wider font-medium">Actividad reciente</span>
                <button
                  onClick={() => clearActivityFeed()}
                  className="text-[8px] text-app-text4 hover:text-[#f87171] transition-colors ml-auto"
                  title="Limpiar actividad"
                >✕</button>
              </div>
              {activityFeed.map(item => (
                <div key={item.id} className="activity-feed-item">
                  <span className="text-[10px] shrink-0">{item.icon}</span>
                  <span className="text-[10px] text-app-text3 flex-1">{item.message}</span>
                  <span className="text-[8px] text-app-text4 font-mono shrink-0">{item.timestamp}</span>
                </div>
              ))}
            </div>
          </div>
        )}

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
          <span>ARB//RADAR V3.0</span>
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
