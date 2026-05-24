'use client';

// ════════════════════════════════════════════════════════════════════════
// V5.0 SCANNER — CockpitTab: PRICE ACTION SCANNER
//
// Unified cockpit with 4 new Price Action columns:
//   1. S/R Más Cercano — nearest support/resistance level
//   2. Distancia a S/R (%) — % distance with <0.5% visual alert
//   3. Inyección de Volumen — volume acceleration (X2, X3, X5, EXPLOSIVO)
//   4. SCORE — El Gatillador (GATILLAR YA / ATRACTIVO / NEUTRAL / SIN SEÑAL)
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
}: CockpitTabProps) {
  // ─── Store ────────────────────────────────────────────────────────
  const cockpitScores = useRadarStore(s => s.cockpitScores);
  const setCockpitScores = useRadarStore(s => s.setCockpitScores);
  const cockpitScoresLoading = useRadarStore(s => s.cockpitScoresLoading);
  const setCockpitScoresLoading = useRadarStore(s => s.setCockpitScoresLoading);
  const marketTruth = useRadarStore(s => s.marketTruth);

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

  // ─── Instrument lookup Map ─────────────────────────────────────────
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
              🎯 Cockpit Táctico — V5.0 SCANNER
            </h2>
            <p className="text-sm text-app-text3">
              Price Action Scanner · S/R + Volumen + Presión → Gatillador Cuantitativo · Horizonte: {horizonLabel}
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
      {/* TABLA FUSIONADA — V5.0 with 4 new Price Action columns        */}
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
          {/* V5.0: Table Header — 12 columns */}
          <div className="table-header-enhanced px-3 py-2.5 grid grid-cols-[28px_1fr_64px_52px_52px_64px_52px_52px_64px_52px_1fr] gap-1.5 items-center text-[8px] text-app-text4 uppercase tracking-wider font-medium">
            <span>#</span>
            <span>Instrumento</span>
            <span className="text-right">Precio</span>
            <span className="text-right">TEM</span>
            <span className="text-right">VOL</span>
            <span className="text-right">S/R Cercano</span>
            <span className="text-right">Dist %</span>
            <span className="text-right">Inyección</span>
            <span className="text-right">Spread</span>
            <span className="text-right">Score</span>
            <span className="text-right">ACCIÓN</span>
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

              // V5.0: Action Score styling
              const asc = ACTION_SCORE_CONFIG[score.actionScore.label] ?? ACTION_SCORE_CONFIG['SIN SEÑAL'];
              const isGatillar = score.actionScore.label === 'GATILLAR YA';

              // V5.0: Volume Injection styling
              const vic = VOL_INJECTION_CONFIG[score.volumeInjection.label] ?? VOL_INJECTION_CONFIG['NORMAL'];

              // V5.0: Distance to S/R alert
              const isNearSR = score.distanceToSR < 0.5;
              const isVeryNearSR = score.distanceToSR < 0.3;

              return (
                <div
                  key={`${score.ticker}-${score.type}`}
                  className={`table-row-highlight table-row-alt px-3 py-1.5 animate-row-in ${getStaggerClass(idx)} ${isGatillar ? 'gatillar-row' : ''}`}
                  style={idx >= 8 ? { contentVisibility: 'auto', containIntrinsicSize: '0 56px' } : undefined}
                >
                  {/* ── SINGLE ROW: All 12 columns ── */}
                  <div className="grid grid-cols-[28px_1fr_64px_52px_52px_64px_52px_52px_64px_52px_1fr] gap-1.5 items-center">
                    {/* Rank */}
                    <div className={`rank-badge ${getRankClass(rank)} text-[9px]`} style={{ width: 24, height: 24, fontSize: 9 }}>
                      {rank}
                    </div>

                    {/* Ticker + Type */}
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="font-mono font-bold text-[11px] text-app-text truncate">
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

                    {/* Price */}
                    <div className="text-right font-mono text-[11px] text-app-text2">
                      {price > 0 ? fmtNum(price, 4) : '—'}
                    </div>

                    {/* TEM */}
                    <div className="text-right font-mono text-[11px] text-app-text2">
                      {fmtNum(tem, 2)}%
                    </div>

                    {/* VOL */}
                    <div className="text-right font-mono text-[11px] text-app-text2">
                      {(() => {
                        const vol = score.iolVolume || score.volume || instData?.iolVolume || liveData?.iol_volume || instData?.data912Volume || liveData?.volume;
                        if (vol && vol > 0) {
                          return vol >= 1_000_000
                            ? `${(vol / 1_000_000).toFixed(1)}M`
                            : vol >= 1_000
                              ? `${(vol / 1_000).toFixed(0)}K`
                              : vol.toString();
                        }
                        return '—';
                      })()}
                    </div>

                    {/* ═══ V5.0: S/R MÁS CERCANO ═══ */}
                    <div className="text-right font-mono text-[11px]">
                      {score.nearestSR ? (
                        <span className={score.nearestSR.type === 'S' ? 'text-[#2eebc8]' : 'text-[#f87171]'}>
                          <span className="text-[8px] font-bold opacity-70">{score.nearestSR.type}: </span>
                          {score.nearestSR.level.toFixed(4)}
                        </span>
                      ) : (
                        <span className="text-app-text4">—</span>
                      )}
                    </div>

                    {/* ═══ V5.0: DISTANCIA A S/R (%) ═══ */}
                    <div className="text-right font-mono text-[11px] relative">
                      <span
                        className={`font-bold ${
                          isVeryNearSR ? 'text-[#f87171] animate-pulse' :
                          isNearSR ? 'text-[#fbbf24] font-bold' :
                          score.distanceToSR < 1.0 ? 'text-app-accent-text' :
                          'text-app-text3'
                        }`}
                      >
                        {score.distanceToSR < 99 ? `${score.distanceToSR.toFixed(2)}%` : '—'}
                      </span>
                      {/* Visual alert indicator for < 0.5% */}
                      {isNearSR && score.distanceToSR < 99 && (
                        <span
                          className="absolute -left-1 top-1/2 -translate-y-1/2 w-1 h-3 rounded-full"
                          style={{
                            backgroundColor: isVeryNearSR ? '#f87171' : '#fbbf24',
                            boxShadow: isVeryNearSR ? '0 0 6px rgba(248,113,113,0.6)' : '0 0 4px rgba(251,191,36,0.4)',
                          }}
                        />
                      )}
                    </div>

                    {/* ═══ V5.0: INYECCIÓN DE VOLUMEN ═══ */}
                    <div className="text-right">
                      <span
                        className={`inline-block px-1.5 py-0.5 rounded-md text-[9px] font-bold ${vic.pulse ? 'animate-pulse' : ''}`}
                        style={{ color: vic.color, background: vic.bg }}
                      >
                        {score.volumeInjection.label}
                      </span>
                    </div>

                    {/* Spread Neto */}
                    <div className={`text-right font-mono text-[11px] font-semibold ${
                      score.spreadNeto >= 0 ? 'text-[#2eebc8]' : 'text-[#f87171]'
                    }`}>
                      {fmtPct(score.spreadNeto, 3)}
                    </div>

                    {/* CockpitScore */}
                    <div className="text-right">
                      <span
                        className="font-mono font-bold text-sm"
                        style={{ color: vc.color }}
                      >
                        {score.cockpitScore.toFixed(1)}
                      </span>
                    </div>

                    {/* ═══ V5.0: SCORE — EL GATILLADOR ═══ */}
                    <div className="flex justify-end">
                      <span
                        className={`px-2 py-1 rounded-lg text-[9px] font-bold whitespace-nowrap ${isGatillar ? 'animate-pulse' : ''}`}
                        style={{
                          color: asc.color,
                          background: asc.bg,
                          boxShadow: isGatillar ? asc.glow : 'none',
                          border: isGatillar ? `1px solid ${asc.color}40` : '1px solid transparent',
                        }}
                      >
                        {isGatillar ? '🔥 ' : score.actionScore.label === 'ATRACTIVO' ? '✓ ' : ''}
                        {score.actionScore.label}
                      </span>
                    </div>
                  </div>

                  {/* ── CONTEXT ROW: Micro scores + Action reason ── */}
                  <div className="mt-1 grid grid-cols-[28px_1fr] gap-1.5 items-start">
                    <div /> {/* spacer for rank column */}

                    <div className="flex items-center gap-2 flex-wrap">
                      {/* ΔTIR */}
                      <span className="text-[8px] text-app-text4">
                        ΔTIR{' '}
                        <span className={`font-mono ${score.deltaTIR !== null ? (score.deltaTIR > 0 ? 'text-[#2eebc8]' : score.deltaTIR < -0.02 ? 'text-[#f87171]' : 'text-app-text3') : 'text-app-text4'}`}>
                          {score.deltaTIR !== null ? fmtPct(score.deltaTIR, 3) : '—'}
                        </span>
                      </span>

                      {/* Presión Punta */}
                      <span className="text-[8px] text-app-text4">
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
                      <span className="text-[8px] text-app-text4">
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

                      {/* V5.0: Action Score reason (truncated) */}
                      {score.actionScore.label !== 'SIN SEÑAL' && score.actionScore.reason && (
                        <span className="text-[7px] truncate max-w-[200px] hidden sm:inline-block" style={{ color: asc.color + 'bb' }} title={score.actionScore.reason}>
                          {score.actionScore.reason}
                        </span>
                      )}

                      {/* Verdict reason (truncated) — only if different from action reason */}
                      {score.verdictReason && score.actionScore.label === 'SIN SEÑAL' && (
                        <span className="text-[7px] text-app-text4 truncate max-w-[180px] hidden sm:inline-block" title={score.verdictReason}>
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
      {/* V5.0: WEIGHT LEGEND + ACTION SCORE METHODOLOGY                */}
      {/* ═══════════════════════════════════════════════════════════ */}
      {sortedScores.length > 0 && (
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
                  <span className="text-[#f87171]">Alerta visual &lt;0.5%: "a tiro de gatillo"</span>
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
