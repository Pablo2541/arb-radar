'use client';

import React from 'react';
import {
  Instrument, Config, Position, MomentumData, RotationAnalysis, CompositeSignal,
} from '@/lib/types';
import { PriceHistoryFile, calculateSR } from '@/lib/priceHistory';
import {
  generateDiagnostic, analyzeRotation, calculateCompositeSignal, calculatePnL,
  spreadVsCaucion, gDiaNeta, diasRecuperoComision, calculateRAE,
  caucionTEMFromTNA, durationMod, analyzeCurveShape, detectCurveAnomalies,
  getCaucionForDays,
} from '@/lib/calculations';

export interface DiagnosticoTabProps {
  instruments: Instrument[];
  config: Config;
  position: Position | null;
  mepRate?: number;
  momentumMap: Map<string, MomentumData>;
  priceHistory: PriceHistoryFile | null;
}

// ── Carry Gauge SVG Meter ──
function CarryGauge({ value, max, label, sublabel }: { value: number; max: number; label: string; sublabel?: string }) {
  const pct = Math.min(1, Math.max(0, value / max));
  const angle = pct * 180;
  const rad = (angle - 180) * (Math.PI / 180);
  const cx = 60, cy = 55, r = 42;
  const x = cx + r * Math.cos(rad);
  const y = cy + r * Math.sin(rad);

  let arcColor = '#2eebc8';
  if (pct < 0.25) arcColor = '#f87171';
  else if (pct < 0.5) arcColor = '#fbbf24';
  else if (pct < 0.75) arcColor = '#22d3ee';

  return (
    <div className="flex flex-col items-center">
      <svg width="120" height="70" viewBox="0 0 120 70">
        {/* Background arc */}
        <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`} fill="none" stroke="rgba(148,163,184,0.1)" strokeWidth="8" strokeLinecap="round" />
        {/* Filled arc */}
        <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`} fill="none" stroke={arcColor} strokeWidth="8" strokeLinecap="round" strokeDasharray={`${pct * Math.PI * r} ${Math.PI * r}`} opacity={0.8} />
        {/* Needle */}
        <line x1={cx} y1={cy} x2={x} y2={y} stroke={arcColor} strokeWidth="2" strokeLinecap="round" />
        <circle cx={cx} cy={cy} r="3" fill={arcColor} />
        {/* Value */}
        <text x={cx} y={cy + 14} textAnchor="middle" fill="var(--app-text)" fontSize="11" fontFamily="monospace" fontWeight="600">{label}</text>
      </svg>
      {sublabel && <div className="text-[9px] text-app-text4 font-mono mt-0.5">{sublabel}</div>}
    </div>
  );
}

// ── Donut Ring for % metric ──
function PercentRing({ value, total, color, label }: { value: number; total: number; color: string; label: string }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  const r = 28;
  const circ = 2 * Math.PI * r;
  const offset = circ - (pct / 100) * circ;

  return (
    <div className="flex flex-col items-center">
      <svg width="72" height="72" viewBox="0 0 72 72">
        <circle cx="36" cy="36" r={r} fill="none" stroke="rgba(148,163,184,0.08)" strokeWidth="6" />
        <circle cx="36" cy="36" r={r} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={offset}
          transform="rotate(-90 36 36)" opacity={0.8} />
        <text x="36" y="34" textAnchor="middle" fill="var(--app-text)" fontSize="13" fontFamily="monospace" fontWeight="700">{value}</text>
        <text x="36" y="46" textAnchor="middle" fill="var(--app-text4)" fontSize="8" fontFamily="monospace">de {total}</text>
      </svg>
      <div className="text-[9px] text-app-text3 mt-1 text-center">{label}</div>
    </div>
  );
}

// ── Executive Alert Card ──
function AlertCard({ level, title, message, icon }: { level: 'danger' | 'warning' | 'info'; title: string; message: string; icon: string }) {
  const bgMap = { danger: 'bg-[#f87171]/8 border-[#f87171]/20', warning: 'bg-[#fbbf24]/8 border-[#fbbf24]/20', info: 'bg-[#22d3ee]/8 border-[#22d3ee]/20' };
  const textMap = { danger: 'text-[#f87171]', warning: 'text-[#fbbf24]', info: 'text-[#22d3ee]' };
  return (
    <div className={`rounded-xl border p-3.5 ${bgMap[level]}`}>
      <div className="flex items-start gap-2.5">
        <span className="text-sm mt-0.5">{icon}</span>
        <div>
          <div className={`text-xs font-medium ${textMap[level]} mb-0.5`}>{title}</div>
          <div className="text-[10px] text-app-text3 leading-relaxed">{message}</div>
        </div>
      </div>
    </div>
  );
}

