// ════════════════════════════════════════════════════════════════════════
// V6.2.0-FINAL — /api/cockpit-score: Unified Scalping Signal
//
// Computes the CockpitScore for every live LECAP/BONCAP instrument
// using 5 weighted scalping factors and assigns a verdict.
//
// V6.2.0 BREAKTHROUGH: Row Flash Effect + Scream Log Console
//   - When an instrument triggers an audio alert, its row flashes 4s gold/green glow
//   - "Recent Screams" log console beneath EL GRITO banner shows last triggered event
//   - Verdict state changes (PUNTO_CARAMELO, SALTO_TACTICO) trigger visual flash
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

      // ═══════════════════════════════════════════════════════════════════
      // V7.0-FASE1: Desbalance del Order Book (Top-5)
      //
      // Reemplaza la presión basada en depth total por un análisis
      // de las primeras 5 líneas de compra (BID) y venta (ASK).
      // El trigger se activa si la compra duplica (ratio ≥ 2) o
      // triplica (ratio ≥ 3) a la oferta.
      //
      // Cascada:
      //   1. IOL Top-5 (si hay datos de puntas_detalle)
      //   2. IOL Depth Total (fallback clásico)
      //   3. data912 q_bid/q_ask (Level 1 fallback)
      // ═══════════════════════════════════════════════════════════════════
      const top5BidVol = (inst.iol_top5_bid_vol as number) || 0;
      const top5AskVol = (inst.iol_top5_ask_vol as number) || 0;
      const qBid = (inst.q_bid as number) || 0;
      const qAsk = (inst.q_ask as number) || 0;

      let puntaPressurePct: number | null = null;
      let top5PressurePct: number | null = null;
      let top5PressureRatio: number | null = null;
      let bookImbalanceLabel: CockpitScore['bookImbalanceLabel'] = 'SIN DATOS';

      // V7.0-FASE1: Calcular desbalance Top-5 desde IOL
      if (top5BidVol > 0 || top5AskVol > 0) {
        const top5Total = top5BidVol + top5AskVol;
        top5PressurePct = top5Total > 0 ? ((top5BidVol - top5AskVol) / top5Total) * 100 : null;
        top5PressureRatio = top5AskVol > 0 ? top5BidVol / top5AskVol : (top5BidVol > 0 ? 99 : 0);

        // Etiquetas de desbalance según la consigna
        if (top5PressureRatio >= 3) {
          bookImbalanceLabel = 'DESBALANCE EXTREMO'; // Compra triplica la oferta
        } else if (top5PressureRatio >= 2) {
          bookImbalanceLabel = 'DESBALANCE COMPRA'; // Compra duplica la oferta
        } else if (top5PressureRatio >= 0.5) {
          bookImbalanceLabel = 'BALANCEADO'; // Relación relativamente equilibrada
        } else {
          bookImbalanceLabel = 'DESBALANCE VENTA'; // Venta domina
        }

        // Usar top-5 como presión principal (reemplaza depth total)
        puntaPressurePct = top5PressurePct;
      } else if (iolMarketPressure !== null && iolMarketPressure > 0) {
        // Fallback clásico: IOL depth total
        puntaPressurePct = ((iolMarketPressure - 1) / (iolMarketPressure + 1)) * 100;
        bookImbalanceLabel = 'SIN DATOS';
      } else if (qBid > 0 || qAsk > 0) {
        // Fallback Level 1: data912 q_bid/q_ask
        const totalVol = qBid + qAsk;
        puntaPressurePct = totalVol > 0 ? ((qBid - qAsk) / totalVol) * 100 : null;
        bookImbalanceLabel = 'SIN DATOS';
      }

      // Presión para Action Score (formato ratio para retrocompatibilidad)
      const pressureForActionScore: number | null = top5PressureRatio !== null
        ? top5PressureRatio
        : iolMarketPressure !== null && iolMarketPressure > 0
          ? iolMarketPressure
          : puntaPressurePct !== null
            ? (100 + puntaPressurePct) / (100 - puntaPressurePct)
            : null;

      // ═══════════════════════════════════════════════════════════════
      // V6.1.0: Historical S/R with DYNAMIC POLARITY REVERSAL
      //
      // Primary: Use 30-day DailyOHLC closes for TRUE structural S/R
      //   - Today's date is EXCLUDED from the lookback (Argentina TZ)
      //   - BULLISH_BREAKOUT: price > maxClose → maxClose becomes support
      //   - BEARISH_BREAKDOWN: price < minClose → minClose becomes resistance
      //   - INSIDE_CHANNEL: standard nearest-S/R logic
      //   - ADR × 1.5 used for projected targets on breakout/breakdown
      // Fallback: Use change_pct-based intraday method (NOT raw bid)
      // Safety: Minimum 0.3% distance floor for intraday fallback only
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
        // V6.1.0: After polarity reversal, support is ALWAYS below price
        // and resistance is ALWAYS above price. Distances are always positive.
        // We simply compare which effective level is closer.
        const distToSupport = histSR.distToSupport;
        const distToResistance = histSR.distToResistance;

        if (distToSupport <= distToResistance) {
          nearestSR = { level: histSR.support, type: 'S' };
          distanceToSR = distToSupport;
        } else {
          nearestSR = { level: histSR.resistance, type: 'R' };
          distanceToSR = distToResistance;
        }
        // Upside capital: distance from current price to resistance ceiling
        upsideCapital = distToResistance;
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
      // V6.2.0: Use unified pressure (iolMarketPressure or puntaPressurePct→ratio)
      const actionScore = calculateActionScore(
        distanceToSR,
        nearestSR?.type ?? null,
        volumeInjection.label,
        volumeInjection.ratio,
        pressureForActionScore,
        spreadNetoPct,
        deltaTIR,
      );

      return {
        ...calculateCockpitScore(
          instrument,
          config,
          deltaTIR,
          iolMarketPressure,
          puntaPressurePct,
          upsideCapital,
          instrument.days,
        ),
        volume: (inst.volume as number) || 0,
        iolVolume: (inst.iol_volume as number) || 0,
        nearestSR,
        distanceToSR,
        volumeInjection,
        actionScore,
        // V6.1.0: Historical S/R metadata with polarity reversal
        srSource: histSR.isHistorical ? 'historical_ohlc' : 'intraday_fallback',
        historicalSupport: histSR.isHistorical ? histSR.support : undefined,
        historicalResistance: histSR.isHistorical ? histSR.resistance : undefined,
        polarity: histSR.isHistorical ? histSR.polarity : undefined,
        avgDailyRange: histSR.isHistorical ? histSR.avgDailyRange : undefined,
        atr: histSR.isHistorical ? histSR.atr : undefined,
        rawSupport: histSR.isHistorical ? histSR.rawSupport : undefined,
        rawResistance: histSR.isHistorical ? histSR.rawResistance : undefined,
        // V7.0-FASE1: Volatilidad Mínima
        atrPct: histSR.isHistorical && histSR.atr > 0 && instrument.price > 0
          ? Math.round((histSR.atr / instrument.price) * 100 * 100) / 100 // ATR como % del precio, 2 decimales
          : undefined,
        anestesiado: histSR.isHistorical && histSR.atr > 0 && instrument.price > 0
          ? ((histSR.atr / instrument.price) * 100) < 0.30 // ATR% < 0.30% = instrumento "muerto"
          : false, // Sin datos históricos, no penalizar
        // V7.0-FASE1: Desbalance del Order Book (Top-5)
        top5PressurePct,
        top5PressureRatio,
        bookImbalanceLabel,
      };
    });

    // V5.4: Sort by unifiedScore (base-100) descending — single source of truth
    allScores.sort((a: CockpitScore, b: CockpitScore) => b.unifiedScore - a.unifiedScore);

    // ═══════════════════════════════════════════════════════════════════
    // V7.0-FASE1: Demover instrumentos anestesiados en el ranking
    //
    // Un instrumento con ATR < 0.30% se considera "muerto" y NO debe
    // aparecer en los primeros puestos ni en El Grito. Se los empuja
    // al final del ranking preservando el orden relativo entre ellos.
    // ═══════════════════════════════════════════════════════════════════
    const activeScores = allScores.filter((s: CockpitScore) => !s.anestesiado);
    const anestesiadoScores = allScores.filter((s: CockpitScore) => s.anestesiado);
    const demotedAllScores = [...activeScores, ...anestesiadoScores];

    if (anestesiadoScores.length > 0) {
      console.log(`[cockpit-score] V7.0-FASE1: ${anestesiadoScores.length} instrumentos anestesiados demovidos al final del ranking`);
    }

    // Filter by horizon (usar demotedAllScores para respetar saneamiento)
    const scores = demotedAllScores.filter((s: CockpitScore) => s.days <= horizon);

    // Summary
    const summary = {
      total: demotedAllScores.length,
      within_horizon: scores.length,
      salto_tactico: demotedAllScores.filter((s: CockpitScore) => s.verdict === 'SALTO_TACTICO').length,
      punto_caramelo: demotedAllScores.filter((s: CockpitScore) => s.verdict === 'PUNTO_CARAMELO').length,
      atractivo: demotedAllScores.filter((s: CockpitScore) => s.verdict === 'ATRACTIVO').length,
      neutral: demotedAllScores.filter((s: CockpitScore) => s.verdict === 'NEUTRAL').length,
      evitar: demotedAllScores.filter((s: CockpitScore) => s.verdict === 'EVITAR').length,
    };

    const response: CockpitScoreResponse = {
      scores,
      all_scores: demotedAllScores,
      horizon_days: horizon,
      summary,
      timestamp: new Date(now).toISOString(),
      engine_version: 'V7.0-FASE1',
      stale: false,
      sr_source: srSource,
    };

    // Cache it (store ALL scores demoted, not filtered)
    cachedCockpit = { allScores: demotedAllScores, data: response, timestamp: now };

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
