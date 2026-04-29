import { Instrument, Config, Position, RotationAnalysis, SwingSignal, CurveAnomaly, CompositeSignal, DiagnosticResult, Snapshot, MomentumData, RotationScoreV17 } from './types';

/**
 * Calculate days remaining to expiry from an expiry date string (DD/MM/YYYY)
 */
export function daysFromExpiry(expiry: string): number {
  if (!expiry || typeof expiry !== 'string') return 0;
  const parts = expiry.split('/');
  if (parts.length !== 3) return 0;
  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const year = parseInt(parts[2], 10);
  if (isNaN(day) || isNaN(month) || isNaN(year)) return 0;
  if (year < 2000 || year > 2100) return 0;
  const expiryDate = new Date(year, month, day);
  // V2.0.5 FIX: Dynamic date — always use current system date for live trading accuracy
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  expiryDate.setHours(0, 0, 0, 0);
  const diff = Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  return Math.max(0, diff);
}

/**
 * Ensure instrument has valid days (recalculate from expiry only if days=0)
 * We preserve the original days value from the data source since it may be more
 * accurate (e.g., "days to maturity at next business day" vs our simple date diff).
 */
export function ensureValidDays(instruments: Instrument[]): Instrument[] {
  return instruments.map(inst => {
    // V1.4.3 FIX: ALWAYS set tir = tem (TEM is source of truth from broker)
    const effectiveRate = inst.tem || inst.tir || 0;
    const protectedTEM = effectiveRate;
    const protectedTIR = effectiveRate;  // tir always equals tem

    if (inst.days <= 0 && inst.expiry) {
      const calculatedDays = daysFromExpiry(inst.expiry);
      if (calculatedDays > 0) {
        return { ...inst, days: calculatedDays, tem: protectedTEM, tir: protectedTIR };
      }
    }
    return { ...inst, tem: protectedTEM, tir: protectedTIR };
  });
}

/**
 * Caución TEM from TNA — Conversión de tasa anual a tasa mensual efectiva
 *
 * FÓRMULA:
 *   TEM = ((1 + TNA/100)^(1/12) − 1) × 100
 *
 * EJEMPLO: TNA caución 7d = 19.2%
 *   TEM = ((1 + 0.192)^(1/12) − 1) × 100
 *   TEM = (1.192^(0.0833) − 1) × 100
 *   TEM = (1.01478 − 1) × 100
 *   TEM = 1.478%
 *
 * INTERPRETACIÓN: Una caución a TNA 19.2% rinde 1.478% TEM efectivo.
 * Si un LECAP rinde 1.91% TEM, el spread es +0.43% (ATRACTIVO).
 */
export function caucionTEMFromTNA(tna: number): number {
  return (Math.pow(1 + tna / 100, 1 / 12) - 1) * 100;
}

/**
 * Caución TEM para una cantidad de días específica (aproximación anualizada)
 *
 * FÓRMULA:
 *   TEM = ((1 + TNA/100)^(days/365) − 1) × (30/days) × 100
 *
 * Esta función calcula el rendimiento efectivo mensual equivalente para
 * una caución de N días. Primero calcula el rendimiento total del período
 * y luego lo annualiza a base 30 días.
 *
 * EJEMPLO: TNA = 19.2%, días = 7
 *   Rendimiento total = (1.192)^(7/365) − 1 = 0.003666 = 0.3666%
 *   TEM equivalente = 0.3666% × (30/7) = 0.3666% × 4.286 = 1.571%
 *
 * Si days ≤ 0, se usa la fórmula estándar mensual.
 */
export function caucionTEMForDays(tna: number, days: number): number {
  if (days <= 0) return caucionTEMFromTNA(tna);
  return (Math.pow(1 + tna / 100, days / 365) - 1) * (30 / days) * 100;
}

/**
 * Get the appropriate caución TNA based on days — V2.0.5: Linear interpolation
 *
 * Instead of step-function jumps (≤7d→1d, 8-45d→7d, >45d→30d),
 * we now linearly interpolate TNA between the tramos, producing
 * a smooth curve that makes the Hunting Score more refined.
 *
 * Tramos: 1d @ caucion1d, 7d @ caucion7d, 30d @ caucion30d
 * For days < 1: use caucion1d
 * For days > 30: use caucion30d
 * For days in between: linearly interpolate between the two nearest tramos
 *
 * EJEMPLO: days=15 (between 7d@19.2% and 30d@18.5%)
 *   weight = (15 - 7) / (30 - 7) = 8/23 = 0.348
 *   TNA = 19.2 + (18.5 - 19.2) × 0.348 = 19.2 - 0.243 = 18.96%
 *   → Smooth transition, no abrupt jumps
 */
export function getCaucionForDays(config: Config, days: number): number {
  const t1 = 1,  tna1 = config.caucion1d;
  const t7 = 7,  tna7 = config.caucion7d;
  const t30 = 30, tna30 = config.caucion30d;

  if (days <= t1) return tna1;
  if (days <= t7) {
    // Interpolate between 1d and 7d
    const weight = (days - t1) / (t7 - t1);
    return tna1 + (tna7 - tna1) * weight;
  }
  if (days <= t30) {
    // Interpolate between 7d and 30d
    const weight = (days - t7) / (t30 - t7);
    return tna7 + (tna30 - tna7) * weight;
  }
  return tna30;
}

/**
 * Spread vs Caución — Diferencial de rendimiento vs alternativa libre de riesgo
 *
 * CONCEPTO: Mide cuánto rinde DE MÁS un instrumento vs dejar el dinero en caución.
 * El spread es la prima por riesgo que el inversor cobra por asumir riesgo de
 * crédito soberano y de liquidez.
 *
 * FÓRMULA:
 *   spread = TEM instrumento − TEM caución equivalente
 *
 * PASO 1: Seleccionar caución interpolada según plazo (V2.0.5: interpolación lineal)
 *   Tramos: 1d, 7d, 30d → interpolación suave entre tramos vecinos
 *
 * PASO 2: Convertir TNA caución a TEM
 *   cauciónTEM = ((1 + TNA/100)^(1/12) − 1) × 100
 *
 * PASO 3: Calcular spread
 *   spread = TEM − cauciónTEM
 *
 * EJEMPLO: LECAP S30O6, TEM = 2.15%, días = 196
 *   Caución 30d TNA = 18.5% → TEM = 1.43%
 *   Spread = 2.15% − 1.43% = +0.72% → MUY ATRACTIVO
 */
export function spreadVsCaucion(tem: number, config: Config, days: number): number {
  const caucionTNA = getCaucionForDays(config, days);
  const caucionTEM = caucionTEMFromTNA(caucionTNA);
  return tem - caucionTEM;
}

/**
 * Signal based on spread vs caución
 */
export function getSpreadSignal(spread: number): { label: string; color: string; emoji: string } {
  if (spread > 0.40) return { label: 'MUY ATRACTIVO', color: '#00d4aa', emoji: '🟢' };
  if (spread > 0.25) return { label: 'ATRACTIVO', color: '#00d4aa', emoji: '🟢' };
  if (spread > 0.10) return { label: 'MARGINAL', color: '#ffd700', emoji: '🟡' };
  return { label: 'EVITAR', color: '#ff4444', emoji: '🔴' };
}

/**
 * Duración Modificada — Sensibilidad del precio a cambios en la tasa
 *
 * FÓRMULA:
 *   durMod = −días / (365 × (1 + TEM/100))
 *
 * CONCEPTO: La duración modificada indica cuánto cambia el precio (%)
 * por cada 1% (100pb) de cambio en la tasa. Es SIEMPRE negativa
 * porque cuando las tasas suben, los precios bajan.
 *
 * EJEMPLO: LECAP S30O6, días = 196, TEM = 2.15%
 *   durMod = −196 / (365 × 1.0215) = −196 / 372.85 = −0.5257
 *   → Por cada 1% de suba en TEM, el precio baja ~0.53%
 *   → Por cada 10pb de suba, el precio baja ~0.053%
 *
 * INTERPRETACIÓN PRÁCTICA:
 *   |durMod| > 0.5 → Alta sensibilidad (instrumento largo)
 *   |durMod| < 0.2 → Baja sensibilidad (instrumento corto)
 */
export function durationMod(days: number, tem: number): number {
  if (days <= 0) return 0;
  return -days / (365 * (1 + tem / 100));
}

