'use client';

// ════════════════════════════════════════════════════════════════════════
// V5.2 SCANNER — CockpitTab: PRICE ACTION SCANNER
//
// Unified cockpit with 4 new Price Action columns:
//   1. S/R Mas Cercano — nearest support/resistance level
//   2. Distancia a S/R (%) — % distance with <0.5% visual alert
//   3. Inyeccion de Volumen — volume acceleration (X2, X3, X5, EXPLOSIVO)
//   4. SCORE — El Gatillador (GATILLAR YA / ATRACTIVO / NEUTRAL / SIN SENAL)
//
// V5.2: Market heatmap + keyboard shortcuts panel + enhanced action score badges
// V5.1: Mobile responsive card layout + visual enhancements
//
// BLINDAJE: La comision del 0.15% NO se toca. price x 1.0015 = IMMUTABLE.
// ════════════════════════════════════════════════════════════════════════

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { Instrument, Config, Position, CockpitScore, LiveInstrument } from '@/lib/types';
import { useRadarStore } from '@/lib/store';
import { Search, Bell, BellOff, Download, Keyboard, Star, BellRing, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';

// ─── Props ────────────────────────────────────────────────────────────
interface CockpitTabProps {
  instruments: Instrument[];
  config: Config;
  position: Position | null;
  liveDataMap: Map<string, LiveInstrument>;
  isLive: boolean;
  onAlertsCountChange?: (count: number) => void;
  onWatchlistCountChange?: (count: number) => void;
}

// ─── V5.2: Watchlist Hook ─────────────────────────────────────────────
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

// ─── V5.2: Price Alerts Hook ──────────────────────────────────────────
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
  SALTO_TACTICO: { label: '⚡ SALTO TÁCTICO', color: '#f87171', bg: 'rgba(248,113,113,0.12)' },
  PUNTO_CARAMELO: { label: '🍬 PUNTO CARAMELO', color: '#fbbf24', bg: 'rgba(251,191,36,0.12)' },
  ATRACTIVO: { label: 'ATRACTIVO', color: '#2eebc8', bg: 'rgba(46,235,200,0.08)' },
  NEUTRAL: { label: 'NEUTRAL', color: '#94a3b8', bg: 'rgba(148,163,184,0.06)' },
  EVITAR: { label: 'EVITAR', color: '#6b7280', bg: 'rgba(107,114,128,0.06)' },
};

// ─── V5.0: Action Score Config ────────────────────────────────────────
const ACTION_SCORE_CONFIG: Record<string, { label: string; color: string; bg: string; glow: string }> = {
  'GATILLAR YA': { label: '🔥 GATILLAR YA', color: '#f87171', bg: 'rgba(248,113,113,0.18)', glow: '0 0 12px rgba(248,113,113,0.4)' },
  'ATRACTIVO': { label: '✓ ATRACTIVO', color: '#2eebc8', bg: 'rgba(46,235,200,0.12)', glow: '0 0 8px rgba(46,235,200,0.2)' },
  'NEUTRAL': { label: 'NEUTRAL', color: '#94a3b8', bg: 'rgba(148,163,184,0.06)', glow: 'none' },
  'SIN SEÑAL': { label: 'SIN SEÑAL', color: '#6b7280', bg: 'rgba(107,114,128,0.04)', glow: 'none' },
};

// ─── V5.0: Volume Injection Label Config ──────────────────────────────
const VOL_INJECTION_CONFIG: Record<string, { color: string; bg: string; pulse: boolean }> = {
  EXPLOSIVO: { color: '#f87171', bg: 'rgba(248,113,113,0.18)', pulse: true },
  X5: { color: '#fb923c', bg: 'rgba(251,146,60,0.14)', pulse: true },
  X3: { color: '#fbbf24', bg: 'rgba(251,191,36,0.12)', pulse: false },
  X2: { color: '#a78bfa', bg: 'rgba(167,139,250,0.10)', pulse: false },
  NORMAL: { color: '#94a3b8', bg: 'rgba(148,163,184,0.06)', pulse: false },
};

