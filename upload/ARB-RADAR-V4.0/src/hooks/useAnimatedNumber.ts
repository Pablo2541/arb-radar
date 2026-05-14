'use client';

/**
 * Formats a number with locale and prefix/suffix.
 * This is a pure formatting utility — no animation state management.
 * For animated counters, use CSS transitions on the container element instead.
 */
export function formatNumber(
  value: number,
  decimals: number = 0,
  prefix: string = '',
  suffix: string = ''
): string {
  const formatted = value.toLocaleString('es-AR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${prefix}${formatted}${suffix}`;
}

/**
 * Format as percentage
 */
export function formatPercent(value: number, decimals: number = 2): string {
  return formatNumber(value, decimals, '', '%');
}

/**
 * Format as currency
 */
export function formatCurrency(value: number, decimals: number = 0): string {
  return formatNumber(value, decimals, '$', '');
}

/**
 * Format with sign prefix (+/-)
 */
export function formatSigned(value: number, decimals: number = 2, suffix: string = '%'): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${formatNumber(value, decimals, '', suffix)}`;
}
