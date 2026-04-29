import { Instrument, SRData, PriceHistoryEntry } from './types';

// Type for the historico_precios.json structure
export interface PriceHistoryFile {
  descripcion: string;
  metadatos: {
    moneda: string;
    periodo: string;
    instrumentos_maestro: Record<string, { vto: string; tipo: string }>;
  };
  historico: Record<string, Record<string, PriceHistoryEntry>>;
}

// ════════════════════════════════════════════════════════════════════
// V1.8.3 — ESCALA ÚNICA 1.XXXX
// ════════════════════════════════════════════════════════════════════
// The system works exclusively in the 1.XXXX scale (e.g., 1.1615).
// Old files from external sources may have prices in the 100-scale
// (e.g., 116.15). The normalizePriceEntry function detects this and
// auto-divides by 100 to bring everything to the unified scale.

// ════════════════════════════════════════════════════════════════════
// V1.8.4 — LOOKBACK_DAYS forced to 15
// ════════════════════════════════════════════════════════════════════

/** V1.8.4: Definitive 15-day lookback window for S/R calculation. Never change. */
export const LOOKBACK_DAYS = 15;

/** Threshold above which a price is considered to be in 100-scale */
const SCALE_THRESHOLD = 10;

/** Minimum valid price below which data is considered garbage */
const MIN_VALID_PRICE = 0.01;

/**
 * V1.8.3 — Normalize a single price entry to the 1.XXXX scale.
 * - If price > SCALE_THRESHOLD (10), divides by 100 (old 100-scale format)
 * - If price < MIN_VALID_PRICE (0.01), rejects as garbage
 * - If price is NaN/Infinity, rejects
 * Returns null if the entry should be discarded.
 */
export function normalizePriceEntry(entry: PriceHistoryEntry): { entry: PriceHistoryEntry; wasScaled: boolean } | null {
  if (!entry || typeof entry.p !== 'number' || !isFinite(entry.p)) return null;

  let price = entry.p;
  let wasScaled = false;

  // V1.8.3: If price > 10 (e.g., 116.15), it's in the old 100-scale → divide by 100
  if (price > SCALE_THRESHOLD) {
    price = price / 100;
    wasScaled = true;
  }

  // Reject garbage prices (extremely small values, negative, zero)
  if (price < MIN_VALID_PRICE) return null;

  // Also sanitize TNA/TEM
  const safeTna = (typeof entry.tna === 'number' && isFinite(entry.tna) && entry.tna >= 0) ? entry.tna : 0;
  const safeTem = (typeof entry.tem === 'number' && isFinite(entry.tem) && entry.tem >= 0) ? entry.tem : 0;
  const safeDm = (typeof entry.dm === 'number' && isFinite(entry.dm)) ? entry.dm : 0;

  return {
    entry: { p: price, tna: safeTna, tem: safeTem, dm: safeDm },
    wasScaled,
  };
}

/**
 * V1.8.3 — Result of normalizing a full PriceHistoryFile.
 * Provides detailed stats about scaled and rejected entries.
 */
export interface NormalizeResult {
  normalized: PriceHistoryFile;
  scaledCount: number;   // entries that were > 10 and divided by 100
  rejectedCount: number; // entries that were garbage (< 0.01 or invalid)
  totalCount: number;    // total entries processed
}

/**
 * V1.8.3 — Normalize an entire PriceHistoryFile to the 1.XXXX scale.
 * Prices > 10 are automatically divided by 100.
 * Prices < 0.01 are rejected as garbage.
 */
export function normalizePriceHistory(data: PriceHistoryFile): NormalizeResult {
  let scaledCount = 0;
  let rejectedCount = 0;
  let totalCount = 0;
  const normalizedHistorico: Record<string, Record<string, PriceHistoryEntry>> = {};

  for (const [dateKey, dayData] of Object.entries(data.historico)) {
    const normalizedDay: Record<string, PriceHistoryEntry> = {};
    for (const [ticker, entry] of Object.entries(dayData)) {
      totalCount++;
      const result = normalizePriceEntry(entry);
      if (result) {
        normalizedDay[ticker] = result.entry;
        if (result.wasScaled) scaledCount++;
      } else {
        rejectedCount++;
      }
    }
    // Only include the date if it has at least one valid entry
    if (Object.keys(normalizedDay).length > 0) {
      normalizedHistorico[dateKey] = normalizedDay;
    }
  }

  return {
    normalized: {
      ...data,
      historico: normalizedHistorico,
    },
    scaledCount,
    rejectedCount,
    totalCount,
  };
}

