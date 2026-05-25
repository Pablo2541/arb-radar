'use client';

import React, { useMemo } from 'react';
import type { Instrument, Config, CockpitScore, ScannerSortKey, ScannerViewMode, LiveInstrument } from '@/lib/types';
import { spreadVsCaucion } from '@/lib/calculations';
import { useRadarStore } from '@/lib/store';
import { ArrowUpDown, Grid3x3, List, LayoutGrid, Search, Zap, Target, TrendingUp, Clock, BarChart3 } from 'lucide-react';

interface ScannerGridProps {
  instruments: Instrument[];
  config: Config;
  cockpitScores: CockpitScore[];
  liveDataMap: Map<string, LiveInstrument>;
  isLive: boolean;
}

const HORIZON_OPTIONS = [
  { value: 20, label: '20d', desc: 'Ultra Scalp' },
  { value: 30, label: '30d', desc: 'Scalping' },
  { value: 45, label: '45d', desc: 'Scalp Ext.' },
  { value: 60, label: '60d', desc: 'Swing' },
  { value: 9999, label: 'ALL', desc: 'Todo' },
];

function getHeatmapClass(score: number): string {
  if (score >= 7.5) return 'heatmap-hot';
  if (score >= 5.0) return 'heatmap-warm';
  if (score >= 3.0) return 'heatmap-cool';
  return 'heatmap-cold';
}

function getVerdictBadge(verdict: string): { class: string; label: string; emoji: string } {
  switch (verdict) {
    case 'SALTO_TACTICO': return { class: 'verdict-salto', label: '⚡ SALTO', emoji: '⚡' };
    case 'PUNTO_CARAMELO': return { class: 'verdict-caramelo', label: '🍬 CARAMELO', emoji: '🍬' };
    case 'ATRACTIVO': return { class: 'verdict-atractivo', label: 'ATRACTIVO', emoji: '✓' };
    case 'NEUTRAL': return { class: 'verdict-neutral', label: 'NEUTRAL', emoji: '—' };
    default: return { class: 'verdict-evitar', label: 'EVITAR', emoji: '✗' };
  }
}

function fmtNum(n: number, d = 2): string {
  return n.toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d });
}

function fmtPct(n: number, d = 2): string {
  return `${n >= 0 ? '+' : ''}${fmtNum(n, d)}%`;
}

