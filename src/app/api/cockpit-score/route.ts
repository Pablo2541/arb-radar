// ════════════════════════════════════════════════════════════════════════
// V6.0 — /api/cockpit-score: Unified Scalping Signal
//
// Computes the CockpitScore for every live LECAP/BONCAP instrument
// using 5 weighted scalping factors and assigns a verdict.
//
// V6.0 BREAKTHROUGH: S/R engine now reads from DailyOHLC table
// (30-day historical closes) instead of intraday bid/ask.
// This produces REAL structural support/resistance levels instead
// of static values like 1.2201 for T30J7.
//
// Data sources:
//   - /api/letras (live instrument data from data912 + ArgentinaDatos)
//   - DailyOHLC table (historical closes for true S/R calculation)
//
// BLINDAJE: La comisión del 0.15% NO se toca.
// ════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import type { CockpitScore } from '@/lib/types';
import {
  calculateCockpitScore,
  calculateHistoricalNearestSR,
  calculateHistoricalSR,
  calculateNearestSR,
  calculateVolumeInjection,
  calculateActionScore,
} from '@/lib/calculations';
import type { HistoricalOHLC } from '@/lib/calculations';
import { safeDbOp } from '@/lib/db';

export const dynamic = 'force-dynamic';

// ── In-Memory Cache ────────────────────────────────────────────────
interface CockpitCache {
  allScores: CockpitScore[];  // Always store ALL scores, never filtered
  data: CockpitScoreResponse; // Pre-built full response (horizon=365)
  timestamp: number;
  stale?: boolean;            // True if data came from stale cache
}

let cachedCockpit: CockpitCache | null = null;
const CACHE_TTL_MS = 50_000; // 50s — fresh enough for scalping
const LETRAS_TIMEOUT_MS = 2_000; // 2s max — never block the UI longer
const SR_LOOKBACK_DAYS = 30; // 30 calendar days for structural S/R

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
  stale?: boolean;
  stale_reason?: string;
  sr_source?: 'historical_ohlc' | 'intraday_fallback' | 'none';
}

// ── Config Defaults ────────────────────────────────────────────────
const DEFAULT_CONFIG = {
  caucion1d: 17.0,
  caucion7d: 19.2,
  caucion30d: 18.5,
  comisionTotal: 0.30,
  riesgoPais: 528,
  capitalDisponible: 500000,
};