export default function DiagnosticoTab({ instruments, config, position, mepRate, momentumMap, priceHistory }: DiagnosticoTabProps) {
  const diagnostic = generateDiagnostic(instruments, config, position, mepRate);
  const positionInstrument = position ? instruments.find(i => i.ticker === position.ticker) : null;

  // ── Carry calculation ──
  let carryTotal = 0;
  let carryPct = 0;
  let daysHeld = 0;
  if (position && positionInstrument) {
    const parts = position.entryDate.split('/');
    if (parts.length === 3) {
      const entryDate = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
      const now = new Date(); // V2.0.5 FIX: Dynamic date for accurate days held
      daysHeld = Math.max(0, Math.ceil((now.getTime() - entryDate.getTime()) / (86400000)));
    }
    carryPct = (positionInstrument.tem / 100) * (daysHeld / 30);
    carryTotal = carryPct * config.capitalDisponible;
  }

  // ── P&L ──
  const pnlData = position && positionInstrument ? calculatePnL(position, positionInstrument.price, config.comisionTotal) : null;

  // ── Red Zone: instruments with TEM ≤ 1.6% (below caución) ──
  const caucionTEM1 = caucionTEMFromTNA(config.caucion1d);
  const redZoneInstruments = instruments.filter(i => i.tem <= caucionTEM1 && i.tem > 0);
  const redZonePct = instruments.length > 0 ? (redZoneInstruments.length / instruments.length) * 100 : 0;

  // ── Best 3 opportunities (composite score) ──
  // V1.8.4: Pass S/R position for penalty calculation
  const allSignals = instruments.map(inst => {
    let srPos: number | undefined;
    if (priceHistory) {
      const srArr = calculateSR(priceHistory, [inst]);
      if (srArr.length > 0) srPos = srArr[0].posicionEnCanal;
    }
    return calculateCompositeSignal(inst, config, instruments, srPos);
  });
  const top3Opportunities = [...allSignals].sort((a, b) => b.compositeScore - a.compositeScore).slice(0, 3);

  // ── Best 3 rotations ──
  const topRotations: (RotationAnalysis & { fromTicker: string })[] = [];
  if (position) {
    const currentTEM = positionInstrument?.tem ?? 0;
    const currentDays = positionInstrument?.days ?? 0;
    const allRots = instruments.filter(i => i.ticker !== position.ticker).map(inst => ({ ...analyzeRotation(currentTEM, currentDays, inst, config.comisionTotal), fromTicker: position.ticker })).sort((a, b) => b.spreadNeto - a.spreadNeto);
    topRotations.push(...allRots.slice(0, 3));
  } else if (instruments.length >= 2) {
    const sortedByTEM = [...instruments].sort((a, b) => b.tem - a.tem);
    const highestTEM = sortedByTEM[0];
    const rots = sortedByTEM.slice(1).map(inst => ({ ...analyzeRotation(highestTEM.tem, highestTEM.days, inst, config.comisionTotal), fromTicker: highestTEM.ticker })).sort((a, b) => b.spreadNeto - a.spreadNeto);
    topRotations.push(...rots.slice(0, 3));
  }

  // ── Curve analysis ──
  const curveAnalysis = analyzeCurveShape(instruments);
  const anomalies = detectCurveAnomalies(instruments);

  // ── Verdict ──
  const verdictColor = { MANTENER: '#2eebc8', ROTAR: '#fbbf24', VENDER: '#f87171', COMPRAR: '#2eebc8', SIN_POSICION: '#4f5b73' }[diagnostic.positionVerdict] ?? '#4f5b73';
  const verdictEmoji = { MANTENER: '✅', ROTAR: '🔄', VENDER: '🔴', COMPRAR: '🟢', SIN_POSICION: '⚫' }[diagnostic.positionVerdict] ?? '⚫';

  // ── Health Score (0-100) ──
  const healthScore = (() => {
    let score = 50;
    if (position && positionInstrument) {
      if (positionInstrument.tem > caucionTEM1) score += 15;
      else score -= 20;
      const spread = spreadVsCaucion(positionInstrument.tem, config, positionInstrument.days);
      if (spread > 0.25) score += 15;
      else if (spread > 0) score += 5;
      else score -= 10;
      if (daysHeld > 5) score += 5;
      if (carryPct > 0.01) score += 10;
    } else {
      score = 30;
    }
    if (redZonePct < 20) score += 10;
    else if (redZonePct > 50) score -= 15;
    if (curveAnalysis.shape === 'NORMAL') score += 5;
    else if (curveAnalysis.shape === 'INVERTIDA') score -= 10;
    return Math.max(0, Math.min(100, score));
  })();

  const healthLabel = healthScore >= 80 ? 'Saludable' : healthScore >= 60 ? 'Aceptable' : healthScore >= 40 ? 'Precaución' : 'Riesgosa';
  const healthColor = healthScore >= 80 ? '#2eebc8' : healthScore >= 60 ? '#22d3ee' : healthScore >= 40 ? '#fbbf24' : '#f87171';

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-light text-app-text mb-0.5">🩺 Diagnóstico</h2>
        <p className="text-sm text-app-text4 font-light">Salud de cartera, carry total y alertas ejecutivas</p>
      </div>

      {/* ═══════════════════════════════════════════════════════════
          1. PORTFOLIO HEALTH — Visual gauge + metrics
          ═══════════════════════════════════════════════════════════ */}
      <div className="glass-card p-6">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <span className="text-2xl">{verdictEmoji}</span>
            <div>
              <div className="text-xl font-medium" style={{ color: verdictColor }}>{diagnostic.positionVerdict}</div>
              <div className="text-xs text-app-text4 font-light">{diagnostic.positionVerdictReason}</div>
            </div>
          </div>
          {/* Health Score Ring */}
          <svg width="80" height="80" viewBox="0 0 80 80">
            <circle cx="40" cy="40" r="34" fill="none" stroke="rgba(148,163,184,0.08)" strokeWidth="6" />
            <circle cx="40" cy="40" r="34" fill="none" stroke={healthColor} strokeWidth="6" strokeLinecap="round"
              strokeDasharray={`${(healthScore / 100) * 2 * Math.PI * 34} ${2 * Math.PI * 34}`}
              transform="rotate(-90 40 40)" opacity={0.85} />
            <text x="40" y="38" textAnchor="middle" fill={healthColor} fontSize="18" fontFamily="monospace" fontWeight="700">{healthScore}</text>
            <text x="40" y="50" textAnchor="middle" fill="var(--app-text4)" fontSize="7" fontFamily="monospace" style={{ textTransform: 'uppercase' }}>{healthLabel}</text>
          </svg>
        </div>

        {/* Visual Gauges Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
          {/* Carry Gauge */}
          <div className="bg-app-subtle/40 rounded-xl p-4 flex flex-col items-center">
            <div className="text-[9px] text-app-text4 uppercase tracking-wider mb-2">Carry Total</div>
            <CarryGauge value={carryPct * 100} max={5} label={carryPct > 0 ? `${(carryPct * 100).toFixed(2)}%` : '—'} sublabel={carryTotal > 0 ? `$${carryTotal.toLocaleString('es-AR', { maximumFractionDigits: 0 })}` : undefined} />
          </div>

          {/* Red Zone Ring */}
          <div className="bg-app-subtle/40 rounded-xl p-4 flex flex-col items-center">
            <div className="text-[9px] text-app-text4 uppercase tracking-wider mb-2">Zona Roja TEM</div>
            <PercentRing value={redZoneInstruments.length} total={instruments.length} color={redZonePct > 40 ? '#f87171' : redZonePct > 20 ? '#fbbf24' : '#2eebc8'} label={`TEM ≤ ${caucionTEM1.toFixed(1)}%`} />
            <div className="text-[10px] font-mono mt-1" style={{ color: redZonePct > 40 ? '#f87171' : redZonePct > 20 ? '#fbbf24' : '#2eebc8' }}>
              {redZonePct.toFixed(0)}% del portfolio
            </div>
          </div>

          {/* P&L */}
          <div className="bg-app-subtle/40 rounded-xl p-4 flex flex-col items-center justify-center">
            <div className="text-[9px] text-app-text4 uppercase tracking-wider mb-2">P&L Actual</div>
            {pnlData ? (
              <>
                <div className="text-xl font-mono font-bold" style={{ color: pnlData.pnl >= 0 ? '#2eebc8' : '#f87171' }}>
                  {pnlData.pnl >= 0 ? '+' : ''}${(pnlData?.pnl ?? 0).toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                </div>
                <div className="text-[10px] font-mono" style={{ color: pnlData.pnlPct >= 0 ? '#2eebc8' : '#f87171' }}>
                  {pnlData.pnlPct >= 0 ? '+' : ''}{(pnlData?.pnlPct ?? 0).toFixed(2)}%
                </div>
              </>
            ) : (
              <div className="text-xl font-mono text-app-text4">—</div>
            )}
          </div>

          {/* Days Held */}
          <div className="bg-app-subtle/40 rounded-xl p-4 flex flex-col items-center justify-center">
            <div className="text-[9px] text-app-text4 uppercase tracking-wider mb-2">Días en Posición</div>
            <div className="text-xl font-mono font-bold text-app-text">
              {daysHeld > 0 ? `${daysHeld}d` : '—'}
            </div>
            {position && (
              <div className="text-[9px] text-app-text4 font-mono">Desde {position.entryDate}</div>
            )}
          </div>
        </div>

        {/* Red Zone Detail */}
        {redZoneInstruments.length > 0 && (
          <div className="bg-[#f87171]/5 border border-[#f87171]/15 rounded-xl p-3.5">
            <div className="text-[10px] font-medium text-[#f87171] mb-2">⚠️ Instrumentos en Zona Roja (TEM ≤ caución equivalente)</div>
            <div className="flex flex-wrap gap-2">
              {redZoneInstruments.map(inst => (
                <span key={inst.ticker} className="px-2.5 py-1 rounded-lg text-[10px] font-mono font-medium bg-[#f87171]/10 text-[#f87171] border border-[#f87171]/20">
                  {inst.ticker} ({(inst?.tem ?? 0).toFixed(2)}% TEM)
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════
          2. EXECUTIVE ALERTS
          ═══════════════════════════════════════════════════════════ */}
      <div className="bg-app-card rounded-xl border border-app-border p-5">
        <h3 className="text-sm font-medium text-app-text2 mb-4">🔔 Alertas Ejecutivas</h3>
        <div className="space-y-2.5">
          {/* Build alerts dynamically */}
          {redZonePct > 50 && (
            <AlertCard level="danger" title="Mayoría en Zona Roja" message={`${redZonePct.toFixed(0)}% de los instrumentos tienen TEM por debajo de la caución (${caucionTEM1.toFixed(2)}%). Considerar caución o rotar a instrumentos de mayor rendimiento.`} icon="🚨" />
          )}
          {redZonePct > 20 && redZonePct <= 50 && (
            <AlertCard level="warning" title="Zona Roja Significativa" message={`${redZoneInstruments.length} instrumento(s) con TEM bajo caución. Monitorear de cerca.`} icon="⚠️" />
          )}
          {curveAnalysis.shape === 'INVERTIDA' && (
            <AlertCard level="danger" title="Curva Invertida" message="La curva de tasas está invertida: instrumentos cortos pagan más que largos. Señal de estrés en el mercado." icon="📉" />
          )}
          {curveAnalysis.shape === 'CON_ANOMALIAS' && (
            <AlertCard level="warning" title="Anomalías en Curva" message={`Se detectaron ${anomalies.length} anomalías en la curva de tasas. Revisar posiciones afectadas.`} icon="🚨" />
          )}
          {diagnostic.mepAlert && (
            <AlertCard level="danger" title="Alerta Cambiaria MEP" message={diagnostic.mepMessage || 'Dólar MEP en zona de alerta.'} icon="💱" />
          )}
          {config.riesgoPais > 550 && (
            <AlertCard level={config.riesgoPais > 650 ? 'danger' : 'warning'} title={`Riesgo País: ${config.riesgoPais} pb`} message={config.riesgoPais > 650 ? 'Zona de peligro. Considerar reducir exposición.' : 'Zona de alerta. Monitorear de cerca.'} icon="🌐" />
          )}
          {position && positionInstrument && topRotations.length > 0 && topRotations[0].spreadNeto > 0.15 && (
            <AlertCard level="info" title={`Oportunidad de Rotación: ${topRotations[0].toTicker}`} message={`Spread neto +${topRotations[0].spreadNeto.toFixed(3)}% vs posición actual. PE en ${topRotations[0].diasPE.toFixed(0)} días.`} icon="🔄" />
          )}
          {redZonePct <= 20 && curveAnalysis.shape === 'NORMAL' && !diagnostic.mepAlert && config.riesgoPais <= 550 && (
            <AlertCard level="info" title="Sin Alertas Críticas" message="El mercado y tu cartera están en condiciones normales. Continuar monitoreando." icon="✅" />
          )}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════
          3. TOP 3 OPORTUNIDADES ESTRATÉGICAS
          ═══════════════════════════════════════════════════════════ */}
      <div className="bg-app-card rounded-xl border border-app-border p-5">
        <h3 className="text-sm font-medium text-app-text2 mb-4">🎯 Top 3 Oportunidades Estratégicas</h3>
        {top3Opportunities.length > 0 ? (
          <div className="space-y-2.5">
            {top3Opportunities.map((sig, i) => {
              const isHeld = position?.ticker === sig.ticker;
              return (
                <div key={sig.ticker} className={`flex items-center justify-between p-4 rounded-xl border border-l-4 transition-colors ${isHeld ? 'bg-app-accent-dim/30 border-app-accent-border/30 border-l-[#2eebc8]' : 'bg-app-subtle/30 border-app-border/60 border-l-[#2eebc8]'}`}>
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-mono font-bold text-app-text4 w-7">#{i + 1}</span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-medium text-app-text">{sig.ticker}</span>
                        <span className={`px-2 py-0.5 rounded-md text-[9px] font-medium ${instruments.find(inst => inst.ticker === sig.ticker)?.type === 'LECAP' ? 'bg-app-accent-dim text-[#2eebc8]' : 'bg-[#f472b6]/10 text-[#f472b6]'}`}>
                          {sig.type}
                        </span>
                        {isHeld && <span className="px-1.5 py-0.5 rounded text-[8px] font-medium bg-app-accent-dim text-[#2eebc8]">EN CARTERA</span>}
                      </div>
                      <div className="text-[10px] text-app-text4 mt-0.5">
                        Momentum: {sig.momentumLabel} ({sig.momentumScore.toFixed(1)}) · Spread: {sig.spreadLabel} ({sig.spreadScore.toFixed(1)}) · G/día: {sig.gDiaNeta.toFixed(4)}%
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <div className="font-mono text-lg font-bold" style={{ color: sig.signalColor }}>{sig.compositeScore.toFixed(1)}</div>
                      <div className="text-[9px] text-app-text4">/10 score</div>
                    </div>
                    <div className="px-2.5 py-1.5 rounded-lg text-[10px] font-medium" style={{ backgroundColor: sig.signalColor + '15', color: sig.signalColor }}>
                      {sig.signalEmoji} {sig.signal}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-xs text-app-text4 py-6 text-center">Cargá datos para ver oportunidades.</div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════
          4. TOP 3 ROTACIONES (if position)
          ═══════════════════════════════════════════════════════════ */}
      {topRotations.length > 0 && (
        <div className="bg-app-card rounded-xl border border-app-border p-5">
          <h3 className="text-sm font-medium text-app-text2 mb-4">🔄 Top 3 Rotaciones</h3>
          <div className="space-y-2.5">
            {topRotations.map((rot, i) => {
              const isTrampa = rot.evaluacion === 'TRAMPA';
              return (
                <div key={`rot-${i}-${rot.toTicker}`} className={`flex items-center justify-between p-4 rounded-xl border border-l-4 ${isTrampa ? 'bg-[#f87171]/5 border-[#f87171]/15 border-l-[#f87171]' : 'bg-app-subtle/30 border-app-border/60 border-l-[#2eebc8]'}`}>
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-mono font-bold text-app-text4 w-7">#{i + 1}</span>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-sm font-medium text-app-text">{rot.fromTicker}</span>
                        <span className="text-app-text4 text-xs">→</span>
                        <span className="font-mono text-sm font-medium text-[#2eebc8]">{rot.toTicker}</span>
                      </div>
                      <div className="text-[10px] text-app-text4 mt-0.5">
                        {rot.fromTEM.toFixed(2)}% → {rot.toTEM.toFixed(2)}% TEM · {rot.toDays}d · PE: {rot.diasPE.toFixed(0)}d
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <div className="font-mono text-sm font-bold" style={{ color: rot.spreadNeto > 0 ? '#2eebc8' : rot.spreadNeto > -0.1 ? '#fbbf24' : '#f87171' }}>
                        {rot.spreadNeto >= 0 ? '+' : ''}{rot.spreadNeto.toFixed(3)}%
                      </div>
                      <div className="text-[9px] text-app-text4">spread neto</div>
                    </div>
                    <span className={`px-2.5 py-1.5 rounded-lg text-[10px] font-medium ${isTrampa ? 'bg-[#f87171]/10 text-[#f87171]' : rot.spreadNeto > 0.15 ? 'bg-app-accent-dim text-[#2eebc8]' : 'bg-app-subtle text-app-text3'}`}>
                      {isTrampa && '🚫 '}{rot.evaluacion}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════
          5. CURVE SHAPE + ANOMALIES (compact)
          ═══════════════════════════════════════════════════════════ */}
      <div className="bg-app-card rounded-xl border border-app-border p-5">
        <h3 className="text-sm font-medium text-app-text2 mb-4">📈 Análisis de Curva</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          <div className={`rounded-xl border p-4 ${curveAnalysis.shape === 'NORMAL' ? 'bg-app-accent-dim/30 border-app-accent-border/30' : curveAnalysis.shape === 'INVERTIDA' ? 'bg-[#f87171]/5 border-[#f87171]/15' : 'bg-[#fbbf24]/5 border-[#fbbf24]/15'}`}>
            <div className="text-[9px] text-app-text3 uppercase tracking-wider mb-1">Forma</div>
            <div className="text-lg font-medium text-app-text">{curveAnalysis.shape.replace('_', ' ')}</div>
            <div className="text-[10px] text-app-text4">Pendiente: {curveAnalysis.slope.toFixed(3)}%/30d</div>
          </div>
          <div className={`rounded-xl border p-4 ${anomalies.length === 0 ? 'bg-app-accent-dim/30 border-app-accent-border/30' : 'bg-[#fbbf24]/5 border-[#fbbf24]/15'}`}>
            <div className="text-[9px] text-app-text3 uppercase tracking-wider mb-1">Anomalías</div>
            <div className="text-lg font-medium text-app-text">{anomalies.length}</div>
            <div className="text-[10px] text-app-text4">{anomalies.filter(a => a.severity === 'CRITICA').length} crítica(s)</div>
          </div>
          <div className="rounded-xl border p-4 bg-app-subtle/30 border-app-border/60">
            <div className="text-[9px] text-app-text3 uppercase tracking-wider mb-1">Descripción</div>
            <div className="text-xs text-app-text2 font-light leading-relaxed">{curveAnalysis.description}</div>
          </div>
        </div>

        {anomalies.length > 0 && (
          <div className="space-y-2">
            {anomalies.slice(0, 5).map((a, i) => {
              const affectsPos = position?.ticker === a.longerTicker || position?.ticker === a.shorterTicker;
              return (
                <div key={`anom-${i}`} className={`text-[11px] p-3 rounded-lg border-l-4 ${affectsPos ? 'bg-[#f87171]/5' : 'bg-app-subtle/20'}`} style={{ borderLeftColor: a.severity === 'CRITICA' ? '#f87171' : a.severity === 'ALTA' ? '#fb923c' : '#fbbf24' }}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="px-2 py-0.5 rounded text-[9px] font-bold uppercase" style={{ backgroundColor: a.anomalyType === 'INVERSION' ? '#f87171' : '#fb923c', color: '#fff' }}>{a.anomalyType}</span>
                    <span className="font-mono font-medium text-app-text2">{a.longerTicker} ({a.longerDays}d)</span>
                    <span className="text-[#f87171]">vs</span>
                    <span className="font-mono font-medium text-app-text2">{a.shorterTicker} ({a.shorterDays}d)</span>
                    <span className="text-[#f87171] font-medium">Δ −{a.temDiff.toFixed(3)}%</span>
                    {affectsPos && <span className="px-1.5 py-0.5 rounded text-[8px] font-medium bg-app-accent-dim text-[#2eebc8]">📌 EN CARTERA</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
