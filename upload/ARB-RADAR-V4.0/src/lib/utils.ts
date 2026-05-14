import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ════════════════════════════════════════════════════════════════════════
// V3.2.3-PRO — NaN-Safe Utility Functions
//
// Defensive coding layer to prevent crashes from null/undefined values
// after DB resets or missing data. All toFixed/toLocaleString calls
// MUST go through these functions.
// ════════════════════════════════════════════════════════════════════════

/**
 * Safe toFixed — never throws on NaN/null/undefined
 * Returns "—" for nullish values, otherwise formats to N decimal places.
 */
export function safeToFixed(value: unknown, decimals: number = 2, fallback: string = '—'): string {
  if (value === null || value === undefined) return fallback;
  const num = Number(value);
  if (!isFinite(num) || isNaN(num)) return fallback;
  return num.toFixed(decimals);
}

/**
 * Safe toLocaleString — never throws on NaN/null/undefined
 * Returns fallback for nullish values, otherwise formats as locale number.
 */
export function safeToLocaleString(value: unknown, options?: Intl.NumberFormatOptions, fallback: string = '—'): string {
  if (value === null || value === undefined) return fallback;
  const num = Number(value);
  if (!isFinite(num) || isNaN(num)) return fallback;
  return num.toLocaleString('es-AR', options);
}

/**
 * Safe number — converts any value to a valid number, with fallback default.
 * Returns `defaultValue` for NaN/null/undefined/Infinity.
 */
export function safeNumber(value: unknown, defaultValue: number = 0): number {
  if (value === null || value === undefined) return defaultValue;
  const num = Number(value);
  if (!isFinite(num) || isNaN(num)) return defaultValue;
  return num;
}

/**
 * Safe percentage — formats a decimal (e.g. 0.0207) as a percentage string.
 * Returns fallback for nullish/NaN values.
 */
export function safePercent(value: unknown, decimals: number = 2, fallback: string = '—'): string {
  if (value === null || value === undefined) return fallback;
  const num = Number(value);
  if (!isFinite(num) || isNaN(num)) return fallback;
  return (num * 100).toFixed(decimals) + '%';
}

/**
 * Safe currency — formats a number as ARS currency string.
 */
export function safeCurrency(value: unknown, decimals: number = 0, fallback: string = '—'): string {
  return safeToLocaleString(value, { 
    style: 'currency', 
    currency: 'ARS', 
    maximumFractionDigits: decimals,
    minimumFractionDigits: 0,
  }, fallback);
}

/**
 * Safe volume formatter — displays volume in K/M notation.
 */
export function safeVolume(value: unknown, fallback: string = '—'): string {
  if (value === null || value === undefined) return fallback;
  const num = Number(value);
  if (!isFinite(num) || isNaN(num)) return fallback;
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M';
  if (num >= 1_000) return (num / 1_000).toFixed(0) + 'K';
  return num.toFixed(0);
}

/**
 * Safe depth formatter — displays order book depth in K/M notation.
 */
export function safeDepth(value: unknown, fallback: string = '—'): string {
  return safeVolume(value, fallback);
}

/**
 * Safe market pressure color — returns color based on pressure ratio.
 */
export function safePressureColor(pressure: unknown): string {
  const p = safeNumber(pressure, 0);
  if (p > 1.3) return '#2eebc8'; // buying pressure
  if (p < 0.7) return '#f87171'; // selling pressure
  return '#fbbf24'; // neutral
}