// ── Main Handler ───────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const now = Date.now();

  // Parse horizon param FIRST (before cache check)
  const { searchParams } = new URL(request.url);
  const horizon = Math.max(1, Math.min(365, parseInt(searchParams.get('horizon') || '45', 10) || 45));

  // Return cache if fresh — cache stores ALL scores unfiltered
  if (cachedCockpit && (now - cachedCockpit.timestamp) < CACHE_TTL_MS) {
    const scores = horizon >= 365
      ? cachedCockpit.allScores
      : cachedCockpit.allScores.filter(s => s.days <= horizon);
    const response = {
      ...cachedCockpit.data,
      scores,
      horizon_days: horizon,
    };
    return NextResponse.json(response);
  }

  try {
    // ── Fetch live instrument data from /api/letras ──
    let letrasRes: Response;
    try {
      letrasRes = await fetch(new URL('/api/letras', request.url).toString(), {
        signal: AbortSignal.timeout(LETRAS_TIMEOUT_MS),
      });
    } catch (fetchErr) {
      if (cachedCockpit) {
        console.warn('[cockpit-score] /api/letras timeout/fail — returning stale cache');
        const scores = horizon >= 365
          ? cachedCockpit.allScores
          : cachedCockpit.allScores.filter(s => s.days <= horizon);
        const staleResponse = {
          ...cachedCockpit.data,
          scores,
          horizon_days: horizon,
          stale: true,
          stale_reason: fetchErr instanceof Error ? fetchErr.message : 'timeout',
        };
        return NextResponse.json(staleResponse);
      }
      return NextResponse.json(
        { error: true, message: 'Live data unavailable and no cache', detail: fetchErr instanceof Error ? fetchErr.message : 'timeout' },
        { status: 502 },
      );
    }

    if (!letrasRes.ok) {
      if (cachedCockpit) {
        console.warn('[cockpit-score] /api/letras error — returning stale cache');
        const scores = horizon >= 365
          ? cachedCockpit.allScores
          : cachedCockpit.allScores.filter(s => s.days <= horizon);
        const staleResponse = {
          ...cachedCockpit.data,
          scores,
          horizon_days: horizon,
          stale: true,
          stale_reason: `letras_api_${letrasRes.status}`,
        };
        return NextResponse.json(staleResponse);
      }
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
      config.caucion7d = caucionProxy.tna_promedio;
      config.caucion30d = caucionProxy.tna_promedio;
      config.caucion1d = caucionProxy.tna_promedio + 0.5;
    }

    // ═══════════════════════════════════════════════════════════════════
    // V6.0: Fetch historical OHLC data from DailyOHLC table
    //
    // This is the CRITICAL change — instead of deriving S/R from
    // intraday bid/ask (which just shows today's order book and
    // produces static values), we now read 30 days of actual market
    // closes and find the true structural floor/ceiling.
    // ═══════════════════════════════════════════════════════════════════
    let historicalOHLC: HistoricalOHLC[] = [];
    let srSource: 'historical_ohlc' | 'intraday_fallback' | 'none' = 'none';

    try {
      // Fetch ALL available OHLC data — the calculateHistoricalSR
      // function will take only the last SR_LOOKBACK_DAYS records
      // per ticker. Using no date filter ensures we always capture
      // whatever historical data exists, even if the update daemon
      // hasn't run recently.
      const ohlcRows = await safeDbOp((db) =>
        db.dailyOHLC.findMany({
          orderBy: [{ ticker: 'asc' }, { date: 'asc' }],
          select: {
            date: true,
            ticker: true,
            open: true,
            high: true,
            low: true,
            close: true,
          },
        })
      );

      if (ohlcRows && Array.isArray(ohlcRows) && ohlcRows.length > 0) {
        historicalOHLC = ohlcRows.map((r: Record<string, unknown>) => ({
          date: r.date as string,
          ticker: r.ticker as string,
          open: (r.open as number) || 0,
          high: (r.high as number) || 0,
          low: (r.low as number) || 0,
          close: (r.close as number) || 0,
        }));
        srSource = 'historical_ohlc';
        console.log(`[cockpit-score] V6.0 S/R: Loaded ${historicalOHLC.length} OHLC records for ${SR_LOOKBACK_DAYS}-day structural analysis`);
      } else {
        console.warn('[cockpit-score] V6.0 S/R: No DailyOHLC data found — falling back to intraday S/R');
        srSource = 'intraday_fallback';
      }
    } catch (dbErr) {
      console.warn('[cockpit-score] V6.0 S/R: DB query failed — falling back to intraday S/R:', dbErr instanceof Error ? dbErr.message : String(dbErr));
      srSource = 'intraday_fallback';
    }

    // ── Compute CockpitScore for each instrument ──
    const allScores: CockpitScore[] = liveInstruments.map((inst: Record<string, unknown>) => {
      const instrument = {
        ticker: inst.ticker as string,
        type: (inst.type as string) === 'BONCAP' ? 'BONCAP' as const : 'LECAP' as const,
        expiry: inst.fecha_vencimiento as string,
        days: inst.days_to_expiry as number,
        price: inst.last_price as number,
        change: inst.change_pct as number,
        tna: (inst.tna as number) * 100,
        tem: (inst.tem as number) * 100,
        tir: (inst.tir as number) * 100,
        gananciaDirecta: (inst.ganancia_directa as number) * 100,
        vsPlazoFijo: '',
        iolMarketPressure: inst.iol_market_pressure as number | undefined,
      };

      const deltaTIR = inst.delta_tir != null
        ? (inst.delta_tir as number) * 100
        : null;

      const iolMarketPressure = instrument.iolMarketPressure ?? null;
      const spreadNetoPct = (inst.spread_neto as number) * 100;

      // ═══════════════════════════════════════════════════════════════
      // V6.0.2: Historical S/R Calculation
      //
      // Primary: Use 30-day DailyOHLC closes for TRUE structural S/R
      //   - Today's date is EXCLUDED from the lookback (Argentina TZ)
      //   - V6.0.2 FIX: todayStr uses Argentina timezone (not UTC)
      // Fallback: Use change_pct-based intraday method (NOT raw bid)
      //   - Raw bid ≈ price for liquid instruments → fake 0.00% dist
      // Safety: Minimum 0.3% distance floor to prevent 0.00% display
      // ═══════════════════════════════════════════════════════════════
      const histSR = calculateHistoricalSR(
        instrument.ticker,
        instrument.price,
        historicalOHLC,
        SR_LOOKBACK_DAYS,
      );

      // Determine nearest S/R level and distance
      let nearestSR: { level: number; type: 'S' | 'R' } | null;
      let distanceToSR: number;
      let upsideCapital: number;

      if (histSR.isHistorical) {
        // V6.0.1: TRUE structural S/R from historical closes (today EXCLUDED)
        // distToSupport/distToResistance can be negative when price is
        // beyond the level (above resistance or below support).
        // For nearestSR, we compare absolute distances to find which
        // level is closer, regardless of direction.
        const absDistToSupport = Math.abs(histSR.distToSupport);
        const absDistToResistance = Math.abs(histSR.distToResistance);

        if (absDistToSupport <= absDistToResistance) {
          nearestSR = { level: histSR.support, type: 'S' };
          distanceToSR = absDistToSupport;
        } else {
          nearestSR = { level: histSR.resistance, type: 'R' };
          distanceToSR = absDistToResistance;
        }
        // Upside capital: positive distance from current price to resistance
        // (0 if already above resistance — the run is happening)
        upsideCapital = Math.max(0, histSR.distToResistance);
      } else {
        // Fallback: change_pct-based intraday method (V6.0.1: NOT raw bid)
        // The updated calculateNearestSR now prioritizes change_pct over
        // bid/ask, which gives meaningful distances instead of 0.00%
        nearestSR = calculateNearestSR(
          instrument.price,
          inst.iol_bid as number | undefined,
          inst.iol_ask as number | undefined,
          inst.change_pct as number | undefined,
        );
        distanceToSR = nearestSR
          ? Math.abs((instrument.price - nearestSR.level) / instrument.price) * 100
          : 99;
        // Rough proxy when no historical data
        upsideCapital = Math.max(0, spreadNetoPct * (instrument.days / 30) * 0.5);
      }

      // V6.0.1 SAFETY: Minimum distance floor for INTRADAY FALLBACK only
      // When using historical_ohlc, a tiny distance is a genuine signal
      // (price at its 30-day floor = highly significant). But when using
      // the intraday fallback (bid/ask or change_pct), distances < 0.05%
      // are artifacts of bid ≈ price, not real technical signals.
      if (distanceToSR < 0.05 && nearestSR && !histSR.isHistorical) {
        // Recalculate support as 2% below current price (sensible floor)
        const sensibleSupport = instrument.price * 0.98;
        nearestSR = { level: sensibleSupport, type: 'S' };
        distanceToSR = 2.0; // Exactly 2% by construction
      }

      // Volume Injection
      const volumeInjection = calculateVolumeInjection(
        (inst.iol_volume as number) || 0,
        (inst.volume as number) || 0,
        inst.change_pct as number | undefined,
      );

      // Action Score — now uses historical S/R distance when available
      const actionScore = calculateActionScore(
        distanceToSR,
        nearestSR?.type ?? null,
        volumeInjection.label,
        volumeInjection.ratio,
        iolMarketPressure,
        spreadNetoPct,
        deltaTIR,
      );

      return {
        ...calculateCockpitScore(
          instrument,
          config,
          deltaTIR,
          iolMarketPressure,
          upsideCapital,
          instrument.days,
        ),
        volume: (inst.volume as number) || 0,
        iolVolume: (inst.iol_volume as number) || 0,
        nearestSR,
        distanceToSR,
        volumeInjection,
        actionScore,
        // V6.0: Historical S/R metadata
        srSource: histSR.isHistorical ? 'historical_ohlc' : 'intraday_fallback',
        historicalSupport: histSR.isHistorical ? histSR.support : undefined,
        historicalResistance: histSR.isHistorical ? histSR.resistance : undefined,
      };
    });

    // V5.4: Sort by unifiedScore (base-100) descending — single source of truth
    allScores.sort((a: CockpitScore, b: CockpitScore) => b.unifiedScore - a.unifiedScore);

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
      engine_version: 'V6.0.2-HISTORICAL-SR-TZFIX',
      stale: false,
      sr_source: srSource,
    };

    // Cache it (store ALL scores, not filtered)
    cachedCockpit = { allScores, data: response, timestamp: now };

    return NextResponse.json(response);
  } catch (error) {
    console.error('[cockpit-score] Error:', error);
    if (cachedCockpit) {
      const scores = horizon >= 365
        ? cachedCockpit.allScores
        : cachedCockpit.allScores.filter(s => s.days <= horizon);
      const staleResponse = {
        ...cachedCockpit.data,
        scores,
        horizon_days: horizon,
        stale: true,
        stale_reason: 'computation_error',
      };
      return NextResponse.json(staleResponse);
    }
    return NextResponse.json(
      { error: true, message: 'Cockpit score computation failed', detail: error instanceof Error ? error.message : 'unknown' },
      { status: 500 },
    );
  }
}