/**
 * Calculate Support/Resistance from price history
 * V1.8.5: Uses Pure Extremes (exact Max/Min) from the last 15 trading days.
 * Integrates both historical file data and manual daily loads.
 * Support = minimum price across all 15 days (exact low)
 * Resistance = maximum price across all 15 days (exact high)
 * Prices > SCALE_THRESHOLD are auto-normalized before S/R calculation.
 * Position in channel = (current - min) / (max - min) * 100
 */
export function calculateSR(
  priceHistory: PriceHistoryFile,
  currentInstruments: Instrument[]
): SRData[] {
  const dates = Object.keys(priceHistory.historico).sort();
  // V1.8.4: Forced LOOKBACK_DAYS=15 — never revert to 5
  const lastNDates = dates.slice(-LOOKBACK_DAYS);

  return currentInstruments.map(inst => {
    let minPrice = Infinity;
    let maxPrice = -Infinity;

    // V1.8.3: Normalize instrument price to 1.XXXX scale
    let safePrice = inst.price;
    if (safePrice > SCALE_THRESHOLD) safePrice = safePrice / 100;

    for (const date of lastNDates) {
      const dayData = priceHistory.historico[date];
      const entry = dayData[inst.ticker];
      if (entry && typeof entry.p === 'number' && isFinite(entry.p)) {
        // V1.8.3: Normalize price to 1.XXXX if in 100-scale
        let p = entry.p;
        if (p > SCALE_THRESHOLD) p = p / 100;
        // Only accept valid prices after normalization
        if (p >= MIN_VALID_PRICE) {
          minPrice = Math.min(minPrice, p);
          maxPrice = Math.max(maxPrice, p);
        }
      }
    }

    // Fallback if no history found
    if (minPrice === Infinity || !isFinite(minPrice)) minPrice = (safePrice || 1) * 0.98;
    if (maxPrice === -Infinity || !isFinite(maxPrice)) maxPrice = (safePrice || 1) * 1.02;

    // V1.8.3: Validate the current instrument price on unified scale
    if (!safePrice || safePrice < MIN_VALID_PRICE || !isFinite(safePrice)) {
      safePrice = (minPrice + maxPrice) / 2 || 1;
    }

    const distanciaSoporte = ((safePrice - minPrice) / (minPrice || 1)) * 100;
    const distanciaResistencia = ((maxPrice - safePrice) / (safePrice || 1)) * 100;

    // V1.8.4: Position in channel — 0% at support, 100% at resistance
    const range = maxPrice - minPrice;
    const posicionEnCanal = range > 0
      ? Math.min(100, Math.max(0, ((safePrice - minPrice) / range) * 100))
      : 50;

    // V1.7: Calculate TEM range from history for compression analysis
    let minTEM = Infinity;
    let maxTEM = -Infinity;
    for (const date of lastNDates) {
      const dayData = priceHistory.historico[date];
      const entry = dayData[inst.ticker];
      if (entry && typeof entry.tem === 'number' && isFinite(entry.tem) && entry.tem > 0) {
        minTEM = Math.min(minTEM, entry.tem);
        maxTEM = Math.max(maxTEM, entry.tem);
      }
    }
    if (minTEM === Infinity) minTEM = inst.tem;
    if (maxTEM === -Infinity) maxTEM = inst.tem;

    const upsideCapital = distanciaResistencia; // % upside to resistance
    const downsideRisk = distanciaSoporte;       // % downside to support

    let temPosition: 'CERCANO_MIN' | 'CERCANO_MAX' | 'MEDIO' = 'MEDIO';
    const temRange = maxTEM - minTEM;
    if (temRange > 0.01) {
      const temPct = (inst.tem - minTEM) / temRange;
      if (temPct <= 0.3) temPosition = 'CERCANO_MIN';
      else if (temPct >= 0.7) temPosition = 'CERCANO_MAX';
    }

    return {
      ticker: inst.ticker,
      soporte: isFinite(minPrice) ? minPrice : 0,
      resistencia: isFinite(maxPrice) ? maxPrice : 0,
      precioActual: safePrice,
      distanciaSoporte: isFinite(distanciaSoporte) ? distanciaSoporte : 0,
      distanciaResistencia: isFinite(distanciaResistencia) ? distanciaResistencia : 0,
      posicionEnCanal: isFinite(posicionEnCanal) ? posicionEnCanal : 50,
      upsideCapital: isFinite(upsideCapital) ? upsideCapital : 0,
      downsideRisk: isFinite(downsideRisk) ? downsideRisk : 0,
      minTEM15d: isFinite(minTEM) ? minTEM : inst.tem,
      maxTEM15d: isFinite(maxTEM) ? maxTEM : inst.tem,
      temPosition,
    };
  });
}

