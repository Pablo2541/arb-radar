'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Instrument, Config, Position, MomentumData, DolarRate, PriceHistoryFile, SRData, LiveInstrument } from '@/lib/types';
import {
  spreadVsCaucion,
  getSpreadSignal,
  caucionTEMFromTNA,
  getCaucionForDays,
  calculateCompositeSignal,
  durationMod,
} from '@/lib/calculations';
import { getLatestDM, calculateSR } from '@/lib/priceHistory';
import ChartContainer from './ChartContainer';
import type { LiveInstrumentsState } from '@/hooks/useLiveInstruments';
import InstrumentDetail from './InstrumentDetail';
import InstrumentCompare from './InstrumentCompare';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  BarChart, Bar, Cell, ReferenceLine,
} from 'recharts';

interface MercadoTabProps {
  instruments: Instrument[];         // V2.0.3: already instruments from page.tsx
  config: Config;
  position: Position | null;
  momentumMap: Map<string, MomentumData>;
  priceHistory: PriceHistoryFile | null;
  onMepRate?: (rate: number) => void;
  onCclRate?: (rate: number) => void;
  onDolarUpdate?: (timestamp: string) => void;
  // V2.0.3: Live data comes from parent (page.tsx) — no more local hook
  liveData: LiveInstrumentsState;
  liveDataMap: Map<string, LiveInstrument>;
}

function getTrendArrow(deltaTIR: number | null): { arrow: string; color: string } {
  if (deltaTIR === null) return { arrow: '', color: '#4f5b73' };
  if (deltaTIR > 0.02) return { arrow: '↑', color: '#2eebc8' };
  if (deltaTIR < -0.02) return { arrow: '↓', color: '#f87171' };
  return { arrow: '→', color: '#4f5b73' };
}

function Sparkline({ data, width = 80, height = 28 }: { data: number[]; width?: number; height?: number }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 0.01;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  }).join(' ');
  const lastY = height - ((data[data.length - 1] - min) / range) * (height - 4) - 2;
  const isUp = data[data.length - 1] >= data[0];
  const color = isUp ? '#2eebc8' : '#f87171';
  return (
    <svg width={width} height={height} className="inline-block">
      <polyline fill="none" stroke={color} strokeWidth="1.5" points={points} />
      <circle cx={width} cy={lastY} r="2.5" fill={color} />
    </svg>
  );
}

type SortKey = 'ticker' | 'type' | 'days' | 'price' | 'tem' | 'spread' | 'dm' | 'change' | 'deltaTIR';
type SortDir = 'asc' | 'desc';

type TypeFilter = 'all' | 'LECAP' | 'BONCAP';
type DaysFilter = 'all' | 'lte30' | '31-90' | '91-180' | 'gt180';

