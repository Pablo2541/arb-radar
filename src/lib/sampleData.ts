import { Instrument, Config, Position, Transaction, SimulationRecord } from './types';

export const DEFAULT_CONFIG: Config = {
  caucion1d: 21.0,
  caucion7d: 19.2,
  caucion30d: 18.5,
  riesgoPais: 528,
  comisionTotal: 0.30,
  capitalDisponible: 467587.55, // V3.4.3: Current portfolio capital
};

export const DEFAULT_POSITION: Position | null = null; // V2.0.4: No default position — clean slate

export const SAMPLE_INSTRUMENTS: Instrument[] = [
  { ticker: 'S30A6', type: 'LECAP', expiry: '30/04/2026', days: 13, price: 1.2480, change: 0.08, tna: 21.5, tem: 1.77, tir: 1.77, gananciaDirecta: 1.95, vsPlazoFijo: '' },
  { ticker: 'S29Y6', type: 'LECAP', expiry: '29/05/2026', days: 42, price: 1.2670, change: -0.07, tna: 23.5, tem: 1.91, tir: 1.91, gananciaDirecta: 4.02, vsPlazoFijo: '' },
  { ticker: 'T30J6', type: 'BONCAP', expiry: '30/06/2026', days: 74, price: 1.3570, change: -0.25, tna: 25.2, tem: 2.03, tir: 2.03, gananciaDirecta: 6.49, vsPlazoFijo: '' },
  { ticker: 'S31L6', type: 'LECAP', expiry: '31/07/2026', days: 105, price: 1.0800, change: -0.36, tna: 24.8, tem: 1.98, tir: 1.98, gananciaDirecta: 8.80, vsPlazoFijo: '' },
  { ticker: 'S31G6', type: 'LECAP', expiry: '31/08/2026', days: 136, price: 1.1380, change: -0.22, tna: 26.0, tem: 2.04, tir: 2.04, gananciaDirecta: 11.23, vsPlazoFijo: '' },
  { ticker: 'S30O6', type: 'LECAP', expiry: '30/10/2026', days: 196, price: 1.1550, change: -0.43, tna: 28.0, tem: 2.15, tir: 2.15, gananciaDirecta: 16.95, vsPlazoFijo: '' },
  { ticker: 'S30N6', type: 'LECAP', expiry: '30/11/2026', days: 227, price: 1.0860, change: -0.45, tna: 29.1, tem: 2.21, tir: 2.21, gananciaDirecta: 19.42, vsPlazoFijo: '' },
  { ticker: 'T15E7', type: 'BONCAP', expiry: '15/01/2027', days: 273, price: 1.2935, change: -0.95, tna: 30.7, tem: 2.28, tir: 2.28, gananciaDirecta: 24.36, vsPlazoFijo: '' },
  { ticker: 'T30A7', type: 'BONCAP', expiry: '30/04/2027', days: 378, price: 1.1735, change: -0.71, tna: 31.3, tem: 2.24, tir: 2.24, gananciaDirecta: 33.88, vsPlazoFijo: '' },
  { ticker: 'T31Y7', type: 'BONCAP', expiry: '31/05/2027', days: 409, price: 1.1040, change: -0.94, tna: 31.8, tem: 2.25, tir: 2.25, gananciaDirecta: 37.08, vsPlazoFijo: '' },
  { ticker: 'T30J7', type: 'BONCAP', expiry: '30/06/2027', days: 439, price: 1.1200, change: -0.88, tna: 31.3, tem: 2.20, tir: 2.20, gananciaDirecta: 39.11, vsPlazoFijo: '' },
];

// V2.0.4: No ghost transactions — clean slate after nuke
export const INITIAL_TRANSACTIONS: Transaction[] = [];

// Storage keys
export const STORAGE_KEYS = {
  INSTRUMENTS: 'arbradar_instruments',
  CONFIG: 'arbradar_config',
  POSITION: 'arbradar_position',
  TRANSACTIONS: 'arbradar_transactions',
  SIMULATIONS: 'arbradar_simulations',
  LAST_UPDATE: 'arbradar_lastUpdate',
  RAW_INPUT: 'arbradar_rawInput',
  EXTERNAL_HISTORY: 'arbradar_external_history',
  SNAPSHOTS: 'arbradar_snapshots',
} as const;