/**
 * Sensibilidad de Precio — Cambio de precio ante un movimiento de tasas
 *
 * FÓRMULA:
 *   deltaPrice = −durMod × deltaRate (decimal) × price
 *   donde deltaRate = deltaRateBps / 10000
 *
 * CONCEPTO: Dado un movimiento de N basis points en la tasa,
 * calcula cuánto cambia el precio del instrumento.
 *
 * EJEMPLO: LECAP S30O6, price = $1.155, durMod = −0.5257
 *   Suba de 25pb (TEM +0.25%):
 *     deltaRate = 25/10000 = 0.0025
 *     deltaPrice = −(−0.5257) × 0.0025 × $1.155 = +$0.00152 → nuevo precio $1.1565
 *   Baja de 25pb (TEM −0.25%):
 *     deltaPrice = −(−0.5257) × (−0.0025) × $1.155 = −$0.00152 → nuevo precio $1.1535
 *
 * NOTA: El signo negativo en −durMod se cancela con el signo negativo de durMod,
 * dando un resultado positivo cuando las tasas bajan (los precios suben).
 */
export function priceSensitivity(price: number, durMod: number, deltaRateBps: number): number {
  const deltaRate = deltaRateBps / 10000; // convertir basis points a decimal
  return -durMod * deltaRate * price;
}

/**
 * Análisis de Rotación — Evaluación de conveniencia de cambiar de instrumento
 *
 * CONCEPTO: Determina si conviene rotar de un instrumento A a otro B
 * comparando el spread de tasas contra el costo de comisión.
 *
 * PASO 1 — Spread Bruto:
 *   spreadBruto = TEM destino − TEM actual
 *   Ejemplo: 2.24% − 2.15% = +0.09% TEM
 *
 * PASO 2 — Comisión Amortizada (costo de rotación en % TEM mensual):
 *   comisionAmortizada = comisionTotal / (díasDestino / 30)
 *   Ejemplo: 0.30% / (273/30) = 0.30% / 9.1 = 0.033% TEM
 *   → En un instrumento de 273 días, la comisión se "amortiza" a 0.033%/mes
 *
 * PASO 3 — Spread Neto (ganancia real después de comisión):
 *   spreadNeto = spreadBruto − comisionAmortizada
 *   Ejemplo: 0.09% − 0.033% = 0.057% TEM neto
 *
 * PASO 4 — Días de Punto de Equilibrio (Payback):
 *   diasPE = (comisionTotal / |spreadBruto|) × 30
 *   Ejemplo: (0.30 / 0.09) × 30 = 100 días
 *   → Toma 100 días de mayor carry para cubrir la comisión
 *
 * PASO 5 — Evaluación:
 *   V1.5: If toTEM < fromTEM → TRAMPA (rotational trap)
 *   spreadNeto > 0.25% → MUY ATRACTIVO (rotar de inmediato)
 *   spreadNeto > 0.15% → ATRACTIVO (rotar con confianza)
 *   spreadNeto > 0.05% → MARGINAL (rotar solo si hay convicción)
 *   spreadNeto ≤ 0.05% → NO CONVIENE (la comisión come la ganancia)
 */
export function analyzeRotation(
  currentTEM: number,
  currentDays: number,
  targetInstrument: Instrument,
  comisionTotal: number
): RotationAnalysis {
  const spreadBruto = targetInstrument.tem - currentTEM;
  const comisionAmortizada = comisionTotal / (targetInstrument.days / 30);
  const spreadNeto = spreadBruto - comisionAmortizada;
  const diasPE = spreadBruto !== 0 ? (comisionTotal / Math.abs(spreadBruto)) * 30 : Infinity;

  let evaluacion: RotationAnalysis['evaluacion'];

  // V1.5: TRAMPA detection — when rotating to a LOWER yield instrument
  // This identifies rotational traps where you'd move to a lower yield
  if (targetInstrument.tem < currentTEM) {
    evaluacion = 'TRAMPA';
  } else if (spreadNeto > 0.25) {
    evaluacion = 'MUY ATRACTIVO';
  } else if (spreadNeto > 0.15) {
    evaluacion = 'ATRACTIVO';
  } else if (spreadNeto > 0.05) {
    evaluacion = 'MARGINAL';
  } else {
    evaluacion = 'NO CONVIENE';
  }

  return {
    fromTicker: '',
    toTicker: targetInstrument.ticker,
    fromTEM: currentTEM,
    toTEM: targetInstrument.tem,
    spreadBruto,
    comisionAmortizada,
    spreadNeto,
    diasPE: Math.abs(diasPE),
    toDays: targetInstrument.days,
    evaluacion,
  };
}

/**
 * Detect curve inversions (longer-term instrument with lower TEM)
 */
export function detectInversions(instruments: Instrument[]): { longer: Instrument; shorter: Instrument; temDiff: number }[] {
  const inversions: { longer: Instrument; shorter: Instrument; temDiff: number }[] = [];
  for (let i = 0; i < instruments.length; i++) {
    for (let j = i + 1; j < instruments.length; j++) {
      if (instruments[i].type === instruments[j].type) {
        const longer = instruments[i].days > instruments[j].days ? instruments[i] : instruments[j];
        const shorter = instruments[i].days > instruments[j].days ? instruments[j] : instruments[i];
        if (longer.tem < shorter.tem) {
          inversions.push({ longer, shorter, temDiff: shorter.tem - longer.tem });
        }
      }
    }
  }
  return inversions;
}

/**
 * Calculate swing trading signal for an instrument
 */
export function calculateSwingSignal(
  instrument: Instrument,
  config: Config,
  allInstruments: Instrument[]
): SwingSignal {
  const durMod = durationMod(instrument.days, instrument.tem);
  const pMinus10 = instrument.price + priceSensitivity(instrument.price, durMod, -10);
  const pMinus25 = instrument.price + priceSensitivity(instrument.price, durMod, -25);
  const pPlus10 = instrument.price + priceSensitivity(instrument.price, durMod, 10);
  const pPlus25 = instrument.price + priceSensitivity(instrument.price, durMod, 25);

  // Momentum score (based on daily change %)
  // Map change from [-1%, +1%] to [0, 10]
  const momentumScore = Math.max(0, Math.min(10, (instrument.change + 1) * 5));

  // Spread score
  const spread = spreadVsCaucion(instrument.tem, config, instrument.days);
  // Map spread from [-1%, +2%] to [0, 10]
  const spreadScore = Math.max(0, Math.min(10, (spread + 1) * (10 / 3)));

  // Sensitivity score (higher duration = higher potential)
  const maxDur = Math.max(...allInstruments.map(i => Math.abs(durationMod(i.days, i.tem))));
  const sensitivityScore = maxDur > 0 ? (Math.abs(durMod) / maxDur) * 10 : 0;

  // Liquidity score (shorter = more liquid)
  const maxDays = Math.max(...allInstruments.map(i => i.days));
  const liquidityScore = maxDays > 0 ? (1 - instrument.days / maxDays) * 10 : 5;

  // Composite score (weighted)
  const compositeScore =
    momentumScore * 0.20 +
    spreadScore * 0.30 +
    sensitivityScore * 0.25 +
    liquidityScore * 0.25;

  let signal: SwingSignal['signal'];
  if (compositeScore >= 7.0) signal = 'BUY STRONG';
  else if (compositeScore >= 5.0) signal = 'BUY MODERATE';
  else if (compositeScore >= 3.0) signal = 'NEUTRAL';
  else signal = 'SELL/AVOID';

  return {
    ticker: instrument.ticker,
    type: instrument.type,
    durationMod: durMod,
    priceMinus10bps: pMinus10,
    priceMinus25bps: pMinus25,
    pricePlus10bps: pPlus10,
    pricePlus25bps: pPlus25,
    momentumScore,
    spreadScore,
    sensitivityScore,
    liquidityScore,
    compositeScore,
    signal,
  };
}

/**
 * RAE (Rendimiento Anual Efectivo) - from ganancia neta
 */
export function calculateRAEFromPnL(gananciaNeta: number, diasHolding: number): number {
  return Math.pow(1 + gananciaNeta, 365 / diasHolding) - 1;
}

