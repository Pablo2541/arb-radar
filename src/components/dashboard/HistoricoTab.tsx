'use client';

// ════════════════════════════════════════════════════════════════════════
// V3.2 — HistoricoTab: Price History Visualization
//
// Shows historical price/TEM data from PriceSnapshot + DailyOHLC tables.
// Uses AreaChart for TEM/Price evolution and supports ticker selection.
//
// Data source: /api/price-history (reads from Neon PostgreSQL)
// ════════════════════════════════════════════════════════════════════════

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';
import type { Instrument } from '@/lib/types';

// ── Types ──────────────────────────────────────────────────────────
interface OHLCRecord {
  id: string;
  ticker: string;
  date: string;         // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  openTEM: number;
  highTEM: number;
  lowTEM: number;
  closeTEM: number;
  avgVolume: number;
  avgIOLVolume: number | null;
  tickCount: number;
}

interface PriceHistoryResponse {
  format: string;
  tickers: string[];
  data: OHLCRecord[];
  count: number;
  snapshotCount: number;
  lastSnapshot: string | null;
  since: string;
}

type MetricType = 'tem' | 'precio' | 'spread' | 'volumen';
type PeriodType = '7' | '15' | '30' | '90';

// ── Helpers ────────────────────────────────────────────────────────
function formatDate(dateStr: string): string {
  try {
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}`;
  } catch {
    return dateStr;
  }
}

function formatTEM(value: number): string {
  return value.toFixed(2) + '%';
}

function formatPrice(value: number): string {
  return '$' + value.toFixed(4);
}

function formatVolume(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

// ── CSV Export ──────────────────────────────────────────────────────
function exportCSV(data: OHLCRecord[], ticker: string) {
  const header = 'Fecha,Ticker,Open,High,Low,Close,OpenTEM,HighTEM,LowTEM,CloseTEM,AvgVolume,TickCount\n';
  const rows = data.map(d =>
    `${d.date},${d.ticker},${d.open.toFixed(4)},${d.high.toFixed(4)},${d.low.toFixed(4)},${d.close.toFixed(4)},${d.openTEM.toFixed(2)},${d.highTEM.toFixed(2)},${d.lowTEM.toFixed(2)},${d.closeTEM.toFixed(2)},${d.avgVolume.toFixed(0)},${d.tickCount}`
  ).join('\n');
  const csv = header + rows;
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `historico_${ticker}_${new Date().toISOString().split('T')[0]}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

// ── Props ──────────────────────────────────────────────────────────
interface HistoricoTabProps {
  instruments: Instrument[];
}

// ── Main Component ─────────────────────────────────────────────────
export default function HistoricoTab({ instruments }: HistoricoTabProps) {
  const [tickers, setTickers] = useState<string[]>([]);
  const [selectedTicker, setSelectedTicker] = useState<string>('');
  const [period, setPeriod] = useState<PeriodType>('30');
  const [metric, setMetric] = useState<MetricType>('tem');
  const [ohlcData, setOhlcData] = useState<OHLCRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastSnapshot, setLastSnapshot] = useState<string | null>(null);
  const [snapshotCount, setSnapshotCount] = useState(0);

  // Load available tickers on mount
  useEffect(() => {
    async function loadTickers() {
      try {
        const res = await fetch(`/api/price-history?days=${period}&format=ohlc`);
        if (res.ok) {
          const data: PriceHistoryResponse = await res.json();
          setTickers(data.tickers);
          setSnapshotCount(data.snapshotCount);
          setLastSnapshot(data.lastSnapshot);
          if (data.tickers.length > 0 && !selectedTicker) {
            setSelectedTicker(data.tickers[0]);
          }
        }
      } catch {
        // API unavailable
      }
    }
    loadTickers();
  }, []);

  // Load data when ticker or period changes
  useEffect(() => {
    if (!selectedTicker) return;
    async function loadData() {
      setLoading(true);
      try {
        const res = await fetch(`/api/price-history?ticker=${selectedTicker}&days=${period}&format=ohlc`);
        if (res.ok) {
          const data: PriceHistoryResponse = await res.json();
          setOhlcData(data.data);
          setSnapshotCount(data.snapshotCount);
          setLastSnapshot(data.lastSnapshot);
        }
      } catch {
        setOhlcData([]);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [selectedTicker, period]);

  // Build chart data based on selected metric
  const chartData = useMemo(() => {
    if (ohlcData.length === 0) return [];

    return ohlcData.map(d => ({
      date: formatDate(d.date),
      dateFull: d.date,
      // TEM metrics
      tem: d.closeTEM,
      temHigh: d.highTEM,
      temLow: d.lowTEM,
      // Price metrics
      precio: d.close,
      precioHigh: d.high,
      precioLow: d.low,
      // Volume
      volumen: d.avgVolume,
      iolVolumen: d.avgIOLVolume || 0,
    }));
  }, [ohlcData]);

  // Compute stats
  const stats = useMemo(() => {
    if (ohlcData.length === 0) return null;
    const latest = ohlcData[ohlcData.length - 1];
    const first = ohlcData[0];
    const temChange = latest.closeTEM - first.openTEM;
    const priceChange = ((latest.close - first.open) / first.open) * 100;
    const avgTEM = ohlcData.reduce((s, d) => s + d.closeTEM, 0) / ohlcData.length;
    const maxTEM = Math.max(...ohlcData.map(d => d.highTEM));
    const minTEM = Math.min(...ohlcData.map(d => d.lowTEM));
    const avgVolume = ohlcData.reduce((s, d) => s + d.avgVolume, 0) / ohlcData.length;

    return {
      latestTEM: latest.closeTEM,
      latestPrice: latest.close,
      temChange,
      priceChange,
      avgTEM,
      maxTEM,
      minTEM,
      avgVolume,
      days: ohlcData.length,
    };
  }, [ohlcData]);

  // Chart config based on metric
  const chartConfig = useMemo(() => {
    switch (metric) {
      case 'tem':
        return {
          dataKey: 'tem',
          highKey: 'temHigh',
          lowKey: 'temLow',
          label: 'TEM (%)',
          color: '#2eebc8',
          colorHigh: 'rgba(46, 235, 200, 0.3)',
          formatter: formatTEM,
          domain: ['dataMin - 0.1', 'dataMax + 0.1'] as [string, string],
        };
      case 'precio':
        return {
          dataKey: 'precio',
          highKey: 'precioHigh',
          lowKey: 'precioLow',
          label: 'Precio ($)',
          color: '#f472b6',
          colorHigh: 'rgba(244, 114, 182, 0.3)',
          formatter: formatPrice,
          domain: ['dataMin - 0.002', 'dataMax + 0.002'] as [string, string],
        };
      case 'volumen':
        return {
          dataKey: 'volumen',
          highKey: 'volumen',
          lowKey: 'volumen',
          label: 'Volumen (ARS)',
          color: '#fbbf24',
          colorHigh: 'rgba(251, 191, 36, 0.3)',
          formatter: formatVolume,
          domain: [0, 'dataMax'] as [number, string],
        };
      default: // spread — use TEM as proxy for now
        return {
          dataKey: 'tem',
          highKey: 'temHigh',
          lowKey: 'temLow',
          label: 'Spread vs Caución (%)',
          color: '#22d3ee',
          colorHigh: 'rgba(34, 211, 238, 0.3)',
          formatter: formatTEM,
          domain: ['dataMin - 0.1', 'dataMax + 0.1'] as [string, string],
        };
    }
  }, [metric]);

  // All available tickers: from API + from current instruments
  const allTickers = useMemo(() => {
    const apiSet = new Set(tickers);
    const instTickers = instruments.map(i => i.ticker);
    for (const t of instTickers) apiSet.add(t);
    return Array.from(apiSet).sort();
  }, [tickers, instruments]);

  return (
    <div className="space-y-5 animate-fadeInUp">
      {/* ── Header ── */}
      <div>
        <h2 className="text-lg font-light text-app-text mb-1">📜 Histórico</h2>
        <p className="text-sm text-app-text3">
          Evolución de precios y tasas · Datos acumulados por Cerebro Táctico
          {lastSnapshot && (
            <span className="text-[9px] text-app-text4 ml-2 font-mono">
              Último snapshot: {new Date(lastSnapshot).toLocaleString('es-AR')}
            </span>
          )}
        </p>
      </div>

      {/* ── Controls Row 1: Ticker + Period + Export ── */}
      <div className="glass-card p-4">
        <div className="flex flex-wrap items-center gap-3">
          {/* Ticker Selector — Black bg, white text */}
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-app-text4 uppercase tracking-wider shrink-0">Ticker</label>
            <select
              value={selectedTicker}
              onChange={e => setSelectedTicker(e.target.value)}
              className="max-w-[140px] px-2.5 py-1.5 bg-black text-white border border-app-border rounded-lg text-xs font-mono focus:border-[#2eebc8]/40 focus:ring-0 cursor-pointer"
              style={{ colorScheme: 'dark' }}
            >
              {allTickers.map(t => (
                <option key={t} value={t} style={{ background: '#000', color: '#fff' }}>
                  {t}
                </option>
              ))}
              {allTickers.length === 0 && (
                <option value="" style={{ background: '#000', color: '#fff' }}>Sin datos</option>
              )}
            </select>
          </div>

          {/* Period Selector */}
          <div className="flex items-center gap-1.5">
            <label className="text-[10px] text-app-text4 uppercase tracking-wider shrink-0">Período</label>
            {(['7', '15', '30', '90'] as PeriodType[]).map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                  period === p
                    ? 'bg-[#2eebc8]/15 text-[#2eebc8] border border-[#2eebc8]/30'
                    : 'bg-app-subtle/60 text-app-text3 border border-app-border/60 hover:bg-app-hover'
                }`}
              >
                {p}d
              </button>
            ))}
          </div>

          {/* Export */}
          <button
            onClick={() => ohlcData.length > 0 && exportCSV(ohlcData, selectedTicker)}
            disabled={ohlcData.length === 0}
            className="ml-auto px-3 py-1.5 rounded-lg text-[11px] font-medium bg-app-subtle/60 text-app-text3 border border-app-border/60 hover:bg-app-hover hover:text-app-text2 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            📥 CSV
          </button>
        </div>

        {/* Controls Row 2: Metric Selector */}
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-app-border/30">
          <label className="text-[10px] text-app-text4 uppercase tracking-wider shrink-0">Métrica</label>
          {([
            { key: 'tem' as MetricType, label: 'TEM', icon: '📈' },
            { key: 'precio' as MetricType, label: 'Precio', icon: '💲' },
            { key: 'volumen' as MetricType, label: 'Volumen', icon: '📊' },
            { key: 'spread' as MetricType, label: 'Spread', icon: '🔄' },
          ]).map(m => (
            <button
              key={m.key}
              onClick={() => setMetric(m.key)}
              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                metric === m.key
                  ? m.key === 'tem'
                    ? 'bg-[#2eebc8]/15 text-[#2eebc8] border border-[#2eebc8]/30'
                    : m.key === 'precio'
                      ? 'bg-[#f472b6]/15 text-[#f472b6] border border-[#f472b6]/30'
                      : m.key === 'volumen'
                        ? 'bg-[#fbbf24]/15 text-[#fbbf24] border border-[#fbbf24]/30'
                        : 'bg-[#22d3ee]/15 text-[#22d3ee] border border-[#22d3ee]/30'
                  : 'bg-app-subtle/60 text-app-text3 border border-app-border/60 hover:bg-app-hover'
              }`}
            >
              {m.icon} {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Stats Cards ── */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="glass-card-accent p-3">
            <div className="text-[9px] text-app-text4 uppercase tracking-wider mb-1">TEM Actual</div>
            <div className="font-mono text-lg font-medium text-[#2eebc8]">
              {stats.latestTEM.toFixed(2)}%
            </div>
            <div className={`text-[9px] font-mono mt-0.5 ${stats.temChange >= 0 ? 'text-[#2eebc8]' : 'text-[#f87171]'}`}>
              {stats.temChange >= 0 ? '+' : ''}{stats.temChange.toFixed(2)}% en {stats.days}d
            </div>
          </div>
          <div className="glass-card-accent p-3">
            <div className="text-[9px] text-app-text4 uppercase tracking-wider mb-1">Precio</div>
            <div className="font-mono text-lg font-medium text-[#f472b6]">
              ${stats.latestPrice.toFixed(4)}
            </div>
            <div className={`text-[9px] font-mono mt-0.5 ${stats.priceChange >= 0 ? 'text-[#2eebc8]' : 'text-[#f87171]'}`}>
              {stats.priceChange >= 0 ? '+' : ''}{stats.priceChange.toFixed(2)}%
            </div>
          </div>
          <div className="glass-card-accent p-3">
            <div className="text-[9px] text-app-text4 uppercase tracking-wider mb-1">Rango TEM</div>
            <div className="font-mono text-sm font-medium text-app-text">
              {stats.minTEM.toFixed(2)}% — {stats.maxTEM.toFixed(2)}%
            </div>
            <div className="text-[9px] text-app-text4 mt-0.5">Prom: {stats.avgTEM.toFixed(2)}%</div>
          </div>
          <div className="glass-card-accent p-3">
            <div className="text-[9px] text-app-text4 uppercase tracking-wider mb-1">Volumen Prom</div>
            <div className="font-mono text-lg font-medium text-[#fbbf24]">
              {formatVolume(stats.avgVolume)}
            </div>
            <div className="text-[9px] text-app-text4 mt-0.5">{snapshotCount} snapshots</div>
          </div>
        </div>
      )}

      {/* ── Chart ── */}
      <div className="glass-card p-4">
        {loading ? (
          <div className="h-64 flex items-center justify-center">
            <div className="text-center">
              <div className="text-2xl mb-2 animate-pulse">📜</div>
              <p className="text-sm text-app-text3">Cargando datos históricos...</p>
            </div>
          </div>
        ) : chartData.length === 0 ? (
          <div className="h-64 flex items-center justify-center">
            <div className="text-center">
              <div className="text-3xl mb-3 opacity-40">📭</div>
              <p className="text-sm text-app-text3 mb-1">Sin datos históricos disponibles</p>
              <p className="text-[11px] text-app-text4">
                Ejecutá <code className="px-1.5 py-0.5 bg-app-subtle/60 rounded text-[#2eebc8] font-mono">npm run prices:daemon</code> para empezar a acumular datos
              </p>
            </div>
          </div>
        ) : metric === 'volumen' ? (
          /* Bar chart for volume */
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.08)" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: '#7a8599' }}
                tickLine={false}
                axisLine={{ stroke: 'rgba(148, 163, 184, 0.1)' }}
              />
              <YAxis
                tick={{ fontSize: 10, fill: '#7a8599' }}
                tickLine={false}
                axisLine={{ stroke: 'rgba(148, 163, 184, 0.1)' }}
                tickFormatter={(v: number) => formatVolume(v)}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#151d2e',
                  border: '1px solid rgba(46, 235, 200, 0.2)',
                  borderRadius: '8px',
                  fontSize: '11px',
                  color: '#e2e8f0',
                }}
                formatter={(value: number) => [formatVolume(value), 'Volumen']}
                labelFormatter={(label: string) => `📅 ${label}`}
              />
              <Bar dataKey="volumen" fill="#fbbf24" fillOpacity={0.6} radius={[2, 2, 0, 0]} />
              {chartData.some(d => d.iolVolumen > 0) && (
                <Bar dataKey="iolVolumen" fill="#a78bfa" fillOpacity={0.6} radius={[2, 2, 0, 0]} />
              )}
            </BarChart>
          </ResponsiveContainer>
        ) : (
          /* Area chart for TEM/Price/Spread */
          <ResponsiveContainer width="100%" height={320}>
            <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
              <defs>
                <linearGradient id={`gradient-${metric}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={chartConfig.color} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={chartConfig.color} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.08)" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: '#7a8599' }}
                tickLine={false}
                axisLine={{ stroke: 'rgba(148, 163, 184, 0.1)' }}
              />
              <YAxis
                domain={chartConfig.domain}
                tick={{ fontSize: 10, fill: '#7a8599' }}
                tickLine={false}
                axisLine={{ stroke: 'rgba(148, 163, 184, 0.1)' }}
                tickFormatter={(v: number) => chartConfig.formatter(v)}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#151d2e',
                  border: '1px solid rgba(46, 235, 200, 0.2)',
                  borderRadius: '8px',
                  fontSize: '11px',
                  color: '#e2e8f0',
                }}
                formatter={(value: number, name: string) => [
                  chartConfig.formatter(value),
                  name === chartConfig.dataKey ? chartConfig.label : name,
                ]}
                labelFormatter={(label: string) => `📅 ${label}`}
              />
              {/* High-Low band */}
              <Area
                type="monotone"
                dataKey={chartConfig.highKey}
                stroke="none"
                fill={chartConfig.colorHigh}
                fillOpacity={0.4}
              />
              {/* Main line */}
              <Area
                type="monotone"
                dataKey={chartConfig.dataKey}
                stroke={chartConfig.color}
                strokeWidth={2}
                fill={`url(#gradient-${metric})`}
                dot={chartData.length < 30 ? { fill: chartConfig.color, strokeWidth: 0, r: 3 } : false}
                activeDot={{ r: 5, fill: chartConfig.color, stroke: '#0c1220', strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── OHLC Data Table ── */}
      {ohlcData.length > 0 && (
        <div className="glass-card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-app-text2">
              Datos OHLC Diarios
              <span className="text-[10px] text-app-text4 ml-1.5 font-mono">({ohlcData.length} días)</span>
            </h3>
          </div>
          <div className="overflow-x-auto max-h-48 overflow-y-auto custom-scrollbar">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-app-card z-10">
                <tr className="border-b border-app-border/60">
                  <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider font-medium text-app-text3">Fecha</th>
                  <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider font-medium text-app-text3">Open</th>
                  <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider font-medium text-app-text3">High</th>
                  <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider font-medium text-app-text3">Low</th>
                  <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider font-medium text-app-text3">Close</th>
                  <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider font-medium text-app-text3">TEM</th>
                  <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider font-medium text-app-text3">Vol</th>
                  <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider font-medium text-app-text3">Ticks</th>
                </tr>
              </thead>
              <tbody>
                {[...ohlcData].reverse().map((d) => (
                  <tr key={d.id} className="border-b border-app-border/30 table-row-highlight">
                    <td className="px-3 py-2 font-mono text-app-text3">{formatDate(d.date)}</td>
                    <td className="px-3 py-2 font-mono text-app-text2 text-right">{d.open.toFixed(4)}</td>
                    <td className="px-3 py-2 font-mono text-app-text3 text-right">{d.high.toFixed(4)}</td>
                    <td className="px-3 py-2 font-mono text-app-text3 text-right">{d.low.toFixed(4)}</td>
                    <td className="px-3 py-2 font-mono text-app-text2 text-right">{d.close.toFixed(4)}</td>
                    <td className="px-3 py-2 font-mono text-right">
                      <span className={`${d.closeTEM >= d.openTEM ? 'text-[#2eebc8]' : 'text-[#f87171]'}`}>
                        {d.closeTEM.toFixed(2)}%
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-app-text4 text-right">{formatVolume(d.avgVolume)}</td>
                    <td className="px-3 py-2 font-mono text-app-text4 text-right">{d.tickCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Info Banner ── */}
      <div className="glass-card p-3">
        <div className="flex items-start gap-2">
          <span className="text-sm">💡</span>
          <div className="text-[10px] text-app-text4 leading-relaxed">
            <strong className="text-app-text3">Módulo de Acumulación V3.2</strong> — Los datos históricos se acumulan automáticamente cuando el Cerebro Táctico corre en modo daemon (<code className="px-1 py-0.5 bg-app-subtle/60 rounded text-[#2eebc8] font-mono">npm run prices:daemon</code>). Cada tick genera un PriceSnapshot y se agrega un DailyOHLC por día por ticker. Los snapshots se limpian automáticamente después de 7 días; los OHLC se conservan indefinidamente.
          </div>
        </div>
      </div>
    </div>
  );
}
