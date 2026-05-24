'use client';

import React, { useMemo } from 'react';
import type { Instrument, Config, CockpitScore, LiveInstrument } from '@/lib/types';
import { useRadarStore } from '@/lib/store';
import { TrendingUp, TrendingDown, Minus, Target, Zap } from 'lucide-react';

interface CockpitTabProps {
  instruments: Instrument[];
  config: Config;
  cockpitScores: CockpitScore[];
  liveDataMap: Map<string, LiveInstrument>;
  isLive: boolean;
}

const VERDICT_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  SALTO_TACTICO: { label: '⚡ SALTO TÁCTICO', color: '#f87171', bg: 'rgba(248,113,113,0.12)' },
  PUNTO_CARAMELO: { label: '🍬 PUNTO CARAMELO', color: '#fbbf24', bg: 'rgba(251,191,36,0.12)' },
  ATRACTIVO: { label: 'ATRACTIVO', color: '#2eebc8', bg: 'rgba(46,235,200,0.08)' },
  NEUTRAL: { label: 'NEUTRAL', color: '#94a3b8', bg: 'rgba(148,163,184,0.06)' },
  EVITAR: { label: 'EVITAR', color: '#6b7280', bg: 'rgba(107,114,128,0.06)' },
};

const MICRO_BAR_COLORS: Record<string, string> = {
  spreadNeto: '#2eebc8', deltaTIR: '#f472b6', presion: '#a78bfa', upside: '#fbbf24', velocidad: '#6b7280',
};

const HORIZON_OPTIONS = [
  { value: 20, label: '20d' }, { value: 30, label: '30d' }, { value: 45, label: '45d' },
  { value: 60, label: '60d' }, { value: 9999, label: 'ALL' },
];

function fmtNum(n: number, d = 2): string { return n.toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d }); }
function fmtPct(n: number, d = 2): string { return `${n >= 0 ? '+' : ''}${fmtNum(n, d)}%`; }

function MicroScoreBar({ value, color }: { value: number; color: string }) {
  const scale = Math.min(value / 10, 1);
  return (
    <div className="micro-score-bar-track" style={{ height: '2px' }}>
      <div className="micro-score-bar-fill" style={{ backgroundColor: color, transform: `scaleX(${scale})`, transformOrigin: 'left center' }} />
    </div>
  );
}