/**
 * P&L para posición actual — Cálculo paso a paso
 *
 * CONCEPTO: Determina la ganancia/pérdida de una posición abierta.
 * Utiliza lógica UNIDIRECCIONAL de comisión: la comisión de entrada ya está
 * incluida en el costo (ya sea via precioConComision del broker o calculada),
 * y la comisión de salida se descuenta del valor actual.
 *
 * PASO 1 — Valor Actual (mark-to-market):
 *   currentValue = VN × precioActual
 *   Ejemplo: 373,700 VN × $1.155 = $431,623.50
 *
 * PASO 2 — Comisión de Salida (0.15% del valor actual):
 *   commissionSell = currentValue × (comisionTotal / 2 / 100)
 *   Ejemplo: $431,623.50 × 0.0015 = $647.44
 *
 * PASO 3 — Valor After Commission:
 *   currentValueAfterCommission = currentValue − commissionSell
 *   Ejemplo: $431,623.50 − $647.44 = $430,976.06
 *
 * PASO 4 — Costo de Entrada (LÓGICA UNIDIRECCIONAL):
 *   Si precioConComision existe (dato del broker):
 *     costWithCommission = VN × precioConComision
 *     → La comisión YA está incluida en el precio del broker
 *   Si no:
 *     costWithCommission = VN × entryPrice × (1 + comisionTotal/2/100)
 *     → Se agrega 0.15% de comisión de entrada al costo
 *   Ejemplo (sin precioConComision):
 *     373,700 × $1.1616 × 1.0015 = 373,700 × $1.16334 = $434,614.37
 *
 * PASO 5 — P&L Neto:
 *   pnl = currentValueAfterCommission − costWithCommission
 *   Ejemplo: $430,976.06 − $434,614.37 = −$3,638.31
 *
 * PASO 6 — P&L Porcentual:
 *   pnlPct = (pnl / costWithCommission) × 100
 *   Ejemplo: (−3,638.31 / 434,614.37) × 100 = −0.84%
 */
export function calculatePnL(position: Position, currentPrice: number, comisionTotal: number): {
  capitalInvested: number;
  currentValue: number;
  currentValueAfterCommission: number;
  pnl: number;
  pnlPct: number;
} {
  // PASO 1: Valor actual de mercado
  const currentValue = position.vn * currentPrice;

  // PASO 2: Comisión de salida (0.15% = comisionTotal/2)
  const commissionSell = currentValue * (comisionTotal / 2 / 100);

  // PASO 3: Valor neto tras comisión de salida
  const currentValueAfterCommission = currentValue - commissionSell;

  // PASO 4: Costo de entrada (lógica unidireccional)
  // Si el broker proporcionó precioConComision, la comisión ya está incluida
  // Si no, se calcula agregando 0.15% de comisión de entrada
  const costWithCommission = position.precioConComision
    ? position.vn * position.precioConComision
    : (position.vn * position.entryPrice) * (1 + comisionTotal / 2 / 100);

  const capitalInvested = position.precioConComision
    ? position.vn * position.precioConComision
    : position.vn * position.entryPrice;

  // PASO 5: P&L neto (valor de liquidación − costo de entrada)
  const pnl = currentValueAfterCommission - costWithCommission;

  // PASO 6: P&L porcentual
  const pnlPct = (pnl / costWithCommission) * 100;

  return { capitalInvested, currentValue, currentValueAfterCommission, pnl, pnlPct };
}

/**
 * P&L Escenario — Ganancia/pérdida proyectada ante un movimiento de tasas
 *
 * CONCEPTO: Calcula el P&L que resultaría de un movimiento de N basis points
 * en la tasa del instrumento. Usa la duración modificada para estimar
 * el nuevo precio y luego calcula el P&L con la misma lógica unidireccional.
 *
 * PASO 1 — Nuevo precio estimado:
 *   durMod = −days / (365 × (1 + TEM/100))
 *   priceChange = −durMod × (deltaBps/10000) × price
 *   newPrice = price + priceChange
 *
 * PASO 2 — Nuevo valor de posición:
 *   newValue = VN × newPrice
 *
 * PASO 3 — Comisión de salida proyectada:
 *   commissionSell = newValue × 0.0015
 *
 * PASO 4 — Costo de entrada (lógica unidireccional, igual que calculatePnL):
 *   Si precioConComision: VN × precioConComision
 *   Si no: VN × entryPrice × 1.0015
 *
 * PASO 5 — P&L del escenario:
 *   pnl = (newValue − commissionSell) − costWithCommission
 *   pnlPct = (pnl / costWithCommission) × 100
 */
export function scenarioPnL(
  position: Position,
  instrument: Instrument,
  deltaBps: number,
  comisionTotal: number
): { newPrice: number; pnl: number; pnlPct: number } {
  const durMod = durationMod(instrument.days, instrument.tem);
  const priceChange = priceSensitivity(instrument.price, durMod, deltaBps);
  const newPrice = instrument.price + priceChange;

  const newValue = position.vn * newPrice;
  const commissionSell = newValue * (comisionTotal / 2 / 100);

  // Unidirectional commission: if entry had precioConComision, commission is already in the price
  const costWithCommission = position.precioConComision
    ? position.vn * position.precioConComision
    : (position.vn * position.entryPrice) * (1 + comisionTotal / 2 / 100);

  const pnl = (newValue - commissionSell) - costWithCommission;
  const pnlPct = (pnl / costWithCommission) * 100;

  return { newPrice, pnl, pnlPct };
}

// ============================================================
// NEW FUNCTIONS
// ============================================================

/**
 * G/día neta (after commission)
 * How much % gain per day after accounting for round-trip commission
 * gDiaNeta = ((1 + TEM/100)^(days/30.44) - 1 - comisionRT) / days * 100
 * Returns the daily net percentage gain. Can be negative if commission exceeds yield.
 */
export function gDiaNeta(tem: number, days: number, comisionTotal: number): number {
  if (days <= 0 || tem <= 0) return 0;
  if (!isFinite(days) || !isFinite(tem) || !isFinite(comisionTotal)) return 0;
  const totalReturn = Math.pow(1 + tem / 100, days / 30.44) - 1;
  const netReturn = totalReturn - comisionTotal / 100;
  const result = (netReturn / days) * 100;
  if (!isFinite(result)) return 0;
  return result;
}

/**
 * Días de recupero de comisión
 * How many days to recover the round-trip commission cost
 */
export function diasRecuperoComision(tem: number, comisionTotal: number): number {
  if (tem <= 0 || !isFinite(tem) || !isFinite(comisionTotal)) return 999;
  const dailyReturn = (tem / 100) / 30.44; // daily return in decimal
  if (dailyReturn <= 0) return 999;
  const result = (comisionTotal / 100) / dailyReturn;
  if (!isFinite(result)) return 999;
  return result;
}

/**
 * RAE - Rendimiento Anual Efectivo from TEM
 */
export function calculateRAE(tem: number): number {
  return (Math.pow(1 + tem / 100, 12) - 1) * 100;
}

/**
 * Detect curve anomalies — hybrid approach:
 * - INVERSION: ALWAYS flagged when longer-dated instrument has LOWER TEM (logical rule, prevails over σ)
 * - APLANAMIENTO: segment slope is anomalously flat (deviates >2σ below expected slope from regression)
 * - SALTO_ANORMAL: positive rate gap deviating >2σ above expected slope (opportunity signal)
 * - HUECO: gap in days > 60 between consecutive instruments (structural, not statistical)
 */
