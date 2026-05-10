'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { Instrument } from '@/lib/types';
import { formatPriceAxis, formatTEMAxis, formatSpreadAxis, formatVolumeAxis, formatPriceTooltip, formatTEMTooltip, formatSpreadTooltip } from '@/lib/chart-formatters';

// ════════════════════════════════════════════════════════════════════════
// V3.3-PRO — HistoricoTab: Price History with OHLC Charts
//
// Shows historical price/TEM evolution from the Hybrid Data Motor.
// Data comes from /api/price-history (Prisma DailyOHLC + PriceSnapshot).
// ════════════════════════════════════════════════════════════════════════

interface OHLCRecord {
  ticker: string;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  temOpen: number;
  temClose: number;
  temHigh: number;
  temLow: number;
  volume: number;
  iolVolume?: number;
  spreadAvg: number;
}

interface SnapshotRecord {
  id: string;
  ticker: string;
  price: number;
  tem: number;
  tna: number;
  spread: number;
  volume: number;
  source: string;
  iolVolume?: number;
  iolBid?: number;
  iolAsk?: number;
  timestamp: string;
}

interface TickerInfo {
  ticker: string;
  count: number;
  latestDate: string;
  latestClose: number;
}

type ChartMode = 'area' | 'bar' | 'ohlc';
type DateRange = 7 | 15 | 20 | 30 | 60 | 90 | 999;

interface HistoricoTabProps {
  instruments: Instrument[];
}

// ── Helpers ──
function formatPct(v: number): string {
  return (v * 100).toFixed(2) + '%';
}

function formatDate(dateStr: string): string {
  if (dateStr.includes('-')) {
    const parts = dateStr.split('-');
    return `${parts[2]}/${parts[1]}`;
  }
  return dateStr;
}

