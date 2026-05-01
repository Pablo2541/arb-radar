// ════════════════════════════════════════════════════════════════════════
// V3.2 — Histórico Tab
//
// Displays accumulated historical LECAP/BONCAP price data with
// interactive charts and CSV/XLSX export functionality.
//
// DATA SOURCE: Our OWN accumulated PriceSnapshot/DailyOHLC records,
// built by capturing data912 + ArgentinaDatos prices periodically.
// ════════════════════════════════════════════════════════════════════════

'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, BarChart, Bar, AreaChart, Area,
} from 'recharts';
import type { LiveInstrument } from '@/lib/types';

interface HistoricoTabProps {
  instruments: Array<{ ticker: string; type: 'LECAP' | 'BONCAP'; price: number; tem: number; days: number }>;
  liveDataMap: Map<string, LiveInstrument>;
  isLive: boolean;
}

interface OHLCData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  avgTem: number | null;
  avgTir: number | null;
  vpv: number | null;
  snapshotCount: number;
}

interface TickerSummary {
  ticker: string;
  days_available: number;
  first_date: string;
  last_date: string;
  latest_close: number | null;
  latest_vpv: number | null;
  latest_tem: number | null;
}

type ChartMetric = 'price' | 'tem' | 'volume' | 'vpv';

export default function HistoricoTab({ instruments, liveDataMap, isLive }: HistoricoTabProps) {
  const [summary, setSummary] = useState<TickerSummary[]>([]);
  const [selectedTicker, setSelectedTicker] = useState<string>('');
  const [chartData, setChartData] = useState<Record<string, OHLCData[]>>({});
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(false);
  const [chartMetric, setChartMetric] = useState<ChartMetric>('price');
  const [captureStatus, setCaptureStatus] = useState<string>('');
  const [_captureCount, setCaptureCount] = useState(0);
  const [autoCapture, setAutoCapture] = useState(false);

  // ── Load summary data ──
  const loadSummary = useCallback(async () => {
    try {
      const res = await fetch('/api/historical?view=summary');
      if (res.ok) {
        const data = await res.json();
        if (data.ok && data.summary) {
          setSummary(data.summary);
          if (data.summary.length > 0 && !selectedTicker) {
            setSelectedTicker(data.summary[0].ticker);
          }
        }
      }
    } catch { /* ignore */ }
  }, [selectedTicker]);

  // ── Load chart data for a specific ticker ──
  const loadChartData = useCallback(async (ticker: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/historical?ticker=${ticker}&days=${days}&view=ohlc`);
      if (res.ok) {
        const data = await res.json();
        if (data.ok && data.data) {
          setChartData(data.data);
        }
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [days]);

  // ── Capture current prices ──
  const captureSnapshot = useCallback(async () => {
    setCaptureStatus('Capturando...');
    try {
      const liveInstruments = isLive ? Array.from(liveDataMap.values()) : null;
      
      const res = await fetch('/api/prices/snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruments: liveInstruments }),
      });

      if (res.ok) {
        const data = await res.json();
        setCaptureCount(data.captured || 0);
        setCaptureStatus(`✅ ${data.captured} precios capturados`);
        setTimeout(() => loadSummary(), 500);
      } else {
        setCaptureStatus('❌ Error al capturar');
      }
    } catch {
      setCaptureStatus('❌ Error de conexión');
    }
    setTimeout(() => setCaptureStatus(''), 5000);
  }, [isLive, liveDataMap, loadSummary]);

  // ── Effects ──
  useEffect(() => {
    loadSummary();
    // eslint-disable-next-line react-hooks/set-state-in-effect
  }, []);

  useEffect(() => {
    if (!selectedTicker) return;
    loadChartData(selectedTicker);
    // eslint-disable-next-line react-hooks/set-state-in-effect
  }, [selectedTicker, days, loadChartData]);

  // ── Auto-capture every 60s during market hours ──
  useEffect(() => {
    if (!autoCapture) return;
    
    const interval = setInterval(() => {
      const now = new Date();
      const hour = now.getHours();
      const day = now.getDay();
      if (day >= 1 && day <= 5 && hour >= 10 && hour < 17) {
        captureSnapshot();
      }
    }, 60000);

    return () => clearInterval(interval);
  }, [autoCapture, captureSnapshot]);

  // ── Export CSV ──
  const exportCSV = useCallback(async () => {
    if (!selectedTicker) return;
    try {
      const res = await fetch(`/api/historical?ticker=${selectedTicker}&days=${days}&format=csv&view=ohlc`);
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `historical_${selectedTicker}_${days}d.csv`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch { /* ignore */ }
  }, [selectedTicker, days]);

  // ── Export raw snapshots CSV ──
  const exportSnapshots = useCallback(async () => {
    if (!selectedTicker) return;
    try {
      const res = await fetch(`/api/historical?ticker=${selectedTicker}&days=${days}&format=csv&view=snapshots`);
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `snapshots_${selectedTicker}_${days}d.csv`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch { /* ignore */ }
  }, [selectedTicker, days]);

  // ── Prepare chart data ──
  const tickerData = useMemo(() => {
    if (!selectedTicker || !chartData[selectedTicker]) return [];
    return chartData[selectedTicker].map(d => ({
      ...d,
      dateShort: d.date.slice(5), // MM-DD
      temPct: d.avgTem != null ? d.avgTem * 100 : null,
      priceFormatted: d.close,
    }));
  }, [selectedTicker, chartData]);

  const currentTickerSummary = useMemo(() => {
    return summary.find(s => s.ticker === selectedTicker);
  }, [summary, selectedTicker]);

  // ── Available tickers from instruments + historical ──
  const availableTickers = useMemo(() => {
    const liveTickers = instruments.map(i => i.ticker);
    const histTickers = summary.map(s => s.ticker);
    return [...new Set([...liveTickers, ...histTickers])].sort();
  }, [instruments, summary]);

  // ── Chart colors ──
  const metricConfig: Record<ChartMetric, { label: string; color: string; key: string; format: (v: number) => string }> = {
    price: { label: 'Precio ($/VN)', color: '#2eebc8', key: 'close', format: v => v.toFixed(4) },
    tem: { label: 'TEM (%)', color: '#f472b6', key: 'temPct', format: v => v.toFixed(3) + '%' },
    volume: { label: 'Volumen (ARS)', color: '#fbbf24', key: 'volume', format: v => '$' + (v / 1000000).toFixed(1) + 'M' },
    vpv: { label: 'VPV ($/VN)', color: '#a78bfa', key: 'vpv', format: v => v?.toFixed(4) ?? '-' },
  };

  const currentMetric = metricConfig[chartMetric];

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-light text-app-text2">
            📜 Histórico de Precios
          </h2>
          <p className="text-[10px] text-app-text4 mt-0.5">
            Datos acumulados automáticamente desde data912 + ArgentinaDatos
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Auto-capture toggle */}
          <button
            onClick={() => setAutoCapture(!autoCapture)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-medium transition-all ${
              autoCapture 
                ? 'bg-[#2eebc8]/20 text-[#2eebc8] border border-[#2eebc8]/30' 
                : 'bg-app-subtle/60 text-app-text3 border border-app-border/60 hover:bg-app-hover'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${autoCapture ? 'bg-[#2eebc8] animate-pulse' : 'bg-app-text4'}`} />
            {autoCapture ? 'Auto-Capture ON' : 'Auto-Capture OFF'}
          </button>
          {/* Manual capture */}
          <button
            onClick={captureSnapshot}
            disabled={captureStatus.includes('Capturando')}
            className="px-3 py-1.5 rounded-lg text-[10px] font-medium bg-app-accent/20 text-app-accent-text border border-app-accent-border/60 hover:bg-app-accent/30 transition-all disabled:opacity-50"
          >
            📸 Capturar Ahora
          </button>
          {captureStatus && (
            <span className="text-[10px] text-app-text3">{captureStatus}</span>
          )}
        </div>
      </div>

      {/* ── Controls Row ── */}
      <div className="glass-card p-3 space-y-3 relative z-10">
        {/* Row 1: Ticker selector + Period + Export */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Ticker selector — constrained width, doesn't overlap */}
          <div className="flex items-center gap-2 shrink-0 relative z-50">
            <label className="text-[9px] text-app-text4 uppercase tracking-wider">Ticker</label>
            <select
              value={selectedTicker}
              onChange={e => setSelectedTicker(e.target.value)}
              className="bg-black/80 border border-app-border/60 rounded-lg px-3 py-1.5 text-[11px] text-white font-mono focus:outline-none focus:ring-1 focus:ring-app-accent max-w-[140px] min-w-[90px] cursor-pointer"
              style={{ colorScheme: 'dark', zIndex: 50 }}
            >
              {availableTickers.map(t => (
                <option key={t} value={t} style={{ backgroundColor: '#000000', color: '#ffffff' }}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          {/* Separator */}
          <div className="w-px h-5 bg-app-border/40 shrink-0" />

          {/* Days range */}
          <div className="flex items-center gap-1.5">
            <label className="text-[9px] text-app-text4 uppercase tracking-wider shrink-0">Período</label>
            {[7, 15, 30, 60, 90, 180, 365].map(d => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-2 py-1 rounded text-[9px] font-mono transition-all ${
                  days === d 
                    ? 'bg-app-accent/20 text-app-accent-text border border-app-accent-border/60' 
                    : 'text-app-text3 hover:text-app-text2 hover:bg-app-subtle/30'
                }`}
              >
                {d}d
              </button>
            ))}
          </div>

          {/* Export buttons — pushed to the right */}
          <div className="flex items-center gap-2 ml-auto shrink-0">
            <button
              onClick={exportCSV}
              disabled={!selectedTicker || tickerData.length === 0}
              className="px-2.5 py-1.5 rounded-lg text-[9px] font-medium bg-app-subtle/60 text-app-text3 border border-app-border/60 hover:bg-app-hover transition-all disabled:opacity-30"
            >
              📊 CSV OHLC
            </button>
            <button
              onClick={exportSnapshots}
              disabled={!selectedTicker}
              className="px-2.5 py-1.5 rounded-lg text-[9px] font-medium bg-app-subtle/60 text-app-text3 border border-app-border/60 hover:bg-app-hover transition-all disabled:opacity-30"
            >
              📋 CSV Snapshots
            </button>
          </div>
        </div>

        {/* Row 2: Chart metric selector — on its own line so it never overlaps */}
        <div className="flex items-center gap-1.5">
          <label className="text-[9px] text-app-text4 uppercase tracking-wider shrink-0">Métrica</label>
          {(Object.entries(metricConfig) as [ChartMetric, typeof metricConfig[ChartMetric]][]).map(([key, cfg]) => (
            <button
              key={key}
              onClick={() => setChartMetric(key)}
              className={`px-2.5 py-1 rounded text-[9px] font-mono transition-all ${
                chartMetric === key 
                  ? 'bg-app-accent/20 border border-app-accent-border/60' 
                  : 'text-app-text3 hover:text-app-text2 hover:bg-app-subtle/30'
              }`}
              style={{ color: chartMetric === key ? cfg.color : undefined }}
            >
              {cfg.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Stats Bar ── */}
      {currentTickerSummary && (
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-1.5 text-[10px]">
            <span className="text-app-text4">Días:</span>
            <span className="font-mono text-app-text">{currentTickerSummary.days_available}</span>
          </div>
          <div className="flex items-center gap-1.5 text-[10px]">
            <span className="text-app-text4">Desde:</span>
            <span className="font-mono text-app-text">{currentTickerSummary.first_date}</span>
          </div>
          <div className="flex items-center gap-1.5 text-[10px]">
            <span className="text-app-text4">Hasta:</span>
            <span className="font-mono text-app-text">{currentTickerSummary.last_date}</span>
          </div>
          {currentTickerSummary.latest_close != null && (
            <div className="flex items-center gap-1.5 text-[10px]">
              <span className="text-app-text4">Último:</span>
              <span className="font-mono text-app-accent-text">{currentTickerSummary.latest_close?.toFixed(4)}</span>
            </div>
          )}
          {currentTickerSummary.latest_tem != null && (
            <div className="flex items-center gap-1.5 text-[10px]">
              <span className="text-app-text4">TEM:</span>
              <span className="font-mono text-[#f472b6]">{(currentTickerSummary.latest_tem! * 100).toFixed(3)}%</span>
            </div>
          )}
          {currentTickerSummary.latest_vpv != null && (
            <div className="flex items-center gap-1.5 text-[10px]">
              <span className="text-app-text4">VPV:</span>
              <span className="font-mono text-[#a78bfa]">{currentTickerSummary.latest_vpv?.toFixed(4)}</span>
            </div>
          )}
        </div>
      )}

      {/* ── Main Chart ── */}
      <div className="glass-card p-4">
        {loading ? (
          <div className="h-64 flex items-center justify-center">
            <div className="text-[11px] text-app-text4 animate-pulse">Cargando datos históricos...</div>
          </div>
        ) : tickerData.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center gap-3">
            <div className="text-3xl">📭</div>
            <div className="text-[11px] text-app-text4">
              Sin datos históricos para {selectedTicker}
            </div>
            <div className="text-[9px] text-app-text4 max-w-sm text-center">
              Capturá precios con el botón &quot;📸 Capturar Ahora&quot; o activá &quot;Auto-Capture&quot; para acumular datos automáticamente durante el horario de mercado.
            </div>
            <button
              onClick={captureSnapshot}
              className="mt-2 px-4 py-2 rounded-lg text-[10px] font-medium bg-app-accent/20 text-app-accent-text border border-app-accent-border/60 hover:bg-app-accent/30 transition-all"
            >
              📸 Capturar Primer Snapshot
            </button>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            {chartMetric === 'volume' ? (
              <BarChart data={tickerData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="dateShort" tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.4)' }} />
                <YAxis tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.4)' }} tickFormatter={v => `$${(v / 1000000).toFixed(1)}M`} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#1e1e2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', fontSize: '10px' }}
                  formatter={(value: number) => [`$${(value / 1000000).toFixed(2)}M`, 'Volumen']}
                  labelFormatter={(label: string) => `Fecha: ${label}`}
                />
                <Bar dataKey="volume" fill={currentMetric.color} opacity={0.7} radius={[2, 2, 0, 0]} />
              </BarChart>
            ) : (
              <AreaChart data={tickerData}>
                <defs>
                  <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={currentMetric.color} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={currentMetric.color} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="dateShort" tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.4)' }} />
                <YAxis 
                  tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.4)' }} 
                  tickFormatter={v => chartMetric === 'tem' ? v.toFixed(2) + '%' : v.toFixed(chartMetric === 'price' ? 4 : 2)}
                  domain={['auto', 'auto']}
                />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#1e1e2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', fontSize: '10px' }}
                  formatter={(value: number, name: string) => [currentMetric.format(value), currentMetric.label]}
                  labelFormatter={(label: string) => `Fecha: ${label}`}
                />
                <Area 
                  type="monotone" 
                  dataKey={currentMetric.key} 
                  stroke={currentMetric.color} 
                  fill="url(#chartGradient)" 
                  strokeWidth={2}
                  dot={tickerData.length < 30 ? { r: 2, fill: currentMetric.color } : false}
                  activeDot={{ r: 4, fill: currentMetric.color, stroke: '#fff', strokeWidth: 1 }}
                />
              </AreaChart>
            )}
          </ResponsiveContainer>
        )}
      </div>

      {/* ── Multi-ticker comparison (Price) ── */}
      {Object.keys(chartData).length > 1 && (
        <div className="glass-card p-4">
          <h3 className="text-[11px] font-light text-app-text3 mb-3">📈 Comparación Multi-Ticker (Precio Normalizado)</h3>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="dateShort" tick={{ fontSize: 8, fill: 'rgba(255,255,255,0.4)' }} />
              <YAxis tick={{ fontSize: 8, fill: 'rgba(255,255,255,0.4)' }} tickFormatter={v => v.toFixed(2)} />
              <Tooltip 
                contentStyle={{ backgroundColor: '#1e1e2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', fontSize: '10px' }}
              />
              <Legend wrapperStyle={{ fontSize: '9px' }} />
              {Object.entries(chartData).slice(0, 6).map(([ticker, data], i) => {
                const colors = ['#2eebc8', '#f472b6', '#fbbf24', '#a78bfa', '#fb923c', '#34d399'];
                // Normalize to % change from first price
                const firstPrice = data[0]?.close ?? 1;
                const normalized = data.map(d => ({
                  ...d,
                  dateShort: d.date.slice(5),
                  normalized: ((d.close - firstPrice) / firstPrice) * 100,
                }));
                return (
                  <Line 
                    key={ticker}
                    data={normalized}
                    dataKey="normalized"
                    name={ticker}
                    stroke={colors[i % colors.length]}
                    strokeWidth={1.5}
                    dot={false}
                    type="monotone"
                  />
                );
              })}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Data Sources Info ── */}
      <div className="glass-card p-4">
        <h3 className="text-[11px] font-light text-app-text3 mb-3">🔗 Fuentes de Datos y Metodología</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-2">
            <div className="flex items-start gap-2">
              <span className="text-[10px] text-[#2eebc8] mt-0.5">●</span>
              <div>
                <div className="text-[10px] text-app-text font-medium">data912.com — Precios en vivo</div>
                <div className="text-[9px] text-app-text4">API gratuita, 120 req/min, actualización ~20s. Precios OHLC, bid/ask, volumen.</div>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-[10px] text-[#f472b6] mt-0.5">●</span>
              <div>
                <div className="text-[10px] text-app-text font-medium">ArgentinaDatos — VPV/TEM</div>
                <div className="text-[9px] text-app-text4">API pública. Valor al vencimiento, TEM emisión, fechas de vencimiento.</div>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-[10px] text-[#fbbf24] mt-0.5">●</span>
              <div>
                <div className="text-[10px] text-app-text font-medium">Acumulación Propia (V3.2)</div>
                <div className="text-[9px] text-app-text4">Cada snapshot se guarda en la DB local. Se genera OHLC diario automáticamente.</div>
              </div>
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-start gap-2">
              <span className="text-[10px] text-[#a78bfa] mt-0.5">●</span>
              <div>
                <div className="text-[10px] text-app-text font-medium">¿Por qué no existe un CSV público?</div>
                <div className="text-[9px] text-app-text4">LECAPs/BONCAPs son instrumentos relativamente nuevos en Argentina. Ni BYMA ni BCRA ofrecen series históricas descargables gratuitas.</div>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-[10px] text-[#fb923c] mt-0.5">●</span>
              <div>
                <div className="text-[10px] text-app-text font-medium">Fuentes alternativas (pago)</div>
                <div className="text-[9px] text-app-text4">BYMADATA (suscripción), IAMC (informes PDF), IOL (requiere cuenta). Nuestro acumulador es gratuito y automático.</div>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-[10px] text-[#34d399] mt-0.5">●</span>
              <div>
                <div className="text-[10px] text-app-text font-medium">Exportación</div>
                <div className="text-[9px] text-app-text4">Descargá tus datos acumulados en CSV desde los botones de exportación. Formatos: OHLC diario y snapshots crudos.</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Available Historical Tickers Table ── */}
      {summary.length > 0 && (
        <div className="glass-card p-4">
          <h3 className="text-[11px] font-light text-app-text3 mb-3">📋 Instrumentos con Datos Históricos</h3>
          <div className="max-h-48 overflow-y-auto">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="text-app-text4 border-b border-app-border/40">
                  <th className="text-left py-1.5 px-2">Ticker</th>
                  <th className="text-right py-1.5 px-2">Días</th>
                  <th className="text-left py-1.5 px-2">Desde</th>
                  <th className="text-left py-1.5 px-2">Hasta</th>
                  <th className="text-right py-1.5 px-2">Último Precio</th>
                  <th className="text-right py-1.5 px-2">TEM</th>
                </tr>
              </thead>
              <tbody>
                {summary.map(s => (
                  <tr 
                    key={s.ticker} 
                    className={`border-b border-app-border/20 hover:bg-app-subtle/30 cursor-pointer transition-colors ${s.ticker === selectedTicker ? 'bg-app-accent/10' : ''}`}
                    onClick={() => setSelectedTicker(s.ticker)}
                  >
                    <td className="py-1.5 px-2 font-mono text-app-text">{s.ticker}</td>
                    <td className="py-1.5 px-2 text-right font-mono text-app-text3">{s.days_available}</td>
                    <td className="py-1.5 px-2 font-mono text-app-text3">{s.first_date}</td>
                    <td className="py-1.5 px-2 font-mono text-app-text3">{s.last_date}</td>
                    <td className="py-1.5 px-2 text-right font-mono text-app-accent-text">
                      {s.latest_close != null ? s.latest_close.toFixed(4) : '-'}
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono text-[#f472b6]">
                      {s.latest_tem != null ? (s.latest_tem * 100).toFixed(3) + '%' : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
