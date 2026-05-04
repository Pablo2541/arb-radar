// ════════════════════════════════════════════════════════════════════════
// V3.2.3-PRO — Chart Axis & Tooltip Formatters
//
// Professional formatting for Recharts axes and tooltips.
// Eliminates floating point artifacts (e.g. 1.99999999996 → 2.00%)
// by rounding BEFORE formatting.
// ════════════════════════════════════════════════════════════════════════

/**
 * Round a number to N decimal places (avoids floating point artifacts).
 * Uses Math.round for clean values: roundTo(1.9999999, 2) → 2.00
 */
export function roundTo(value: number, decimals: number): number {
  if (!isFinite(value) || isNaN(value)) return 0;
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

/**
 * Format TEM value for Y-axis tick: max 2 decimals with % suffix
 * Example: 2.07 → "2.07%", 1.9999999 → "2.00%"
 */
export function formatTEMAxis(value: number): string {
  return `${roundTo(value, 2).toFixed(2)}%`;
}

/**
 * Format Spread value for Y-axis tick: max 3 decimals with % suffix
 * Example: 0.432 → "0.432%", -0.001 → "-0.001%"
 */
export function formatSpreadAxis(value: number): string {
  return `${roundTo(value, 3).toFixed(3)}%`;
}

/**
 * Format Slope value for Y-axis tick: max 2 decimals with % suffix
 * Example: 0.15 → "0.15%"
 */
export function formatSlopeAxis(value: number): string {
  return `${roundTo(value, 2).toFixed(2)}%`;
}

/**
 * Format Duration Modified for Y-axis tick: max 3 decimals
 */
export function formatDMAxis(value: number): string {
  return roundTo(value, 3).toFixed(3);
}

/**
 * Format Price for Y-axis tick: max 4 decimals
 */
export function formatPriceAxis(value: number): string {
  return roundTo(value, 4).toFixed(4);
}

/**
 * Format Volume for Y-axis tick: K/M notation
 */
export function formatVolumeAxis(value: number): string {
  if (!isFinite(value) || isNaN(value)) return '0';
  if (value >= 1_000_000) return `${roundTo(value / 1_000_000, 1).toFixed(1)}M`;
  if (value >= 1_000) return `${roundTo(value / 1_000, 0).toFixed(0)}K`;
  return roundTo(value, 0).toFixed(0);
}

/**
 * Format tooltip value for TEM: 3 decimals with %
 * Clean display: roundTo(2.070000001, 3) = 2.07 → "2.070%"
 */
export function formatTEMTooltip(value: number): string {
  return `${roundTo(value, 3).toFixed(3)}%`;
}

/**
 * Format tooltip value for Spread: 3 decimals with %
 */
export function formatSpreadTooltip(value: number): string {
  return `${roundTo(value, 3).toFixed(3)}%`;
}

/**
 * Format tooltip value for generic float: 3 decimals
 */
export function formatFloatTooltip(value: number): string {
  return roundTo(value, 3).toFixed(3);
}

/**
 * Format tooltip value for price: 4 decimals
 */
export function formatPriceTooltip(value: number): string {
  return roundTo(value, 4).toFixed(4);
}

/**
 * Format tooltip value for Duration Modified: 4 decimals
 */
export function formatDMTooltip(value: number): string {
  return roundTo(value, 4).toFixed(4);
}