export default function CockpitTab({ instruments, config, cockpitScores, liveDataMap, isLive }: CockpitTabProps) {
  const [horizon, setHorizon] = React.useState(45);

  const filteredScores = useMemo(() => {
    return horizon === 9999 ? cockpitScores : cockpitScores.filter(s => s.days <= horizon);
  }, [cockpitScores, horizon]);

  const sortedScores = useMemo(() => {
    return [...filteredScores].sort((a, b) => b.cockpitScore - a.cockpitScore);
  }, [filteredScores]);

  const elGritoScores = useMemo(() => {
    return sortedScores.filter(s => s.verdict === 'SALTO_TACTICO' || s.verdict === 'PUNTO_CARAMELO');
  }, [sortedScores]);

  const instrumentMap = useMemo(() => {
    const map = new Map<string, Instrument>();
    for (const inst of instruments) map.set(inst.ticker, inst);
    return map;
  }, [instruments]);

  const summary = useMemo(() => ({
    total: filteredScores.length,
    salto: filteredScores.filter(s => s.verdict === 'SALTO_TACTICO').length,
    caramelo: filteredScores.filter(s => s.verdict === 'PUNTO_CARAMELO').length,
    atractivo: filteredScores.filter(s => s.verdict === 'ATRACTIVO').length,
    neutral: filteredScores.filter(s => s.verdict === 'NEUTRAL').length,
    evitar: filteredScores.filter(s => s.verdict === 'EVITAR').length,
  }), [filteredScores]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-light text-foreground mb-1">🎯 Cockpit Táctico — V5.0 SCANNER</h2>
          <p className="text-sm text-muted-foreground">Señal compuesta · 5 factores · Horizonte: {HORIZON_OPTIONS.find(h => h.value === horizon)?.label}</p>
        </div>
        {isLive && (
          <span className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-primary/10 text-[10px] text-primary">
            <span className="live-dot" /> LIVE
          </span>
        )}
      </div>

      {/* Summary Bar */}
      <div className="glass-card px-4 py-2.5 animate-fadeInUp overflow-x-auto scrollbar-hide">
        <div className="flex items-center gap-3 min-w-max text-xs">
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground uppercase tracking-wider text-[10px]">Instrumentos</span>
            <span className="font-mono font-bold text-foreground">{summary.total}</span>
          </div>
          <div className="w-px h-3 bg-border/40" />
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wider text-[#f87171]">⚡ Salto</span>
            <span className="font-mono font-bold text-[#f87171]">{summary.salto}</span>
          </div>
          <div className="w-px h-3 bg-border/40" />
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wider text-[#fbbf24]">🍬 Caramelo</span>
            <span className="font-mono font-bold text-[#fbbf24]">{summary.caramelo}</span>
          </div>
          <div className="w-px h-3 bg-border/40" />
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground uppercase tracking-wider text-[10px]">Atractivo</span>
            <span className="font-mono font-bold text-primary">{summary.atractivo}</span>
          </div>
        </div>
      </div>

      {/* Horizon Filter */}
      <div className="flex items-center gap-2 animate-fadeInUp">
        <span className="text-muted-foreground text-[10px] uppercase tracking-wider">Horizonte</span>
        <div className="flex items-center gap-1">
          {HORIZON_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setHorizon(opt.value)}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-mono font-semibold transition-all ${
                horizon === opt.value ? 'bg-primary/15 text-primary border border-primary/30' : 'bg-secondary/40 text-muted-foreground border border-transparent hover:bg-secondary/60 hover:text-foreground'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* El Grito Alert Card */}
      {elGritoScores.length > 0 && (
        <div className="el-grito-border p-0 animate-fadeInUp">
          <div className="relative z-10 rounded-2xl p-4" style={{ background: 'rgba(17,24,39,0.95)' }}>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-lg">🚨</span>
              <span className="text-sm font-semibold tracking-wide text-[#f87171]">EL GRITO</span>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">— Capa 1 Alert</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-2">
              {elGritoScores.slice(0, 5).map(s => {
                const vc = VERDICT_CONFIG[s.verdict];
                return (
                  <div key={s.ticker} className="flex items-center gap-2 px-3 py-2 rounded-lg border animate-fadeInUp" style={{ borderColor: `${vc.color}33`, background: vc.bg }}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-bold text-xs text-foreground truncate">{s.ticker}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold ${s.type === 'LECAP' ? 'bg-primary/10 text-primary' : 'bg-[#f472b6]/10 text-[#f472b6]'}`}>{s.type}</span>
                      </div>
                      <div className="font-mono text-[10px] mt-0.5" style={{ color: vc.color }}>{vc.label}</div>
                    </div>
                    <span className="font-mono font-bold text-lg shrink-0" style={{ color: vc.color }}>{s.cockpitScore.toFixed(1)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Main Table */}
      {sortedScores.length === 0 ? (
        <div className="glass-card p-8 text-center animate-fadeInUp">
          <div className="text-muted-foreground text-sm">Cargando señales de cockpit...</div>
        </div>
      ) : (
        <div className="glass-card animate-fadeInUp">
          <div className="table-header-enhanced px-4 py-2.5 grid grid-cols-[32px_1fr_80px_70px_80px_70px_1fr] gap-2 items-center text-[9px] text-muted-foreground uppercase tracking-wider font-medium">
            <span>#</span><span>Instrumento</span><span className="text-right">Precio</span><span className="text-right">TEM</span><span className="text-right">Spread Neto</span><span className="text-right">Score</span><span className="text-right">Veredicto</span>
          </div>
          <div className="divide-y divide-border/30 max-h-[600px] overflow-y-auto">
            {sortedScores.map((score, idx) => {
              const vc = VERDICT_CONFIG[score.verdict];
              const rank = idx + 1;
              const liveData = liveDataMap.get(score.ticker);
              const instData = instrumentMap.get(score.ticker);
              const price = liveData?.last_price ?? instData?.price ?? 0;
              const tem = instData?.tem ?? 0;

              return (
                <div key={`${score.ticker}-${score.type}`} className="table-row-highlight table-row-alt px-4 py-2 animate-row-in">
                  <div className="grid grid-cols-[32px_1fr_80px_70px_80px_70px_1fr] gap-2 items-center">
                    <div className={`rank-badge ${rank === 1 ? 'rank-1' : rank === 2 ? 'rank-2' : rank === 3 ? 'rank-3' : 'rank-default'} text-[10px]`}>{rank}</div>
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono font-bold text-xs text-foreground truncate">{score.ticker}</span>
                      <span className={`shrink-0 px-1.5 py-0.5 rounded text-[8px] font-bold ${score.type === 'LECAP' ? 'bg-primary/10 text-primary' : 'bg-[#f472b6]/10 text-[#f472b6]'}`}>{score.type}</span>
                    </div>
                    <div className="text-right font-mono text-xs text-foreground">{price > 0 ? fmtNum(price, 4) : '—'}</div>
                    <div className="text-right font-mono text-xs text-foreground">{fmtNum(tem, 2)}%</div>
                    <div className={`text-right font-mono text-xs font-semibold ${score.spreadNeto >= 0 ? 'text-primary' : 'text-[#f87171]'}`}>{fmtPct(score.spreadNeto, 3)}</div>
                    <div className="text-right"><span className="font-mono font-bold text-base" style={{ color: vc.color }}>{score.cockpitScore.toFixed(1)}</span></div>
                    <div className="flex justify-end"><span className="px-2 py-0.5 rounded-lg text-[9px] font-bold whitespace-nowrap" style={{ color: vc.color, background: vc.bg }}>{vc.label}</span></div>
                  </div>
                  {/* Context Row */}
                  <div className="mt-1.5 grid grid-cols-[32px_1fr] gap-2 items-start">
                    <div />
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="text-[9px] text-muted-foreground"><span className="text-foreground font-mono">{score.days}</span>d</span>
                      <span className="text-[9px] text-muted-foreground">ΔTIR <span className={`font-mono ${score.deltaTIR !== null ? (score.deltaTIR > 0 ? 'text-primary' : score.deltaTIR < -0.02 ? 'text-[#f87171]' : 'text-foreground') : 'text-muted-foreground'}`}>{score.deltaTIR !== null ? fmtPct(score.deltaTIR, 3) : '—'}</span></span>
                      <span className="text-[9px] text-muted-foreground">Presión <span className={`font-mono ${score.presionPuntas !== null ? (score.presionPuntas > 1.3 ? 'text-primary' : score.presionPuntas < 0.7 ? 'text-[#f87171]' : 'text-foreground') : 'text-muted-foreground'}`}>{score.presionPuntas !== null ? score.presionPuntas.toFixed(2) : '—'}</span></span>
                      <span className="text-[9px] text-muted-foreground">Upside <span className={`font-mono ${score.upsideCapital > 1 ? 'text-primary' : 'text-[#fbbf24]'}`}>+{fmtNum(score.upsideCapital, 2)}%</span></span>
                      <div className="flex items-center gap-1.5 ml-1">
                        <div className="flex flex-col gap-[3px]">
                          <MicroScoreBar value={score.spreadNetoScore} color={MICRO_BAR_COLORS.spreadNeto} />
                          <MicroScoreBar value={score.deltaTIRScore} color={MICRO_BAR_COLORS.deltaTIR} />
                          <MicroScoreBar value={score.presionPuntasScore} color={MICRO_BAR_COLORS.presion} />
                          <MicroScoreBar value={score.upsideCapitalScore} color={MICRO_BAR_COLORS.upside} />
                          <MicroScoreBar value={score.velocidadScore} color={MICRO_BAR_COLORS.velocidad} />
                        </div>
                        <div className="flex flex-col gap-[3px] text-[7px] text-muted-foreground leading-none">
                          <span>Sp</span><span>ΔT</span><span>Pr</span><span>Up</span><span>Ve</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Weight Legend */}
      {sortedScores.length > 0 && (
        <div className="flex items-center gap-4 flex-wrap text-[9px] text-muted-foreground animate-fadeInUp">
          <span className="uppercase tracking-wider font-medium">Pesos:</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm" style={{ background: MICRO_BAR_COLORS.spreadNeto }} /> Spread 25%</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm" style={{ background: MICRO_BAR_COLORS.deltaTIR }} /> ΔTIR 25%</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm" style={{ background: MICRO_BAR_COLORS.presion }} /> Presión 20%</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm" style={{ background: MICRO_BAR_COLORS.upside }} /> Upside 20%</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm" style={{ background: MICRO_BAR_COLORS.velocidad }} /> Velocidad 10%</span>
        </div>
      )}
    </div>
  );
}