/**
 * Get DM (Duration Modified) from the latest entry in price history
 */
export function getLatestDM(
  priceHistory: PriceHistoryFile,
  ticker: string
): number | undefined {
  const dates = Object.keys(priceHistory.historico).sort();
  for (let i = dates.length - 1; i >= 0; i--) {
    const dayData = priceHistory.historico[dates[i]];
    const entry = dayData[ticker];
    if (entry && entry.dm > 0) return entry.dm;
  }
  return undefined;
}

/**
 * Get price history for a specific ticker as an array sorted by date
 * V1.8.3: All prices are in 1.XXXX scale (normalized on import)
 */
export function getTickerHistory(
  priceHistory: PriceHistoryFile,
  ticker: string
): { date: string; entry: PriceHistoryEntry }[] {
  const dates = Object.keys(priceHistory.historico).sort();
  const result: { date: string; entry: PriceHistoryEntry }[] = [];

  for (const date of dates) {
    const dayData = priceHistory.historico[date];
    const entry = dayData[ticker];
    // V1.8.3: Only include valid entries (prices already normalized to 1.XXXX on import)
    if (entry && typeof entry.p === 'number' && entry.p >= MIN_VALID_PRICE && isFinite(entry.p)) {
      result.push({ date, entry });
    }
  }

  return result;
}

/**
 * Get the last N days of price history for a ticker
 * V1.8.3: Default 15 days, all in 1.XXXX scale
 */
export function getRecentHistory(
  priceHistory: PriceHistoryFile,
  ticker: string,
  n: number = LOOKBACK_DAYS
): { date: string; entry: PriceHistoryEntry }[] {
  const full = getTickerHistory(priceHistory, ticker);
  return full.slice(-n);
}

/**
 * Calculate price momentum from history
 * Returns the price change percentage over the last N days
 * V1.8.3: All prices in 1.XXXX scale
 */
export function calculatePriceMomentum(
  priceHistory: PriceHistoryFile,
  ticker: string,
  days: number = LOOKBACK_DAYS
): number {
  const history = getRecentHistory(priceHistory, ticker, days + 1);
  if (history.length < 2) return 0;

  const oldest = history[0].entry.p;
  const newest = history[history.length - 1].entry.p;

  if (oldest <= 0) return 0;
  return ((newest - oldest) / oldest) * 100;
}

/**
 * Get available tickers from price history
 */
export function getAvailableTickers(priceHistory: PriceHistoryFile): string[] {
  const tickers = new Set<string>();
  for (const dateKey of Object.keys(priceHistory.historico)) {
    const dayData = priceHistory.historico[dateKey];
    for (const ticker of Object.keys(dayData)) {
      tickers.add(ticker);
    }
  }
  return Array.from(tickers).sort();
}

/**
 * Get the date range of the price history
 */
export function getDateRange(priceHistory: PriceHistoryFile): { from: string; to: string } {
  const dates = Object.keys(priceHistory.historico).sort();
  if (dates.length === 0) return { from: '', to: '' };
  return { from: dates[0], to: dates[dates.length - 1] };
}

/**
 * V1.8.3 — Audit stats for a price history file.
 * Counts scaled entries (> 10, needing /100 normalization),
 * rejected entries (garbage), and total.
 */
export function countAuditEntries(data: PriceHistoryFile): { 
  scaled: number; 
  rejected: number; 
  total: number; 
  details: string[] 
} {
  let scaled = 0;
  let rejected = 0;
  let total = 0;
  const details: string[] = [];

  for (const [dateKey, dayData] of Object.entries(data.historico)) {
    for (const [ticker, entry] of Object.entries(dayData)) {
      total++;
      if (!entry || typeof entry.p !== 'number' || !isFinite(entry.p)) {
        rejected++;
        details.push(`${dateKey} ${ticker}: p=invalid`);
      } else if (entry.p > SCALE_THRESHOLD) {
        scaled++;
        details.push(`${dateKey} ${ticker}: p=${entry.p} → ${(entry.p / 100).toFixed(4)} (×÷100)`);
      } else if (entry.p < MIN_VALID_PRICE) {
        rejected++;
        details.push(`${dateKey} ${ticker}: p=${entry.p} (basura)`);
      }
      if (details.length >= 30) break;
    }
    if (details.length >= 30) break;
  }

  return { scaled, rejected, total, details };
}

