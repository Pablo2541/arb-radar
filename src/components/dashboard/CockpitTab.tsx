'use client';

// ════════════════════════════════════════════════════════════════════════
// V7.0-FASE2 — VELOCIDAD & FLUJO: CockpitTab
//
// Filosofía: "El backend analiza, la pantalla ordena la acción."
//   - Instrumentos anestesiados OCULTOS de la vista principal
//   - Columnas secundarias ELIMINADAS (S/R, Dist%, Inyección, Spread)
//   - Tabla minimalista: #, Instrumento, Precio, TEM, Score, ACCIÓN, FLUJO
//   - MÓDULO DE EJECUCIÓN PURA: tarjeta central de alta prioridad
//   - Trigger Crítico de Salida: Take Profit Adaptativo (+1% / BID cede)
//   - FASE 2 Flow Metrics: VROC, Iceberg, Sweep badges
//
// BLINDAJE: La comisión del 0.15% NO se toca. price x 1.0015 = IMMUTABLE.
// ════════════════════════════════════════════════════════════════════════

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { Instrument, Config, Position, CockpitScore, LiveInstrument, AdaptiveTakeProfitResult, CurveSpreadAnomaly, SpreadDispersalVelocity } from '@/lib/types';
import { useRadarStore } from '@/lib/store';
import { Search, Bell, BellOff, Download, Keyboard, Star, BellRing, X, Eye, EyeOff, TrendingUp, Shield, ArrowRight } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { calculateAdaptiveTakeProfit } from '@/lib/calculations';

// ─── Props ────────────────────────────────────────────────────────────
interface CockpitTabProps {
  instruments: Instrument[];
  config: Config;
  position: Position | null;
  liveDataMap: Map<string, LiveInstrument>;
  isLive: boolean;
  marketOpen: boolean;
  onAlertsCountChange?: (count: number) => void;
  onWatchlistCountChange?: (count: number) => void;
  onTakeProfitCountChange?: (count: number) => void;
}

// ─── Watchlist Hook ─────────────────────────────────────────────────
function useWatchlist() {
  const [watchlist, setWatchlist] = useState<string[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const saved = localStorage.getItem('arbradar_watchlist');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  const toggleWatchlist = useCallback((ticker: string) => {
    setWatchlist(prev => {
      const next = prev.includes(ticker)
        ? prev.filter(t => t !== ticker)
        : [...prev, ticker];
      try { localStorage.setItem('arbradar_watchlist', JSON.stringify(next)); } catch { /* silent */ }
      return next;
    });
  }, []);

  const isWatched = useCallback((ticker: string) => watchlist.includes(ticker), [watchlist]);

  return { watchlist, toggleWatchlist, isWatched };
}

// ─── Price Alerts Hook ──────────────────────────────────────────────
interface PriceAlert {
  direction: '>' | '<';
  price: number;
}

function usePriceAlerts() {
  const [alerts, setAlerts] = useState<Record<string, PriceAlert>>(() => {
    if (typeof window === 'undefined') return {};
    try {
      const saved = localStorage.getItem('arbradar_price_alerts');
      return saved ? JSON.parse(saved) : {};
    } catch { return {}; }
  });

  const setAlert = useCallback((ticker: string, direction: '>' | '<', price: number) => {
    setAlerts(prev => {
      const next = { ...prev, [ticker]: { direction, price } };
      try { localStorage.setItem('arbradar_price_alerts', JSON.stringify(next)); } catch { /* silent */ }
      return next;
    });
  }, []);

  const removeAlert = useCallback((ticker: string) => {
    setAlerts(prev => {
      const next = { ...prev };
      delete next[ticker];
      try { localStorage.setItem('arbradar_price_alerts', JSON.stringify(next)); } catch { /* silent */ }
      return next;
    });
  }, []);

  const clearAllAlerts = useCallback(() => {
    setAlerts({});
    try { localStorage.setItem('arbradar_price_alerts', JSON.stringify({})); } catch { /* silent */ }
  }, []);

  const getAlert = useCallback((ticker: string) => alerts[ticker] ?? null, [alerts]);
  const alertCount = Object.keys(alerts).length;

  return { alerts, setAlert, removeAlert, clearAllAlerts, getAlert, alertCount };
}

// ─── Verdict Config ───────────────────────────────────────────────────
const VERDICT_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  TAKE_PROFIT: { label: '🚨 TAKE PROFIT', color: '#dc2626', bg: 'rgba(220,38,38,0.15)' },
  SALTO_TACTICO: { label: '⚡ SALTO TÁCTICO', color: '#f87171', bg: 'rgba(248,113,113,0.12)' },
  PUNTO_CARAMELO: { label: '🍬 PUNTO CARAMELO', color: '#fbbf24', bg: 'rgba(251,191,36,0.12)' },
  ATRACTIVO: { label: 'ATRACTIVO', color: '#2eebc8', bg: 'rgba(46,235,200,0.08)' },
  NEUTRAL: { label: 'NEUTRAL', color: '#94a3b8', bg: 'rgba(148,163,184,0.06)' },
  EVITAR: { label: 'EVITAR', color: '#6b7280', bg: 'rgba(107,114,128,0.06)' },
};

// ─── Action Score Config ─────────────────────────────────────────────
const ACTION_SCORE_CONFIG: Record<string, { label: string; color: string; bg: string; glow: string }> = {
  'GATILLAR YA': { label: '🔥 GATILLAR YA', color: '#f87171', bg: 'rgba(248,113,113,0.18)', glow: '0 0 12px rgba(248,113,113,0.4)' },
  'ATRACTIVO': { label: '✓ ATRACTIVO', color: '#2eebc8', bg: 'rgba(46,235,200,0.12)', glow: '0 0 8px rgba(46,235,200,0.2)' },
  'NEUTRAL': { label: 'NEUTRAL', color: '#94a3b8', bg: 'rgba(148,163,184,0.06)', glow: 'none' },
  'SIN SEÑAL': { label: 'SIN SEÑAL', color: '#6b7280', bg: 'rgba(107,114,128,0.04)', glow: 'none' },
};

// ─── Horizon Options ──────────────────────────────────────────────────
const HORIZON_OPTIONS = [
  { value: 20, label: '20d', desc: 'Ultra Scalp' },
  { value: 30, label: '30d', desc: 'Scalping' },
  { value: 45, label: '45d', desc: 'Scalping Extendido' },
  { value: 60, label: '60d', desc: 'Swing Corto' },
  { value: 90, label: '90d', desc: 'Swing' },
  { value: 9999, label: 'ALL', desc: 'Todo' },
];

