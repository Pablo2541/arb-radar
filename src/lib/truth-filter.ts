// ═══════════════════════════════════════════════════════════════════════
// ARB//RADAR V3.2 — Filtro de Verdad
// Shared data validation module for cross-referencing Level 1 prices
// (data912 / ArgentinaDatos) with Level 2 volume data (IOL).
//
// This module is used by both the Cerebro Táctico script and the frontend.
// Pure TypeScript — no React or Node-specific APIs.
// ═══════════════════════════════════════════════════════════════════════

// ── Types ─────────────────────────────────────────────────────────────

/** Result of applying the Filtro de Verdad to a single instrument. */
export interface FiltroVerdadResult {
  ticker: string;
  spreadPct: number;              // spread vs caución in percentage points
  upsidePct: number;              // estimated upside from current price
  iolVolumeConfirmed: boolean;    // True if IOL shows growing volume
  liquidityAlert: boolean;        // True if volume < 10% avg daily
  huntingAdjustment: number;      // Score adjustment from IOL data
  verdict: string;                // Human-readable verdict in Spanish
}

/** Input instrument shape for applyFiltroVerdad. */
export interface FiltroVerdadInput {
  ticker: string;
  tem: number;                    // percentage (e.g. 2.15)
  spread_neto: number;            // decimal (e.g. 0.005)
  change_pct: number;             // daily change %
  iol_status?: 'online' | 'offline' | 'no_data';
  iol_volume?: number;
  iol_liquidity_alert?: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────

/** Spread threshold (in percentage points) for "attractive upside" check. */
const SPREAD_HIGH_THRESHOLD_PCT = 0.50;

/** Spread threshold (in percentage points) for "confirmed" check. */
const SPREAD_CONFIRMED_THRESHOLD_PCT = 0.25;

/** Hunting score adjustments from Filtro de Verdad rules. */
const ADJUSTMENT = {
  LOW_LIQUIDITY_HIGH_SPREAD: -15,   // Attractive upside but no real volume
  CONFIRMED: +8,                     // Positive spread with growing IOL volume
  VOLUME_OK: +3,                     // Marginal spread but liquidity backs it
  LIQUIDITY_ALERT: -8,               // Insufficient IOL volume
  NEUTRAL: 0,                        // No clear signal
} as const;

// ── Verdict messages (Spanish) ────────────────────────────────────────

const VERDICT = {
  LOW_LIQUIDITY_HIGH_SPREAD:
    '⚠️ BAJA LIQUIDEZ — Upside atractivo pero sin volumen real que lo respalde',
  CONFIRMED:
    '✅ CONFIRMADO — Spread positivo con volumen creciente en IOL',
  VOLUME_OK:
    '📊 Volumen OK — Spread marginal pero liquidez respalda',
  LIQUIDITY_ALERT:
    '⚠️ ALERTA LIQUIDEZ — Volumen insuficiente en IOL',
  ONLINE_NO_SIGNAL:
    '📡 IOL Online — Sin señal clara de volumen',
  NO_DATA:
    '📭 IOL: Ticker no disponible en IOL',
  OFFLINE:
    '🔌 IOL Offline — Sin datos de Nivel 2',
} as const;

// ── Helper ────────────────────────────────────────────────────────────

/**
 * Returns only the numeric hunting-score adjustment for a single instrument
 * without building the full FiltroVerdadResult.
 *
 * Useful when you need the adjustment value quickly (e.g. inside a larger
 * scoring pipeline) without allocating the verdict string.
 */
export function getHuntingScoreAdjustment(instrument: FiltroVerdadInput): number {
  const { iol_status, iol_volume, iol_liquidity_alert, spread_neto } = instrument;

  // Only the 'online' branch produces non-zero adjustments
  if (iol_status !== 'online') return ADJUSTMENT.NEUTRAL;

  const spreadPct = spread_neto * 100;
  const hasVolume = (iol_volume ?? 0) > 0;
  const hasLiquidityAlert = iol_liquidity_alert === true;

  // Rule 1: High spread + low liquidity → heavy penalty
  if (spreadPct > SPREAD_HIGH_THRESHOLD_PCT && hasLiquidityAlert) {
    return ADJUSTMENT.LOW_LIQUIDITY_HIGH_SPREAD;
  }

  // Rule 2: Positive spread with confirmed growing volume → boost
  if (hasVolume && !hasLiquidityAlert && spreadPct > SPREAD_CONFIRMED_THRESHOLD_PCT) {
    return ADJUSTMENT.CONFIRMED;
  }

  // Rule 3: Volume present, no alert, but marginal spread → mild boost
  if (hasVolume && !hasLiquidityAlert) {
    return ADJUSTMENT.VOLUME_OK;
  }

  // Rule 4: Liquidity alert (but not high-spread case) → penalty
  if (hasLiquidityAlert) {
    return ADJUSTMENT.LIQUIDITY_ALERT;
  }

  // Rule 5: Online but no clear volume signal
  return ADJUSTMENT.NEUTRAL;
}

// ── Main function ─────────────────────────────────────────────────────

/**
 * Apply the "Filtro de Verdad" to a list of instruments.
 *
 * Cross-references Level 1 price data (data912 / ArgentinaDatos) with
 * Level 2 volume data (IOL) to produce quality verdicts and hunting-score
 * adjustments for each instrument.
 *
 * @param instruments  - Array of instruments with Level 1 + Level 2 fields
 * @param temCaucion   - Current caución TEM in percentage (e.g. 1.60)
 * @returns Array of FiltroVerdadResult, one per input instrument
 */
export function applyFiltroVerdad(
  instruments: FiltroVerdadInput[],
  temCaucion: number,
): FiltroVerdadResult[] {
  return instruments.map((inst) => {
    // ── Derived metrics ──
    const spreadPct = inst.spread_neto * 100;           // decimal → percentage points
    const upsidePct = inst.tem - temCaucion;             // percentage points

    // ── IOL state extraction (with safe defaults) ──
    const iolStatus = inst.iol_status;
    const iolVolume = inst.iol_volume ?? 0;
    const iolLiquidityAlert = inst.iol_liquidity_alert === true;
    const hasVolume = iolVolume > 0;

    // ── Determine verdict & adjustment ──
    let verdict: string;
    let huntingAdjustment: number;

    if (iolStatus === 'online') {
      // Rule 1: High spread + low liquidity → heavy penalty
      if (spreadPct > SPREAD_HIGH_THRESHOLD_PCT && iolLiquidityAlert) {
        verdict = VERDICT.LOW_LIQUIDITY_HIGH_SPREAD;
        huntingAdjustment = ADJUSTMENT.LOW_LIQUIDITY_HIGH_SPREAD;
      }
      // Rule 2: Positive spread with confirmed growing volume → boost
      else if (hasVolume && !iolLiquidityAlert && spreadPct > SPREAD_CONFIRMED_THRESHOLD_PCT) {
        verdict = VERDICT.CONFIRMED;
        huntingAdjustment = ADJUSTMENT.CONFIRMED;
      }
      // Rule 3: Volume present, no alert, but marginal spread → mild boost
      else if (hasVolume && !iolLiquidityAlert) {
        verdict = VERDICT.VOLUME_OK;
        huntingAdjustment = ADJUSTMENT.VOLUME_OK;
      }
      // Rule 4: Liquidity alert (but not high-spread case) → penalty
      else if (iolLiquidityAlert) {
        verdict = VERDICT.LIQUIDITY_ALERT;
        huntingAdjustment = ADJUSTMENT.LIQUIDITY_ALERT;
      }
      // Rule 5: Online but no clear volume signal
      else {
        verdict = VERDICT.ONLINE_NO_SIGNAL;
        huntingAdjustment = ADJUSTMENT.NEUTRAL;
      }
    } else if (iolStatus === 'no_data') {
      verdict = VERDICT.NO_DATA;
      huntingAdjustment = ADJUSTMENT.NEUTRAL;
    } else {
      // offline or no status
      verdict = VERDICT.OFFLINE;
      huntingAdjustment = ADJUSTMENT.NEUTRAL;
    }

    // ── Build result ──
    return {
      ticker: inst.ticker,
      spreadPct,
      upsidePct,
      iolVolumeConfirmed: iolStatus === 'online' && hasVolume && !iolLiquidityAlert,
      liquidityAlert: iolLiquidityAlert,
      huntingAdjustment,
      verdict,
    };
  });
}
