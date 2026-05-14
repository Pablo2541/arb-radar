/**
 * ARB//RADAR V3.2.3-PRO — Regla de Absorción Dinámica
 *
 * Detects "walls" in the order book (ask orders 5x average volume)
 * and triggers "Fuerza Compradora Inminente" alerts when buy volume
 * absorbs >30% of the wall in <5 minutes.
 *
 * Priority: High-rate instruments like T15E7 (Boncap)
 */

export interface AbsorptionAlert {
  ticker: string;
  wallSize: number;           // Total ask depth that forms the wall
  wallAvgMultiple: number;    // How many times the average (must be >= 5x)
  absorbedPct: number;        // % of wall absorbed by buy side (must be >= 30%)
  bidDepth: number;           // Current bid depth
  askDepth: number;           // Current ask depth
  marketPressure: number;     // bid/ask ratio
  alertType: 'WALL_DETECTED' | 'ABSORPTION_IMMINENT' | 'ABSORPTION_COMPLETE';
  alertMessage: string;
  priority: boolean;          // True for high-rate instruments (T15E7, etc.)
  timestamp: string;
}

export interface AbsorptionInput {
  ticker: string;
  bidDepth: number;
  askDepth: number;
  marketPressure: number;
  puntasCompra: Array<{ cantidad: number; precio: number }>;
  puntasVenta: Array<{ cantidad: number; precio: number }>;
  avgAskDepth15min: number;  // Rolling 15-min average of ask depth
  instrumentType: 'LECAP' | 'BONCAP';
  tem: number;                // Current TEM for priority determination
}

// High-priority tickers for arbitrage
const HIGH_PRIORITY_TICKERS = ['T15E7', 'T30J7', 'T5W3', 'S1L5'];
const HIGH_TEM_THRESHOLD = 1.8; // TEM > 1.8% = high priority (was 2.0)

const WALL_MULTIPLE_THRESHOLD = 5;   // Ask depth >= 5x average = wall
const ABSORPTION_PCT_THRESHOLD = 30; // 30% absorbed = trigger
const WALL_AVG_WINDOW_MIN = 15;      // 15-minute rolling average

export function detectAbsorption(input: AbsorptionInput): AbsorptionAlert | null {
  const { ticker, bidDepth, askDepth, marketPressure, avgAskDepth15min, tem } = input;

  // Determine priority
  const isPriority = HIGH_PRIORITY_TICKERS.includes(ticker) || tem >= HIGH_TEM_THRESHOLD;

  // V3.2.3-PRO: Auto-detect BONCAP instruments (T-prefixed tickers = Bonos Capitalizables)
  const isBoncap = /^T\d+[A-Z]\d+$/i.test(ticker);
  const isHighRateBoncap = isBoncap && tem >= 1.8;
  const isHighPriority = isPriority || isHighRateBoncap;

  // No wall if no average data
  if (!avgAskDepth15min || avgAskDepth15min <= 0) return null;

  const wallMultiple = askDepth / avgAskDepth15min;

  // Step 1: Is there a wall?
  if (wallMultiple < WALL_MULTIPLE_THRESHOLD) return null;

  // Step 2: Calculate absorption percentage
  const absorbedPct = askDepth > 0 ? (bidDepth / askDepth) * 100 : 0;

  // Step 3: Determine alert type
  let alertType: AbsorptionAlert['alertType'];
  let alertMessage: string;

  if (absorbedPct >= ABSORPTION_PCT_THRESHOLD && marketPressure > 1.5) {
    alertType = 'ABSORPTION_IMMINENT';
    alertMessage = `🚨 FUERZA COMPRADORA INMINENTE — ${ticker}: Compra absorbe ${absorbedPct.toFixed(1)}% de pared vendedora (${wallMultiple.toFixed(1)}x promedio). Presión: ${marketPressure.toFixed(2)}`;
  } else if (marketPressure > 3.0 && absorbedPct >= 50) {
    alertType = 'ABSORPTION_COMPLETE';
    alertMessage = `✅ ABSORCIÓN COMPLETA — ${ticker}: Pared vendedora limpiable. Presión compradora ${marketPressure.toFixed(2)}x. Potencial salto de precio.`;
  } else {
    alertType = 'WALL_DETECTED';
    alertMessage = `🧱 PARED DETECTADA — ${ticker}: Ask depth ${wallMultiple.toFixed(1)}x del promedio (${askDepth.toLocaleString()} vs ${avgAskDepth15min.toLocaleString()} avg). Absorción: ${absorbedPct.toFixed(1)}%`;
  }

  // Add priority note for high-rate instruments
  if (isHighPriority) {
    alertMessage += ` ⚡ PRIORIDAD ALTA — Capturar salto de precio pre-limpieza`;
  }

  return {
    ticker,
    wallSize: askDepth,
    wallAvgMultiple: parseFloat(wallMultiple.toFixed(1)),
    absorbedPct: parseFloat(absorbedPct.toFixed(1)),
    bidDepth,
    askDepth,
    marketPressure,
    alertType,
    alertMessage,
    priority: isHighPriority,
    timestamp: new Date().toISOString(),
  };
}

/**
 * V3.2.3-PRO: Quick check if a ticker should be highlighted as high-priority
 * for the "Caza de Oportunidades" module.
 */
export function isHighPriorityTicker(ticker: string, tem: number): boolean {
  const isNamedPriority = HIGH_PRIORITY_TICKERS.includes(ticker);
  const isHighTEM = tem >= HIGH_TEM_THRESHOLD;
  const isBoncap = /^T\d+[A-Z]\d+$/i.test(ticker);
  const isHighRateBoncap = isBoncap && tem >= 1.8;
  return isNamedPriority || isHighTEM || isHighRateBoncap;
}

/**
 * Calculate rolling average ask depth from historical snapshots
 */
export function calculateRollingAvgAskDepth(
  snapshots: Array<{ askDepth: number; timestamp: Date }>,
  windowMinutes: number = WALL_AVG_WINDOW_MIN
): number {
  const cutoff = new Date(Date.now() - windowMinutes * 60 * 1000);
  const recent = snapshots.filter(s => s.timestamp >= cutoff);
  if (recent.length === 0) return 0;
  return recent.reduce((sum, s) => sum + s.askDepth, 0) / recent.length;
}
