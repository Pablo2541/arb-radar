/**
 * ARB//RADAR V3.2.1 — Filtro de Verdad (Truth Filter)
 *
 * Adjusts Hunting Scores based on data quality and IOL Level 2 validation.
 * Applies 6 priority-ordered rules to produce an adjustment from -15 to +8.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TruthFilterInput {
  ticker: string;
  spread_neto: number;
  change_pct: number;
  iol_status?: 'online' | 'offline' | 'no_data';
  iol_liquidity_alert?: boolean;
  iol_volume?: number;
}

export interface TruthFilterResult {
  ticker: string;
  spread_neto: number;       // TEM - TEM_caucion (decimal)
  upside_pct: number;        // estimated upside from current price
  iol_volume_confirmed: boolean;
  liquidity_alert: boolean;
  hunting_adjustment: number; // Score adjustment from -15 to +8
  verdict: string;           // Human-readable verdict
  rules_triggered: string[]; // Which of the 6 rules were triggered
}

// ---------------------------------------------------------------------------
// Rule definitions (evaluated in priority order — first match wins)
// ---------------------------------------------------------------------------

interface RuleResult {
  name: string;
  adjustment: number;
  verdict: string;
}

const RULES: Array<{
  id: string;
  priority: number;
  match: (input: TruthFilterInput) => boolean;
  result: (input: TruthFilterInput) => RuleResult;
}> = [
  // Rule 1 — BAJA LIQUIDEZ (-15)
  {
    id: 'BAJA_LIQUIDEZ',
    priority: 1,
    match: (input) => input.spread_neto > 0.50 && input.iol_liquidity_alert === true,
    result: () => ({
      name: 'BAJA_LIQUIDEZ',
      adjustment: -15,
      verdict: '⚠️ BAJA LIQUIDEZ — Upside atractivo pero sin volumen real que lo respalde',
    }),
  },

  // Rule 2 — CONFIRMADO POR VOLUMEN (+8)
  {
    id: 'CONFIRMADO_POR_VOLUMEN',
    priority: 2,
    match: (input) =>
      input.iol_status === 'online' &&
      (input.iol_volume ?? 0) > 0 &&
      input.iol_liquidity_alert !== true &&
      input.spread_neto > 0.25,
    result: () => ({
      name: 'CONFIRMADO_POR_VOLUMEN',
      adjustment: 8,
      verdict: '✅ CONFIRMADO — Spread positivo con volumen creciente en IOL',
    }),
  },

  // Rule 3 — VOLUMEN OK, SPREAD MARGINAL (+3)
  {
    id: 'VOLUMEN_OK_SPREAD_MARGINAL',
    priority: 3,
    match: (input) =>
      input.iol_status === 'online' &&
      (input.iol_volume ?? 0) > 0 &&
      input.iol_liquidity_alert !== true &&
      input.spread_neto <= 0.25,
    result: () => ({
      name: 'VOLUMEN_OK_SPREAD_MARGINAL',
      adjustment: 3,
      verdict: '📊 Volumen OK — Spread marginal pero liquidez respalda',
    }),
  },

  // Rule 4 — ALERTA LIQUIDEZ GENERAL (-8)
  {
    id: 'ALERTA_LIQUIDEZ_GENERAL',
    priority: 4,
    match: (input) => input.iol_liquidity_alert === true,
    result: () => ({
      name: 'ALERTA_LIQUIDEZ_GENERAL',
      adjustment: -8,
      verdict: '⚠️ ALERTA LIQUIDEZ — Volumen insuficiente en IOL',
    }),
  },

  // Rule 5 — SIN VOLUMEN OPERADO (0) — IOL online but zero trades
  {
    id: 'SIN_VOLUMEN_OPERADO',
    priority: 5,
    match: (input) =>
      input.iol_status === 'online' &&
      (input.iol_volume ?? 0) === 0 &&
      !input.iol_liquidity_alert,
    result: () => ({
      name: 'SIN_VOLUMEN_OPERADO',
      adjustment: -3,
      verdict: '📡 IOL Online — Sin volumen operado en la rueda (0 ops)',
    }),
  },

  // Rule 6 — IOL OFFLINE / NO DATA (0)
  {
    id: 'IOL_OFFLINE_NO_DATA',
    priority: 6,
    match: (input) => input.iol_status !== 'online',
    result: (input) => ({
      name: 'IOL_OFFLINE_NO_DATA',
      adjustment: 0,
      verdict:
        input.iol_status === 'offline'
          ? '🔌 IOL Offline — Sin datos de Nivel 2'
          : '📭 IOL: Ticker no disponible',
    }),
  },
];

// ---------------------------------------------------------------------------
// applyTruthFilter
// ---------------------------------------------------------------------------

export function applyTruthFilter(
  instruments: TruthFilterInput[],
  temCaucion: number,
): TruthFilterResult[] {
  return instruments.map((input) => {
    const triggered: string[] = [];
    let adjustment = 0;
    let verdict = '— Sin reglas aplicables';

    // Evaluate rules in priority order — first match wins
    for (const rule of RULES) {
      if (rule.match(input)) {
        const result = rule.result(input);
        adjustment = result.adjustment;
        verdict = result.verdict;
        triggered.push(result.name);
        break;
      }
    }

    // Derive computed fields
    const upside_pct = input.spread_neto - temCaucion;
    const iol_volume_confirmed =
      input.iol_status === 'online' &&
      (input.iol_volume ?? 0) > 0 &&
      input.iol_liquidity_alert !== true;

    return {
      ticker: input.ticker,
      spread_neto: input.spread_neto,
      upside_pct,
      iol_volume_confirmed,
      liquidity_alert: input.iol_liquidity_alert ?? false,
      hunting_adjustment: adjustment,
      verdict,
      rules_triggered: triggered,
    };
  });
}

// ---------------------------------------------------------------------------
// getHuntingScoreV2
// ---------------------------------------------------------------------------

export function getHuntingScoreV2(
  baseScore: number,
  filterResult: TruthFilterResult,
  srPosition?: 'CERCANO_MIN' | 'CERCANO_MAX' | 'MEDIO',
): number {
  // 70 / 30 split
  const truthComponent =
    (filterResult.iol_volume_confirmed ? 30 : 10) +
    (filterResult.liquidity_alert ? -20 : 0) +
    filterResult.hunting_adjustment;

  let score = baseScore * 0.7 + truthComponent * 0.3;

  // S/R proximity penalty
  if (srPosition === 'CERCANO_MAX' && filterResult.liquidity_alert) {
    score -= 10; // >90% S/R penalty
  }

  // Direct adjustment
  score += filterResult.hunting_adjustment;

  // Clamp to 0–100
  return Math.round(Math.max(0, Math.min(100, score)) * 100) / 100;
}