export function saveToStorage<T>(key: string, data: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    // Storage full or unavailable
  }
}

export function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const stored = localStorage.getItem(key);
    if (stored) return JSON.parse(stored) as T;
  } catch {
    // Parse error or unavailable
  }
  return fallback;
}

/**
 * Parse raw text from acuantoesta.com.ar
 * Supports multiple formats:
 * 1. Vertical/tabular format (copy-paste from website table)
 * 2. Pipe-delimited format
 * 3. Concatenated acuantoesta format
 */
export function parseRawData(raw: string): Instrument[] {
  const lines = raw.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const instruments: Instrument[] = [];

  // Try to detect format
  const hasPipes = lines.some(l => l.includes('|') && l.split('|').length >= 8);
  if (hasPipes) {
    // Pipe-delimited format
    for (const line of lines) {
      try {
        const inst = parsePipeFormat(line);
        if (inst && validateInstrument(inst)) instruments.push(inst);
      } catch {
        // Skip lines that can't be parsed
      }
    }
    if (instruments.length > 0) return instruments;
  }

  // Try vertical tabular format (copy-paste from website)
  const verticalResult = parseVerticalFormat(lines);
  if (verticalResult.length > 0) return verticalResult.filter(validateInstrument);

  // Fallback: try line-by-line acuanto format
  for (const line of lines) {
    try {
      const inst = parseAcuantoFormat(line);
      if (inst && validateInstrument(inst)) instruments.push(inst);
    } catch {
      // Skip lines that can't be parsed
    }
  }

  return instruments;
}

/** Validate instrument data to prevent NaN/Infinity/corrupt values */
function validateInstrument(inst: Instrument): boolean {
  if (!inst.ticker || inst.ticker.trim().length === 0) return false;
  if (inst.type !== 'LECAP' && inst.type !== 'BONCAP') return false;
  if (!isFinite(inst.price) || inst.price <= 0) return false;
  if (!isFinite(inst.tem) || inst.tem < -50 || inst.tem > 200) return false;
  if (!isFinite(inst.tir) || inst.tir < -50 || inst.tir > 200) return false;
  if (!isFinite(inst.tna) || inst.tna < -50 || inst.tna > 500) return false;
  if (!isFinite(inst.days) || inst.days < 0 || inst.days > 3650) return false;
  if (!isFinite(inst.change)) inst.change = 0; // fixable
  return true;
}

/**
 * Parse vertical tabular format from acuantoesta.com.ar
 * When copy-pasting from the website table, each cell ends up on its own line.
 * Pattern per instrument:
 *   TICKER+TYPE (e.g. "S30A6LECAP" or "T30J6BONCAP")
 *   Vencimiento (DD/MM/YYYY)
 *   Días
 *   Precio (1,XXXX format with comma)
 *   Cambio% + other data on same line (tab-separated)
 *   ... more cells ...
 *   Last line with Ganancia directa% TNA% TEM% etc.
 */
function parseVerticalFormat(lines: string[]): Instrument[] {
  const instruments: Instrument[] = [];

  // Find all instrument start positions (lines matching S/T##X# pattern + LECAP/BONCAP suffix)
  const tickerPattern = /^([ST]\d+[A-Z]\d+)(LECAP|BONCAP)$/i;

  // First pass: identify instrument start positions
  const instrumentStarts: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(tickerPattern);
    if (match) {
      instrumentStarts.push(i);
    }
  }

  if (instrumentStarts.length === 0) return [];

  // Second pass: extract data for each instrument
  for (let idx = 0; idx < instrumentStarts.length; idx++) {
    const startLine = instrumentStarts[idx];
    const endLine = idx + 1 < instrumentStarts.length ? instrumentStarts[idx + 1] : lines.length;
    const block = lines.slice(startLine, endLine);

    try {
      const inst = parseVerticalBlock(block);
      if (inst) instruments.push(inst);
    } catch {
      // Skip blocks that can't be parsed
    }
  }

  return instruments;
}

