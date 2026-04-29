'use client';

import React, { useState, useMemo } from 'react';
import { Instrument, Config, Position, MomentumData, SRData, PriceHistoryFile } from '@/lib/types';
import {
  calculateCompositeSignal,
  calculateSwingSignal,
  scenarioPnL,
  spreadVsCaucion,
  caucionTEMFromTNA,
  durationMod,
  gDiaNeta,
  diasRecuperoComision,
  calculateRAE,
} from '@/lib/calculations';
import { calculateSR } from '@/lib/priceHistory';

interface EstrategiasTabProps {
  instruments: Instrument[];
  config: Config;
  position: Position | null;
  momentumMap: Map<string, MomentumData>;
  priceHistory: PriceHistoryFile | null;
}

// V1.4.4 FIX: Handle null deltaTIR
// V1.4 — Simplified arrows: only show when |deltaTIR| > 0.02%
function getTrendArrow(deltaTIR: number | null): { arrow: string; color: string } {
  if (deltaTIR === null) return { arrow: '', color: '#888' };
  if (deltaTIR > 0.02) return { arrow: '↑', color: '#2eebc8' };
  if (deltaTIR < -0.02) return { arrow: '↓', color: '#f87171' };
  return { arrow: '', color: '#888' };
}

function getScoreBar(score: number) {
  const pct = (score / 10) * 100;
  let color = '#f87171';
  if (score >= 7) color = '#2eebc8';
  else if (score >= 5) color = '#2eebc8';
  else if (score >= 3) color = '#fbbf24';
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-app-subtle rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="font-mono text-[10px] text-app-text3">{score.toFixed(1)}</span>
    </div>
  );
}