// ─── Micro-Score Bar Colors ──────────────────────────────────────────
const MICRO_BAR_COLORS: Record<string, string> = {
  spreadNeto: '#2eebc8',   // teal
  deltaTIR: '#f472b6',     // pink
  presion: '#a78bfa',      // purple
  upside: '#fbbf24',       // gold
  velocidad: '#6b7280',    // gray
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

// ─── Micro-Score Bar Component ────────────────────────────────────────
function MicroScoreBar({ value, max = 10, color }: { value: number; max?: number; color: string }) {
  const scale = Math.min(value / max, 1);
  return (
    <div className="micro-score-bar-track" style={{ height: '2px' }}>
      <div
        className="micro-score-bar-fill"
        style={{
          backgroundColor: color,
          transform: `scaleX(${scale})`,
          transformOrigin: 'left center',
          willChange: 'transform',
        }}
      />
    </div>
  );
}

// ─── V5.2: Price Alert Popover Component ──────────────────────────────
function PriceAlertPopover({
  ticker,
  currentPrice,
  alert,
  onSetAlert,
  onRemoveAlert,
  onClearAll,
  alertCount,
}: {
  ticker: string;
  currentPrice: number;
  alert: PriceAlert | null;
  onSetAlert: (ticker: string, direction: '>' | '<', price: number) => void;
  onRemoveAlert: (ticker: string) => void;
  onClearAll: () => void;
  alertCount: number;
}) {
  const [inputPrice, setInputPrice] = useState(() => (alert ? alert.price.toFixed(4) : currentPrice > 0 ? currentPrice.toFixed(4) : ''));
  const [direction, setDirection] = useState<'>' | '<'>(() => alert?.direction ?? '>');

  const handleSet = () => {
    const p = parseFloat(inputPrice);
    if (!isNaN(p) && p > 0) {
      onSetAlert(ticker, direction, p);
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={`flex items-center justify-center w-5 h-5 rounded transition-all duration-150 shrink-0 ${
            alert
              ? 'text-[#fbbf24] bg-[#fbbf24]/10 hover:bg-[#fbbf24]/20'
              : 'text-app-text4 hover:text-app-text3 hover:bg-app-hover'
          }`}
          title={alert ? `Alerta: ${alert.direction} ${alert.price.toFixed(4)}` : 'Configurar alerta de precio'}
        >
          {alert ? <BellRing className="w-3 h-3" /> : <Bell className="w-3 h-3" />}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-64 p-3 rounded-xl border border-app-border/60 bg-app-bg/95 backdrop-blur-xl shadow-xl z-50"
        side="left"
        align="center"
      >
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold text-app-text uppercase tracking-wider">
              🔔 Alerta de Precio
            </span>
            <span className="font-mono text-[10px] font-bold text-app-accent-text">{ticker}</span>
          </div>
          <div className="text-[9px] text-app-text4">
            Alertar cuando precio
          </div>
          <div className="flex items-center gap-1.5">
            <select
              value={direction}
              onChange={e => setDirection(e.target.value as '>' | '<')}
              className="h-7 px-1.5 rounded-lg bg-app-subtle/60 border border-app-border/60 text-[10px] font-mono text-app-text focus:outline-none focus:ring-1 focus:ring-[#2eebc8]/40"
            >
              <option value=">">&gt; mayor que</option>
              <option value="<">&lt; menor que</option>
            </select>
            <Input
              type="number"
              step="0.0001"
              value={inputPrice}
              onChange={e => setInputPrice(e.target.value)}
              className="h-7 text-[10px] font-mono bg-app-subtle/60 border-app-border/60 focus:border-[#2eebc8]/30 focus:ring-[#2eebc8]/40"
              placeholder="Precio"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleSet}
              className="flex-1 h-7 rounded-lg bg-[#2eebc8]/15 border border-[#2eebc8]/30 text-[9px] font-bold text-[#2eebc8] hover:bg-[#2eebc8]/25 transition-all"
            >
              {alert ? 'Actualizar' : 'Activar'}
            </button>
            {alert && (
              <button
                onClick={() => onRemoveAlert(ticker)}
                className="h-7 px-2 rounded-lg bg-[#f87171]/10 border border-[#f87171]/30 text-[9px] font-bold text-[#f87171] hover:bg-[#f87171]/20 transition-all"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
          {alertCount > 0 && (
            <div className="flex items-center justify-between pt-1.5 border-t border-app-border/30">
              <span className="text-[8px] text-app-text4">
                🔔 {alertCount} alerta{alertCount !== 1 ? 's' : ''} activa{alertCount !== 1 ? 's' : ''}
              </span>
              <button
                onClick={onClearAll}
                className="text-[8px] text-[#f87171] hover:text-[#f87171]/80 font-medium transition-colors"
              >
                Limpiar todo
              </button>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ─── V5.2: Market Heatmap Mini-Visualization ──────────────────────────
function MarketHeatmapStrip({ scores, onBlockClick }: { scores: CockpitScore[]; onBlockClick: (ticker: string) => void }) {
  if (scores.length === 0) return null;

  const getBlockColor = (s: CockpitScore): string => {
    if (s.actionScore.label === 'GATILLAR YA') return '#2eebc8';
    if (s.actionScore.label === 'ATRACTIVO') return '#fbbf24';
    if (s.distanceToSR < 0.5 && s.distanceToSR < 99) return '#f87171';
    return '#6b7280';
  };

  return (
    <div className="cockpit-heatmap animate-fadeInUp">
      <div className="flex items-center gap-[2px] overflow-x-auto scrollbar-hide py-1">
        {scores.map(s => (
          <button
            key={`${s.ticker}-${s.type}`}
            className="cockpit-heatmap-block"
            style={{ backgroundColor: getBlockColor(s) }}
            title={`${s.ticker} — ${s.actionScore.label}${s.distanceToSR < 0.5 && s.distanceToSR < 99 ? ' · Cerca S/R' : ''}`}
            onClick={() => onBlockClick(s.ticker)}
          />
        ))}
      </div>
      <div className="flex items-center gap-3 mt-1 text-[8px] text-app-text4">
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-sm" style={{ backgroundColor: '#2eebc8' }} />
          🔥 Gatillar
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-sm" style={{ backgroundColor: '#fbbf24' }} />
          ✓ Atractivo
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-sm" style={{ backgroundColor: '#6b7280' }} />
          ● Neutral
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-sm" style={{ backgroundColor: '#f87171' }} />
          Cerca S/R
        </span>
      </div>
    </div>
  );
}

// ─── V5.2: Score Ring SVG Component ───────────────────────────────────
function ScoreRing({ score, color, size = 22 }: { score: number; color: string; size?: number }) {
  const radius = (size - 4) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = Math.min(Math.max(score, 0), 100) / 100;
  const dashOffset = circumference * (1 - filled);

  return (
    <svg width={size} height={size} className="score-ring shrink-0" style={{ '--ring-color': color } as React.CSSProperties}>
      {/* Background track */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--app-subtle)"
        strokeWidth={2}
      />
      {/* Filled arc */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={dashOffset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dashoffset 0.6s ease-out' }}
      />
    </svg>
  );
}

// ─── El Grito Alert Card ──────────────────────────────────────────────
function ElGritoCard({ scores }: { scores: CockpitScore[] }) {
  if (scores.length === 0) return null;

  const saltoScores = scores.filter(s => s.verdict === 'SALTO_TACTICO');
  const carameloScores = scores.filter(s => s.verdict === 'PUNTO_CARAMELO');
  const gatillarScores = scores.filter(s => s.actionScore.label === 'GATILLAR YA');
  const topScores = [...gatillarScores, ...saltoScores, ...carameloScores].slice(0, 6);

  if (topScores.length === 0) return null;

  return (
    <div
      className="el-grito-border p-0 animate-fadeInUp"
      style={{
        willChange: 'transform',
        contain: 'layout style',
        transform: 'translateZ(0)',
      }}
    >
      <div className="relative z-10 rounded-2xl p-4 sm:p-5" style={{ background: 'rgba(21,29,46,0.95)' }}>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-lg">🚨</span>
          <span className="text-sm font-semibold tracking-wide" style={{ color: '#f87171' }}>
            EL GRITO
          </span>
          <span className="text-[10px] text-app-text4 uppercase tracking-wider">— Capa 1 Alert</span>
          {gatillarScores.length > 0 && (
            <span className="ml-2 px-2 py-0.5 rounded-lg text-[9px] font-bold animate-pulse" style={{ color: '#f87171', background: 'rgba(248,113,113,0.2)', boxShadow: '0 0 12px rgba(248,113,113,0.3)' }}>
              🔥 {gatillarScores.length} GATILLAR
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-2">
          {topScores.map((s, i) => {
            const isGatillar = s.actionScore.label === 'GATILLAR YA';
            const vc = isGatillar ? { label: '🔥 GATILLAR YA', color: '#f87171', bg: 'rgba(248,113,113,0.15)' } : VERDICT_CONFIG[s.verdict];
            return (
              <div
                key={s.ticker}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border animate-fadeInUp ${getStaggerClass(i)}`}
                style={{
                  borderColor: `${vc.color}33`,
                  background: vc.bg,
                  boxShadow: isGatillar ? '0 0 16px rgba(248,113,113,0.25)' : 'none',
                }}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono font-bold text-xs text-app-text truncate">{s.ticker}</span>
                    <span className={`shrink-0 px-1.5 py-0.5 rounded text-[8px] font-bold ${s.type === 'LECAP' ? 'bg-app-accent-dim text-[#2eebc8]' : 'bg-[#f472b6]/10 text-[#f472b6]'}`}>
                      {s.type}
                    </span>
                  </div>
                  <div className="font-mono text-[10px] mt-0.5" style={{ color: vc.color }}>
                    {isGatillar ? '🔥 GATILLAR YA' : vc.label}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-mono font-bold text-lg" style={{ color: vc.color }}>
                    {s.actionScore.label !== 'SIN SEÑAL' ? s.actionScore.score : s.cockpitScore.toFixed(1)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-2 text-[10px] text-app-text4">
          {gatillarScores.length > 0 && (
            <span>🔥 Gatillar: <span className="font-mono font-bold" style={{ color: '#f87171' }}>{gatillarScores.length}</span></span>
          )}
          {saltoScores.length > 0 && (
            <> · ⚡ Salto: <span className="font-mono font-bold" style={{ color: '#f87171' }}>{saltoScores.length}</span></>
          )}
          {carameloScores.length > 0 && (
            <> · 🍬 Caramelo: <span className="font-mono font-bold" style={{ color: '#fbbf24' }}>{carameloScores.length}</span></>
          )}
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Main Component
// ════════════════════════════════════════════════════════════════════════
export default function CockpitTab({
  instruments,
  config,
  position,
  liveDataMap,
  isLive,
  onAlertsCountChange,
  onWatchlistCountChange,
}: CockpitTabProps) {
  // ─── Store ────────────────────────────────────────────────────────
  const cockpitScores = useRadarStore(s => s.cockpitScores);
  const setCockpitScores = useRadarStore(s => s.setCockpitScores);
  const cockpitScoresLoading = useRadarStore(s => s.cockpitScoresLoading);
  const setCockpitScoresLoading = useRadarStore(s => s.setCockpitScoresLoading);
  const marketTruth = useRadarStore(s => s.marketTruth);

  // ─── V5.2: Watchlist & Price Alerts ────────────────────────────────
  const { watchlist, toggleWatchlist, isWatched } = useWatchlist();
  const { alerts, setAlert, removeAlert, clearAllAlerts, getAlert, alertCount } = usePriceAlerts();
  const [watchlistFilterActive, setWatchlistFilterActive] = useState(false);
  const [triggeredAlerts, setTriggeredAlerts] = useState<Set<string>>(new Set());

  // Notify parent of alert count
  useEffect(() => {
    onAlertsCountChange?.(alertCount);
  }, [alertCount, onAlertsCountChange]);

  // Notify parent of watchlist count
  useEffect(() => {
    onWatchlistCountChange?.(watchlist.length);
  }, [watchlist.length, onWatchlistCountChange]);

  // ─── Local State ──────────────────────────────────────────────────
  const [horizon, setHorizon] = useState<number>(() => {
    if (typeof window === 'undefined') return 45;
    try {
      const saved = localStorage.getItem('arbradar_cockpit_horizon');
      if (saved) {
        const parsed = parseInt(saved, 10);
        if ([20, 30, 45, 60, 90, 9999].includes(parsed)) return parsed;
      }
    } catch { /* silent */ }
    return 45;
  });

  const handleHorizonChange = useCallback((value: number) => {
    setHorizon(value);
    try {
      localStorage.setItem('arbradar_cockpit_horizon', String(value));
    } catch { /* silent */ }
  }, []);

  // ─── All scores from API (unfiltered) ─────────────────────────────
  const [allScores, setAllScores] = useState<CockpitScore[]>([]);
  const [apiSummary, setApiSummary] = useState<{
    total: number;
    within_horizon: number;
    salto_tactico: number;
    punto_caramelo: number;
    atractivo: number;
    neutral: number;
    evitar: number;
  } | null>(null);
  const [engineVersion, setEngineVersion] = useState('');
  const [isStale, setIsStale] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasDataRef = useRef(false);

  // ─── V5.1: Search/Filter state ──────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');

  // ─── V5.2: Keyboard Shortcuts panel state ──────────────────────
  const [shortcutsExpanded, setShortcutsExpanded] = useState(false);

  // ─── V5.1: Sound Alert state ────────────────────────────────────
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try { return localStorage.getItem('arbradar_cockpit_sound') === 'true'; } catch { return false; }
  });
  const audioCtxRef = useRef<AudioContext | null>(null);
  const prevGatillarRef = useRef<Set<string>>(new Set());

  const toggleSound = useCallback(() => {
    setSoundEnabled(prev => {
      const next = !prev;
      try { localStorage.setItem('arbradar_cockpit_sound', String(next)); } catch { /* silent */ }
      return next;
    });
  }, []);

  // Play beep when new GATILLAR YA appears
  const playAlertBeep = useCallback(() => {
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioContext();
      }
      const ctx = audioCtxRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.2);
    } catch { /* silent */ }
  }, []);

  // ─── Fetch Cockpit Scores ─────────────────────────────────────────
  const fetchScores = useCallback(async () => {
    const hasData = hasDataRef.current;
    if (!hasData) setCockpitScoresLoading(true);
    try {
      const res = await fetch('/api/cockpit-score?horizon=365');
      if (!res.ok) {
        if (hasDataRef.current) setIsStale(true);
        return;
      }
      const data = await res.json();
      if (data.error) {
        if (hasDataRef.current) setIsStale(true);
        return;
      }

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

  useEffect(() => {
    fetchScores();
    intervalRef.current = setInterval(fetchScores, 50_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchScores]);

  // ─── Client-side horizon filtering ────────────────────────────────
  const filteredScores = useMemo(() => {
    if (horizon === 9999) return allScores;
    return allScores.filter(s => s.days <= horizon);
  }, [allScores, horizon]);

  // ─── V5.0: Sort by ACTION SCORE first, then cockpitScore ──────────
  const sortedScores = useMemo(() => {
    return [...filteredScores].sort((a, b) => {
      // Primary sort: Action Score (GATILLAR YA > ATRACTIVO > NEUTRAL > SIN SEÑAL)
      const actionOrder: Record<string, number> = { 'GATILLAR YA': 4, 'ATRACTIVO': 3, 'NEUTRAL': 2, 'SIN SEÑAL': 1 };
      const aAction = actionOrder[a.actionScore.label] ?? 0;
      const bAction = actionOrder[b.actionScore.label] ?? 0;
      if (aAction !== bAction) return bAction - aAction;
      // Secondary sort: actionScore.score descending
      if (a.actionScore.score !== b.actionScore.score) return b.actionScore.score - a.actionScore.score;
      // Tertiary: cockpitScore descending
      return b.cockpitScore - a.cockpitScore;
    });
  }, [filteredScores]);

  // ─── V5.1: Search filter + V5.2: Watchlist filter on sorted scores ──
  const displayedScores = useMemo(() => {
    let result = sortedScores;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(s => s.ticker.toLowerCase().includes(q));
    }
    if (watchlistFilterActive) {
      result = result.filter(s => isWatched(s.ticker));
    }
    return result;
  }, [sortedScores, searchQuery, watchlistFilterActive, isWatched]);

  // ─── Instrument lookup Map ─────────────────────────────────────────
  const instrumentMap = useMemo(() => {
    const map = new Map<string, Instrument>();
    for (const inst of instruments) {
      map.set(inst.ticker, inst);
    }
    return map;
  }, [instruments]);

  // ─── V5.1: Sound alert for new GATILLAR YA + V5.2: Price alert check ──
  useEffect(() => {
    if (!soundEnabled || sortedScores.length === 0) return;
    const currentGatillar = new Set(
      sortedScores.filter(s => s.actionScore.label === 'GATILLAR YA').map(s => s.ticker)
    );
    // Only beep on NEW transitions (not initial load)
    if (prevGatillarRef.current.size > 0) {
      for (const ticker of currentGatillar) {
        if (!prevGatillarRef.current.has(ticker)) {
          playAlertBeep();
          break; // One beep per cycle, even if multiple new
        }
      }
    }
    prevGatillarRef.current = currentGatillar;

    // V5.2: Check price alert thresholds
    const newTriggered = new Set<string>();
    for (const score of sortedScores) {
      const alert = alerts[score.ticker];
      if (!alert) continue;
      const liveData = liveDataMap.get(score.ticker);
      const instData = instrumentMap.get(score.ticker);
      const price = liveData?.last_price ?? instData?.price ?? 0;
      if (price <= 0) continue;
      const crossed = alert.direction === '>' ? price > alert.price : price < alert.price;
      if (crossed) {
        newTriggered.add(score.ticker);
        // New trigger? Flash + beep
        if (!triggeredAlerts.has(score.ticker)) {
          playAlertBeep();
        }
      }
    }
    setTriggeredAlerts(newTriggered);
  }, [sortedScores, soundEnabled, playAlertBeep, alerts, liveDataMap, instrumentMap, triggeredAlerts]);

  // ─── V5.1: CSV Export ─────────────────────────────────────────────
  const handleExportCSV = useCallback(() => {
    const rows = displayedScores;
    if (rows.length === 0) return;
    const header = 'Ticker,Type,Price,TEM,Volume,SR_Cercano,SR_Type,Distancia%,Inyeccion,Spread,CockpitScore,ActionScore,ActionLabel';
    const lines = rows.map(s => {
      const liveData = liveDataMap.get(s.ticker);
      const instData = instrumentMap.get(s.ticker);
      const price = liveData?.last_price ?? instData?.price ?? 0;
      const tem = instData?.tem ?? 0;
      const vol = s.iolVolume || s.volume || instData?.iolVolume || liveData?.iol_volume || instData?.data912Volume || liveData?.volume || 0;
      return [
        s.ticker, s.type, price.toFixed(4), tem.toFixed(2), vol,
        s.nearestSR?.level.toFixed(4) ?? '', s.nearestSR?.type ?? '',
        s.distanceToSR < 99 ? s.distanceToSR.toFixed(2) : '',
        s.volumeInjection.label, s.spreadNeto.toFixed(3),
        s.cockpitScore.toFixed(1), s.actionScore.score, s.actionScore.label
      ].join(',');
    });
    const csv = [header, ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `arb-radar-cockpit-${date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [displayedScores, liveDataMap, instrumentMap]);

  // ─── V5.2: Heatmap click → scroll to instrument ──────────────────
  const handleHeatmapClick = useCallback((ticker: string) => {
    const el = document.getElementById(`cockpit-row-${ticker}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('cockpit-row-flash');
      setTimeout(() => el.classList.remove('cockpit-row-flash'), 1500);
    }
  }, []);

  // ─── Sync filtered scores to store ────────────────────────────────
  useEffect(() => {
    setCockpitScores(sortedScores);
  }, [sortedScores, setCockpitScores]);

  // ─── Computed: El Grito instruments ────────────────────────────────
  const elGritoScores = useMemo(() => {
    return sortedScores.filter(
      s => s.verdict === 'SALTO_TACTICO' || s.verdict === 'PUNTO_CARAMELO' || s.actionScore.label === 'GATILLAR YA'
    );
  }, [sortedScores]);

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
      salto_tactico: filteredScores.filter(s => s.verdict === 'SALTO_TACTICO').length,
      punto_caramelo: filteredScores.filter(s => s.verdict === 'PUNTO_CARAMELO').length,
      atractivo: filteredScores.filter(s => s.verdict === 'ATRACTIVO').length,
      neutral: filteredScores.filter(s => s.verdict === 'NEUTRAL').length,
      evitar: filteredScores.filter(s => s.verdict === 'EVITAR').length,
      gatillar: filteredScores.filter(s => s.actionScore.label === 'GATILLAR YA').length,
      atractivoAction: filteredScores.filter(s => s.actionScore.label === 'ATRACTIVO').length,
    };
  }, [allScores, filteredScores]);

  // ─── MEP & RP from Market Truth ───────────────────────────────────
  const mepValue = marketTruth?.mep?.value ?? null;
  const mepConfidence = marketTruth?.mep?.confidence ?? null;
  const rpValue = marketTruth?.riesgo_pais?.value ?? null;
  const rpConfidence = marketTruth?.riesgo_pais?.confidence ?? null;

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
  // RENDER
  // ═══════════════════════════════════════════════════════════════════
  return (
    <div className="space-y-5">
      {/* ═══════════════════════════════════════════════════════════ */}
      {/* HEADER                                                       */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <div>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-lg font-light text-app-text mb-1">
              🎯 Cockpit Táctico — QUANT X
            </h2>
            <p className="text-sm text-app-text3">
              Quantitative Scanner · S/R + Volume + Pressure → Trigger Engine · Horizonte: {horizonLabel}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* V5.2: Watchlist counter badge */}
            {watchlist.length > 0 && (
              <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-lg bg-[#fbbf24]/10 border border-[#fbbf24]/20 text-[9px] text-[#fbbf24] font-medium">
                <Star className="w-2.5 h-2.5 fill-[#fbbf24]" />
                {watchlist.length}
              </span>
            )}
            {/* V5.2: Price alerts counter badge */}
            {alertCount > 0 && (
              <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-lg bg-[#f87171]/10 border border-[#f87171]/20 text-[9px] text-[#f87171] font-medium">
                <BellRing className="w-2.5 h-2.5" />
                {alertCount}
              </span>
            )}
            {/* V5.1: Sound alert toggle */}
            <button
              onClick={toggleSound}
              className={`flex items-center gap-1 px-2 py-1 rounded-lg border transition-all duration-150 ${
                soundEnabled
                  ? 'bg-[#f87171]/10 border-[#f87171]/30 text-[#f87171]'
                  : 'bg-app-subtle/40 border-app-border/40 text-app-text4 hover:text-app-text3'
              }`}
              title={soundEnabled ? 'Desactivar alerta sonora GATILLAR YA' : 'Activar alerta sonora GATILLAR YA'}
            >
              {soundEnabled ? <Bell className="w-3.5 h-3.5" /> : <BellOff className="w-3.5 h-3.5" />}
              <span className="text-[9px] font-medium hidden sm:inline">{soundEnabled ? 'ON' : 'OFF'}</span>
            </button>
            {isLive && (
              <span className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-app-accent-dim text-[10px] text-[#2eebc8]">
                <span className="live-dot" />
                LIVE
              </span>
            )}
            {engineVersion && (
              <span className="text-[9px] text-app-text4 font-mono">{engineVersion}</span>
            )}
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* STALE DATA WARNING                                            */}
      {/* ═══════════════════════════════════════════════════════════ */}
      {isStale && (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#fb923c]/8 border border-[#fb923c]/20 text-[10px] text-[#fb923c] animate-fadeInUp">
          <span className="text-xs">⏳</span>
          <span className="font-medium uppercase tracking-wider">Datos en caché</span>
          <span className="text-[9px] text-[#fb923c]/70">— Las APIs externas no responden, mostrando último valor disponible</span>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* V5.2: KEYBOARD SHORTCUTS INFO PANEL                           */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <div className="animate-fadeInUp">
        <button
          onClick={() => setShortcutsExpanded(prev => !prev)}
          className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-app-subtle/40 border border-app-border/40 text-[10px] font-medium text-app-text3 hover:text-app-text2 hover:bg-app-hover transition-all"
        >
          <Keyboard className="w-3 h-3" />
          ⌨ Shortcuts
          <span className="text-[8px] text-app-text4">{shortcutsExpanded ? '▲' : '▼'}</span>
        </button>
        {shortcutsExpanded && (
          <div className="mt-1.5 flex items-center gap-3 flex-wrap px-3 py-2 rounded-lg bg-app-subtle/20 border border-app-border/20 text-[9px] text-app-text3 animate-fadeInUp">
            <span className="flex items-center gap-1"><kbd>1-5</kbd> Tabs</span>
            <span className="flex items-center gap-1"><kbd>L</kbd> LIVE</span>
            <span className="flex items-center gap-1"><kbd>S</kbd> Sonido</span>
            <span className="flex items-center gap-1"><kbd>C</kbd> CSV</span>
            <span className="flex items-center gap-1"><kbd>/</kbd> Buscar</span>
            <span className="flex items-center gap-1"><kbd>Esc</kbd> Limpiar</span>
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* SUMMARY BAR — V5.0 Enhanced with Action Score counts          */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <div className="glass-card px-4 py-2.5 animate-fadeInUp overflow-x-auto scrollbar-hide">
        <div className="flex items-center gap-3 min-w-max text-xs">
          {/* Total instruments */}
          <div className="flex items-center gap-1.5">
            <span className="text-app-text4 uppercase tracking-wider text-[10px]">Instrumentos</span>
            <span className="font-mono font-bold text-app-text">{localSummary.within_horizon}</span>
            {localSummary.total !== localSummary.within_horizon && (
              <span className="text-app-text4 text-[9px]">/{localSummary.total}</span>
            )}
          </div>
          <div className="w-px h-3 bg-app-border/40" />

          {/* V5.0: GATILLAR YA count */}
          {localSummary.gatillar > 0 && (
            <>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] uppercase tracking-wider" style={{ color: '#f87171' }}>🔥 Gatillar</span>
                <span className="font-mono font-bold animate-pulse" style={{ color: '#f87171' }}>{localSummary.gatillar}</span>
              </div>
              <div className="w-px h-3 bg-app-border/40" />
            </>
          )}

          {/* V5.0: ATRACTIVO action count */}
          {localSummary.atractivoAction > 0 && (
            <>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] uppercase tracking-wider" style={{ color: '#2eebc8' }}>✓ Atractivo</span>
                <span className="font-mono font-bold" style={{ color: '#2eebc8' }}>{localSummary.atractivoAction}</span>
              </div>
              <div className="w-px h-3 bg-app-border/40" />
            </>
          )}

          {/* SALTO_TACTICO */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wider" style={{ color: '#f87171' }}>⚡ Salto</span>
            <span className="font-mono font-bold" style={{ color: '#f87171' }}>{localSummary.salto_tactico}</span>
          </div>
          <div className="w-px h-3 bg-app-border/40" />

          {/* PUNTO_CARAMELO */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wider" style={{ color: '#fbbf24' }}>🍬 Caramelo</span>
            <span className="font-mono font-bold" style={{ color: '#fbbf24' }}>{localSummary.punto_caramelo}</span>
          </div>
          <div className="w-px h-3 bg-app-border/40" />

          {/* MEP */}
          {mepValue !== null && (
            <>
              <div className="flex items-center gap-1.5">
                <span className="text-app-text4 uppercase tracking-wider text-[10px]">MEP</span>
                <span className="font-mono font-bold text-app-accent-text">
                  {fmtNum(mepValue, 2)}
                </span>
                {mepConfidence && (() => {
                  const cb = confidenceBadge(mepConfidence);
                  return (
                    <span className="px-1.5 py-0.5 rounded text-[8px] font-bold" style={{ color: cb.color, background: cb.bg }}>
                      {mepConfidence}
                    </span>
                  );
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
                <span className="font-mono font-bold text-app-text2">
                  {fmtNum(rpValue, 0)}
                </span>
                {rpConfidence && (() => {
                  const cb = confidenceBadge(rpConfidence);
                  return (
                    <span className="px-1.5 py-0.5 rounded text-[8px] font-bold" style={{ color: cb.color, background: cb.bg }}>
                      {rpConfidence}
                    </span>
                  );
                })()}
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
      {/* V5.2: MARKET HEATMAP MINI-VISUALIZATION                       */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <MarketHeatmapStrip scores={displayedScores} onBlockClick={handleHeatmapClick} />

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* HORIZON FILTER                                                */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <div className="flex items-center gap-2 animate-fadeInUp overflow-x-auto scrollbar-hide flex-wrap">
        <span className="text-app-text4 text-[10px] uppercase tracking-wider shrink-0">Horizonte</span>
        <div className="flex items-center gap-1">
          {HORIZON_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => handleHorizonChange(opt.value)}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-mono font-semibold transition-all duration-150 ${
                horizon === opt.value
                  ? 'bg-app-accent-dim text-[#2eebc8] border border-app-accent-border'
                  : 'bg-app-subtle/40 text-app-text3 border border-transparent hover:bg-app-hover hover:text-app-text2'
              }`}
              title={opt.desc}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <span className="text-app-text4 text-[9px] font-mono shrink-0">
          {displayedScores.length} instr.
        </span>
        <div className="w-px h-4 bg-app-border/40 shrink-0" />
        {/* V5.1: Search input */}
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-app-text4" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Ticker..."
            className="h-7 w-28 sm:w-36 pl-7 pr-2 rounded-lg bg-app-subtle/40 border border-app-border/40 text-[10px] font-mono text-app-text placeholder:text-app-text4 focus:outline-none focus:ring-1 focus:ring-[#2eebc8]/40 focus:border-[#2eebc8]/30 transition-all"
          />
        </div>
        {/* V5.1: CSV Export button */}
        <button
          onClick={handleExportCSV}
          disabled={displayedScores.length === 0}
          className="flex items-center gap-1 px-2 py-1 rounded-lg bg-app-subtle/40 border border-app-border/40 text-[10px] font-medium text-app-text3 hover:text-app-text2 hover:bg-app-hover transition-all disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
          title="Exportar datos a CSV"
        >
          <Download className="w-3 h-3" />
          <span className="hidden sm:inline">CSV</span>
        </button>
        <div className="w-px h-4 bg-app-border/40 shrink-0" />
        {/* V5.2: Watchlist filter toggle */}
        <button
          onClick={() => setWatchlistFilterActive(prev => !prev)}
          className={`flex items-center gap-1 px-2 py-1 rounded-lg border transition-all duration-150 shrink-0 ${
            watchlistFilterActive
              ? 'bg-[#fbbf24]/10 border-[#fbbf24]/30 text-[#fbbf24]'
              : 'bg-app-subtle/40 border-app-border/40 text-app-text4 hover:text-app-text3'
          }`}
          title={watchlistFilterActive ? 'Mostrar todos los instrumentos' : 'Filtrar solo watchlist'}
        >
          <Star className={`w-3 h-3 ${watchlistFilterActive ? 'fill-[#fbbf24]' : ''}`} />
          <span className="text-[9px] font-medium">Watchlist</span>
          {watchlist.length > 0 && (
            <span className={`text-[8px] font-mono font-bold ${watchlistFilterActive ? 'text-[#fbbf24]' : 'text-app-text4'}`}>
              {watchlist.length}
            </span>
          )}
        </button>
      </div>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* EL GRITO — Capa 1 Alert Card                                  */}
      {/* ═══════════════════════════════════════════════════════════ */}
      {elGritoScores.length > 0 && <ElGritoCard scores={displayedScores} />}

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* TABLA FUSIONADA — V5.1 with mobile responsive                 */}
      {/* ═══════════════════════════════════════════════════════════ */}
      {displayedScores.length === 0 ? (
        <div className="glass-card p-8 text-center animate-fadeInUp">
          <div className="text-app-text4 text-sm">
            {cockpitScoresLoading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="animate-spin inline-block w-4 h-4 border-2 border-[#2eebc8] border-t-transparent rounded-full" />
                Cargando señales de cockpit...
              </span>
            ) : searchQuery.trim() ? (
              <span>No se encontraron instrumentos que coincidan con "{searchQuery.trim()}"</span>
            ) : (
              'No hay datos de cockpit disponibles. Verifique la conexión al motor.'
            )}
          </div>
        </div>
      ) : (
        <div className={`glass-card animate-fadeInUp ${displayedScores.length > 10 ? 'cockpit-fade-bottom' : ''}`}>
          {/* Scrollable container with sticky header */}
          <div className="cockpit-scroll-container">
            {/* Desktop table header — sticky */}
            <div className="hidden md:grid cockpit-sticky-header cockpit-header-premium px-4 py-3.5 grid-cols-[36px_1fr_88px_64px_60px_80px_72px_72px_80px_56px_1fr] gap-2 items-center text-[9px] text-app-text4 uppercase tracking-wider font-medium">
              <span>#</span>
              <span>Instrumento</span>
              <span className="text-right">Precio</span>
              <span className="text-right">TEM</span>
              <span className="text-right">VOL</span>
              <span className="text-right">S/R Cercano</span>
              <span className="text-right">Dist %</span>
              <span className="text-right">Inyección</span>
              <span className="text-right">Spread</span>
              <span className="text-center">Score</span>
              <span className="text-right">ACCIÓN</span>
            </div>

            {/* Mobile header row */}
            <div className="md:hidden cockpit-sticky-header table-header-enhanced px-3 py-2 text-[8px] text-app-text4 uppercase tracking-wider font-medium flex items-center justify-between">
              <span>Instrumentos</span>
              <span>Señales</span>
            </div>

            {/* Rows container — mobile cards, desktop table rows */}
            <div className="md:divide-y md:divide-app-border/30 space-y-2 md:space-y-0 px-2 md:px-1 pb-4 md:pb-0">
              {displayedScores.map((score, idx) => {
                const vc = VERDICT_CONFIG[score.verdict];
                const rank = idx + 1;
                const liveData = liveDataMap.get(score.ticker);
                const instData = instrumentMap.get(score.ticker);
                const price = liveData?.last_price ?? instData?.price ?? 0;
                const tem = instData?.tem ?? 0;

                // V5.0: Action Score styling
                const asc = ACTION_SCORE_CONFIG[score.actionScore.label] ?? ACTION_SCORE_CONFIG['SIN SEÑAL'];
                const isGatillar = score.actionScore.label === 'GATILLAR YA';
                const isAtractivoAction = score.actionScore.label === 'ATRACTIVO';

                // V5.0: Volume Injection styling
                const vic = VOL_INJECTION_CONFIG[score.volumeInjection.label] ?? VOL_INJECTION_CONFIG['NORMAL'];

                // V5.0: Distance to S/R alert
                const isNearSR = score.distanceToSR < 0.5;
                const isVeryNearSR = score.distanceToSR < 0.3;

                // Ticker status dot
                const dotClass = isGatillar ? 'ticker-dot ticker-dot-gatillar' : isAtractivoAction ? 'ticker-dot ticker-dot-atractivo' : 'ticker-dot ticker-dot-neutral';

                // VOL display (shared between mobile and desktop)
                const volDisplay = (() => {
                  const vol = score.iolVolume || score.volume || instData?.iolVolume || liveData?.iol_volume || instData?.data912Volume || liveData?.volume;
                  if (vol && vol > 0) {
                    return vol >= 1_000_000
                      ? `${(vol / 1_000_000).toFixed(1)}M`
                      : vol >= 1_000
                        ? `${(vol / 1_000).toFixed(0)}K`
                        : vol.toString();
                  }
                  return '—';
                })();

                return (
                  <div
                    key={`${score.ticker}-${score.type}`}
                    id={`cockpit-row-${score.ticker}`}
                    className={`
                      md:table-row-highlight md:table-row-alt animate-row-in ${getStaggerClass(idx)} ${isGatillar ? 'gatillar-row' : ''} ${triggeredAlerts.has(score.ticker) ? 'price-alert-flash' : ''} cockpit-row-premium
                    `}
                    style={{
                      ...(idx >= 8 ? { contentVisibility: 'auto', containIntrinsicSize: '0 96px' } : {}),
                      '--accent-color': asc.color,
                      borderLeftColor: asc.color,
                    } as React.CSSProperties}
                  >
                    {/* ═══════════════════════════════════════════════════ */}
                    {/* MOBILE CARD LAYOUT (< md)                           */}
                    {/* ═══════════════════════════════════════════════════ */}
                    <div className={`md:hidden cockpit-mobile-card ${isGatillar ? 'gatillar-row' : ''}`}>
                      {/* Top row: Rank + Ticker + Type + Action Score badge */}
                      <div className="flex items-center gap-2 mb-2">
                        <div className={`rank-badge ${getRankClass(rank)} text-[9px]`} style={{ width: 22, height: 22, fontSize: 9 }}>
                          {rank}
                        </div>
                        <div className="flex items-center gap-1.5 min-w-0 flex-1">
                          <span className={dotClass} />
                          <span className="font-mono font-bold text-sm text-app-text truncate">
                            {score.ticker}
                          </span>
                          <span className={`shrink-0 px-1 py-0.5 rounded text-[7px] font-bold ${
                            score.type === 'LECAP'
                              ? 'bg-app-accent-dim text-[#2eebc8]'
                              : 'bg-[#f472b6]/10 text-[#f472b6]'
                          }`}>
                            {score.type}
                          </span>
                          <span className="text-[8px] text-app-text4 font-mono">{score.days}d</span>
                        </div>
                        <span
                          className={`action-score-badge px-1.5 py-0.5 rounded-lg text-[8px] font-bold whitespace-nowrap ${isGatillar ? 'animate-pulse action-score-gatillar' : ''} ${isAtractivoAction ? 'action-score-atractivo' : ''}`}
                          style={{
                            color: asc.color,
                            background: asc.bg,
                            boxShadow: isGatillar ? asc.glow : 'none',
                            border: isGatillar ? `1px solid ${asc.color}40` : '1px solid transparent',
                          }}
                        >
                          {isGatillar ? '🔥 ' : isAtractivoAction ? '✓ ' : ''}
                          {score.actionScore.label}
                        </span>
                        {/* V5.2: Score ring next to badge */}
                        {score.actionScore.label !== 'SIN SEÑAL' && (
                          <ScoreRing score={score.actionScore.score} color={asc.color} size={18} />
                        )}
                        {/* V5.2: Watchlist star + Price alert bell */}
                        <div className="flex items-center gap-0.5 shrink-0">
                          <button
                            onClick={() => toggleWatchlist(score.ticker)}
                            className={`flex items-center justify-center w-5 h-5 rounded transition-all duration-150 ${
                              isWatched(score.ticker)
                                ? 'text-[#fbbf24] hover:text-[#fbbf24]/70'
                                : 'text-app-text4 hover:text-app-text3'
                            }`}
                            title={isWatched(score.ticker) ? 'Quitar de watchlist' : 'Agregar a watchlist'}
                          >
                            <Star className={`w-3 h-3 ${isWatched(score.ticker) ? 'fill-[#fbbf24]' : ''}`} />
                          </button>
                          <PriceAlertPopover
                            ticker={score.ticker}
                            currentPrice={price}
                            alert={getAlert(score.ticker)}
                            onSetAlert={setAlert}
                            onRemoveAlert={removeAlert}
                            onClearAll={clearAllAlerts}
                            alertCount={alertCount}
                          />
                        </div>
                      </div>

                      {/* Middle row: Price + TEM + VOL */}
                      <div className="flex items-center gap-3 text-xs mb-1.5">
                        <div>
                          <span className="text-app-text4">Precio </span>
                          <span className="font-mono text-app-text2">{price > 0 ? fmtNum(price, 4) : '—'}</span>
                        </div>
                        <div>
                          <span className="text-app-text4">TEM </span>
                          <span className="font-mono text-app-text2">{fmtNum(tem, 2)}%</span>
                        </div>
                        <div>
                          <span className="text-app-text4">VOL </span>
                          <span className="font-mono text-app-text2">{volDisplay}</span>
                        </div>
                      </div>

                      {/* Bottom row: S/R + Distancia + Inyeccion + Spread */}
                      <div className="flex items-center gap-2 text-[10px] flex-wrap">
                        <div>
                          <span className="text-app-text4">S/R </span>
                          {score.nearestSR ? (
                            <span className={`font-mono ${score.nearestSR.type === 'S' ? 'text-[#2eebc8]' : 'text-[#f87171]'}`}>
                              {score.nearestSR.type}:{score.nearestSR.level.toFixed(4)}
                            </span>
                          ) : (
                            <span className="font-mono text-app-text4">—</span>
                          )}
                        </div>
                        <div>
                          <span className="text-app-text4">Dist </span>
                          <span className={`font-mono font-bold ${
                            isVeryNearSR ? 'text-[#f87171] animate-pulse' :
                            isNearSR ? 'text-[#fbbf24]' :
                            score.distanceToSR < 1.0 ? 'text-app-accent-text' :
                            'text-app-text3'
                          }`}>
                            {score.distanceToSR < 99 ? `${score.distanceToSR.toFixed(2)}%` : '—'}
                          </span>
                        </div>
                        <span
                          className={`inline-block px-1.5 py-0.5 rounded-md text-[8px] font-bold ${vic.pulse ? 'animate-pulse' : ''}`}
                          style={{ color: vic.color, background: vic.bg }}
                        >
                          {score.volumeInjection.label}
                        </span>
                        <div>
                          <span className="text-app-text4">Sp </span>
                          <span className={`font-mono font-semibold ${score.spreadNeto >= 0 ? 'text-[#2eebc8]' : 'text-[#f87171]'}`}>
                            {fmtPct(score.spreadNeto, 2)}
                          </span>
                        </div>
                      </div>

                      {/* Context row: micro-score bars + reason */}
                      <div className="mt-2 pt-1.5 cockpit-context-separator">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] text-app-text4">
                            ΔTIR{' '}
                            <span className={`font-mono ${score.deltaTIR !== null ? (score.deltaTIR > 0 ? 'text-[#2eebc8]' : score.deltaTIR < -0.02 ? 'text-[#f87171]' : 'text-app-text3') : 'text-app-text4'}`}>
                              {score.deltaTIR !== null ? fmtPct(score.deltaTIR, 2) : '—'}
                            </span>
                          </span>
                          <span className="text-[10px] text-app-text4">
                            Presión{' '}
                            <span className={`font-mono ${
                              score.presionPuntas !== null
                                ? score.presionPuntas > 1.3 ? 'text-[#2eebc8]'
                                  : score.presionPuntas < 0.7 ? 'text-[#f87171]'
                                  : 'text-app-text3'
                                : 'text-app-text4'
                            }`}>
                              {score.presionPuntas !== null ? score.presionPuntas.toFixed(2) : '—'}
                            </span>
                          </span>
                          <span className="text-[10px] text-app-text4">
                            Upside{' '}
                            <span className={`font-mono ${score.upsideCapital > 1 ? 'text-[#2eebc8]' : score.upsideCapital > 0.3 ? 'text-[#fbbf24]' : 'text-app-text3'}`}>
                              +{fmtNum(score.upsideCapital, 2)}%
                            </span>
                          </span>
                          {/* Micro-score bars */}
                          <div className="flex items-center gap-1.5 ml-1">
                            <div className="flex flex-col gap-[2px]">
                              <MicroScoreBar value={score.spreadNetoScore} color={MICRO_BAR_COLORS.spreadNeto} />
                              <MicroScoreBar value={score.deltaTIRScore} color={MICRO_BAR_COLORS.deltaTIR} />
                              <MicroScoreBar value={score.presionPuntasScore} color={MICRO_BAR_COLORS.presion} />
                              <MicroScoreBar value={score.upsideCapitalScore} color={MICRO_BAR_COLORS.upside} />
                              <MicroScoreBar value={score.velocidadScore} color={MICRO_BAR_COLORS.velocidad} />
                            </div>
                            <div className="flex flex-col gap-[2px] text-[6px] text-app-text4 leading-none">
                              <span>Sp</span>
                              <span>ΔT</span>
                              <span>Pr</span>
                              <span>Up</span>
                              <span>Ve</span>
                            </div>
                          </div>
                          {score.actionScore.label !== 'SIN SEÑAL' && score.actionScore.reason && (
                            <span className="text-[9px] truncate max-w-[160px]" style={{ color: asc.color + 'bb' }} title={score.actionScore.reason}>
                              {score.actionScore.reason}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* ═══════════════════════════════════════════════════ */}
                    {/* DESKTOP GRID LAYOUT (>= md) — QUANT X CARD         */}
                    {/* ═══════════════════════════════════════════════════ */}
                    <div className="hidden md:block cockpit-row-card">
                      {/* Main row: All 11 columns */}
                      <div className="grid grid-cols-[36px_1fr_88px_64px_60px_80px_72px_72px_80px_56px_1fr] gap-2 items-center py-3.5">
                        {/* Rank */}
                        <div className={`rank-badge ${getRankClass(rank)} text-[10px]`} style={{ width: 30, height: 30, fontSize: 10 }}>
                          {rank}
                        </div>

                        {/* Ticker + Type + Status dot + V5.2: Star + Bell */}
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className={dotClass} />
                          <span className="font-mono font-bold text-sm text-app-text truncate">
                            {score.ticker}
                          </span>
                          <span className={`shrink-0 px-1 py-0.5 rounded text-[7px] font-bold ${
                            score.type === 'LECAP'
                              ? 'bg-app-accent-dim text-[#2eebc8]'
                              : 'bg-[#f472b6]/10 text-[#f472b6]'
                          }`}>
                            {score.type}
                          </span>
                          <span className="text-[8px] text-app-text4 font-mono">{score.days}d</span>
                          {/* V5.2: Watchlist star */}
                          <button
                            onClick={() => toggleWatchlist(score.ticker)}
                            className={`flex items-center justify-center w-4 h-4 rounded transition-all duration-150 shrink-0 ${
                              isWatched(score.ticker)
                                ? 'text-[#fbbf24] hover:text-[#fbbf24]/70'
                                : 'text-app-text4 hover:text-app-text3'
                            }`}
                            title={isWatched(score.ticker) ? 'Quitar de watchlist' : 'Agregar a watchlist'}
                          >
                            <Star className={`w-2.5 h-2.5 ${isWatched(score.ticker) ? 'fill-[#fbbf24]' : ''}`} />
                          </button>
                          {/* V5.2: Price alert bell */}
                          <PriceAlertPopover
                            ticker={score.ticker}
                            currentPrice={price}
                            alert={getAlert(score.ticker)}
                            onSetAlert={setAlert}
                            onRemoveAlert={removeAlert}
                            onClearAll={clearAllAlerts}
                            alertCount={alertCount}
                          />
                        </div>

                        {/* Price */}
                        <div className="text-right font-mono text-base font-bold text-app-text neon-price">
                          {price > 0 ? fmtNum(price, 4) : '—'}
                        </div>

                        {/* TEM */}
                        <div className="text-right font-mono text-sm font-semibold text-app-text2">
                          {fmtNum(tem, 2)}%
                        </div>

                        {/* VOL */}
                        <div className="text-right font-mono text-sm font-semibold text-app-text2">
                          {volDisplay}
                        </div>

                        {/* V5.0: S/R MAS CERCANO */}
                        <div className="text-right font-mono text-sm">
                          {score.nearestSR ? (
                            <span className={score.nearestSR.type === 'S' ? 'text-[#2eebc8]' : 'text-[#f87171]'}>
                              <span className="text-[10px] font-bold opacity-70">{score.nearestSR.type}: </span>
                              {score.nearestSR.level.toFixed(4)}
                            </span>
                          ) : (
                            <span className="text-app-text4">—</span>
                          )}
                        </div>

                        {/* V5.0: DISTANCIA A S/R (%) */}
                        <div className={`text-right font-mono text-base font-bold relative rounded-md px-2 py-1 ${
                          isVeryNearSR ? 'bg-[#f87171]/15 border border-[#f87171]/30' :
                          isNearSR ? 'bg-[#fbbf24]/10 border border-[#fbbf24]/25' :
                          ''
                        }`}>
                          <span
                            className={`${
                              isVeryNearSR ? 'text-[#f87171]' :
                              isNearSR ? 'text-[#fbbf24]' :
                              score.distanceToSR < 1.0 ? 'text-app-accent-text font-bold' :
                              'text-app-text3'
                            }`}
                          >
                            {score.distanceToSR < 99 ? `${score.distanceToSR.toFixed(2)}%` : '—'}
                          </span>
                          {score.distanceToSR < 99 && (
                            <div className="w-full h-[3px] rounded-full bg-app-subtle/40 mt-1 overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all duration-700"
                                style={{
                                  width: `${Math.max(0, Math.min(100, (1 - score.distanceToSR / 5) * 100))}%`,
                                  backgroundColor: isVeryNearSR ? '#f87171' : isNearSR ? '#fbbf24' : score.distanceToSR < 1.0 ? '#2eebc8' : '#6b7280',
                                  boxShadow: isVeryNearSR ? '0 0 6px rgba(248,113,113,0.5)' : isNearSR ? '0 0 4px rgba(251,191,36,0.3)' : 'none',
                                }}
                              />
                            </div>
                          )}
                        </div>

                        {/* V5.0: INYECCION DE VOLUMEN */}
                        <div className="text-right">
                          <span
                            className={`inline-block px-2.5 py-1 rounded-lg text-[11px] font-bold ${vic.pulse ? 'animate-pulse' : ''}`}
                            style={{ color: vic.color, background: vic.bg, boxShadow: vic.pulse ? `0 0 8px ${vic.color}40` : 'none' }}
                          >
                            {score.volumeInjection.label}
                          </span>
                        </div>

                        {/* Spread Neto */}
                        <div className={`text-right font-mono text-sm font-semibold ${
                          score.spreadNeto >= 0 ? 'text-[#2eebc8]' : 'text-[#f87171]'
                        }`}>
                          {fmtPct(score.spreadNeto, 2)}
                        </div>

                        {/* CockpitScore — QUANT X: hero gauge */}
                        <div className="flex justify-center items-center">
                          <div className="relative">
                            <ScoreRing score={score.cockpitScore} color={vc.color} size={40} />
                            <span
                              className="absolute inset-0 flex items-center justify-center font-mono font-black text-sm"
                              style={{ color: vc.color }}
                            >
                              {score.cockpitScore.toFixed(1)}
                            </span>
                          </div>
                        </div>

                        {/* V5.0: SCORE — EL GATILLADOR */}
                        <div className="flex justify-end items-center gap-1.5">
                          <span
                            className={`action-score-badge px-3 py-2 rounded-xl text-[11px] font-bold whitespace-nowrap ${isGatillar ? 'action-score-gatillar shimmer-badge' : ''} ${isAtractivoAction ? 'action-score-atractivo' : ''}`}
                            style={{
                              color: asc.color,
                              background: asc.bg,
                              boxShadow: isGatillar ? asc.glow : 'none',
                              border: isGatillar ? `1px solid ${asc.color}40` : '1px solid transparent',
                            }}
                          >
                            {isGatillar ? '🔥 ' : isAtractivoAction ? '✓ ' : ''}
                            {score.actionScore.label}
                          </span>
                          {/* V5.2: Score ring next to badge */}
                          {score.actionScore.label !== 'SIN SEÑAL' && (
                            <ScoreRing score={score.actionScore.score} color={asc.color} size={32} />
                          )}
                        </div>
                      </div>

                      {/* Context row with separator */}
                      <div className="mt-1.5 pt-1.5 cockpit-context-separator grid grid-cols-[36px_1fr] gap-2 items-start">
                        <div /> {/* spacer for rank column */}

                        <div className="flex items-center gap-2 flex-wrap">
                          {/* ΔTIR */}
                          <span className="text-[10px] text-app-text4">
                            ΔTIR{' '}
                            <span className={`font-mono ${score.deltaTIR !== null ? (score.deltaTIR > 0 ? 'text-[#2eebc8]' : score.deltaTIR < -0.02 ? 'text-[#f87171]' : 'text-app-text3') : 'text-app-text4'}`}>
                              {score.deltaTIR !== null ? fmtPct(score.deltaTIR, 2) : '—'}
                            </span>
                          </span>

                          {/* Presion Punta */}
                          <span className="text-[10px] text-app-text4">
                            Presión{' '}
                            <span className={`font-mono ${
                              score.presionPuntas !== null
                                ? score.presionPuntas > 1.3 ? 'text-[#2eebc8]'
                                  : score.presionPuntas < 0.7 ? 'text-[#f87171]'
                                  : 'text-app-text3'
                                : 'text-app-text4'
                            }`}>
                              {score.presionPuntas !== null ? score.presionPuntas.toFixed(2) : '—'}
                            </span>
                          </span>

                          {/* Upside */}
                          <span className="text-[10px] text-app-text4">
                            Upside{' '}
                            <span className={`font-mono ${score.upsideCapital > 1 ? 'text-[#2eebc8]' : score.upsideCapital > 0.3 ? 'text-[#fbbf24]' : 'text-app-text3'}`}>
                              +{fmtNum(score.upsideCapital, 2)}%
                            </span>
                          </span>

                          {/* Micro-score bars */}
                          <div className="flex items-center gap-1.5 ml-1">
                            <div className="flex flex-col gap-[2px]">
                              <MicroScoreBar value={score.spreadNetoScore} color={MICRO_BAR_COLORS.spreadNeto} />
                              <MicroScoreBar value={score.deltaTIRScore} color={MICRO_BAR_COLORS.deltaTIR} />
                              <MicroScoreBar value={score.presionPuntasScore} color={MICRO_BAR_COLORS.presion} />
                              <MicroScoreBar value={score.upsideCapitalScore} color={MICRO_BAR_COLORS.upside} />
                              <MicroScoreBar value={score.velocidadScore} color={MICRO_BAR_COLORS.velocidad} />
                            </div>
                            <div className="flex flex-col gap-[2px] text-[6px] text-app-text4 leading-none">
                              <span>Sp</span>
                              <span>ΔT</span>
                              <span>Pr</span>
                              <span>Up</span>
                              <span>Ve</span>
                            </div>
                          </div>

                          {/* Action Score reason */}
                          {score.actionScore.label !== 'SIN SEÑAL' && score.actionScore.reason && (
                            <span className="text-[9px] truncate max-w-[200px] hidden sm:inline-block" style={{ color: asc.color + 'bb' }} title={score.actionScore.reason}>
                              {score.actionScore.reason}
                            </span>
                          )}

                          {/* Verdict reason */}
                          {score.verdictReason && score.actionScore.label === 'SIN SEÑAL' && (
                            <span className="text-[9px] text-app-text4 truncate max-w-[180px] hidden sm:inline-block" title={score.verdictReason}>
                              {score.verdictReason}
                            </span>
                          )}
                        </div>
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
      {/* V5.0: WEIGHT LEGEND + ACTION SCORE METHODOLOGY                */}
      {/* ═══════════════════════════════════════════════════════════ */}
      {displayedScores.length > 0 && (
        <div className="space-y-3 animate-fadeInUp">
          {/* Cockpit Score Weights */}
          <div className="flex items-center gap-4 flex-wrap text-[9px] text-app-text4">
            <span className="uppercase tracking-wider font-medium">Pesos Cockpit:</span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm" style={{ background: MICRO_BAR_COLORS.spreadNeto }} />
              Spread 25%
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm" style={{ background: MICRO_BAR_COLORS.deltaTIR }} />
              ΔTIR 25%
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm" style={{ background: MICRO_BAR_COLORS.presion }} />
              Presión 20%
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm" style={{ background: MICRO_BAR_COLORS.upside }} />
              Upside 20%
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm" style={{ background: MICRO_BAR_COLORS.velocidad }} />
              Vel. 10%
            </span>
          </div>

          {/* V5.0: Action Score Methodology */}
          <div className="glass-card px-4 py-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] font-semibold text-app-text3 uppercase tracking-wider">El Gatillador — Metodología</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-[9px]">
              <div className="bg-app-subtle/30 rounded-lg p-2.5">
                <div className="font-semibold text-[#fbbf24] mb-1">📍 Distancia S/R (0-40 pts)</div>
                <div className="text-app-text3">
                  &lt;0.3% → 38pts · &lt;0.5% → 32pts · &lt;1% → 20pts · &lt;2% → 10pts
                  <br />
                  <span className="text-[#f87171]">Alerta visual &lt;0.5%: &quot;a tiro de gatillo&quot;</span>
                </div>
              </div>
              <div className="bg-app-subtle/30 rounded-lg p-2.5">
                <div className="font-semibold text-[#a78bfa] mb-1">📊 Inyección Volumen (0-35 pts)</div>
                <div className="text-app-text3">
                  EXPLOSIVO → 35pts · X5 → 30pts · X3 → 25pts · X2 → 15pts · NORMAL → 5pts
                  <br />
                  <span className="text-app-text4">Volumen actual vs media · Multiplicadores de aceleración</span>
                </div>
              </div>
              <div className="bg-app-subtle/30 rounded-lg p-2.5">
                <div className="font-semibold text-[#2eebc8] mb-1">📈 Presión Book (0-25 pts)</div>
                <div className="text-app-text3">
                  Compradora en soporte → 25pts · Rompiendo resistencia → 22pts
                  <br />
                  <span className="text-app-text4">+5 carry positivo · +5 momentum alcista</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3 mt-2 flex-wrap text-[8px]">
              <span className="text-app-text4">UMBRALES:</span>
              <span className="px-2 py-0.5 rounded font-bold" style={{ color: '#f87171', background: 'rgba(248,113,113,0.18)', boxShadow: '0 0 8px rgba(248,113,113,0.3)' }}>
                🔥 GATILLAR YA ≥70 + S/R&lt;0.5% + Vol≥X3 + Presión
              </span>
              <span className="px-2 py-0.5 rounded font-bold" style={{ color: '#2eebc8', background: 'rgba(46,235,200,0.12)' }}>
                ✓ ATRACTIVO ≥50
              </span>
              <span className="px-2 py-0.5 rounded font-bold" style={{ color: '#94a3b8', background: 'rgba(148,163,184,0.06)' }}>
                NEUTRAL ≥25
              </span>
              <span className="px-2 py-0.5 rounded font-bold" style={{ color: '#6b7280', background: 'rgba(107,114,128,0.04)' }}>
                SIN SEÑAL &lt;25
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
