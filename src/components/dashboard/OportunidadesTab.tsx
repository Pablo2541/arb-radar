'use client';

import React, { useMemo, useCallback } from 'react';
import { Instrument, Config, Position, MomentumData, SRData, RotationScoreV17, LiveInstrument } from '@/lib/types';
import { PriceHistoryFile, calculateSR } from '@/lib/priceHistory';
import {
  spreadVsCaucion,
  durationMod,
  caucionTEMFromTNA,
  getCaucionForDays,
  analyzeRotation,
  calculateRotationScoreV17,
} from '@/lib/calculations';

// ─── Props ───
interface OportunidadesTabProps {
  instruments: Instrument[];      // V2.0.3: already effectiveInstruments from page.tsx
  config: Config;
  position: Position | null;
  momentumMap: Map<string, MomentumData>;
  priceHistory: PriceHistoryFile | null;
  // V2.0.3: Live data from page.tsx
  liveDataMap: Map<string, LiveInstrument>;
  isLive: boolean;
}

// ─── Helper: Caución TEM for days ───
const getCaucionTEMForDays = (cfg: Config, days: number): number => {
  const tna = getCaucionForDays(cfg, days);
  return caucionTEMFromTNA(tna);
};

// ═══════════════════════════════════════════════════════════════
// V1.9 — ENRICHED Opportunity Row (with S/R + Upside + Hunting Score)
// ═══════════════════════════════════════════════════════════════
interface OpportunityRow {
  instrument: Instrument;
  spread: number;
  spreadNeto: number;            // V1.9: spread - commission amortized
  compositeScore: number;
  spreadScore: number;
  momentumScore: number;
  durationScore: number;
  isTrampa: boolean;
  caucionTEM: number;
  dm: number;
  riskAdjusted: number;
  riskLevel: 'Bajo' | 'Medio' | 'Alto';
  deltaTIR: number | null;
  // V1.9 — New fields
  srData: SRData | undefined;
  upsideCapital: number;         // % distance to resistance
  posicionEnCanal: number;       // 0-100% within S/R channel
  huntingScore: number;          // 0-100 combined score
  isCeiling: boolean;            // V1.9: >90% S/R channel = ceiling
  isAgotado: boolean;            // V1.9: upside < 0.1%
  momentumLabel: 'Acelerando' | 'Alcista' | 'Neutral' | 'Decelerando' | 'Bajista';
  atractivoEntrada: number;      // V1.9: 0-1 attractiveness for entry (Spread + Upside)
}

// V1.9 — Rotation Target enriched with S/R + Momentum
interface RotationTargetV19 {
  target: Instrument;
  spreadBruto: number;
  spreadNeto: number;
  paybackDays: number;
  evaluacion: string;
  isTrampa: boolean;
  srData: SRData | undefined;
  upsideCapital: number;
  posicionEnCanal: number;
  isCeiling: boolean;
  huntingScore: number;
  momentumLabel: 'Acelerando' | 'Alcista' | 'Neutral' | 'Decelerando' | 'Bajista';
}

// ─── Score bar visual component ───
function ScoreBar({ score, max = 10 }: { score: number; max?: number }) {
  const pct = Math.min((score / max) * 100, 100);
  let color = '#f87171';
  if (score >= 7) color = '#2eebc8';
  else if (score >= 5) color = '#2eebc8';
  else if (score >= 3) color = '#fbbf24';
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-app-subtle rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-300" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="font-mono text-[10px] text-app-text3">{score.toFixed(1)}</span>
    </div>
  );
}

// ─── Upside bar visual component (V1.9) ───
function UpsideBar({ upside, max = 2.0 }: { upside: number; max?: number }) {
  const pct = Math.min((upside / max) * 100, 100);
  const color = upside > 1.0 ? '#2eebc8' : upside > 0.5 ? '#fbbf24' : upside > 0.1 ? '#fb923c' : '#f87171';
  const label = upside > 1.0 ? 'Aire' : upside > 0.5 ? 'Moderado' : upside > 0.1 ? 'Bajo' : 'Agotado';
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-app-subtle rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-300" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="font-mono text-[9px]" style={{ color }}>{upside.toFixed(2)}%</span>
      <span className="text-[8px] text-app-text4 w-14 text-right">{label}</span>
    </div>
  );
}

// ─── Heatmap cell color (V1.9: atractivoEntrada based) ───
function getHeatColor(value: number, thresholds: [number, number] = [0.3, 0.6]): string {
  const [low, high] = thresholds;
  const norm = Math.min(Math.max(value, 0), 1);
  if (norm >= high) return 'bg-[#2eebc8]/25';
  if (norm >= low) return 'bg-[#fbbf24]/15';
  return 'bg-[#f87171]/15';
}

function getHeatTextColor(value: number, thresholds: [number, number] = [0.3, 0.6]): string {
  const [low, high] = thresholds;
  const norm = Math.min(Math.max(value, 0), 1);
  if (norm >= high) return 'text-[#2eebc8]';
  if (norm >= low) return 'text-[#fbbf24]';
  return 'text-[#f87171]';
}

// ─── V1.9: Momentum Label from ΔTIR ───
function getMomentumLabel(deltaTIR: number | null): 'Acelerando' | 'Alcista' | 'Neutral' | 'Decelerando' | 'Bajista' {
  if (deltaTIR === null) return 'Neutral';
  if (deltaTIR > 0.05) return 'Acelerando';
  if (deltaTIR > 0.01) return 'Alcista';
  if (deltaTIR < -0.05) return 'Bajista';
  if (deltaTIR < -0.01) return 'Decelerando';
  return 'Neutral';
}

function getMomentumColor(label: string): string {
  switch (label) {
    case 'Acelerando': return '#2eebc8';
    case 'Alcista': return '#2eebc8';
    case 'Decelerando': return '#fbbf24';
    case 'Bajista': return '#f87171';
    default: return '#7a8599';
  }
}

function getMomentumBg(label: string): string {
  switch (label) {
    case 'Acelerando': return 'bg-[#2eebc8]/15 text-[#2eebc8] border-[#2eebc8]/40';
    case 'Alcista': return 'bg-[#2eebc8]/10 text-[#2eebc8] border-[#2eebc8]/30';
    case 'Decelerando': return 'bg-[#fbbf24]/10 text-[#fbbf24] border-[#fbbf24]/30';
    case 'Bajista': return 'bg-[#f87171]/15 text-[#f87171] border-[#f87171]/40';
    default: return 'bg-app-subtle text-app-text3 border-app-border';
  }
}

// ─── V1.9: Calculate Hunting Score (simplified from ArbitrajeTab) ───
// V3.1: Enhanced with IOL Level 2 volume validation (Filtro de Verdad)
function calculateHuntingScore(
  inst: Instrument,
  config: Config,
  srData: SRData | undefined,
  deltaTIR: number | null,
): number {
  let score = 0;

  // 1. Upside de Capital (35%)
  const upside = srData?.distanciaResistencia ?? 0;
  score += Math.min(10, (upside / 2.0) * 10) * 3.5;

  // 2. Momentum de Precio (35%)
  const priceChange = inst.change || 0;
  const momentumPts = Math.max(0, Math.min(10, (priceChange + 1) * 5));
  const distSoporte = srData?.distanciaSoporte ?? 50;
  let trendStrength = 0;
  if (distSoporte >= 0 && distSoporte < 1) trendStrength = 8;
  else if (distSoporte >= 1 && distSoporte < 3) trendStrength = 7;
  else if (distSoporte >= 3 && distSoporte < 5) trendStrength = 5;
  else trendStrength = 3;
  const combinedMomentum = (momentumPts * 0.5 + trendStrength * 0.5);
  // Boost for ΔTIR
  if (deltaTIR !== null) {
    if (deltaTIR > 0.05) score += combinedMomentum * 3.5 * 1.2;
    else if (deltaTIR > 0.01) score += combinedMomentum * 3.5 * 1.05;
    else score += combinedMomentum * 3.5;
  } else {
    score += combinedMomentum * 3.5;
  }

  // 3. Carry / TEM (30%)
  const spread = spreadVsCaucion(inst.tem, config, inst.days);
  const temCompression = Math.min(10, Math.max(0, (spread + 0.5) / 1.0 * 10));
  score += temCompression * 3.0;

  // V1.9: Ceiling penalty — if >90% S/R channel, -2 points
  const posicionEnCanal = srData?.posicionEnCanal ?? 50;
  if (posicionEnCanal > 90) {
    score -= 2;
  }

  // ── V3.1: IOL Level 2 — Filtro de Verdad Adjustment ──
  // Apply the hunting adjustment from the Cerebro Táctico script
  if (inst.iolHuntingAdjustment) {
    score += inst.iolHuntingAdjustment;
  }

  // V3.1: IOL Liquidity Alert penalty — if IOL reports low volume, penalize
  if (inst.iolLiquidityAlert) {
    score -= 8; // Significant penalty for unconfirmed volume
  }

  // V3.1: IOL Volume Confirmed boost — if IOL shows healthy volume, boost
  if (inst.iolStatus === 'online' && inst.iolVolume && inst.iolVolume > 0 && !inst.iolLiquidityAlert) {
    score += 5; // Volume-confirmed opportunity
  }

  return Math.max(0, Math.min(100, score));
}

