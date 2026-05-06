'use client';

// ════════════════════════════════════════════════════════════════════════
// V3.3-PRO TERMINAL — CockpitTab: UNIFIED COCKPIT
//
// Replaces 3 old tabs (Oportunidades, Arbitraje, Diagnóstico) with a
// single unified view. El Grito alerts, Tabla Fusionada double-height
// rows, Horizon Filter, and Summary Bar.
//
// BLINDAJE: La comisión del 0.15% NO se toca. price × 1.0015 = IMMUTABLE.
// ════════════════════════════════════════════════════════════════════════

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { Instrument, Config, Position, CockpitScore, LiveInstrument } from '@/lib/types';
import type { MarketTruthResponse } from '@/lib/market-truth-types';
import { useRadarStore } from '@/lib/store';

// ─── Props ────────────────────────────────────────────────────────────
interface CockpitTabProps {
  instruments: Instrument[];
  config: Config;
  position: Position | null;
  liveDataMap: Map<string, LiveInstrument>;
  isLive: boolean;
}

// ─── Verdict Config ───────────────────────────────────────────────────
const VERDICT_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  SALTO_TACTICO: { label: '⚡ SALTO TÁCTICO', color: '#f87171', bg: 'rgba(248,113,113,0.12)' },
  PUNTO_CARAMELO: { label: '🍬 PUNTO CARAMELO', color: '#fbbf24', bg: 'rgba(251,191,36,0.12)' },
  ATRACTIVO: { label: 'ATRACTIVO', color: '#2eebc8', bg: 'rgba(46,235,200,0.08)' },
  NEUTRAL: { label: 'NEUTRAL', color: '#94a3b8', bg: 'rgba(148,163,184,0.06)' },
  EVITAR: { label: 'EVITAR', color: '#6b7280', bg: 'rgba(107,114,128,0.06)' },
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
// Uses transform: scaleX() instead of width for GPU-accelerated animations
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