/**
 * Parse a vertical block of lines for a single instrument
 * Block structure (from copy-paste of website table):
 *   Line 0: TICKERTYPE (e.g., "S30A6LECAP")
 *   Line 1: Vencimiento (DD/MM/YYYY)
 *   Line 2: Días
 *   Line 3: Precio (1,XXXX or 1.XXXX)
 *   Line 4+: Mixed data with Cambio%, Precio con comisión, etc.
 *   One of the later lines contains: Ganancia directa% TNA% TEM%
 */
function parseVerticalBlock(block: string[]): Instrument | null {
  if (block.length < 3) return null;

  // Line 0: Extract ticker and type
  const tickerMatch = block[0].match(/^([ST]\d+[A-Z]\d+)(LECAP|BONCAP)$/i);
  if (!tickerMatch) return null;
  const ticker = tickerMatch[1].toUpperCase();
  const type = tickerMatch[2].toUpperCase() as 'LECAP' | 'BONCAP';

  // Join all remaining lines to find patterns
  const joinedBlock = block.slice(1).join(' | ');

  // Extract expiry date
  const dateMatch = joinedBlock.match(/(\d{2}\/\d{2}\/\d{4})/);
  if (!dateMatch) return null;
  const expiry = dateMatch[1];

  // Extract days - look for a standalone number after the date line
  // The date line contains DD/MM/YYYY which can confuse parseInt, so we skip date-like lines
  let days = 0;
  for (let i = 1; i < Math.min(block.length, 6); i++) {
    const line = block[i];
    // Skip lines that look like dates
    if (/\d{2}\/\d{2}\/\d{4}/.test(line)) continue;
    // Skip lines with prices (contain commas or dots with 4 decimals)
    if (/\d[,]\d{4}/.test(line)) continue;
    // Try standalone number first
    const numMatch = line.match(/^(\d+)$/);
    if (numMatch) {
      const candidate = parseInt(numMatch[1], 10);
      if (candidate > 0 && candidate <= 1000) {
        days = candidate;
        break;
      }
    }
    // Also try tab-separated values, but skip any that look like dates
    const tabParts = line.split('\t').map(p => p.trim()).filter(p => p.length > 0);
    for (const part of tabParts) {
      if (/\d{2}\/\d{2}\/\d{4}/.test(part)) continue; // skip dates
      const partNum = parseInt(part, 10);
      if (!isNaN(partNum) && partNum > 0 && partNum <= 1000 && String(partNum) === part) {
        days = partNum;
        break;
      }
    }
    if (days > 0) break;
  }

  // Extract price - look for format 1,XXXX or 1.XXXX
  let price = 0;
  const pricePattern = /(\d[,]\d{4}|\d+[.]\d{4})/;
  for (let i = 1; i < Math.min(block.length, 6); i++) {
    const priceMatch = block[i].match(pricePattern);
    if (priceMatch) {
      price = parseFloat(priceMatch[1].replace(',', '.'));
      if (price > 0.5 && price < 10) break; // Reasonable price range for LECAP/BONCAP
      price = 0;
    }
  }

  // Extract all percentage values from the entire block
  const pctValues: number[] = [];
  const pctRegex = /([+-]?\d+[,.]?\d*)%/g;
  let pctMatch;
  const fullText = block.join(' ');
  while ((pctMatch = pctRegex.exec(fullText)) !== null) {
    const val = parseFloat(pctMatch[1].replace(',', '.'));
    if (!isNaN(val)) pctValues.push(val);
  }

  // Extract TEM and TNA from percentages
  let tem = 0;
  let tna = 0;
  let change = 0;
  let gananciaDirecta = 0;

  // Strategy: find TNA (range 8-45%) and TEM (range 0.3-5%) from the percentage values
  // The TEM is typically the last percentage that's in 0.3-5.0 range
  // TNA is typically just before TEM in 8-45% range

  const temCandidates: { value: number; index: number }[] = [];
  const tnaCandidates: { value: number; index: number }[] = [];

  for (let i = 0; i < pctValues.length; i++) {
    if (pctValues[i] >= 0.3 && pctValues[i] <= 6.0) {
      temCandidates.push({ value: pctValues[i], index: i });
    }
    if (pctValues[i] >= 8 && pctValues[i] <= 45) {
      tnaCandidates.push({ value: pctValues[i], index: i });
    }
  }

  // Take the last TEM candidate (usually the correct one, earlier ones might be "Cambio %")
  if (temCandidates.length > 0) {
    tem = temCandidates[temCandidates.length - 1].value;
  }

  // Take the last TNA candidate (before or near TEM)
  if (tnaCandidates.length > 0) {
    tna = tnaCandidates[tnaCandidates.length - 1].value;
  }

  // Find change (typically small % between -3 and +3, appears early in the data)
  for (const pv of pctValues) {
    if (Math.abs(pv) >= 0.01 && Math.abs(pv) <= 5 && pv !== tem && pv !== tna) {
      change = pv;
      break;
    }
  }

  // Find ganancia directa (positive, typically > 0.5%)
  for (const pv of pctValues) {
    if (pv > 0 && pv < 100 && pv !== tna && pv !== tem && Math.abs(pv) !== Math.abs(change)) {
      gananciaDirecta = pv;
      break;
    }
  }

  // If we couldn't find price, try from the full text
  if (price === 0) {
    const allPriceMatch = fullText.match(/(\d[,]\d{4})/);
    if (allPriceMatch) {
      price = parseFloat(allPriceMatch[1].replace(',', '.'));
    }
  }

  // V1.4.2 FIX: Recalculate days from expiry if still 0 (using hardcoded reference date)
  if (days === 0 && expiry) {
    const parts = expiry.split('/');
    if (parts.length === 3) {
      const expiryDate = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
      const now = new Date(); // V2.0.5 FIX: Dynamic date for accurate days calculation
      now.setHours(0, 0, 0, 0);
      days = Math.max(0, Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
    }
  }

  if (price === 0) price = 1;

  return {
    ticker,
    type,
    expiry,
    days,
    price,
    change,
    tna,
    tem,
    tir: tem,  // V1.4.2 FIX: TIR = TEM (broker doesn't provide TIR, only TEM)
    gananciaDirecta,
    vsPlazoFijo: '',
  };
}

function parsePipeFormat(line: string): Instrument | null {
  const parts = line.split('|').map(p => p.trim());
  if (parts.length < 9) return null;

  const ticker = parts[0];
  const type = parts[1] as 'LECAP' | 'BONCAP';
  const expiry = parts[2];
  const days = parseInt(parts[3], 10);
  const price = parseFloat(parts[4]);
  const change = parseFloat(parts[5]);
  const tna = parseFloat(parts[6]);
  const tem = parseFloat(parts[7]);
  const gananciaDirecta = parseFloat(parts[8]);

  if (!ticker || isNaN(days) || isNaN(price)) return null;

  return {
    ticker,
    type,
    expiry,
    days,
    price,
    change: isNaN(change) ? 0 : change,
    tna: isNaN(tna) ? 0 : tna,
    tem: isNaN(tem) ? 0 : tem,
    tir: isNaN(tem) ? 0 : tem,  // V1.4.2 FIX: tir = tem
    gananciaDirecta: isNaN(gananciaDirecta) ? 0 : gananciaDirecta,
    vsPlazoFijo: parts[9] || '',
  };
}

function parseAcuantoFormat(line: string): Instrument | null {
  // Format examples from acuantoesta.com.ar:
  // S17A6LECAP17/04/2026161,08950.1100,00000VNarecibirCantidad(VN)TotalarecibirGananciadirectaTNATEMPlazofijovsPlazofijo 0,00 +0.92% 21.07% 1.74% 0,00−
  // The data is concatenated - ticker+type+date+days+price followed by structured data

  // Step 1: Extract ticker (format: S30A6, T31Y7, etc.)
  const tickerMatch = line.match(/^([ST]\d+[A-Z]\d+)/);
  if (!tickerMatch) return null;
  const ticker = tickerMatch[1];

  // Step 2: Determine type (S=LECAP, T=BONCAP unless explicitly stated)
  const typeStr = line.includes('BONCAP') ? 'BONCAP' : 'LECAP';
  const type: 'LECAP' | 'BONCAP' = typeStr as 'LECAP' | 'BONCAP';

  // Step 3: Extract date (DD/MM/YYYY)
  const dateMatch = line.match(/(\d{2}\/\d{2}\/\d{4})/);
  if (!dateMatch) return null;
  const expiry = dateMatch[1];

  // Step 4: Extract days - number right after the date
  const afterDate = line.slice(line.indexOf(dateMatch[1]) + dateMatch[1].length);
  const daysMatch = afterDate.match(/^(\d+)/);
  const days = daysMatch ? parseInt(daysMatch[1], 10) : 0;

  // Step 5: Extract price - look for decimal number like 1,0895 or 1.2480
  // The price follows the days number and is usually in format X,XXXX or X.XXXX
  const pricePattern = afterDate.match(/(?:\d{1,2}[,]\d{4}|\d+\.\d{4})/);
  let price = 0;
  if (pricePattern) {
    price = parseFloat(pricePattern[0].replace(',', '.'));
  }

  // Step 6: Extract all percentage values from the line
  const pctValues: number[] = [];
  const pctRegex = /([+-]?\d+[,.]?\d*)%/g;
  let pctMatch;
  while ((pctMatch = pctRegex.exec(line)) !== null) {
    const val = parseFloat(pctMatch[1].replace(',', '.'));
    if (!isNaN(val)) pctValues.push(val);
  }

  // Step 7: Assign percentage values based on position
  // The format typically has: Ganancia Directa% TNA% TEM% vsPlazoFijo%
  // Or sometimes: change% ... TNA% TEM%
  let change = 0;
  let tna = 0;
  let tem = 0;
  let gananciaDirecta = 0;

  if (pctValues.length >= 3) {
    // Look for TNA (should be 18-40 range) and TEM (should be 1.5-3.0 range)
    for (let i = pctValues.length - 1; i >= 1; i--) {
      if (pctValues[i] >= 1.0 && pctValues[i] <= 5.0 && tem === 0) {
        tem = pctValues[i];
        if (i > 0 && pctValues[i - 1] >= 15 && pctValues[i - 1] <= 45) {
          tna = pctValues[i - 1];
        }
      }
    }
    // The first positive percentage is usually ganancia directa
    for (let i = 0; i < pctValues.length; i++) {
      if (pctValues[i] > 0 && pctValues[i] < 100 && pctValues[i] !== tna && pctValues[i] !== tem) {
        gananciaDirecta = pctValues[i];
        break;
      }
    }
  }

  // Step 8: Extract change (look for +X.XX% or -X.XX% pattern specifically for daily change)
  const changeMatch = line.match(/([+-]\d+[,.]?\d*)%/);
  if (changeMatch) {
    const val = parseFloat(changeMatch[1].replace(',', '.'));
    // Daily change is typically between -2% and +2%
    if (Math.abs(val) < 5 && val !== gananciaDirecta && val !== tna && val !== tem) {
      change = val;
    }
  }

  // V1.4.2 FIX: Only use fallback TEM calculation if TEM wasn't found from broker data
  // The TEM (Column 14) is sacred — never overwrite it with a zero from failed validation
  if (tem === 0 && tna === 0 && price > 0 && days > 0) {
    // Rescue value is typically 1.41 for LECAPs, varies for BONCAPs
    const rescueValue = type === 'LECAP' ? 1.41 : price * 1.3; // rough estimate
    tem = ((rescueValue / price) - 1) * (30 / days) * 100;
    tna = tem * 12; // approximate
  }

  if (price === 0) price = 1; // fallback

  return {
    ticker,
    type,
    expiry,
    days,
    price,
    change,
    tna,
    tem,
    tir: tem,  // V1.4.2 FIX: TIR = TEM (broker doesn't provide TIR, only TEM)
    gananciaDirecta,
    vsPlazoFijo: '',
  };
}