export function detectCurveAnomalies(instruments: Instrument[]): CurveAnomaly[] {
  const anomalies: CurveAnomaly[] = [];

  if (instruments.length < 2) return anomalies;

  // Sort by days
  const sorted = [...instruments].sort((a, b) => a.days - b.days);

  // ── Statistical baseline: linear regression of TEM vs Days ──
  // Used for SALTO_ANORMAL and APLANAMIENTO detection.
  // INVERSION is a pure logical rule (longer = lower TEM) and does NOT depend on σ.
  const n = sorted.length;
  const sumX = sorted.reduce((s, inst) => s + inst.days, 0);
  const sumY = sorted.reduce((s, inst) => s + inst.tem, 0);
  const sumXY = sorted.reduce((s, inst) => s + inst.days * inst.tem, 0);
  const sumX2 = sorted.reduce((s, inst) => s + inst.days * inst.days, 0);
  const denom = n * sumX2 - sumX * sumX;
  const regressionSlope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;  // TEM per day
  const intercept = (sumY - regressionSlope * sumX) / n;  // TEM at day 0

  // Compute residuals and standard deviation
  const residuals = sorted.map(inst => inst.tem - (intercept + regressionSlope * inst.days));
  const meanResidual = residuals.reduce((s, r) => s + r, 0) / n;
  const variance = residuals.reduce((s, r) => s + (r - meanResidual) ** 2, 0) / n;
  const stdDev = Math.sqrt(variance);

  // Check consecutive pairs
  for (let i = 0; i < sorted.length - 1; i++) {
    const current = sorted[i];
    const next = sorted[i + 1];
    const dayDiff = next.days - current.days;
    const temDiff = next.tem - current.tem;
    const slope30 = dayDiff > 0 ? (temDiff / dayDiff) * 30 : 0;

    // ──────────────────────────────────────────────────────────────
    // Type 1: INVERSION — LOGICAL RULE (highest priority)
    // If a longer-dated instrument yields LESS TEM than a shorter one,
    // it is ALWAYS an anomaly regardless of σ deviation.
    // This means the investor is paying more risk (time) for less reward (rate).
    // ──────────────────────────────────────────────────────────────
    if (next.tem < current.tem) {
      const absDiff = current.tem - next.tem;
      const nextDeviation = stdDev > 0 ? Math.abs(next.tem - (intercept + regressionSlope * next.days)) / stdDev : 0;

      let severity: CurveAnomaly['severity'];
      let action: CurveAnomaly['action'];
      let actionDetail: string;
      let recommendation: string;

      if (absDiff > 0.10 || nextDeviation > 3) {
        severity = 'CRITICA';
        action = 'EVITAR';
        actionDetail = `${next.ticker} rinde ${absDiff.toFixed(2)}% TEM menos que ${current.ticker} teniendo ${dayDiff} días más. Inversión de curva severa: se paga más riesgo temporal por menor tasa. EVITAR entrada; si está en cartera, evaluar salida inmediata.`;
        recommendation = `EVITAR ${next.ticker}: curva invertida vs ${current.ticker}. Mantener ${current.ticker} o vender ${next.ticker} si está en cartera.`;
      } else if (absDiff > 0.03 || nextDeviation > 2) {
        severity = 'ALTA';
        action = 'EVALUAR_SALIDA';
        actionDetail = `${next.ticker} rinde ${absDiff.toFixed(2)}% TEM menos que ${current.ticker} con ${dayDiff} días adicionales. Se está regalando tasa por plazo. Si está en cartera, evaluar rotación a ${current.ticker} o instrumento similar de menor plazo.`;
        recommendation = `Precaución con ${next.ticker}: curva invertida vs ${current.ticker}. Preferir ${current.ticker} por mejor rendimiento en menor plazo.`;
      } else {
        severity = 'MEDIA';
        action = 'MONITOREAR';
        actionDetail = `${next.ticker} rinde marginalmente menos que ${current.ticker} (${absDiff.toFixed(2)}% TEM, ${dayDiff}d más). Leve inversión — observar si se profundiza.`;
        recommendation = `Leve inversión: ${next.ticker} rinde marginalmente menos que ${current.ticker}. Observar evolución.`;
      }

      anomalies.push({
        longerTicker: next.ticker,
        shorterTicker: current.ticker,
        longerDays: next.days,
        shorterDays: current.days,
        longerTEM: next.tem,
        shorterTEM: current.tem,
        temDiff: absDiff,
        severity,
        anomalyType: 'INVERSION',
        anomalyDescription: `Inversión de curva: ${next.ticker} (${next.days}d, ${next.tem.toFixed(2)}% TEM) rinde menos que ${current.ticker} (${current.days}d, ${current.tem.toFixed(2)}% TEM) — Δ = −${absDiff.toFixed(2)}% TEM`,
        action,
        actionDetail,
        recommendation,
      });
    }

    // Type 2: APLANAMIENTO — flat segment where the segment slope deviates >2σ below expected
    if (temDiff >= 0 && dayDiff > 15) {
      const expectedSlope30 = regressionSlope * 30;
      const actualSlope30 = slope30;
      const expectedTemDiff = regressionSlope * dayDiff;
      const segmentResidual = temDiff - expectedTemDiff;
      const segmentDeviation = stdDev > 0 ? Math.abs(segmentResidual) / stdDev : 0;

      if (segmentDeviation > 2 && actualSlope30 < expectedSlope30 * 0.3) {
        anomalies.push({
          longerTicker: next.ticker,
          shorterTicker: current.ticker,
          longerDays: next.days,
          shorterDays: current.days,
          longerTEM: next.tem,
          shorterTEM: current.tem,
          temDiff: Math.abs(temDiff),
          severity: 'MEDIA',
          anomalyType: 'APLANAMIENTO',
          anomalyDescription: `Segmento plano: entre ${current.ticker} (${current.days}d) y ${next.ticker} (${next.days}d) la pendiente es solo ${(slope30 * 100).toFixed(1)} pb TEM cada 30 días (esperada: ${(expectedSlope30 * 100).toFixed(1)} pb, desviación: ${segmentDeviation.toFixed(1)}σ)`,
          action: 'PRECAUCION',
          actionDetail: `No se compensa el mayor plazo: ${dayDiff} días adicionales por solo ${(temDiff * 100).toFixed(1)} pb de TEM extra. Desviación ${segmentDeviation.toFixed(1)}σ de la tendencia. Considerar el instrumento de menor plazo para mayor liquidez con rendimiento similar.`,
          recommendation: `Tramo plano entre ${current.ticker} y ${next.ticker}. Preferir ${current.ticker} por igual rendimiento con menor plazo y mayor liquidez.`,
        });
      }
    }

    // Type 3: SALTO_ANORMAL — positive rate gap (opportunity signal, >2σ from expected slope)
    if (temDiff > 0 && dayDiff > 7) {
      const expectedTemDiff = regressionSlope * dayDiff;
      const segmentResidual = temDiff - expectedTemDiff;
      const segmentDeviation = stdDev > 0 ? segmentResidual / stdDev : 0;

      if (segmentDeviation > 2) {
        anomalies.push({
          longerTicker: next.ticker,
          shorterTicker: current.ticker,
          longerDays: next.days,
          shorterDays: current.days,
          longerTEM: next.tem,
          shorterTEM: current.tem,
          temDiff: Math.abs(temDiff),
          severity: segmentDeviation > 3 ? 'ALTA' : 'MEDIA',
          anomalyType: 'SALTO_ANORMAL',
          anomalyDescription: `Gap de tasa: ${next.ticker} (${next.tem.toFixed(2)}% TEM) rinde ${(temDiff * 100).toFixed(1)} pb más que ${current.ticker} (${current.tem.toFixed(2)}% TEM) — pendiente ${(slope30 * 100).toFixed(1)} pb/30d (+${segmentDeviation.toFixed(1)}σ)`,
          action: segmentDeviation > 3 ? 'EVALUAR_SALIDA' : 'PRECAUCION',
          actionDetail: `Gap de tasa positivo (+${segmentDeviation.toFixed(1)}σ). Puede indicar oportunidad de arbitraje (precio temporalmente bajo en ${next.ticker}) o prima por plazo excesiva. Verificar volumen y cotización.`,
          recommendation: `Gap de tasa entre ${current.ticker} y ${next.ticker} (+${segmentDeviation.toFixed(1)}σ). Evaluar entrada en ${next.ticker} si es oportunidad.`,
        });
      }
    }

    // Type 4: HUECO — gap > 60 days between consecutive instruments (structural, keep as-is)
    if (dayDiff > 60) {
      anomalies.push({
        longerTicker: next.ticker,
        shorterTicker: current.ticker,
        longerDays: next.days,
        shorterDays: current.days,
        longerTEM: next.tem,
        shorterTEM: current.tem,
        temDiff: Math.abs(temDiff),
        severity: 'MEDIA',
        anomalyType: 'HUECO',
        anomalyDescription: `Hueco de ${dayDiff} días sin instrumentos entre ${current.ticker} (${current.days}d) y ${next.ticker} (${next.days}d). La curva puede no reflejar rendimientos en ese tramo.`,
        action: 'MONITOREAR',
        actionDetail: `No hay datos en el rango ${current.days}-${next.days} días. Las interpolaciones en ese tramo son menos confiables. Considerar que la curva real puede tener pendiente diferente en ese sector.`,
        recommendation: `Hueco de ${dayDiff} días entre ${current.ticker} y ${next.ticker}. Tener precaución con interpolaciones en ese tramo.`,
      });
    }
  }

  return anomalies;
}

/**
 * Determine curve shape
 */