// ─── El Grito Alert Card ──────────────────────────────────────────────
function ElGritoCard({ scores }: { scores: CockpitScore[] }) {
  if (scores.length === 0) return null;

  const saltoScores = scores.filter(s => s.verdict === 'SALTO_TACTICO');
  const carameloScores = scores.filter(s => s.verdict === 'PUNTO_CARAMELO');
  const topScores = [...saltoScores, ...carameloScores].slice(0, 5);

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
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-2">
          {topScores.map((s, i) => {
            const vc = VERDICT_CONFIG[s.verdict];
            return (
              <div
                key={s.ticker}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border animate-fadeInUp ${getStaggerClass(i)}`}
                style={{
                  borderColor: `${vc.color}33`,
                  background: vc.bg,
                }}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono font-bold text-xs text-app-text truncate">{s.ticker}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold ${s.type === 'LECAP' ? 'bg-app-accent-dim text-[#2eebc8]' : 'bg-[#f472b6]/10 text-[#f472b6]'}`}>
                      {s.type}
                    </span>
                  </div>
                  <div className="font-mono text-[10px] mt-0.5" style={{ color: vc.color }}>
                    {vc.label}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-mono font-bold text-lg" style={{ color: vc.color }}>
                    {s.cockpitScore.toFixed(1)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {saltoScores.length > 0 && (
          <div className="mt-2 text-[10px] text-app-text4">
            ⚡ Salto Táctico: <span className="font-mono font-bold" style={{ color: '#f87171' }}>{saltoScores.length}</span>
            {carameloScores.length > 0 && (
              <> · 🍬 Punto Caramelo: <span className="font-mono font-bold" style={{ color: '#fbbf24' }}>{carameloScores.length}</span></>
            )}
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
  instruments,
  config,
  position,
  liveDataMap,
  isLive,
}: CockpitTabProps) {
  // ─── Store ────────────────────────────────────────────────────────
  const cockpitScores = useRadarStore(s => s.cockpitScores);
  const setCockpitScores = useRadarStore(s => s.setCockpitScores);
  const cockpitScoresLoading = useRadarStore(s => s.cockpitScoresLoading);
  const setCockpitScoresLoading = useRadarStore(s => s.setCockpitScoresLoading);
  const marketTruth = useRadarStore(s => s.marketTruth);

  // ─── Local State ──────────────────────────────────────────────────
  // Initialize from localStorage or default to 45
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

  // Persist horizon to localStorage on change
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

  // Ref to track whether we have data (avoids dependency on allScores.length)
  const hasDataRef = useRef(false);

  // ─── Fetch Cockpit Scores (once, ALL instruments, no horizon param) ──
  // Horizon filtering is done CLIENT-SIDE for instant switching
  // PRIORITY HYDRATION: Only set loading=true on FIRST fetch (no data yet)
  const fetchScores = useCallback(async () => {
    // SWR: Only show loading spinner if we have NO data at all
    // If we have stale data, silently revalidate in background
    const hasData = hasDataRef.current;
    if (!hasData) setCockpitScoresLoading(true);
    try {
      const res = await fetch('/api/cockpit-score?horizon=365');
      if (!res.ok) {
        // API error — mark as stale if we have existing data
        if (hasDataRef.current) setIsStale(true);
        return;
      }
      const data = await res.json();
      if (data.error) {
        if (hasDataRef.current) setIsStale(true);
        return;
      }

      // Store ALL scores (unfiltered) — horizon filter is client-side
      const raw: CockpitScore[] = data.all_scores ?? data.scores ?? [];
      setAllScores(raw);
      hasDataRef.current = raw.length > 0;
      setApiSummary(data.summary ?? null);
      setEngineVersion(data.engine_version ?? '');
      setIsStale(data.stale === true);
    } catch {
      // Network error — mark as stale if we have existing data
      if (hasDataRef.current) setIsStale(true);
    } finally {
      if (!hasData) setCockpitScoresLoading(false);
    }
  }, [setCockpitScoresLoading]);

  // PRIORITY HYDRATION: Fire immediately on mount, no setTimeout delay
  useEffect(() => {
    fetchScores(); // IMMEDIATE — cache must be warm when user enters terminal
    intervalRef.current = setInterval(fetchScores, 50_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchScores]); // Now stable — fetchScores only depends on setCockpitScoresLoading

  // ─── Client-side horizon filtering ────────────────────────────────
  // INSTANT — no server roundtrip when changing horizon
  const filteredScores = useMemo(() => {
    if (horizon === 9999) return allScores; // "ALL" = no filter
    return allScores.filter(s => s.days <= horizon);
  }, [allScores, horizon]);

  // ─── Computed: sorted scores ───────────────────────────────────────
  const sortedScores = useMemo(() => {
    return [...filteredScores].sort((a, b) => b.cockpitScore - a.cockpitScore);
  }, [filteredScores]);

  // ─── Sync filtered scores to store (for other tabs) ──────────────
  useEffect(() => {
    setCockpitScores(sortedScores);
  }, [sortedScores, setCockpitScores]);

  // ─── Computed: El Grito instruments ────────────────────────────────
  const elGritoScores = useMemo(() => {
    return sortedScores.filter(
      s => s.verdict === 'SALTO_TACTICO' || s.verdict === 'PUNTO_CARAMELO'
    );
  }, [sortedScores]);

  // ─── Computed: horizon label ───────────────────────────────────────
  const horizonLabel = useMemo(() => {
    const opt = HORIZON_OPTIONS.find(h => h.value === horizon);
    return opt ? opt.desc : `${horizon}d`;
  }, [horizon]);

  // ─── Computed: summary counts (client-side, always fresh) ────────
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
    };
  }, [allScores, filteredScores]);

  // ─── Instrument lookup Map (O(1) instead of O(N) find) ───────────
  const instrumentMap = useMemo(() => {
    const map = new Map<string, Instrument>();
    for (const inst of instruments) {
      map.set(inst.ticker, inst);
    }
    return map;
  }, [instruments]);

  // ─── MEP & RP from Market Truth ───────────────────────────────────
  const mepValue = marketTruth?.mep?.value ?? null;
  const mepConfidence = marketTruth?.mep?.confidence ?? null;
  const rpValue = marketTruth?.riesgo_pais?.value ?? null;
  const rpConfidence = marketTruth?.riesgo_pais?.confidence ?? null;

  // ─── Confidence badge color ────────────────────────────────────────
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
              🎯 Cockpit Táctico — V3.4 PRO TERMINAL
            </h2>
            <p className="text-sm text-app-text3">
              Señal de scalping compuesta · 5 factores ponderados · Horizonte: {horizonLabel}
            </p>
          </div>
          <div className="flex items-center gap-2">
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
      {/* STALE DATA WARNING — shown when API fallback is active       */}
      {/* ═══════════════════════════════════════════════════════════ */}
      {isStale && (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#fb923c]/8 border border-[#fb923c]/20 text-[10px] text-[#fb923c] animate-fadeInUp">
          <span className="text-xs">⏳</span>
          <span className="font-medium uppercase tracking-wider">Datos en caché</span>
          <span className="text-[9px] text-[#fb923c]/70">— Las APIs externas no responden, mostrando último valor disponible</span>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* SUMMARY BAR                                                   */}
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

          {/* ATRACTIVO */}
          <div className="flex items-center gap-1.5">
            <span className="text-app-text4 uppercase tracking-wider text-[10px]">Atractivo</span>
            <span className="font-mono font-bold text-[#2eebc8]">{localSummary.atractivo}</span>
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

          {/* Engine status — SWR stale indicator */}
          <div className="flex items-center gap-1.5">
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${cockpitScoresLoading ? 'bg-[#fbbf24] animate-pulse' : isStale ? 'bg-[#fb923c]' : cockpitScores.length > 0 ? 'bg-[#2eebc8]' : 'bg-app-text4'}`} />
            <span className={`text-[10px] uppercase tracking-wider ${isStale ? 'text-[#fb923c]' : 'text-app-text4'}`}>
              {cockpitScoresLoading ? 'Sync' : isStale ? 'STALE' : cockpitScores.length > 0 ? 'OK' : 'Idle'}
            </span>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* HORIZON FILTER                                                */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <div className="flex items-center gap-2 animate-fadeInUp">
        <span className="text-app-text4 text-[10px] uppercase tracking-wider">Horizonte</span>
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
        <span className="text-app-text4 text-[9px] font-mono">
          {localSummary.within_horizon} instr.
        </span>
      </div>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* EL GRITO — Capa 1 Alert Card                                  */}
      {/* ═══════════════════════════════════════════════════════════ */}
      {elGritoScores.length > 0 && <ElGritoCard scores={sortedScores} />}

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* TABLA FUSIONADA — Double-Height Rows                          */}
      {/* ═══════════════════════════════════════════════════════════ */}
      {sortedScores.length === 0 ? (
        <div className="glass-card p-8 text-center animate-fadeInUp">
          <div className="text-app-text4 text-sm">
            {cockpitScoresLoading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="animate-spin inline-block w-4 h-4 border-2 border-[#2eebc8] border-t-transparent rounded-full" />
                Cargando señales de cockpit...
              </span>
            ) : (
              'No hay datos de cockpit disponibles. Verifique la conexión al motor.'
            )}
          </div>
        </div>
      ) : (
        <div className="glass-card animate-fadeInUp">
          {/* Table Header */}
          <div className="table-header-enhanced px-4 py-2.5 grid grid-cols-[32px_1fr_80px_70px_60px_80px_70px_1fr] gap-2 items-center text-[9px] text-app-text4 uppercase tracking-wider font-medium">
            <span>#</span>
            <span>Instrumento</span>
            <span className="text-right">Precio</span>
            <span className="text-right">TEM</span>
            <span className="text-right">VOL</span>
            <span className="text-right">Spread Neto</span>
            <span className="text-right">Score</span>
            <span className="text-right">Veredicto</span>
          </div>

          {/* Rows */}
          <div className="divide-y divide-app-border/30">
            {sortedScores.map((score, idx) => {
              const vc = VERDICT_CONFIG[score.verdict];
              const rank = idx + 1;
              const liveData = liveDataMap.get(score.ticker);
              const instData = instrumentMap.get(score.ticker);
              const price = liveData?.last_price ?? instData?.price ?? 0;
              const tem = instData?.tem ?? 0;

              return (
                <div
                  key={`${score.ticker}-${score.type}`}
                  className={`table-row-highlight px-4 py-2 animate-row-in ${getStaggerClass(idx)}`}
                  style={idx >= 8 ? { contentVisibility: 'auto', containIntrinsicSize: '0 70px' } : undefined}
                >
                  {/* ── ROW 1: Main Data ── */}
                  <div className="grid grid-cols-[32px_1fr_80px_70px_60px_80px_70px_1fr] gap-2 items-center">
                    {/* Rank */}
                    <div className={`rank-badge ${getRankClass(rank)} text-[10px]`}>
                      {rank}
                    </div>

                    {/* Ticker + Type */}
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono font-bold text-xs text-app-text truncate">
                        {score.ticker}
                      </span>
                      <span className={`shrink-0 px-1.5 py-0.5 rounded text-[8px] font-bold ${
                        score.type === 'LECAP'
                          ? 'bg-app-accent-dim text-[#2eebc8]'
                          : 'bg-[#f472b6]/10 text-[#f472b6]'
                      }`}>
                        {score.type}
                      </span>
                    </div>

                    {/* Price */}
                    <div className="text-right font-mono text-xs text-app-text2">
                      {price > 0 ? fmtNum(price, 4) : '—'}
                    </div>

                    {/* TEM */}
                    <div className="text-right font-mono text-xs text-app-text2">
                      {fmtNum(tem, 2)}%
                    </div>

                    {/* VOL — V3.4: IOL volume (primary) / data912 volume (fallback) from /api/letras enrichment */}
                    <div className="text-right font-mono text-xs text-app-text2">
                      {(() => {
                        // Priority: IOL volume (real-time order book) > data912 volume (notional ARS)
                        const vol = instData?.iolVolume ?? liveData?.iol_volume ?? instData?.data912Volume ?? liveData?.volume;
                        if (vol != null && vol > 0) {
                          return vol >= 1_000_000
                            ? `${(vol / 1_000_000).toFixed(1)}M`
                            : vol >= 1_000
                              ? `${(vol / 1_000).toFixed(0)}K`
                              : vol.toString();
                        }
                        return '—';
                      })()}
                    </div>

                    {/* Spread Neto */}
                    <div className={`text-right font-mono text-xs font-semibold ${
                      score.spreadNeto >= 0 ? 'text-[#2eebc8]' : 'text-[#f87171]'
                    }`}>
                      {fmtPct(score.spreadNeto, 3)}
                    </div>

                    {/* CockpitScore */}
                    <div className="text-right">
                      <span
                        className="font-mono font-bold text-base"
                        style={{ color: vc.color }}
                      >
                        {score.cockpitScore.toFixed(1)}
                      </span>
                    </div>

                    {/* Verdict badge */}
                    <div className="flex justify-end">
                      <span
                        className="px-2 py-0.5 rounded-lg text-[9px] font-bold whitespace-nowrap"
                        style={{ color: vc.color, background: vc.bg }}
                      >
                        {vc.label}
                      </span>
                    </div>
                  </div>

                  {/* ── ROW 2: Context Row ── */}
                  <div className="mt-1.5 grid grid-cols-[32px_1fr] gap-2 items-start">
                    <div /> {/* spacer for rank column */}

                    <div className="flex items-center gap-3 flex-wrap">
                      {/* Days to expiry */}
                      <span className="text-[9px] text-app-text4">
                        <span className="text-app-text3 font-mono">{score.days}</span>d
                      </span>

                      {/* ΔTIR */}
                      <span className="text-[9px] text-app-text4">
                        ΔTIR{' '}
                        <span className={`font-mono ${score.deltaTIR !== null ? (score.deltaTIR > 0 ? 'text-[#2eebc8]' : score.deltaTIR < -0.02 ? 'text-[#f87171]' : 'text-app-text3') : 'text-app-text4'}`}>
                          {score.deltaTIR !== null ? fmtPct(score.deltaTIR, 3) : '—'}
                        </span>
                      </span>

                      {/* Presión Punta */}
                      <span className="text-[9px] text-app-text4">
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

                      {/* Upside Capital */}
                      <span className="text-[9px] text-app-text4">
                        Upside{' '}
                        <span className={`font-mono ${score.upsideCapital > 1 ? 'text-[#2eebc8]' : score.upsideCapital > 0.3 ? 'text-[#fbbf24]' : 'text-app-text3'}`}>
                          +{fmtNum(score.upsideCapital, 2)}%
                        </span>
                      </span>

                      {/* Micro-score bars */}
                      <div className="flex items-center gap-1.5 ml-1">
                        <div className="flex flex-col gap-[3px]">
                          <MicroScoreBar value={score.spreadNetoScore} color={MICRO_BAR_COLORS.spreadNeto} />
                          <MicroScoreBar value={score.deltaTIRScore} color={MICRO_BAR_COLORS.deltaTIR} />
                          <MicroScoreBar value={score.presionPuntasScore} color={MICRO_BAR_COLORS.presion} />
                          <MicroScoreBar value={score.upsideCapitalScore} color={MICRO_BAR_COLORS.upside} />
                          <MicroScoreBar value={score.velocidadScore} color={MICRO_BAR_COLORS.velocidad} />
                        </div>
                        <div className="flex flex-col gap-[3px] text-[7px] text-app-text4 leading-none">
                          <span>Sp</span>
                          <span>ΔT</span>
                          <span>Pr</span>
                          <span>Up</span>
                          <span>Ve</span>
                        </div>
                      </div>

                      {/* Verdict reason (truncated) */}
                      {score.verdictReason && (
                        <span className="text-[8px] text-app-text4 truncate max-w-[180px] hidden sm:inline-block" title={score.verdictReason}>
                          {score.verdictReason}
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

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* WEIGHT LEGEND                                                 */}
      {/* ═══════════════════════════════════════════════════════════ */}
      {sortedScores.length > 0 && (
        <div className="flex items-center gap-4 flex-wrap text-[9px] text-app-text4 animate-fadeInUp">
          <span className="uppercase tracking-wider font-medium">Pesos:</span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm" style={{ background: MICRO_BAR_COLORS.spreadNeto }} />
            Spread Neto 25%
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
            Velocidad 10%
          </span>
        </div>
      )}
    </div>
  );
}
