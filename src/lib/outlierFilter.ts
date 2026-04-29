// ════════════════════════════════════════════════════════════════════════
// V3.0 — Outlier Filter for Curves & Charts
//
// Auto-filters null, zero, or erroneous prices that would
// spike rates to infinity. The terminal "heals" curves visually
// without user intervention.
//
// FILTER RULES:
// 1. Remove instruments with price ≤ 0 (division by zero → ∞ TIR)
// 2. Remove instruments with price = null/NaN/Infinity
// 3. Remove instruments with TEM outside ±3σ of the mean (statistical outliers)
// 4. Remove instruments with days ≤ 0 (expired)
// 5. Clamp extreme TIR values (> 200% or < -50%) — likely data errors
// ════════════════════════════════════════════════════════════════════════

import type { Instrument } from './types';

export interface FilterResult {
  instruments: Instrument[];
  removed: { ticker: string; reason: string }[];
  stats: {
    input: number;
    output: number;
    removedCount: number;
  };
}

/**
 * Filter instruments for chart/curve rendering.
 * Removes outliers and invalid data points that would distort curves.
 *
 * @param instruments - Raw instruments array
 * @param options - Optional filter configuration
 * @returns Filtered instruments + metadata about what was removed
 */
export function filterOutliers(
  instruments: Instrument[],
  options?: {
    /** Maximum σ deviation for TEM (default: 3) */
    sigmaThreshold?: number;
    /** Minimum valid price (default: 0.001) */
    minPrice?: number;
    /** Maximum valid price (default: 10 — 1.XXXX scale) */
    maxPrice?: number;
    /** Minimum valid days (default: 1) */
    minDays?: number;
    /** Maximum valid TEM % (default: 100) */
    maxTem?: number;
    /** Minimum valid TEM % (default: -20) */
    minTem?: number;
  }
): FilterResult {
  const {
    sigmaThreshold = 3,
    minPrice = 0.001,
    maxPrice = 10,
    minDays = 1,
    maxTem = 100,
    minTem = -20,
  } = options ?? {};

  const removed: { ticker: string; reason: string }[] = [];

  // ── Phase 1: Basic validity check ───────────────────────────────────
  const valid = instruments.filter(inst => {
    // Price checks
    if (inst.price === null || inst.price === undefined) {
      removed.push({ ticker: inst.ticker, reason: 'price is null/undefined' });
      return false;
    }
    if (!isFinite(inst.price)) {
      removed.push({ ticker: inst.ticker, reason: `price not finite: ${inst.price}` });
      return false;
    }
    if (inst.price <= 0) {
      removed.push({ ticker: inst.ticker, reason: `price ≤ 0: ${inst.price}` });
      return false;
    }
    if (inst.price < minPrice) {
      removed.push({ ticker: inst.ticker, reason: `price < ${minPrice}: ${inst.price}` });
      return false;
    }
    if (inst.price > maxPrice) {
      removed.push({ ticker: inst.ticker, reason: `price > ${maxPrice}: ${inst.price}` });
      return false;
    }

    // Days checks
    if (!isFinite(inst.days)) {
      removed.push({ ticker: inst.ticker, reason: `days not finite: ${inst.days}` });
      return false;
    }
    if (inst.days < minDays) {
      removed.push({ ticker: inst.ticker, reason: `days < ${minDays}: ${inst.days}` });
      return false;
    }

    // TEM/TIR checks
    if (!isFinite(inst.tem)) {
      removed.push({ ticker: inst.ticker, reason: `TEM not finite: ${inst.tem}` });
      return false;
    }
    if (inst.tem > maxTem) {
      removed.push({ ticker: inst.ticker, reason: `TEM > ${maxTem}%: ${inst.tem}%` });
      return false;
    }
    if (inst.tem < minTem) {
      removed.push({ ticker: inst.ticker, reason: `TEM < ${minTem}%: ${inst.tem}%` });
      return false;
    }
    if (!isFinite(inst.tir)) {
      removed.push({ ticker: inst.ticker, reason: `TIR not finite: ${inst.tir}` });
      return false;
    }

    return true;
  });

  // ── Phase 2: Statistical outlier detection (σ-based) ────────────────
  // Only apply if we have enough instruments for meaningful statistics
  if (valid.length >= 4) {
    const tems = valid.map(i => i.tem);
    const mean = tems.reduce((s, t) => s + t, 0) / tems.length;
    const variance = tems.reduce((s, t) => s + (t - mean) ** 2, 0) / tems.length;
    const stdDev = Math.sqrt(variance);

    if (stdDev > 0.01) { // Only filter if there's meaningful spread
      const statisticalOutliers: number[] = [];
      for (let i = valid.length - 1; i >= 0; i--) {
        const deviation = Math.abs(valid[i].tem - mean) / stdDev;
        if (deviation > sigmaThreshold) {
          removed.push({
            ticker: valid[i].ticker,
            reason: `TEM ${valid[i].tem.toFixed(2)}% is ${deviation.toFixed(1)}σ from mean (${mean.toFixed(2)}% ± ${stdDev.toFixed(2)})`,
          });
          statisticalOutliers.push(i);
        }
      }
      // Remove outliers (iterate in reverse to preserve indices)
      for (const idx of statisticalOutliers) {
        valid.splice(idx, 1);
      }
    }
  }

  return {
    instruments: valid,
    removed,
    stats: {
      input: instruments.length,
      output: valid.length,
      removedCount: removed.length,
    },
  };
}

/**
 * Quick filter for chart data — returns only valid instruments.
 * Silent version that doesn't track removals.
 */
export function filterForCharts(instruments: Instrument[]): Instrument[] {
  return instruments.filter(inst => {
    return (
      isFinite(inst.price) &&
      inst.price > 0.001 &&
      inst.price < 10 &&
      isFinite(inst.days) &&
      inst.days >= 1 &&
      isFinite(inst.tem) &&
      inst.tem > -20 &&
      inst.tem < 100 &&
      isFinite(inst.tir)
    );
  });
}

/**
 * Clamp a TEM value to reasonable bounds.
 * Returns the clamped value (mutates nothing).
 */
export function clampTEM(tem: number): number {
  if (!isFinite(tem)) return 0;
  return Math.max(-20, Math.min(100, tem));
}

/**
 * Validate a single instrument's data for curve rendering.
 * Returns true if the instrument can be safely used in calculations.
 */
export function isValidForCurve(inst: Instrument): boolean {
  return (
    isFinite(inst.price) &&
    inst.price > 0.001 &&
    inst.price < 10 &&
    isFinite(inst.days) &&
    inst.days >= 1 &&
    isFinite(inst.tem) &&
    inst.tem > -20 &&
    inst.tem < 100
  );
}