export function analyzeCurveShape(instruments: Instrument[]): {
  shape: 'NORMAL' | 'PLANA' | 'INVERTIDA' | 'CON_ANOMALIAS';
  description: string;
  slope: number; // average TEM change per 30 days
} {
  if (instruments.length < 2) return { shape: 'NORMAL', description: 'Datos insuficientes', slope: 0 };

  const sorted = [...instruments].sort((a, b) => a.days - b.days);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  const totalTEMChange = last.tem - first.tem;
  const totalDaysChange = last.days - first.days;
  const slope = totalDaysChange > 0 ? (totalTEMChange / totalDaysChange) * 30 : 0;

  const anomalies = detectCurveAnomalies(instruments);

  if (anomalies.some(a => a.severity === 'CRITICA')) {
    return {
      shape: 'CON_ANOMALIAS',
      description: `Curva con ${anomalies.length} anomalía(s) detectada(s). Inversiones significativas que requieren atención.`,
      slope,
    };
  }

  if (totalTEMChange < -0.1) {
    return {
      shape: 'INVERTIDA',
      description: 'Curva invertida: instrumentos cortos rinden más que largos. Contexto de potencial baja de tasas o estrés.',
      slope,
    };
  }

  if (Math.abs(slope) < 0.05) {
    return {
      shape: 'PLANA',
      description: 'Curva plana: rendimientos similares en todos los plazos. Poca compensación por plazo adicional.',
      slope,
    };
  }

  return {
    shape: 'NORMAL',
    description: `Curva normal con pendiente positiva de ${slope.toFixed(3)}% TEM cada 30 días. Mayor plazo compensa con mayor rendimiento.`,
    slope,
  };
}

/**
 * Calculate enhanced composite signal for an instrument
 * Combines: Momentum (25%) + Spread vs Caución (35%) + Duration/Sensitivity (25%) + G/día Neta (15%)
 */
export function calculateCompositeSignal(
  instrument: Instrument,
  config: Config,
  allInstruments: Instrument[],
  srPosition?: number // V1.8.4: 0-100% position in S/R channel (optional)
): CompositeSignal {
  // Duration
  const durMod = durationMod(instrument.days, instrument.tem);

  // Price sensitivity scenarios
  const pMinus10 = instrument.price + priceSensitivity(instrument.price, durMod, -10);
  const pMinus25 = instrument.price + priceSensitivity(instrument.price, durMod, -25);
  const pPlus10 = instrument.price + priceSensitivity(instrument.price, durMod, 10);
  const pPlus25 = instrument.price + priceSensitivity(instrument.price, durMod, 25);

  // Momentum score (daily change %) - Map from [-2%, +2%] to [0, 10]
  const momentumScore = Math.max(0, Math.min(10, (instrument.change + 2) * 2.5));
  let momentumLabel: string;
  if (instrument.change > 0.3) momentumLabel = 'Alcista Fuerte';
  else if (instrument.change > 0.1) momentumLabel = 'Alcista';
  else if (instrument.change > -0.1) momentumLabel = 'Lateral';
  else if (instrument.change > -0.3) momentumLabel = 'Bajista';
  else momentumLabel = 'Bajista Fuerte';

  // Spread vs Caución score - Map from [-1%, +2%] to [0, 10]
  const spread = spreadVsCaucion(instrument.tem, config, instrument.days);
  const spreadScore = Math.max(0, Math.min(10, (spread + 1) * (10 / 3)));
  let spreadLabel: string;
  if (spread > 0.5) spreadLabel = 'Muy Atractivo';
  else if (spread > 0.25) spreadLabel = 'Atractivo';
  else if (spread > 0.10) spreadLabel = 'Marginal';
  else if (spread > 0) spreadLabel = 'Positivo Marginal';
  else spreadLabel = 'Negativo';

  // Duration/Sensitivity score - higher duration = higher potential (for buying)
  const maxDur = Math.max(...allInstruments.map(i => Math.abs(durationMod(i.days, i.tem))));
  const durationScore = maxDur > 0 ? (Math.abs(durMod) / maxDur) * 10 : 0;
  let durationLabel: string;
  if (durationScore > 7) durationLabel = 'Alta Sensibilidad';
  else if (durationScore > 4) durationLabel = 'Sensibilidad Media';
  else durationLabel = 'Baja Sensibilidad';

  // G/día Neta score
  const gdNeta = gDiaNeta(instrument.tem, instrument.days, config.comisionTotal);
  const maxGDia = Math.max(...allInstruments.map(i => gDiaNeta(i.tem, i.days, config.comisionTotal)));
  const gDiaScore = maxGDia > 0 ? (gdNeta / maxGDia) * 10 : 0;

  // Composite (weighted)
  let compositeScore =
    momentumScore * 0.25 +
    spreadScore * 0.35 +
    durationScore * 0.25 +
    gDiaScore * 0.15;

  // V1.8.4: S/R Channel Penalty — strongly penalize bonds near/at resistance ceiling
  // If srPosition >= 90%, the bond is at the ceiling → sell signal → heavy penalty
  if (srPosition !== undefined && srPosition >= 90) {
    // At or above 90% of channel: severe penalty (up to -4 points at 100%)
    const penalty = ((srPosition - 90) / 10) * 4; // 0 at 90%, 4 at 100%
    compositeScore = Math.max(0, compositeScore - penalty);
  } else if (srPosition !== undefined && srPosition >= 75) {
    // 75-90% of channel: moderate penalty (up to -1.5 points at 90%)
    const penalty = ((srPosition - 75) / 15) * 1.5;
    compositeScore = Math.max(0, compositeScore - penalty);
  }

  // Signal determination
  let signal: CompositeSignal['signal'];
  let signalColor: string;
  let signalEmoji: string;

  if (compositeScore >= 7.5) {
    signal = 'COMPRA FUERTE';
    signalColor = '#00d4aa';
    signalEmoji = '🟢🟢';
  } else if (compositeScore >= 5.5) {
    signal = 'COMPRA';
    signalColor = '#00d4aa';
    signalEmoji = '🟢';
  } else if (compositeScore >= 3.5) {
    signal = 'NEUTRAL';
    signalColor = '#ffd700';
    signalEmoji = '🟡';
  } else if (compositeScore >= 2.0) {
    signal = 'VENDER';
    signalColor = '#ff6b9d';
    signalEmoji = '🔴';
  } else {
    signal = 'EVITAR';
    signalColor = '#ff4444';
    signalEmoji = '🔴🔴';
  }

  // Commission recovery days
  const drc = diasRecuperoComision(instrument.tem, config.comisionTotal);

  // RAE
  const rae = calculateRAE(instrument.tem);

  return {
    ticker: instrument.ticker,
    type: instrument.type,
    momentumScore,
    spreadScore,
    durationScore,
    compositeScore,
    signal,
    signalColor,
    signalEmoji,
    momentumLabel,
    spreadLabel,
    durationLabel,
    diasRecuperoComision: drc === Infinity ? 999 : drc,
    gDiaNeta: gdNeta,
    rae,
    priceMinus10bps: pMinus10,
    priceMinus25bps: pMinus25,
    pricePlus10bps: pPlus10,
    pricePlus25bps: pPlus25,
    durationMod: durMod,
  };
}

/**
 * Generate diagnostic result
 */