export default function ScannerGrid({ instruments, config, cockpitScores, liveDataMap, isLive }: ScannerGridProps) {
  const scannerSortKey = useRadarStore(s => s.scannerSortKey);
  const scannerViewMode = useRadarStore(s => s.scannerViewMode);
  const scannerHorizon = useRadarStore(s => s.scannerHorizon);
  const scannerSearchText = useRadarStore(s => s.scannerSearchText);
  const setScannerSortKey = useRadarStore(s => s.setScannerSortKey);
  const setScannerViewMode = useRadarStore(s => s.setScannerViewMode);
  const setScannerHorizon = useRadarStore(s => s.setScannerHorizon);
  const setScannerSearchText = useRadarStore(s => s.setScannerSearchText);

  const scoreMap = useMemo(() => {
    const map = new Map<string, CockpitScore>();
    for (const s of cockpitScores) map.set(s.ticker, s);
    return map;
  }, [cockpitScores]);

  const enrichedData = useMemo(() => {
    return instruments
      .map(inst => {
        const score = scoreMap.get(inst.ticker);
        const live = liveDataMap.get(inst.ticker);
        const spread = spreadVsCaucion(inst.tem, config, inst.days);
        const price = live?.last_price ?? inst.price;
        const change = live?.change_pct ?? inst.change;
        const volume = inst.iolVolume || inst.data912Volume || live?.volume || 0;
        const deltaTIR = score?.deltaTIR ?? live?.delta_tir != null ? (live!.delta_tir! * 100) : null;
        const iolPressure = inst.iolMarketPressure ?? live?.iol_market_pressure ?? null;

        return {
          ticker: inst.ticker,
          type: inst.type,
          days: inst.days,
          price,
          tem: inst.tem,
          change,
          spreadNeto: spread,
          cockpitScore: score?.cockpitScore ?? 0,
          verdict: score?.verdict ?? 'NEUTRAL',
          deltaTIR,
          iolMarketPressure: iolPressure,
          volume,
          withinHorizon: inst.days <= scannerHorizon,
        };
      })
      .filter(d => d.withnerHorizon || scannerHorizon === 9999)
      .filter(d => !scannerSearchText || d.ticker.toLowerCase().includes(scannerSearchText.toLowerCase()));
  }, [instruments, scoreMap, liveDataMap, config, scannerHorizon, scannerSearchText]);

  const sortedData = useMemo(() => {
    const sorted = [...enrichedData];
    sorted.sort((a, b) => {
      let aVal: number, bVal: number;
      switch (scannerSortKey) {
        case 'tem': aVal = a.tem; bVal = b.tem; break;
        case 'change': aVal = a.change; bVal = b.change; break;
        case 'spreadNeto': aVal = a.spreadNeto; bVal = b.spreadNeto; break;
        case 'cockpitScore': aVal = a.cockpitScore; bVal = b.cockpitScore; break;
        case 'volume': aVal = a.volume; bVal = b.volume; break;
        case 'deltaTIR': aVal = a.deltaTIR ?? 0; bVal = b.deltaTIR ?? 0; break;
        case 'days': aVal = a.days; bVal = b.days; break;
        default: aVal = a.cockpitScore; bVal = b.cockpitScore;
      }
      return bVal - aVal;
    });
    return sorted;
  }, [enrichedData, scannerSortKey]);

  const summary = useMemo(() => ({
    total: enrichedData.length,
    salto: enrichedData.filter(d => d.verdict === 'SALTO_TACTICO').length,
    caramelo: enrichedData.filter(d => d.verdict === 'PUNTO_CARAMELO').length,
    atractivo: enrichedData.filter(d => d.verdict === 'ATRACTIVO').length,
  }), [enrichedData]);

  return (
    <div className="space-y-4">
      {/* Controls Bar */}
      <div className="glass-card px-4 py-3 animate-fadeInUp">
        <div className="flex items-center justify-between flex-wrap gap-3">
          {/* Left: Search + Sort */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input
                type="text"
                placeholder="Buscar ticker..."
                value={scannerSearchText}
                onChange={e => setScannerSearchText(e.target.value)}
                className="pl-8 pr-3 py-1.5 rounded-lg bg-secondary/50 border border-border/60 text-xs font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/40 focus:ring-1 focus:ring-primary/20 w-40"
              />
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-[9px] text-muted-foreground uppercase tracking-wider font-medium">Ordenar</span>
              {([
                { key: 'cockpitScore' as ScannerSortKey, icon: Target, label: 'Score' },
                { key: 'tem' as ScannerSortKey, icon: TrendingUp, label: 'TEM' },
                { key: 'change' as ScannerSortKey, icon: Zap, label: 'Δ%' },
                { key: 'spreadNeto' as ScannerSortKey, icon: BarChart3, label: 'Spread' },
                { key: 'volume' as ScannerSortKey, icon: BarChart3, label: 'Vol' },
              ]).map(opt => (
                <button
                  key={opt.key}
                  onClick={() => setScannerSortKey(opt.key)}
                  className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold transition-all ${
                    scannerSortKey === opt.key
                      ? 'bg-primary/15 text-primary border border-primary/30'
                      : 'bg-secondary/30 text-muted-foreground border border-transparent hover:text-foreground hover:bg-secondary/50'
                  }`}
                >
                  <opt.icon className="w-3 h-3" />
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Right: View Mode + Horizon */}
          <div className="flex items-center gap-3">
            {/* Horizon Filter */}
            <div className="flex items-center gap-1.5">
              <Clock className="w-3 h-3 text-muted-foreground" />
              {HORIZON_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setScannerHorizon(opt.value)}
                  className={`px-2 py-1 rounded-md text-[10px] font-mono font-semibold transition-all ${
                    scannerHorizon === opt.value
                      ? 'bg-primary/15 text-primary border border-primary/30'
                      : 'bg-secondary/30 text-muted-foreground border border-transparent hover:text-foreground'
                  }`}
                  title={opt.desc}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* View Mode */}
            <div className="flex items-center gap-1 border-l border-border/40 pl-3">
              {([
                { mode: 'heatmap' as ScannerViewMode, icon: Grid3x3, label: 'Heatmap' },
                { mode: 'table' as ScannerViewMode, icon: List, label: 'Tabla' },
                { mode: 'compact' as ScannerViewMode, icon: LayoutGrid, label: 'Compacto' },
              ]).map(opt => (
                <button
                  key={opt.mode}
                  onClick={() => setScannerViewMode(opt.mode)}
                  className={`p-1.5 rounded-md transition-all ${
                    scannerViewMode === opt.mode
                      ? 'bg-primary/15 text-primary'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                  title={opt.label}
                >
                  <opt.icon className="w-4 h-4" />
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Summary Row */}
        <div className="flex items-center gap-4 mt-2.5 pt-2.5 border-t border-border/30">
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] text-muted-foreground uppercase tracking-wider">Instrumentos</span>
            <span className="font-mono font-bold text-foreground text-xs">{summary.total}</span>
          </div>
          <div className="w-px h-3 bg-border/40" />
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wider text-[#f87171]">⚡ Salto</span>
            <span className="font-mono font-bold text-[#f87171] text-xs">{summary.salto}</span>
          </div>
          <div className="w-px h-3 bg-border/40" />
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wider text-[#fbbf24]">🍬 Caramelo</span>
            <span className="font-mono font-bold text-[#fbbf24] text-xs">{summary.caramelo}</span>
          </div>
          <div className="w-px h-3 bg-border/40" />
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wider text-[#2eebc8]">Atractivo</span>
            <span className="font-mono font-bold text-[#2eebc8] text-xs">{summary.atractivo}</span>
          </div>
          {isLive && (
            <>
              <div className="w-px h-3 bg-border/40" />
              <span className="flex items-center gap-1.5 text-[10px] text-primary">
                <span className="live-dot" />
                LIVE
              </span>
            </>
          )}
        </div>
      </div>

      {/* Scanner Content */}
      {scannerViewMode === 'heatmap' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 animate-fadeInUp">
          {sortedData.map((d, idx) => {
            const vb = getVerdictBadge(d.verdict);
            return (
              <div
                key={d.ticker}
                className={`scanner-cell ${getHeatmapClass(d.cockpitScore)} animate-fadeInUp`}
                style={{ animationDelay: `${Math.min(idx * 30, 300)}ms` }}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-mono font-bold text-xs text-foreground truncate">{d.ticker}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[7px] font-bold ${d.type === 'LECAP' ? 'bg-primary/10 text-primary' : 'bg-[#f472b6]/10 text-[#f472b6]'}`}>
                    {d.type}
                  </span>
                </div>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-mono text-[11px] text-foreground">{d.price > 0 ? fmtNum(d.price, 4) : '—'}</span>
                  <span className={`font-mono text-[10px] font-semibold ${d.change > 0 ? 'text-primary' : d.change < 0 ? 'text-[#f87171]' : 'text-muted-foreground'}`}>
                    {fmtPct(d.change, 2)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] text-muted-foreground">{d.tem.toFixed(2)}% TEM</span>
                  <span className="font-mono text-[10px] text-muted-foreground">{d.days}d</span>
                </div>
                {/* Score Bar */}
                <div className="mt-1.5 w-full h-1.5 bg-secondary/50 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.min(d.cockpitScore * 10, 100)}%`,
                      background: d.cockpitScore >= 7.5 ? '#2eebc8' : d.cockpitScore >= 5 ? '#fbbf24' : d.cockpitScore >= 3 ? '#64748b' : '#f87171',
                    }}
                  />
                </div>
                <div className="flex items-center justify-between mt-1">
                  <span className="font-mono text-[10px] font-bold" style={{ color: d.cockpitScore >= 7.5 ? '#2eebc8' : d.cockpitScore >= 5 ? '#fbbf24' : d.cockpitScore >= 3 ? '#94a3b8' : '#f87171' }}>
                    {d.cockpitScore.toFixed(1)}
                  </span>
                  <span className={`px-1.5 py-0.5 rounded text-[7px] font-bold ${vb.class}`}>
                    {vb.emoji} {vb.label}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {scannerViewMode === 'table' && (
        <div className="glass-card animate-fadeInUp">
          <div className="table-header-enhanced px-4 py-2.5 grid grid-cols-[1fr_60px_80px_70px_70px_80px_1fr] gap-2 items-center text-[9px] text-muted-foreground uppercase tracking-wider font-medium">
            <span>Instrumento</span>
            <span className="text-right">Días</span>
            <span className="text-right">Precio</span>
            <span className="text-right">TEM</span>
            <span className="text-right">Δ%</span>
            <span className="text-right">Spread</span>
            <span className="text-right">Score</span>
          </div>
          <div className="divide-y divide-border/30 max-h-[600px] overflow-y-auto">
            {sortedData.map((d, idx) => {
              const vb = getVerdictBadge(d.verdict);
              return (
                <div
                  key={d.ticker}
                  className="table-row-highlight table-row-alt px-4 py-2 animate-row-in"
                  style={idx >= 8 ? { contentVisibility: 'auto', containIntrinsicSize: '0 50px' } : undefined}
                >
                  <div className="grid grid-cols-[1fr_60px_80px_70px_70px_80px_1fr] gap-2 items-center">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-xs text-foreground">{d.ticker}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[7px] font-bold ${d.type === 'LECAP' ? 'bg-primary/10 text-primary' : 'bg-[#f472b6]/10 text-[#f472b6]'}`}>
                        {d.type}
                      </span>
                    </div>
                    <span className="text-right font-mono text-xs text-muted-foreground">{d.days}d</span>
                    <span className="text-right font-mono text-xs text-foreground">{d.price > 0 ? fmtNum(d.price, 4) : '—'}</span>
                    <span className="text-right font-mono text-xs text-foreground">{d.tem.toFixed(2)}%</span>
                    <span className={`text-right font-mono text-xs font-semibold ${d.change > 0 ? 'text-primary' : d.change < 0 ? 'text-[#f87171]' : 'text-muted-foreground'}`}>
                      {fmtPct(d.change, 2)}
                    </span>
                    <span className={`text-right font-mono text-xs font-semibold ${d.spreadNeto >= 0 ? 'text-primary' : 'text-[#f87171]'}`}>
                      {fmtPct(d.spreadNeto, 3)}
                    </span>
                    <div className="flex items-center justify-end gap-2">
                      <span className="font-mono font-bold text-sm" style={{ color: d.cockpitScore >= 7.5 ? '#2eebc8' : d.cockpitScore >= 5 ? '#fbbf24' : d.cockpitScore >= 3 ? '#94a3b8' : '#f87171' }}>
                        {d.cockpitScore.toFixed(1)}
                      </span>
                      <span className={`px-2 py-0.5 rounded-lg text-[8px] font-bold whitespace-nowrap ${vb.class}`}>
                        {vb.emoji} {vb.label}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {scannerViewMode === 'compact' && (
        <div className="glass-card p-2 animate-fadeInUp">
          <div className="flex flex-wrap gap-1.5">
            {sortedData.map((d) => {
              const vb = getVerdictBadge(d.verdict);
              const heatClass = getHeatmapClass(d.cockpitScore);
              return (
                <div
                  key={d.ticker}
                  className={`scanner-cell ${heatClass} flex items-center gap-1.5 px-2 py-1`}
                  title={`${d.ticker} | ${d.tem.toFixed(2)}% TEM | Score ${d.cockpitScore.toFixed(1)} | ${d.days}d`}
                >
                  <span className="font-mono font-bold text-[10px] text-foreground">{d.ticker}</span>
                  <span className={`font-mono text-[9px] font-bold ${d.change > 0 ? 'text-primary' : d.change < 0 ? 'text-[#f87171]' : 'text-muted-foreground'}`}>
                    {fmtPct(d.change, 1)}
                  </span>
                  <span className="font-mono text-[9px] font-bold" style={{ color: d.cockpitScore >= 7.5 ? '#2eebc8' : d.cockpitScore >= 5 ? '#fbbf24' : '#94a3b8' }}>
                    {d.cockpitScore.toFixed(1)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty State */}
      {sortedData.length === 0 && (
        <div className="glass-card p-12 text-center">
          <div className="text-muted-foreground text-sm">No hay instrumentos en el horizonte seleccionado</div>
          <div className="text-[10px] text-muted-foreground mt-1">Probá ampliando el filtro de horizonte</div>
        </div>
      )}
    </div>
  );
}