// ─── Helpers ──────────────────────────────────────────────────────────
function fmtNum(n: number, decimals = 2): string {
  return n.toLocaleString('es-AR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtPct(n: number, decimals = 2): string {
  const sign = n >= 0 ? '+' : '';
  return `${sign}${fmtNum(n, decimals)}%`;
}

function getRankClass(rank: number): string {
  if (rank === 1) return 'rank-1';
  if (rank === 2) return 'rank-2';
  if (rank === 3) return 'rank-3';
  return 'rank-default';
}

function getStaggerClass(index: number): string {
  const n = (index % 20) + 1;
  return `stagger-${n}`;
}

// ─── Score Ring SVG Component ─────────────────────────────────────────
function ScoreRing({ score, color, size = 22 }: { score: number; color: string; size?: number }) {
  const radius = (size - 4) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = Math.min(Math.max(score, 0), 100) / 100;
  const dashOffset = circumference * (1 - filled);

  return (
    <svg width={size} height={size} className="score-ring shrink-0" style={{ '--ring-color': color } as React.CSSProperties}>
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--app-subtle)" strokeWidth={2} />
      <circle
        cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={2}
        strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={dashOffset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dashoffset 0.6s ease-out' }}
      />
    </svg>
  );
}

// ─── Price Alert Popover Component ────────────────────────────────────
function PriceAlertPopover({
  ticker, currentPrice, alert, onSetAlert, onRemoveAlert, onClearAll, alertCount,
}: {
  ticker: string; currentPrice: number; alert: PriceAlert | null;
  onSetAlert: (ticker: string, direction: '>' | '<', price: number) => void;
  onRemoveAlert: (ticker: string) => void; onClearAll: () => void; alertCount: number;
}) {
  const [inputPrice, setInputPrice] = useState(() => (alert ? alert.price.toFixed(4) : currentPrice > 0 ? currentPrice.toFixed(4) : ''));
  const [direction, setDirection] = useState<'>' | '<'>(() => alert?.direction ?? '>');

  const handleSet = () => {
    const p = parseFloat(inputPrice);
    if (!isNaN(p) && p > 0) onSetAlert(ticker, direction, p);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={`flex items-center justify-center w-5 h-5 rounded transition-all duration-150 shrink-0 ${
            alert ? 'text-[#fbbf24] bg-[#fbbf24]/10 hover:bg-[#fbbf24]/20' : 'text-app-text4 hover:text-app-text3 hover:bg-app-hover'
          }`}
          title={alert ? `Alerta: ${alert.direction} ${alert.price.toFixed(4)}` : 'Configurar alerta de precio'}
        >
          {alert ? <BellRing className="w-3 h-3" /> : <Bell className="w-3 h-3" />}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3 rounded-xl border border-app-border/60 bg-app-bg/95 backdrop-blur-xl shadow-xl z-50" side="left" align="center">
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold text-app-text uppercase tracking-wider">🔔 Alerta</span>
            <span className="font-mono text-[10px] font-bold text-app-accent-text">{ticker}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <select value={direction} onChange={e => setDirection(e.target.value as '>' | '<')}
              className="h-7 px-1.5 rounded-lg bg-app-subtle/60 border border-app-border/60 text-[10px] font-mono text-app-text focus:outline-none focus:ring-1 focus:ring-[#2eebc8]/40">
              <option value=">">&gt; mayor</option>
              <option value="<">&lt; menor</option>
            </select>
            <Input type="number" step="0.0001" value={inputPrice} onChange={e => setInputPrice(e.target.value)}
              className="h-7 text-[10px] font-mono bg-app-subtle/60 border-app-border/60 focus:border-[#2eebc8]/30 focus:ring-[#2eebc8]/40" placeholder="Precio" />
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={handleSet}
              className="flex-1 h-7 rounded-lg bg-[#2eebc8]/15 border border-[#2eebc8]/30 text-[9px] font-bold text-[#2eebc8] hover:bg-[#2eebc8]/25 transition-all">
              {alert ? 'Actualizar' : 'Activar'}
            </button>
            {alert && (
              <button onClick={() => onRemoveAlert(ticker)}
                className="h-7 px-2 rounded-lg bg-[#f87171]/10 border border-[#f87171]/30 text-[9px] font-bold text-[#f87171] hover:bg-[#f87171]/20 transition-all">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
          {alertCount > 0 && (
            <div className="flex items-center justify-between pt-1.5 border-t border-app-border/30">
              <span className="text-[8px] text-app-text4">🔔 {alertCount} activa{alertCount !== 1 ? 's' : ''}</span>
              <button onClick={onClearAll} className="text-[8px] text-[#f87171] hover:text-[#f87171]/80 font-medium transition-colors">Limpiar todo</button>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ════════════════════════════════════════════════════════════════════════
// V7.0-FASE2: MÓDULO DE EJECUCIÓN PURA — Alerta Central
//
// Se muestra SOLO cuando:
//   1. Se activa el trigger de toma de ganancias para una posición en cartera
//   2. Y el ranking NO detecta ningún otro activo con desbalance real de compra
//      (el resto sigue anestesiado o sin señal)
//
// Muestra un cartel limpio y directo con la acción a tomar.
// ════════════════════════════════════════════════════════════════════════
function EjecucionPuraCard({
  takeProfitResult,
  ticker,
  noAlternativeBuyImbalance,
}: {
  takeProfitResult: AdaptiveTakeProfitResult;
  ticker: string;
  noAlternativeBuyImbalance: boolean;
}) {
  if (!takeProfitResult.triggered || !noAlternativeBuyImbalance) return null;

  const isSell = takeProfitResult.suggestedAction === 'VENDER';
  const actionColor = isSell ? '#dc2626' : '#f87171';
  const actionBg = isSell ? 'rgba(220,38,38,0.15)' : 'rgba(248,113,113,0.12)';

  return (
    <div
      className="animate-fadeInUp rounded-2xl overflow-hidden"
      style={{
        background: 'linear-gradient(135deg, rgba(220,38,38,0.08) 0%, rgba(21,29,46,0.95) 50%, rgba(46,235,200,0.03) 100%)',
        border: `2px solid ${actionColor}50`,
        boxShadow: `0 0 40px ${actionColor}20, 0 0 80px ${actionColor}10, inset 0 1px 0 rgba(255,255,255,0.05)`,
      }}
    >
      {/* Top accent bar */}
      <div className="h-1" style={{ background: `linear-gradient(90deg, ${actionColor}, transparent, ${actionColor})` }} />

      <div className="px-6 py-5 sm:px-8 sm:py-6">
        {/* Header row */}
        <div className="flex items-center gap-3 mb-4">
          <div
            className="flex items-center justify-center w-10 h-10 rounded-xl animate-pulse"
            style={{ background: actionBg, boxShadow: `0 0 20px ${actionColor}30` }}
          >
            <Shield className="w-5 h-5" style={{ color: actionColor }} />
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: actionColor }}>
              Módulo de Ejecución Pura
            </div>
            <div className="text-[9px] text-app-text4">
              Trigger {takeProfitResult.triggerType === 'COMBINED' ? 'COMBINADO' : takeProfitResult.triggerType === 'PRICE_SURGE' ? 'PRECIO' : 'PRESIÓN'}
            </div>
          </div>
        </div>

        {/* Main action line */}
        <div
          className="rounded-xl px-5 py-4 mb-4"
          style={{
            background: `linear-gradient(135deg, ${actionBg}, rgba(21,29,46,0.6))`,
            border: `1px solid ${actionColor}30`,
          }}
        >
          <div className="flex items-center gap-3 flex-wrap">
            <span
              className="text-2xl sm:text-3xl font-black uppercase tracking-tight"
              style={{ color: actionColor, textShadow: `0 0 20px ${actionColor}40` }}
            >
              ACCIÓN: {takeProfitResult.suggestedAction === 'VENDER' ? 'VENDER' : 'TOMAR GANANCIA'}
            </span>
            <div className="w-px h-8 bg-app-border/30 hidden sm:block" />
            <span className="font-mono text-xl sm:text-2xl font-bold text-app-text">
              {ticker}
            </span>
            {takeProfitResult.sessionGainPct > 0 && (
              <span
                className="font-mono text-lg font-bold px-2 py-0.5 rounded-lg"
                style={{ color: '#2eebc8', background: 'rgba(46,235,200,0.12)' }}
              >
                +{takeProfitResult.sessionGainPct.toFixed(2)}%
              </span>
            )}
          </div>
        </div>

        {/* Destination suggestion */}
        <div className="flex items-center gap-2 mb-3">
          <ArrowRight className="w-4 h-4 text-[#2eebc8] shrink-0" />
          <span className="text-sm">
            <span className="text-app-text4">Destino sugerido: </span>
            <span className="font-bold text-[#2eebc8]">{takeProfitResult.suggestedDestination}</span>
          </span>
        </div>

        {/* Reason */}
        <div className="text-[11px] text-app-text3 leading-relaxed">
          {takeProfitResult.reason}
        </div>

        {/* Context: no alternatives */}
        <div
          className="mt-3 px-3 py-2 rounded-lg text-[10px]"
          style={{ background: 'rgba(107,114,128,0.08)', borderLeft: '3px solid rgba(107,114,128,0.3)' }}
        >
          <span className="text-app-text4">Contexto: </span>
          <span className="text-app-text3">No se detectan otros activos con desbalance real de compra. El resto del ranking está anestesiado o sin señal.</span>
        </div>
      </div>
    </div>
  );
}

// ─── Flow Metrics Badges (VROC / Iceberg / Sweep) ────────────────────
function FlowMetricsBadges({ score, layout = 'desktop' }: { score: CockpitScore; layout?: 'desktop' | 'mobile' }) {
  const badges: React.ReactNode[] = [];

  // VROC badge — only if label !== 'NORMAL'
  if (score.volumeVelocity && score.volumeVelocity.label !== 'NORMAL') {
    const label = score.volumeVelocity.label;
    const abbr = label === 'ACELERACIÓN' ? 'ACEL' : label === 'ANOMALÍA X3' ? 'X3' : label === 'ANOMALÍA X5+' ? 'X5+' : label;
    const colorClass = label === 'ACELERACIÓN'
      ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
      : label === 'ANOMALÍA X3'
        ? 'bg-orange-500/15 text-orange-400 border-orange-500/30'
        : 'bg-red-500/15 text-red-400 border-red-500/30';
    const pulse = score.volumeVelocity.momentumTrigger ? 'animate-pulse' : '';
    badges.push(
      <span key="vroc" className={`inline-flex items-center gap-0.5 border font-bold uppercase tracking-wider rounded ${colorClass} ${pulse} ${layout === 'desktop' ? 'text-[8px] px-1.5 py-0.5' : 'text-[7px] px-1 py-0.5'}`} style={score.volumeVelocity.momentumTrigger ? { boxShadow: label === 'ANOMALÍA X5+' ? '0 0 8px rgba(239,68,68,0.5)' : label === 'ANOMALÍA X3' ? '0 0 6px rgba(249,115,22,0.4)' : '0 0 6px rgba(245,158,11,0.4)' } : {}}>
        🚀 VROC {abbr}
      </span>
    );
  }

  // Iceberg badge — only if detected
  if (score.icebergDetected && score.icebergDetected.detected) {
    const conf = score.icebergDetected.confidence;
    const colorClass = conf === 'ALTA'
      ? 'bg-purple-500/15 text-purple-400 border-purple-500/30'
      : conf === 'MEDIA'
        ? 'bg-purple-500/10 text-purple-300 border-purple-500/20'
        : 'bg-purple-500/5 text-purple-200 border-purple-500/10';
    const shimmer = conf === 'ALTA' ? 'flow-iceberg-shimmer' : '';
    badges.push(
      <span key="iceberg" className={`inline-flex items-center gap-0.5 border font-bold uppercase tracking-wider rounded ${colorClass} ${shimmer} ${layout === 'desktop' ? 'text-[8px] px-1.5 py-0.5' : 'text-[7px] px-1 py-0.5'}`}>
        🧊 ICEBERG {conf}
      </span>
    );
  }

  // Sweep badge — only if detected
  if (score.marketSweep && score.marketSweep.detected) {
    const dir = score.marketSweep.direction;
    const skipped = score.marketSweep.levelsSkipped;
    badges.push(
      <span key="sweep" className={`inline-flex items-center gap-0.5 border font-bold uppercase tracking-wider rounded bg-red-500/20 text-red-300 border-red-500/40 flow-sweep-pulse ${layout === 'desktop' ? 'text-[8px] px-1.5 py-0.5' : 'text-[7px] px-1 py-0.5'}`} style={{ boxShadow: '0 0 8px rgba(239,68,68,0.5)' }}>
        ⚡ BARRIDO {dir} ×{skipped}
      </span>
    );
  }

  // Curve Anomaly badge — only if isAnomaly
  if (score.curveSpreadAnomaly && score.curveSpreadAnomaly.isAnomaly) {
    const dir = score.curveSpreadAnomaly.direction;
    const z = score.curveSpreadAnomaly.spreadZScore;
    const colorClass = dir === 'LAGGING'
      ? 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30'
      : 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
    badges.push(
      <span key="curve" className={`inline-flex items-center gap-0.5 border font-bold uppercase tracking-wider rounded ${colorClass} ${layout === 'desktop' ? 'text-[8px] px-1.5 py-0.5' : 'text-[7px] px-1 py-0.5'}`}>
        📐 CURVA {dir === 'LAGGING' ? 'REZAGADO' : 'LÍDER'} {z.toFixed(1)}σ
      </span>
    );
  }

  // Spread Velocity badge — only if signal !== NEUTRAL
  if (score.spreadVelocity && score.spreadVelocity.signal !== 'NEUTRAL') {
    const sig = score.spreadVelocity.signal;
    const colorClass = sig === 'CONVERGENCIA'
      ? 'bg-teal-500/15 text-teal-400 border-teal-500/30'
      : 'bg-amber-500/15 text-amber-400 border-amber-500/30';
    const pulse = sig === 'CONVERGENCIA' ? 'animate-pulse' : '';
    badges.push(
      <span key="spreadv" className={`inline-flex items-center gap-0.5 border font-bold uppercase tracking-wider rounded ${colorClass} ${pulse} ${layout === 'desktop' ? 'text-[8px] px-1.5 py-0.5' : 'text-[7px] px-1 py-0.5'}`}>
        {sig === 'CONVERGENCIA' ? '🎯' : '⚠️'} {sig}
      </span>
    );
  }

  if (badges.length === 0) return null;

  if (layout === 'mobile') {
    return <div className="flex flex-wrap items-center gap-1 mt-1.5">{badges}</div>;
  }

  // Desktop: horizontal, max 2 visible
  return <div className="flex flex-wrap items-center gap-1 max-w-[180px]">{badges.slice(0, 2)}</div>;
}

// ─── Curve Anomaly Alert Card (V7.0-FASE3) ──────────────────────────
function CurveAlertCard({ scores }: { scores: CockpitScore[] }) {
  // Find scores with rotation or entry alerts
  const rotationAlerts = scores.filter(s => s.rotationAlert);
  if (rotationAlerts.length === 0) return null;

  const alert = rotationAlerts[0].rotationAlert!;
  const isRotation = alert.type === 'ROTATION';
  const accentColor = isRotation ? '#2eebc8' : '#a78bfa';
  const accentBg = isRotation ? 'rgba(46,235,200,0.08)' : 'rgba(167,139,250,0.08)';

  return (
    <div
      className="animate-fadeInUp rounded-2xl overflow-hidden"
      style={{
        background: `linear-gradient(135deg, ${accentBg} 0%, rgba(21,29,46,0.95) 50%, rgba(167,139,250,0.03) 100%)`,
        border: `2px solid ${accentColor}50`,
        boxShadow: `0 0 40px ${accentColor}20, 0 0 80px ${accentColor}10, inset 0 1px 0 rgba(255,255,255,0.05)`,
      }}
    >
      {/* Top accent bar */}
      <div className="h-1" style={{ background: `linear-gradient(90deg, ${accentColor}, transparent, ${accentColor})` }} />

      <div className="px-6 py-5 sm:px-8 sm:py-6">
        {/* Header row */}
        <div className="flex items-center gap-3 mb-4">
          <div
            className="flex items-center justify-center w-10 h-10 rounded-xl animate-pulse"
            style={{ background: `${accentColor}20`, boxShadow: `0 0 20px ${accentColor}30` }}
          >
            <TrendingUp className="w-5 h-5" style={{ color: accentColor }} />
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: accentColor }}>
              Anomalía de Curva Compañera
            </div>
            <div className="text-[9px] text-app-text4">
              {isRotation ? 'Rotación Disponible' : 'Entrada por Arbitraje'}
            </div>
          </div>
        </div>

        {/* Main action line */}
        <div
          className="rounded-xl px-5 py-4 mb-4"
          style={{
            background: `linear-gradient(135deg, ${accentBg}, rgba(21,29,46,0.6))`,
            border: `1px solid ${accentColor}30`,
          }}
        >
          <div className="flex items-center gap-3 flex-wrap">
            <span
              className="text-xl sm:text-2xl font-black uppercase tracking-tight"
              style={{ color: accentColor, textShadow: `0 0 20px ${accentColor}40` }}
            >
              {isRotation ? 'ROTACIÓN DISPONIBLE' : 'ENTRADA POR ARBITRAJE'}
            </span>
            {alert.benefitPb > 0 && (
              <span
                className="font-mono text-lg font-bold px-2 py-0.5 rounded-lg"
                style={{ color: accentColor, background: `${accentColor}15` }}
              >
                +{alert.benefitPb.toFixed(1)}pb TEM
              </span>
            )}
          </div>
        </div>

        {/* Tickers */}
        {isRotation ? (
          <div className="flex items-center gap-2 mb-3">
            <span className="text-sm">
              <span className="text-app-text4">Vender: </span>
              <span className="font-bold text-[#f87171]">{alert.sellTicker}</span>
            </span>
            <ArrowRight className="w-4 h-4 text-app-text4 shrink-0" />
            <span className="text-sm">
              <span className="text-app-text4">Comprar: </span>
              <span className="font-bold" style={{ color: accentColor }}>{alert.buyTicker}</span>
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2 mb-3">
            <ArrowRight className="w-4 h-4 shrink-0" style={{ color: accentColor }} />
            <span className="text-sm">
              <span className="text-app-text4">Comprar: </span>
              <span className="font-bold" style={{ color: accentColor }}>{alert.buyTicker}</span>
            </span>
          </div>
        )}

        {/* Reason */}
        <div className="text-[11px] text-app-text3 leading-relaxed">
          {alert.reason}
        </div>
      </div>
    </div>
  );
}

// ─── El Grito Alert Card (Simplified) ─────────────────────────────────
function ElGritoCard({ scores }: { scores: CockpitScore[] }) {
  if (scores.length === 0) return null;

  const takeProfitScores = scores.filter(s => s.isTakeProfit);
  const gatillarScores = scores.filter(s => s.actionScore.label === 'GATILLAR YA');
  const saltoScores = scores.filter(s => s.verdict === 'SALTO_TACTICO');
  const carameloScores = scores.filter(s => s.verdict === 'PUNTO_CARAMELO');

  // FASE 2 Flow Alert: detect instruments with VROC anomalies or sweeps
  const flowAlertActive = scores.some(s =>
    (s.volumeVelocity?.momentumTrigger === true) || (s.marketSweep?.detected === true)
  );
  const curveAnomalyActive = scores.some(s => s.curveSpreadAnomaly?.isAnomaly);
  const rotationAlertActive = scores.some(s => s.rotationAlert);

  const topScores = [...takeProfitScores, ...gatillarScores, ...saltoScores, ...carameloScores].slice(0, 4);

  if (topScores.length === 0) return null;

  return (
    <div
      className="nexus-grito p-0 animate-fadeInUp"
      style={{
        willChange: 'transform', contain: 'layout style', transform: 'translateZ(0)',
        boxShadow: takeProfitScores.length > 0 ? '0 0 40px rgba(220,38,38,0.25)' : gatillarScores.length > 0 ? '0 0 30px rgba(248,113,113,0.15)' : '0 0 15px rgba(244,114,182,0.1)',
      }}
    >
      <div className="relative z-10 rounded-2xl p-4 sm:p-5" style={{ background: 'rgba(21,29,46,0.95)' }}>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-lg">🚨</span>
          <span className="text-sm font-semibold tracking-wide" style={{ color: '#f87171' }}>EL GRITO</span>
          {takeProfitScores.length > 0 && (
            <span className="ml-2 px-2 py-0.5 rounded-lg text-[9px] font-bold animate-pulse"
              style={{ color: '#fff', background: 'rgba(220,38,38,0.6)', boxShadow: '0 0 12px rgba(220,38,38,0.5)' }}>
              🚨 TAKE PROFIT
            </span>
          )}
          {gatillarScores.length > 0 && (
            <span className="ml-2 px-2 py-0.5 rounded-lg text-[9px] font-bold animate-pulse"
              style={{ color: '#f87171', background: 'rgba(248,113,113,0.2)', boxShadow: '0 0 12px rgba(248,113,113,0.3)' }}>
              🔥 {gatillarScores.length}
            </span>
          )}
          {flowAlertActive && (
            <span className="ml-2 px-2 py-0.5 rounded-lg text-[9px] font-bold animate-pulse"
              style={{ color: '#a78bfa', background: 'rgba(167,139,250,0.2)', boxShadow: '0 0 12px rgba(167,139,250,0.4)' }}>
              🌊 FLOW ALERT
            </span>
          )}
          {curveAnomalyActive && (
            <span className="ml-2 px-2 py-0.5 rounded-lg text-[9px] font-bold animate-pulse"
              style={{ color: '#2eebc8', background: 'rgba(46,235,200,0.2)', boxShadow: '0 0 12px rgba(46,235,200,0.4)' }}>
              📐 CURVA
            </span>
          )}
          {rotationAlertActive && (
            <span className="ml-2 px-2 py-0.5 rounded-lg text-[9px] font-bold animate-pulse"
              style={{ color: '#a78bfa', background: 'rgba(167,139,250,0.2)', boxShadow: '0 0 12px rgba(167,139,250,0.4)' }}>
              ↻ ROTACIÓN
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          {topScores.map((s, index) => {
            const isTakeProfit = !!s.isTakeProfit;
            const isGatillar = s.actionScore.label === 'GATILLAR YA';
            const vc = isTakeProfit
              ? { label: '🚨 TAKE PROFIT', color: '#dc2626', bg: 'rgba(220,38,38,0.15)' }
              : isGatillar
                ? { label: '🔥 GATILLAR YA', color: '#f87171', bg: 'rgba(248,113,113,0.15)' }
                : VERDICT_CONFIG[s.verdict];
            return (
              <div key={`${s.ticker}-${index}`}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border animate-fadeInUp ${getStaggerClass(index)}`}
                style={{ borderColor: `${vc.color}33`, background: vc.bg, boxShadow: isTakeProfit ? '0 0 20px rgba(220,38,38,0.35)' : isGatillar ? '0 0 16px rgba(248,113,113,0.25)' : 'none' }}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono font-bold text-xs text-app-text truncate">{s.ticker}</span>
                    <span className={`shrink-0 px-1.5 py-0.5 rounded text-[8px] font-bold ${s.type === 'LECAP' ? 'bg-app-accent-dim text-[#2eebc8]' : 'bg-[#f472b6]/10 text-[#f472b6]'}`}>
                      {s.type}
                    </span>
                  </div>
                  <div className="font-mono text-[10px] mt-0.5" style={{ color: vc.color }}>
                    {isTakeProfit ? '🚨 TAKE PROFIT' : isGatillar ? '🔥 GATILLAR YA' : vc.label}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-mono font-bold text-lg" style={{ color: vc.color }}>
                    {s.unifiedScore.toFixed(0)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Rotation suggestions for TAKE PROFIT */}
        {takeProfitScores.length > 0 && takeProfitScores[0].rotationSuggestions && takeProfitScores[0].rotationSuggestions.length > 0 && (
          <div className="mt-3 p-2 rounded-lg" style={{ background: 'rgba(46,235,200,0.05)', border: '1px solid rgba(46,235,200,0.15)' }}>
            <div className="text-[10px] font-semibold mb-1" style={{ color: '#2eebc8' }}>↻ ROTACIÓN SUGERIDA</div>
            <div className="flex gap-2 flex-wrap">
              {takeProfitScores[0].rotationSuggestions.map(sug => (
                <div key={sug.ticker} className="flex items-center gap-1.5 px-2 py-1 rounded-md" style={{ background: 'rgba(46,235,200,0.08)' }}>
                  <span className="font-mono font-bold text-[11px]" style={{ color: '#2eebc8' }}>{sug.ticker}</span>
                  <span className="font-mono text-[9px] text-app-text4">Score {sug.unifiedScore.toFixed(0)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Main Component
// ════════════════════════════════════════════════════════════════════════
export default function CockpitTab({
  instruments, config, position, liveDataMap, isLive, marketOpen,
  onAlertsCountChange, onWatchlistCountChange, onTakeProfitCountChange,
}: CockpitTabProps) {
  // ─── Store ────────────────────────────────────────────────────────
  const cockpitScores = useRadarStore(s => s.cockpitScores);
  const setCockpitScores = useRadarStore(s => s.setCockpitScores);
  const cockpitScoresLoading = useRadarStore(s => s.cockpitScoresLoading);
  const setCockpitScoresLoading = useRadarStore(s => s.setCockpitScoresLoading);
  const marketTruth = useRadarStore(s => s.marketTruth);

  // ─── Watchlist & Price Alerts ────────────────────────────────────
  const { watchlist, toggleWatchlist, isWatched } = useWatchlist();
  const { alerts, setAlert, removeAlert, clearAllAlerts, getAlert, alertCount } = usePriceAlerts();
  const [watchlistFilterActive, setWatchlistFilterActive] = useState(false);
  const [triggeredAlerts, setTriggeredAlerts] = useState<Set<string>>(new Set());
  const prevTriggeredRef = useRef<Set<string>>(new Set());

  // ─── Row Flash + Recent Screams state ────────────────────────────
  const [screamingRows, setScreamingRows] = useState<Set<string>>(new Set());
  const [latestScream, setLatestScream] = useState<string | null>(null);
  const [screamKey, setScreamKey] = useState(0);
  const screamTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // ─── V7.0-FASE2: Show anestesiados toggle ────────────────────────
  const [showAnestesiados, setShowAnestesiados] = useState(false);

  // ─── V7.0-FASE2: Adaptive Take Profit result for held position ──
  const [adaptiveTakeProfit, setAdaptiveTakeProfit] = useState<AdaptiveTakeProfitResult | null>(null);

  // Notify parent
  useEffect(() => { onAlertsCountChange?.(alertCount); }, [alertCount, onAlertsCountChange]);
  useEffect(() => { onWatchlistCountChange?.(watchlist.length); }, [watchlist.length, onWatchlistCountChange]);

  // ─── Local State ──────────────────────────────────────────────────
  const [horizon, setHorizon] = useState<number>(() => {
    if (typeof window === 'undefined') return 45;
    try {
      const saved = localStorage.getItem('arbradar_cockpit_horizon');
      if (saved) { const parsed = parseInt(saved, 10); if ([20, 30, 45, 60, 90, 9999].includes(parsed)) return parsed; }
    } catch { /* silent */ }
    return 45;
  });

  const handleHorizonChange = useCallback((value: number) => {
    setHorizon(value);
    try { localStorage.setItem('arbradar_cockpit_horizon', String(value)); } catch { /* silent */ }
  }, []);

  // ─── All scores from API ──────────────────────────────────────────
  const [allScores, setAllScores] = useState<CockpitScore[]>([]);
  const [apiSummary, setApiSummary] = useState<{
    total: number; within_horizon: number; salto_tactico: number;
    punto_caramelo: number; atractivo: number; neutral: number; evitar: number;
  } | null>(null);
  const [engineVersion, setEngineVersion] = useState('');
  const [isStale, setIsStale] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasDataRef = useRef(false);

  // ─── Search/Filter state ──────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');

  // ─── Keyboard Shortcuts panel state ───────────────────────────────
  const [shortcutsExpanded, setShortcutsExpanded] = useState(false);

  // ─── Sound Alert state ────────────────────────────────────────────
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try { return localStorage.getItem('arbradar_cockpit_sound') === 'true'; } catch { return false; }
  });
  const audioCtxRef = useRef<AudioContext | null>(null);
  const prevGatillarRef = useRef<Set<string>>(new Set());
  const prevTakeProfitRef = useRef<Set<string>>(new Set());

  const toggleSound = useCallback(() => {
    setSoundEnabled(prev => {
      const next = !prev;
      try { localStorage.setItem('arbradar_cockpit_sound', String(next)); } catch { /* silent */ }
      return next;
    });
  }, []);

  // ─── Play alert beep ──────────────────────────────────────────────
  const playAlertBeep = useCallback((type: 'entry' | 'exit' = 'entry') => {
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      if (type === 'exit') {
        osc.type = 'sawtooth'; osc.frequency.setValueAtTime(1200, ctx.currentTime);
        gain.gain.setValueAtTime(0.18, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
        osc.connect(gain); gain.connect(ctx.destination); osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.15);
        const osc2 = ctx.createOscillator(); const gain2 = ctx.createGain();
        osc2.type = 'sawtooth'; osc2.frequency.setValueAtTime(1400, ctx.currentTime + 0.18);
        gain2.gain.setValueAtTime(0.18, ctx.currentTime + 0.18); gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.33);
        osc2.connect(gain2); gain2.connect(ctx.destination); osc2.start(ctx.currentTime + 0.18); osc2.stop(ctx.currentTime + 0.33);
      } else {
        osc.type = 'square'; osc.frequency.setValueAtTime(880, ctx.currentTime);
        gain.gain.setValueAtTime(0.15, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
        osc.connect(gain); gain.connect(ctx.destination); osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.2);
      }
    } catch { /* silent */ }
  }, []);

  // ─── Fetch Cockpit Scores ─────────────────────────────────────────
  const fetchScores = useCallback(async () => {
    const hasData = hasDataRef.current;
    if (!hasData) setCockpitScoresLoading(true);
    try {
      const res = await fetch('/api/cockpit-score?horizon=365');
      if (!res.ok) { if (hasDataRef.current) setIsStale(true); return; }
      const data = await res.json();
      if (data.error) { if (hasDataRef.current) setIsStale(true); return; }
      const raw: CockpitScore[] = data.all_scores ?? data.scores ?? [];
      setAllScores(raw);
      hasDataRef.current = raw.length > 0;
      setApiSummary(data.summary ?? null);
      setEngineVersion(data.engine_version ?? '');
      setIsStale(data.stale === true);
    } catch {
      if (hasDataRef.current) setIsStale(true);
    } finally {
      if (!hasData) setCockpitScoresLoading(false);
    }
  }, [setCockpitScoresLoading]);

  // ─── Adaptive polling: 50s open / 5min closed ────────────────
  const cockpitPollInterval = marketOpen ? 50_000 : 5 * 60_000;

  useEffect(() => {
    fetchScores();
    intervalRef.current = setInterval(fetchScores, cockpitPollInterval);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchScores, cockpitPollInterval]);

  // ─── Client-side horizon filtering ────────────────────────────────
  const filteredScores = useMemo(() => {
    if (horizon === 9999) return allScores;
    return allScores.filter(s => s.days <= horizon);
  }, [allScores, horizon]);

  // ─── Sort by ACTION SCORE first, then cockpitScore ────────────────
  const sortedScores = useMemo(() => {
    return [...filteredScores].sort((a, b) => {
      const actionOrder: Record<string, number> = { 'GATILLAR YA': 4, 'ATRACTIVO': 3, 'NEUTRAL': 2, 'SIN SEÑAL': 1 };
      const aAction = actionOrder[a.actionScore.label] ?? 0;
      const bAction = actionOrder[b.actionScore.label] ?? 0;
      if (aAction !== bAction) return bAction - aAction;
      if (a.actionScore.score !== b.actionScore.score) return b.actionScore.score - a.actionScore.score;
      return b.cockpitScore - a.cockpitScore;
    });
  }, [filteredScores]);

  // ─── V7.0-FASE2: Filter out anestesiados (unless toggle is on) ────
  const activeScoresOnly = useMemo(() => {
    if (showAnestesiados) return sortedScores;
    return sortedScores.filter(s => !s.anestesiado);
  }, [sortedScores, showAnestesiados]);

  // ─── Search filter + Watchlist filter ─────────────────────────────
  const displayedScores = useMemo(() => {
    let result = activeScoresOnly;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(s => s.ticker.toLowerCase().includes(q));
    }
    if (watchlistFilterActive) {
      result = result.filter(s => isWatched(s.ticker));
    }
    return result;
  }, [activeScoresOnly, searchQuery, watchlistFilterActive, isWatched]);

  // ─── Instrument lookup Map ────────────────────────────────────────
  const instrumentMap = useMemo(() => {
    const map = new Map<string, Instrument>();
    for (const inst of instruments) map.set(inst.ticker, inst);
    return map;
  }, [instruments]);

  // ═══════════════════════════════════════════════════════════════════
  // V7.0-FASE2: ENRICHED SCORES with Adaptive Take Profit
  //
  // Take Profit se activa con:
  //   1. Ganancia directa en precio ≥ +1.00% en la jornada
  //   2. Presión compradora Top-5 cede (ratio < 0.8 o DESBALANCE VENTA)
  // ═══════════════════════════════════════════════════════════════════
  const enrichedScores = useMemo(() => {
    if (!position) return sortedScores;

    const heldTicker = position.ticker;
    const heldScore = sortedScores.find(s => s.ticker === heldTicker);
    if (!heldScore) return sortedScores;

    const liveData = liveDataMap.get(heldTicker);
    const instData = instrumentMap.get(heldTicker);
    const changePct = liveData?.change_pct ?? instData?.change ?? 0;

    // ── V7.0-FASE2: Use the new Adaptive Take Profit algorithm ──
    const tpResult = calculateAdaptiveTakeProfit({
      sessionGainPct: changePct,
      top5PressureRatio: heldScore.top5PressureRatio ?? null,
      top5PressurePct: heldScore.top5PressurePct ?? null,
      bookImbalanceLabel: heldScore.bookImbalanceLabel ?? 'SIN DATOS',
      anestesiado: heldScore.anestesiado ?? false,
      unifiedScore: heldScore.unifiedScore,
      actionLabel: heldScore.actionScore.label,
      ticker: heldTicker,
    });

    // Store result for EjecuciónPuraCard
    // (We set it outside the useMemo via useEffect below)

    // Legacy conditions preserved for El Grito card compatibility
    const isScoreCrater = (heldScore.actionScore.label === 'SIN SEÑAL' || heldScore.actionScore.label === 'NEUTRAL') && heldScore.unifiedScore < 40;
    const isAtResistance = heldScore.nearestSR?.type === 'R' && heldScore.distanceToSR < 0.3;

    // Combined trigger: new adaptive OR legacy conditions
    const isTakeProfit = tpResult.triggered || isScoreCrater || isAtResistance;

    if (!isTakeProfit) return sortedScores;

    // Build rotation suggestions: top 2 active instruments by unifiedScore (excluding held + excluding anestesiados)
    const candidates = sortedScores
      .filter(s => s.ticker !== heldTicker && !s.anestesiado && s.unifiedScore >= 40)
      .sort((a, b) => b.unifiedScore - a.unifiedScore)
      .slice(0, 2)
      .map(s => ({ ticker: s.ticker, unifiedScore: s.unifiedScore, tem: s.spreadNeto, spreadNeto: s.spreadNeto }));

    let reason = tpResult.triggered ? tpResult.reason : '';
    if (!reason && isAtResistance) reason = `🚨 TAKE PROFIT: ${heldTicker} en resistencia R2/R3 (dist ${heldScore.distanceToSR.toFixed(2)}%) — riesgo de reversión.`;
    if (!reason && isScoreCrater) reason = `🚨 TAKE PROFIT: ${heldTicker} Score colapsó a ${heldScore.unifiedScore} — salida recomendada.`;

    return sortedScores.map(s => {
      if (s.ticker !== heldTicker) return s;
      return {
        ...s,
        verdict: 'TAKE_PROFIT' as const,
        verdictReason: reason,
        isTakeProfit: true,
        takeProfitReason: reason,
        rotationSuggestions: candidates,
        sessionGainPct: changePct,
        bidPressureCeding: tpResult.bidPressureCeding,
      };
    });
  }, [sortedScores, position, liveDataMap, instrumentMap]);

  // Store adaptive take profit result for EjecuciónPuraCard
  useEffect(() => {
    if (!position) { setAdaptiveTakeProfit(null); return; }
    const heldScore = sortedScores.find(s => s.ticker === position.ticker);
    if (!heldScore) { setAdaptiveTakeProfit(null); return; }
    const liveData = liveDataMap.get(position.ticker);
    const instData = instrumentMap.get(position.ticker);
    const changePct = liveData?.change_pct ?? instData?.change ?? 0;

    const result = calculateAdaptiveTakeProfit({
      sessionGainPct: changePct,
      top5PressureRatio: heldScore.top5PressureRatio ?? null,
      top5PressurePct: heldScore.top5PressurePct ?? null,
      bookImbalanceLabel: heldScore.bookImbalanceLabel ?? 'SIN DATOS',
      anestesiado: heldScore.anestesiado ?? false,
      unifiedScore: heldScore.unifiedScore,
      actionLabel: heldScore.actionScore.label,
      ticker: position.ticker,
    });
    setAdaptiveTakeProfit(result);
  }, [sortedScores, position, liveDataMap, instrumentMap]);

  // ─── Check if there are NO alternative buy-imbalanced instruments ──
  const noAlternativeBuyImbalance = useMemo(() => {
    // No other instrument has real buy imbalance (GATILLAR YA, ATRACTIVO with score > 50, or DESBALANCE COMPRA/EXTREMO)
    const hasActiveBuyer = enrichedScores.some(s => {
      if (position && s.ticker === position.ticker) return false; // Exclude held position
      if (s.anestesiado) return false;
      if (s.actionScore.label === 'GATILLAR YA') return true;
      if (s.actionScore.label === 'ATRACTIVO' && s.unifiedScore > 50) return true;
      if (s.bookImbalanceLabel === 'DESBALANCE COMPRA' || s.bookImbalanceLabel === 'DESBALANCE EXTREMO') return true;
      return false;
    });
    return !hasActiveBuyer;
  }, [enrichedScores, position]);

  // Report take-profit count to parent
  useEffect(() => {
    if (onTakeProfitCountChange) {
      const count = enrichedScores.filter(s => s.isTakeProfit).length;
      onTakeProfitCountChange(count);
    }
  }, [enrichedScores, onTakeProfitCountChange]);

  // ─── Trigger row flash ────────────────────────────────────────────
  const triggerRowFlash = useCallback((ticker: string) => {
    setScreamingRows(prev => { const next = new Set(prev); next.add(ticker); return next; });
    const existing = screamTimersRef.current.get(ticker);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      setScreamingRows(prev => { const next = new Set(prev); next.delete(ticker); return next; });
      screamTimersRef.current.delete(ticker);
    }, 4000);
    screamTimersRef.current.set(ticker, timer);
  }, []);

  // ─── Update scream log ────────────────────────────────────────────
  const updateScreamLog = useCallback((ticker: string, event: string, score: number) => {
    const now = new Date();
    const ts = now.toLocaleTimeString('es-AR', { hour12: false, timeZone: 'America/Argentina/Buenos_Aires' });
    setLatestScream(`[${ts}] 🔔 ${ticker} → ${event} (Score ${score})`);
    setScreamKey(k => k + 1);
  }, []);

  // ─── Sound alert + Row Flash + Scream Log ─────────────────────────
  useEffect(() => {
    if (!soundEnabled || enrichedScores.length === 0) return;
    const scoreMap = new Map(enrichedScores.map(s => [s.ticker, s]));

    const currentAlerts = new Set(
      enrichedScores.filter(s => s.actionScore.label === 'GATILLAR YA' || (s.actionScore.label === 'ATRACTIVO' && s.unifiedScore > 50)).map(s => s.ticker)
    );
    if (prevGatillarRef.current.size > 0) {
      for (const ticker of currentAlerts) {
        if (!prevGatillarRef.current.has(ticker)) {
          playAlertBeep('entry');
          triggerRowFlash(ticker);
          const s = scoreMap.get(ticker);
          if (s) updateScreamLog(ticker, s.actionScore.label, s.unifiedScore);
          break;
        }
      }
    }
    prevGatillarRef.current = currentAlerts;

    const currentTakeProfit = new Set(enrichedScores.filter(s => s.isTakeProfit).map(s => s.ticker));
    if (prevTakeProfitRef.current.size > 0) {
      for (const ticker of currentTakeProfit) {
        if (!prevTakeProfitRef.current.has(ticker)) {
          playAlertBeep('exit');
          triggerRowFlash(ticker);
          const s = scoreMap.get(ticker);
          if (s) updateScreamLog(ticker, 'TAKE PROFIT', s.unifiedScore);
          break;
        }
      }
    }
    prevTakeProfitRef.current = currentTakeProfit;

    // Price alert thresholds
    const newTriggered = new Set<string>();
    for (const score of enrichedScores) {
      const alert = alerts[score.ticker];
      if (!alert) continue;
      const liveData = liveDataMap.get(score.ticker);
      const instData = instrumentMap.get(score.ticker);
      const price = liveData?.last_price ?? instData?.price ?? 0;
      if (price <= 0) continue;
      const crossed = alert.direction === '>' ? price > alert.price : price < alert.price;
      if (crossed) {
        newTriggered.add(score.ticker);
        if (!prevTriggeredRef.current.has(score.ticker)) {
          playAlertBeep('entry');
          triggerRowFlash(score.ticker);
          updateScreamLog(score.ticker, `PRICE ${alert.direction} ${alert.price.toFixed(4)}`, score.unifiedScore);
        }
      }
    }
    prevTriggeredRef.current = newTriggered;
    setTriggeredAlerts(prev => {
      if (prev.size === newTriggered.size && [...prev].every(t => newTriggered.has(t))) return prev;
      return newTriggered;
    });
  }, [enrichedScores, soundEnabled, playAlertBeep, alerts, liveDataMap, instrumentMap, triggerRowFlash, updateScreamLog]);

  // ─── Verdict state change detection ───────────────────────────────
  const prevVerdictRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    if (enrichedScores.length === 0) return;
    const currentVerdicts = new Map<string, string>();
    for (const s of enrichedScores) currentVerdicts.set(s.ticker, s.verdict);

    for (const [ticker, verdict] of currentVerdicts) {
      const prev = prevVerdictRef.current.get(ticker);
      if (prev && prev !== verdict) {
        const isNotable = verdict === 'PUNTO_CARAMELO' || verdict === 'SALTO_TACTICO' || verdict === 'TAKE_PROFIT';
        if (isNotable && !screamingRows.has(ticker)) {
          triggerRowFlash(ticker);
          const s = enrichedScores.find(sc => sc.ticker === ticker);
          if (s) updateScreamLog(ticker, verdict, s.unifiedScore);
          if (soundEnabled && verdict === 'TAKE_PROFIT') playAlertBeep('exit');
          else if (soundEnabled) playAlertBeep('entry');
        }
      }
    }
    prevVerdictRef.current = currentVerdicts;
  }, [enrichedScores, soundEnabled, screamingRows, triggerRowFlash, updateScreamLog, playAlertBeep]);

  // ─── CSV Export ────────────────────────────────────────────────────
  const handleExportCSV = useCallback(() => {
    const rows = displayedScores;
    if (rows.length === 0) return;
    const header = 'Ticker,Type,Price,TEM,UnifiedScore,ActionScore,ActionLabel,Anestesiado';
    const lines = rows.map(s => {
      const liveData = liveDataMap.get(s.ticker);
      const instData = instrumentMap.get(s.ticker);
      const price = liveData?.last_price ?? instData?.price ?? 0;
      const tem = instData?.tem ?? 0;
      return [s.ticker, s.type, price.toFixed(4), tem.toFixed(2), s.unifiedScore.toFixed(0), s.actionScore.score, s.actionScore.label, s.anestesiado ? 'Y' : 'N'].join(',');
    });
    const csv = [header, ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `arb-radar-cockpit-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  }, [displayedScores, liveDataMap, instrumentMap]);

  // ─── Sync filtered scores to store ────────────────────────────────
  useEffect(() => { setCockpitScores(sortedScores); }, [sortedScores, setCockpitScores]);

  // ─── El Grito instruments ─────────────────────────────────────────
  const elGritoScores = useMemo(() => {
    return enrichedScores.filter(
      s => !s.anestesiado && (s.verdict === 'SALTO_TACTICO' || s.verdict === 'PUNTO_CARAMELO' || s.actionScore.label === 'GATILLAR YA' || s.isTakeProfit)
    );
  }, [enrichedScores]);

  // ─── FASE 2: Check if any flow metrics are active ──────────────────
  const hasFlowMetrics = useMemo(() => {
    return enrichedScores.some(s =>
      (s.volumeVelocity && s.volumeVelocity.label !== 'NORMAL') ||
      (s.icebergDetected && s.icebergDetected.detected) ||
      (s.marketSweep && s.marketSweep.detected)
    );
  }, [enrichedScores]);

  // ─── Computed: horizon label ───────────────────────────────────────
  const horizonLabel = useMemo(() => {
    const opt = HORIZON_OPTIONS.find(h => h.value === horizon);
    return opt ? opt.desc : `${horizon}d`;
  }, [horizon]);

  // ─── Computed: summary counts ──────────────────────────────────────
  const localSummary = useMemo(() => {
    const allCount = allScores.length;
    const filteredCount = filteredScores.length;
    return {
      total: allCount,
      within_horizon: filteredCount,
      activos: enrichedScores.filter(s => !s.anestesiado).length,
      anestesiado: enrichedScores.filter(s => s.anestesiado).length,
      gatillar: enrichedScores.filter(s => !s.anestesiado && s.actionScore.label === 'GATILLAR YA').length,
      atractivoAction: enrichedScores.filter(s => !s.anestesiado && s.actionScore.label === 'ATRACTIVO').length,
      take_profit: enrichedScores.filter(s => s.isTakeProfit).length,
    };
  }, [allScores, filteredScores, enrichedScores]);

  // ─── MEP & RP ─────────────────────────────────────────────────────
  const mepValue = marketTruth?.mep?.value ?? null;
  const mepConfidence = marketTruth?.mep?.confidence ?? null;
  const rpValue = marketTruth?.riesgo_pais?.value ?? null;

  function confidenceBadge(level: string | null): { color: string; bg: string } {
    if (!level) return { color: '#6b7280', bg: 'rgba(107,114,128,0.08)' };
    switch (level) {
      case 'ALTA': return { color: '#2eebc8', bg: 'rgba(46,235,200,0.10)' };
      case 'MEDIA': return { color: '#fbbf24', bg: 'rgba(251,191,36,0.10)' };
      case 'BAJA': return { color: '#fb923c', bg: 'rgba(251,146,60,0.10)' };
      case 'CRITICA': return { color: '#f87171', bg: 'rgba(248,113,113,0.10)' };
      default: return { color: '#6b7280', bg: 'rgba(107,114,128,0.08)' };
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // RENDER — EJECUCIÓN PURA
  // ═══════════════════════════════════════════════════════════════════
  return (
    <div className="space-y-5">
      {/* ═══════════════════════════════════════════════════════════ */}
      {/* HEADER — EJECUCIÓN PURA                                      */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <div className="nexus-banner relative p-5 sm:p-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-xl font-bold text-app-text neon-price mb-1">
              ◈ EJECUCIÓN PURA — QUANT X
            </h2>
            <p className="text-sm text-app-text3">
              {hasFlowMetrics ? 'V7.0-FASE2 — VELOCIDAD & FLUJO' : 'V7.0-FASE2 — EJECUCIÓN PURA'} · Horizonte: {horizonLabel}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {watchlist.length > 0 && (
              <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-lg bg-[#fbbf24]/10 border border-[#fbbf24]/20 text-[9px] text-[#fbbf24] font-medium">
                <Star className="w-2.5 h-2.5 fill-[#fbbf24]" />{watchlist.length}
              </span>
            )}
            {alertCount > 0 && (
              <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-lg bg-[#f87171]/10 border border-[#f87171]/20 text-[9px] text-[#f87171] font-medium">
                <BellRing className="w-2.5 h-2.5" />{alertCount}
              </span>
            )}
            <button onClick={toggleSound}
              className={`flex items-center gap-1 px-2 py-1 rounded-lg border transition-all duration-150 ${
                soundEnabled ? 'bg-[#f87171]/10 border-[#f87171]/30 text-[#f87171]' : 'bg-app-subtle/40 border-app-border/40 text-app-text4 hover:text-app-text3'
              }`}
              title={soundEnabled ? 'Desactivar alerta sonora' : 'Activar alerta sonora'}>
              {soundEnabled ? <Bell className="w-3.5 h-3.5" /> : <BellOff className="w-3.5 h-3.5" />}
              <span className="text-[9px] font-medium hidden sm:inline">{soundEnabled ? 'ON' : 'OFF'}</span>
            </button>
            {isLive && (
              <span className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-app-accent-dim text-[10px] text-[#2eebc8]">
                <span className="live-dot" />LIVE
              </span>
            )}
            {engineVersion && <span className="text-[9px] text-app-text4 font-mono">{engineVersion}</span>}
          </div>
        </div>
        <div className="gradient-line-animated mt-3" />
        <div className="absolute inset-0 pointer-events-none opacity-[0.03]" style={{ background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(46,235,200,0.1) 2px, rgba(46,235,200,0.1) 4px)' }} />
      </div>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* V7.0-FASE2: MÓDULO DE EJECUCIÓN PURA                         */}
      {/* ═══════════════════════════════════════════════════════════ */}
      {adaptiveTakeProfit && position && (
        <EjecucionPuraCard
          takeProfitResult={adaptiveTakeProfit}
          ticker={position.ticker}
          noAlternativeBuyImbalance={noAlternativeBuyImbalance}
        />
      )}

      <CurveAlertCard scores={enrichedScores} />

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* STALE / MARKET CLOSED WARNINGS                                */}
      {/* ═══════════════════════════════════════════════════════════ */}
      {isStale && (
        <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#fb923c]/8 border border-[#fb923c]/25 text-[10px] text-[#fb923c] animate-fadeInUp" style={{ boxShadow: '0 0 15px rgba(251,146,60,0.1)' }}>
          <span className="text-xs">⏳</span>
          <span className="font-medium uppercase tracking-wider">Datos en caché</span>
          <span className="text-[9px] text-[#fb923c]/70">— APIs no responden</span>
        </div>
      )}
      {!marketOpen && isLive && (
        <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#fb923c]/6 border border-[#fb923c]/20 text-[10px] text-[#fb923c] animate-fadeInUp">
          <span className="text-xs">🏦</span>
          <span className="font-medium uppercase tracking-wider">Mercado cerrado</span>
          <span className="text-[9px] text-[#fb923c]/70">— Polling reducido</span>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* SUMMARY BAR — Simplificado                                     */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <div className="nexus-banner glass px-4 py-3 animate-fadeInUp overflow-x-auto scrollbar-hide" style={{ borderLeft: '3px solid rgba(46,235,200,0.2)' }}>
        <div className="flex items-center gap-3 min-w-max text-xs">
          {/* Activos */}
          <div className="flex items-center gap-1.5">
            <span className="text-app-text4 uppercase tracking-wider text-[10px]">Activos</span>
            <span className="font-mono font-bold text-app-text">{localSummary.activos}</span>
          </div>
          <div className="w-px h-3 bg-app-border/40" />

          {/* Take Profit */}
          {localSummary.take_profit > 0 && (
            <>
              <div className="flex items-center gap-1.5">
                <span className="nexus-pill" style={{ color: '#dc2626', background: 'rgba(220,38,38,0.2)' }}>🚨 Take Profit</span>
                <span className="font-mono font-bold animate-pulse text-sm" style={{ color: '#dc2626', textShadow: '0 0 10px rgba(220,38,38,0.5)' }}>{localSummary.take_profit}</span>
              </div>
              <div className="w-px h-3 bg-app-border/40" />
            </>
          )}

          {/* Gatillar */}
          {localSummary.gatillar > 0 && (
            <>
              <div className="flex items-center gap-1.5">
                <span className="nexus-pill" style={{ color: '#f87171', background: 'rgba(248,113,113,0.15)' }}>🔥 Gatillar</span>
                <span className="font-mono font-bold animate-pulse text-sm" style={{ color: '#f87171', textShadow: '0 0 8px rgba(248,113,113,0.4)' }}>{localSummary.gatillar}</span>
              </div>
              <div className="w-px h-3 bg-app-border/40" />
            </>
          )}

          {/* Atractivo */}
          {localSummary.atractivoAction > 0 && (
            <>
              <div className="flex items-center gap-1.5">
                <span className="nexus-pill" style={{ color: '#2eebc8', background: 'rgba(46,235,200,0.1)' }}>✓ Atractivo</span>
                <span className="font-mono font-bold" style={{ color: '#2eebc8', textShadow: '0 0 6px rgba(46,235,200,0.3)' }}>{localSummary.atractivoAction}</span>
              </div>
              <div className="w-px h-3 bg-app-border/40" />
            </>
          )}

          {/* Anestesiados count with toggle */}
          {localSummary.anestesiado > 0 && (
            <>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setShowAnestesiados(prev => !prev)}
                  className={`flex items-center gap-1 px-1.5 py-0.5 rounded-lg border transition-all ${
                    showAnestesiados
                      ? 'bg-[#6b7280]/15 border-[#6b7280]/30 text-[#94a3b8]'
                      : 'bg-transparent border-transparent text-[#6b7280] hover:text-[#94a3b8]'
                  }`}
                  title={showAnestesiados ? 'Ocultar instrumentos anestesiados' : 'Mostrar instrumentos anestesiados (ATR < 0.30%)'}
                >
                  {showAnestesiados ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                  <span className="nexus-pill" style={{ color: '#6b7280', background: 'rgba(107,114,128,0.15)' }}>💤 {localSummary.anestesiado}</span>
                </button>
              </div>
              <div className="w-px h-3 bg-app-border/40" />
            </>
          )}

          {/* MEP */}
          {mepValue !== null && (
            <>
              <div className="flex items-center gap-1.5">
                <span className="text-app-text4 uppercase tracking-wider text-[10px]">MEP</span>
                <span className="font-mono font-bold text-app-accent-text">{fmtNum(mepValue, 2)}</span>
                {mepConfidence && (() => {
                  const cb = confidenceBadge(mepConfidence);
                  return <span className="px-1.5 py-0.5 rounded text-[8px] font-bold" style={{ color: cb.color, background: cb.bg }}>{mepConfidence}</span>;
                })()}
              </div>
              <div className="w-px h-3 bg-app-border/40" />
            </>
          )}

          {/* RP */}
          {rpValue !== null && (
            <>
              <div className="flex items-center gap-1.5">
                <span className="text-app-text4 uppercase tracking-wider text-[10px]">RP</span>
                <span className="font-mono font-bold text-app-text2">{fmtNum(rpValue, 0)}</span>
              </div>
              <div className="w-px h-3 bg-app-border/40" />
            </>
          )}

          {/* Engine status */}
          <div className="flex items-center gap-1.5">
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${cockpitScoresLoading ? 'bg-[#fbbf24] animate-pulse' : isStale ? 'bg-[#fb923c]' : cockpitScores.length > 0 ? 'bg-[#2eebc8]' : 'bg-app-text4'}`} />
            <span className={`text-[10px] uppercase tracking-wider ${isStale ? 'text-[#fb923c]' : 'text-app-text4'}`}>
              {cockpitScoresLoading ? 'Sync' : isStale ? 'STALE' : cockpitScores.length > 0 ? 'OK' : 'Idle'}
            </span>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* HORIZON FILTER + SEARCH + TOOLS                                */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <div className="flex items-center gap-2 animate-fadeInUp overflow-x-auto scrollbar-hide flex-wrap">
        <span className="text-app-text4 text-[10px] uppercase tracking-wider shrink-0">Horizonte</span>
        <div className="flex items-center gap-1">
          {HORIZON_OPTIONS.map(opt => (
            <button key={opt.value} onClick={() => handleHorizonChange(opt.value)}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-mono font-semibold transition-all duration-150 ${
                horizon === opt.value
                  ? 'bg-[#2eebc8]/15 text-[#2eebc8] border border-[#2eebc8]/30 shadow-[0_0_10px_rgba(46,235,200,0.15)]'
                  : 'bg-app-subtle/40 text-app-text3 border border-transparent hover:bg-app-hover hover:text-app-text2'
              }`}
              title={opt.desc}>
              {opt.label}
            </button>
          ))}
        </div>
        <span className="text-app-text4 text-[9px] font-mono shrink-0">{displayedScores.length} instr.</span>
        <div className="w-px h-4 bg-app-border/40 shrink-0" />
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-app-text4" />
          <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Ticker..."
            className="h-7 w-28 sm:w-36 pl-7 pr-2 rounded-lg bg-app-subtle/40 border border-app-border/40 text-[10px] font-mono text-app-text placeholder:text-app-text4 focus:outline-none focus:ring-1 focus:ring-[#2eebc8]/40 focus:border-[#2eebc8]/30 transition-all" />
        </div>
        <button onClick={handleExportCSV} disabled={displayedScores.length === 0}
          className="flex items-center gap-1 px-2 py-1 rounded-lg bg-app-subtle/40 border border-app-border/40 text-[10px] font-medium text-app-text3 hover:text-app-text2 hover:bg-app-hover transition-all disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
          title="Exportar CSV">
          <Download className="w-3 h-3" /><span className="hidden sm:inline">CSV</span>
        </button>
        <div className="w-px h-4 bg-app-border/40 shrink-0" />
        <button onClick={() => setWatchlistFilterActive(prev => !prev)}
          className={`flex items-center gap-1 px-2 py-1 rounded-lg border transition-all duration-150 shrink-0 ${
            watchlistFilterActive ? 'bg-[#fbbf24]/10 border-[#fbbf24]/30 text-[#fbbf24]' : 'bg-app-subtle/40 border-app-border/40 text-app-text4 hover:text-app-text3'
          }`}
          title={watchlistFilterActive ? 'Mostrar todos' : 'Solo watchlist'}>
          <Star className={`w-3 h-3 ${watchlistFilterActive ? 'fill-[#fbbf24]' : ''}`} />
          <span className="text-[9px] font-medium">Watchlist</span>
          {watchlist.length > 0 && <span className={`text-[8px] font-mono font-bold ${watchlistFilterActive ? 'text-[#fbbf24]' : 'text-app-text4'}`}>{watchlist.length}</span>}
        </button>
        {/* Shortcuts toggle */}
        <button onClick={() => setShortcutsExpanded(prev => !prev)}
          className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-app-subtle/40 border border-app-border/40 text-[10px] font-medium text-app-text3 hover:text-app-text2 hover:bg-app-hover transition-all shrink-0">
          <Keyboard className="w-3 h-3" />⌨ <span className="text-[8px] text-app-text4">{shortcutsExpanded ? '▲' : '▼'}</span>
        </button>
      </div>

      {/* Shortcuts panel */}
      {shortcutsExpanded && (
        <div className="flex items-center gap-3 flex-wrap px-3 py-2 rounded-lg bg-app-subtle/20 border border-app-border/20 text-[9px] text-app-text3 animate-fadeInUp">
          <span className="flex items-center gap-1"><kbd>1-5</kbd> Tabs</span>
          <span className="flex items-center gap-1"><kbd>L</kbd> LIVE</span>
          <span className="flex items-center gap-1"><kbd>S</kbd> Sonido</span>
          <span className="flex items-center gap-1"><kbd>C</kbd> CSV</span>
          <span className="flex items-center gap-1"><kbd>/</kbd> Buscar</span>
          <span className="flex items-center gap-1"><kbd>Esc</kbd> Limpiar</span>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* EL GRITO — Capa 1 Alert Card (simplified)                     */}
      {/* ═══════════════════════════════════════════════════════════ */}
      {elGritoScores.length > 0 && <ElGritoCard scores={enrichedScores} />}

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* SCREAM LOG                                                     */}
      {/* ═══════════════════════════════════════════════════════════ */}
      {latestScream && (
        <div className="scream-console px-4 py-2 animate-fadeInUp">
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-semibold uppercase tracking-wider text-[#fbbf24] shrink-0">SCREAM LOG</span>
            <span className="w-px h-3 bg-[#fbbf24]/20 shrink-0" />
            <span key={screamKey} className="scream-text-enter font-mono text-[11px] text-[#fbbf24] truncate" style={{ textShadow: '0 0 6px rgba(251,191,36,0.3)' }}>
              {latestScream}
            </span>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* TABLA MINIMALISTA — EJECUCIÓN PURA                            */}
      {/*                                                                */}
      {/* Solo columnas esenciales:                                      */}
      {/*   #, Instrumento, Precio, TEM, Score, ACCIÓN                   */}
      {/*                                                                 */}
      {/* Datos secundarios OCULTOS: S/R, Dist%, Inyección, Spread,     */}
      {/* micro-bars, context rows                                       */}
      {/* ═══════════════════════════════════════════════════════════ */}
      {displayedScores.length === 0 ? (
        <div className="nexus-banner p-8 text-center animate-fadeInUp">
          <div className="text-app-text4 text-sm">
            {cockpitScoresLoading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="animate-spin inline-block w-5 h-5 border-2 border-[#2eebc8] border-t-transparent rounded-full" style={{ boxShadow: '0 0 10px rgba(46,235,200,0.4)' }} />
                Cargando señales...
              </span>
            ) : searchQuery.trim() ? (
              <span>No se encontraron instrumentos que coincidan con &quot;{searchQuery.trim()}&quot;</span>
            ) : (
              'No hay datos de cockpit disponibles.'
            )}
          </div>
        </div>
      ) : (
        <div className="nexus-banner animate-fadeInUp">
          <div className="cockpit-scroll-container">
            {/* Desktop header — minimalista: 7 columnas */}
            <div className="hidden md:grid nx-sticky-hdr px-4 py-3.5 grid-cols-[36px_1fr_100px_80px_72px_1fr_auto] gap-2 items-center text-[9px] text-app-text4 uppercase tracking-wider font-medium">
              <span>#</span>
              <span>Instrumento</span>
              <span className="text-right">Precio</span>
              <span className="text-right">TEM</span>
              <span className="text-center">Score</span>
              <span className="text-right">ACCIÓN</span>
              <span className="text-center">FLUJO</span>
            </div>

            {/* Mobile header */}
            <div className="md:hidden nx-sticky-hdr px-3 py-2 text-[8px] text-app-text4 uppercase tracking-wider font-medium flex items-center justify-between">
              <span>Instrumentos</span>
              <span>Acción</span>
            </div>

            {/* Rows */}
            <div className="md:divide-y md:divide-app-border/30 space-y-2 md:space-y-0 px-2 md:px-1 pb-4 md:pb-0">
              {displayedScores.map((score, idx) => {
                const vc = VERDICT_CONFIG[score.verdict];
                const rank = idx + 1;
                const liveData = liveDataMap.get(score.ticker);
                const instData = instrumentMap.get(score.ticker);
                const price = liveData?.last_price ?? instData?.price ?? 0;
                const tem = instData?.tem ?? 0;

                const asc = ACTION_SCORE_CONFIG[score.actionScore.label] ?? ACTION_SCORE_CONFIG['SIN SEÑAL'];
                const isGatillar = score.actionScore.label === 'GATILLAR YA';
                const isAtractivoAction = score.actionScore.label === 'ATRACTIVO';
                const isTakeProfit = !!score.isTakeProfit;
                const dotClass = isTakeProfit ? 'nx-dot nx-dot-fire' : isGatillar ? 'nx-dot nx-dot-fire' : isAtractivoAction ? 'nx-dot nx-dot-teal' : 'nx-dot nx-dot-gray';

                return (
                  <div
                    key={`${score.ticker}-${score.type}`}
                    id={`cockpit-row-${score.ticker}`}
                    className={`
                      nexus-row ${isTakeProfit ? 'nexus-row-gatillar' : isGatillar ? 'nexus-row-gatillar' : isAtractivoAction ? 'nexus-row-atractivo' : ''} animate-row-in ${getStaggerClass(idx)} ${triggeredAlerts.has(score.ticker) ? 'nx-alert-flash' : ''} ${screamingRows.has(score.ticker) ? 'nx-scream-flash' : ''}
                    `}
                    style={{
                      ...(idx >= 8 ? { contentVisibility: 'auto', containIntrinsicSize: '0 72px' } : {}),
                      '--accent-color': asc.color,
                      '--nx-accent': asc.color,
                      borderLeftColor: isTakeProfit ? '#dc2626' : asc.color,
                    } as React.CSSProperties}
                  >
                    {/* ═══════════════════════════════════════════════════ */}
                    {/* MOBILE CARD LAYOUT — Minimalista                    */}
                    {/* ═══════════════════════════════════════════════════ */}
                    <div className={`md:hidden nexus-row ${isTakeProfit ? 'nexus-row-gatillar' : isGatillar ? 'nexus-row-gatillar' : isAtractivoAction ? 'nexus-row-atractivo' : ''} p-3 rounded-xl`}
                      style={{ background: isTakeProfit ? 'linear-gradient(135deg, rgba(220,38,38,0.1), rgba(21,29,46,0.9))' : isGatillar ? 'linear-gradient(135deg, rgba(248,113,113,0.08), rgba(21,29,46,0.9))' : isAtractivoAction ? 'linear-gradient(135deg, rgba(46,235,200,0.05), rgba(21,29,46,0.9))' : 'linear-gradient(135deg, rgba(21,29,46,0.85), rgba(15,23,38,0.7))' }}>
                      {/* Row 1: Rank + Ticker + Type + Action badge + watchlist */}
                      <div className="flex items-center gap-2 mb-2">
                        <div className={`rank-badge ${getRankClass(rank)} text-[9px]`} style={{ width: 22, height: 22, fontSize: 9 }}>{rank}</div>
                        <div className="flex items-center gap-1.5 min-w-0 flex-1">
                          <span className={dotClass} />
                          <span className="font-mono font-bold text-sm text-app-text truncate">{score.ticker}</span>
                          <span className={`shrink-0 px-1 py-0.5 rounded text-[7px] font-bold ${score.type === 'LECAP' ? 'bg-app-accent-dim text-[#2eebc8]' : 'bg-[#f472b6]/10 text-[#f472b6]'}`}>
                            {score.type}
                          </span>
                          <span className="text-[8px] text-app-text4 font-mono">{score.days}d</span>
                        </div>
                        <span
                          className={`action-score-badge px-1.5 py-0.5 rounded-lg text-[8px] font-bold whitespace-nowrap ${isTakeProfit || isGatillar ? 'animate-pulse nexus-badge-fire nx-shimmer' : ''} ${isAtractivoAction ? 'nexus-badge-teal' : ''}`}
                          style={{
                            color: isTakeProfit ? '#dc2626' : asc.color,
                            background: isTakeProfit ? 'rgba(220,38,38,0.18)' : asc.bg,
                            boxShadow: isTakeProfit ? '0 0 16px rgba(220,38,38,0.4)' : isGatillar ? asc.glow : 'none',
                            border: isTakeProfit ? '1px solid rgba(220,38,38,0.4)' : isGatillar ? `1px solid ${asc.color}40` : '1px solid transparent',
                          }}
                        >
                          {isTakeProfit ? '🚨 VENDER' : isGatillar ? '🔥 GATILLAR' : isAtractivoAction ? '✓ ATRACTIVO' : score.actionScore.label}
                        </span>
                        <div className="flex items-center gap-0.5 shrink-0">
                          <button onClick={() => toggleWatchlist(score.ticker)}
                            className={`flex items-center justify-center w-5 h-5 rounded transition-all duration-150 ${isWatched(score.ticker) ? 'text-[#fbbf24] hover:text-[#fbbf24]/70' : 'text-app-text4 hover:text-app-text3'}`}
                            title={isWatched(score.ticker) ? 'Quitar de watchlist' : 'Agregar a watchlist'}>
                            <Star className={`w-3 h-3 ${isWatched(score.ticker) ? 'fill-[#fbbf24]' : ''}`} />
                          </button>
                          <PriceAlertPopover ticker={score.ticker} currentPrice={price} alert={getAlert(score.ticker)}
                            onSetAlert={setAlert} onRemoveAlert={removeAlert} onClearAll={clearAllAlerts} alertCount={alertCount} />
                        </div>
                      </div>

                      {/* Row 2: Precio + TEM + Score ring */}
                      <div className="flex items-center gap-3 text-xs">
                        <div>
                          <span className="text-app-text4">Precio </span>
                          <span className="font-mono text-app-text2" style={{ textShadow: '0 0 6px rgba(46,235,200,0.3)' }}>{price > 0 ? fmtNum(price, 4) : '—'}</span>
                        </div>
                        <div>
                          <span className="text-app-text4">TEM </span>
                          <span className="font-mono text-app-text2">{fmtNum(tem, 2)}%</span>
                        </div>
                        <div className="ml-auto flex items-center gap-1">
                          {score.actionScore.label !== 'SIN SEÑAL' && (
                            <div className="nexus-score-gauge"><ScoreRing score={score.unifiedScore} color={vc.color} size={22} /></div>
                          )}
                          <span className="font-mono font-bold text-sm" style={{ color: vc.color }}>{score.unifiedScore.toFixed(0)}</span>
                        </div>
                      </div>

                      {/* Row 3: Flow Metrics Badges (mobile: separate line) */}
                      <FlowMetricsBadges score={score} layout="mobile" />
                    </div>

                    {/* ═══════════════════════════════════════════════════ */}
                    {/* DESKTOP GRID — Minimalista 6 columnas               */}
                    {/* ═══════════════════════════════════════════════════ */}
                    <div className="hidden md:block cockpit-row-card">
                      <div className="grid grid-cols-[36px_1fr_100px_80px_72px_1fr_auto] gap-2 items-center py-3.5">
                        {/* Rank */}
                        <div className={`rank-badge ${getRankClass(rank)} text-[10px]`} style={{ width: 30, height: 30, fontSize: 10 }}>{rank}</div>

                        {/* Ticker + Type + Star + Bell */}
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className={dotClass} />
                          <span className="font-mono font-bold text-sm text-app-text truncate">{score.ticker}</span>
                          <span className={`shrink-0 px-1 py-0.5 rounded text-[7px] font-bold ${score.type === 'LECAP' ? 'bg-app-accent-dim text-[#2eebc8]' : 'bg-[#f472b6]/10 text-[#f472b6]'}`}>
                            {score.type}
                          </span>
                          <span className="text-[8px] text-app-text4 font-mono">{score.days}d</span>
                          <button onClick={() => toggleWatchlist(score.ticker)}
                            className={`flex items-center justify-center w-4 h-4 rounded transition-all duration-150 shrink-0 ${isWatched(score.ticker) ? 'text-[#fbbf24] hover:text-[#fbbf24]/70' : 'text-app-text4 hover:text-app-text3'}`}
                            title={isWatched(score.ticker) ? 'Quitar de watchlist' : 'Agregar a watchlist'}>
                            <Star className={`w-2.5 h-2.5 ${isWatched(score.ticker) ? 'fill-[#fbbf24]' : ''}`} />
                          </button>
                          <PriceAlertPopover ticker={score.ticker} currentPrice={price} alert={getAlert(score.ticker)}
                            onSetAlert={setAlert} onRemoveAlert={removeAlert} onClearAll={clearAllAlerts} alertCount={alertCount} />
                        </div>

                        {/* Price */}
                        <div className="text-right font-mono text-base font-bold text-app-text neon-price"
                          style={{ textShadow: '0 0 8px rgba(46,235,200,0.5), 0 0 20px rgba(46,235,200,0.2)' }}>
                          {price > 0 ? fmtNum(price, 4) : '—'}
                        </div>

                        {/* TEM */}
                        <div className="text-right font-mono text-sm font-semibold text-app-text2">{fmtNum(tem, 2)}%</div>

                        {/* Score Ring + number */}
                        <div className="flex justify-center items-center">
                          <div className="nexus-score-gauge relative">
                            <ScoreRing score={score.unifiedScore} color={vc.color} size={40} />
                            <span className="absolute inset-0 flex items-center justify-center font-mono font-black text-sm" style={{ color: vc.color }}>
                              {score.unifiedScore.toFixed(0)}
                            </span>
                          </div>
                        </div>

                        {/* ACCIÓN — El Gatillador badge */}
                        <div className="flex justify-end items-center gap-1.5">
                          <span
                            className={`action-score-badge px-3 py-2 rounded-xl text-[11px] font-bold whitespace-nowrap ${isTakeProfit || isGatillar ? 'nexus-badge-fire nx-shimmer' : ''} ${isAtractivoAction ? 'nexus-badge-teal' : ''}`}
                            style={{
                              color: isTakeProfit ? '#dc2626' : asc.color,
                              background: isTakeProfit ? 'rgba(220,38,38,0.18)' : asc.bg,
                              boxShadow: isTakeProfit ? '0 0 16px rgba(220,38,38,0.4), 0 0 30px rgba(220,38,38,0.15)' : isGatillar ? '0 0 16px rgba(248,113,113,0.4), 0 0 30px rgba(248,113,113,0.15)' : isAtractivoAction ? '0 0 10px rgba(46,235,200,0.25)' : 'none',
                              border: isTakeProfit ? '1px solid rgba(220,38,38,0.4)' : isGatillar ? `1px solid ${asc.color}40` : '1px solid transparent',
                            }}
                          >
                            {isTakeProfit ? '🚨 VENDER' : isGatillar ? '🔥 GATILLAR YA' : isAtractivoAction ? '✓ ATRACTIVO' : score.actionScore.label}
                          </span>
                          {score.actionScore.label !== 'SIN SEÑAL' && (
                            <div className="nexus-score-gauge"><ScoreRing score={score.actionScore.score} color={asc.color} size={28} /></div>
                          )}
                        </div>

                        {/* FLUJO — Flow Metrics Badges */}
                        <FlowMetricsBadges score={score} layout="desktop" />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* FOOTER: Engine info only (methodology removed for minimalism)  */}
      {/* ═══════════════════════════════════════════════════════════ */}
      {displayedScores.length > 0 && (
        <div className="flex items-center gap-4 flex-wrap text-[9px] text-app-text4 animate-fadeInUp">
          <span className="uppercase tracking-wider font-medium">Pesos:</span>
          <span>Spread 25%</span>
          <span>ΔTIR 25%</span>
          <span>Presión 20%</span>
          <span>Upside 20%</span>
          <span>Vel. 10%</span>
          <div className="w-px h-3 bg-app-border/30" />
          <span>Trigger Salida: +1.00% ganancia / BID cede</span>
          <div className="w-px h-3 bg-app-border/30" />
          <span>Anestesiado: ATR% &lt; 0.30%</span>
        </div>
      )}
    </div>
  );
}