export function generateDiagnostic(
  instruments: Instrument[],
  config: Config,
  position: Position | null,
  mepRate?: number
): DiagnosticResult {
  // Curve analysis
  const curveAnalysis = analyzeCurveShape(instruments);
  const anomalies = detectCurveAnomalies(instruments);

  // Best opportunity
  const signals = instruments.map(i => calculateCompositeSignal(i, config, instruments));
  const bestSignal = [...signals].sort((a, b) => b.compositeScore - a.compositeScore)[0];
  const bestOpportunity = {
    ticker: bestSignal.ticker,
    reason: `Score ${bestSignal.compositeScore.toFixed(1)}/10 | ${bestSignal.signal} | G/día ${bestSignal.gDiaNeta.toFixed(4)}% | Spread ${bestSignal.spreadLabel}`,
    signal: bestSignal.signal,
  };

  // Position verdict
  let positionVerdict: DiagnosticResult['positionVerdict'] = 'SIN_POSICION';
  let positionVerdictReason = 'No hay posición activa.';

  if (position) {
    const currentInst = instruments.find(i => i.ticker === position.ticker);
    if (currentInst) {
      const currentSignal = signals.find(s => s.ticker === position.ticker);
      const currentSpread = spreadVsCaucion(currentInst.tem, config, currentInst.days);

      if (currentSignal && currentSignal.compositeScore < 2.0) {
        positionVerdict = 'VENDER';
        positionVerdictReason = `${position.ticker} tiene señal ${currentSignal.signal} (score ${currentSignal.compositeScore.toFixed(1)}). Se recomienda salir y rotar a ${bestOpportunity.ticker}.`;
      } else if (currentSignal && currentSignal.compositeScore < 3.5) {
        positionVerdict = 'ROTAR';
        positionVerdictReason = `${position.ticker} tiene señal NEUTRAL/VENDER (score ${currentSignal.compositeScore.toFixed(1)}). Mejor opción: ${bestOpportunity.ticker} con score ${bestSignal.compositeScore.toFixed(1)}.`;
      } else if (currentSpread < 0.1) {
        positionVerdict = 'ROTAR';
        positionVerdictReason = `${position.ticker} tiene spread vs caución muy bajo (${currentSpread.toFixed(3)}%). Considerar rotar si spread sigue comprimiendo.`;
      } else {
        positionVerdict = 'MANTENER';
        positionVerdictReason = `${position.ticker} tiene señal ${currentSignal?.signal || 'N/A'} (score ${currentSignal?.compositeScore.toFixed(1) || 'N/A'}) y spread ${currentSpread >= 0 ? '+' : ''}${currentSpread.toFixed(3)}%. Mantener posición.`;
      }
    }
  }

  // Riesgo país status
  let riesgoPaisStatus: DiagnosticResult['riesgoPaisStatus'] = 'NORMAL';
  if (config.riesgoPais > 650) riesgoPaisStatus = 'PELIGRO';
  else if (config.riesgoPais > 550) riesgoPaisStatus = 'ALERTA';
  else if (config.riesgoPais > 450) riesgoPaisStatus = 'PRECAUCION';

  // MEP alert
  let mepAlert = false;
  let mepMessage = '';
  if (mepRate && mepRate > 1550) {
    mepAlert = true;
    mepMessage = `⚠️ Dólar MEP a $${mepRate.toFixed(0)} supera umbral de $1,550. Considerar reducir exposición en pesos.`;
  } else if (mepRate && mepRate > 1450) {
    mepMessage = `Dólar MEP a $${mepRate.toFixed(0)} acercándose a zona de alerta ($1,550). Monitorear.`;
  }

  return {
    curveShape: curveAnalysis.shape,
    curveShapeDescription: curveAnalysis.description,
    anomalyCount: anomalies.length,
    anomalies,
    bestOpportunity,
    positionVerdict,
    positionVerdictReason,
    riesgoPaisStatus,
    mepAlert,
    mepMessage,
  };
}

// ============================================================
// V1.3 — MÓDULO DE MOMENTUM: Derivada de Tasa y Aceleración
// ============================================================

/**
 * Delta_TIR — Velocidad de cambio de la TIR
 *
 * CONCEPTO: Compara la TIR actual de cada instrumento con su TIR en el
 * Snapshot anterior. Un Delta_TIR positivo indica que el instrumento está
 * "regalando tasa" cada vez más rápido (la TIR sube, el precio baja).
 *
 * FÓRMULA:
 *   ΔTIR = TIR_actual − TIR_snapshot_anterior
 *
 * EJEMPLO: Si un LECAP pasó de TEM 2.10% a 2.15%
 *   ΔTIR = 2.15% − 2.10% = +0.05%
 *   → La tasa está subiendo, el instrumento se está abaratando
 */
export function calculateDeltaTIR(
  currentInstruments: Instrument[],
  previousSnapshot: Snapshot | null
): Map<string, number | null> {
  const deltaMap = new Map<string, number | null>();

  if (!previousSnapshot) {
    // V1.4.4 FIX: No hay snapshot previo → delta = null (no 0.000%)
    // null significa "falta la base de comparación", no que el delta sea cero
    for (const inst of currentInstruments) {
      deltaMap.set(inst.ticker, null);
    }
    return deltaMap;
  }

  // V1.4.2 FIX: Use tir field (tir = tem) for Delta_TIR calculation
  const prevTIRMap = new Map<string, number>();
  for (const inst of previousSnapshot.instruments) {
    const prevTIR = inst.tir || inst.tem;  // V1.4.3 FIX: use || not ?? so 0 falls back to tem
    // V1.4.4 FIX: Only store valid (> 0) previous TIR values
    if (prevTIR > 0 && isFinite(prevTIR)) {
      prevTIRMap.set(inst.ticker, prevTIR);
    }
  }

  for (const inst of currentInstruments) {
    const prevTIR = prevTIRMap.get(inst.ticker);
    const currentTIR = inst.tir || inst.tem;  // V1.4.3 FIX: use || not ??

    // V1.4.4 FIX: const delta = currentTir - snapshotTir
    // If snapshotTir doesn't exist or was 0/invalid → delta = null
    if (prevTIR !== undefined && prevTIR > 0 && isFinite(currentTIR) && currentTIR > 0) {
      deltaMap.set(inst.ticker, currentTIR - prevTIR);  // Exact subtraction, no Math.round, no filtering
    } else {
      deltaMap.set(inst.ticker, null);  // Missing or invalid base → null
    }
  }

  return deltaMap;
}

/**
 * Aceleración — 2da derivada de la TIR
 *
 * CONCEPTO: Mide el cambio del Delta_TIR entre los últimos 3 Snapshots.
 * Es la "aceleración" de la tasa: indica si el movimiento se está
 * acelerando (aceleración positiva) o desacelerando (negativa).
 *
 * FÓRMULA:
 *   Aceleración = ΔTIR_n − ΔTIR_{n-1}
 *   donde ΔTIR_n = TIR_snapshot_n − TIR_snapshot_{n-1}
 *         ΔTIR_{n-1} = TIR_snapshot_{n-1} − TIR_snapshot_{n-2}
 *
 * INTERPRETACIÓN:
 *   Aceleración > 0.02: ↑↑ Aceleración fuerte (la tasa sube cada vez más rápido)
 *   Aceleración > 0: Tendencia alcista acelerándose
 *   Aceleración ≈ 0: → Estable (movimiento lineal)
 *   Aceleración < 0: Desaceleración (la tasa sube más lento o empieza a bajar)
 *   Aceleración < -0.02: ↓↓ Desaceleración fuerte
 */
export function calculateAceleracion(snapshots: Snapshot[]): Map<string, number> {
  const aceleracionMap = new Map<string, number>();

  if (snapshots.length < 3) {
    // Necesitamos al menos 3 snapshots para calcular aceleración
    // Si hay 2, devolvemos el delta como aproximación
    if (snapshots.length === 2) {
      const last = snapshots[1];
      const prev = snapshots[0];
      const prevTIRMap = new Map<string, number>();
      for (const inst of prev.instruments) {
        prevTIRMap.set(inst.ticker, inst.tir || inst.tem);  // V1.4.3 FIX: use || not ??
      }
      for (const inst of last.instruments) {
        const prevTIR = prevTIRMap.get(inst.ticker);
        const currentTIR = inst.tir || inst.tem;  // V1.4.3 FIX: use || not ??
        aceleracionMap.set(inst.ticker, prevTIR !== undefined ? (currentTIR - prevTIR) : 0);
      }
    }
    return aceleracionMap;
  }

  // Last 3 snapshots
  const snap0 = snapshots[snapshots.length - 3]; // más viejo
  const snap1 = snapshots[snapshots.length - 2]; // medio
  const snap2 = snapshots[snapshots.length - 1]; // más reciente

  // Build TIR maps for each snapshot
  const buildTIRMap = (snap: Snapshot) => {
    const map = new Map<string, number>();
    for (const inst of snap.instruments) {
      map.set(inst.ticker, inst.tir || inst.tem);  // V1.4.3 FIX: use || not ??
    }
    return map;
  };

  const tirMap0 = buildTIRMap(snap0);
  const tirMap1 = buildTIRMap(snap1);
  const tirMap2 = buildTIRMap(snap2);

  // Calculate for each instrument in the latest snapshot
  for (const inst of snap2.instruments) {
    const tir0 = tirMap0.get(inst.ticker);
    const tir1 = tirMap1.get(inst.ticker);
    const tir2 = inst.tir || inst.tem;  // V1.4.3 FIX: use || not ??

    if (tir0 !== undefined && tir1 !== undefined) {
      const delta1 = tir1 - tir0; // ΔTIR_{n-1}
      const delta2 = tir2 - tir1; // ΔTIR_n
      aceleracionMap.set(inst.ticker, delta2 - delta1);
    } else {
      aceleracionMap.set(inst.ticker, 0);
    }
  }

  return aceleracionMap;
}

