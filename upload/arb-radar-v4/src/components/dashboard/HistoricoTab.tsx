'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { Instrument } from '@/lib/types';
import { formatPriceAxis, formatTEMAxis, formatSpreadAxis, formatVolumeAxis, formatPriceTooltip, formatTEMTooltip, formatSpreadTooltip } from '@/lib/chart-formatters';
import { useRadarStore, type OHLCRecord, type SnapshotRecord, type TickerInfo } from '@/lib/store';

type ChartMode = 'area' | 'bar';
type DateRange = 7 | 15 | 20 | 30 | 60 | 90 | 999;

interface HistoricoTabProps {
  instruments: Instrument[];
}

const VOL_CEILING = 20_000_000;

// FIX 1: Filtro de volumen sin romper fechas del histórico pasado
function filterVolume<T extends { volume: number; iolVolume?: number; timestamp?: string }>(data: T[]): T[] {
  return data.map(d => {
    const volOver = d.volume > VOL_CEILING;
    const iolOver = (d.iolVolume ?? 0) > VOL_CEILING;
    
    let preMarket = false;
    if (d.timestamp) {
      const recDate = new Date(d.timestamp);
      // Evaluamos según la hora nativa de SU propio día
      if (recDate.getHours() < 10) {
        preMarket = true;
      }
    }

    return {
      ...d,
      volume: (volOver || preMarket) ? 0 : d.volume,
      iolVolume: (iolOver || preMarket) ? 0 : d.iolVolume,
    };
  });
}

function formatDate(dateStr: string): string {
  if (dateStr.includes('-')) {
    const parts = dateStr.split('-');
    return `${parts[2]}/${parts[1]}`;
  }
  return dateStr;
}

