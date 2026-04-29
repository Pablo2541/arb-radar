'use client';

import React, { useMemo, useState } from 'react';
import { Instrument, Config, Position, MomentumData, SRData, PriceHistoryFile, RotationScoreV17 } from '@/lib/types';
import {
  analyzeRotation,
  detectInversions,
  detectCurveAnomalies,
  spreadVsCaucion,
  calculateRotationScoreV17,
} from '@/lib/calculations';
import { calculateSR } from '@/lib/priceHistory';
import ChartContainer from './ChartContainer';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, ReferenceLine,
} from 'recharts';

interface ArbitrajeTabProps {
  instruments: Instrument[];
  config: Config;
  position: Position | null;
  momentumMap: Map<string, MomentumData>;
  priceHistory: PriceHistoryFile | null;
}

// V1.8.1 — Aggressive Verdict Types for Scalping de Bonos
type VerdictType = 'OPORTUNIDAD DE CAPTURA' | 'EJECUCIÓN RÁPIDA' | 'SALTO TÁCTICO' | 'POSICIÓN AGOTADA' | 'NO CONVIENE' | 'SIN POSICIÓN';

// V1.4.4 FIX: Handle null deltaTIR — V1.5 colors
function getTrendArrow(deltaTIR: number | null): { arrow: string; color: string } {
  if (deltaTIR === null) return { arrow: '', color: '#7a8599' };
  if (deltaTIR > 0.02) return { arrow: '↑', color: '#2eebc8' };
  if (deltaTIR < -0.02) return { arrow: '↓', color: '#f87171' };
  return { arrow: '', color: '#7a8599' };
}

// V1.4 — Mini sparkline SVG — V1.5 colors
function Sparkline({ data, width = 60, height = 24 }: { data: number[]; width?: number; height?: number }) {
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
      <circle cx={width} cy={lastY} r="2" fill={color} />
    </svg>
  );
}

// V1.7 — Capital Run Progress Bar
function CapitalRunBar({ upside, maxUpside = 2.0 }: { upside: number; maxUpside?: number }) {
  const pct = Math.min(100, Math.max(0, (upside / maxUpside) * 100));
  const color = upside > 1.0 ? '#2eebc8' : upside > 0.5 ? '#fbbf24' : upside > 0.1 ? '#fb923c' : '#f87171';
  const label = upside > 1.0 ? 'Aire' : upside > 0.5 ? 'Moderado' : upside > 0.1 ? 'Bajo' : 'Agotado';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 rounded-full bg-app-subtle/60 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <span className="text-[9px] font-mono shrink-0" style={{ color }}>
        {upside.toFixed(2)}%
      </span>
      <span className="text-[8px] text-app-text4 shrink-0 w-14 text-right">{label}</span>
    </div>
  );
}

// V1.8.6 — Hunting Score V2.0 Aggressive + Agotamiento Penalty
function calculateHuntingScoreV2(
  targetScore: RotationScoreV17,
  srData: SRData | undefined,
  _currentScore: RotationScoreV17 | null,
  targetInst: Instrument
): number {
  let score = 0;

  // 1. Upside de Capital (35%) — room to resistance ceiling
  score += Math.min(10, (targetScore.upsideCapital / 2.0) * 10) * 3.5;

  // 2. Momentum de Precio (35%) — price trending up + position within S/R range
  const priceChange = targetInst.change || 0;
  const momentumPts = Math.max(0, Math.min(10, (priceChange + 1) * 5));
  const distSoporte = srData?.distanciaSoporte ?? 50;
  let trendStrength = 0;
  if (distSoporte >= 0 && distSoporte < 1) trendStrength = 8;
  else if (distSoporte >= 1 && distSoporte < 3) trendStrength = 7;
  else if (distSoporte >= 3 && distSoporte < 5) trendStrength = 5;
  else trendStrength = 3;
  const combinedMomentum = (momentumPts * 0.5 + trendStrength * 0.5);
  score += combinedMomentum * 3.5;

  // 3. Carry / TEM (30%) — rate differential (reduced from 50%)
  const compressionPts = targetScore.temCompressionScore;
  score += compressionPts * 3.0;

  // V1.8.6: POSICIÓN AGOTADA penalty — if >90% of S/R channel, -2 points
  const posicionEnCanal = srData?.posicionEnCanal ?? 50;
  if (posicionEnCanal > 90) {
    score -= 2;
  }

  return Math.max(0, score); // Max ~100, min 0
}

// V1.8.6 — Aggressive Badge Types (includes POSICIÓN AGOTADA)
type JumpBadge = 'OPORTUNIDAD DE CAPTURA' | 'EJECUCIÓN RÁPIDA' | 'SALTO TÁCTICO' | 'POSICIÓN AGOTADA' | 'NO CONVIENE';

function getJumpBadge(
  _targetScore: RotationScoreV17,
  srData: SRData | undefined,
  _currentScore: RotationScoreV17 | null,
  _huntingScore: number,
  spreadNeto: number,
  paybackDays: number
): JumpBadge {
  // V1.8.6: POSICIÓN AGOTADA — if >90% of S/R channel, automatic exhaustion
  const posicionEnCanal = srData?.posicionEnCanal ?? 50;
  if (posicionEnCanal > 90) return 'POSICIÓN AGOTADA';

  if (isFinite(paybackDays) && paybackDays <= 2) return 'SALTO TÁCTICO';
  if (spreadNeto > 0.10) return 'OPORTUNIDAD DE CAPTURA';
  if (spreadNeto > 0.01) return 'EJECUCIÓN RÁPIDA';
  if (spreadNeto <= 0) return 'NO CONVIENE';
  return 'EJECUCIÓN RÁPIDA';
}