/**
 * Calcular datos completos de Momentum para todos los instrumentos
 *
 * Integra Delta_TIR, Aceleración, Tendencia visual y detección de "Tapados"
 * en un solo Map para consumo eficiente por los componentes de UI.
 */
export function calculateAllMomentum(
  currentInstruments: Instrument[],
  snapshots: Snapshot[],
  comisionTotal: number
): Map<string, MomentumData> {
  const momentumMap = new Map<string, MomentumData>();
  const previousSnapshot = snapshots.length >= 2 ? snapshots[snapshots.length - 2] : null;

  // Calcular Delta_TIR
  const deltaMap = calculateDeltaTIR(currentInstruments, previousSnapshot);

  // Calcular Aceleración
  const aceleracionMap = calculateAceleracion(snapshots);

  // Build TIR history for each ticker from available snapshots
  const tirHistoryMap = new Map<string, number[]>();
  for (const snap of snapshots) {
    for (const inst of snap.instruments) {
      if (!tirHistoryMap.has(inst.ticker)) {
        tirHistoryMap.set(inst.ticker, []);
      }
      tirHistoryMap.get(inst.ticker)!.push(inst.tem);
    }
  }

  // Para cada instrumento actual, construir MomentumData
  for (const inst of currentInstruments) {
    const history = tirHistoryMap.get(inst.ticker) || [];
    const tirHistory = history.slice(-3); // últimas 3 TIRs para tooltip
    // V1.4.4 FIX: deltaMap now returns null for missing comparisons
    const deltaTIR: number | null = deltaMap.get(inst.ticker) ?? null;
    const aceleracion = aceleracionMap.get(inst.ticker) || 0;

    // Tendencia visual
    // V1.4.4 FIX: Handle null deltaTIR — "→" when no valid comparison
    let tendencia: MomentumData['tendencia'] = '→';
    if (deltaTIR !== null) {
      if (aceleracion > 0.02) tendencia = '↑↑';
      else if (deltaTIR > 0.01) tendencia = '↑';
      else if (aceleracion < -0.02) tendencia = '↓↓';
      else if (deltaTIR < -0.01) tendencia = '↓';
    }

    // Detección de "Tapado" (Oportunidad en Desarrollo)
    // Criterio Nivel 2 (Cian/Amarillo):
    //   - Delta_TIR positivo persistente (la tasa está subiendo consistentemente)
    //   - Pero el margen neto actual es menor al costo de comisión round-trip
    let esTapado = false;
    let tapadoReason = '';

    // V1.4.4 FIX: Only check tapado if deltaTIR is a valid number
    if (deltaTIR !== null && deltaTIR > 0 && history.length >= 2) {
      // Verificar si el deltaTIR ha sido positivo en snapshots recientes (persistente)
      const recentDeltas: number[] = [];
      for (let i = history.length - 1; i >= 1 && recentDeltas.length < 2; i--) {
        recentDeltas.push(history[i] - history[i - 1]);
      }
      const persistentPositive = recentDeltas.every(d => d > 0);

      // El margen neto actual es menor al costo de comisión
      // Spread vs caución como proxy de margen neto
      const gananciaNetaVsComision = inst.gananciaDirecta - comisionTotal;

      if (persistentPositive && gananciaNetaVsComision < 0) {
        esTapado = true;
        tapadoReason = `ΔTIR +${deltaTIR.toFixed(3)}% persistente pero ganancia directa (${inst.gananciaDirecta.toFixed(2)}%) no cubre comisión round-trip (${comisionTotal}%). Potencial oportunidad si la tendencia de tasa continúa.`;
      }
    }

    momentumMap.set(inst.ticker, {
      ticker: inst.ticker,
      deltaTIR,
      aceleracion,
      tendencia,
      tirHistory,
      esTapado,
      tapadoReason,
    });
  }

  return momentumMap;
}

// ============================================================
// V1.4.2 — NORMALIZACIÓN DE DATOS IMPORTADOS
// ============================================================

/** Backup format version history:
 *  1.0 — Initial (config + position + transactions only)
 *  1.1 — Added simulations
 *  1.2 — Added instruments + externalHistory
 *  1.3 — Added snapshots (session history for momentum)
 *  1.4  — Focus Edition fields
 *  1.4.2 — Normalization engine
 *  1.5.0 — V1.5 with price history support, TRAMPA detection
 */
export const BACKUP_FORMAT_VERSION = '1.5.0';

const NORMALIZE_DEFAULT_CONFIG: Config = {
  caucion1d: 21.0,
  caucion7d: 19.2,
  caucion30d: 18.5,
  riesgoPais: 528,
  comisionTotal: 0.30,
  capitalDisponible: 500000,
};

/**
 * Normalize a single instrument: fill missing fields, recalculate derived values
 * from available data (price, days, tna, tem).
 *
 * Priority for TEM recovery:
 *   1. If tem exists and > 0 → keep it
 *   2. If tna exists and > 0 → TEM = ((1+TNA/100)^(1/12)-1)*100
 *   3. If price > 0 and days > 0 → estimate from rescue value
 */
function normalizeInstrument(raw: any): Instrument {
  const inst: Instrument = {
    ticker: raw.ticker || 'UNKNOWN',
    type: raw.type === 'BONCAP' ? 'BONCAP' : 'LECAP',
    expiry: raw.expiry || '',
    days: typeof raw.days === 'number' && raw.days > 0 ? raw.days : 0,
    price: typeof raw.price === 'number' && raw.price > 0 ? raw.price : 1,
    change: typeof raw.change === 'number' ? raw.change : 0,
    tna: typeof raw.tna === 'number' ? raw.tna : 0,
    tem: typeof raw.tem === 'number' ? raw.tem : 0,
    tir: typeof raw.tir === 'number' ? raw.tir : (typeof raw.tem === 'number' ? raw.tem : 0),  // V1.4.2 FIX: tir = tem
    gananciaDirecta: typeof raw.gananciaDirecta === 'number' ? raw.gananciaDirecta : 0,
    vsPlazoFijo: raw.vsPlazoFijo || '',
  };

  // V1.5: Preserve dm if available
  if (typeof raw.dm === 'number' && raw.dm > 0) {
    inst.dm = raw.dm;
  }

  // Fix days from expiry if missing
  if (inst.days <= 0 && inst.expiry) {
    inst.days = daysFromExpiry(inst.expiry);
  }

  // Fix TEM if missing or zero
  if (inst.tem <= 0) {
    if (inst.tna > 0) {
      // Derive TEM from TNA
      inst.tem = caucionTEMFromTNA(inst.tna);
    } else if (inst.price > 0 && inst.days > 0) {
      // Last resort: estimate from rescue value
      const rescueValue = inst.type === 'LECAP' ? 1.41 : inst.price * 1.3;
      inst.tem = ((rescueValue / inst.price) - 1) * (30 / inst.days) * 100;
    }
  }

  // V1.4.2 FIX: Always sync tir = tem after any TEM recalculation
  inst.tir = inst.tem;

  // Fix TNA if missing or zero
  if (inst.tna <= 0 && inst.tem > 0) {
    // Approximate: TNA ≈ TEM * 12
    inst.tna = inst.tem * 12;
  }

  // Fix gananciaDirecta if missing
  if (inst.gananciaDirecta <= 0 && inst.tem > 0 && inst.days > 0) {
    inst.gananciaDirecta = inst.tem * (inst.days / 30);
  }

  return inst;
}

/**
 * Normalize a single snapshot (ensure all instruments have complete fields).
 */
function normalizeSnapshot(raw: any): Snapshot {
  const instruments = Array.isArray(raw?.instruments)
    ? raw.instruments.map(normalizeInstrument)
    : [];
  return {
    timestamp: raw?.timestamp || new Date().toISOString(),
    instruments,
  };
}

/**
 * Normalize imported backup data.
 *
 * This function is the main entry point for backward compatibility.
 * It takes raw parsed JSON from any version and returns a fully
 * normalized data structure that the current V1.5 code can use.
 *
 * Returns: { normalized data, migrationLog[] }
 */