export default function HistoricoTab({ instruments }: HistoricoTabProps) {
  // Selectores de Zustand
  const lastGoodOhlc = useRadarStore(s => s.historicoCache.lastGoodOhlc);
  const lastGoodSnapshots = useRadarStore(s => s.historicoCache.lastGoodSnapshots);
  const selectedTicker = useRadarStore(s => s.historicoCache.selectedTicker);
  const isUserSelected = useRadarStore(s => s.historicoCache.isUserSelected);
  const storeTickers = useRadarStore(s => s.historicoCache.tickers);
  const dateRange = useRadarStore(s => s.historicoCache.dateRange) as DateRange;
  const setHistoricoCache = useRadarStore(s => s.setHistoricoCache);

  // Estados UI locales
  const [chartMode, setChartMode] = useState<ChartMode>('area');
  const [loading, setLoading] = useState(false);

  // FIX 2: Mantener SWR. No vaciar datos viejos prematuramente para evitar parpadeos
  const handleTickerChange = useCallback((ticker: string) => {
    setHistoricoCache({
      selectedTicker: ticker,
      isUserSelected: true
    });
  }, [setHistoricoCache]);

  const handleDateRangeChange = useCallback((days: DateRange) => {
    setHistoricoCache({ dateRange: days });
  }, [setHistoricoCache]);

  // Obtener tickers disponibles en el montado
  useEffect(() => {
    let cancelled = false;
    async function fetchTickers() {
      try {
        const res = await fetch('/api/price-history?type=tickers');
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          const newTickers: TickerInfo[] = data.tickers || [];
          setHistoricoCache({ tickers: newTickers });
          if (newTickers.length > 0) {
            const st = useRadarStore.getState().historicoCache;
            if (!st.isUserSelected && !st.selectedTicker) {
              setHistoricoCache({ selectedTicker: newTickers[0].ticker });
            }
          }
        }
      } catch { /* ... */ }
    }
    fetchTickers();
    return () => { cancelled = true; };
  }, [setHistoricoCache]);

  const availableTickers = useMemo(() => {
    if (storeTickers.length > 0) return storeTickers;
    return instruments.map(i => ({
      ticker: i.ticker, count: 0, latestDate: '', latestClose: i.price,
    })).sort((a, b) => a.ticker.localeCompare(b.ticker));
  }, [storeTickers, instruments]);

  useEffect(() => {
    if (!isUserSelected && !selectedTicker && availableTickers.length > 0) {
      setHistoricoCache({ selectedTicker: availableTickers[0].ticker });
    }
  }, [availableTickers, isUserSelected, selectedTicker, setHistoricoCache]);

  // Fetch de los datos históricos de la API
  useEffect(() => {
    if (!selectedTicker) return;
    let cancelled = false;

    async function fetchData() {
      setLoading(true);
      try {
        const effectiveDays = dateRange === 999 ? 3650 : dateRange;
        const [ohlcRes, snapRes] = await Promise.all([
          fetch(`/api/price-history?type=ohlc&ticker=${encodeURIComponent(selectedTicker)}&days=${effectiveDays}`),
          fetch(`/api/price-history?type=snapshots&ticker=${encodeURIComponent(selectedTicker)}&hours=${effectiveDays * 24}`),
        ]);

        if (cancelled) return;

        // Si la respuesta es exitosa actualizamos el caché, si viene vacío reseteamos limpiamente
        const ohlcJson = ohlcRes.ok ? await ohlcRes.json() : {};
        const snapJson = snapRes.ok ? await snapRes.json() : {};

        setHistoricoCache({ 
          lastGoodOhlc: ohlcJson.ohlc || [],
          lastGoodSnapshots: snapJson.snapshots || []
        });

      } catch (err) {
        console.error('Error fetching history:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchData();
    return () => { cancelled = true; };
  }, [selectedTicker, dateRange, setHistoricoCache]);

  // Transformación inmutable de datos para Recharts
  const chartData = useMemo(() => {
    if (lastGoodOhlc.length > 0) {
      return filterVolume(lastGoodOhlc.map(d => ({
        date: formatDate(d.date),
        price: d.close,
        tem: d.temClose,
        spread: d.spreadAvg,
        volume: d.volume,
        iolVolume: d.iolVolume,
        high: d.high,
        low: d.low,
        open: d.open,
      })));
    }
    if (lastGoodSnapshots.length > 0) {
      return filterVolume(lastGoodSnapshots
        .slice().sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
        .map(s => ({
          date: new Date(s.timestamp).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
          price: s.price,
          tem: s.tem,
          spread: s.spread,
          volume: s.volume,
          iolVolume: s.iolVolume,
          timestamp: s.timestamp,
        })));
    }
    return [];
  }, [lastGoodOhlc, lastGoodSnapshots]);

  // FIX 3: Cálculo puro y desacoplado del instrumento. Cero loops de renders infinitos.
  const selectedInstrument = useMemo(() => {
    return instruments.find(i => i.ticker === selectedTicker) || null;
  }, [instruments, selectedTicker]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-light text-app-text mb-1">📈 Histórico de Precios</h2>
          <p className="text-sm text-app-text3">Evolución real sin bloqueos de ciclo · V4.2.3</p>
        </div>
        {loading && <div className="text-xs text-[#2eebc8] animate-pulse font-mono">⌛ CARGANDO...</div>}
      </div>

      {/* Selector de Tickers */}
      <div className="glass-card p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <select
              value={selectedTicker}
              onChange={e => handleTickerChange(e.target.value)}
              className="appearance-none bg-black text-white border border-white/20 rounded-lg px-4 py-2 text-sm font-mono pr-8 cursor-pointer focus:outline-none"
            >
              {availableTickers.map(t => (
                <option key={t.ticker} value={t.ticker} style={{ background: '#000', color: '#fff' }}>
                  {t.ticker} {t.count > 0 ? ` (${t.count}d)` : ''}
                </option>
              ))}
            </select>
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-white/40 text-xs pointer-events-none">▾</span>
          </div>

          <div className="flex items-center gap-1">
            {[{ mode: 'area' as ChartMode, label: 'Área', icon: '📈' }, { mode: 'bar' as ChartMode, label: 'Barras', icon: '📊' }].map(opt => (
              <button
                key={opt.mode}
                onClick={() => setChartMode(opt.mode)}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-medium ${
                  chartMode === opt.mode ? 'bg-[#2eebc8]/15 text-[#2eebc8] border border-[#2eebc8]/30' : 'bg-app-subtle/60 text-app-text3'
                }`}
              >
                {opt.icon} {opt.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1">
            {[7, 15, 20, 30, 60, 90, 999].map(days => (
              <button
                key={days}
                onClick={() => handleDateRangeChange(days as DateRange)}
                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-mono ${
                  dateRange === days ? 'bg-[#22d3ee]/10 text-[#22d3ee] border border-[#22d3ee]/30' : 'bg-app-subtle/60 text-app-text3'
                }`}
              >
                {days === 999 ? 'ALL' : `${days}d`}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Renderizado de Gráficos */}
      {chartData.length === 0 ? (
        <div className="glass-card p-8 text-center border border-dashed border-white/10">
          <p className="text-sm text-app-text3">{loading ? 'Solicitando datos históricos...' : 'Sin registros para este ticker'}</p>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="glass-card p-5">
            <h3 className="text-sm font-medium text-app-text2 mb-3">Precio de Cierre ({selectedTicker})</h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                {chartMode === 'area' ? (
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#2eebc8" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#2eebc8" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#6b7280' }} />
                    <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} tickFormatter={formatPriceAxis} domain={['auto', 'auto']} />
                    <Area type="monotone" dataKey="price" stroke="#2eebc8" fill="url(#priceGradient)" strokeWidth={2} />
                  </AreaChart>
                ) : (
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#6b7280' }} />
                    <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} tickFormatter={formatPriceAxis} domain={['auto', 'auto']} />
                    <Bar dataKey="price" fill="#2eebc8" radius={[2, 2, 0, 0]} />
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>
          </div>

          <div className="glass-card p-5">
            <h3 className="text-sm font-medium text-app-text2 mb-3">TEM (Tasa Efectiva Mensual)</h3>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="temGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f472b6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#f472b6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#6b7280' }} />
                  <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} tickFormatter={v => formatTEMAxis(v * 100)} domain={['auto', 'auto']} />
                  <Area type="monotone" dataKey="tem" stroke="#f472b6" fill="url(#temGradient)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}