/**
 * Load price history from localStorage
 * V1.8.3: Normalizes loaded data to 1.XXXX scale (auto-scales prices > 10).
 * Also scans for arbradar_backup_* keys and auto-merges their instrument data.
 */
export function loadPriceHistory(): PriceHistoryFile | null {
  let base: PriceHistoryFile | null = null;
  try {
    const stored = localStorage.getItem('arbradar_price_history');
    if (stored) {
      const parsed = JSON.parse(stored) as PriceHistoryFile;
      // V1.8.3: Normalize on load to ensure 1.XXXX scale
      const result = normalizePriceHistory(parsed);
      base = result.normalized;
    }
  } catch {
    // Parse error or unavailable
  }

  // Scan for backup keys matching arbradar_backup_*
  const backupKeys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('arbradar_backup_')) {
        backupKeys.push(key);
      }
    }
  } catch {
    // localStorage unavailable
  }

  if (backupKeys.length === 0) {
    // V1.8.3: Persist the normalized version
    if (base) {
      try {
        localStorage.setItem('arbradar_price_history', JSON.stringify(base));
      } catch { /* storage full */ }
    }
    return base;
  }

  // Merge each backup's instrument data into the price history
  for (const key of backupKeys) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const backup = JSON.parse(raw);
      const dateMatch = key.match(/arbradar_backup_(\d{4}-\d{2}-\d{2})/);
      if (!dateMatch) continue;
      const dateKey = dateMatch[1];
      if (!backup.instruments || !Array.isArray(backup.instruments)) continue;
      // V1.8.3: mergeInstrumentsIntoHistory now normalizes prices > 10
      base = mergeInstrumentsIntoHistory(base, backup.instruments, dateKey);
    } catch {
      // Skip invalid backup entries
    }
  }

  // Persist the merged result so next load is faster
  if (base) {
    try {
      localStorage.setItem('arbradar_price_history', JSON.stringify(base));
    } catch {
      // Storage full
    }
  }

  return base;
}

/**
 * Merge an array of instruments into the price history as a new date entry.
 *
 * V1.8.3 — ESCALA ÚNICA:
 * If an incoming price > SCALE_THRESHOLD (10), it's automatically divided
 * by 100 to normalize to the 1.XXXX scale (e.g., 116.15 → 1.1615).
 * Prices < MIN_VALID_PRICE (0.01) are rejected as garbage.
 *
 * V1.8.2 — INCREMENTAL MERGE (preserved):
 * If the date already exists, the system does NOT overwrite existing entries.
 * It only ADDS entries for tickers that don't yet exist for that date.
 *
 * If base is null, creates a new PriceHistoryFile.
 */
export function mergeInstrumentsIntoHistory(
  base: PriceHistoryFile | null,
  instruments: { ticker: string; type?: string; expiry?: string; price: number; tna?: number; tem?: number; tir?: number; dm?: number }[],
  dateKey: string
): PriceHistoryFile {
  if (!base) {
    base = {
      descripcion: 'Histórico de precios LECAP/BONCAP (auto-generado desde backups)',
      metadatos: {
        moneda: 'ARS',
        periodo: dateKey + ' en adelante',
        instrumentos_maestro: {},
      },
      historico: {},
    };
  }

  // Build the day's entries — V1.8.3: with scale normalization
  const dayEntries: Record<string, PriceHistoryEntry> = {};
  for (const inst of instruments) {
    if (!inst.ticker || !inst.price || inst.price <= 0) continue;

    // V1.8.3: Normalize price to 1.XXXX scale
    let price = inst.price;
    if (price > SCALE_THRESHOLD) {
      price = price / 100;
    }

    // Reject garbage prices (< 0.01)
    if (price < MIN_VALID_PRICE) continue;

    dayEntries[inst.ticker] = {
      p: price, // V1.8.3: Always stored in 1.XXXX scale (e.g., 1.1615)
      tna: inst.tna ?? inst.tem ?? inst.tir ?? 0,
      tem: inst.tem ?? inst.tir ?? 0,
      dm: inst.dm ?? 0,
    };

    // Also register in maestro if not present
    if (!base.metadatos.instrumentos_maestro[inst.ticker] && inst.type && inst.expiry) {
      base.metadatos.instrumentos_maestro[inst.ticker] = {
        vto: inst.expiry,
        tipo: inst.type,
      };
    }
  }

  // V1.8.2 — INCREMENTAL MERGE: If date exists, only add NEW tickers (don't overwrite)
  if (base.historico[dateKey]) {
    const existingDay = base.historico[dateKey];
    for (const [ticker, entry] of Object.entries(dayEntries)) {
      if (!(ticker in existingDay)) {
        existingDay[ticker] = entry;
      }
    }
  } else {
    base.historico[dateKey] = dayEntries;
  }

  return base;
}