export function normalizeImportedData(raw: any): {
  config: Config;
  position: Position | null;
  transactions: any[];
  simulations: any[];
  instruments: Instrument[];
  externalHistory: any[];
  snapshots: Snapshot[];
  migrationLog: string[];
} {
  const log: string[] = [];
  const version = raw.version || '0.0';

  // ── 1. Config ──
  let config: Config = { ...NORMALIZE_DEFAULT_CONFIG };
  if (raw.config && typeof raw.config === 'object') {
    config = { ...config, ...raw.config };
    // V1.0/V1.1 didn't have capitalDisponible
    if (config.capitalDisponible === undefined) {
      config.capitalDisponible = NORMALIZE_DEFAULT_CONFIG.capitalDisponible;
      log.push('Config: se agregó capitalDisponible (no existía en v' + version + ')');
    }
    // Ensure all numeric fields are valid
    for (const key of Object.keys(NORMALIZE_DEFAULT_CONFIG) as (keyof Config)[]) {
      if (typeof config[key] !== 'number' || isNaN(config[key])) {
        (config as any)[key] = NORMALIZE_DEFAULT_CONFIG[key];
        log.push('Config: se reparó ' + key + ' con valor por defecto');
      }
    }
  } else {
    log.push('Config: no se encontró config, se usaron valores por defecto');
  }

  // ── 2. Instruments ──
  let instruments: Instrument[] = [];
  if (Array.isArray(raw.instruments) && raw.instruments.length > 0) {
    instruments = raw.instruments.map(normalizeInstrument);
    const fixedCount = instruments.filter((inst, i) => {
      const orig = raw.instruments[i];
      return orig.tem <= 0 || orig.days <= 0 || orig.tna <= 0;
    }).length;
    if (fixedCount > 0) {
      log.push('Instrumentos: ' + fixedCount + ' instrumento(s) con campos faltantes fueron reparados (TEM/TNA/días recalculados)');
    }
  } else {
    log.push('Instrumentos: no se encontraron instrumentos en el backup');
  }

  // ── 3. Snapshots (Session History for Momentum) ──
  let snapshots: Snapshot[] = [];
  if (Array.isArray(raw.snapshots) && raw.snapshots.length > 0) {
    snapshots = raw.snapshots.map(normalizeSnapshot);
    log.push('Snapshots: ' + snapshots.length + ' snapshot(s) restaurados del historial de sesión');
  } else {
    // V1.2 and earlier didn't have snapshots.
    // Create an initial snapshot from instruments so momentum has a baseline.
    if (instruments.length > 0) {
      snapshots = [{
        timestamp: raw.exportDate || new Date().toISOString(),
        instruments: instruments.map(inst => ({ ...inst })),
      }];
      log.push('Snapshots: no existían en v' + version + '. Se creó 1 snapshot inicial desde los instrumentos importados (Delta_TIR será 0 hasta la próxima actualización)');
    } else {
      log.push('Snapshots: sin datos para crear snapshot inicial');
    }
  }

  // ── 4. Position ──
  let position: Position | null = null;
  if (raw.position && raw.position.ticker) {
    position = {
      ticker: raw.position.ticker,
      entryPrice: typeof raw.position.entryPrice === 'number' ? raw.position.entryPrice : 0,
      vn: typeof raw.position.vn === 'number' ? raw.position.vn : 0,
      entryDate: raw.position.entryDate || '',
      precioConComision: raw.position.precioConComision,
    };
  }

  // ── 5. Transactions ──
  const transactions = Array.isArray(raw.transactions) ? raw.transactions : [];
  if (!Array.isArray(raw.transactions) && version < '1.3') {
    log.push('Transacciones: no se encontraron (backup v' + version + ')');
  }

  // ── 6. Simulations ──
  const simulations = Array.isArray(raw.simulations) ? raw.simulations : [];
  if (!Array.isArray(raw.simulations) && version < '1.2') {
    log.push('Simulaciones: no se encontraron (backup v' + version + ')');
  }

  // ── 7. External History ──
  const externalHistory = Array.isArray(raw.externalHistory) ? raw.externalHistory : [];
  if (!Array.isArray(raw.externalHistory) && version < '1.2') {
    log.push('Historial externo: no se encontró (backup v' + version + ')');
  }

  return { config, position, transactions, simulations, instruments, externalHistory, snapshots, migrationLog: log };
}

/**
 * Profit Neto — Ganancia neta después de comisiones round-trip
 *
 * V1.3 Refactorización de comisiones: asegura que TODOS los cálculos
 * de "Profit" descuenten el valor roundTrip definido en la pestaña Config.
 *
 * FÓRMULA:
 *   profitNeto = profitBruto − comisionRoundTrip
 *   donde comisionRoundTrip = comisionTotal (ej: 0.30%)
 *
 * El profitNeto es el dato principal de decisión en la interfaz.
 */
export function profitNeto(profitBrutoPct: number, comisionTotal: number): number {
  return profitBrutoPct - comisionTotal;
}

// ═══════════════════════════════════════════════════════════════
// V1.7 — ROTATION SCORE WITH CAPITAL RUN POTENTIAL
// ═══════════════════════════════════════════════════════════════

/**
 * V1.7: Calculate TEM Compression Score
 * If current TEM is near its 15-day minimum, the bond has compression potential
 * (rates can compress further → price rises). If near maximum, expansion risk.
 */
export function calculateTEMCompressionScore(
  currentTEM: number,
  minTEM15d: number,
  maxTEM15d: number,
  deltaTIR: number | null
): number {
  const temRange = maxTEM15d - minTEM15d;
  if (temRange < 0.01) return 5;

  const temPct = (currentTEM - minTEM15d) / temRange;

  let baseScore: number;
  if (temPct <= 0.2) baseScore = 10;
  else if (temPct <= 0.4) baseScore = 8;
  else if (temPct <= 0.6) baseScore = 5;
  else if (temPct <= 0.8) baseScore = 3;
  else baseScore = 1;

  if (deltaTIR !== null && deltaTIR > 0.02) {
    baseScore = Math.min(10, baseScore + 1.5);
  } else if (deltaTIR !== null && deltaTIR < -0.02) {
    baseScore = Math.max(0, baseScore - 1);
  }

  return Math.max(0, Math.min(10, baseScore));
}

/**
 * V1.7: Calculate Capital Run Score
 * Maps upsideCapital to a 0-10 score.
 */
export function calculateCapitalRunScore(upsideCapital: number): number {
  if (upsideCapital <= 0) return 0;
  if (upsideCapital >= 2.0) return 10;
  return Math.min(10, (upsideCapital / 2.0) * 10);
}

/**
 * V1.7: Calculate the full tactical rotation score for an instrument
 * Weights: Composite 35%, Capital Run 35%, TEM Compression 30%
 */
export function calculateRotationScoreV17(
  inst: Instrument,
  config: Config,
  allInstruments: Instrument[],
  srData: { upsideCapital: number; downsideRisk: number; temPosition: 'CERCANO_MIN' | 'CERCANO_MAX' | 'MEDIO'; minTEM15d: number; maxTEM15d: number; posicionEnCanal?: number } | undefined,
  momentumData: MomentumData | undefined,
): RotationScoreV17 {
  // Get composite signal — pass S/R position for penalty calculation
  const signal = calculateCompositeSignal(inst, config, allInstruments, srData?.posicionEnCanal);

  const upsideCapital = srData?.upsideCapital ?? 0;
  const downsideRisk = srData?.downsideRisk ?? 0;
  const temPosition = srData?.temPosition ?? 'MEDIO';
  const minTEM15d = srData?.minTEM15d ?? inst.tem;
  const maxTEM15d = srData?.maxTEM15d ?? inst.tem;

  const deltaTIR = momentumData?.deltaTIR ?? null;
  const spread = spreadVsCaucion(inst.tem, config, inst.days);

  const temCompressionScore = calculateTEMCompressionScore(inst.tem, minTEM15d, maxTEM15d, deltaTIR);
  const capitalRunScore = calculateCapitalRunScore(upsideCapital);

  const tacticalScore =
    signal.compositeScore * 0.35 +
    capitalRunScore * 0.35 +
    temCompressionScore * 0.30;

  const isPositionExhausted = upsideCapital < 0.1;
  const shouldRotateForRun = upsideCapital > 0.5 && temCompressionScore >= 6;

  return {
    ticker: inst.ticker,
    compositeScore: signal.compositeScore,
    upsideCapital,
    downsideRisk,
    temPosition,
    deltaTIR,
    spreadVsCaucion: spread,
    tem: inst.tem,
    temCompressionScore,
    capitalRunScore,
    tacticalScore,
    isPositionExhausted,
    shouldRotateForRun,
  };
}