// ── CSV Export ──
function exportOHCLCSV(data: OHLCRecord[], ticker: string) {
  const today = new Date().toISOString().split('T')[0];
  const header = 'Fecha,Open,High,Low,Close,TEM_Open,TEM_Close,Volume,Spread_Avg\n';
  const rows = data.map(d =>
    `${d.date},${d.open.toFixed(4)},${d.high.toFixed(4)},${d.low.toFixed(4)},${d.close.toFixed(4)},${(d.temOpen * 100).toFixed(2)},${(d.temClose * 100).toFixed(2)},${d.volume.toFixed(0)},${(d.spreadAvg * 100).toFixed(3)}`
  ).join('\n');
  const csv = header + rows;
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `historico_${ticker}_${today}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

// ── Custom Tooltip ──
function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="bg-black/90 border border-app-border/60 rounded-lg px-3 py-2 text-xs backdrop-blur-sm">
      <div className="text-app-text4 font-mono mb-1">{label}</div>
      {payload.map((entry, idx) => (
        <div key={idx} className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
          <span className="text-app-text3">{entry.name}:</span>
          <span className="font-mono text-app-text">
            {entry.name.includes('TEM') || entry.name.includes('Spread')
              ? formatSpreadTooltip(entry.value * 100)
              : entry.name.includes('Volumen') || entry.name.includes('Vol')
                ? formatVolumeAxis(entry.value)
                : formatPriceTooltip(entry.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Main Component ──
export default function HistoricoTab({ instruments }: HistoricoTabProps) {
  const [selectedTicker, setSelectedTicker] = useState<string>('');
  const [chartMode, setChartMode] = useState<ChartMode>('area');
  const [dateRange, setDateRange] = useState<DateRange>(20);
  const [ohlcData, setOhlcData] = useState<OHLCRecord[]>([]);
  const [snapshots, setSnapshots] = useState<SnapshotRecord[]>([]);
  const [tickers, setTickers] = useState<TickerInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');

  // ── Fetch available tickers on mount ──
  useEffect(() => {
    async function fetchTickers() {
      try {
        const res = await fetch('/api/price-history?type=tickers');
        if (res.ok) {
          const data = await res.json();
          setTickers(data.tickers || []);
          if (data.tickers?.length > 0 && !selectedTicker) {
            setSelectedTicker(data.tickers[0].ticker);
          }
        }
      } catch {
        // Silently fail — tickers will be empty
      }
    }
    fetchTickers();
  }, []);

  // ── If no OHLC tickers available, use live instruments as fallback ──
  const availableTickers = useMemo(() => {
    if (tickers.length > 0) return tickers;
    return instruments.map(i => ({
      ticker: i.ticker,
      count: 0,
      latestDate: '',
      latestClose: i.price,
    })).sort((a, b) => a.ticker.localeCompare(b.ticker));
  }, [tickers, instruments]);

  // ── Auto-select first ticker if none selected ──
  useEffect(() => {
    if (!selectedTicker && availableTickers.length > 0) {
      setSelectedTicker(availableTickers[0].ticker);
    }
  }, [availableTickers, selectedTicker]);

  // ── Fetch OHLC data when ticker or range changes ──
  useEffect(() => {
    if (!selectedTicker) return;

    async function fetchData() {
      setLoading(true);
      setError('');
      try {
        const effectiveDays = dateRange === 999 ? 3650 : dateRange;
        const [ohlcRes, snapRes] = await Promise.all([
          fetch(`/api/price-history?type=ohlc&ticker=${encodeURIComponent(selectedTicker)}&days=${effectiveDays}`),
          fetch(`/api/price-history?type=snapshots&ticker=${encodeURIComponent(selectedTicker)}&hours=${effectiveDays * 24}`),
        ]);

        if (ohlcRes.ok) {
          const ohlcJson = await ohlcRes.json();
          setOhlcData(ohlcJson.ohlc || []);
        } else {
          setOhlcData([]);
        }

        if (snapRes.ok) {
          const snapJson = await snapRes.json();
          setSnapshots(snapJson.snapshots || []);
        } else {
          setSnapshots([]);
        }
      } catch (err) {
        setError('Error cargando datos históricos');
        setOhlcData([]);
        setSnapshots([]);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [selectedTicker, dateRange]);

  // ── Chart data transformation ──
  const chartData = useMemo(() => {
    if (ohlcData.length > 0) {
      return ohlcData.map(d => ({
        date: formatDate(d.date),
        price: d.close,
        tem: d.temClose,
        spread: d.spreadAvg,
        volume: d.volume,
        iolVolume: d.iolVolume,
        high: d.high,
        low: d.low,
        open: d.open,
      }));
    }
    // Fallback: use snapshots if no OHLC
    if (snapshots.length > 0) {
      return snapshots
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
        .map(s => ({
          date: new Date(s.timestamp).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
          price: s.price,
          tem: s.tem,
          spread: s.spread,
          volume: s.volume,
          iolVolume: s.iolVolume,
        }));
    }
    return [];
  }, [ohlcData, snapshots]);

  // ── Stats ──
  const stats = useMemo(() => {
    if (chartData.length === 0) return null;
    const prices = chartData.map(d => d.price);
    const tems = chartData.map(d => d.tem);
    const spreads = chartData.map(d => d.spread);
    return {
      priceMin: Math.min(...prices),
      priceMax: Math.max(...prices),
      priceAvg: prices.reduce((s, v) => s + v, 0) / prices.length,
      temMin: Math.min(...tems),
      temMax: Math.max(...tems),
      temAvg: tems.reduce((s, v) => s + v, 0) / tems.length,
      spreadMin: Math.min(...spreads),
      spreadMax: Math.max(...spreads),
      dataPoints: chartData.length,
      hasOHLC: ohlcData.length > 0,
    };
  }, [chartData, ohlcData]);

  // ── Selected instrument info ──
  const selectedInstrument = useMemo(() => {
    return instruments.find(i => i.ticker === selectedTicker);
  }, [instruments, selectedTicker]);

  return (
    <div className="space-y-5 animate-fadeInUp">
      {/* ── Header ── */}
      <div>
        <h2 className="text-lg font-light text-app-text mb-1">📈 Histórico de Precios</h2>
        <p className="text-sm text-app-text3">Evolución de precios y TEM · Motor Híbrido de Datos V3.4.2-PRO</p>
      </div>

      {/* ── Controls Bar ── */}
      <div className="glass-card p-4">
        <div className="flex flex-wrap items-center gap-3">
          {/* Ticker Selector — Dark Style (V3.2 fix) */}
          <div className="relative">
            <select
              value={selectedTicker}
              onChange={e => setSelectedTicker(e.target.value)}
              className="appearance-none bg-black text-white border border-white/20 rounded-lg px-4 py-2 text-sm font-mono pr-8 cursor-pointer focus:outline-none focus:border-[#2eebc8]/60 focus:ring-1 focus:ring-[#2eebc8]/30 transition-colors"
              style={{ colorScheme: 'dark' }}
            >
              {availableTickers.map(t => (
                <option key={t.ticker} value={t.ticker} style={{ background: '#000', color: '#fff' }}>
                  {t.ticker}
                  {t.count > 0 ? ` (${t.count}d)` : ''}
                </option>
              ))}
            </select>
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-white/40 text-xs pointer-events-none">▾</span>
          </div>

          {/* Chart Mode Selector */}
          <div className="flex items-center gap-1">
            {([
              { mode: 'area' as ChartMode, label: 'Área', icon: '📈' },
              { mode: 'bar' as ChartMode, label: 'Barras', icon: '📊' },
            ]).map(opt => (
              <button
                key={opt.mode}
                onClick={() => setChartMode(opt.mode)}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all duration-200 ${
                  chartMode === opt.mode
                    ? 'bg-[#2eebc8]/15 text-[#2eebc8] border border-[#2eebc8]/30'
                    : 'bg-app-subtle/60 text-app-text3 border border-app-border/60 hover:bg-app-hover'
                }`}
              >
                {opt.icon} {opt.label}
              </button>
            ))}
          </div>

          {/* Date Range Selector */}
          <div className="flex items-center gap-1">
            {([
              { days: 7 as DateRange, label: '7d' },
              { days: 15 as DateRange, label: '15d' },
              { days: 20 as DateRange, label: '20d' },
              { days: 30 as DateRange, label: '30d' },
              { days: 60 as DateRange, label: '60d' },
              { days: 90 as DateRange, label: '90d' },
              { days: 999 as DateRange, label: 'ALL' },
            ]).map(opt => (
              <button
                key={opt.days}
                onClick={() => setDateRange(opt.days)}
                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-mono font-medium transition-all duration-200 ${
                  dateRange === opt.days
                    ? 'bg-[#22d3ee]/10 text-[#22d3ee] border border-[#22d3ee]/30'
                    : 'bg-app-subtle/60 text-app-text3 border border-app-border/60 hover:bg-app-hover'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Export Button */}
          <button
            onClick={() => ohlcData.length > 0 && exportOHCLCSV(ohlcData, selectedTicker)}
            disabled={ohlcData.length === 0}
            className="px-3 py-1.5 rounded-lg text-[11px] font-medium bg-app-subtle/60 text-app-text3 border border-app-border/60 hover:bg-app-hover hover:text-app-text2 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 ml-auto"
            title="Exportar CSV"
          >
            📥 CSV
          </button>
        </div>
      </div>

      {/* ── Instrument Info Card ── */}
      {selectedInstrument && (
        <div className="glass-card p-4">
          <div className="flex items-center gap-4">
            <div>
              <span className="text-sm font-mono font-medium text-app-text">{selectedTicker}</span>
              <span className={`ml-2 text-[9px] px-1.5 py-0.5 rounded border ${
                selectedInstrument.type === 'LECAP'
                  ? 'bg-[#2eebc8]/10 text-[#2eebc8] border-[#2eebc8]/20'
                  : 'bg-[#f472b6]/10 text-[#f472b6] border-[#f472b6]/20'
              }`}>
                {selectedInstrument.type}
              </span>
            </div>
            <div className="text-[10px] text-app-text4 font-mono">
              {selectedInstrument.days}d al vto. · TEM {((selectedInstrument?.tem ?? 0)).toFixed(2)}% · Precio ${(selectedInstrument?.price ?? 0).toFixed(4)}
            </div>
            {selectedInstrument.iolStatus === 'online' && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#a78bfa]/10 text-[#a78bfa] border border-[#a78bfa]/20">
                ✓ VOL IOL
              </span>
            )}
            {selectedInstrument.iolLiquidityAlert && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#fbbf24]/10 text-[#fbbf24] border border-[#fbbf24]/20">
                ⚠️ BAJA LIQUIDEZ
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── Data Source Indicator ── */}
      {ohlcData.length > 0 && (
        <div className="flex items-center gap-2 text-[10px] text-app-text4">
          <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#2eebc8]/10 text-[#2eebc8] border border-[#2eebc8]/20">
            📊 {ohlcData.length} registros OHLC
          </span>
          {ohlcData.length >= 15 && (
            <span className="px-2 py-0.5 rounded bg-[#fbbf24]/10 text-[#fbbf24] border border-[#fbbf24]/20">
              ✨ Tendencia 3 semanas
            </span>
          )}
        </div>
      )}

      {/* ── Stats Summary ── */}
      {stats && (
        <div className="glass-card p-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
            <div>
              <div className="text-[9px] text-app-text4 uppercase tracking-wider mb-0.5">Precio Min</div>
              <div className="font-mono text-sm font-medium text-[#f87171]">${stats.priceMin.toFixed(4)}</div>
            </div>
            <div>
              <div className="text-[9px] text-app-text4 uppercase tracking-wider mb-0.5">Precio Max</div>
              <div className="font-mono text-sm font-medium text-[#2eebc8]">${stats.priceMax.toFixed(4)}</div>
            </div>
            <div>
              <div className="text-[9px] text-app-text4 uppercase tracking-wider mb-0.5">TEM Prom</div>
              <div className="font-mono text-sm font-medium text-app-accent-text">{(stats.temAvg * 100).toFixed(2)}%</div>
            </div>
            <div>
              <div className="text-[9px] text-app-text4 uppercase tracking-wider mb-0.5">TEM Rango</div>
              <div className="font-mono text-sm font-medium text-app-text3">{(stats.temMin * 100).toFixed(2)}%-{(stats.temMax * 100).toFixed(2)}%</div>
            </div>
            <div>
              <div className="text-[9px] text-app-text4 uppercase tracking-wider mb-0.5">Spread Max</div>
              <div className={`font-mono text-sm font-medium ${stats.spreadMax > 0 ? 'text-[#2eebc8]' : 'text-[#f87171]'}`}>
                {(stats.spreadMax * 100).toFixed(3)}%
              </div>
            </div>
            <div>
              <div className="text-[9px] text-app-text4 uppercase tracking-wider mb-0.5">Datos</div>
              <div className="font-mono text-sm font-medium text-app-text">
                {stats.dataPoints} puntos
                {stats.hasOHLC ? ' · OHLC' : ' · Snap'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Tendencia 20 días Summary Card ── */}
      {ohlcData.length >= 15 && (() => {
        const first = ohlcData[0];
        const last = ohlcData[ohlcData.length - 1];
        const priceChange = (last.close ?? 0) - (first.open ?? 0);
        const priceChangePct = (priceChange / (first.open ?? 1)) * 100;
        const temChange = (last.temClose ?? 0) - (first.temOpen ?? 0);
        const isUp = priceChange >= 0;
        return (
          <div className="glass-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm font-medium text-app-text2">📐 Tendencia {ohlcData.length} días</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <div className="text-[9px] text-app-text4 uppercase tracking-wider mb-0.5">Precio Inicio</div>
                <div className="font-mono text-sm">${(first.open ?? 0).toFixed(4)}</div>
              </div>
              <div>
                <div className="text-[9px] text-app-text4 uppercase tracking-wider mb-0.5">Precio Fin</div>
                <div className="font-mono text-sm">${(last.close ?? 0).toFixed(4)}</div>
              </div>
              <div>
                <div className="text-[9px] text-app-text4 uppercase tracking-wider mb-0.5">Δ Precio</div>
                <div className={`font-mono text-sm font-medium ${isUp ? 'text-[#2eebc8]' : 'text-[#f87171]'}`}>
                  {isUp ? '+' : ''}{priceChangePct.toFixed(2)}%
                </div>
              </div>
              <div>
                <div className="text-[9px] text-app-text4 uppercase tracking-wider mb-0.5">Δ TEM</div>
                <div className={`font-mono text-sm font-medium ${temChange <= 0 ? 'text-[#2eebc8]' : 'text-[#f87171]'}`}>
                  {temChange >= 0 ? '+' : ''}{(temChange * 100).toFixed(2)}pp
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Charts ── */}
      {loading ? (
        <div className="glass-card p-8 text-center">
          <div className="animate-pulse text-2xl mb-2">📈</div>
          <p className="text-sm text-app-text3">Cargando datos históricos...</p>
        </div>
      ) : chartData.length === 0 ? (
        <div className="glass-card p-8 text-center">
          <div className="text-3xl mb-2 opacity-40">📭</div>
          <p className="text-sm text-app-text3">Sin datos históricos disponibles</p>
          <p className="text-[10px] text-app-text4 mt-1">
            Ejecutá el Cerebro Táctico (<code className="text-[#2eebc8]/70">npm run prices:update</code>) para generar datos OHLC
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {/* ── Price Chart ── */}
          <div className="glass-card p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-app-text2">Precio de Cierre</h3>
              <span className="text-[9px] text-app-text4 font-mono">{selectedTicker} · {dateRange}d</span>
            </div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                {chartMode === 'area' ? (
                  <AreaChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                    <defs>
                      <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#2eebc8" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#2eebc8" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#6b7280' }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} tickFormatter={formatPriceAxis} domain={['auto', 'auto']} />
                    <Tooltip content={<CustomTooltip />} />
                    <Area type="monotone" dataKey="price" name="Precio" stroke="#2eebc8" fill="url(#priceGradient)" strokeWidth={2} />
                  </AreaChart>
                ) : (
                  <BarChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#6b7280' }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} tickFormatter={formatPriceAxis} domain={['auto', 'auto']} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="price" name="Precio" fill="#2eebc8" radius={[2, 2, 0, 0]} opacity={0.8} />
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>
          </div>

          {/* ── TEM Chart ── */}
          <div className="glass-card p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-app-text2">TEM (Tasa Efectiva Mensual)</h3>
              <span className="text-[9px] text-app-text4 font-mono">{selectedTicker}</span>
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                {chartMode === 'area' ? (
                  <AreaChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                    <defs>
                      <linearGradient id="temGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f472b6" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#f472b6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#6b7280' }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} tickFormatter={v => formatTEMAxis(v * 100)} domain={['auto', 'auto']} />
                    <Tooltip content={<CustomTooltip />} />
                    <Area type="monotone" dataKey="tem" name="TEM" stroke="#f472b6" fill="url(#temGradient)" strokeWidth={2} />
                  </AreaChart>
                ) : (
                  <BarChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#6b7280' }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} tickFormatter={v => formatTEMAxis(v * 100)} domain={['auto', 'auto']} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="tem" name="TEM" fill="#f472b6" radius={[2, 2, 0, 0]} opacity={0.8} />
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>
          </div>

          {/* ── Spread vs Caución Chart ── */}
          <div className="glass-card p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-app-text2">Spread vs Caución</h3>
              <span className="text-[9px] text-app-text4 font-mono">{selectedTicker}</span>
            </div>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#6b7280' }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} tickFormatter={v => formatSpreadAxis(v * 100)} domain={['auto', 'auto']} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="spread" name="Spread" radius={[2, 2, 0, 0]}>
                    {chartData.map((entry, index) => (
                      <rect key={index} fill={entry.spread >= 0 ? '#2eebc8' : '#f87171'} opacity={0.8} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* ── Volume Chart ── */}
          {chartData.some(d => d.volume > 0) && (
            <div className="glass-card p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-app-text2">Volumen</h3>
                <span className="text-[9px] text-app-text4 font-mono">{selectedTicker}</span>
              </div>
              <div className="h-36">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#6b7280' }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} tickFormatter={formatVolumeAxis} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="volume" name="Volumen" fill="#a78bfa" radius={[2, 2, 0, 0]} opacity={0.6} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* ── IOL Volume Chart (when available) ── */}
          {ohlcData.some(d => (d?.iolVolume ?? 0) > 0) && (
            <div className="glass-card p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-app-text2">Volumen IOL</h3>
                <span className="text-[9px] text-app-text4 font-mono">{selectedTicker}</span>
              </div>
              <div className="h-36">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData.filter(d => (d?.iolVolume ?? 0) > 0)} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#6b7280' }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} tickFormatter={formatVolumeAxis} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="iolVolume" name="Vol IOL" fill="#a78bfa" radius={[2, 2, 0, 0]} opacity={0.8} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
