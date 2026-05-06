// ════════════════════════════════════════════════════════════════════════
// V3.3-PRO Phase 2 — /api/cockpit-score: Unified Scalping Signal
//
// Computes the CockpitScore for every live LECAP/BONCAP instrument
// using 5 weighted scalping factors and assigns a verdict.
//
// Data sources:
//   - /api/letras (live instrument data from data912 + ArgentinaDatos)
//   - /api/market-truth (MEP/RP consensus for context)
//
// BLINDAJE: La comisión del 0.15% NO se toca.
// ════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import type { CockpitScore } from '@/lib/types';
import { calculateCockpitScore } from '@/lib/calculations';

export const dynamic = 'force-dynamic';

// ── In-Memory Cache ────────────────────────────────────────────────
interface CockpitCache {
  data: CockpitScoreResponse;
  timestamp: number;
}

let cachedCockpit: CockpitCache | null = null;
const CACHE_TTL_MS = 50_000; // 50s — fresh enough for scalping

// ── Response Types ─────────────────────────────────────────────────
interface CockpitScoreResponse {
  scores: CockpitScore[];
  all_scores: CockpitScore[];
  horizon_days: number;
  summary: {
    total: number;
    within_horizon: number;
    salto_tactico: number;
    punto_caramelo: number;
    atractivo: number;
    neutral: number;
    evitar: number;
  };
  timestamp: string;
  engine_version: string;
}

// ── Config Defaults ────────────────────────────────────────────────
// These match the DEFAULT_CONFIG from sampleData
const DEFAULT_CONFIG = {
  caucion1d: 17.0,
  caucion7d: 19.2,
  caucion30d: 18.5,
  comisionTotal: 0.30,
  riesgoPais: 558,
  capitalDisponible: 500000,
};

// ── Main Handler ───────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const now = Date.now();

  // Return cache if fresh
  if (cachedCockpit && (now - cachedCockpit.timestamp) < CACHE_TTL_MS) {
    return NextResponse.json(cachedCockpit.data);
  }

  // Parse horizon param (default: 45 days — V3.3-PRO Phase 3: Scalping Extendido)
  const { searchParams } = new URL(request.url);
  const horizon = Math.max(1, Math.min(365, parseInt(searchParams.get('horizon') || '45', 10) || 45));

  try {
    // ── Fetch live instrument data from /api/letras ──
    const letrasRes = await fetch(new URL('/api/letras', request.url).toString(), {
      signal: AbortSignal.timeout(15_000),
    });

    if (!letrasRes.ok) {
      return NextResponse.json(
        { error: true, message: 'Failed to fetch live instrument data from /api/letras' },
        { status: 502 },
      );
    }

    const letrasData = await letrasRes.json();
    const liveInstruments = letrasData.instruments ?? [];
    const caucionProxy = letrasData.caucion_proxy ?? { tna_promedio: 0, tem_caucion: 0 };

    // Build config from live caución data if available
    const config = { ...DEFAULT_CONFIG };
    if (caucionProxy.tna_promedio > 0) {
      // Use the proxy TNA for all caución tramos as a rough approximation
      // The letras API only provides a single proxy, so we use it for all tramos
      config.caucion7d = caucionProxy.tna_promedio;
      config.caucion30d = caucionProxy.tna_promedio;
      config.caucion1d = caucionProxy.tna_promedio + 0.5; // 1d is typically slightly higher
    }

    // ── Compute CockpitScore for each instrument ──
    const allScores: CockpitScore[] = liveInstruments.map((inst: Record<string, unknown>) => {
      // Convert LiveInstrument → Instrument-like object for calculateCockpitScore
      const instrument = {
        ticker: inst.ticker as string,
        type: (inst.type as string) === 'BONCAP' ? 'BONCAP' as const : 'LECAP' as const,
        expiry: inst.fecha_vencimiento as string,
        days: inst.days_to_expiry as number,
        price: inst.last_price as number,
        change: inst.change_pct as number,
        tna: (inst.tna as number) * 100,  // convert from decimal to %
        tem: (inst.tem as number) * 100,   // convert from decimal to %
        tir: (inst.tir as number) * 100,   // convert from decimal to %
        gananciaDirecta: (inst.ganancia_directa as number) * 100,
        vsPlazoFijo: '',
        iolMarketPressure: inst.iolMarketPressure as number | undefined,
      };

      // deltaTIR: from live data, convert from decimal to %
      const deltaTIR = inst.delta_tir != null
        ? (inst.delta_tir as number) * 100
        : null;

      // iolMarketPressure: if available from the instrument
      const iolMarketPressure = instrument.iolMarketPressure ?? null;

      // upsideCapital: estimate from spread_neto * days / 30 as rough proxy
      // In a full implementation, this would come from S/R data
      const spreadNetoPct = (inst.spread_neto as number) * 100;
      const upsideCapital = Math.max(0, spreadNetoPct * (instrument.days / 30) * 0.5);

      return calculateCockpitScore(
        instrument,
        config,
        deltaTIR,
        iolMarketPressure,
        upsideCapital,
        instrument.days,
      );
    });

    // Sort by cockpitScore descending
    allScores.sort((a: CockpitScore, b: CockpitScore) => b.cockpitScore - a.cockpitScore);

    // Filter by horizon
    const scores = allScores.filter((s: CockpitScore) => s.days <= horizon);

    // Summary
    const summary = {
      total: allScores.length,
      within_horizon: scores.length,
      salto_tactico: allScores.filter((s: CockpitScore) => s.verdict === 'SALTO_TACTICO').length,
      punto_caramelo: allScores.filter((s: CockpitScore) => s.verdict === 'PUNTO_CARAMELO').length,
      atractivo: allScores.filter((s: CockpitScore) => s.verdict === 'ATRACTIVO').length,
      neutral: allScores.filter((s: CockpitScore) => s.verdict === 'NEUTRAL').length,
      evitar: allScores.filter((s: CockpitScore) => s.verdict === 'EVITAR').length,
    };

    const response: CockpitScoreResponse = {
      scores,
      all_scores: allScores,
      horizon_days: horizon,
      summary,
      timestamp: new Date(now).toISOString(),
      engine_version: 'V3.3-PRO-Phase2',
    };

    // Cache it
    cachedCockpit = { data: response, timestamp: now };

    return NextResponse.json(response);
  } catch (error) {
    console.error('[cockpit-score] Error:', error);
    return NextResponse.json(
      { error: true, message: 'Cockpit score computation failed', detail: error instanceof Error ? error.message : 'unknown' },
      { status: 500 },
    );
  }
}