export default function ArbitrajeTab({ instruments, config, position, momentumMap, priceHistory }: ArbitrajeTabProps) {
  // ── V1.8.1: Rotation Simulation State ──
  const [arbRotationSim, setArbRotationSim] = useState<{ fromTicker: string; toTicker: string } | null>(null);

  // ── V1.7: S/R Data (15-day window) ──
  const srDataMap = useMemo(() => {
    if (!priceHistory) return new Map<string, SRData>();
    const srArray = calculateSR(priceHistory, instruments);
    return new Map(srArray.map(sr => [sr.ticker, sr]));
  }, [priceHistory, instruments]);

  // ── V1.7: Rotation Scores for ALL instruments ──
  const rotationScoresMap = useMemo(() => {
    const map = new Map<string, RotationScoreV17>();
    for (const inst of instruments) {
      const srData = srDataMap.get(inst.ticker);
      const momentum = momentumMap.get(inst.ticker);
      const score = calculateRotationScoreV17(inst, config, instruments, srData, momentum);
      map.set(inst.ticker, score);
    }
    return map;
  }, [instruments, config, srDataMap, momentumMap]);

  // ── V1.8.1: Hunting Scores V2 for ALL instruments ──
  const huntingScoresMap = useMemo(() => {
    const currentInst = position ? instruments.find(i => i.ticker === position.ticker) : null;
    const curScore = currentInst ? rotationScoresMap.get(currentInst.ticker) ?? null : null;
    const map = new Map<string, number>();
    for (const inst of instruments) {
      const tScore = rotationScoresMap.get(inst.ticker);
      if (!tScore) { map.set(inst.ticker, 0); continue; }
      const sr = srDataMap.get(inst.ticker);
      map.set(inst.ticker, calculateHuntingScoreV2(tScore, sr, curScore, inst));
    }
    return map;
  }, [instruments, position, rotationScoresMap, srDataMap]);

  // ── Rotation Analysis ──
  const currentInstrument = position
    ? instruments.find(i => i.ticker === position.ticker)
    : null;

  const currentScore = currentInstrument ? rotationScoresMap.get(currentInstrument.ticker) ?? null : null;

  // V1.8.1: Rotations sorted by Hunting Score (descending), NOT by spreadNeto
  const rotations = currentInstrument
    ? instruments
        .filter(i => i.ticker !== currentInstrument.ticker)
        .map(target => {
          const analysis = analyzeRotation(
            currentInstrument.tem,
            currentInstrument.days,
            target,
            config.comisionTotal
          );
          analysis.fromTicker = currentInstrument.ticker;
          return analysis;
        })
        .sort((a, b) => {
          const hA = huntingScoresMap.get(a.toTicker) ?? 0;
          const hB = huntingScoresMap.get(b.toTicker) ?? 0;
          return hB - hA;
        })
    : [];

  // ── Todos-contra-todos matrix ──
  const sortedByDays = [...instruments].sort((a, b) => a.days - b.days);

  // ── Anomaly Detection ──
  const inversions = detectInversions(instruments);
  const curveAnomalies = detectCurveAnomalies(instruments);

  // ── V1.3 — Tapados (Oportunidades en Desarrollo) ──
  const tapados = instruments.filter(inst => {
    const momentum = momentumMap.get(inst.ticker);
    return momentum?.esTapado === true;
  });

  // ── V1.8.1 — Oportunidades Maestras (aggressive filters) ──
  const averageTEM = instruments.reduce((s, i) => s + i.tem, 0) / (instruments.length || 1);

  const prevInCurve = new Map<string, Instrument | null>();
  sortedByDays.forEach((inst, idx) => {
    prevInCurve.set(inst.ticker, idx > 0 ? sortedByDays[idx - 1] : null);
  });

  const oportunidadesMaestras = instruments.filter(inst => {
    const momentum = momentumMap.get(inst.ticker);
    if (!momentum) return false;
    const spread = spreadVsCaucion(inst.tem, config, inst.days);
    const spreadNeto = spread - (config.comisionTotal / (inst.days / 30));

    // V1.8.1: Lowered threshold 0.12% -> 0.05%
    if (spreadNeto <= 0.05) return false;
    if (inst.tem <= averageTEM) return false;

    const prev = prevInCurve.get(inst.ticker);
    if (prev && inst.tem < prev.tem + 0.10) return false;

    return true;
  }).sort((a, b) => {
    const hA = huntingScoresMap.get(a.ticker) ?? 0;
    const hB = huntingScoresMap.get(b.ticker) ?? 0;
    return hB - hA;
  }).slice(0, 3);

  // ── V1.8.1: Scalping de Bonos Verdict ──
  let verdict: VerdictType = 'SIN POSICIÓN';
  let verdictReason = '';
  let verdictEmoji = '⚡';

  if (!currentInstrument) {
    verdict = 'SIN POSICIÓN';
    verdictReason = 'No hay posición activa. Seleccioná una posición en Cartera para activar el Scalping de Bonos.';
    verdictEmoji = '📋';
  } else if (currentScore?.isPositionExhausted) {
    verdict = 'POSICIÓN AGOTADA';
    verdictReason = `${currentInstrument.ticker} está pegado a su resistencia de 15 días. Upside de Capital: ${currentScore.upsideCapital.toFixed(2)}%. El bono no tiene recorrido de precio — buscar el próximo instrumento con upside residual.`;
    verdictEmoji = '🚨';
  } else if (rotations.length > 0) {
    const bestRotation = rotations[0];
    const bestTargetScore = rotationScoresMap.get(bestRotation.toTicker);
    const bestHuntingScore = huntingScoresMap.get(bestRotation.toTicker) ?? 0;

    const bestCarryDiario = bestRotation.toTEM / 30;
    const bestPaybackDays = bestCarryDiario > 0 ? config.comisionTotal / bestCarryDiario : Infinity;

    if (bestTargetScore && isFinite(bestPaybackDays) && bestPaybackDays <= 2) {
      verdict = 'SALTO TÁCTICO';
      verdictReason = `${bestRotation.toTicker}: Payback en ${bestPaybackDays.toFixed(0)} días. Upside +${bestTargetScore.upsideCapital.toFixed(2)}%, Spread Neto ${bestRotation.spreadNeto >= 0 ? '+' : ''}${bestRotation.spreadNeto.toFixed(3)}%. Captura inmediata de flujo de capital.`;
      verdictEmoji = '⚡';
    } else if (bestTargetScore && bestRotation.spreadNeto > 0.10 && bestTargetScore.upsideCapital > 0.1) {
      verdict = 'OPORTUNIDAD DE CAPTURA';
      verdictReason = `${bestRotation.toTicker}: Spread Neto ${bestRotation.spreadNeto >= 0 ? '+' : ''}${bestRotation.spreadNeto.toFixed(3)}%, Upside +${bestTargetScore.upsideCapital.toFixed(2)}%. Hunting Score: ${bestHuntingScore.toFixed(0)}/100. La captura de capital es clara.`;
      verdictEmoji = '🎯';
    } else if (bestRotation.spreadNeto > 0.01) {
      verdict = 'EJECUCIÓN RÁPIDA';
      verdictReason = `${bestRotation.toTicker}: Spread Neto ${bestRotation.spreadNeto >= 0 ? '+' : ''}${bestRotation.spreadNeto.toFixed(3)}%, Upside +${(bestTargetScore?.upsideCapital ?? 0).toFixed(2)}%. Hunting Score: ${bestHuntingScore.toFixed(0)}/100. Ejecución rápida si el flujo de capital lo justifica.`;
      verdictEmoji = '💨';
    } else {
      verdict = 'NO CONVIENE';
      verdictReason = `Ningún instrumento tiene spread neto positivo. Mejor Hunting Score: ${bestHuntingScore.toFixed(0)}/100 (${bestRotation.toTicker}). El capital busca flujo. Monitorear próximos movimientos de precio.`;
      verdictEmoji = '🚫';
    }
  }

  const currentSpread = currentInstrument
    ? spreadVsCaucion(currentInstrument.tem, config, currentInstrument.days)
    : 0;

  // ── V1.8.1: Propulsión de Capital Chart Data (Hunting Score V2) ──
  const rotationChartData = rotations.slice(0, 10).map(r => {
    const tScore = rotationScoresMap.get(r.toTicker);
    const hScore = huntingScoresMap.get(r.toTicker) ?? 0;
    const carryDiario = r.toTEM / 30;
    const paybackDays = carryDiario > 0 ? config.comisionTotal / carryDiario : Infinity;
    const badge = tScore ? getJumpBadge(tScore, srDataMap.get(r.toTicker), currentScore, hScore, r.spreadNeto, paybackDays) : 'NO CONVIENE';
    return {
      ticker: r.toTicker,
      huntingScore: parseFloat(hScore.toFixed(1)),
      badge,
    };
  });

  // ── V1.8.1: Badge Color Helpers ──
  const getBadgeColor = (badge: JumpBadge): string => {
    switch (badge) {
      case 'SALTO TÁCTICO': return '#22d3ee'; // cyan
      case 'OPORTUNIDAD DE CAPTURA': return '#2eebc8'; // verde
      case 'EJECUCIÓN RÁPIDA': return '#22d3ee'; // cyan
      case 'POSICIÓN AGOTADA': return '#f87171'; // rojo V1.8.6
      case 'NO CONVIENE': return '#f87171';
      default: return '#7a8599';
    }
  };

  const getBadgeEmoji = (badge: JumpBadge): string => {
    switch (badge) {
      case 'SALTO TÁCTICO': return '⚡';
      case 'OPORTUNIDAD DE CAPTURA': return '🎯';
      case 'EJECUCIÓN RÁPIDA': return '💨';
      case 'POSICIÓN AGOTADA': return '🚨'; // V1.8.6
      case 'NO CONVIENE': return '🚫';
      default: return '⚪';
    }
  };

  const getBadgeClass = (badge: JumpBadge): string => {
    switch (badge) {
      case 'SALTO TÁCTICO': return 'bg-[#22d3ee]/15 text-[#22d3ee] border-[#22d3ee]/40'; // V1.8.6: brighter
      case 'OPORTUNIDAD DE CAPTURA': return 'bg-[#2eebc8]/15 text-[#2eebc8] border-[#2eebc8]/40';
      case 'EJECUCIÓN RÁPIDA': return 'bg-[#22d3ee]/15 text-[#22d3ee] border-[#22d3ee]/40';
      case 'POSICIÓN AGOTADA': return 'bg-[#f87171]/15 text-[#f87171] border-[#f87171]/40'; // V1.8.6
      case 'NO CONVIENE': return 'bg-[#f87171]/10 text-[#f87171] border-[#f87171]/30';
      default: return 'bg-app-subtle text-app-text3 border-app-border';
    }
  };

  const getVerdictBg = (v: VerdictType) => {
    switch (v) {
      case 'SALTO TÁCTICO': return 'bg-[#22d3ee]/8 border-[#22d3ee]/30';
      case 'OPORTUNIDAD DE CAPTURA': return 'bg-[#2eebc8]/8 border-[#2eebc8]/30';
      case 'EJECUCIÓN RÁPIDA': return 'bg-[#22d3ee]/8 border-[#22d3ee]/30';
      case 'POSICIÓN AGOTADA': return 'bg-[#f87171]/8 border-[#f87171]/30';
      case 'NO CONVIENE': return 'bg-[#f87171]/8 border-[#f87171]/30';
      case 'SIN POSICIÓN': return 'bg-app-subtle border-app-border';
      default: return 'bg-app-subtle border-app-border';
    }
  };

  const getVerdictColor = (v: VerdictType) => {
    switch (v) {
      case 'SALTO TÁCTICO': return '#22d3ee';
      case 'OPORTUNIDAD DE CAPTURA': return '#2eebc8';
      case 'EJECUCIÓN RÁPIDA': return '#22d3ee';
      case 'POSICIÓN AGOTADA': return '#f87171';
      case 'NO CONVIENE': return '#f87171';
      case 'SIN POSICIÓN': return '#7a8599';
      default: return '#7a8599';
    }
  };

  const chartGridStroke = 'rgba(128, 128, 128, 0.12)';
  const chartTickFill = 'rgba(128, 128, 128, 0.5)';
  const chartLabelFill = 'rgba(128, 128, 128, 0.5)';
  const tooltipBg = '#111827';
  const tooltipBorder = '#374151';

  // V1.8.1: Calculate combined momentum score for current position
  const currentMomentumScore = (() => {
    if (!currentInstrument || !currentScore) return 0;
    const priceChange = currentInstrument.change || 0;
    const momentumPts = Math.max(0, Math.min(10, (priceChange + 1) * 5));
    const sr = srDataMap.get(currentInstrument.ticker);
    const distSoporte = sr?.distanciaSoporte ?? 50;
    let trendStrength = 0;
    if (distSoporte >= 0 && distSoporte < 1) trendStrength = 8;
    else if (distSoporte >= 1 && distSoporte < 3) trendStrength = 7;
    else if (distSoporte >= 3 && distSoporte < 5) trendStrength = 5;
    else trendStrength = 3;
    return momentumPts * 0.5 + trendStrength * 0.5;
  })();

  // Suppress unused variable warnings
  void arbRotationSim;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-light text-app-text mb-1">⚡ Scalping de Bonos</h2>
        <p className="text-sm text-app-text3">Modo Agresivo — Capturá el flujo de capital — V1.8.6</p>
      </div>

      {/* ── V1.8.1: Position Capital Status (quick widget) ── */}
      {currentInstrument && currentScore && (
        <div className="glass-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-sm">📊</span>
            <h3 className="text-xs font-medium text-app-text2 uppercase tracking-wider">Estado de Capital — {currentInstrument.ticker}</h3>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-app-subtle/30 rounded-lg p-3 border border-app-border/40">
              <div className="text-[8px] text-app-text4 uppercase tracking-wider mb-1">Upside de Capital</div>
              <div className={`font-mono font-bold text-base ${currentScore.upsideCapital > 0.5 ? 'text-[#2eebc8]' : currentScore.upsideCapital > 0.1 ? 'text-[#fbbf24]' : 'text-[#f87171]'}`}>
                +{currentScore.upsideCapital.toFixed(2)}%
              </div>
              <CapitalRunBar upside={currentScore.upsideCapital} />
            </div>
            <div className="bg-app-subtle/30 rounded-lg p-3 border border-app-border/40">
              <div className="text-[8px] text-app-text4 uppercase tracking-wider mb-1">Momentum de Precio</div>
              <div className={`font-mono font-bold text-base ${
                currentMomentumScore >= 7 ? 'text-[#2eebc8]' :
                currentMomentumScore >= 4 ? 'text-[#fbbf24]' :
                'text-[#f87171]'
              }`}>
                {currentMomentumScore.toFixed(1)}/10
              </div>
              <div className="text-[9px] text-app-text4 mt-1">
                ΔPrecio: {((currentInstrument.change || 0) >= 0 ? '+' : '')}{(currentInstrument.change || 0).toFixed(2)}% · S/R: {Math.min(100, srDataMap.get(currentInstrument.ticker)?.distanciaSoporte ?? 0).toFixed(1)}%
              </div>
            </div>
            <div className="bg-app-subtle/30 rounded-lg p-3 border border-app-border/40">
              <div className="text-[8px] text-app-text4 uppercase tracking-wider mb-1">Score Táctico</div>
              <div className={`font-mono font-bold text-base ${
                currentScore.tacticalScore >= 7 ? 'text-[#2eebc8]' :
                currentScore.tacticalScore >= 4.5 ? 'text-[#fbbf24]' :
                'text-[#f87171]'
              }`}>
                {currentScore.tacticalScore.toFixed(1)}/10
              </div>
              <div className="text-[9px] text-app-text4 mt-1">
                Comp: {currentScore.compositeScore.toFixed(1)} · Run: {currentScore.capitalRunScore.toFixed(1)} · TEM: {currentScore.temCompressionScore.toFixed(1)}
              </div>
            </div>
            <div className="bg-app-subtle/30 rounded-lg p-3 border border-app-border/40">
              <div className="text-[8px] text-app-text4 uppercase tracking-wider mb-1">Rango 15d S/R</div>
              <div className="flex items-baseline gap-1">
                <span className="font-mono text-[11px] text-[#2eebc8]">
                  ${srDataMap.get(currentInstrument.ticker)?.soporte.toFixed(4) ?? '—'}
                </span>
                <span className="text-app-text4 text-[9px]">/</span>
                <span className="font-mono text-[11px] text-[#f87171]">
                  ${srDataMap.get(currentInstrument.ticker)?.resistencia.toFixed(4) ?? '—'}
                </span>
              </div>
              <div className="text-[9px] text-app-text4 mt-1">
                Upside Residual: +{Math.min(100, srDataMap.get(currentInstrument.ticker)?.distanciaResistencia ?? 0).toFixed(2)}%
              </div>
              <div className="text-[9px] mt-0.5">
                <span className="text-app-text4">Canal: </span>
                <span className={`font-mono font-medium ${
                  (srDataMap.get(currentInstrument.ticker)?.posicionEnCanal ?? 0) > 90 ? 'text-[#f87171]' :
                  (srDataMap.get(currentInstrument.ticker)?.posicionEnCanal ?? 0) > 70 ? 'text-[#fbbf24]' :
                  'text-[#2eebc8]'
                }`}>
                  {(srDataMap.get(currentInstrument.ticker)?.posicionEnCanal ?? 0).toFixed(0)}%
                </span>
                {(srDataMap.get(currentInstrument.ticker)?.posicionEnCanal ?? 0) > 90 && (
                  <span className="ml-1 text-[8px] text-[#f87171] font-bold">🚨 AGOTADA</span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── V1.8.1 — Oportunidades Maestras (Aggressive) ── */}
      {oportunidadesMaestras.length > 0 && (
        <div className="rounded-xl border-2 border-app-accent/40 bg-app-accent-dim/50 p-6">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-[#2eebc8] text-lg">⭐</span>
            <h3 className="text-sm font-light text-[#2eebc8] uppercase tracking-wider">Oportunidades Maestras</h3>
            <span className="text-[9px] text-app-text4 font-mono ml-2">V1.8.6 · Aggressive · Spread &gt; 0.05% · TEM &gt; prev+0.10% · top 3</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {oportunidadesMaestras.map(inst => {
              const momentum = momentumMap.get(inst.ticker)!;
              const arrowInfo = getTrendArrow(momentum.deltaTIR);
              const spread = spreadVsCaucion(inst.tem, config, inst.days);
              const spreadNeto = spread - (config.comisionTotal / (inst.days / 30));
              const score = rotationScoresMap.get(inst.ticker);
              const hScore = huntingScoresMap.get(inst.ticker) ?? 0;
              const isAnomalia = spreadNeto > 0.20;
              const cardBorder = isAnomalia
                ? 'border-2 border-[#22d3ee] shadow-[0_0_12px_rgba(34,211,238,0.25)]'
                : 'border border-[#22d3ee]/30';
              const cardLabel = isAnomalia ? 'Anomalía Mayor' : 'Señal Fuerte';
              const labelBg = isAnomalia ? 'bg-[#22d3ee]/15 text-[#22d3ee]' : 'bg-[#22d3ee]/10 text-[#22d3ee]';
              return (
                <div key={inst.ticker} className={`bg-app-card rounded-xl ${cardBorder} p-5 transition-all`}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xl font-mono font-medium text-[#2eebc8]">{inst.ticker}</span>
                      <span className={`text-[8px] font-medium px-1.5 py-0.5 rounded-lg ${labelBg}`}>{cardLabel}</span>
                    </div>
                    {arrowInfo.arrow && (
                      <span className="text-2xl font-mono" style={{ color: arrowInfo.color }}>{arrowInfo.arrow}</span>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center mb-3">
                    <div>
                      <div className="text-[9px] text-app-text4 uppercase">TEM</div>
                      <div className="text-base font-mono font-medium text-app-text">{inst.tem.toFixed(2)}%</div>
                    </div>
                    <div>
                      <div className="text-[9px] text-app-text4 uppercase">ΔTIR</div>
                      <div className={`text-base font-mono font-medium ${momentum.deltaTIR !== null && momentum.deltaTIR > 0 ? 'text-[#2eebc8]' : 'text-app-text4'}`}>
                        {momentum.deltaTIR !== null ? `${momentum.deltaTIR >= 0 ? '+' : ''}${momentum.deltaTIR.toFixed(3)}%` : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-[9px] text-app-text4 uppercase">Spread N.</div>
                      <div className="text-base font-mono font-medium text-[#2eebc8]">+{spreadNeto.toFixed(3)}%</div>
                    </div>
                  </div>
                  {score && (
                    <div className="pt-3 border-t border-app-border/60">
                      <div className="grid grid-cols-2 gap-2 text-center mb-2">
                        <div>
                          <div className="text-[8px] text-app-text4 uppercase">Hunting Score</div>
                          <div className={`font-mono font-bold text-sm ${
                            hScore >= 60 ? 'text-[#2eebc8]' :
                            hScore >= 35 ? 'text-[#fbbf24]' :
                            'text-[#f87171]'
                          }`}>
                            {hScore.toFixed(0)}/100
                          </div>
                        </div>
                        <div>
                          <div className="text-[8px] text-app-text4 uppercase">Upside Capital</div>
                          <div className={`font-mono font-bold text-sm ${
                            score.upsideCapital > 0.5 ? 'text-[#2eebc8]' :
                            score.upsideCapital > 0.1 ? 'text-[#fbbf24]' :
                            'text-[#f87171]'
                          }`}>
                            +{score.upsideCapital.toFixed(2)}%
                          </div>
                        </div>
                      </div>
                      <CapitalRunBar upside={score.upsideCapital} />
                    </div>
                  )}
                  {momentum.tirHistory.length >= 2 && (
                    <div className="mt-3 pt-3 border-t border-app-border/60 flex items-center justify-center gap-2">
                      <Sparkline data={momentum.tirHistory} width={80} height={28} />
                      <span className="text-[8px] text-app-text4 font-mono">
                        {momentum.tirHistory.map(t => t.toFixed(2)).join(' → ')}%
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── V1.8.1: Scalping de Bonos Verdict Card ── */}
      <div className={`rounded-xl border p-6 ${getVerdictBg(verdict)}`}>
        <div className="flex items-center gap-4 mb-3">
          <span className="text-2xl">{verdictEmoji}</span>
          <span className="text-2xl font-light" style={{ color: getVerdictColor(verdict) }}>
            {verdict}
          </span>
          {currentInstrument && (
            <div className="text-sm text-app-text3 font-mono">
              Posición: {currentInstrument.ticker} @ TEM {currentInstrument.tem.toFixed(2)}%
              <span className="text-app-text4 mx-1">|</span>
              Spread: <span className="text-app-text4">{currentSpread >= 0 ? '+' : ''}{currentSpread.toFixed(3)}%</span>
              {currentScore && (
                <> <span className="text-app-text4 mx-1">|</span> Upside: <span className={currentScore.upsideCapital > 0.5 ? 'text-[#2eebc8]' : currentScore.upsideCapital > 0.1 ? 'text-[#fbbf24]' : 'text-[#f87171]'}>
                  +{currentScore.upsideCapital.toFixed(2)}%
                </span></>
              )}
            </div>
          )}
        </div>
        <p className="text-sm text-app-text3">{verdictReason}</p>
      </div>

      {/* ── V1.8.1 — Oportunidades en Desarrollo (Tapados) ── */}
      {tapados.length > 0 && (
        <div className="bg-app-card rounded-xl border border-app-border p-5">
          <h3 className="text-sm font-medium text-app-text2 mb-4">🔍 Oportunidades en Desarrollo (Tapados)</h3>
          <p className="text-[10px] text-app-text4 mb-4">
            Instrumentos con ΔTIR positivo persistente pero spread vs caución que aún no cubre la comisión round-trip. Carga lista para disparar.
          </p>
          <div className="space-y-3">
            {tapados.map(inst => {
              const momentum = momentumMap.get(inst.ticker)!;
              const arrowInfo = getTrendArrow(momentum.deltaTIR);
              const isStrong = momentum.deltaTIR !== null && momentum.deltaTIR > 0.02;
              const badgeColor = isStrong ? '#22d3ee' : '#fbbf24';
              const badgeBg = isStrong ? 'rgba(34,211,238,0.10)' : 'rgba(251,191,36,0.10)';
              const badgeBorder = isStrong ? 'rgba(34,211,238,0.30)' : 'rgba(251,191,36,0.30)';
              return (
                <div key={inst.ticker} className="rounded-lg border p-3" style={{ backgroundColor: badgeBg, borderColor: badgeBorder }}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className="px-2 py-0.5 rounded-full text-[10px] font-medium"
                      style={{ backgroundColor: badgeBg, color: badgeColor, border: `1px solid ${badgeBorder}` }}
                    >
                      Oportunidad en Desarrollo
                    </span>
                    <span className="font-mono font-medium text-app-text2">{inst.ticker}</span>
                    <span className="text-app-text4 text-xs">TEM {inst.tem.toFixed(2)}%</span>
                    <span className="text-xs font-mono" style={{ color: arrowInfo.color || '#7a8599' }}>
                      ΔTIR {momentum.deltaTIR !== null ? `${momentum.deltaTIR >= 0 ? '+' : ''}${momentum.deltaTIR.toFixed(3)}%` : '—'} {arrowInfo.arrow}
                    </span>
                  </div>
                  <div className="text-[10px] text-app-text3 mt-1.5">{momentum.tapadoReason}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── V1.8.1: Propulsión de Capital Chart (Hunting Score V2) ── */}
      {rotations.length > 0 && (
        <div className="bg-app-card rounded-xl border border-app-border p-5">
          <h3 className="text-sm font-medium text-app-text2 mb-4">Propulsión de Capital por Instrumento</h3>
          <ChartContainer className="h-64">
            {({ width, height }) => (
              <BarChart width={width} height={height} data={rotationChartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }} key={`rot-${width}-${height}`}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} />
                <XAxis dataKey="ticker" tick={{ fill: chartTickFill, fontSize: 10 }} angle={-45} textAnchor="end" height={60} />
                <YAxis tick={{ fill: chartTickFill, fontSize: 11 }} label={{ value: 'Hunting Score', angle: -90, position: 'insideLeft', fill: chartLabelFill, fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ backgroundColor: tooltipBg, border: `1px solid ${tooltipBorder}`, borderRadius: '8px', fontSize: 12 }}
                  itemStyle={{ color: '#FFFFFF' }}
                  labelStyle={{ color: '#9CA3AF' }}
                  formatter={((value: number) => [`${Number(value).toFixed(1)}/100`, 'Hunting Score']) as never}
                />
                <ReferenceLine y={0} stroke="rgba(128,128,128,0.2)" />
                <ReferenceLine y={35} stroke="#fbbf24" strokeDasharray="3 3" label={{ value: 'Ejecución', fill: '#fbbf24', fontSize: 10 }} />
                <ReferenceLine y={50} stroke="#2eebc8" strokeDasharray="3 3" label={{ value: 'Captura', fill: '#2eebc8', fontSize: 10 }} />
                <Bar dataKey="huntingScore" radius={[4, 4, 0, 0]}>
                  {rotationChartData.map((entry, index) => (
                    <Cell key={index} fill={getBadgeColor(entry.badge)} fillOpacity={0.8} />
                  ))}
                </Bar>
              </BarChart>
            )}
          </ChartContainer>
        </div>
      )}

      {/* ── V1.8.1: Rotation Table sorted by Hunting Score V2 ── */}
      {rotations.length > 0 && (
        <div className="bg-app-card rounded-xl border border-app-border overflow-hidden">
          <div className="flex items-center gap-3 px-5 pt-5 pb-3">
            <h3 className="text-sm font-medium text-app-text2">Scalping de Bonos</h3>
            <span className="text-[9px] text-app-text4 font-mono ml-auto">V1.8.6 · Hunting Score V2 · Acción Táctica</span>
          </div>
          <div className="overflow-x-auto max-h-[420px] overflow-y-auto custom-scrollbar">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-app-card z-10">
                <tr className="border-b border-app-border/60">
                  <th className="px-3 py-3 text-left text-[10px] uppercase tracking-wider font-medium text-app-text3">Destino</th>
                  <th className="px-3 py-3 text-right text-[10px] uppercase tracking-wider font-medium text-[#22d3ee]">Hunting Sc.</th>
                  <th className="px-3 py-3 text-right text-[10px] uppercase tracking-wider font-medium text-[#2eebc8]">Upside Cap.</th>
                  <th className="px-3 py-3 text-center text-[10px] uppercase tracking-wider font-medium text-[#fbbf24]">Propulsión Capital</th>
                  <th className="px-3 py-3 text-center text-[10px] uppercase tracking-wider font-medium text-app-text3">Comp. Tasa</th>
                  <th className="px-3 py-3 text-right text-[10px] uppercase tracking-wider font-medium text-[#22d3ee]">Score Tác.</th>
                  <th className="px-3 py-3 text-right text-[10px] uppercase tracking-wider font-medium text-app-text3">TEM</th>
                  <th className="px-3 py-3 text-right text-[10px] uppercase tracking-wider font-medium text-app-text4 text-[9px]">Spread N.</th>
                  <th className="px-3 py-3 text-right text-[10px] uppercase tracking-wider font-medium text-app-text3">Días PE</th>
                  <th className="px-3 py-3 text-left text-[10px] uppercase tracking-wider font-medium text-app-text3">Acción Táctica</th>
                </tr>
              </thead>
              <tbody>
                {rotations.map((r) => {
                  const targetScore = rotationScoresMap.get(r.toTicker);
                  const srTarget = srDataMap.get(r.toTicker);
                  const hScore = huntingScoresMap.get(r.toTicker) ?? 0;
                  const carryDiario = r.toTEM / 30;
                  const paybackDays = carryDiario > 0 ? config.comisionTotal / carryDiario : Infinity;
                  const badge = targetScore ? getJumpBadge(targetScore, srTarget, currentScore, hScore, r.spreadNeto, paybackDays) : 'NO CONVIENE';
                  return (
                    <tr
                      key={r.toTicker}
                      className={`border-b border-app-border/60 hover:bg-app-subtle/30 ${
                        badge === 'SALTO TÁCTICO' ? 'border-l-2 border-l-[#22d3ee]' :
                        badge === 'OPORTUNIDAD DE CAPTURA' ? 'border-l-2 border-l-[#2eebc8]' :
                        badge === 'EJECUCIÓN RÁPIDA' ? 'border-l-2 border-l-[#22d3ee]' :
                        badge === 'POSICIÓN AGOTADA' ? 'border-l-2 border-l-[#f87171]' : ''
                      }`}
                    >
                      <td className="px-3 py-3 font-mono font-medium text-app-text2">
                        {r.toTicker}
                        {targetScore?.isPositionExhausted && (
                          <span className="ml-1 text-[8px] text-[#f87171] font-normal">SIN RECORRIDO</span>
                        )}
                      </td>
                      <td className={`px-3 py-3 font-mono font-bold text-right ${
                        hScore >= 60 ? 'text-[#2eebc8]' :
                        hScore >= 35 ? 'text-[#fbbf24]' :
                        'text-[#f87171]'
                      }`}>
                        {hScore.toFixed(0)}
                      </td>
                      <td className={`px-3 py-3 font-mono text-right ${
                        (targetScore?.upsideCapital ?? 0) > 0.5 ? 'text-[#2eebc8]' :
                        (targetScore?.upsideCapital ?? 0) > 0.1 ? 'text-[#fbbf24]' :
                        'text-[#f87171]'
                      }`}>
                        +{(targetScore?.upsideCapital ?? 0).toFixed(2)}%
                      </td>
                      <td className="px-3 py-3">
                        <CapitalRunBar upside={targetScore?.upsideCapital ?? 0} />
                      </td>
                      <td className="px-3 py-3 text-center">
                        <div className="flex flex-col items-center gap-0.5">
                          <span className={`text-[10px] font-mono font-medium ${
                            (targetScore?.temCompressionScore ?? 0) >= 7 ? 'text-[#2eebc8]' :
                            (targetScore?.temCompressionScore ?? 0) >= 4 ? 'text-[#fbbf24]' :
                            'text-[#f87171]'
                          }`}>
                            {(targetScore?.temCompressionScore ?? 0).toFixed(1)}
                          </span>
                          <span className="text-[8px] text-app-text4">
                            {targetScore?.temPosition === 'CERCANO_MIN' ? '⬆ Compresión' :
                             targetScore?.temPosition === 'CERCANO_MAX' ? '🔥 Tapado' :
                             '→ Medio'}
                          </span>
                        </div>
                      </td>
                      <td className={`px-3 py-3 font-mono font-medium text-right ${
                        (targetScore?.tacticalScore ?? 0) >= 7 ? 'text-[#2eebc8]' :
                        (targetScore?.tacticalScore ?? 0) >= 4.5 ? 'text-[#fbbf24]' :
                        'text-[#f87171]'
                      }`}>
                        {(targetScore?.tacticalScore ?? 0).toFixed(1)}
                      </td>
                      <td className="px-3 py-3 font-mono text-app-text2 text-right">
                        {r.toTEM.toFixed(2)}%
                      </td>
                      <td className="px-3 py-3 font-mono text-app-text4 text-[9px] text-right">
                        {r.spreadNeto >= 0 ? '+' : ''}{r.spreadNeto.toFixed(3)}%
                      </td>
                      <td className="px-3 py-3 font-mono text-app-text3 text-right">
                        {r.diasPE === Infinity ? '∞' : r.diasPE.toFixed(1)}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold border ${getBadgeClass(badge)}`}>
                            {badge} {getBadgeEmoji(badge)}
                          </span>
                          {currentInstrument && (
                            <button
                              onClick={() => setArbRotationSim({ fromTicker: currentInstrument.ticker, toTicker: r.toTicker })}
                              className="p-1 rounded-md hover:bg-[#22d3ee]/15 text-[#22d3ee] transition-colors border border-transparent hover:border-[#22d3ee]/30"
                              title="Simular rotación táctica"
                              aria-label={`Simular rotación a ${r.toTicker}`}
                            >
                              ⚡
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Todos-contra-Todos Matrix ── */}
      {instruments.length >= 2 && (
        <div className="bg-app-card rounded-xl border border-app-border p-5">
          <h3 className="text-sm font-medium text-app-text2 mb-4">📊 Matriz Todos contra Todos — Hunting Score Δ</h3>
          <p className="text-[10px] text-app-text4 mb-4">
            Cada celda muestra el spread neto de rotar desde el ticker de la fila al ticker de la columna.
            <span className="ml-1 text-[#f87171] font-medium">Celdas rojas = TRAMPA</span>
          </p>
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-[10px] border-collapse">
              <thead>
                <tr>
                  <th className="px-3 py-2 text-left text-[11px] uppercase tracking-wider font-medium text-app-text3 border border-app-border/60 bg-app-subtle/30 sticky left-0 z-10">
                    Desde →
                  </th>
                  {sortedByDays.map(inst => (
                    <th key={inst.ticker} className="px-3 py-2 text-center text-[11px] uppercase tracking-wider font-medium text-app-text3 font-mono border border-app-border/60 bg-app-subtle/30 min-w-[60px]">
                      {inst.ticker}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedByDays.map(fromInst => (
                  <tr key={fromInst.ticker}>
                    <td className="px-3 py-2 font-mono font-medium text-app-text2 border border-app-border/60 bg-app-subtle/30 sticky left-0 z-10">
                      {fromInst.ticker}
                    </td>
                    {sortedByDays.map(toInst => {
                      if (fromInst.ticker === toInst.ticker) {
                        return (
                          <td key={toInst.ticker} className="px-3 py-2 text-center border border-app-border/60 bg-app-subtle/30 text-app-text4">
                            —
                          </td>
                        );
                      }
                      const analysis = analyzeRotation(
                        fromInst.tem,
                        fromInst.days,
                        toInst,
                        config.comisionTotal
                      );
                      const isTrampa = analysis.evaluacion === 'TRAMPA';
                      const isPositive = analysis.spreadNeto > 0;
                      const cellBg = isTrampa
                        ? 'bg-[#f87171]/10 text-[#f87171]'
                        : isPositive
                          ? analysis.spreadNeto > 0.25
                            ? 'bg-app-accent-dim text-[#2eebc8]'
                            : analysis.spreadNeto > 0.10
                              ? 'bg-app-accent-dim/50 text-[#2eebc8]'
                              : 'bg-app-subtle/40 text-app-text3'
                          : 'bg-[#f87171]/8 text-[#f87171]';
                      return (
                        <td
                          key={toInst.ticker}
                          className={`px-3 py-2 text-center font-mono border border-app-border/60 ${cellBg}`}
                          title={`${fromInst.ticker} → ${toInst}: Neto ${analysis.spreadNeto >= 0 ? '+' : ''}${analysis.spreadNeto.toFixed(3)}% | ${analysis.evaluacion}`}
                        >
                          {isTrampa ? '⚠️' : ''}
                          {analysis.spreadNeto >= 0 ? '+' : ''}{analysis.spreadNeto.toFixed(2)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Anomaly Detection ── */}
      <div className="bg-app-card rounded-xl border border-app-border p-5">
        <h3 className="text-sm font-medium text-app-text2 mb-4">Detección de Anomalías</h3>
        {inversions.length === 0 && curveAnomalies.length === 0 ? (
          <p className="text-sm text-[#2eebc8]">✓ No se detectaron anomalías de curva. La estructura de tasas es coherente.</p>
        ) : (
          <div className="space-y-3">
            {curveAnomalies.map((anomaly, i) => {
              const severityBg = anomaly.severity === 'CRITICA'
                ? 'bg-[#f87171]/10 border-[#f87171]/30'
                : anomaly.severity === 'ALTA'
                  ? 'bg-[#fb923c]/10 border-[#fb923c]/30'
                  : 'bg-[#fbbf24]/10 border-[#fbbf24]/30';
              const severityBadge = anomaly.severity === 'CRITICA'
                ? 'bg-[#f87171]/10 text-[#f87171]'
                : anomaly.severity === 'ALTA'
                  ? 'bg-[#fb923c]/10 text-[#fb923c]'
                  : 'bg-[#fbbf24]/10 text-[#fbbf24]';
              const typeEmoji: Record<string, string> = {
                'INVERSION': '🔴',
                'APLANAMIENTO': '🟡',
                'SALTO_ANORMAL': '🟢',
                'HUECO': '⚪',
              };
              return (
                <div key={`anomaly-${i}`} className={`rounded-lg border p-3 ${severityBg}`}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-sm">{typeEmoji[anomaly.anomalyType] || '⚠'}</span>
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-lg ${severityBadge}`}>
                      {anomaly.severity}
                    </span>
                    <span className="text-[10px] font-medium text-app-text3">
                      {anomaly.anomalyType.replace('_', ' ')}
                    </span>
                  </div>
                  <div className="text-xs text-app-text3">{anomaly.anomalyDescription}</div>
                  <div className="text-[10px] text-app-text4 mt-1">{anomaly.recommendation}</div>
                </div>
              );
            })}
            {inversions
              .filter(inv => !curveAnomalies.some(ca => ca.longerTicker === inv.longer.ticker && ca.shorterTicker === inv.shorter.ticker))
              .map((inv, i) => (
                <div key={`inv-${i}`} className="bg-[#f87171]/8 border border-[#f87171]/20 rounded-lg p-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[#f87171] text-sm">⚠</span>
                    <span className="text-sm text-app-text2">
                      <span className="font-mono font-medium">{inv.longer.ticker}</span> ({inv.longer.days}d, TEM {inv.longer.tem.toFixed(2)}%)
                      <span className="text-app-text3 mx-2">tiene menor TEM que</span>
                      <span className="font-mono font-medium">{inv.shorter.ticker}</span> ({inv.shorter.days}d, TEM {inv.shorter.tem.toFixed(2)}%)
                    </span>
                  </div>
                  <div className="text-xs text-[#f87171]/80 mt-1">
                    Diferencia: {inv.temDiff.toFixed(3)}% — Posible oportunidad de arbitraje
                  </div>
                </div>
              ))
            }
          </div>
        )}
      </div>

      {/* ── No Position Message ── */}
      {!position && (
        <div className="bg-app-card rounded-xl border border-app-border p-6 text-center">
          <p className="text-app-text3 text-sm">No hay posición activa. Agregá una posición en la sección Cartera para activar el Scalping de Bonos.</p>
        </div>
      )}
    </div>
  );
}