export default function EstrategiasTab({
  instruments,
  config,
  position,
  momentumMap,
  priceHistory,
}: EstrategiasTabProps) {
  const [activeView, setActiveView] = useState<'swing' | 'daytrade'>('swing');

  // ─── SWING VIEW DATA ───
  // V1.8.4: Pre-compute S/R data for penalty calculation
  const srDataMapForSignals = useMemo(() => {
    if (!priceHistory) return new Map<string, number>();
    const srArray = calculateSR(priceHistory, instruments);
    return new Map(srArray.map(sr => [sr.ticker, sr.posicionEnCanal]));
  }, [priceHistory, instruments]);

  const swingSignals = useMemo(
    () => instruments.map(inst => calculateCompositeSignal(inst, config, instruments, srDataMapForSignals.get(inst.ticker))),
    [instruments, config, srDataMapForSignals]
  );

  const currentInstrument = position
    ? instruments.find(i => i.ticker === position.ticker)
    : null;

  const scenarios = currentInstrument && position
    ? [
        { label: '-50bps', ...scenarioPnL(position, currentInstrument, -50, config.comisionTotal) },
        { label: '-25bps', ...scenarioPnL(position, currentInstrument, -25, config.comisionTotal) },
        { label: '+25bps', ...scenarioPnL(position, currentInstrument, 25, config.comisionTotal) },
        { label: '+50bps', ...scenarioPnL(position, currentInstrument, 50, config.comisionTotal) },
      ]
    : [];

  const currentSignal = position
    ? swingSignals.find(s => s.ticker === position.ticker)
    : null;

  const currentMomentum = position
    ? momentumMap.get(position.ticker)
    : null;

  const bestOpportunity = useMemo(
    () =>
      [...swingSignals]
        .filter(s => s.ticker !== position?.ticker)
        .sort((a, b) => b.compositeScore - a.compositeScore)[0],
    [swingSignals, position]
  );

  // ─── DAYTRADE VIEW DATA ───
  const daySignals = useMemo(
    () =>
      instruments.map(inst => {
        const swing = calculateSwingSignal(inst, config, instruments);
        const spread = spreadVsCaucion(inst.tem, config, inst.days);
        return { ...swing, spread, instrument: inst };
      }),
    [instruments, config]
  );

  const topPicks = useMemo(() => {
    return [...daySignals]
      .sort((a, b) => b.compositeScore - a.compositeScore)
      .slice(0, 3)
      .map(s => {
        const entryTarget = s.instrument.price * 0.998;
        const exitTarget = s.instrument.price * 1.005;
        const stopLoss = s.instrument.price * 0.997;

        let rationale = '';
        if (s.momentumScore > 6) rationale += 'Alto momentum. ';
        if (s.spreadScore > 6) rationale += 'Spread favorable. ';
        if (s.sensitivityScore > 6) rationale += 'Alta sensibilidad. ';
        if (s.liquidityScore > 6) rationale += 'Buena liquidez. ';
        if (!rationale) rationale = 'Score general positivo.';

        return { ticker: s.ticker, compositeScore: s.compositeScore, entryTarget, exitTarget, stopLoss, rationale, signal: s.signal };
      });
  }, [daySignals]);

  const caucionTEM1 = caucionTEMFromTNA(config.caucion1d);
  const caucionDailyReturn = caucionTEM1 / 30;
  const topPick = topPicks[0];
  const expectedTradingDaily = topPick ? (topPick.compositeScore / 10) * 0.3 : 0;

  const heatmapData = daySignals.map(s => ({
    ticker: s.ticker, type: s.type, momentum: s.momentumScore, spread: s.spreadScore,
    sensitivity: s.sensitivityScore, liquidity: s.liquidityScore, composite: s.compositeScore,
  }));

  const getHeatColor = (score: number): string => {
    if (score >= 7) return 'bg-[#2eebc8]/30';
    if (score >= 5) return 'bg-app-accent-dim';
    if (score >= 3) return 'bg-[#fbbf24]/15';
    return 'bg-app-danger-dim';
  };

  const getHeatTextColor = (score: number): string => {
    if (score >= 7) return 'text-[#2eebc8]';
    if (score >= 5) return 'text-[#2eebc8]/70';
    if (score >= 3) return 'text-[#fbbf24]';
    return 'text-[#f87171]';
  };

  // ─── V1.5: SUPPORT / RESISTANCE DATA ───
  const srData: SRData[] = useMemo(
    () => (priceHistory ? calculateSR(priceHistory, instruments) : []),
    [priceHistory, instruments]
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-light text-app-text mb-1">🎯 Estrategias</h2>
        <p className="text-sm text-app-text3">Señales compuestas, sensibilidad, análisis de escenarios y soporte/resistencia</p>
      </div>

      {/* ─── Toggle Buttons ─── */}
      <div className="flex gap-2">
        <button
          onClick={() => setActiveView('swing')}
          className={`px-5 py-2.5 text-sm rounded-xl transition-all ${
            activeView === 'swing'
              ? 'bg-[#2eebc8] text-[#0c1220] font-semibold shadow-sm shadow-[#2eebc8]/20'
              : 'bg-app-card text-app-text3 border border-app-border hover:bg-app-subtle/60 font-medium'
          }`}
        >
          🎯 Swing Trading
        </button>
        <button
          onClick={() => setActiveView('daytrade')}
          className={`px-5 py-2.5 text-sm rounded-xl transition-all ${
            activeView === 'daytrade'
              ? 'bg-[#2eebc8] text-[#0c1220] font-semibold shadow-sm shadow-[#2eebc8]/20'
              : 'bg-app-card text-app-text3 border border-app-border hover:bg-app-subtle/60 font-medium'
          }`}
        >
          ⚡ DayTrade
        </button>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* SWING VIEW                                                        */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {activeView === 'swing' && (
        <>
          {/* Current Position Quick Card */}
          {currentSignal && position && currentInstrument && (
            <div className="bg-app-card rounded-xl border border-app-border p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[11px] text-app-text3 font-medium uppercase tracking-wider">Tu Posición Actual</span>
                <span className="px-3 py-1 rounded-full text-xs font-medium" style={{ backgroundColor: currentSignal.signalColor + '20', color: currentSignal.signalColor }}>
                  {currentSignal.signalEmoji} {currentSignal.signal}
                </span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                <div>
                  <div className="text-[10px] text-app-text3">Instrumento</div>
                  <div className="font-mono font-medium text-app-text text-lg">{position.ticker}</div>
                </div>
                <div>
                  <div className="text-[10px] text-app-text3">Score Compuesto</div>
                  <div className="font-mono font-medium text-lg" style={{ color: currentSignal.signalColor }}>
                    {currentSignal.compositeScore.toFixed(1)}/10
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-app-text3">Momentum</div>
                  <div className={`font-mono text-sm font-medium ${currentSignal.momentumScore >= 5 ? 'text-[#2eebc8]' : 'text-[#fbbf24]'}`}>
                    {currentSignal.momentumLabel} ({currentSignal.momentumScore.toFixed(1)})
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-app-text3">Spread Caución</div>
                  <div className={`font-mono text-sm font-medium ${currentSignal.spreadScore >= 5 ? 'text-[#2eebc8]' : currentSignal.spreadScore >= 3 ? 'text-[#fbbf24]' : 'text-[#f87171]'}`}>
                    {currentSignal.spreadLabel} ({currentSignal.spreadScore.toFixed(1)})
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-app-text3">Duration</div>
                  <div className="font-mono text-sm font-medium text-app-text2">
                    {currentSignal.durationLabel} ({currentSignal.durationScore.toFixed(1)})
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-app-text3">Días Recupero Comisión</div>
                  <div className="font-mono text-sm font-medium text-[#fbbf24]">
                    {currentSignal.diasRecuperoComision >= 999 ? '∞' : `${currentSignal.diasRecuperoComision.toFixed(1)} días`}
                  </div>
                </div>
              </div>
              {/* V1.3 — Tapado warning for current position */}
              {currentMomentum?.esTapado && (
                <div className="mt-3 pt-3 border-t border-app-border/60 rounded-md p-2" style={{ backgroundColor: 'rgba(34,211,238,0.05)', borderColor: 'rgba(34,211,238,0.2)' }}>
                  <span className="text-xs" style={{ color: '#22d3ee' }}>⚠ Oportunidad en Desarrollo</span>
                  <span className="text-app-text3 text-xs ml-2">{currentMomentum.tapadoReason}</span>
                </div>
              )}
              {bestOpportunity && bestOpportunity.compositeScore > currentSignal.compositeScore + 1 && (
                <div className="mt-3 pt-3 border-t border-app-border/60 bg-[#fbbf24]/5 rounded-md p-2">
                  <span className="text-[#fbbf24] text-xs font-medium">🔄 ROTAR A {bestOpportunity.ticker}</span>
                  <span className="text-app-text3 text-xs ml-2">
                    Score {bestOpportunity.compositeScore.toFixed(1)} vs {currentSignal.compositeScore.toFixed(1)} (+{(bestOpportunity.compositeScore - currentSignal.compositeScore).toFixed(1)} diferencia)
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Signal Dashboard - Main Table */}
          <div className="bg-app-card rounded-xl border border-app-border overflow-hidden">
            <h3 className="text-sm font-light text-app-text2 px-5 pt-5 pb-2">Dashboard de Señales Compuestas</h3>
            <div className="text-[10px] text-app-text4 px-5 pb-2">
              Pesos: Momentum 25% | Spread vs Caución 35% | Duration 25% | G/día Neta 15%
            </div>
            <div className="overflow-x-auto max-h-[450px] overflow-y-auto custom-scrollbar">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-app-card z-10">
                  <tr className="text-[11px] uppercase tracking-wider font-medium text-app-text3 border-b border-app-border/60">
                    <th className="px-4 py-3 text-left">Ticker</th>
                    <th className="px-4 py-3 text-left">SEÑAL</th>
                    <th className="px-4 py-3 text-right">Score</th>
                    <th className="px-4 py-3 text-center">Momentum</th>
                    <th className="px-4 py-3 text-center">Spread</th>
                    <th className="px-4 py-3 text-center">Duration</th>
                    <th className="px-4 py-3 text-right">ΔTIR</th>
                    <th className="px-4 py-3 text-right">G/día Neta</th>
                    <th className="px-4 py-3 text-right">Días Recupero</th>
                    <th className="px-4 py-3 text-right">RAE</th>
                  </tr>
                </thead>
                <tbody>
                  {[...swingSignals]
                    .sort((a, b) => b.compositeScore - a.compositeScore)
                    .map((s) => {
                      const isHeld = position?.ticker === s.ticker;
                      const momentum = momentumMap.get(s.ticker);
                      const trendInfo = momentum ? getTrendArrow(momentum.deltaTIR) : null;
                      const isTapado = momentum?.esTapado ?? false;
                      return (
                        <tr key={s.ticker} className={`border-b border-app-border/60 hover:bg-app-subtle/30 ${isHeld ? 'bg-app-accent-dim border-l-2 border-l-[#2eebc8]' : ''}`}>
                          <td className="px-4 py-3 font-mono font-medium text-app-text2">
                            {s.ticker}
                            {isHeld && <span className="ml-1 text-[#2eebc8] text-[9px]">● EN CARTERA</span>}
                            {isTapado && (
                              <span className="ml-1 px-1.5 py-0.5 rounded text-[8px]" style={{ backgroundColor: 'rgba(34,211,238,0.15)', color: '#22d3ee' }}>
                                EN DESARROLLO
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-1 rounded-full text-[10px] font-medium whitespace-nowrap ${s.signal.includes('COMPRA') || s.signal.includes('BUY') ? 'compra-pulse' : ''}`} style={{ backgroundColor: s.signalColor + '20', color: s.signalColor }}>
                              {s.signalEmoji} {s.signal}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className="font-mono font-medium text-sm" style={{ color: s.signalColor }}>
                              {s.compositeScore.toFixed(1)}
                            </span>
                            <span className="text-app-text4 text-[10px]">/10</span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-col items-center gap-0.5">
                              {getScoreBar(s.momentumScore)}
                              <span className="text-[9px] text-app-text3">{s.momentumLabel}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-col items-center gap-0.5">
                              {getScoreBar(s.spreadScore)}
                              <span className="text-[9px] text-app-text3">{s.spreadLabel}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-col items-center gap-0.5">
                              {getScoreBar(s.durationScore)}
                              <span className="text-[9px] text-app-text3">{s.durationLabel}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 font-mono text-right">
                            {trendInfo && momentum && momentum.deltaTIR !== null ? (
                              <span style={{ color: trendInfo.arrow ? trendInfo.color : (momentum.deltaTIR >= 0 ? '#2eebc8' : '#f87171') }}>
                                {momentum.deltaTIR >= 0 ? '+' : ''}{momentum.deltaTIR.toFixed(3)}% {trendInfo.arrow}
                              </span>
                            ) : (
                              <span className="text-app-text4">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 font-mono text-[#2eebc8] text-right font-medium">
                            {s.gDiaNeta.toFixed(4)}%
                          </td>
                          <td className="px-4 py-3 font-mono text-right">
                            <span className={`font-medium ${s.diasRecuperoComision < 5 ? 'text-[#2eebc8]' : s.diasRecuperoComision < 10 ? 'text-[#fbbf24]' : 'text-[#f87171]'}`}>
                              {s.diasRecuperoComision >= 999 ? '∞' : s.diasRecuperoComision.toFixed(1)}d
                            </span>
                          </td>
                          <td className="px-4 py-3 font-mono text-app-text3 text-right">
                            {s.rae.toFixed(1)}%
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Sensitivity Table */}
          <div className="bg-app-card rounded-xl border border-app-border overflow-hidden">
            <h3 className="text-sm font-light text-app-text2 px-5 pt-5 pb-2">Sensibilidad al Movimiento de Tasas (Duration)</h3>
            <div className="text-[10px] text-app-text4 px-5 pb-2">
              Cuánto cambia el precio ante movimientos de tasas de ±10bps y ±25bps
            </div>
            <div className="overflow-x-auto max-h-[350px] overflow-y-auto custom-scrollbar">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-app-card z-10">
                  <tr className="text-[11px] uppercase tracking-wider font-medium text-app-text3 border-b border-app-border/60">
                    <th className="px-4 py-3 text-left">Ticker</th>
                    <th className="px-4 py-3 text-right">Precio Actual</th>
                    <th className="px-4 py-3 text-right">Dur. Mod.</th>
                    <th className="px-4 py-3 text-right">Precio −10bps</th>
                    <th className="px-4 py-3 text-right">Precio −25bps</th>
                    <th className="px-4 py-3 text-right">Precio +10bps</th>
                    <th className="px-4 py-3 text-right">Precio +25bps</th>
                  </tr>
                </thead>
                <tbody>
                  {[...swingSignals].sort((a, b) => Math.abs(b.durationMod) - Math.abs(a.durationMod)).map((s) => {
                    const inst = instruments.find(i => i.ticker === s.ticker);
                    return inst ? (
                      <tr key={s.ticker} className="border-b border-app-border/60 hover:bg-app-subtle/30">
                        <td className="px-4 py-3 font-mono font-medium text-app-text2">{s.ticker}</td>
                        <td className="px-4 py-3 font-mono text-app-text2 text-right">{inst.price.toFixed(4)}</td>
                        <td className="px-4 py-3 font-mono text-app-text3 text-right">{s.durationMod.toFixed(4)}</td>
                        <td className="px-4 py-3 font-mono text-[#2eebc8] text-right">{s.priceMinus10bps.toFixed(4)}</td>
                        <td className="px-4 py-3 font-mono text-[#2eebc8] text-right">{s.priceMinus25bps.toFixed(4)}</td>
                        <td className="px-4 py-3 font-mono text-[#f87171] text-right">{s.pricePlus10bps.toFixed(4)}</td>
                        <td className="px-4 py-3 font-mono text-[#f87171] text-right">{s.pricePlus25bps.toFixed(4)}</td>
                      </tr>
                    ) : null;
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Scenario Analysis for Current Position */}
          {currentInstrument && position && (
            <div className="bg-app-card rounded-xl border border-app-border p-5">
              <h3 className="text-sm font-light text-app-text2 mb-3">
                Análisis de Escenarios — {position.ticker} ({position.vn.toLocaleString()} VN @ ${position.entryPrice.toFixed(4)})
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {scenarios.map((sc) => (
                  <div key={sc.label} className={`rounded-xl border p-3 ${sc.pnl >= 0 ? 'bg-app-accent-dim border-app-accent-border' : 'bg-app-danger-dim border-red-500/20'}`}>
                    <div className="text-[10px] text-app-text3 mb-1">Tasas {sc.label}</div>
                    <div className={`text-sm font-mono font-medium ${sc.pnl >= 0 ? 'text-[#2eebc8]' : 'text-[#f87171]'}`}>
                      {sc.pnl >= 0 ? '+' : ''}${sc.pnl.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                    </div>
                    <div className={`text-[10px] font-mono ${sc.pnl >= 0 ? 'text-[#2eebc8]/70' : 'text-[#f87171]/70'}`}>
                      {sc.pnlPct >= 0 ? '+' : ''}{sc.pnlPct.toFixed(2)}%
                    </div>
                    <div className="text-[10px] text-app-text4 font-mono mt-1">
                      Precio: ${sc.newPrice.toFixed(4)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Commission Recovery Analysis */}
          <div className="bg-app-card rounded-xl border border-app-border p-5">
            <h3 className="text-sm font-light text-app-text2 mb-3">Días de Recupero de Comisión ({config.comisionTotal.toFixed(2)}% round-trip)</h3>
            <div className="text-[10px] text-app-text4 mb-3">
              Cuántos días tenés que mantener cada instrumento para que el carry cubra la comisión de entrada + salida
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {[...swingSignals].sort((a, b) => a.diasRecuperoComision - b.diasRecuperoComision).map((s) => {
                const isHeld = position?.ticker === s.ticker;
                return (
                  <div key={s.ticker} className={`rounded-xl border p-3 text-center ${isHeld ? 'bg-app-accent-dim border-app-accent-border' : 'bg-app-subtle/30 border-app-border/60'}`}>
                    <div className="font-mono font-medium text-app-text2 text-xs">{s.ticker}</div>
                    <div className={`font-mono font-medium text-lg mt-1 ${s.diasRecuperoComision < 5 ? 'text-[#2eebc8]' : s.diasRecuperoComision < 10 ? 'text-[#fbbf24]' : 'text-[#f87171]'}`}>
                      {s.diasRecuperoComision >= 999 ? '∞' : s.diasRecuperoComision.toFixed(1)}
                    </div>
                    <div className="text-[9px] text-app-text4">días</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Methodology */}
          <div className="bg-app-card rounded-xl border border-app-border p-5">
            <h3 className="text-sm font-light text-app-text2 mb-3">Metodología del Score Compuesto</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <div className="bg-app-subtle/30 rounded-xl p-3">
                <div className="text-[#2eebc8] font-medium mb-1">Momentum (25%)</div>
                <div className="text-app-text3">Cambio diario %. Alcista Fuerte &gt;+0.3%, Lateral ±0.1%, Bajista Fuerte &lt;-0.3%</div>
              </div>
              <div className="bg-app-subtle/30 rounded-xl p-3">
                <div className="text-[#2eebc8] font-medium mb-1">Spread vs Caución (35%)</div>
                <div className="text-app-text3">TEM instrumento vs caución equivalente. Muy Atractivo &gt;0.5%, Negativo &lt;0%</div>
              </div>
              <div className="bg-app-subtle/30 rounded-xl p-3">
                <div className="text-[#2eebc8] font-medium mb-1">Duration/Sensibilidad (25%)</div>
                <div className="text-app-text3">Mayor duración = mayor potencial ganancia si tasas bajan. Alta &gt;7, Baja &lt;4</div>
              </div>
              <div className="bg-app-subtle/30 rounded-xl p-3">
                <div className="text-[#2eebc8] font-medium mb-1">G/día Neta (15%)</div>
                <div className="text-app-text3">Ganancia diaria neta después de comisión. Ordena por rentabilidad real</div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* DAYTRADE VIEW                                                     */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {activeView === 'daytrade' && (
        <>
          {/* Top Picks */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {topPicks.map((pick, i) => (
              <div key={pick.ticker} className="bg-app-card rounded-xl border border-app-border p-5 relative">
                <div className="absolute top-3 right-3 text-2xl font-bold text-app-text4">#{i + 1}</div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="font-mono font-bold text-app-text text-lg">{pick.ticker}</span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-app-accent-dim text-[#2eebc8]">
                    {pick.signal}
                  </span>
                </div>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-app-text3">Score Compuesto</span>
                    <span className="font-mono font-bold text-[#2eebc8]">{pick.compositeScore.toFixed(1)}/10</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-app-text3">Entrada target</span>
                    <span className="font-mono font-medium text-app-text2">${pick.entryTarget.toFixed(4)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-app-text3">Salida target</span>
                    <span className="font-mono font-medium text-[#2eebc8]">${pick.exitTarget.toFixed(4)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-app-text3">Stop loss</span>
                    <span className="font-mono font-medium text-[#f87171]">${pick.stopLoss.toFixed(4)}</span>
                  </div>
                  <div className="pt-2 border-t border-app-border/60 text-app-text3 italic">
                    {pick.rationale}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Intraday Signal Heatmap */}
          <div className="bg-app-card rounded-xl border border-app-border overflow-hidden">
            <h3 className="text-sm font-light text-app-text2 px-5 pt-5 pb-2">Grilla de Señales Intradía (Heatmap)</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wider font-medium text-app-text3 border-b border-app-border/60">
                    <th className="px-4 py-3 text-left">Ticker</th>
                    <th className="px-4 py-3 text-center">Momentum</th>
                    <th className="px-4 py-3 text-center">Spread</th>
                    <th className="px-4 py-3 text-center">Sensibilidad</th>
                    <th className="px-4 py-3 text-center">Liquidez</th>
                    <th className="px-4 py-3 text-center">Compuesto</th>
                  </tr>
                </thead>
                <tbody>
                  {heatmapData.sort((a, b) => b.composite - a.composite).map((row) => (
                    <tr key={row.ticker} className="border-b border-app-border/60">
                      <td className="px-4 py-3 font-mono font-semibold text-app-text2">{row.ticker}</td>
                      {[
                        { val: row.momentum }, { val: row.spread }, { val: row.sensitivity },
                        { val: row.liquidity }, { val: row.composite },
                      ].map(({ val }, idx) => (
                        <td key={idx} className="px-4 py-3">
                          <div className={`mx-auto w-12 h-7 rounded flex items-center justify-center ${getHeatColor(val)}`}>
                            <span className={`font-mono text-[10px] font-bold ${getHeatTextColor(val)}`}>
                              {val.toFixed(1)}
                            </span>
                          </div>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Caución vs Trading */}
          <div className="bg-app-card rounded-xl border border-app-border p-5">
            <h3 className="text-sm font-light text-app-text2 mb-3">Caución vs Trading</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-[#fbbf24]/5 border border-[#fbbf24]/20 rounded-xl p-4">
                <div className="text-[10px] text-[#fbbf24]/60 mb-1">CAUCIÓN 1D (diario)</div>
                <div className="text-xl font-mono font-bold text-[#fbbf24]">
                  {caucionDailyReturn.toFixed(4)}%
                </div>
                <div className="text-[10px] text-app-text4 font-mono mt-1">
                  TEM: {caucionTEM1.toFixed(2)}% | TNA: {config.caucion1d.toFixed(1)}%
                </div>
              </div>
              <div className="bg-app-accent-dim border border-app-accent-border rounded-xl p-4">
                <div className="text-[10px] text-[#2eebc8]/60 mb-1">TRADING ESPERADO (diario)</div>
                <div className="text-xl font-mono font-bold text-[#2eebc8]">
                  ~{expectedTradingDaily.toFixed(4)}%
                </div>
                <div className="text-[10px] text-app-text4 font-mono mt-1">
                  Estimado basado en top pick score
                </div>
              </div>
            </div>
            <div className="mt-3 p-3 bg-app-subtle/30 rounded-xl">
              <div className="flex items-center gap-2 text-xs">
                <span className={`font-semibold ${expectedTradingDaily > caucionDailyReturn ? 'text-[#2eebc8]' : 'text-[#fbbf24]'}`}>
                  {expectedTradingDaily > caucionDailyReturn ? '✓ El trading potencial supera la caución' : '⚠ La caución podría ser mejor que el trading hoy'}
                </span>
              </div>
              <div className="text-[10px] text-app-text4 mt-1">
                Diferencial: {((expectedTradingDaily - caucionDailyReturn) * 100).toFixed(2)} bps diarios
              </div>
            </div>
          </div>

          {/* Trading Rules */}
          <div className="bg-app-card rounded-xl border border-app-border p-5">
            <h3 className="text-sm font-light text-app-text2 mb-3">Reglas de Day Trading</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <div className="bg-app-subtle/30 rounded-xl p-3">
                <div className="text-[#2eebc8] font-semibold mb-1">1. Entrada</div>
                <div className="text-app-text3">Solo operar cuando score compuesto ≥ 5.0. Preferir ≥ 7.0 para tamaño completo.</div>
              </div>
              <div className="bg-app-subtle/30 rounded-xl p-3">
                <div className="text-[#2eebc8] font-semibold mb-1">2. Salida</div>
                <div className="text-app-text3">Target: +0.5% mínimo. Stop: -0.3%. Nunca mantener overnight en day trade.</div>
              </div>
              <div className="bg-app-subtle/30 rounded-xl p-3">
                <div className="text-[#fbbf24] font-semibold mb-1">3. Gestión de Riesgo</div>
                <div className="text-app-text3">Riesgo máximo por operación: 0.3% del capital. Max 2 operaciones simultáneas.</div>
              </div>
              <div className="bg-app-subtle/30 rounded-xl p-3">
                <div className="text-[#fbbf24] font-semibold mb-1">4. Caución como Alternativa</div>
                <div className="text-app-text3">Si spread vs caución es negativo, mejor caución. Si trading no supera caución + 0.1%, reconsiderar.</div>
              </div>
              <div className="bg-app-subtle/30 rounded-xl p-3">
                <div className="text-[#f87171] font-semibold mb-1">5. Horarios</div>
                <div className="text-app-text3">Operar en horario de alta liquidez (11:00-14:00). Evitar primera y última hora.</div>
              </div>
              <div className="bg-app-subtle/30 rounded-xl p-3">
                <div className="text-[#f87171] font-semibold mb-1">6. Comisión</div>
                <div className="text-app-text3">Comisión total {config.comisionTotal.toFixed(2)}% ({(config.comisionTotal / 2).toFixed(2)}% compra + {(config.comisionTotal / 2).toFixed(2)}% venta). Necesitamos +{config.comisionTotal.toFixed(2)}% para break even.</div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* V1.5: SUPPORT / RESISTANCE (shared across both views)             */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {srData.length > 0 && (
        <div className="bg-app-card rounded-xl border border-app-border overflow-hidden">
          <div className="px-5 pt-5 pb-2">
            <h3 className="text-sm font-light text-app-text2">📊 Soporte / Resistencia (V1.8.4 — 15D)</h3>
            <div className="text-[10px] text-app-text4 mt-1">
              Basado en los últimos 15 días de historial de precios (sanitizado, sin basura). Verde = cerca de soporte (zona compra), Rojo = cerca de resistencia (zona venta).
            </div>
          </div>
          <div className="overflow-x-auto max-h-[400px] overflow-y-auto custom-scrollbar">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-app-card z-10">
                <tr className="text-[11px] uppercase tracking-wider font-medium text-app-text3 border-b border-app-border/60">
                  <th className="px-4 py-3 text-left">Ticker</th>
                  <th className="px-4 py-3 text-right">Precio Actual</th>
                  <th className="px-4 py-3 text-right">Soporte (min 15d)</th>
                  <th className="px-4 py-3 text-right">Dist. Soporte</th>
                  <th className="px-4 py-3 text-right">Resistencia (max 15d)</th>
                  <th className="px-4 py-3 text-right">Dist. Resistencia</th>
                  <th className="px-4 py-3 text-center">Canal</th>
                  <th className="px-4 py-3 text-center">Zona</th>
                </tr>
              </thead>
              <tbody>
                {srData.map((sr) => {
                  const isHeld = position?.ticker === sr.ticker;
                  // V1.8.4: Zone based on position in channel (not just distance)
                  const pct = sr.posicionEnCanal;
                  const isNearSupport = pct < 20;
                  const isNearResistance = pct > 80;
                  const zoneLabel = pct >= 90 ? 'TECHO' : isNearResistance ? 'VENTA' : isNearSupport ? 'COMPRA' : 'NEUTRAL';
                  const zoneColor = pct >= 90 ? 'text-[#f87171]' : isNearSupport ? 'text-[#2eebc8]' : isNearResistance ? 'text-[#f87171]' : 'text-app-text3';
                  const zoneBg = pct >= 90 ? 'bg-[#f87171]/15' : isNearSupport ? 'bg-[#2eebc8]/15' : isNearResistance ? 'bg-[#f87171]/15' : 'bg-app-subtle/30';

                  return (
                    <tr key={sr.ticker} className={`border-b border-app-border/60 hover:bg-app-subtle/30 ${isHeld ? 'bg-app-accent-dim/50' : ''}`}>
                      <td className="px-4 py-3 font-mono font-medium text-app-text2">
                        {sr.ticker}
                        {isHeld && <span className="ml-1 text-[#2eebc8] text-[9px]">●</span>}
                      </td>
                      <td className="px-4 py-3 font-mono text-app-text text-right font-semibold">${sr.precioActual.toFixed(4)}</td>
                      <td className="px-4 py-3 font-mono text-[#2eebc8] text-right">${sr.soporte.toFixed(4)}</td>
                      <td className="px-4 py-3 font-mono text-right">
                        <span className={isNearSupport ? 'text-[#2eebc8] font-semibold' : 'text-app-text3'}>
                          {sr.distanciaSoporte.toFixed(2)}%
                        </span>
                        {isNearSupport && (
                          <span className="ml-1 text-[9px] text-[#2eebc8]">▲ ZONA COMPRA</span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-[#f87171] text-right">${sr.resistencia.toFixed(4)}</td>
                      <td className="px-4 py-3 font-mono text-right">
                        <span className={isNearResistance ? 'text-[#f87171] font-semibold' : 'text-app-text3'}>
                          {sr.distanciaResistencia.toFixed(2)}%
                        </span>
                        {isNearResistance && (
                          <span className="ml-1 text-[9px] text-[#f87171]">▼ ZONA VENTA</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {/* V1.8.4: Canal % badge */}
                        <span
                          className="inline-block font-mono font-bold text-[10px] px-1.5 py-0.5 rounded"
                          style={{ backgroundColor: `${pct >= 90 ? '#f87171' : pct >= 70 ? '#fbbf24' : '#2eebc8'}15`, color: pct >= 90 ? '#f87171' : pct >= 70 ? '#fbbf24' : '#2eebc8' }}
                        >
                          {pct.toFixed(0)}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold ${zoneColor} ${zoneBg} ${zoneLabel === 'COMPRA' ? 'compra-pulse' : ''}`}>
                          {zoneLabel}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* S/R Visual Range Bars */}
          <div className="px-5 py-3 border-t border-app-border/60">
            <div className="text-[11px] text-app-text3 mb-2 font-medium uppercase tracking-wide">Rango de Precio por Instrumento</div>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {srData.map((sr) => {
                // V1.8.4: Use posicionEnCanal from SRData
                const clampedPct = Math.max(0, Math.min(100, sr.posicionEnCanal));
                const isNearSupport = clampedPct < 20;
                const isNearResistance = clampedPct > 80;
                const dotColor = clampedPct >= 90 ? '#f87171' : isNearSupport ? '#2eebc8' : isNearResistance ? '#f87171' : '#2eebc8';

                return (
                  <div key={sr.ticker} className="bg-app-subtle/30 rounded-xl p-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono text-[10px] font-medium text-app-text2">{sr.ticker}</span>
                      <span className="font-mono text-[9px] text-app-text3">${sr.precioActual.toFixed(4)}</span>
                    </div>
                    <div className="relative h-3 bg-[#f87171]/10 rounded-full overflow-hidden">
                      {/* Support zone (green on left) */}
                      <div className="absolute inset-y-0 left-0 bg-[#2eebc8]/20 rounded-l-full" style={{ width: '30%' }} />
                      {/* Resistance zone (red on right) */}
                      <div className="absolute inset-y-0 right-0 bg-[#f87171]/20 rounded-r-full" style={{ width: '30%' }} />
                      {/* Current price marker */}
                      <div
                        className="absolute top-0 bottom-0 w-1 rounded-full"
                        style={{ left: `${clampedPct}%`, backgroundColor: dotColor, transform: 'translateX(-50%)' }}
                      />
                    </div>
                    <div className="flex justify-between mt-0.5">
                      <span className="font-mono text-[8px] text-[#2eebc8]">${sr.soporte.toFixed(4)}</span>
                      <span className="font-mono text-[8px] text-[#f87171]">${sr.resistencia.toFixed(4)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {srData.length === 0 && (
        <div className="bg-app-card rounded-xl border border-app-border p-5">
          <div className="text-center text-app-text3 text-sm">
            📊 Soporte/Resistencia no disponible — cargá el archivo de historial de precios para habilitar esta sección.
          </div>
        </div>
      )}

      {!position && (
        <div className="bg-app-card rounded-xl border border-app-border p-6 text-center">
          <p className="text-app-text3 text-sm">Agregá una posición en Cartera para ver el análisis de escenarios y rotación.</p>
        </div>
      )}

      <style jsx>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(255,255,255,0.02);
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255,255,255,0.1);
          border-radius: 3px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255,255,255,0.2);
        }
      `}</style>
    </div>
  );
}