// ═══════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════
export default function OportunidadesTab({
  instruments,
  config,
  position,
  momentumMap,
  priceHistory,
  liveDataMap,
  isLive,
}: OportunidadesTabProps) {

  // ─── S/R data from price history ───
  const srDataMap = useMemo(() => {
    if (!priceHistory) return new Map<string, SRData>();
    const srArray = calculateSR(priceHistory, instruments);
    return new Map(srArray.map(sr => [sr.ticker, sr]));
  }, [priceHistory, instruments]);

  // ─── V1.9: Compute ENRICHED opportunity data ───
  const opportunityData: OpportunityRow[] = useMemo(() => {
    if (instruments.length === 0) return [];

    const maxDM = Math.max(...instruments.map(i => Math.abs(durationMod(i.days, i.tem))), 0.01);

    return instruments.map(inst => {
      const spread = spreadVsCaucion(inst.tem, config, inst.days);
      const spreadNeto = spread - (config.comisionTotal / (inst.days / 30));
      const caucionTEM = getCaucionTEMForDays(config, inst.days);
      const isTrampa = inst.tem < caucionTEM;
      const dm = durationMod(inst.days, inst.tem);
      const absDM = Math.abs(dm);

      // S/R enrichment
      const sr = srDataMap.get(inst.ticker);
      const upsideCapital = sr?.distanciaResistencia ?? 0;
      const posicionEnCanal = sr?.posicionEnCanal ?? 50;
      const isCeiling = posicionEnCanal > 90;
      const isAgotado = upsideCapital < 0.1;

      // Momentum — V2.0.3: Prefer LIVE delta_tir from API when available
      const momentum = momentumMap.get(inst.ticker);
      const liveDeltaTIR = liveDataMap.get(inst.ticker)?.delta_tir;
      const deltaTIR = liveDeltaTIR != null ? liveDeltaTIR * 100 : (momentum?.deltaTIR ?? null);
      const momentumLabel = getMomentumLabel(deltaTIR);

      // Composite score (0–10) — V1.9: Upside weighted higher
      const spreadScore = Math.min(spread / 0.5, 1) * 3; // 30% weight, max 3

      let momentumScore = 0;
      if (deltaTIR !== null) {
        momentumScore = Math.max(0, Math.min(3, (deltaTIR + 0.1) / 0.2 * 3));
      }

      // V1.9: Upside Score replaces Duration as 40% weight
      const upsideScore = Math.min(4, (upsideCapital / 2.0) * 4); // 40% weight, max 4

      const durationScore = maxDM > 0 ? (1 - absDM / maxDM) * 0 : 0; // Removed from composite, kept for risk-adjusted

      let compositeScore = Math.min(spreadScore + momentumScore + upsideScore, 10);

      // V1.9: Ceiling penalty on composite
      if (isCeiling) compositeScore = Math.max(0, compositeScore - 1.5);

      // Risk adjusted
      const riskAdjusted = absDM > 0 ? spread / absDM : 0;
      const riskLevel: 'Bajo' | 'Medio' | 'Alto' =
        riskAdjusted > 0.5 ? 'Bajo' : riskAdjusted >= 0.2 ? 'Medio' : 'Alto';

      // V1.9: Hunting Score (0-100)
      const huntingScore = calculateHuntingScore(inst, config, sr, deltaTIR);

      // V1.9: Atractivo de Entrada (0-1) = f(Spread Neto, Upside Residual)
      // High upside + positive spread = attractive entry
      const spreadFactor = Math.min(Math.max((spreadNeto + 0.2) / 0.8, 0), 1);
      const upsideFactor = Math.min(Math.max(upsideCapital / 2.0, 0), 1);
      const atractivoEntrada = (spreadFactor * 0.4 + upsideFactor * 0.6); // Upside dominates

      return {
        instrument: inst,
        spread,
        spreadNeto,
        compositeScore,
        spreadScore,
        momentumScore,
        durationScore,
        isTrampa,
        caucionTEM,
        dm,
        riskAdjusted,
        riskLevel,
        deltaTIR,
        srData: sr,
        upsideCapital,
        posicionEnCanal,
        huntingScore,
        isCeiling,
        isAgotado,
        momentumLabel,
        atractivoEntrada,
      };
    });
  }, [instruments, config, momentumMap, srDataMap, liveDataMap]);

  // ─── V1.9 Module 2: ⭐ MEJOR OPORTUNIDAD (Triple Filter) ───
  const bestOpportunity = useMemo(() => {
    // Triple Filter: Spread Neto > 0, Upside > 0.50%, Hunting Score > 60
    const filtered = opportunityData.filter(row =>
      row.spreadNeto > 0 && row.upsideCapital > 0.50 && row.huntingScore > 60 && !row.isCeiling
    );
    // If none pass triple filter, relax: best non-ceiling by hunting score
    if (filtered.length === 0) {
      const nonCeiling = opportunityData.filter(r => !r.isCeiling && !r.isTrampa);
      if (nonCeiling.length === 0) return null;
      return nonCeiling.reduce((best, r) => r.huntingScore > best.huntingScore ? r : best, nonCeiling[0]);
    }
    // Sort by Hunting Score descending
    return filtered.reduce((best, r) => r.huntingScore > best.huntingScore ? r : best, filtered[0]);
  }, [opportunityData]);

  // ─── V1.9 Module 3: Top 5 Carry Ranking (by spread, enriched) ───
  const topCarry = useMemo(
    () => [...opportunityData].sort((a, b) => b.spread - a.spread).slice(0, 5),
    [opportunityData]
  );

  // ─── V1.9 Module 1: Rotation targets with S/R + Momentum enrichment ───
  const rotationTargets: RotationTargetV19[] = useMemo(() => {
    if (!position) return [];
    const currentInst = instruments.find(i => i.ticker === position.ticker);
    if (!currentInst) return [];

    return instruments
      .filter(i => i.ticker !== currentInst.ticker)
      .map(target => {
        const analysis = analyzeRotation(
          currentInst.tem,
          currentInst.days,
          target,
          config.comisionTotal
        );
        const sr = srDataMap.get(target.ticker);
        const momentum = momentumMap.get(target.ticker);
        // V2.0.3: Prefer LIVE delta_tir from API when available
        const liveDeltaTIR = liveDataMap.get(target.ticker)?.delta_tir;
        const deltaTIR = liveDeltaTIR != null ? liveDeltaTIR * 100 : (momentum?.deltaTIR ?? null);
        const hScore = calculateHuntingScore(target, config, sr, deltaTIR);

        return {
          target,
          spreadBruto: analysis.spreadBruto,
          spreadNeto: analysis.spreadNeto,
          paybackDays: analysis.diasPE,
          evaluacion: analysis.evaluacion,
          isTrampa: analysis.evaluacion === 'TRAMPA',
          srData: sr,
          upsideCapital: sr?.distanciaResistencia ?? 0,
          posicionEnCanal: sr?.posicionEnCanal ?? 50,
          isCeiling: (sr?.posicionEnCanal ?? 50) > 90,
          huntingScore: hScore,
          momentumLabel: getMomentumLabel(deltaTIR),
        };
      })
      // V1.9: Sort by Hunting Score (not just spreadNeto)
      .sort((a, b) => b.huntingScore - a.huntingScore)
      .slice(0, 5);
  }, [position, instruments, config, srDataMap, momentumMap, liveDataMap]);

  // ─── V1.9 Module 1b: Exit Alert for current position ───
  const exitAlert = useMemo(() => {
    if (!position) return null;
    const currentInst = instruments.find(i => i.ticker === position.ticker);
    if (!currentInst) return null;

    const sr = srDataMap.get(currentInst.ticker);
    if (!sr) return null;

    const posicionEnCanal = sr.posicionEnCanal;
    const isAtCeiling = posicionEnCanal >= 98.5; // 98.5% of resistance
    const isAgotado = sr.distanciaResistencia < 0.1;

    if (!isAtCeiling && !isAgotado) return null;

    return {
      ticker: currentInst.ticker,
      reason: isAgotado
        ? 'POSICIÓN AGOTADA — Upside residual < 0.1%'
        : `ZONA DE TECHO — Precio al ${posicionEnCanal.toFixed(1)}% del canal S/R`,
      upside: sr.distanciaResistencia,
      posicionEnCanal,
      isAgotado,
    };
  }, [position, instruments, srDataMap]);

  // ─── V1.9 Module 4: Risk-Adjusted Ranking (with S/R ceiling penalty) ───
  const riskAdjustedRanking = useMemo(() => {
    return [...opportunityData].sort((a, b) => {
      // V1.9: Penalize ceiling instruments severely
      const aPenalty = a.isCeiling ? -1000 : 0;
      const bPenalty = b.isCeiling ? -1000 : 0;
      // Use atractivoEntrada as primary sort (Spread + Upside)
      return (b.atractivoEntrada + bPenalty) - (a.atractivoEntrada + aPenalty);
    });
  }, [opportunityData]);

  // ─── V1.9 Module 5: Heatmap data (sorted by atractivoEntrada) ───
  const heatmapInstruments = useMemo(
    () => [...opportunityData].sort((a, b) => b.atractivoEntrada - a.atractivoEntrada),
    [opportunityData]
  );

  // ─── Helper: deltaTIR arrow ───
  const getDeltaTIRArrow = (deltaTIR: number | null): { arrow: string; color: string } => {
    if (deltaTIR === null) return { arrow: '', color: '#7a8599' };
    if (deltaTIR > 0.02) return { arrow: '↑', color: '#2eebc8' };
    if (deltaTIR < -0.02) return { arrow: '↓', color: '#f87171' };
    return { arrow: '→', color: '#7a8599' };
  };

  // ─── Helper: evaluation color for rotation ───
  const getEvalBg = (eval_: string): string => {
    switch (eval_) {
      case 'MUY ATRACTIVO': return 'bg-app-accent-dim text-[#2eebc8]';
      case 'ATRACTIVO': return 'bg-app-accent-dim text-[#2eebc8]';
      case 'MARGINAL': return 'bg-[#fbbf24]/10 text-[#fbbf24]';
      case 'NO CONVIENE': return 'bg-[#f87171]/10 text-[#f87171]';
      case 'TRAMPA': return 'bg-[#f87171]/10 text-[#f87171]';
      default: return 'bg-app-subtle text-app-text3';
    }
  };

  // ─── CSV Export (V1.9 enriched) ───
  const handleCSVExport = useCallback(() => {
    const headers = ['Sección', 'Rank', 'Ticker', 'Tipo', 'Días', 'TEM', 'Spread', 'Spread Neto', 'Upside %', 'Canal S/R %', 'Hunting Score', 'ΔTIR', 'Momentum', 'Techo', 'DM', 'Score Compuesto', 'Atractivo Entrada'];

    const carryRows = topCarry.map((row, idx) => [
      'Carry', idx + 1, row.instrument.ticker, row.instrument.type,
      row.instrument.days, row.instrument.tem.toFixed(2),
      row.spread.toFixed(3), row.spreadNeto.toFixed(3),
      row.upsideCapital.toFixed(2), row.posicionEnCanal.toFixed(0),
      row.huntingScore.toFixed(0),
      row.deltaTIR !== null ? row.deltaTIR.toFixed(3) : '',
      row.momentumLabel, row.isCeiling ? 'SÍ' : 'NO',
      row.dm.toFixed(4), row.compositeScore.toFixed(1),
      row.atractivoEntrada.toFixed(3),
    ].join(','));

    const rotationRows = rotationTargets.map((rot, idx) => [
      'Rotación', idx + 1, rot.target.ticker, rot.target.type,
      rot.target.days, rot.target.tem.toFixed(2),
      rot.spreadBruto.toFixed(3), rot.spreadNeto.toFixed(3),
      rot.upsideCapital.toFixed(2), rot.posicionEnCanal.toFixed(0),
      rot.huntingScore.toFixed(0), '', rot.momentumLabel,
      rot.isCeiling ? 'SÍ' : 'NO', '', '', '',
    ].join(','));

    const riskRows = riskAdjustedRanking.map((row, idx) => [
      'Riesgo-Ajustado', idx + 1, row.instrument.ticker, row.instrument.type,
      row.instrument.days, row.instrument.tem.toFixed(2),
      row.spread.toFixed(3), row.spreadNeto.toFixed(3),
      row.upsideCapital.toFixed(2), row.posicionEnCanal.toFixed(0),
      row.huntingScore.toFixed(0),
      row.deltaTIR !== null ? row.deltaTIR.toFixed(3) : '',
      row.momentumLabel, row.isCeiling ? 'SÍ' : 'NO',
      row.dm.toFixed(4), row.compositeScore.toFixed(1),
      row.atractivoEntrada.toFixed(3),
    ].join(','));

    const csv = [headers.join(','), ...carryRows, ...rotationRows, ...riskRows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `oportunidades_v19_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }, [topCarry, rotationTargets, riskAdjustedRanking]);

  // ─── Count stats ───
  const ceilingCount = opportunityData.filter(r => r.isCeiling).length;
  const agotadoCount = opportunityData.filter(r => r.isAgotado).length;

  // V1.9.1: Price history freshness
  const historyFreshness = useMemo(() => {
    if (!priceHistory) return { lastDate: null, daysSince: Infinity, isStale: true };
    const dates = Object.keys(priceHistory.historico).sort();
    if (dates.length === 0) return { lastDate: null, daysSince: Infinity, isStale: true };
    const lastDate = dates[dates.length - 1];
    const last = new Date(lastDate + 'T23:59:59');
    const now = new Date();
    const daysSince = Math.floor((now.getTime() - last.getTime()) / (1000 * 60 * 60 * 24));
    return { lastDate, daysSince, isStale: daysSince > 1 };
  }, [priceHistory]);

  return (
    <div className="space-y-6">
      {/* ═══════════════════════════════════════════════════════════ */}
      {/* HEADER — V1.9: Capital Gain focus                          */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <div>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-lg font-light text-app-text mb-1">🎯 Oportunidades — Punto Gatillo</h2>
            <p className="text-sm text-app-text3">Detector de entradas y salidas — Prioriza Recorrido de Precio y Momentum — V2.0.3</p>
          </div>
          <button
            onClick={handleCSVExport}
            disabled={opportunityData.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-app-subtle/40 border border-app-border/60 rounded-lg text-[10px] font-medium text-app-text3 hover:bg-app-hover hover:text-app-text2 transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Exportar rankings a CSV"
          >
            <span className="text-sm">⬇</span>
            CSV
          </button>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* SUMMARY STATS BAR — V1.9 enriched                          */}
      {/* ═══════════════════════════════════════════════════════════ */}
      {opportunityData.length > 0 && (
        <div className="glass-card px-4 py-2.5 animate-fadeInUp overflow-x-auto scrollbar-hide">
          <div className="flex items-center gap-4 min-w-max text-xs">
            <div className="flex items-center gap-2">
              <span className="text-app-text4 uppercase tracking-wider text-[10px]">Instrumentos</span>
              <span className="font-mono font-bold text-app-text">{opportunityData.length}</span>
            </div>
            <div className="w-px h-3 bg-app-border/40" />
            <div className="flex items-center gap-2">
              <span className="text-app-text4 uppercase tracking-wider text-[10px]">Hunting Prom.</span>
              <span className="font-mono font-bold" style={{ color: (opportunityData.reduce((s, r) => s + r.huntingScore, 0) / opportunityData.length) >= 50 ? '#2eebc8' : (opportunityData.reduce((s, r) => s + r.huntingScore, 0) / opportunityData.length) >= 30 ? '#fbbf24' : '#f87171' }}>
                {(opportunityData.reduce((s, r) => s + r.huntingScore, 0) / opportunityData.length).toFixed(0)}
              </span>
            </div>
            <div className="w-px h-3 bg-app-border/40" />
            <div className="flex items-center gap-2">
              <span className="text-app-text4 uppercase tracking-wider text-[10px]">TRAMPA</span>
              <span className="font-mono font-bold text-[#f87171]">{opportunityData.filter(r => r.isTrampa).length}</span>
            </div>
            <div className="w-px h-3 bg-app-border/40" />
            <div className="flex items-center gap-2">
              <span className="text-app-text4 uppercase tracking-wider text-[10px]">Techo 🚨</span>
              <span className="font-mono font-bold text-[#f87171]">{ceilingCount}</span>
            </div>
            <div className="w-px h-3 bg-app-border/40" />
            <div className="flex items-center gap-2">
              <span className="text-app-text4 uppercase tracking-wider text-[10px]">Agotado</span>
              <span className="font-mono font-bold text-[#f87171]">{agotadoCount}</span>
            </div>
            <div className="w-px h-3 bg-app-border/40" />
            <div className="flex items-center gap-2">
              <span className="text-app-text4 uppercase tracking-wider text-[10px]">Mejor Upside</span>
              <span className="font-mono font-bold text-[#2eebc8]">+{Math.max(...opportunityData.map(r => r.upsideCapital)).toFixed(2)}%</span>
            </div>
            {/* V1.9.1: S/R Freshness indicator */}
            <div className="w-px h-3 bg-app-border/40" />
            <div className="flex items-center gap-2">
              <span className={`inline-block w-1.5 h-1.5 rounded-full ${historyFreshness.isStale ? 'bg-[#fbbf24]' : 'bg-[#2eebc8]'}`} />
              <span className="text-app-text4 uppercase tracking-wider text-[10px]">S/R</span>
              <span className={`font-mono font-bold text-[10px] ${historyFreshness.isStale ? 'text-[#fbbf24]' : 'text-[#2eebc8]'}`}>
                {historyFreshness.lastDate
                  ? historyFreshness.isStale
                    ? `+${historyFreshness.daysSince}d`
                    : 'OK'
                  : '—'}
              </span>
            </div>
            {/* V3.1: IOL Level 2 Status */}
            {(() => {
              const iolOnlineCount = instruments.filter(i => i.iolStatus === 'online').length;
              const iolAlertCount = instruments.filter(i => i.iolLiquidityAlert).length;
              return iolOnlineCount > 0 ? (
                <>
                  <div className="w-px h-3 bg-app-border/40" />
                  <div className="flex items-center gap-2">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#a78bfa] animate-pulse" />
                    <span className="text-app-text4 uppercase tracking-wider text-[10px]">IOL L2</span>
                    <span className="font-mono font-bold text-[#a78bfa] text-[10px]">{iolOnlineCount}</span>
                    {iolAlertCount > 0 && (
                      <span className="text-[#fbbf24] font-mono text-[10px]">⚠{iolAlertCount}</span>
                    )}
                  </div>
                </>
              ) : null;
            })()}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* V1.9.1: STALE DATA WARNING — S/R may be outdated           */}
      {/* ═══════════════════════════════════════════════════════════ */}
      {historyFreshness.isStale && historyFreshness.lastDate && (
        <div className="rounded-xl p-3 bg-[#fbbf24]/8 border border-[#fbbf24]/20 animate-fadeInUp">
          <div className="flex items-center gap-2">
            <span className="text-xs">⚠️</span>
            <span className="text-[10px] text-[#fbbf24] font-semibold">S/R DESACTUALIZADO</span>
            <span className="text-[10px] text-app-text4">
              — Último cierre: <span className="font-mono">{historyFreshness.lastDate}</span> (hace {historyFreshness.daysSince}d).
              Andá a <strong className="text-app-text2">Configuración → 💾 Guardar Cierre del Día</strong> para actualizar.
            </span>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* V1.9 MODULE 1: EXIT ALERT (Zona de Techo / Agotado)        */}
      {/* ═══════════════════════════════════════════════════════════ */}
      {exitAlert && (() => {
        // Find best rotation target with Upside > 0.50% and momentum
        const bestTarget = rotationTargets.find(t =>
          t.upsideCapital > 0.50 && !t.isCeiling &&
          (t.momentumLabel === 'Acelerando' || t.momentumLabel === 'Alcista')
        ) ?? rotationTargets.find(t => !t.isCeiling) ?? null;

        return (
          <div className="rounded-xl border-2 border-[#f87171]/60 bg-[#f87171]/5 p-5 animate-fadeInUp">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-xl">🚨</span>
              <span className="text-base font-medium text-[#f87171]">
                ALERTA DE SALIDA — {exitAlert.ticker}
              </span>
              <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border ${
                exitAlert.isAgotado
                  ? 'bg-[#f87171]/15 text-[#f87171] border-[#f87171]/40'
                  : 'bg-[#fbbf24]/15 text-[#fbbf24] border-[#fbbf24]/40'
              }`}>
                {exitAlert.isAgotado ? 'POSICIÓN AGOTADA' : 'ZONA DE TECHO'}
              </span>
            </div>
            <p className="text-sm text-app-text3 mb-2">
              {exitAlert.reason}
            </p>
            <div className="flex items-center gap-4 text-xs text-app-text4 mb-3">
              <span>Upside residual: <span className="text-[#f87171] font-mono">+{exitAlert.upside.toFixed(2)}%</span></span>
              <span>Canal S/R: <span className="text-[#f87171] font-mono">{exitAlert.posicionEnCanal.toFixed(0)}%</span></span>
            </div>
            {bestTarget && (
              <div className="mt-3 p-4 rounded-xl border border-[#2eebc8]/40 bg-[#2eebc8]/5">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm">➡️</span>
                  <span className="text-sm font-semibold text-[#2eebc8]">
                    ROTAR A: {bestTarget.target.ticker}
                  </span>
                  <span className={`px-2 py-0.5 rounded-lg text-[9px] font-bold border ${getMomentumBg(bestTarget.momentumLabel)}`}>
                    {bestTarget.momentumLabel}
                  </span>
                  {bestTarget.upsideCapital > 0.50 && (
                    <span className="px-2 py-0.5 rounded-lg text-[9px] font-bold bg-[#2eebc8]/15 text-[#2eebc8] border border-[#2eebc8]/40">
                      🎯 PUNTO CARAMELO
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-4 text-xs">
                  <span className="text-app-text3">Spread Neto: <span className="font-mono text-[#2eebc8]">{bestTarget.spreadNeto >= 0 ? '+' : ''}{bestTarget.spreadNeto.toFixed(3)}%</span></span>
                  <span className="text-app-text3">Upside: <span className="font-mono text-[#2eebc8]">+{bestTarget.upsideCapital.toFixed(2)}%</span></span>
                  <span className="text-app-text3">Hunting: <span className="font-mono text-[#2eebc8]">{bestTarget.huntingScore.toFixed(0)}/100</span></span>
                  <span className="text-app-text3">Payback: <span className="font-mono text-app-text2">{bestTarget.paybackDays === Infinity ? '∞' : `${bestTarget.paybackDays.toFixed(0)}d`}</span></span>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* V1.9 MODULE 2: ⭐ MEJOR OPORTUNIDAD (Triple Filter)        */}
      {/* ═══════════════════════════════════════════════════════════ */}
      {bestOpportunity && (
        <div className="shimmer-border p-px rounded-2xl">
          <div className="glass-card-accent p-6 animate-fadeInUp rounded-2xl">
            <div className="flex items-center gap-2 mb-4">
              <span className="px-3 py-1 rounded-full text-[10px] font-semibold bg-[#2eebc8]/15 text-[#2eebc8] compra-pulse">
                ⭐ MEJOR OPORTUNIDAD
              </span>
              {bestOpportunity.huntingScore > 60 && bestOpportunity.upsideCapital > 0.50 && bestOpportunity.spreadNeto > 0 && (
                <span className="px-2 py-0.5 rounded-lg text-[9px] font-bold bg-[#22d3ee]/15 text-[#22d3ee] border border-[#22d3ee]/40">
                  ✅ TRIPLE FILTRO
                </span>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4">
              {/* Ticker & Type */}
              <div>
                <div className="text-[10px] text-app-text4 uppercase tracking-wider mb-1">Instrumento</div>
                <div className="font-mono font-bold text-2xl text-[#2eebc8]">
                  {bestOpportunity.instrument.ticker}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`px-2 py-0.5 rounded text-[9px] font-semibold ${
                    bestOpportunity.instrument.type === 'LECAP'
                      ? 'bg-app-accent-dim text-[#2eebc8]'
                      : 'bg-[#f472b6]/10 text-[#f472b6]'
                  }`}>
                    {bestOpportunity.instrument.type}
                  </span>
                  <span className="text-app-text4 text-[10px] font-mono">
                    {bestOpportunity.instrument.days}d
                  </span>
                </div>
              </div>

              {/* Upside (V1.9: prominent) */}
              <div>
                <div className="text-[10px] text-app-text4 uppercase tracking-wider mb-1">Upside Residual</div>
                <div className={`font-mono font-bold text-2xl ${
                  bestOpportunity.upsideCapital > 1.0 ? 'text-[#2eebc8]' :
                  bestOpportunity.upsideCapital > 0.5 ? 'text-[#2eebc8]' :
                  bestOpportunity.upsideCapital > 0.1 ? 'text-[#fbbf24]' :
                  'text-[#f87171]'
                }`}>
                  +{bestOpportunity.upsideCapital.toFixed(2)}%
                </div>
                <UpsideBar upside={bestOpportunity.upsideCapital} />
              </div>

              {/* Hunting Score (V1.9) */}
              <div>
                <div className="text-[10px] text-app-text4 uppercase tracking-wider mb-1">Hunting Score</div>
                <div className={`font-mono font-bold text-2xl ${
                  bestOpportunity.huntingScore >= 60 ? 'text-[#2eebc8]' :
                  bestOpportunity.huntingScore >= 35 ? 'text-[#fbbf24]' :
                  'text-[#f87171]'
                }`}>
                  {bestOpportunity.huntingScore.toFixed(0)}
                  <span className="text-app-text4 text-sm font-light">/100</span>
                </div>
                <div className="text-[9px] text-app-text4 mt-1">
                  Canal: <span className={`font-mono ${bestOpportunity.posicionEnCanal > 90 ? 'text-[#f87171]' : bestOpportunity.posicionEnCanal > 70 ? 'text-[#fbbf24]' : 'text-[#2eebc8]'}`}>{bestOpportunity.posicionEnCanal.toFixed(0)}%</span>
                </div>
              </div>

              {/* TEM & Spread */}
              <div>
                <div className="text-[10px] text-app-text4 uppercase tracking-wider mb-1">TEM / Spread Neto</div>
                <div className="font-mono font-bold text-2xl text-app-text">
                  {bestOpportunity.instrument.tem.toFixed(2)}%
                </div>
                <div className={`text-xs font-mono mt-1 ${bestOpportunity.spreadNeto >= 0 ? 'text-[#2eebc8]' : 'text-[#f87171]'}`}>
                  Neto: {bestOpportunity.spreadNeto >= 0 ? '+' : ''}{bestOpportunity.spreadNeto.toFixed(3)}%
                </div>
              </div>

              {/* Momentum (V1.9: prominent) */}
              <div>
                <div className="text-[10px] text-app-text4 uppercase tracking-wider mb-1">Momentum</div>
                <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-[11px] font-bold border ${getMomentumBg(bestOpportunity.momentumLabel)}`}>
                  {bestOpportunity.momentumLabel}
                </span>
                <div className="text-xs font-mono mt-2">
                  {bestOpportunity.deltaTIR !== null ? (
                    <span style={{ color: getDeltaTIRArrow(bestOpportunity.deltaTIR).color }}>
                      ΔTIR {bestOpportunity.deltaTIR >= 0 ? '+' : ''}{bestOpportunity.deltaTIR.toFixed(3)}% {getDeltaTIRArrow(bestOpportunity.deltaTIR).arrow}
                    </span>
                  ) : (
                    <span className="text-app-text4">ΔTIR —</span>
                  )}
                </div>
              </div>
            </div>

            {/* Triple filter criteria detail */}
            <div className="mt-4 pt-3 border-t border-app-border/40 flex items-center gap-4 text-[10px]">
              <span className={`flex items-center gap-1 ${bestOpportunity.spreadNeto > 0 ? 'text-[#2eebc8]' : 'text-[#f87171]'}`}>
                {bestOpportunity.spreadNeto > 0 ? '✅' : '❌'} Spread Neto &gt; 0
              </span>
              <span className={`flex items-center gap-1 ${bestOpportunity.upsideCapital > 0.50 ? 'text-[#2eebc8]' : 'text-[#f87171]'}`}>
                {bestOpportunity.upsideCapital > 0.50 ? '✅' : '❌'} Upside &gt; 0.50%
              </span>
              <span className={`flex items-center gap-1 ${bestOpportunity.huntingScore > 60 ? 'text-[#2eebc8]' : 'text-[#f87171]'}`}>
                {bestOpportunity.huntingScore > 60 ? '✅' : '❌'} Hunting Score &gt; 60
              </span>
            </div>

            {/* Ceiling/Agotado warning */}
            {bestOpportunity.isCeiling && (
              <div className="mt-4 p-3 rounded-lg bg-[#f87171]/10 border border-[#f87171]/30">
                <span className="text-[#f87171] text-xs font-semibold">🚨 EN ZONA DE TECHO</span>
                <span className="text-app-text3 text-xs ml-2">— Canal S/R al {bestOpportunity.posicionEnCanal.toFixed(0)}%. El precio no tiene más recorrido.</span>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="section-divider" />

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* V1.9 MODULE 1: ROTATION OPORTUNITIES (Center of Command)   */}
      {/* ═══════════════════════════════════════════════════════════ */}
      {position && rotationTargets.length > 0 && (
        <div className="glass-card p-5">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-light text-app-text2">🔄 Centro de Comando — Rotación Proactiva</h3>
          </div>
          <p className="text-[10px] text-app-text4 mb-4">
            Desde {position.ticker} — Ordenado por Hunting Score — Solo entradas con Upside &gt; 0.50% y Momentum alcista
          </p>
          <div className="space-y-3">
            {rotationTargets.map((rot, idx) => {
              const isTrampa = rot.isTrampa;
              const hasUpside = rot.upsideCapital > 0.50;
              const hasMomentum = rot.momentumLabel === 'Acelerando' || rot.momentumLabel === 'Alcista';
              const isPuntoCaramelo = hasUpside && hasMomentum && !rot.isCeiling;

              return (
                <div
                  key={rot.target.ticker}
                  className={`
                    rounded-xl border p-4 animate-fadeInUp stagger-${idx + 1}
                    ${isPuntoCaramelo
                      ? 'border-l-4 border-l-[#22d3ee] bg-[#22d3ee]/5 border-y border-r border-[#22d3ee]/30 shadow-[0_0_8px_rgba(34,211,238,0.15)]'
                      : rot.isCeiling
                        ? 'border-l-4 border-l-[#f87171] bg-[#f87171]/5 border-y border-r border-app-border/60'
                        : isTrampa
                          ? 'border-l-4 border-l-[#f87171] bg-[#f87171]/5 border-y border-r border-app-border/60'
                          : hasUpside
                            ? 'border-l-4 border-l-[#2eebc8] bg-app-accent-dim/50 border-y border-r border-app-border/60'
                            : 'bg-app-card border border-app-border/60'
                    }
                    table-row-highlight
                  `}
                >
                  <div className="flex flex-wrap items-center gap-4">
                    {/* Target ticker */}
                    <div className="min-w-[100px]">
                      <div className="text-[9px] text-app-text4 uppercase">Destino</div>
                      <div className="font-mono font-bold text-app-text text-base">
                        {rot.target.ticker}
                      </div>
                      <div className="flex items-center gap-1 mt-0.5">
                        <span className={`px-1.5 py-0.5 rounded text-[8px] font-semibold ${
                          rot.target.type === 'LECAP'
                            ? 'bg-app-accent-dim text-[#2eebc8]'
                            : 'bg-[#f472b6]/10 text-[#f472b6]'
                        }`}>
                          {rot.target.type}
                        </span>
                        <span className="text-[10px] text-app-text4 font-mono">{rot.target.days}d</span>
                      </div>
                    </div>

                    {/* V1.9: Upside (prominent) */}
                    <div className="min-w-[90px]">
                      <div className="text-[9px] text-app-text4 uppercase">Upside Cap.</div>
                      <div className={`font-mono font-bold text-sm ${
                        rot.upsideCapital > 1.0 ? 'text-[#2eebc8]' :
                        rot.upsideCapital > 0.50 ? 'text-[#2eebc8]/80' :
                        rot.upsideCapital > 0.10 ? 'text-[#fbbf24]' :
                        'text-[#f87171]'
                      }`}>
                        +{rot.upsideCapital.toFixed(2)}%
                      </div>
                    </div>

                    {/* V1.9: Hunting Score */}
                    <div className="min-w-[70px]">
                      <div className="text-[9px] text-app-text4 uppercase">Hunting</div>
                      <div className={`font-mono font-bold text-sm ${
                        rot.huntingScore >= 60 ? 'text-[#2eebc8]' :
                        rot.huntingScore >= 35 ? 'text-[#fbbf24]' :
                        'text-[#f87171]'
                      }`}>
                        {rot.huntingScore.toFixed(0)}
                      </div>
                    </div>

                    {/* V1.9: Momentum */}
                    <div className="min-w-[80px]">
                      <div className="text-[9px] text-app-text4 uppercase">Momentum</div>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-[9px] font-bold border ${getMomentumBg(rot.momentumLabel)}`}>
                        {rot.momentumLabel}
                      </span>
                    </div>

                    {/* Spread Neto */}
                    <div className="min-w-[80px]">
                      <div className="text-[9px] text-app-text4 uppercase">Spread Neto</div>
                      <div className={`font-mono font-bold text-sm ${rot.spreadNeto >= 0 ? 'text-[#2eebc8]' : 'text-[#f87171]'}`}>
                        {rot.spreadNeto >= 0 ? '+' : ''}{rot.spreadNeto.toFixed(3)}%
                      </div>
                    </div>

                    {/* Payback Days */}
                    <div className="min-w-[70px]">
                      <div className="text-[9px] text-app-text4 uppercase">Payback</div>
                      <div className={`font-mono text-sm font-medium ${
                        rot.paybackDays < 10 ? 'text-[#2eebc8]' : rot.paybackDays < 30 ? 'text-[#fbbf24]' : 'text-[#f87171]'
                      }`}>
                        {rot.paybackDays === Infinity ? '∞' : `${rot.paybackDays.toFixed(0)}d`}
                      </div>
                    </div>

                    {/* V1.9: Action Badge */}
                    <div className="flex items-center gap-2">
                      {isPuntoCaramelo && (
                        <span className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-[#22d3ee]/15 text-[#22d3ee] border border-[#22d3ee]/40">
                          🎯 PUNTO CARAMELO
                        </span>
                      )}
                      {rot.isCeiling && (
                        <span className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-[#f87171]/15 text-[#f87171] border border-[#f87171]/40">
                          🚨 TECHO
                        </span>
                      )}
                      {isTrampa && (
                        <span className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-[#f87171]/10 text-[#f87171]">
                          🚫 TRAMPA
                        </span>
                      )}
                      {!isPuntoCaramelo && !rot.isCeiling && !isTrampa && (
                        <span className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold ${getEvalBg(rot.evaluacion)}`}>
                          {rot.evaluacion}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* No position message for rotation */}
      {position && rotationTargets.length === 0 && (
        <div className="glass-card p-5">
          <div className="text-center text-app-text3 text-sm py-4">
            No hay destinos de rotación disponibles con los instrumentos actuales.
          </div>
        </div>
      )}

      {!position && (
        <div className="glass-card p-5">
          <div className="text-center py-6">
            <p className="text-app-text3 text-sm mb-2">
              📌 Agregá una posición en la sección Cartera para activar el Centro de Comando de Rotación.
            </p>
            <p className="text-[10px] text-app-text4">
              El sistema detectará automáticamente si tu posición está en Zona de Techo y propondrá rotaciones proactivas.
            </p>
          </div>
        </div>
      )}

      <div className="section-divider" />

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* V1.9 MODULE 3: TOP 5 CARRY + Upside Column + Ceiling Warn  */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <div className="glass-card p-5">
        <div className="flex items-center gap-2 mb-1">
          <h3 className="text-sm font-light text-app-text2">📊 Top 5 Carry Ranking</h3>
          <span className="text-[9px] text-app-text4 font-mono">V1.9 · + Capacidad de Salto</span>
        </div>
        <p className="text-[10px] text-app-text4 mb-4">
          Ordenado por spread vs caución. Rojo = en techo S/R (alta tasa pero sin recorrido de precio)
        </p>
        <div className="space-y-3">
          {topCarry.map((row, idx) => {
            const isHeld = position?.ticker === row.instrument.ticker;
            const isTop3 = idx < 3;
            const staggerClass = `stagger-${idx + 1}` as const;

            return (
              <div
                key={row.instrument.ticker}
                className={`
                  rounded-xl border p-4 animate-fadeInUp ${staggerClass}
                  ${row.isCeiling
                    ? 'border-l-4 border-l-[#f87171] bg-[#f87171]/5 border-y border-r border-[#f87171]/30'
                    : row.isTrampa
                      ? 'border-l-4 border-l-[#f87171] bg-[#f87171]/5 border-y border-r border-app-border/60'
                      : isTop3
                        ? 'border-l-4 border-l-[#2eebc8] bg-app-card border-y border-r border-app-border/60'
                        : 'bg-app-card border border-app-border/60'
                  }
                  table-row-highlight
                `}
              >
                <div className="flex flex-wrap items-center gap-3">
                  {/* Rank */}
                  <div className={`rank-badge ${idx === 0 ? 'rank-1' : idx === 1 ? 'rank-2' : idx === 2 ? 'rank-3' : 'rank-default'}`}>
                    {idx + 1}
                  </div>

                  {/* Ticker + badges */}
                  <div className="min-w-[120px]">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-app-text text-base">
                        {row.instrument.ticker}
                      </span>
                      <span className={`px-1.5 py-0.5 rounded text-[8px] font-semibold ${
                        row.instrument.type === 'LECAP'
                          ? 'bg-app-accent-dim text-[#2eebc8]'
                          : 'bg-[#f472b6]/10 text-[#f472b6]'
                      }`}>
                        {row.instrument.type}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-app-text4 font-mono">{row.instrument.days}d</span>
                      {isHeld && (
                        <span className="px-1.5 py-0.5 rounded text-[8px] font-semibold bg-[#2eebc8]/15 text-[#2eebc8]">
                          📌 EN CARTERA
                        </span>
                      )}
                      {row.isTrampa && (
                        <span className="px-1.5 py-0.5 rounded text-[8px] font-semibold bg-[#f87171]/15 text-[#f87171] compra-pulse badge-trampa">
                          ⚠️ TRAMPA
                        </span>
                      )}
                      {row.isCeiling && (
                        <span className="px-1.5 py-0.5 rounded text-[8px] font-semibold bg-[#f87171]/15 text-[#f87171] compra-pulse">
                          🚨 TECHO
                        </span>
                      )}
                      {row.instrument.iolLiquidityAlert && (
                        <span className="px-1.5 py-0.5 rounded text-[8px] font-semibold bg-[#fbbf24]/15 text-[#fbbf24]">
                          ⚠️ BAJA LIQ
                        </span>
                      )}
                      {row.instrument.iolStatus === 'online' && !row.instrument.iolLiquidityAlert && row.instrument.iolVolume && row.instrument.iolVolume > 0 && (
                        <span className="px-1.5 py-0.5 rounded text-[8px] font-semibold bg-[#a78bfa]/15 text-[#a78bfa]">
                          ✓ VOL IOL
                        </span>
                      )}
                    </div>
                  </div>

                  {/* TEM */}
                  <div className="min-w-[70px]">
                    <div className="text-[9px] text-app-text4 uppercase">TEM</div>
                    <div className={`font-mono font-medium text-sm ${row.isTrampa ? 'text-[#f87171]' : 'text-app-text'}`}>
                      {row.instrument.tem.toFixed(2)}%
                    </div>
                  </div>

                  {/* Spread vs Caución */}
                  <div className="min-w-[90px]">
                    <div className="text-[9px] text-app-text4 uppercase">Spread</div>
                    <div className={`font-mono font-medium text-sm ${
                      row.spread > 0.25 ? 'text-[#2eebc8]' : row.spread > 0.10 ? 'text-[#2eebc8]/70' : row.spread > 0 ? 'text-[#fbbf24]' : 'text-[#f87171]'
                    }`}>
                      {row.spread >= 0 ? '+' : ''}{row.spread.toFixed(3)}%
                    </div>
                  </div>

                  {/* V1.9: Capacidad de Salto (Upside) */}
                  <div className="min-w-[110px]">
                    <div className="text-[9px] text-app-text4 uppercase">Cap. de Salto ↑</div>
                    <UpsideBar upside={row.upsideCapital} />
                  </div>

                  {/* V1.9: Canal S/R % */}
                  <div className="min-w-[60px]">
                    <div className="text-[9px] text-app-text4 uppercase">Canal</div>
                    <div className={`font-mono font-bold text-sm ${
                      row.posicionEnCanal > 90 ? 'text-[#f87171]' :
                      row.posicionEnCanal > 70 ? 'text-[#fbbf24]' :
                      'text-[#2eebc8]'
                    }`}>
                      {row.posicionEnCanal.toFixed(0)}%
                    </div>
                  </div>

                  {/* V1.9: Momentum */}
                  <div className="min-w-[80px]">
                    <div className="text-[9px] text-app-text4 uppercase">Momentum</div>
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[8px] font-bold border ${getMomentumBg(row.momentumLabel)}`}>
                      {row.momentumLabel}
                    </span>
                  </div>

                  {/* Score */}
                  <div className="min-w-[100px]">
                    <div className="text-[9px] text-app-text4 uppercase">Score</div>
                    <ScoreBar score={row.compositeScore} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="section-divider" />

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* V1.9 MODULE 4: RISK-ADJUSTED RANKING (S/R ceiling penalty)  */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <div className="glass-card p-5">
        <div className="flex items-center gap-2 mb-1">
          <h3 className="text-sm font-light text-app-text2">⚖️ Ranking Ajustado por Riesgo</h3>
          <span className="text-[9px] text-app-text4 font-mono">V1.9 · Penalización por estancamiento</span>
        </div>
        <p className="text-[10px] text-app-text4 mb-4">
          Ordenado por Atractivo de Entrada (Spread + Upside). Instrumentos en techo S/R penalizados al fondo.
        </p>
        <div className="overflow-x-auto max-h-[400px] overflow-y-auto custom-scrollbar">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-app-card z-10 table-header-enhanced">
              <tr className="text-[11px] uppercase tracking-wider font-medium text-app-text3 border-b border-app-border/60">
                <th className="px-4 py-3 text-left">#</th>
                <th className="px-4 py-3 text-left">Ticker</th>
                <th className="px-4 py-3 text-right">Atractivo</th>
                <th className="px-4 py-3 text-right">Upside</th>
                <th className="px-4 py-3 text-right">Canal</th>
                <th className="px-4 py-3 text-right">Spread</th>
                <th className="px-4 py-3 text-center">Hunting</th>
                <th className="px-4 py-3 text-center">Riesgo</th>
              </tr>
            </thead>
            <tbody>
              {riskAdjustedRanking.map((row, idx) => {
                const isHeld = position?.ticker === row.instrument.ticker;
                return (
                  <tr
                    key={row.instrument.ticker}
                    className={`
                      border-b border-app-border/60 table-row-highlight
                      ${isHeld ? 'bg-app-accent-dim/50 border-l-2 border-l-[#2eebc8]' : ''}
                      ${row.isTrampa ? 'bg-[#f87171]/5' : ''}
                      ${row.isCeiling ? 'bg-[#f87171]/5 opacity-70' : ''}
                    `}
                  >
                    <td className={`px-4 py-3 font-mono ${row.isCeiling ? 'text-[#f87171]' : 'text-app-text4'}`}>{idx + 1}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-medium text-app-text2">
                          {row.instrument.ticker}
                        </span>
                        {isHeld && (
                          <span className="text-[#2eebc8] text-[9px]">● EN CARTERA</span>
                        )}
                        {row.isTrampa && (
                          <span className="text-[#f87171] text-[8px] font-semibold badge-trampa">⚠️ TRAMPA</span>
                        )}
                        {row.isCeiling && (
                          <span className="text-[#f87171] text-[8px] font-semibold compra-pulse">🚨 TECHO</span>
                        )}
                        {row.instrument.iolLiquidityAlert && (
                          <span className="text-[#fbbf24] text-[8px] font-semibold bg-[#fbbf24]/15 px-1.5 py-0.5 rounded">⚠️ BAJA LIQUIDEZ</span>
                        )}
                        {row.instrument.iolStatus === 'online' && !row.instrument.iolLiquidityAlert && row.instrument.iolVolume && row.instrument.iolVolume > 0 && (
                          <span className="text-[#a78bfa] text-[8px] font-semibold bg-[#a78bfa]/15 px-1.5 py-0.5 rounded">✓ VOL IOL</span>
                        )}
                      </div>
                    </td>
                    <td className={`px-4 py-3 font-mono font-bold text-right ${
                      row.atractivoEntrada > 0.6 ? 'text-[#2eebc8]' : row.atractivoEntrada > 0.3 ? 'text-[#fbbf24]' : 'text-[#f87171]'
                    }`}>
                      {(row.atractivoEntrada * 100).toFixed(0)}%
                    </td>
                    <td className={`px-4 py-3 font-mono text-right ${
                      row.upsideCapital > 1.0 ? 'text-[#2eebc8]' : row.upsideCapital > 0.5 ? 'text-[#2eebc8]/70' : row.upsideCapital > 0.1 ? 'text-[#fbbf24]' : 'text-[#f87171]'
                    }`}>
                      +{row.upsideCapital.toFixed(2)}%
                    </td>
                    <td className={`px-4 py-3 font-mono font-medium text-right ${
                      row.posicionEnCanal > 90 ? 'text-[#f87171]' : row.posicionEnCanal > 70 ? 'text-[#fbbf24]' : 'text-[#2eebc8]'
                    }`}>
                      {row.posicionEnCanal.toFixed(0)}%
                    </td>
                    <td className={`px-4 py-3 font-mono text-right ${
                      row.spread > 0.25 ? 'text-[#2eebc8]' : row.spread > 0 ? 'text-[#fbbf24]' : 'text-[#f87171]'
                    }`}>
                      {row.spread >= 0 ? '+' : ''}{row.spread.toFixed(3)}%
                    </td>
                    <td className={`px-4 py-3 font-mono font-medium text-center ${
                      row.huntingScore >= 60 ? 'text-[#2eebc8]' : row.huntingScore >= 35 ? 'text-[#fbbf24]' : 'text-[#f87171]'
                    }`}>
                      {row.huntingScore.toFixed(0)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-block px-2.5 py-1 rounded-full text-[10px] font-semibold ${
                        row.riskLevel === 'Bajo'
                          ? 'bg-[#2eebc8]/15 text-[#2eebc8]'
                          : row.riskLevel === 'Medio'
                            ? 'bg-[#fbbf24]/15 text-[#fbbf24]'
                            : 'bg-[#f87171]/15 text-[#f87171]'
                      }`}>
                        {row.riskLevel}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="section-divider" />

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* V1.9 MODULE 5: HEATMAP (Spread + Upside formula)           */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <div className="glass-card p-5">
        <div className="flex items-center gap-2 mb-1">
          <h3 className="text-sm font-light text-app-text2">🌡️ Mapa de Calor — Atractivo de Entrada</h3>
          <span className="text-[9px] text-app-text4 font-mono">V1.9</span>
        </div>
        <p className="text-[10px] text-app-text4 mb-4">
          Fórmula: Spread Neto + Upside Residual. Verde intenso = bono barato con mucho camino. Frío = alta tasa pero en techo.
        </p>
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-[10px] border-collapse">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider font-medium text-app-text3">
                <th className="px-3 py-2 text-left border border-app-border/60 bg-app-subtle/30 sticky left-0 z-10">
                  Ticker
                </th>
                <th className="px-3 py-2 text-center border border-app-border/60 bg-app-subtle/30">Atractivo</th>
                <th className="px-3 py-2 text-center border border-app-border/60 bg-app-subtle/30">Upside</th>
                <th className="px-3 py-2 text-center border border-app-border/60 bg-app-subtle/30">Spread Neto</th>
                <th className="px-3 py-2 text-center border border-app-border/60 bg-app-subtle/30">Momentum</th>
                <th className="px-3 py-2 text-center border border-app-border/60 bg-app-subtle/30">Canal S/R</th>
                <th className="px-3 py-2 text-center border border-app-border/60 bg-app-subtle/30">Hunting</th>
              </tr>
            </thead>
            <tbody>
              {heatmapInstruments.map((row) => {
                // V1.9: Atractivo de Entrada as primary color driver
                const atractivo = row.atractivoEntrada;
                const upsideNorm = Math.min(Math.max(row.upsideCapital / 2.0, 0), 1);
                const spreadNorm = Math.min(Math.max((row.spreadNeto + 0.2) / 0.8, 0), 1);
                const momentumNorm = row.deltaTIR !== null
                  ? Math.min(Math.max((row.deltaTIR + 0.05) / 0.10, 0), 1)
                  : 0.5;
                const canalNorm = 1 - Math.min(Math.max(row.posicionEnCanal / 100, 0), 1); // lower canal = greener
                const huntingNorm = Math.min(Math.max(row.huntingScore / 100, 0), 1);

                return (
                  <tr
                    key={row.instrument.ticker}
                    className={`border-b border-app-border/60 ${position?.ticker === row.instrument.ticker ? 'bg-app-accent-dim/30' : ''} ${row.isCeiling ? 'opacity-60' : ''}`}
                  >
                    <td className="px-3 py-2 font-mono font-semibold text-app-text2 border border-app-border/60 bg-app-subtle/30 sticky left-0 z-10">
                      {row.instrument.ticker}
                      {position?.ticker === row.instrument.ticker && (
                        <span className="ml-1 text-[#2eebc8] text-[8px]">●</span>
                      )}
                      {row.isCeiling && (
                        <span className="ml-1 text-[#f87171] text-[8px]">🚨</span>
                      )}
                    </td>
                    {/* Atractivo cell */}
                    <td className={`px-3 py-2 text-center border border-app-border/60 ${getHeatColor(atractivo)}`}>
                      <span className={`font-mono font-bold ${getHeatTextColor(atractivo)}`}>
                        {(atractivo * 100).toFixed(0)}%
                      </span>
                    </td>
                    {/* Upside cell */}
                    <td className={`px-3 py-2 text-center border border-app-border/60 ${getHeatColor(upsideNorm)}`}>
                      <span className={`font-mono font-bold ${getHeatTextColor(upsideNorm)}`}>
                        +{row.upsideCapital.toFixed(2)}%
                      </span>
                    </td>
                    {/* Spread Neto cell */}
                    <td className={`px-3 py-2 text-center border border-app-border/60 ${getHeatColor(spreadNorm)}`}>
                      <span className={`font-mono font-bold ${getHeatTextColor(spreadNorm)}`}>
                        {row.spreadNeto >= 0 ? '+' : ''}{row.spreadNeto.toFixed(2)}%
                      </span>
                    </td>
                    {/* Momentum cell */}
                    <td className={`px-3 py-2 text-center border border-app-border/60 ${getHeatColor(momentumNorm)}`}>
                      <span className={`font-mono font-bold ${getHeatTextColor(momentumNorm)}`}>
                        {row.deltaTIR !== null
                          ? `${row.deltaTIR >= 0 ? '+' : ''}${row.deltaTIR.toFixed(3)}%`
                          : '—'
                        }
                      </span>
                    </td>
                    {/* Canal S/R cell */}
                    <td className={`px-3 py-2 text-center border border-app-border/60 ${getHeatColor(canalNorm, [0.3, 0.7])}`}>
                      <span className={`font-mono font-bold ${getHeatTextColor(canalNorm, [0.3, 0.7])}`}>
                        {row.posicionEnCanal.toFixed(0)}%
                      </span>
                    </td>
                    {/* Hunting Score cell */}
                    <td className={`px-3 py-2 text-center border border-app-border/60 ${getHeatColor(huntingNorm)}`}>
                      <span className={`font-mono font-bold ${getHeatTextColor(huntingNorm)}`}>
                        {row.huntingScore.toFixed(0)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Heatmap legend — V1.9 updated */}
        <div className="flex items-center gap-5 mt-3 pt-3 border-t border-app-border/60">
          <div className="flex items-center gap-2">
            <div className="w-3.5 h-3.5 rounded border border-[#2eebc8]/40" style={{ background: 'linear-gradient(135deg, rgba(46, 235, 200, 0.25), rgba(46, 235, 200, 0.10))' }} />
            <span className="text-[10px] text-app-text3 font-medium">Bono barato + camino por subir</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3.5 h-3.5 rounded border border-[#fbbf24]/40" style={{ background: 'linear-gradient(135deg, rgba(251, 191, 36, 0.25), rgba(251, 191, 36, 0.10))' }} />
            <span className="text-[10px] text-app-text3 font-medium">Entrada neutral</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3.5 h-3.5 rounded border border-[#f87171]/40" style={{ background: 'linear-gradient(135deg, rgba(248, 113, 113, 0.25), rgba(248, 113, 113, 0.10))' }} />
            <span className="text-[10px] text-app-text3 font-medium">Tasa alta pero en techo</span>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* V1.9 MODULE 6: METHODOLOGY (Capital Gain focus)            */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <div className="glass-card p-5">
        <h3 className="text-sm font-light text-app-text2 mb-3">📐 Metodología — V1.9 Punto Gatillo</h3>
        <div className="mb-3 p-3 rounded-xl bg-[#22d3ee]/5 border border-[#22d3ee]/20">
          <p className="text-xs text-app-text2">
            <span className="text-[#22d3ee] font-semibold">Optimización Capital Gain:</span> Esta pestaña prioriza instrumentos con <span className="text-[#2eebc8] font-medium">Momentum positivo</span> y <span className="text-[#2eebc8] font-medium">distancia amplia a la Resistencia S/R</span> por sobre el devengamiento de tasa puro. El algoritmo detecta el &quot;Punto Gatillo&quot;: el momento óptimo de entrada antes de un salto de precio.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-xs">
          <div className="bg-app-subtle/30 rounded-xl p-3">
            <div className="text-[#2eebc8] font-semibold mb-1">Upside Residual (40%)</div>
            <div className="text-app-text3">
              Distancia % a la resistencia de 15 días. Score = min(upside/2%, 1) × 4. Mayor upside = más espacio para captura de capital.
            </div>
          </div>
          <div className="bg-app-subtle/30 rounded-xl p-3">
            <div className="text-[#2eebc8] font-semibold mb-1">Momentum ΔTIR + Precio (35%)</div>
            <div className="text-app-text3">
              ΔTIR positivo + ΔPrecio positivo = impulso alcista. Acelerando/Alcista = señal de Punto Gatillo inminente.
            </div>
          </div>
          <div className="bg-app-subtle/30 rounded-xl p-3">
            <div className="text-[#2eebc8] font-semibold mb-1">Carry / Spread (30%)</div>
            <div className="text-app-text3">
              Spread vs caución. Score = min(spread/0.5, 1) × 3. Penalización: -1.5 pts si en Zona de Techo (&gt;90% canal S/R).
            </div>
          </div>
          <div className="bg-app-subtle/30 rounded-xl p-3">
            <div className="text-[#f87171] font-semibold mb-1">🚨 Zona de Techo (98.5% S/R)</div>
            <div className="text-app-text3">
              Si el precio alcanza el 98.5% de la resistencia → Alerta de Salida automática. El instrumento no tiene más recorrido.
            </div>
          </div>
          <div className="bg-app-subtle/30 rounded-xl p-3">
            <div className="text-[#22d3ee] font-semibold mb-1">🎯 Punto Caramelo</div>
            <div className="text-app-text3">
              Triple filtro: Spread Neto &gt; 0 + Upside &gt; 0.50% + Hunting Score &gt; 60 + Momentum Alcista/Acelerando. Entrada óptima.
            </div>
          </div>
          <div className="bg-app-subtle/30 rounded-xl p-3">
            <div className="text-[#fbbf24] font-semibold mb-1">⚖️ Penalización por Estancamiento</div>
            <div className="text-app-text3">
              Instrumentos en el último 10% del canal S/R (posicionEnCanal &gt; 90%) son penalizados en todos los rankings. El riesgo principal es el costo de oportunidad.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
