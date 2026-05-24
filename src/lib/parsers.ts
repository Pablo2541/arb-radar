/**
 * V2.0.5 — Centralized Parsing Utilities
 *
 * These functions were duplicated between CarteraTab and HistorialTab.
 * Now they live in a single module to avoid inconsistencies when
 * processing data from localStorage or imported files.
 */

import { ExternalHistoryRecord } from './types';

// ════════════════════════════════════════════════════════════════════════
// CSV / TSV Parsing
// ════════════════════════════════════════════════════════════════════════

/**
 * Parse a single CSV/TSV line respecting quoted fields
 * Supports comma, semicolon, and tab as delimiters
 */
export function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if ((char === ',' || char === ';' || char === '\t') && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * Parse a number from string, handling Argentine/European format (1.234,56 → 1234.56)
 */
export function parseNumber(val: string): number {
  if (!val || val === '-' || val === '') return 0;
  const raw = val.replace(/\s/g, '');
  if (raw.includes(',')) {
    const normalized = raw.replace(/\./g, '').replace(',', '.');
    const num = parseFloat(normalized);
    return isNaN(num) ? 0 : num;
  }
  const num = parseFloat(raw);
  return isNaN(num) ? 0 : num;
}

// ════════════════════════════════════════════════════════════════════════
// Excel Date Helpers
// ════════════════════════════════════════════════════════════════════════

/**
 * Convert an Excel serial date number to DD/MM/YYYY string
 */
export function excelSerialToDate(serial: number): string {
  const epoch = new Date(1899, 11, 30);
  const date = new Date(epoch.getTime() + serial * 86400000);
  const day = date.getDate().toString().padStart(2, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

/**
 * Check if a number is likely an Excel date serial (range 40000-70000)
 */
export function isExcelDateSerial(val: number): boolean {
  return val > 40000 && val < 70000 && Number.isInteger(val);
}

// ════════════════════════════════════════════════════════════════════════
// Cell Value Converters (for XLSX import)
// ════════════════════════════════════════════════════════════════════════

/**
 * Convert a cell value to string, handling Excel date serials
 */
export function cellToString(val: unknown, isDateColumn: boolean = false): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return val.trim();
  if (typeof val === 'number') {
    if (isDateColumn && isExcelDateSerial(val)) {
      return excelSerialToDate(val);
    }
    return val.toString();
  }
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  if (val instanceof Date) {
    const day = val.getDate().toString().padStart(2, '0');
    const month = (val.getMonth() + 1).toString().padStart(2, '0');
    const year = val.getFullYear();
    return `${day}/${month}/${year}`;
  }
  return String(val).trim();
}

/**
 * Convert a cell value to number, handling string formats
 */
export function cellToNumber(val: unknown): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  if (typeof val === 'string') return parseNumber(val);
  return 0;
}

// ════════════════════════════════════════════════════════════════════════
// Sanitization (from HistorialTab — now centralized)
// ════════════════════════════════════════════════════════════════════════

/**
 * Clamp a number to reasonable bounds, returning 0 for NaN/Infinity
 */
export function sanitizeNumber(value: number, min: number = -1e9, max: number = 1e12): number {
  if (!isFinite(value)) return 0;
  if (isNaN(value)) return 0;
  return Math.max(min, Math.min(max, value));
}

/**
 * Sanitize an external history record — clamp unreasonable values
 */
export function sanitizeExternalRecord(rec: ExternalHistoryRecord): ExternalHistoryRecord {
  return {
    ...rec,
    tem: sanitizeNumber(rec.tem, -100, 100),
    precioConComision: sanitizeNumber(rec.precioConComision, 0, 10), // Bond prices ~0-10
    duration: sanitizeNumber(rec.duration, 0, 3650), // Duration in days, max 10 years
    capitalNeto: sanitizeNumber(rec.capitalNeto, -1e9, 1e12),
    gananciaAcumulada: sanitizeNumber(rec.gananciaAcumulada, -1e9, 1e12),
  };
}

// ════════════════════════════════════════════════════════════════════════
// XLSX Row Parsing
// ════════════════════════════════════════════════════════════════════════

/**
 * Parse XLSX rows (from sheet_to_json) into ExternalHistoryRecord[]
 * Uses smart header matching to find columns by name patterns
 */
export function parseXlsxRows(rows: Record<string, unknown>[], headers: string[]): ExternalHistoryRecord[] {
  const headerMap = new Map<string, number>();
  headers.forEach((h, idx) => {
    const normalized = h.toLowerCase().replace(/[^a-z0-9áéíóúñ_]/g, '');
    headerMap.set(normalized, idx);
  });

  const findCol = (patterns: string[]): number => {
    for (const [key, idx] of headerMap.entries()) {
      for (const p of patterns) {
        if (key.includes(p)) return idx;
      }
    }
    return -1;
  };

  const colFecha = findCol(['fecha', 'date']);
  const colTicker = findCol(['ticker', 'instrumento']);
  const colOperacion = findCol(['operacion', 'oper', 'tipo']);
  const colTEM = findCol(['tem']);
  const colPrecio = findCol(['precio', 'price']);
  const colDuration = findCol(['duration', 'duracion']);
  const colCapital = findCol(['capital', 'neto']);
  const colNotas = findCol(['nota', 'note', 'obs']);
  const colGanancia = findCol(['ganancia', 'acum', 'p&l', 'profit']);

  return rows.map(row => {
    const values = Object.values(row);
    const record: ExternalHistoryRecord = {
      fecha: colFecha >= 0 ? cellToString(values[colFecha], true) : (cellToString(values[0], true) || ''),
      ticker: colTicker >= 0 ? cellToString(values[colTicker]) : (cellToString(values[1]) || ''),
      operacion: colOperacion >= 0 ? cellToString(values[colOperacion]) : (cellToString(values[2]) || ''),
      tem: colTEM >= 0 ? cellToNumber(values[colTEM]) : (values[3] ? cellToNumber(values[3]) : 0),
      precioConComision: colPrecio >= 0 ? cellToNumber(values[colPrecio]) : (values[4] ? cellToNumber(values[4]) : 0),
      duration: colDuration >= 0 ? cellToNumber(values[colDuration]) : (values[5] ? cellToNumber(values[5]) : 0),
      capitalNeto: colCapital >= 0 ? cellToNumber(values[colCapital]) : (values[6] ? cellToNumber(values[6]) : 0),
      notas: colNotas >= 0 ? cellToString(values[colNotas]) : (values[7] ? cellToString(values[7]) : ''),
      gananciaAcumulada: colGanancia >= 0 ? cellToNumber(values[colGanancia]) : (values[8] ? cellToNumber(values[8]) : 0),
    };
    // V2.0.5: Sanitize every record via centralized module
    return sanitizeExternalRecord(record);
  }).filter(r => r.ticker || r.fecha);
}