/**
 * V1.8.3 — Incremental merge of a PriceHistoryFile into the existing base.
 * For each date in the incoming data:
 * - Prices > 10 are auto-divided by 100 (normalized to 1.XXXX)
 * - Prices < 0.01 are rejected as garbage
 * - If the date doesn't exist in base → add all entries (after normalization)
 * - If the date exists → only add tickers not yet present (never overwrite)
 */
export function mergePriceHistoryIncremental(
  base: PriceHistoryFile | null,
  incoming: PriceHistoryFile
): { merged: PriceHistoryFile; scaledCount: number; rejectedCount: number } {
  let scaledCount = 0;
  let rejectedCount = 0;

  if (!base) {
    // No existing history — normalize and use incoming as base
    const result = normalizePriceHistory(incoming);
    return { merged: result.normalized, scaledCount: result.scaledCount, rejectedCount: result.rejectedCount };
  }

  const merged = { ...base };
  const mergedHistorico = { ...base.historico };

  // Sort incoming dates to maintain order
  const incomingDates = Object.keys(incoming.historico).sort();

  for (const dateKey of incomingDates) {
    const incomingDay = incoming.historico[dateKey];

    if (!mergedHistorico[dateKey]) {
      // Date doesn't exist — add all normalized entries
      const normalizedDay: Record<string, PriceHistoryEntry> = {};
      for (const [ticker, entry] of Object.entries(incomingDay)) {
        const result = normalizePriceEntry(entry);
        if (result) {
          normalizedDay[ticker] = result.entry;
          if (result.wasScaled) scaledCount++;
        } else {
          rejectedCount++;
        }
      }
      if (Object.keys(normalizedDay).length > 0) {
        mergedHistorico[dateKey] = normalizedDay;
      }
    } else {
      // Date exists — only add tickers not yet present (incremental, no overwrite)
      const existingDay = { ...mergedHistorico[dateKey] };
      for (const [ticker, entry] of Object.entries(incomingDay)) {
        if (!(ticker in existingDay)) {
          const result = normalizePriceEntry(entry);
          if (result) {
            existingDay[ticker] = result.entry;
            if (result.wasScaled) scaledCount++;
          } else {
            rejectedCount++;
          }
        }
      }
      mergedHistorico[dateKey] = existingDay;
    }
  }

  merged.historico = mergedHistorico;

  // Also merge maestro entries
  const mergedMaestro = { ...merged.metadatos.instrumentos_maestro };
  for (const [ticker, info] of Object.entries(incoming.metadatos.instrumentos_maestro)) {
    if (!(ticker in mergedMaestro)) {
      mergedMaestro[ticker] = info;
    }
  }
  merged.metadatos = { ...merged.metadatos, instrumentos_maestro: mergedMaestro };

  return { merged, scaledCount, rejectedCount };
}

/**
 * Save price history to localStorage
 */
export function savePriceHistory(data: PriceHistoryFile): void {
  try {
    localStorage.setItem('arbradar_price_history', JSON.stringify(data));
  } catch {
    // Storage full or unavailable
  }
}

/**
 * V1.8.2 — Delete price history from localStorage.
 * Also removes backup keys to ensure clean state.
 */
export function clearPriceHistory(): void {
  try {
    localStorage.removeItem('arbradar_price_history');
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('arbradar_backup_')) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      localStorage.removeItem(key);
    }
  } catch {
    // localStorage unavailable
  }
}

/**
 * Enrich instruments with DM from price history
 * Returns a new array of instruments with the dm field populated
 */
export function enrichInstrumentsWithDM(
  instruments: Instrument[],
  priceHistory: PriceHistoryFile | null
): Instrument[] {
  if (!priceHistory) return instruments;

  return instruments.map(inst => {
    const dm = getLatestDM(priceHistory, inst.ticker);
    if (dm !== undefined) {
      return { ...inst, dm };
    }
    return inst;
  });
}