export default function MercadoTab({ instruments, config, position, momentumMap, priceHistory, onMepRate, onCclRate, onDolarUpdate, liveData, liveDataMap }: MercadoTabProps) {
  // V2.0.3: Live data comes from page.tsx — instruments are already instruments
  // (merged with live prices). No more local useLiveInstruments hook.
  // The onSyncLiveInstruments callback was moved to a useEffect in page.tsx.

  // V2.0.3: deltaTIR from live data
  const liveDeltaTIRMap = liveData.deltaTIRMap;
  const [sortKey, setSortKey] = useState<SortKey>('days');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [showCompare, setShowCompare] = useState(false);

  // ── Filter State ──
  const [searchText, setSearchText] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [daysFilter, setDaysFilter] = useState<DaysFilter>('all');

  // ── Dólar State ──
  const [dolarRates, setDolarRates] = useState<DolarRate[]>([]);
  const [dolarLoading, setDolarLoading] = useState(true);
  const [dolarLastUpdate, setDolarLastUpdate] = useState<string>('');
  const [dolarError, setDolarError] = useState(false);
  const [priceFlash, setPriceFlash] = useState<Record<string, 'up' | 'down'>>({});
  const prevRatesRef = useRef<DolarRate[]>([]);
  // ── Dollar price history for sparklines (up to 20 snapshots per type) ──
  const dolarHistoryRef = useRef<Record<string, number[]>>({});

  const fetchDolar = useCallback(async (forceFresh = false) => {
    setDolarLoading(true);
    setDolarError(false);
    try {
      // Cache-busting: append _t param to bypass any CDN/proxy cache
      const bust = forceFresh ? `?_t=${Date.now()}` : '';
      const dolarUrl = process.env.NEXT_PUBLIC_STATIC_EXPORT
        ? `https://dolarapi.com/v1/dolares${bust}`
        : `/api/dolar${bust}`;
      const res = await fetch(dolarUrl, {
        signal: AbortSignal.timeout(12000),
        cache: forceFresh ? 'no-store' : 'default',
      });
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const data = await res.json();
      // Validate: must be an array of objects with numeric compra/venta
      if (Array.isArray(data) && data.length > 0 && typeof data[0].venta === 'number') {
        // Detect price changes for flash animation
        if (prevRatesRef.current.length > 0) {
          const flashes: Record<string, 'up' | 'down'> = {};
          for (const newRate of data) {
            const oldRate = prevRatesRef.current.find(r => r.nombre === newRate.nombre);
            if (oldRate && oldRate.venta !== newRate.venta) {
              flashes[newRate.nombre] = newRate.venta > oldRate.venta ? 'up' : 'down';
            }
          }
          if (Object.keys(flashes).length > 0) {
            setPriceFlash(flashes);
            setTimeout(() => setPriceFlash({}), 1200);
          }
        }
        setDolarRates(data);
        prevRatesRef.current = data;
        // Append venta prices to sparkline history (max 20 snapshots)
        const hist = dolarHistoryRef.current;
        for (const rate of data) {
          if (typeof rate.venta === 'number' && isFinite(rate.venta)) {
            const key = rate.nombre;
            if (!hist[key]) hist[key] = [];
            hist[key] = [...hist[key], rate.venta].slice(-20);
          }
        }
        setDolarLastUpdate(new Date().toLocaleTimeString('es-AR'));
        setDolarError(false);
        // Notify parent of MEP rate and dolar update
        const mepData = data.find((r: DolarRate) => r.nombre === 'Bolsa');
        if (mepData && typeof mepData.venta === 'number') {
          onMepRate?.(mepData.venta);
        }
        const cclData = data.find((r: DolarRate) => r.nombre === 'Contado con liquidación') ?? data.find((r: DolarRate) => r.nombre === 'Contadoconliqui');
        if (cclData && typeof cclData.venta === 'number') {
          onCclRate?.(cclData.venta);
        }
        onDolarUpdate?.(new Date().toLocaleTimeString('es-AR'));
      } else {
        throw new Error('Formato inesperado de la API');
      }
    } catch {
      // If we had previous valid data, keep it. Otherwise mark as error.
      if (prevRatesRef.current.length === 0) {
        setDolarError(true);
      }
      // Keep previous rates if available — don't show fake data
    } finally {
      setDolarLoading(false);
    }
  }, [onMepRate, onCclRate, onDolarUpdate]);

  useEffect(() => {
    fetchDolar();
    // Auto-refresh every 5 minutes
    const interval = setInterval(() => fetchDolar(), 300000);
    return () => clearInterval(interval);
  }, [fetchDolar]);

  // Retry: force a clean fetch bypassing cache
  const handleRetry = useCallback(() => {
    setDolarRates([]);
    prevRatesRef.current = [];
    dolarHistoryRef.current = {};
    setDolarError(false);
    fetchDolar(true);
  }, [fetchDolar]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  // ── S/R Data from Price History (MUST be before instrumentsWithExtras) ──
  const srDataMap = useMemo(() => {
    if (!priceHistory) return new Map<string, SRData>();
    const srArray = calculateSR(priceHistory, instruments);
    return new Map(srArray.map(sr => [sr.ticker, sr]));
  }, [priceHistory, instruments]);

  // ── Enriched Instruments ──
  const instrumentsWithExtras = instruments.map(inst => {
    const spread = spreadVsCaucion(inst.tem, config, inst.days);
    const caucionUsed = getCaucionForDays(config, inst.days);
    const caucionLabel = caucionUsed === config.caucion1d ? '1d' : caucionUsed === config.caucion7d ? '7d' : '30d';
    // V1.8.4: Pass S/R position to composite signal for penalty calculation
    const srDataForInst = srDataMap.get(inst.ticker);
    const signal = calculateCompositeSignal(inst, config, instruments, srDataForInst?.posicionEnCanal);
    const momentum = momentumMap.get(inst.ticker);
    // V2.0.2: Use LIVE delta_tir (from API: live price vs last_close) when available,
    // otherwise fall back to momentum-based deltaTIR
    const liveDeltaTIR = liveDeltaTIRMap.get(inst.ticker);
    const deltaTIR = liveDeltaTIR != null ? liveDeltaTIR : (momentum?.deltaTIR ?? null);
    const tirHistory = momentum?.tirHistory ?? [];
    const historyDM = priceHistory ? getLatestDM(priceHistory, inst.ticker) : undefined;
    const dm = historyDM ?? inst.dm ?? durationMod(inst.days, inst.tem);
    const paridad = inst.type === 'LECAP' && inst.price > 0 ? ((1.41 / inst.price) * 100) : 100;
    return { ...inst, spread, caucionLabel, compositeSignal: signal.signal, signalColor: signal.signalColor, signalEmoji: signal.signalEmoji, compositeScore: signal.compositeScore, deltaTIR, tirHistory, dm, paridad };
  });

  const sorted = [...instrumentsWithExtras].sort((a, b) => {
    let aVal: string | number = a[sortKey] ?? 0;
    let bVal: string | number = b[sortKey] ?? 0;
    if (typeof aVal === 'string') aVal = aVal.toLowerCase();
    if (typeof bVal === 'string') bVal = bVal.toLowerCase();
    if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
    if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  const bestInstrument = [...instrumentsWithExtras].sort((a, b) => b.compositeScore - a.compositeScore)[0];

  // ── Filter Logic ──
  const filtered = useMemo(() => {
    return sorted.filter(inst => {
      // Search filter (case-insensitive ticker match)
      if (searchText) {
        const q = searchText.toLowerCase();
        if (!inst.ticker.toLowerCase().includes(q)) return false;
      }
      // Type filter
      if (typeFilter !== 'all' && inst.type !== typeFilter) return false;
      // Days range filter
      if (daysFilter !== 'all') {
        switch (daysFilter) {
          case 'lte30': if (inst.days > 30) return false; break;
          case '31-90': if (inst.days < 31 || inst.days > 90) return false; break;
          case '91-180': if (inst.days < 91 || inst.days > 180) return false; break;
          case 'gt180': if (inst.days <= 180) return false; break;
        }
      }
      return true;
    });
  }, [sorted, searchText, typeFilter, daysFilter]);

  // ── CSV Export ──
  const handleCSVExport = useCallback(() => {
    const headers = ['Ticker', 'Tipo', 'Días', 'Precio', 'TEM', 'ΔTIR', 'Paridad', 'Spread', 'DM', 'Cambio'];
    const rows = filtered.map(inst => [
      inst.ticker,
      inst.type,
      inst.days,
      inst.price.toFixed(4),
      inst.tem.toFixed(2),
      inst.deltaTIR !== null ? inst.deltaTIR.toFixed(3) : '',
      isFinite(inst.paridad) ? inst.paridad.toFixed(1) : '',
      inst.spread.toFixed(3),
      inst.dm != null ? inst.dm.toFixed(4) : '',
      inst.change.toFixed(2),
    ].join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `mercado_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }, [filtered]);

  // ── Dólar lookups — API returns full names with spaces ──
  const oficial = dolarRates.find(r => r.nombre === 'Oficial');
  const mayorista = dolarRates.find(r => r.nombre === 'Mayorista');
  const tarjeta = dolarRates.find(r => r.nombre === 'Tarjeta');
  const blue = dolarRates.find(r => r.nombre === 'Blue');
  const mep = dolarRates.find(r => r.nombre === 'Bolsa');
  // CCL: match both the old key and the actual API key with spaces
  const ccl = dolarRates.find(r => r.nombre === 'Contado con liquidación') ?? dolarRates.find(r => r.nombre === 'Contadoconliqui');
  const cripto = dolarRates.find(r => r.nombre === 'Cripto');

  // V1.5.2: Format variation badge for dollar cards
  const fmtVar = (rate: DolarRate | undefined) => {
    if (!rate?.variacion || !isFinite(rate.variacion)) return null;
    const v = rate.variacion;
    const color = v > 0 ? '#2eebc8' : v < 0 ? '#f87171' : '#4f5b73';
    const arrow = v > 0 ? '▲' : v < 0 ? '▼' : '→';
    return { text: `${arrow} ${v > 0 ? '+' : ''}${v.toFixed(2)}%`, color };
  };

  // Use Mayorista as the "real" official rate for brecha calc if available (closer to wholesale)
  const refOficial = mayorista ?? oficial;
  const brechaBlue = refOficial && blue ? ((blue.venta - refOficial.venta) / refOficial.venta * 100) : 0;
  const brechaMEP = refOficial && mep ? ((mep.venta - refOficial.venta) / refOficial.venta * 100) : 0;
  const brechaCCL = refOficial && ccl ? ((ccl.venta - refOficial.venta) / refOficial.venta * 100) : 0;
  const brechaTarjeta = refOficial && tarjeta ? ((tarjeta.venta - refOficial.venta) / refOficial.venta * 100) : 0;

  const mepAlert = mep && mep.venta > 1550;
  const mepWarning = mep && mep.venta > 1450 && mep.venta <= 1550;

  const riesgoColor = config.riesgoPais > 650 ? '#f87171' : config.riesgoPais > 550 ? '#f472b6' : config.riesgoPais > 450 ? '#fbbf24' : '#2eebc8';
  const caucionTEM1 = caucionTEMFromTNA(config.caucion1d);
  const caucionTEM7 = caucionTEMFromTNA(config.caucion7d);
  const caucionTEM30 = caucionTEMFromTNA(config.caucion30d);

  const yieldCurveData = [...instruments].sort((a, b) => a.days - b.days).map(inst => ({ days: inst.days, tem: inst.tem, type: inst.type, ticker: inst.ticker }));
  const lecapYield = yieldCurveData.filter(d => d.type === 'LECAP');
  const boncapYield = yieldCurveData.filter(d => d.type === 'BONCAP');

  const spreadData = [...instrumentsWithExtras].sort((a, b) => b.spread - a.spread).map(inst => ({ ticker: inst.ticker, spread: parseFloat(inst.spread.toFixed(3)), type: inst.type }));

  const getRowBg = (deltaTIR: number | null, isHeld: boolean): string => {
    if (isHeld) return 'border-l-2 border-l-[#2eebc8]';
    if (deltaTIR === null) return '';
    if (deltaTIR > 0.08) return 'border-l-2 border-l-[#22d3ee]';
    if (deltaTIR < -0.08) return 'border-l-2 border-l-[#fb923c]';
    return '';
  };
  const getRowStyle = (deltaTIR: number | null): React.CSSProperties => {
    if (deltaTIR === null) return {};
    if (deltaTIR > 0.08) return { backgroundColor: 'rgba(34, 211, 238, 0.05)' };
    if (deltaTIR < -0.08) return { backgroundColor: 'rgba(251, 146, 60, 0.05)' };
    return {};
  };

  const renderSortHeader = (label: string, field: SortKey) => (
    <th key={field} className="px-4 py-3 text-left cursor-pointer hover:text-[#2eebc8] transition-colors select-none whitespace-nowrap text-app-text3 font-medium text-[11px] uppercase tracking-wider" onClick={() => handleSort(field)}>
      {label}
      {sortKey === field && <span className="ml-1 text-[#2eebc8]">{sortDir === 'asc' ? '↑' : '↓'}</span>}
    </th>
  );

  const chartGridStroke = 'rgba(128, 128, 128, 0.12)';
  const chartTickFill = 'rgba(220, 220, 220, 0.8)';
  const chartLabelFill = 'rgba(220, 220, 220, 0.8)';
  const tooltipBg = '#111827';  // V1.5.2: Force dark bg
  const tooltipBorder = '#374151';
  const tooltipText = '#FFFFFF';

  return (
    <div className="space-y-5">
      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div>
            <h2 className="text-xl font-light text-app-text mb-0.5">📊 Mercado</h2>
            <p className="text-sm text-app-text4 font-light">
              {liveData.active ? 'Datos en tiempo real vía data912 + ArgentinaDatos' : 'Datos manuales — activá LIVE para precios en vivo'}
            </p>
          </div>
          {/* V2.0.2 — LIVE MODE Toggle — green dot only when active */}
          <button
            onClick={() => liveData.setActive(!liveData.active)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all duration-300 ${
              liveData.active
                ? 'bg-[#2eebc8]/15 border-[#2eebc8]/40 text-[#2eebc8] shadow-[0_0_12px_rgba(46,235,200,0.15)]'
                : 'bg-app-subtle/40 border-app-border/60 text-app-text4 hover:text-app-text3 hover:border-[#2eebc8]/30'
            }`}
            title={liveData.active ? 'Desactivar datos en vivo' : 'Activar datos en vivo (data912 + ArgentinaDatos)'}
          >
            {/* V2.0.2: Green dot ONLY when LIVE is active, no dot when off */}
            {liveData.active && <span className="inline-block w-2 h-2 rounded-full bg-[#2eebc8] animate-pulse" />}
            <span>{liveData.active ? 'LIVE' : 'LIVE OFF'}</span>
            {liveData.active && liveData.lastRefresh && (
              <span className="text-[8px] font-mono text-app-text4 ml-1">
                {liveData.lastRefresh.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            )}
          </button>
          {liveData.active && liveData.loading && (
            <span className="text-[10px] text-[#2eebc8]/70 animate-pulse">Actualizando…</span>
          )}
          {liveData.active && liveData.error && (
            <span className="text-[10px] text-[#f87171]">⚠ {liveData.error}</span>
          )}
        </div>
        {bestInstrument && (
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowCompare(!showCompare)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all duration-200 ${showCompare ? 'bg-[#2eebc8]/15 border-[#2eebc8]/40 text-[#2eebc8]' : 'bg-app-subtle/40 border-app-border/60 text-app-text3 hover:text-app-text2 hover:border-app-accent/30'}`}
              title="Comparar instrumentos lado a lado"
            >
              <span>⚖️</span>
              <span>Comparar</span>
            </button>
            <div className="flex items-center gap-2 glass-card-accent px-4 py-2.5">
              <span className="text-app-gold text-sm">★</span>
              <span className="text-[10px] text-app-text3 uppercase tracking-wider">Mejor</span>
              <span className="font-mono font-medium text-[#2eebc8]">{bestInstrument.ticker}</span>
              <span className="text-xs text-app-text4 font-mono">{bestInstrument.tem.toFixed(2)}% TIR</span>
            </div>
          </div>
        )}
      </div>

      {/* ── V2.0.1: Live Data Info Banner ── */}
      {liveData.active && liveData.caucionProxy && (
        <div className="bg-[#2eebc8]/5 border border-[#2eebc8]/15 rounded-xl p-3 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <span className="text-[#2eebc8] text-sm">📡</span>
            <div>
              <div className="text-[10px] text-[#2eebc8] font-medium uppercase tracking-wider">Datos en Vivo — data912 + ArgentinaDatos</div>
              <div className="text-[9px] text-app-text4">
                {liveData.liveInstruments.length} instrumentos mergeados
                {liveData.stats && (
                  <> · <span className="text-[#2eebc8]/80">{liveData.stats.lecaps}L</span> + <span className="text-[#f472b6]/80">{liveData.stats.boncaps}B</span></>
                )}
                {' '}· Caución proxy: TNA {(liveData.caucionProxy.tna_promedio * 100).toFixed(1)}% → TEM {(liveData.caucionProxy.tem_caucion * 100).toFixed(2)}%
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {liveData.sources && (
              <div className="flex items-center gap-1.5 text-[8px] font-mono flex-wrap">
                <span className={liveData.sources.data912_notes?.ok ? 'text-[#2eebc8]' : 'text-[#f87171]'}>
                  Notes {liveData.sources.data912_notes?.ok ? '✓' : '✗'}
                </span>
                <span className="text-app-text4">·</span>
                <span className={liveData.sources.data912_bonds?.ok ? 'text-[#2eebc8]' : 'text-[#f87171]'}>
                  Bonds {liveData.sources.data912_bonds?.ok ? '✓' : '✗'}
                  {liveData.sources.data912_bonds?.boncaps_matched != null && <span className="text-app-text4"> ({liveData.sources.data912_bonds.boncaps_matched}B)</span>}
                </span>
                <span className="text-app-text4">·</span>
                <span className={liveData.sources.argentinadatos?.ok ? 'text-[#2eebc8]' : 'text-[#f87171]'}>
                  ArgDatos {liveData.sources.argentinadatos?.ok ? '✓' : '✗'}
                </span>
              </div>
            )}
            <button
              onClick={liveData.refresh}
              disabled={liveData.loading}
              className="px-2 py-1 bg-[#2eebc8]/10 border border-[#2eebc8]/20 rounded-md text-[9px] text-[#2eebc8] hover:bg-[#2eebc8]/20 transition-colors disabled:opacity-50"
              title="Refrescar ahora"
            >
              🔄 {liveData.loading ? '…' : 'Ahora'}
            </button>
          </div>
        </div>
      )}

      {/* ── V2.0.2: Stale Data Warning when LIVE is OFF ── */}
      {!liveData.active && (
        <div className="bg-app-subtle/30 border border-app-border/40 rounded-xl p-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-app-text4 text-sm">⏸</span>
            <div>
              <div className="text-[10px] text-app-text4 font-medium uppercase tracking-wider">Datos Manuales</div>
              <div className="text-[9px] text-app-text4">
                Precios y tasas son estáticos. Activá LIVE para datos en tiempo real.
              </div>
            </div>
          </div>
          <button
            onClick={() => liveData.setActive(true)}
            className="px-2.5 py-1.5 bg-[#2eebc8]/10 border border-[#2eebc8]/20 rounded-md text-[9px] text-[#2eebc8] hover:bg-[#2eebc8]/20 transition-colors font-medium"
            title="Activar datos en vivo"
          >
            📡 Activar LIVE
          </button>
        </div>
      )}

      {/* ── Compare Mode ── */}
      {showCompare ? (
        <InstrumentCompare instruments={instruments} config={config} momentumMap={momentumMap} priceHistory={priceHistory} />
      ) : (
      <>
      {/* ── Dólar Panel (compact 5-card) ── */}
      <div className="bg-app-card rounded-xl border border-app-border border-app-accent/10 p-3.5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-sm">💱</span>
            <h3 className="text-xs font-medium text-app-text2">Dólares</h3>
            {dolarLastUpdate && !dolarError && (
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#2eebc8] animate-pulse" title="Datos en vivo" />
            )}
            {dolarError && <span className="text-[8px] text-[#f87171] font-mono">sin conexión</span>}
          </div>
          <div className="flex items-center gap-2">
            {dolarLastUpdate && <span className="text-[8px] text-app-text4 font-mono">{dolarLastUpdate}</span>}
            <button onClick={handleRetry} className="px-1.5 py-1 bg-app-subtle text-app-text3 text-[10px] rounded-md hover:bg-app-hover transition-colors" title="Forzar re-fetch limpio">🔄</button>
          </div>
        </div>

        {mepAlert && (
          <div className="bg-app-danger-dim border border-[#f87171]/20 rounded-lg p-2.5 mb-3">
            <div className="flex items-center gap-2">
              <span className="text-[#f87171] text-xs">🚨</span>
              <div>
                <div className="text-[#f87171] font-medium text-[10px]">ALERTA CAMBIARIA</div>
                <div className="text-app-text3 text-[9px]">Dólar MEP a ${mep?.venta.toFixed(0)} supera umbral de $1,550.</div>
              </div>
            </div>
          </div>
        )}
        {mepWarning && !mepAlert && (
          <div className="bg-[#fbbf24]/8 border border-[#fbbf24]/20 rounded-lg p-2.5 mb-3">
            <div className="flex items-center gap-2">
              <span className="text-app-gold text-xs">⚠️</span>
              <div>
                <div className="text-app-gold font-medium text-[10px]">PRECAUCIÓN CAMBIARIA</div>
                <div className="text-app-text3 text-[9px]">MEP acercándose a zona de alerta.</div>
              </div>
            </div>
          </div>
        )}

        {dolarLoading ? (
          <div className="text-app-text4 text-xs py-2 animate-pulse">Cargando cotizaciones...</div>
        ) : dolarError && dolarRates.length === 0 ? (
          <div className="bg-[#f87171]/5 border border-[#f87171]/15 rounded-lg p-3">
            <div className="text-[10px] text-[#f87171] font-medium mb-1">No se pudieron obtener las cotizaciones</div>
            <div className="text-[9px] text-app-text3">Verificá la conexión y hacé clic en 🔄 para reintentar.</div>
          </div>
        ) : dolarRates.length === 0 ? (
          <div className="text-app-text4 text-xs py-2">Sin datos de cotizaciones</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            {/* ── Oficial ── */}
            <div className={`rounded-lg p-2.5 border border-app-border/50 bg-app-subtle/30 hover:scale-[1.02] hover:shadow-lg transition-all duration-200 ${priceFlash['Oficial'] === 'up' ? 'price-flash-up' : priceFlash['Oficial'] === 'down' ? 'price-flash-down' : ''}`}>
              <div className="text-[8px] font-medium text-app-text4 uppercase tracking-wider mb-1">Oficial</div>
              <div className="flex items-baseline gap-1.5 overflow-hidden">
                <span className="text-base font-mono font-semibold text-[#22d3ee] truncate">${oficial?.venta.toLocaleString('es-AR', { maximumFractionDigits: 0 }) ?? '—'}</span>
                {fmtVar(oficial) && <span className="text-[8px] font-mono font-medium" style={{ color: fmtVar(oficial)!.color }}>{fmtVar(oficial)!.text}</span>}
              </div>
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                <span className="text-[7px] text-app-text4">C:</span>
                <span className="text-[9px] font-mono text-app-text3">{oficial?.compra.toLocaleString('es-AR', { maximumFractionDigits: 0 }) ?? '—'}</span>
                <span className="text-[7px] text-app-text4">V:</span>
                <span className="text-[9px] font-mono text-app-text3">{oficial?.venta.toLocaleString('es-AR', { maximumFractionDigits: 0 }) ?? '—'}</span>
              </div>
              {dolarHistoryRef.current['Oficial'] && dolarHistoryRef.current['Oficial'].length >= 2 && (
                <div className="mt-1"><Sparkline data={dolarHistoryRef.current['Oficial']} width={60} height={20} /></div>
              )}
            </div>
            {/* ── Tarjeta ── */}
            <div className="rounded-lg p-2.5 border border-app-border/50 bg-app-subtle/30 hover:scale-[1.02] hover:shadow-lg transition-all duration-200">
              <div className="text-[8px] font-medium text-app-text4 uppercase tracking-wider mb-1">Tarjeta</div>
              <div className="flex items-baseline gap-1.5 overflow-hidden">
                <span className="text-base font-mono font-semibold text-[#a78bfa] truncate">${tarjeta?.venta.toLocaleString('es-AR', { maximumFractionDigits: 0 }) ?? '—'}</span>
                {fmtVar(tarjeta) && <span className="text-[8px] font-mono font-medium" style={{ color: fmtVar(tarjeta)!.color }}>{fmtVar(tarjeta)!.text}</span>}
              </div>
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                <span className="text-[7px] text-app-text4">C:</span>
                <span className="text-[9px] font-mono text-app-text3">{tarjeta?.compra.toLocaleString('es-AR', { maximumFractionDigits: 0 }) ?? '—'}</span>
                <span className="text-[7px] text-app-text4">V:</span>
                <span className="text-[9px] font-mono text-app-text3">{tarjeta?.venta.toLocaleString('es-AR', { maximumFractionDigits: 0 }) ?? '—'}</span>
              </div>
              {brechaTarjeta > 0 && <div className="text-[7px] text-app-text4 font-mono mt-0.5 flex items-center gap-1"><span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: brechaTarjeta < 10 ? '#2eebc8' : brechaTarjeta < 20 ? '#fbbf24' : '#f87171' }} />+{brechaTarjeta.toFixed(0)}%</div>}
              {dolarHistoryRef.current['Tarjeta'] && dolarHistoryRef.current['Tarjeta'].length >= 2 && (
                <div className="mt-1"><Sparkline data={dolarHistoryRef.current['Tarjeta']} width={60} height={20} /></div>
              )}
            </div>
            {/* ── MEP (Bolsa) ── */}
            <div className={`rounded-lg p-2.5 border transition-all duration-200 hover:scale-[1.02] hover:shadow-lg bg-gradient-to-br from-[#2eebc8]/5 to-transparent ${mepAlert ? 'border-[#f87171]/30' : 'border-app-accent-border/40'}`}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[8px] font-medium text-app-text3 uppercase tracking-wider">MEP</span>
                <span className="px-1 py-0.5 rounded text-[6px] font-bold bg-app-accent-dim text-[#2eebc8] uppercase">Ref</span>
              </div>
              <div className="flex items-baseline gap-1.5 overflow-hidden">
                <span className="text-base font-mono font-semibold text-[#2eebc8] truncate">${mep?.venta.toLocaleString('es-AR', { maximumFractionDigits: 0 }) ?? '—'}</span>
                {fmtVar(mep) && <span className="text-[8px] font-mono font-medium" style={{ color: fmtVar(mep)!.color }}>{fmtVar(mep)!.text}</span>}
              </div>
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                <span className="text-[7px] text-app-text4">C:</span>
                <span className="text-[9px] font-mono text-app-text3">{mep?.compra.toLocaleString('es-AR', { maximumFractionDigits: 0 }) ?? '—'}</span>
                <span className="text-[7px] text-app-text4">V:</span>
                <span className="text-[9px] font-mono text-app-text3">{mep?.venta.toLocaleString('es-AR', { maximumFractionDigits: 0 }) ?? '—'}</span>
              </div>
              {brechaMEP > 0 && <div className="text-[7px] text-app-text4 font-mono mt-0.5 flex items-center gap-1"><span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: brechaMEP < 10 ? '#2eebc8' : brechaMEP < 20 ? '#fbbf24' : '#f87171' }} />+{brechaMEP.toFixed(0)}%</div>}
              {dolarHistoryRef.current['Bolsa'] && dolarHistoryRef.current['Bolsa'].length >= 2 && (
                <div className="mt-1"><Sparkline data={dolarHistoryRef.current['Bolsa']} width={60} height={20} /></div>
              )}
            </div>
            {/* ── CCL ── */}
            <div className="rounded-lg p-2.5 border border-app-border/50 bg-app-subtle/30 hover:scale-[1.02] hover:shadow-lg transition-all duration-200">
              <div className="text-[8px] font-medium text-app-text4 uppercase tracking-wider mb-1">CCL</div>
              <div className="flex items-baseline gap-1.5 overflow-hidden">
                <span className="text-base font-mono font-semibold text-[#fbbf24] truncate">${ccl?.venta.toLocaleString('es-AR', { maximumFractionDigits: 0 }) ?? '—'}</span>
                {fmtVar(ccl) && <span className="text-[8px] font-mono font-medium" style={{ color: fmtVar(ccl)!.color }}>{fmtVar(ccl)!.text}</span>}
              </div>
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                <span className="text-[7px] text-app-text4">C:</span>
                <span className="text-[9px] font-mono text-app-text3">{ccl?.compra.toLocaleString('es-AR', { maximumFractionDigits: 0 }) ?? '—'}</span>
                <span className="text-[7px] text-app-text4">V:</span>
                <span className="text-[9px] font-mono text-app-text3">{ccl?.venta.toLocaleString('es-AR', { maximumFractionDigits: 0 }) ?? '—'}</span>
              </div>
              {brechaCCL > 0 && <div className="text-[7px] text-app-text4 font-mono mt-0.5 flex items-center gap-1"><span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: brechaCCL < 10 ? '#2eebc8' : brechaCCL < 20 ? '#fbbf24' : '#f87171' }} />+{brechaCCL.toFixed(0)}%</div>}
              {dolarHistoryRef.current['Contado con liquidación'] && dolarHistoryRef.current['Contado con liquidación'].length >= 2 && (
                <div className="mt-1"><Sparkline data={dolarHistoryRef.current['Contado con liquidación']} width={60} height={20} /></div>
              )}
            </div>
            {/* ── Blue ── */}
            <div className="rounded-lg p-2.5 border border-app-border/50 bg-app-subtle/30 hover:scale-[1.02] hover:shadow-lg transition-all duration-200">
              <div className="text-[8px] font-medium text-app-text4 uppercase tracking-wider mb-1">Blue</div>
              <div className="flex items-baseline gap-1.5 overflow-hidden">
                <span className="text-base font-mono font-semibold text-[#f472b6] truncate">${blue?.venta.toLocaleString('es-AR', { maximumFractionDigits: 0 }) ?? '—'}</span>
                {fmtVar(blue) && <span className="text-[8px] font-mono font-medium" style={{ color: fmtVar(blue)!.color }}>{fmtVar(blue)!.text}</span>}
              </div>
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                <span className="text-[7px] text-app-text4">C:</span>
                <span className="text-[9px] font-mono text-app-text3">{blue?.compra.toLocaleString('es-AR', { maximumFractionDigits: 0 }) ?? '—'}</span>
                <span className="text-[7px] text-app-text4">V:</span>
                <span className="text-[9px] font-mono text-app-text3">{blue?.venta.toLocaleString('es-AR', { maximumFractionDigits: 0 }) ?? '—'}</span>
              </div>
              {brechaBlue > 0 && <div className="text-[7px] text-app-text4 font-mono mt-0.5 flex items-center gap-1"><span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: brechaBlue < 10 ? '#2eebc8' : brechaBlue < 20 ? '#fbbf24' : '#f87171' }} />+{brechaBlue.toFixed(0)}%</div>}
              {dolarHistoryRef.current['Blue'] && dolarHistoryRef.current['Blue'].length >= 2 && (
                <div className="mt-1"><Sparkline data={dolarHistoryRef.current['Blue']} width={60} height={20} /></div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Legend ── */}
      <div className="flex items-center gap-5 text-[9px] text-app-text4">
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-3 rounded border border-[#22d3ee]/30" style={{ backgroundColor: 'rgba(34,211,238,0.05)' }} />
          <span>ΔTIR &gt; +0.08%</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-3 rounded border border-[#fb923c]/30" style={{ backgroundColor: 'rgba(251,146,60,0.05)' }} />
          <span>ΔTIR &lt; −0.08%</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-3 rounded bg-[#f87171]/15 border border-[#f87171]/25" />
          <span>TEM ≤ 1.6% (zona roja)</span>
        </div>
      </div>

      {/* ── Key Metrics Bar ── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="bg-app-card rounded-xl border border-app-border p-4 text-center border-b-2 border-b-app-accent/20">
          <div className="text-[9px] text-app-text4 mb-1.5 uppercase tracking-wider">Riesgo País</div>
          <div className="text-lg font-mono font-medium" style={{ color: riesgoColor }}>{config.riesgoPais} pb</div>
        </div>
        <div className="bg-app-card rounded-xl border border-app-border p-4 text-center border-b-2 border-b-app-accent/20">
          <div className="text-[9px] text-app-text4 mb-1.5 uppercase tracking-wider">Caución 1D</div>
          <div className="text-lg font-mono font-medium text-app-gold">{config.caucion1d.toFixed(1)}%</div>
          <div className="text-[9px] text-app-text4 font-mono">TEM: {caucionTEM1.toFixed(2)}%</div>
        </div>
        <div className="bg-app-card rounded-xl border border-app-border p-4 text-center border-b-2 border-b-app-accent/20">
          <div className="text-[9px] text-app-text4 mb-1.5 uppercase tracking-wider">Caución 7D</div>
          <div className="text-lg font-mono font-medium text-app-gold">{config.caucion7d.toFixed(1)}%</div>
          <div className="text-[9px] text-app-text4 font-mono">TEM: {caucionTEM7.toFixed(2)}%</div>
        </div>
        <div className="bg-app-card rounded-xl border border-app-border p-4 text-center border-b-2 border-b-app-accent/20">
          <div className="text-[9px] text-app-text4 mb-1.5 uppercase tracking-wider">Caución 30D</div>
          <div className="text-lg font-mono font-medium text-app-gold">{config.caucion30d.toFixed(1)}%</div>
          <div className="text-[9px] text-app-text4 font-mono">TEM: {caucionTEM30.toFixed(2)}%</div>
        </div>
        <div className="bg-app-card rounded-xl border border-app-border p-4 text-center border-b-2 border-b-app-accent/20">
          <div className="text-[9px] text-app-text4 mb-1.5 uppercase tracking-wider">Comisión RT</div>
          <div className="text-lg font-mono font-medium text-app-pink">{config.comisionTotal.toFixed(2)}%</div>
          <div className="text-[9px] text-app-text4 font-mono">{(config.comisionTotal / 2).toFixed(2)}% × 2</div>
        </div>
      </div>

      {/* ── Filter Bar ── */}
      <div className="border-t border-app-border/40 pt-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          {/* Search input */}
          <div className="relative flex-1 w-full sm:max-w-xs">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-app-text4 text-sm">🔍</span>
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Buscar ticker..."
              className="w-full bg-app-subtle/40 border border-app-border/60 rounded-lg pl-9 pr-3 py-2 text-sm text-app-text2 placeholder:text-app-text4 focus:border-[#2eebc8]/50 focus:outline-none transition-colors"
            />
            {searchText && (
              <button
                onClick={() => setSearchText('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-app-text4 hover:text-app-text2 transition-colors text-xs"
                aria-label="Limpiar búsqueda"
              >✕</button>
            )}
          </div>

          {/* Type filter chips */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {(['all', 'LECAP', 'BONCAP'] as TypeFilter[]).map((tf) => (
              <button
                key={tf}
                onClick={() => setTypeFilter(tf)}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-medium transition-all duration-150 ${
                  typeFilter === tf
                    ? 'bg-[#2eebc8] text-[#0c1220] font-semibold btn-ripple'
                    : 'bg-app-subtle/40 text-app-text3 border border-app-border/60 hover:bg-app-hover'
                }`}
              >
                {tf === 'all' ? 'Todos' : tf}
              </button>
            ))}
          </div>

          {/* Days range filter chips */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {([
              { key: 'all' as DaysFilter, label: 'Todos' },
              { key: 'lte30' as DaysFilter, label: '≤30d' },
              { key: '31-90' as DaysFilter, label: '31-90d' },
              { key: '91-180' as DaysFilter, label: '91-180d' },
              { key: 'gt180' as DaysFilter, label: '180d+' },
            ]).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setDaysFilter(key)}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-medium transition-all duration-150 ${
                  daysFilter === key
                    ? 'bg-[#2eebc8] text-[#0c1220] font-semibold btn-ripple'
                    : 'bg-app-subtle/40 text-app-text3 border border-app-border/60 hover:bg-app-hover'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* CSV Export */}
          <button
            onClick={handleCSVExport}
            disabled={filtered.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-app-subtle/40 border border-app-border/60 rounded-lg text-[10px] font-medium text-app-text3 hover:bg-app-hover hover:text-app-text2 transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Exportar CSV"
          >
            <span className="text-sm">⬇</span>
            CSV
          </button>
        </div>

        {/* Count indicator */}
        <div className="mt-2 text-[10px] text-app-text4 font-mono">
          Mostrando {filtered.length} de {sorted.length} instrumentos
          {(searchText || typeFilter !== 'all' || daysFilter !== 'all') && (
            <button
              onClick={() => { setSearchText(''); setTypeFilter('all'); setDaysFilter('all'); }}
              className="ml-2 text-[#2eebc8]/70 hover:text-[#2eebc8] transition-colors"
            >
              Limpiar filtros
            </button>
          )}
        </div>
      </div>

      {/* ── Instruments Table (V1.5: now includes DELTA TIR column) ── */}
      <div className="bg-app-card rounded-xl border border-app-border overflow-hidden relative">
        <div className="overflow-x-auto max-h-[520px] overflow-y-auto custom-scrollbar">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-app-card z-10 border-b border-app-border">
              <tr>
                {renderSortHeader("Ticker", "ticker")}
                {renderSortHeader("Tipo", "type")}
                {renderSortHeader("Días", "days")}
                {renderSortHeader("Precio", "price")}
                {renderSortHeader("TEM %", "tem")}
                {/* V1.5: DELTA TIR column */}
                {renderSortHeader("Δ TIR", "deltaTIR")}
                <th className="px-4 py-3 text-left whitespace-nowrap text-app-text3 font-medium text-[11px] uppercase tracking-wider">Paridad %</th>
                {renderSortHeader("Spread Cau.", "spread")}
                {renderSortHeader("DM", "dm")}
                {renderSortHeader("Cambio %", "change")}
                <th className="px-4 py-3 text-left whitespace-nowrap text-app-text3 font-medium text-[11px] uppercase tracking-wider">S/R</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-8 text-center">
                    <div className="text-app-text4 text-sm">Sin resultados</div>
                    <div className="text-app-text4 text-[10px] mt-1">No hay instrumentos que coincidan con los filtros seleccionados</div>
                    <button
                      onClick={() => { setSearchText(''); setTypeFilter('all'); setDaysFilter('all'); }}
                      className="mt-2 text-[#2eebc8]/70 hover:text-[#2eebc8] text-[10px] transition-colors"
                    >
                      Limpiar filtros
                    </button>
                  </td>
                </tr>
              ) : filtered.map((inst) => {
                const isHeld = position?.ticker === inst.ticker;
                const arrowInfo = getTrendArrow(inst.deltaTIR);
                const temLow = inst.tem <= 1.6;
                return (
                  <tr
                    key={inst.ticker}
                    className={`border-b border-app-border/60 hover:bg-app-subtle/50 transition-colors ${getRowBg(inst.deltaTIR, isHeld)}`}
                    style={getRowStyle(inst.deltaTIR)}
                  >
                    <td
                      className="px-4 py-3 font-mono font-medium text-app-text cursor-pointer hover:text-[#2eebc8] transition-colors"
                      onClick={() => setSelectedTicker(inst.ticker)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedTicker(inst.ticker); } }}
                    >
                      <div className="flex items-center gap-1.5">
                        {inst.ticker}
                        {isHeld && <span className="text-[#2eebc8] text-[8px]">● EN CARTERA</span>}
                        {/* V2.0.1: DATA OFFLINE indicator when LIVE mode is active but ticker not in API */}
                        {liveData.active && !liveData.isTickerLive(inst.ticker) && (
                          <span className="px-1 py-0.5 rounded text-[7px] font-bold bg-[#f87171]/15 text-[#f87171] border border-[#f87171]/25 uppercase tracking-wider animate-pulse">
                            DATA OFFLINE
                          </span>
                        )}
                        {/* V2.0.1: Show live indicator dot when LIVE and ticker IS in API */}
                        {liveData.active && liveData.isTickerLive(inst.ticker) && (
                          <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#2eebc8]" title="Precio en vivo" />
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-md text-[10px] font-medium ${inst.type === 'LECAP' ? 'bg-app-accent-dim text-[#2eebc8]' : 'bg-[#f472b6]/10 text-[#f472b6]'}`}>
                        {inst.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-app-text2">{inst.days}</td>
                    {/* V2.0.5: Price cell — reduced opacity when LIVE is off (stale data warning) */}
                    <td className={`px-4 py-3 font-mono ${liveData.active ? 'text-app-text' : 'text-app-text4 opacity-60'}`}>
                      {inst.price.toFixed(4)}
                      {!liveData.active && (
                        <span className="text-[7px] text-app-text4 ml-1 uppercase tracking-wider">cierre ant.</span>
                      )}
                      {liveData.active && liveData.isTickerLive(inst.ticker) && (
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#2eebc8] ml-1 animate-pulse" title="Precio en vivo" />
                      )}
                    </td>
                    {/* TEM cell — also dimmed when LIVE is off */}
                    <td className={`px-4 py-3 ${temLow ? 'bg-[#f87171]/12' : ''}`}>
                      <div className="group relative">
                        <span className={`font-mono font-medium ${temLow ? 'text-[#f87171]' : liveData.active ? 'text-app-text' : 'text-app-text4 opacity-60'}`}>
                          {inst.tem.toFixed(2)}%
                          {temLow && <span className="ml-1 text-[8px]">⚠</span>}
                        </span>
                        {inst.tirHistory.length >= 2 && (
                          <div className="absolute left-0 bottom-full mb-2 hidden group-hover:block z-50 bg-app-card border border-app-border rounded-xl p-4 shadow-2xl min-w-[220px]">
                            <div className="text-[9px] text-app-text4 mb-2 font-mono">Evolución TIR ({inst.tirHistory.length} snapshots)</div>
                            <div className="flex items-center justify-center mb-2"><Sparkline data={inst.tirHistory} width={120} height={40} /></div>
                            <div className="text-[9px] text-app-text3 font-mono">
                              {inst.tirHistory.map((t, i) => (<span key={i}>{t.toFixed(2)}%{i < inst.tirHistory.length - 1 ? ' → ' : ''}</span>))}
                            </div>
                          </div>
                        )}
                      </div>
                    </td>
                    {/* V2.0.2: DELTA TIR column — enhanced with live vs last_close */}
                    <td className="px-4 py-3">
                      {inst.deltaTIR !== null ? (
                        <div className="flex items-center gap-1">
                          <span className={`font-mono font-medium text-[11px] ${inst.deltaTIR > 0.02 ? 'text-[#2eebc8]' : inst.deltaTIR < -0.02 ? 'text-[#f87171]' : 'text-app-text4'}`}>
                            {inst.deltaTIR >= 0 ? '+' : ''}{inst.deltaTIR.toFixed(3)}%
                          </span>
                          {arrowInfo.arrow && <span style={{ color: arrowInfo.color }} className="text-[10px]">{arrowInfo.arrow}</span>}
                          {/* V2.0.2: Show "vs cierre" badge when delta comes from live data */}
                          {liveData.active && liveDeltaTIRMap.has(inst.ticker) && (
                            <span className="text-[6px] px-1 py-0.5 rounded bg-[#2eebc8]/10 text-[#2eebc8]/70 font-mono uppercase tracking-wider">vs cierre</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-app-text4 text-[10px]">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-app-text2">{isFinite(inst.paridad) ? inst.paridad.toFixed(1) : '—'}%</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className={`font-mono font-medium ${inst.spread > 0 ? 'text-[#2eebc8]' : inst.spread > -0.1 ? 'text-app-gold' : 'text-[#f87171]'}`}>
                          {inst.spread >= 0 ? '+' : ''}{inst.spread.toFixed(3)}%
                        </span>
                        <span className="text-[8px] text-app-text4">vs {inst.caucionLabel}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-app-text2">{inst.dm != null ? inst.dm.toFixed(4) : '—'}</td>
                    <td className={`px-4 py-3 font-mono font-medium ${inst.change >= 0 ? 'text-[#2eebc8]' : 'text-[#f87171]'}`}>
                      {inst.change >= 0 ? '+' : ''}{inst.change.toFixed(2)}%
                    </td>
                    <td className="px-4 py-3">
                      {(() => {
                        const sr = srDataMap.get(inst.ticker);
                        if (!sr || !isFinite(sr.soporte) || !isFinite(sr.resistencia)) return <span className="text-app-text4 text-[10px]">—</span>;
                        // V1.8.4: Color the % badge based on position in channel
                        const pct = sr.posicionEnCanal;
                        const pctColor = pct >= 90 ? '#f87171' : pct >= 70 ? '#fbbf24' : '#2eebc8';
                        return (
                          <div className="flex flex-col gap-0.5">
                            <div className="flex items-center gap-1">
                              <span className="text-[8px] text-[#2eebc8]">S</span>
                              <span className="text-[9px] font-mono text-[#2eebc8]/70">{sr.soporte.toFixed(4)}</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <span className="text-[8px] text-[#f87171]">R</span>
                              <span className="text-[9px] font-mono text-[#f87171]/70">{sr.resistencia.toFixed(4)}</span>
                            </div>
                            {/* V1.8.4: % badge showing channel position */}
                            <div className="mt-0.5">
                              <span
                                className="text-[8px] font-mono font-bold px-1 py-0.5 rounded"
                                style={{ backgroundColor: `${pctColor}15`, color: pctColor }}
                              >
                                {pct.toFixed(0)}%
                              </span>
                            </div>
                          </div>
                        );
                      })()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {/* Gradient scroll hint on mobile */}
        <div className="absolute right-0 top-0 bottom-0 w-4 bg-gradient-to-l from-app-card/80 to-transparent pointer-events-none md:hidden" />
      </div>

      {/* ── Instrument Detail Slide-over ── */}
      {selectedTicker && (() => {
        const selectedInstrument = instruments.find(i => i.ticker === selectedTicker);
        const selectedSR = srDataMap.get(selectedTicker);
        const selectedMomentum = momentumMap.get(selectedTicker);
        if (!selectedInstrument) return null;
        return (
          <InstrumentDetail
            instrument={selectedInstrument}
            config={config}
            position={position}
            momentum={selectedMomentum}
            srData={selectedSR}
            onClose={() => setSelectedTicker(null)}
            onRotate={(ticker: string) => {
              // No-op for now — just show the button
              console.log(`Rotate to ${ticker}`);
            }}
          />
        );
      })()}

      {/* ── Charts Row ── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="bg-app-card rounded-xl border border-app-border p-5">
          <h3 className="text-sm font-medium text-app-text2 mb-4">Curva de Tasas (TEM vs Días)</h3>
          <ChartContainer className="h-72">
            {({ width, height }) => (
              <LineChart width={width} height={height} margin={{ top: 5, right: 20, left: 10, bottom: 5 }} key={`yc-${width}-${height}`}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} />
                <XAxis dataKey="days" type="number" domain={[0, 'dataMax']} tick={{ fill: chartTickFill, fontSize: 11 }} label={{ value: 'Días', position: 'insideBottomRight', offset: -5, fill: chartLabelFill, fontSize: 11 }} />
                <YAxis domain={['dataMin - 0.1', 'dataMax + 0.1']} tick={{ fill: chartTickFill, fontSize: 11 }} label={{ value: 'TEM %', angle: -90, position: 'insideLeft', fill: chartLabelFill, fontSize: 11 }} />
                <Tooltip contentStyle={{ backgroundColor: tooltipBg, border: `1px solid ${tooltipBorder}`, borderRadius: '12px', fontSize: 12, color: tooltipText }} labelStyle={{ color: '#9CA3AF' }} itemStyle={{ color: tooltipText }} formatter={((value: number, name: string) => [`${Number(value).toFixed(2)}%`, name]) as never} labelFormatter={(label: number) => `${label} días`} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line data={lecapYield} dataKey="tem" name="LECAPs" stroke="#2eebc8" strokeWidth={2} dot={{ fill: '#2eebc8', r: 4 }} />
                <Line data={boncapYield} dataKey="tem" name="BONCAPs" stroke="#f472b6" strokeWidth={2} dot={{ fill: '#f472b6', r: 4 }} />
                <ReferenceLine y={caucionTEM1} stroke="#fbbf24" strokeDasharray="5 5" strokeWidth={1} label={{ value: `Cauc 1d ${caucionTEM1.toFixed(2)}%`, fill: '#fbbf24', fontSize: 10 }} />
                <ReferenceLine y={caucionTEM30} stroke="#fbbf24" strokeDasharray="3 3" strokeWidth={1} label={{ value: `Cauc 30d ${caucionTEM30.toFixed(2)}%`, fill: '#fbbf24', fontSize: 10 }} />
                <ReferenceLine y={1.6} stroke="#f87171" strokeDasharray="4 4" strokeWidth={1} label={{ value: 'TEM 1.6%', fill: '#f87171', fontSize: 10 }} />
              </LineChart>
            )}
          </ChartContainer>
        </div>
        <div className="bg-app-card rounded-xl border border-app-border p-5">
          <h3 className="text-sm font-medium text-app-text2 mb-4">Spread vs Caución por Instrumento</h3>
          <ChartContainer className="h-72">
            {({ width, height }) => (
              <BarChart width={width} height={height} data={spreadData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }} key={`sp-${width}-${height}`}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} />
                <XAxis dataKey="ticker" tick={{ fill: chartTickFill, fontSize: 10 }} angle={-45} textAnchor="end" height={60} />
                <YAxis tick={{ fill: chartTickFill, fontSize: 11 }} label={{ value: 'Spread %', angle: -90, position: 'insideLeft', fill: chartLabelFill, fontSize: 11 }} />
                <Tooltip contentStyle={{ backgroundColor: tooltipBg, border: `1px solid ${tooltipBorder}`, borderRadius: '12px', fontSize: 12, color: tooltipText }} itemStyle={{ color: tooltipText }} labelStyle={{ color: '#9CA3AF' }} formatter={((value: number) => [`${Number(value).toFixed(3)}%`, 'Spread']) as never} />
                <ReferenceLine y={0} stroke="rgba(148,163,184,0.15)" />
                <Bar dataKey="spread" radius={[4, 4, 0, 0]}>
                  {spreadData.map((entry, index) => {
                    const signal = getSpreadSignal(entry.spread);
                    return <Cell key={index} fill={signal.color} fillOpacity={0.75} />;
                  })}
                </Bar>
              </BarChart>
            )}
          </ChartContainer>
        </div>
      </div>
    </>
    )}
    </div>
  );
}
