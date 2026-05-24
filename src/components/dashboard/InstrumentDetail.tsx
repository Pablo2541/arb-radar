'use client';

import React, { useEffect, useState } from 'react';
import { Instrument, Config, Position, SRData, MomentumData } from '@/lib/types';
import {
  spreadVsCaucion,
  getSpreadSignal,
  caucionTEMFromTNA,
  getCaucionForDays,
  calculateCompositeSignal,
  durationMod,
  calculatePnL,
} from '@/lib/calculations';

interface InstrumentDetailProps {
  instrument: Instrument;
  config: Config;
  position: Position | null;
  momentum: MomentumData | undefined;
  srData: SRData | undefined;
  onClose: () => void;
  onRotate?: (ticker: string) => void;
}

export default function InstrumentDetail({
  instrument,
  config,
  position,
  momentum,
  srData,
  onClose,
  onRotate,
}: InstrumentDetailProps) {
  const [visible, setVisible] = useState(false);

  // Trigger slide-in animation on mount
  useEffect(() => {
    // Use requestAnimationFrame to ensure the initial render with translate-x-full happens first
    const raf = requestAnimationFrame(() => {
      setVisible(true);
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  const handleClose = () => {
    setVisible(false);
    // Wait for slide-out animation to complete before unmounting
    setTimeout(() => {
      onClose();
    }, 300);
  };

  // ── Derived calculations ──
  const spread = spreadVsCaucion(instrument.tem, config, instrument.days);
  const spreadSignal = getSpreadSignal(spread);
  const caucionUsed = getCaucionForDays(config, instrument.days);
  const caucionLabel = caucionUsed === config.caucion1d ? '1d' : caucionUsed === config.caucion7d ? '7d' : '30d';
  const caucionTEM = caucionTEMFromTNA(caucionUsed);
  const dm = instrument.dm ?? durationMod(instrument.days, instrument.tem);
  const paridad = instrument.type === 'LECAP' && instrument.price > 0 ? ((1.41 / instrument.price) * 100) : 100;

  const compositeSignal = calculateCompositeSignal(instrument, config, [instrument]);

  const deltaTIR = momentum?.deltaTIR ?? null;
  const deltaTIRArrow = deltaTIR !== null
    ? deltaTIR > 0.02 ? '↑' : deltaTIR < -0.02 ? '↓' : '→'
    : '';
  const deltaTIRColor = deltaTIR !== null
    ? deltaTIR > 0.02 ? '#2eebc8' : deltaTIR < -0.02 ? '#f87171' : '#4f5b73'
    : '#4f5b73';

  // Spread color coding
  const spreadColor = spread > 0.1 ? '#2eebc8' : spread > 0 ? '#fbbf24' : spread > -0.1 ? '#fbbf24' : '#f87171';

  // Position info
  const isHeld = position?.ticker === instrument.ticker;
  const pnlData = isHeld && position
    ? calculatePnL(position, instrument.price, config.comisionTotal)
    : null;

  // ── Render helpers ──
  const sectionHeader = (label: string) => (
    <div className="text-[10px] uppercase tracking-wider text-app-text4 font-medium mb-2">{label}</div>
  );

  const valueRow = (label: string, value: string, color?: string) => (
    <div className="flex items-center justify-between py-1">
      <span className="text-[11px] text-app-text3">{label}</span>
      <span className={`font-mono text-[12px] ${color ? '' : 'text-app-text'}`} style={color ? { color } : undefined}>
        {value}
      </span>
    </div>
  );

  return (
    <>
      {/* Overlay backdrop */}
      <div
        className={`fixed inset-0 bg-black/40 backdrop-blur-sm z-40 transition-opacity duration-300 ${visible ? 'opacity-100' : 'opacity-0'}`}
        onClick={handleClose}
        aria-hidden="true"
      />

      {/* Slide-over panel */}
      <div
        className={`fixed top-0 right-0 h-full w-full sm:w-96 bg-app-card border-l border-app-border shadow-2xl z-50 transform transition-transform duration-300 ease-in-out overflow-y-auto custom-scrollbar ${visible ? 'translate-x-0' : 'translate-x-full'}`}
        role="dialog"
        aria-modal="true"
        aria-label={`Detalle de ${instrument.ticker}`}
      >
        {/* ── Header ── */}
        <div className="sticky top-0 bg-app-card z-10 border-b border-app-border/40 px-5 py-4">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-mono font-semibold text-app-text">{instrument.ticker}</h2>
              <span className={`px-2 py-0.5 rounded-md text-[10px] font-medium ${instrument.type === 'LECAP' ? 'bg-app-accent-dim text-[#2eebc8]' : 'bg-[#f472b6]/10 text-[#f472b6]'}`}>
                {instrument.type}
              </span>
            </div>
            <button
              onClick={handleClose}
              className="p-1.5 rounded-full hover:bg-app-subtle transition-colors text-app-text4 hover:text-app-text"
              aria-label="Cerrar panel"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="text-[11px] text-app-text4 mt-1">
            Vto: {instrument.expiry || '—'} &middot; {instrument.days} días
          </div>
        </div>

        {/* ── Content sections ── */}
        <div className="px-5 py-4 space-y-5">

          {/* Price Section */}
          <div className="pb-4 border-b border-app-border/40">
            {sectionHeader('Precio')}
            <div className="flex items-baseline gap-3 mb-2">
              <span className="text-2xl font-mono font-bold text-app-text">
                ${instrument.price.toFixed(4)}
              </span>
              <span className={`font-mono text-sm font-medium ${instrument.change >= 0 ? 'text-[#2eebc8]' : 'text-[#f87171]'}`}>
                {instrument.change >= 0 ? '+' : ''}{instrument.change.toFixed(2)}%
              </span>
            </div>
            {valueRow('Paridad', isFinite(paridad) ? `${paridad.toFixed(1)}%` : '—')}
          </div>

          {/* Yield Section */}
          <div className="pb-4 border-b border-app-border/40">
            {sectionHeader('Rendimiento')}
            {valueRow('TEM', `${instrument.tem.toFixed(2)}%`)}
            {valueRow('TIR', `${(instrument.tir || instrument.tem).toFixed(2)}%`)}
            {valueRow('TNA', `${instrument.tna.toFixed(1)}%`)}
            {valueRow(
              `Spread vs Caución ${caucionLabel}`,
              `${spread >= 0 ? '+' : ''}${spread.toFixed(3)}%`,
              spreadColor
            )}
            <div className="flex items-center justify-between py-1">
              <span className="text-[11px] text-app-text3">Señal Spread</span>
              <span className="text-[11px] font-medium" style={{ color: spreadSignal.color }}>
                {spreadSignal.emoji} {spreadSignal.label}
              </span>
            </div>
          </div>

          {/* Risk Section */}
          <div className="pb-4 border-b border-app-border/40">
            {sectionHeader('Riesgo / Sensibilidad')}
            {valueRow('Duration Modified', dm != null && isFinite(dm) ? dm.toFixed(4) : '—')}
            {valueRow('Días al Vto.', `${instrument.days}`)}
            {valueRow('Sensibilidad -10bp', instrument.price > 0 ? `$${(instrument.price * (-dm) * (-10 / 10000)).toFixed(4)}` : '—')}
            {valueRow('Sensibilidad +10bp', instrument.price > 0 ? `$${(instrument.price * (-dm) * (10 / 10000)).toFixed(4)}` : '—')}

            {/* S/R Levels */}
            {srData && isFinite(srData.soporte) && isFinite(srData.resistencia) && (
              <div className="mt-3 pt-3 border-t border-app-border/30">
                {sectionHeader('Soporte / Resistencia')}
                {/* V1.8.4: Canal % badge */}
                <div className="flex items-center justify-center mb-2">
                  <span
                    className="font-mono font-bold text-sm px-2 py-1 rounded"
                    style={{ backgroundColor: `${srData.posicionEnCanal >= 90 ? '#f87171' : srData.posicionEnCanal >= 70 ? '#fbbf24' : '#2eebc8'}15`, color: srData.posicionEnCanal >= 90 ? '#f87171' : srData.posicionEnCanal >= 70 ? '#fbbf24' : '#2eebc8' }}
                  >
                    Canal {srData.posicionEnCanal.toFixed(0)}%
                  </span>
                </div>
                <div className="flex items-center justify-between py-1">
                  <span className="text-[11px] text-app-text3">Soporte</span>
                  <span className="font-mono text-[12px] text-[#2eebc8]">
                    {srData.soporte.toFixed(4)}
                    <span className="text-[9px] text-[#2eebc8]/60 ml-1">({srData.distanciaSoporte.toFixed(1)}%)</span>
                  </span>
                </div>
                <div className="flex items-center justify-between py-1">
                  <span className="text-[11px] text-app-text3">Resistencia</span>
                  <span className="font-mono text-[12px] text-[#f87171]">
                    {srData.resistencia.toFixed(4)}
                    <span className="text-[9px] text-[#f87171]/60 ml-1">({srData.distanciaResistencia.toFixed(1)}%)</span>
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Momentum Section */}
          <div className="pb-4 border-b border-app-border/40">
            {sectionHeader('Momentum')}
            <div className="flex items-center justify-between py-1">
              <span className="text-[11px] text-app-text3">Delta TIR</span>
              <span className="font-mono text-[12px]" style={{ color: deltaTIRColor }}>
                {deltaTIR !== null ? (
                  <>
                    {deltaTIR >= 0 ? '+' : ''}{deltaTIR.toFixed(3)}%
                    {deltaTIRArrow && <span className="ml-1">{deltaTIRArrow}</span>}
                  </>
                ) : (
                  <span className="text-app-text4">—</span>
                )}
              </span>
            </div>
            {valueRow('Score Compuesto', `${compositeSignal.compositeScore.toFixed(1)} / 10`)}
            <div className="flex items-center justify-between py-1">
              <span className="text-[11px] text-app-text3">Señal Compuesta</span>
              <span
                className="text-[11px] font-medium px-2 py-0.5 rounded-md"
                style={{ color: compositeSignal.signalColor, backgroundColor: `${compositeSignal.signalColor}15` }}
              >
                {compositeSignal.signalEmoji} {compositeSignal.signal}
              </span>
            </div>
            {valueRow('Momentum', compositeSignal.momentumLabel)}
            {valueRow('Spread', compositeSignal.spreadLabel)}
            {valueRow('Duración', compositeSignal.durationLabel)}
          </div>

          {/* Composite Scores Detail */}
          <div className="pb-4 border-b border-app-border/40">
            {sectionHeader('Scores Individuales')}
            {/* Mini bar for momentum score */}
            <div className="space-y-2">
              {[
                { label: 'Momentum', score: compositeSignal.momentumScore, maxScore: 10 },
                { label: 'Spread', score: compositeSignal.spreadScore, maxScore: 10 },
                { label: 'Duración', score: compositeSignal.durationScore, maxScore: 10 },
              ].map(item => {
                const pct = Math.min(100, Math.max(0, (item.score / item.maxScore) * 100));
                const barColor = pct >= 70 ? '#2eebc8' : pct >= 40 ? '#fbbf24' : '#f87171';
                return (
                  <div key={item.label}>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-[10px] text-app-text4">{item.label}</span>
                      <span className="font-mono text-[10px] text-app-text3">{item.score.toFixed(1)}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-app-subtle overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${pct}%`, backgroundColor: barColor }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Price Scenarios */}
          <div className="pb-4 border-b border-app-border/40">
            {sectionHeader('Escenarios de Precio')}
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-app-subtle/50 rounded-lg p-2.5">
                <div className="text-[9px] text-app-text4 mb-1">−25 pb</div>
                <div className="font-mono text-[12px] text-[#2eebc8]">${compositeSignal.priceMinus25bps.toFixed(4)}</div>
              </div>
              <div className="bg-app-subtle/50 rounded-lg p-2.5">
                <div className="text-[9px] text-app-text4 mb-1">−10 pb</div>
                <div className="font-mono text-[12px] text-[#2eebc8]/80">${compositeSignal.priceMinus10bps.toFixed(4)}</div>
              </div>
              <div className="bg-app-subtle/50 rounded-lg p-2.5">
                <div className="text-[9px] text-app-text4 mb-1">+10 pb</div>
                <div className="font-mono text-[12px] text-[#f87171]/80">${compositeSignal.pricePlus10bps.toFixed(4)}</div>
              </div>
              <div className="bg-app-subtle/50 rounded-lg p-2.5">
                <div className="text-[9px] text-app-text4 mb-1">+25 pb</div>
                <div className="font-mono text-[12px] text-[#f87171]">${compositeSignal.pricePlus25bps.toFixed(4)}</div>
              </div>
            </div>
          </div>

          {/* Position Section */}
          {isHeld && pnlData && (
            <div className="pb-4 border-b border-app-border/40">
              {sectionHeader('Posición Actual')}
              <div className="bg-app-accent-dim/50 border border-app-accent-border/30 rounded-xl p-4 space-y-1.5">
                {valueRow('VN', `${position!.vn.toLocaleString('es-AR')}`)}
                {valueRow('Costo Entrada', `$${pnlData.capitalInvested.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`)}
                {valueRow('Valor Actual', `$${pnlData.currentValue.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`)}
                {valueRow('Valor Liq.', `$${pnlData.currentValueAfterCommission.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`)}
                <div className="flex items-center justify-between py-1 pt-2 border-t border-app-border/30">
                  <span className="text-[11px] text-app-text3 font-medium">P&L Neto</span>
                  <span className="font-mono text-sm font-semibold" style={{ color: pnlData.pnl >= 0 ? '#2eebc8' : '#f87171' }}>
                    {pnlData.pnl >= 0 ? '+' : ''}${pnlData.pnl.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                    <span className="text-[10px] ml-1">({pnlData.pnlPct >= 0 ? '+' : ''}{pnlData.pnlPct.toFixed(2)}%)</span>
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="pt-2 pb-6">
            {position && !isHeld ? (
              <button
                onClick={() => onRotate?.(instrument.ticker)}
                className="w-full py-3 px-4 rounded-xl bg-[#fbbf24]/10 border border-[#fbbf24]/20 text-[#fbbf24] font-medium text-sm hover:bg-[#fbbf24]/20 transition-colors flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Rotar a {instrument.ticker}
              </button>
            ) : !position ? (
              <button
                onClick={() => onRotate?.(instrument.ticker)}
                className="w-full py-3 px-4 rounded-xl bg-app-accent-dim border border-app-accent-border text-[#2eebc8] font-medium text-sm hover:bg-app-accent-border/30 transition-colors flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                Comprar {instrument.ticker}
              </button>
            ) : (
              <div className="bg-app-accent-dim/50 border border-app-accent-border/30 rounded-xl py-3 px-4 text-center">
                <span className="text-[#2eebc8] text-sm font-medium">Posición activa en {instrument.ticker}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
