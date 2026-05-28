import { Instrument, Config, Position, RotationAnalysis, SwingSignal, CurveAnomaly, CompositeSignal, DiagnosticResult, Snapshot, MomentumData, RotationScoreV17, CockpitScore, AdaptiveTakeProfitResult, CompanionCluster, CurveSpreadAnomaly, SpreadDispersalVelocity } from './types';

/**
 * Calculate days remaining to expiry from an expiry date string.
 * V3.0.1: Supports both DD/MM/YYYY (manual/paste) and YYYY-MM-DD (ISO/live API) formats.
 */
export function daysFromExpiry(expiry: string): number {
  if (!expiry || typeof expiry !== 'string') return 0;

  let expiryDate: Date;

  if (expiry.includes('/')) {
    // DD/MM/YYYY format (manual/paste data)
    const parts = expiry.split('/');
    if (parts.length !== 3) return 0;
    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const year = parseInt(parts[2], 10);
    if (isNaN(day) || isNaN(month) || isNaN(year)) return 0;
    if (year < 2000 || year > 2100) return 0;
    expiryDate = new Date(year, month, day);
  } else if (expiry.includes('-')) {
    // YYYY-MM-DD format (ISO / live API / ArgentinaDatos)
    const parts = expiry.split('-');
    if (parts.length !== 3) return 0;
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    if (isNaN(day) || isNaN(month) || isNaN(year)) return 0;
    if (year < 2000 || year > 2100) return 0;
    expiryDate = new Date(year, month, day);
  } else {
    return 0;
  }

  // V5.4 FIX: Force Buenos Aires timezone (UTC-3) for both dates.
  // Server-side new Date() uses UTC, which can add an extra day when
  // the server is ahead of Argentina local time.
  const now = new Date();
  const bsasOffset = -3 * 60; // UTC-3 in minutes
  const localOffset = now.getTimezoneOffset(); // local offset in minutes (positive for west of UTC)
  const diffMs = (localOffset - bsasOffset) * 60 * 1000;
  const bsasNow = new Date(now.getTime() + diffMs);
  bsasNow.setHours(0, 0, 0, 0);
  expiryDate.setHours(0, 0, 0, 0);
  const diff = Math.ceil((expiryDate.getTime() - bsasNow.getTime()) / (1000 * 60 * 60 * 24));
  return Math.max(0, diff);
}

/**
 * Ensure instrument has valid days — V3.0.1: ALWAYS recalculate from expiry
 * when available, using the current system date (new Date()).
 *
 * This ensures that days-to-maturity is always REAL even if prices are stale
 * (e.g., LIVE off, weekend, holiday). A bond that expires in 10 days today
 * will show 9 days tomorrow regardless of when its price was last updated.
 *
 * If expiry is not available, we preserve the original days value (manual entry).
 */
export function ensureValidDays(instruments: Instrument[]): Instrument[] {
  return instruments.map(inst => {
    // V1.4.3 FIX: ALWAYS set tir = tem (TEM is source of truth from broker)
    const effectiveRate = inst.tem || inst.tir || 0;
    const protectedTEM = effectiveRate;
    const protectedTIR = effectiveRate;  // tir always equals tem

    // V3.0.1: If we have an expiry date, ALWAYS recalculate days from it
    // This guarantees real days-to-maturity even with stale price data
    if (inst.expiry) {
      const calculatedDays = daysFromExpiry(inst.expiry);
      if (calculatedDays >= 0) {
        return { ...inst, days: calculatedDays, tem: protectedTEM, tir: protectedTIR };
      }
    }

    // No expiry available — keep original days (manual entry / hardcoded)
    if (inst.days <= 0) {
      // Last resort: can't determine days
      return { ...inst, tem: protectedTEM, tir: protectedTIR };
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

// ============================================================
// V3.3-PRO Phase 2: COCKPIT SCORE — Unified Scalping Signal
//
// 5 weighted components for intraday scalping:
//   25% Spread Neto (Carry inmediato vs Caución)
//   25% ΔTIR (Momentum de tasa intradía)
//   20% Presión de Punta (IOL bid/ask data)
//   20% Upside Capital (Recorrido a resistencia S/R)
//   10% Velocidad (Penaliza instrumentos largos, premia cortos)
//
// BLINDAJE: La comisión del 0.15% NO se toca.
// ============================================================

/**
 * V3.3-PRO Phase 2: Cockpit Score — Unified scalping signal
 *
 * Computes a 0-10 composite score from 5 weighted factors,
 * then assigns a verdict (SALTO_TACTICO → EVITAR).
 *
 * COMMISSION LOGIC IS STRICTLY PROTECTED — 0.15% (price × 1.0015)
 * is NEVER modified by this function.
 */
export function calculateCockpitScore(
  instrument: Instrument,
  config: Config,
  deltaTIR: number | null,
  iolMarketPressure: number | null,
  puntaPressurePct: number | null,
  upsideCapital: number,
  days: number,
): CockpitScore {
  // ── 1. Spread Neto Score (25%) ──────────────────────────────
  // spreadNeto = TEM - cauciónTEM - comisiónAmortizada
  const caucionTNA = getCaucionForDays(config, days);
  const caucionTEM = caucionTEMFromTNA(caucionTNA);
  const comisionAmortizada = days > 0 ? config.comisionTotal / (days / 30) : 0;
  const spreadNeto = instrument.tem - caucionTEM - comisionAmortizada;
  const spreadNetoScore = Math.max(0, Math.min(10, (spreadNeto + 0.5) / 1.5 * 10));

  // ── 2. ΔTIR Score (25%) ────────────────────────────────────
  // If deltaTIR is null: score = 3.0 (neutral baseline, penalize lack of data)
  // Map: deltaTIR from [-0.1%, +0.15%] → [0, 10]
  const deltaTIRScore = deltaTIR !== null
    ? Math.max(0, Math.min(10, (deltaTIR + 0.1) / 0.25 * 10))
    : 3.0;

  // V6.2.0: Presión de Punta Score (20%) — puntaPressurePct based
  // If puntaPressurePct is available (from IOL L2 or data912 L1 fallback):
  //   Map: pressure from [-100%, +100%] → [0, 10]
  //   +100% (all bid) → 10, 0% (balanced) → 5, -100% (all ask) → 0
  // If not available: score = 5.0 (neutral, no penalty but no reward)
  const presionPuntasScore = puntaPressurePct !== null
    ? Math.max(0, Math.min(10, (puntaPressurePct + 100) / 200 * 10))
    : 5.0;

  // ── 4. Upside Capital Score (20%) ──────────────────────────
  // If srData available: upsideCapital = distanciaResistencia from SRData
  // If not available: use tem * 0.3 as rough proxy (already passed in)
  // Map: upsideCapital from [0%, 2.0%] → [0, 10]
  const effectiveUpsideCapital = upsideCapital > 0 ? upsideCapital : instrument.tem * 0.3;
  const upsideCapitalScore = Math.max(0, Math.min(10, effectiveUpsideCapital / 2.0 * 10));

  // ── 5. Velocidad Score (10%) ───────────────────────────────
  // Short instruments get higher score (scalping focus)
  let velocidadScore: number;
  if (days <= 7) velocidadScore = 10;
  else if (days <= 15) velocidadScore = 8;
  else if (days <= 20) velocidadScore = 6;
  else if (days <= 30) velocidadScore = 4;
  else if (days <= 60) velocidadScore = 2;
  else velocidadScore = 0;

  // ── Composite Score ────────────────────────────────────────
  const cockpitScore =
    spreadNetoScore * 0.25 +
    deltaTIRScore * 0.25 +
    presionPuntasScore * 0.20 +
    upsideCapitalScore * 0.20 +
    velocidadScore * 0.10;

  // ── 20-day Temporal Horizon Filter ─────────────────────────
  const withinHorizon = days <= 20;

  // ── Verdict ────────────────────────────────────────────────
  let verdict: CockpitScore['verdict'];
  let verdictReason: string;

  const effectiveDeltaTIR = deltaTIR ?? 0;

  if (cockpitScore >= 7.5 && spreadNeto > 0.15 && effectiveDeltaTIR > 0) {
    verdict = 'SALTO_TACTICO';
    verdictReason = `Score ${cockpitScore.toFixed(1)} — Spread Neto +${spreadNeto.toFixed(2)}% + ΔTIR +${effectiveDeltaTIR.toFixed(3)}% — Entrada táctica confirmada`;
  } else if (cockpitScore >= 5.5 && effectiveUpsideCapital > 0.50) {
    verdict = 'PUNTO_CARAMELO';
    verdictReason = `Score ${cockpitScore.toFixed(1)} — Upside +${effectiveUpsideCapital.toFixed(2)}% — Punto de entrada dulce con recorrido de capital`;
  } else if (cockpitScore >= 4.0) {
    verdict = 'ATRACTIVO';
    verdictReason = `Score ${cockpitScore.toFixed(1)} — Condiciones favorables pero sin confirmación completa`;
  } else if (cockpitScore >= 2.5) {
    verdict = 'NEUTRAL';
    verdictReason = `Score ${cockpitScore.toFixed(1)} — Sin señal clara, mantener observación`;
  } else {
    verdict = 'EVITAR';
    verdictReason = `Score ${cockpitScore.toFixed(1)} — Condiciones desfavorables para entrada`;
  }

  return {
    ticker: instrument.ticker,
    type: instrument.type,
    spreadNetoScore,
    deltaTIRScore,
    presionPuntasScore,
    upsideCapitalScore,
    velocidadScore,
    cockpitScore,
    unifiedScore: Math.round(cockpitScore * 10 * 10) / 10,  // V5.4: base-100, 1 decimal
    verdict,
    verdictReason,
    spreadNeto,
    deltaTIR,
    presionPuntas: puntaPressurePct,
    upsideCapital: effectiveUpsideCapital,
    days,
    withinHorizon,
    // V5.0 SCANNER: Price Action columns (defaults — enriched by cockpit-score API)
    nearestSR: null,
    distanceToSR: 0,
    volumeInjection: { ratio: 1, label: 'NORMAL' as const },
    actionScore: { score: 0, label: 'SIN SEÑAL' as const, reason: 'Sin datos de S/R' },
    volume: 0,
    iolVolume: 0,
  };
}

// ════════════════════════════════════════════════════════════════════════
// V5.0 SCANNER — Price Action Helper Functions
// ════════════════════════════════════════════════════════════════════════

/**
 * V5.0: Calculate nearest Support/Resistance level from live data.
 * 
 * Since S/R from historico_precios.json is NOT available in the API route
 * (it's a client-side file), we derive S/R from the current session's
 * price data using statistical methods:
 *   - Support ≈ price × (1 - spread_half)  →  bid side floor
 * V6.0: Historical Structural S/R Engine.
 *
 * Instead of using intraday bid/ask (which just shows today's order book
 * and produces static values like 1.2201 for T30J7), this engine reads
 * from the DailyOHLC table — 20 to 30 calendar days of actual market
 * closes — and derives true structural levels:
 *
 *   - Support = absolute lowest closing price across the lookback window
 *   - Resistance = absolute highest closing price across the lookback window
 *
 * These are REAL technical levels that represent where the market has
 * previously established floors and ceilings — not arbitrary 1% bands
 * or today's bid/ask spread.
 *
 * If no historical data is available, falls back gracefully to the
 * old intraday-based calculateNearestSR().
 */

/** Historical OHLC record (from DailyOHLC table) */
export interface HistoricalOHLC {
  date: string;
  ticker: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

/** Full S/R analysis from historical data */
export interface HistoricalSRResult {
  /** Effective support level (may be polarity-reversed from raw) */
  support: number;
  /** Effective resistance level (may be polarity-reversed from raw) */
  resistance: number;
  /** Current live price */
  currentPrice: number;
  /** % distance from price to support (always positive) */
  distToSupport: number;
  /** % distance from price to resistance (always positive) */
  distToResistance: number;
  /** Position in S/R channel (0=at support, 100=at resistance) */
  channelPosition: number;
  /** Number of trading days used in the calculation */
  daysUsed: number;
  /** Whether this is based on real historical data or a fallback */
  isHistorical: boolean;

  // ── V6.1.0: Dynamic Price Action & Polarity Reversal ──
  /** Price-action polarity state */
  polarity: 'INSIDE_CHANNEL' | 'BULLISH_BREAKOUT' | 'BEARISH_BREAKDOWN';
  /** Average Daily Range from OHLC data (ATR-powered since V6.2.0) */
  avgDailyRange: number;
  /** V6.2.0: Average True Range — accounts for gap openings (more accurate than ADR) */
  atr: number;
  /** Raw historical minimum close BEFORE polarity adjustment */
  rawSupport: number;
  /** Raw historical maximum close BEFORE polarity adjustment */
  rawResistance: number;
}

/**
 * V6.1.0 — Calculate historical S/R levels with DYNAMIC POLARITY REVERSAL.
 *
 * This implements the "Dynamic Price Action & Polarity Reversal" rules:
 *
 * THREE PRICE-ACTION STATES:
 *
 *   1. INSIDE_CHANNEL (minClose ≤ price ≤ maxClose):
 *      Price is between historical extremes. The absolute minimum distance
 *      to either boundary determines which is the nearest S/R.
 *      → support = minClose, resistance = maxClose (unchanged)
 *
 *   2. BULLISH_BREAKOUT (price > maxClose):
 *      The price has broken ABOVE the historical ceiling.
 *      The breached maxClose can NO LONGER be labeled as 'r:' — it has
 *      been overtaken from below and now acts as a retest floor.
 *      → support = maxClose (polarity reversal: former resistance → support)
 *      → resistance = price + (ADR × 1.5) — projected volatility ceiling
 *
 *   3. BEARISH_BREAKDOWN (price < minClose):
 *      The price has broken BELOW the historical floor.
 *      The breached minClose can NO LONGER be labeled as 's:' — it has
 *      been pierced downward and now acts as overhead resistance.
 *      → resistance = minClose (polarity reversal: former support → resistance)
 *      → support = price - (ADR × 1.5) — projected volatility floor
 *
 * ADR (Average Daily Range):
 *   Computed as the mean of (high - low) across the lookback window.
 *   This represents the instrument's typical daily volatility and is used
 *   to project realistic next targets when the channel is breached.
 *
 * WHY THIS WORKS FOR ARGENTINE FIXED-INCOME:
 *   - LECAPs/BONCAPs trend strongly due to macro shifts (BCRA rate changes)
 *   - When a bond breaks its 30-day high, that level becomes the new floor
 *     on retests (institutional stop-losses and limit orders cluster there)
 *   - Using ADR × 1.5 for projected targets is analogous to ATR-based
 *     targets in forex — standard practice for volatility-normalized levels
 *
 * @param ticker - Instrument ticker (e.g., "T30J7")
 * @param currentPrice - Live price per $1 VN (1.XXXX scale)
 * @param ohlcData - Array of DailyOHLC records (sorted by date ASC)
 * @param lookbackDays - How many calendar days to look back (default 30)
 * @returns HistoricalSRResult with polarity-adjusted S/R levels
 */
export function calculateHistoricalSR(
  ticker: string,
  currentPrice: number,
  ohlcData: HistoricalOHLC[],
  lookbackDays: number = 30,
): HistoricalSRResult {
  // ═══════════════════════════════════════════════════════════════════
  // V6.0.1: Exclude today's date from the lookback.
  // V6.0.2/V6.1.0: Use Argentina timezone (UTC-3) for date comparison.
  // ═══════════════════════════════════════════════════════════════════
  const todayStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  // Filter to this ticker, valid closes, AND NOT today's date
  const tickerData = ohlcData.filter(
    r => r.ticker === ticker
      && r.close > 0
      && isFinite(r.close)
      && r.date !== todayStr,
  );

  // Take only the last `lookbackDays` records (already sorted by date ASC)
  const relevantData = tickerData.slice(-lookbackDays);

  if (relevantData.length === 0 || !currentPrice || currentPrice <= 0) {
    // No historical data — return fallback with isHistorical=false
    return {
      support: currentPrice > 0 ? currentPrice * 0.98 : 0,
      resistance: currentPrice > 0 ? currentPrice * 1.02 : 0,
      currentPrice: currentPrice || 0,
      distToSupport: 2.0,
      distToResistance: 2.0,
      channelPosition: 50,
      daysUsed: 0,
      isHistorical: false,
      polarity: 'INSIDE_CHANNEL',
      avgDailyRange: 0,
      atr: 0,
      rawSupport: 0,
      rawResistance: 0,
    };
  }

  // ── Step 1: Find structural extremes from past closes ──
  let minClose = Infinity;
  let maxClose = -Infinity;

  // ── V6.2.0: True Range (TR) / Average True Range (ATR) ──
  // Replaces simple ADR (high - low) with True Range, which also
  // accounts for gap openings: TR = max(H-L, |H-prevC|, |L-prevC|)
  // On gap days (BCRA rate decisions, long weekends), ATR captures
  // the full move while ADR would underestimate volatility.
  // On normal days (no gap), TR = H - L, so ATR = ADR (transparent).
  let trSum = 0;
  let trCount = 0;
  let prevClose: number | null = null; // Track previous day's close for TR calc

  // Shared scale normalizer — OHLC may be in 100-scale or 1.XXXX scale
  const SCALE_THRESHOLD = 10;

  for (let i = 0; i < relevantData.length; i++) {
    const day = relevantData[i];

    // Accumulate min/max closes for structural S/R levels
    if (day.close > 0 && isFinite(day.close)) {
      minClose = Math.min(minClose, day.close);
      maxClose = Math.max(maxClose, day.close);
    }

    // ── True Range Calculation ──
    // Requires valid high and low for the intraday component
    if (day.high > 0 && day.low > 0 && isFinite(day.high) && isFinite(day.low)) {
      // Normalize scale
      const dayHigh = day.high > SCALE_THRESHOLD ? day.high / 100 : day.high;
      const dayLow  = day.low  > SCALE_THRESHOLD ? day.low  / 100 : day.low;

      // Intraday range (same component as old ADR)
      const intradayRange = dayHigh - dayLow;

      let trueRange: number;
      if (prevClose !== null && isFinite(prevClose)) {
        // Full True Range: max of (H-L, |H-prevClose|, |L-prevClose|)
        const gapUp   = Math.abs(dayHigh - prevClose);
        const gapDown = Math.abs(dayLow  - prevClose);
        trueRange = Math.max(intradayRange, gapUp, gapDown);
      } else {
        // First day in lookback: no previous close available, use simple range
        trueRange = intradayRange;
      }

      if (trueRange > 0 && isFinite(trueRange)) {
        trSum += trueRange;
        trCount++;
      }
    }

    // Track this day's close as "previous" for the next iteration
    if (day.close > 0 && isFinite(day.close)) {
      const normalizedClose = day.close > SCALE_THRESHOLD ? day.close / 100 : day.close;
      prevClose = normalizedClose;
    }
  }

  // Safety: if somehow all closes were 0 or invalid
  if (minClose === Infinity || maxClose === -Infinity) {
    return {
      support: currentPrice * 0.98,
      resistance: currentPrice * 1.02,
      currentPrice,
      distToSupport: 2.0,
      distToResistance: 2.0,
      channelPosition: 50,
      daysUsed: 0,
      isHistorical: false,
      polarity: 'INSIDE_CHANNEL',
      avgDailyRange: 0,
      atr: 0,
      rawSupport: 0,
      rawResistance: 0,
    };
  }

  // ── Step 2: Normalize scale ──
  if (minClose > SCALE_THRESHOLD) minClose = minClose / 100;
  if (maxClose > SCALE_THRESHOLD) maxClose = maxClose / 100;

  // ATR (Average True Range) — V6.2.0 upgrade of ADR
  // On gap days, ATR > ADR; on normal days, ATR = ADR. Transparent upgrade.
  const atr = trCount > 0 ? trSum / trCount : (maxClose - minClose) * 0.3;
  const atrSafe = isFinite(atr) && atr > 0 ? atr : currentPrice * 0.005; // Fallback: 0.5% of price

  // avgDailyRange now contains ATR (backward compat — same field name, upgraded value)
  const adrSafe = atrSafe;

  // ── Step 3: DYNAMIC POLARITY REVERSAL ──
  // Store raw values before polarity adjustment (for display metadata)
  const rawSupport = minClose;
  const rawResistance = maxClose;

  let effectiveSupport: number;
  let effectiveResistance: number;
  let polarity: 'INSIDE_CHANNEL' | 'BULLISH_BREAKOUT' | 'BEARISH_BREAKDOWN';

  if (currentPrice > maxClose) {
    // ═════════════════════════════════════════════════════════════════
    // BULLISH BREAKOUT: Price has broken ABOVE historical resistance.
    //
    // The breached maxClose is no longer 'r:' — it has been overtaken
    // from below and becomes the new retest floor ('s:').
    // A projected volatility ceiling above the current price becomes
    // the new dynamic resistance.
    //
    // This prevents the bug where T31Y7 shows a LOWER price as 'r:'
    // when the price is above the historical ceiling — the old ceiling
    // is now support, not resistance.
    // ═════════════════════════════════════════════════════════════════
    polarity = 'BULLISH_BREAKOUT';
    effectiveSupport = maxClose;  // Polarity reversal: R → S
    effectiveResistance = currentPrice + (adrSafe * 1.5);  // Projected ceiling

  } else if (currentPrice < minClose) {
    // ═════════════════════════════════════════════════════════════════
    // BEARISH BREAKDOWN: Price has broken BELOW historical support.
    //
    // The breached minClose is no longer 's:' — it has been pierced
    // downward and now acts as overhead resistance ('r:').
    // A projected volatility floor below the current price becomes
    // the new dynamic support.
    // ═════════════════════════════════════════════════════════════════
    polarity = 'BEARISH_BREAKDOWN';
    effectiveResistance = minClose;  // Polarity reversal: S → R
    effectiveSupport = currentPrice - (adrSafe * 1.5);  // Projected floor
    // Safety: support can't be negative
    effectiveSupport = Math.max(0.0001, effectiveSupport);

  } else {
    // ═════════════════════════════════════════════════════════════════
    // INSIDE CHANNEL: Price is between historical extremes.
    // Standard S/R assignment — minClose = support, maxClose = resistance.
    // The nearestSR determination (which level is closer) is done
    // by the caller based on distToSupport vs distToResistance.
    // ═════════════════════════════════════════════════════════════════
    polarity = 'INSIDE_CHANNEL';
    effectiveSupport = minClose;
    effectiveResistance = maxClose;
  }

  // ── Step 4: Calculate distances to EFFECTIVE (polarity-adjusted) levels ──
  // These are ALWAYS positive because effectiveSupport < price < effectiveResistance
  // after polarity adjustment (guaranteed by construction).
  const distToSupport = ((currentPrice - effectiveSupport) / effectiveSupport) * 100;
  const distToResistance = ((effectiveResistance - currentPrice) / currentPrice) * 100;

  // Channel position: 0% at effective support, 100% at effective resistance
  const range = effectiveResistance - effectiveSupport;
  const channelPosition = range > 0
    ? Math.min(100, Math.max(0, ((currentPrice - effectiveSupport) / range) * 100))
    : 50;

  return {
    support: effectiveSupport,
    resistance: effectiveResistance,
    currentPrice,
    distToSupport: isFinite(distToSupport) && distToSupport >= 0 ? distToSupport : 0,
    distToResistance: isFinite(distToResistance) && distToResistance >= 0 ? distToResistance : 0,
    channelPosition: isFinite(channelPosition) ? channelPosition : 50,
    daysUsed: relevantData.length,
    isHistorical: true,
    polarity,
    avgDailyRange: isFinite(adrSafe) ? adrSafe : 0,
    atr: isFinite(atrSafe) ? atrSafe : 0,
    rawSupport,
    rawResistance,
  };
}

/**
 * V6.1.0: Calculate the nearest S/R level from historical data
 * with POLARITY-AWARE label assignment.
 *
 * After polarity reversal, the labels are always correct:
 *   - BULLISH_BREAKOUT: nearest is support (the retest floor)
 *   - BEARISH_BREAKDOWN: nearest is resistance (the overhead ceiling)
 *   - INSIDE_CHANNEL: whichever is closer to the current price
 *
 * @param currentPrice - Live price per $1 VN
 * @param ohlcData - Historical OHLC records for this ticker
 * @param lookbackDays - Calendar days to look back (default 30)
 * @returns The nearest S/R level and type, or null if no data
 */
export function calculateHistoricalNearestSR(
  currentPrice: number,
  ohlcData: HistoricalOHLC[],
  lookbackDays: number = 30,
): { level: number; type: 'S' | 'R' } | null {
  if (!currentPrice || currentPrice <= 0) return null;

  const sr = calculateHistoricalSR('', currentPrice, ohlcData, lookbackDays);

  if (!sr.isHistorical) {
    return null;
  }

  // V6.1.0: After polarity reversal, support is ALWAYS below price and
  // resistance is ALWAYS above price, so labels are inherently correct.
  // We just need to determine which is CLOSER to the current price.
  if (sr.distToSupport <= sr.distToResistance) {
    return { level: sr.support, type: 'S' };
  } else {
    return { level: sr.resistance, type: 'R' };
  }
}

/**
 * @deprecated Use calculateHistoricalNearestSR instead — this version uses
 * intraday data, NOT true structural S/R from historical closes.
 *
 * Kept as fallback when no DailyOHLC data is available.
 *
 * V6.0.1 HOTFIX: Raw bid/ask NO LONGER used as support/resistance.
 * For liquid Argentine instruments, bid ≈ price, which produces fake 0.00%
 * distance. Now uses change_pct to estimate the day's trading range, which
 * gives meaningful distances even without historical data.
 *
 * Fallback chain:
 *   1. change_pct → derive S/R from day's price movement
 *   2. bid/ask spread → expand into a minimum 1% band (NOT raw bid)
 *   3. Static 2% band around current price
 */
export function calculateNearestSR(
  price: number,
  bid: number | undefined,
  ask: number | undefined,
  changePct: number | undefined,
): { level: number; type: 'S' | 'R' } | null {
  if (!price || price <= 0) return null;

  // ── PRIMARY: estimate S/R from price movement (change_pct) ──
  // This is the most reliable intraday method because it uses
  // the actual day's range rather than the tight bid/ask spread.
  const chg = changePct ?? 0;
  if (Math.abs(chg) > 0.01) {
    if (chg > 0) {
      // Price rising — support is the opening level we bounced from
      const support = price / (1 + Math.abs(chg) / 100);
      return { level: support, type: 'S' };
    } else {
      // Price falling — resistance is the opening level we dropped from
      const resistance = price / (1 - Math.abs(chg) / 100);
      return { level: resistance, type: 'R' };
    }
  }

  // ── SECONDARY: bid/ask spread → expand into minimum 1% band ──
  // V6.0.1: We do NOT use raw bid as support because bid ≈ price
  // for liquid instruments, producing fake 0.00% distance.
  // Instead, we use the spread to estimate a minimum band.
  if (bid && bid > 0 && ask && ask > 0) {
    const spreadHalf = (ask - bid) / 2;
    const midPrice = (bid + ask) / 2;
    // Ensure a minimum 0.5% band on each side (1% total range)
    const minBand = midPrice * 0.005;
    const halfBand = Math.max(spreadHalf, minBand);
    const support = midPrice - halfBand;
    const resistance = midPrice + halfBand;

    const distToSupport = Math.abs((price - support) / price) * 100;
    const distToResistance = Math.abs((resistance - price) / price) * 100;

    if (distToSupport <= distToResistance) {
      return { level: support, type: 'S' };
    } else {
      return { level: resistance, type: 'R' };
    }
  }

  // ── TERTIARY: static 2% band around current price ──
  return { level: price * 0.98, type: 'S' };
}

/**
 * V5.0: Calculate Volume Injection metric.
 * 
 * Compares current session volume against a baseline average.
 * Since we don't have intraday minute-by-minute data, we use:
 *   - IOL volume (cantidadOperada) as current volume
 *   - data912 volume as notional reference
 *   - Estimate average daily volume from volume / hours_elapsed
 *   - Compare against a heuristic baseline
 * 
 * Returns: { ratio, label }
 *   NORMAL: ratio 0-2x
 *   X2: ratio 2-3x
 *   X3: ratio 3-5x
 *   X5: ratio 5-10x
 *   EXPLOSIVO: ratio > 10x
 */
export function calculateVolumeInjection(
  iolVolume: number,
  data912Volume: number,
  changePct: number | undefined,
): { ratio: number; label: 'NORMAL' | 'X2' | 'X3' | 'X5' | 'EXPLOSIVO' } {
  // Use IOL volume as primary (it's real traded volume)
  // Fall back to data912 notional volume
  const currentVolume = iolVolume || data912Volume || 0;

  if (currentVolume <= 0) {
    return { ratio: 0, label: 'NORMAL' };
  }

  // Estimate baseline: we approximate average volume from the change_pct
  // and current volume. In a normal session, volume distributes roughly
  // uniformly. If change_pct is large, volume tends to be above average.
  //
  // Heuristic: "average" daily volume ≈ current volume (assuming mid-session)
  // Then ratio = acceleration factor based on price momentum
  // 
  // More pragmatic: use the raw data912 volume as a proxy for "normal"
  // and IOL volume as "current". If IOL > data912, it's injection.
  //
  // Best approach for sandbox: use a composite signal.
  // 1. If we have both volumes, ratio = iolVolume / max(1, data912Volume / 10)
  // 2. If only one, estimate from change momentum
  
  let ratio = 1.0;

  if (iolVolume > 0 && data912Volume > 0) {
    // IOL is real quantity, data912 is notional ARS
    // Normalize: data912 notional / typical_lecap_price ≈ quantity
    // Typical LECAP price is ~1.0-1.2 per VN unit
    const estimatedAvgQty = data912Volume / 1.1; // rough average daily quantity
    if (estimatedAvgQty > 0) {
      // If IOL volume > estimated average, there's injection
      // But since IOL is cumulative intraday, compare against
      // a fraction of data912 (which is also intraday cumulative)
      ratio = iolVolume / (estimatedAvgQty * 0.3 + 1); // .3 factor for partial session
    }
  } else if (iolVolume > 0) {
    // Only IOL volume — estimate from absolute level
    // LECAP typical volume: 100K-500K nominal is normal
    // > 1M is notable, > 5M is high
    if (iolVolume >= 5_000_000) ratio = 5.0;
    else if (iolVolume >= 2_000_000) ratio = 3.0;
    else if (iolVolume >= 1_000_000) ratio = 2.0;
    else ratio = 1.0;
  } else if (data912Volume > 0) {
    // Only data912 notional — similar heuristic
    if (data912Volume >= 50_000_000) ratio = 5.0;
    else if (data912Volume >= 20_000_000) ratio = 3.0;
    else if (data912Volume >= 10_000_000) ratio = 2.0;
    else ratio = 1.0;
  }

  // Boost ratio if there's strong price movement (volume + move = injection)
  const chg = Math.abs(changePct ?? 0);
  if (chg > 1.0) ratio *= 1.5;
  else if (chg > 0.5) ratio *= 1.2;

  // Classify
  let label: 'NORMAL' | 'X2' | 'X3' | 'X5' | 'EXPLOSIVO';
  if (ratio >= 10) label = 'EXPLOSIVO';
  else if (ratio >= 5) label = 'X5';
  else if (ratio >= 3) label = 'X3';
  else if (ratio >= 2) label = 'X2';
  else label = 'NORMAL';

  return { ratio: Math.round(ratio * 10) / 10, label };
}

/**
 * V5.0: Calculate the ACTION SCORE — "El Gatillador Cuantitativo"
 * 
 * Crosses 3 variables in real-time:
 *   1. Distance to S/R (< 0.5% = "a tiro de gatillo")
 *   2. Volume Injection (≥ X3 = institutional entry)
 *   3. Presión del Book (buying/selling pressure)
 * 
 * Returns: { score: 0-100, label, reason }
 *   GATILLAR YA: Price at S/R <0.5% + Volume ≥ X3 + Pressure strongly favoring
 *   ATRACTIVO: Approaching key zone + volume rising or pressure loading
 *   NEUTRAL: Sideways, far from zones, no real liquidity
 *   SIN SEÑAL: No data available
 */
export function calculateActionScore(
  distanceToSR: number,
  srType: 'S' | 'R' | null,
  volumeInjectionLabel: 'NORMAL' | 'X2' | 'X3' | 'X5' | 'EXPLOSIVO',
  volumeRatio: number,
  presionPuntas: number | null,
  spreadNeto: number,
  deltaTIR: number | null,
): { score: number; label: 'GATILLAR YA' | 'ATRACTIVO' | 'NEUTRAL' | 'SIN SEÑAL'; reason: string } {
  let score = 0;
  const reasons: string[] = [];

  // ── Factor 1: Distance to S/R (0-40 points) ──
  // Closer to S/R = higher score (price is at a decision point)
  if (distanceToSR <= 0) {
    // Already AT or PAST the level — maximum urgency
    score += 40;
    reasons.push(srType === 'S' ? 'Testeando soporte' : 'Rompieron resistencia');
  } else if (distanceToSR < 0.3) {
    score += 38;
    reasons.push(`A ${distanceToSR.toFixed(2)}% de ${srType === 'S' ? 'soporte' : 'resistencia'}`);
  } else if (distanceToSR < 0.5) {
    score += 32;
    reasons.push(`A ${distanceToSR.toFixed(2)}% de ${srType === 'S' ? 'soporte' : 'resistencia'}`);
  } else if (distanceToSR < 1.0) {
    score += 20;
    reasons.push(`Acercándose a zona (${distanceToSR.toFixed(1)}%)`);
  } else if (distanceToSR < 2.0) {
    score += 10;
  }
  // > 2%: no points for proximity

  // ── Factor 2: Volume Injection (0-35 points) ──
  const volScore = (() => {
    switch (volumeInjectionLabel) {
      case 'EXPLOSIVO': return 35;
      case 'X5': return 30;
      case 'X3': return 25;
      case 'X2': return 15;
      case 'NORMAL': return 5;
    }
  })();
  score += volScore;
  if (volumeInjectionLabel !== 'NORMAL') {
    reasons.push(`Volumen ${volumeInjectionLabel} (${volumeRatio.toFixed(1)}x)`);
  }

  // ── Factor 3: Pressure Direction (0-25 points) ──
  // V7.0-FASE1: Ahora usa el ratio de desbalance Top-5 del order book.
  // Pressure must AGREE with the trade direction:
  // - Near SUPPORT → buying pressure is good (bounce confirmation)
  // - Near RESISTANCE → selling pressure is bad (but break through = good)
  // - DESBALANCE COMPRA (ratio ≥ 2x) = trigger especial
  // - DESBALANCE EXTREMO (ratio ≥ 3x) = trigger máximo
  if (presionPuntas !== null) {
    if (srType === 'S' && presionPuntas > 1.2) {
      // Near support + buying pressure = good entry
      score += 25;
      reasons.push('Presión compradora en soporte');
    } else if (srType === 'R' && presionPuntas > 1.3) {
      // Near resistance + strong buying = potential breakout
      score += 22;
      reasons.push('Presión compradora rompiendo resistencia');
    } else if (srType === 'S' && presionPuntas < 0.8) {
      // Near support + selling pressure = risk of breakdown
      score += 5;
      reasons.push('Presión vendedora en soporte (riesgo)');
    } else if (srType === 'R' && presionPuntas < 0.8) {
      // Near resistance + selling pressure = rejection likely
      score += 8;
      reasons.push('Presión vendedora en resistencia');
    } else if (presionPuntas > 1.0) {
      score += 12;
      reasons.push('Presión compradora');
    } else {
      score += 5;
    }

    // V7.0-FASE1: Bonus por desbalance de book significativo
    if (presionPuntas >= 3) {
      // Desbalance EXTREMO: compra triplica la oferta → máximo urgency
      score += 10;
      reasons.push('DESBALANCE EXTREMO (3x compra)');
    } else if (presionPuntas >= 2) {
      // Desbalance COMPRA: compra duplica la oferta → high urgency
      score += 6;
      reasons.push('DESBALANCE COMPRA (2x)');
    }
  } else {
    // No pressure data — neutral
    score += 8;
  }

  // ── Bonus: Spread Neto positive (carry confirms) ──
  if (spreadNeto > 0.3) {
    score += 5;
    reasons.push('Carry positivo');
  }

  // ── Bonus: ΔTIR positive (momentum confirms) ──
  if (deltaTIR !== null && deltaTIR > 0.03) {
    score += 5;
    reasons.push('Momentum alcista');
  }

  // ── Cap at 100 ──
  score = Math.min(100, score);

  // ── Classify ──
  let label: 'GATILLAR YA' | 'ATRACTIVO' | 'NEUTRAL' | 'SIN SEÑAL';

  // GATILLAR YA: Must be VERY close to S/R (<0.5%) + Volume ≥ X3 + Pressure agreeing
  const isNearSR = distanceToSR < 0.5;
  const hasVolume = volumeInjectionLabel === 'X3' || volumeInjectionLabel === 'X5' || volumeInjectionLabel === 'EXPLOSIVO';
  const pressureAgrees = presionPuntas !== null && (
    (srType === 'S' && presionPuntas > 1.1) ||
    (srType === 'R' && presionPuntas > 1.2)
  );

  if (isNearSR && hasVolume && pressureAgrees && score >= 70) {
    label = 'GATILLAR YA';
  } else if (score >= 50) {
    label = 'ATRACTIVO';
  } else if (score >= 25) {
    label = 'NEUTRAL';
  } else {
    label = 'SIN SEÑAL';
  }

  const reason = reasons.length > 0 ? reasons.join(' · ') : 'Sin señales activas';

  return { score, label, reason };
}

// ════════════════════════════════════════════════════════════════════════
// V7.0-FASE2: TRIGGER CRÍTICO DE SALIDA — Take Profit Adaptativo
//
// Evalúa posiciones en cartera para determinar si se activa el
// trigger de salida. Se activa cuando:
//
//   1. GANANCIA DIRECTA en precio ≥ +1.00% en la jornada
//      (el activo se sobrecompró, rendimiento comprimido)
//
//   2. PRESIÓN COMPRADORA del Top-5 BID cede:
//      - Ratio < 0.8 (venta domina la compra)
//      - O ratio cayó >50% desde su pico de la sesión
//      (los grandes compradores se retiraron)
//
// RETORNO: AdaptiveTakeProfitResult con acción sugerida y destino
// ════════════════════════════════════════════════════════════════════════
export function calculateAdaptiveTakeProfit(params: {
  /** Ganancia directa en precio en la jornada (%) — change_pct del instrumento */
  sessionGainPct: number;
  /** Ratio Top-5 Bid / Top-5 Ask (null si sin datos) */
  top5PressureRatio: number | null;
  /** Pct de desbalance Top-5 (positivo = compra, negativo = venta) */
  top5PressurePct: number | null;
  /** Etiqueta del desbalance del book */
  bookImbalanceLabel: string;
  /** El instrumento está anestesiado? */
  anestesiado: boolean;
  /** Score unificado del instrumento */
  unifiedScore: number;
  /** Action score label */
  actionLabel: string;
  /** Ticker del instrumento */
  ticker: string;
}): AdaptiveTakeProfitResult {
  const {
    sessionGainPct,
    top5PressureRatio,
    top5PressurePct,
    bookImbalanceLabel,
    anestesiado,
    unifiedScore,
    actionLabel,
    ticker,
  } = params;

  // ── Condición 1: Ganancia directa ≥ +1.00% ──
  const isPriceSurge = sessionGainPct >= 1.0;

  // ── Condición 2: Presión compradora cediendo ──
  // El desbalance del Top-5 BID pierde fuerza compradora:
  //   - Ratio < 0.8 → venta domina
  //   - DESBALANCE VENTA → señal clara de retroceso
  //   - Pct < -20% → presión neta vendedora
  let bidPressureCeding = false;
  let pressureCedingReason = '';

  if (top5PressureRatio !== null && top5PressureRatio < 0.8) {
    bidPressureCeding = true;
    pressureCedingReason = `Ratio BID/ASK ${top5PressureRatio.toFixed(2)}x < 0.8 — venta domina`;
  } else if (bookImbalanceLabel === 'DESBALANCE VENTA') {
    bidPressureCeding = true;
    pressureCedingReason = 'Book en DESBALANCE VENTA — compradores se retiraron';
  } else if (top5PressurePct !== null && top5PressurePct < -20) {
    bidPressureCeding = true;
    pressureCedingReason = `Presión neta ${top5PressurePct.toFixed(0)}% — flujo vendedor`;
  }

  // ── Determinar tipo de trigger ──
  let triggerType: AdaptiveTakeProfitResult['triggerType'] = 'NONE';
  let reason = '';
  let suggestedAction: AdaptiveTakeProfitResult['suggestedAction'] = 'MANTENER';
  let suggestedDestination = 'Mantener posición';

  if (isPriceSurge && bidPressureCeding) {
    // COMBINED: Doble confirmación — muy fuerte
    triggerType = 'COMBINED';
    reason = `${ticker} subió +${sessionGainPct.toFixed(2)}% y presión BID cede. ${pressureCedingReason}. Ganancia realizada, salir antes de reversión.`;
    suggestedAction = 'VENDER';
    suggestedDestination = 'CAUCIÓN (Preservar Capital Líquido)';
  } else if (isPriceSurge) {
    // PRICE_SURGE: Precio subió ≥ 1% — rendimiento comprimido, sobrecomprado
    triggerType = 'PRICE_SURGE';
    reason = `${ticker} subió +${sessionGainPct.toFixed(2)}% en la jornada — rendimiento comprimido, sobrecomprado. Tomar ganancia antes de corrección.`;
    suggestedAction = 'TOMAR_GANANCIA';
    suggestedDestination = 'CAUCIÓN (Preservar Capital Líquido)';
  } else if (bidPressureCeding) {
    // BID_PRESSURE_CEDING: Los compradores se fueron — riesgo de caída
    triggerType = 'BID_PRESSURE_CEDING';
    reason = `${ticker}: ${pressureCedingReason}. Sin soporte comprador, riesgo de reversión bajista.`;
    suggestedAction = 'TOMAR_GANANCIA';
    suggestedDestination = 'CAUCIÓN (Protección ante reversión)';
  }

  return {
    triggered: triggerType !== 'NONE',
    reason,
    triggerType,
    sessionGainPct,
    bidPressureCeding,
    suggestedAction,
    suggestedDestination,
  };
}

// ============================================================
// FASE 2: Volume Velocity & Flow Metrics
// ============================================================

/**
 * Volume Velocity — VROC (Volume Rate of Change)
 *
 * Compara el volumen del bloque de 5 minutos actual contra el promedio histórico
 * del mismo bloque horario (mismo blockIndex) en días anteriores.
 *
 * CONCEPTO: Detecta aceleración anómala de volumen intradía que puede indicar:
 *   - Entrada de un operador grande (institutional flow)
 *   - News flow que genera interés repentino
 *   - Acumulación/distribución agresiva
 *
 * UMBRALES:
 *   VROC > 500% → ANOMALÍA X5+ (evento extremo, momentum trigger)
 *   VROC > 300% → ANOMALÍA X3 (anomalía fuerte, momentum trigger)
 *   VROC > 150% → ACELERACIÓN (volumen elevado, sin trigger)
 *   VROC ≤ 150% → NORMAL (volumen en rango esperado)
 *
 * EJEMPLO: Bloque actual = 1,200,000 vs promedio histórico = 350,000
 *   VROC = (1,200,000 / 350,000) * 100 = 342.8%
 *   → ANOMALÍA X3, momentumTrigger = true
 */
export function calculateVolumeVelocity(params: {
  ticker: string;
  currentBlockVolume: number;
  historicalSameSlot: number[];
  currentIolVolume?: number;
}): CockpitScore['volumeVelocity'] {
  const { ticker, currentBlockVolume, historicalSameSlot } = params;

  // Edge case: no volume in current block
  if (currentBlockVolume <= 0) {
    return {
      vroc: 0,
      momentumTrigger: false,
      label: 'NORMAL',
      currentBlockVolume: 0,
      avgHistoricalVolume: 0,
    };
  }

  // Calculate average historical volume for this same time slot
  const avgHistorical =
    historicalSameSlot.length > 0
      ? historicalSameSlot.reduce((a, b) => a + b, 0) / historicalSameSlot.length
      : currentBlockVolume;

  // Volume Rate of Change (%)
  const vroc = avgHistorical > 0 ? (currentBlockVolume / avgHistorical) * 100 : 0;

  // Determine label and momentum trigger based on VROC thresholds
  let label: 'NORMAL' | 'ACELERACIÓN' | 'ANOMALÍA X3' | 'ANOMALÍA X5+';
  let momentumTrigger: boolean;

  if (vroc > 500) {
    label = 'ANOMALÍA X5+';
    momentumTrigger = true;
  } else if (vroc > 300) {
    label = 'ANOMALÍA X3';
    momentumTrigger = true;
  } else if (vroc > 150) {
    label = 'ACELERACIÓN';
    momentumTrigger = false;
  } else {
    label = 'NORMAL';
    momentumTrigger = false;
  }

  return {
    vroc,
    momentumTrigger,
    label,
    currentBlockVolume,
    avgHistoricalVolume: avgHistorical,
  };
}

/**
 * Price snapshot interface for iceberg order detection.
 * Represents a single reading of the order book at a point in time.
 */
export interface PriceSnapshotForDetection {
  timestamp: string | number;
  askPrice: number;
  askDepth: number;      // Total quantity at best ask
  lastPrice: number;
}

/**
 * Iceberg Order Detection
 *
 * Detecta la presencia de una orden iceberg (orden oculta de gran tamaño)
 * analizando el patrón de regeneración en la punta ASK del order book.
 *
 * CONCEPTO: Una orden iceberg es una orden límite de gran volumen que solo
 * muestra una fracción de su tamaño real en el order book. Cuando la porción
 * visible es ejecutada, una nueva porción aparece automáticamente al mismo
 * precio, regenerando la profundidad (askDepth) sin que el precio cambie.
 *
 * PATRÓN DETECTADO:
 *   1. askDepth cae significativamente (>50% reducción) — se ejecutó contra la punta
 *   2. askPrice NO baja (se mantiene o sube) — la oferta no retrocedió
 *   3. askDepth se regenera — nueva porción de la orden iceberg aparece
 *
 * CONFIANZA:
 *   ≥3 snapshots con patrón → ALTA
 *   2 snapshots con patrón → MEDIA
 *   <2 snapshots → BAJA (datos insuficientes)
 *
 * EJEMPLO:
 *   t0: askPrice=1.155, askDepth=50000
 *   t1: askPrice=1.155, askDepth=15000  (70% reducción, precio igual)
 *   t2: askPrice=1.155, askDepth=48000  (regeneración, precio igual)
 *   → Iceberg detectado, confianza ALTA
 */
export function detectIcebergOrder(params: {
  ticker: string;
  snapshots: PriceSnapshotForDetection[];
  currentAskPrice: number;
  currentAskDepth: number;
}): CockpitScore['icebergDetected'] {
  const { ticker, snapshots, currentAskPrice, currentAskDepth } = params;

  // Need at least 2 snapshots to detect the pattern
  if (snapshots.length < 2) {
    return {
      detected: false,
      confidence: 'BAJA',
      reason: 'Datos insuficientes',
    };
  }

  let patternMatches = 0;

  // Compare consecutive snapshots looking for the iceberg pattern:
  // 1. Depth dropped significantly (>50% reduction) in a previous snapshot
  // 2. Ask price did NOT decrease (stayed same or increased)
  // 3. Depth has now recovered (regenerated)
  for (let i = 0; i < snapshots.length - 1; i++) {
    const prev = snapshots[i];
    const next = snapshots[i + 1];

    // Check for significant depth reduction
    if (prev.askDepth > 0) {
      const depthReduction = (prev.askDepth - next.askDepth) / prev.askDepth;

      // Pattern: depth dropped >50% AND price did not decrease
      if (depthReduction > 0.5 && next.askPrice >= prev.askPrice) {
        patternMatches++;
      }
    }
  }

  // Also check if the current state shows recovery from a previous drop
  // Look for the minimum depth point and check if current depth has recovered
  const minDepthSnapshot = snapshots.reduce(
    (min, snap) => (snap.askDepth < min.askDepth ? snap : min),
    snapshots[0]
  );

  // If there was a significant drop and current depth recovered, that's additional evidence
  if (
    minDepthSnapshot.askDepth > 0 &&
    currentAskDepth > minDepthSnapshot.askDepth * 2 &&
    currentAskPrice >= minDepthSnapshot.askPrice
  ) {
    patternMatches++;
  }

  // Determine detection and confidence
  const detected = patternMatches >= 1;

  let confidence: 'BAJA' | 'MEDIA' | 'ALTA';

  if (!detected) {
    confidence = 'BAJA';
  } else if (patternMatches >= 3) {
    confidence = 'ALTA';
  } else {
    confidence = 'MEDIA';
  }

  let reason: string;
  if (!detected) {
    reason = 'No se detectó patrón de regeneración en order book';
  } else {
    reason = `Patrón iceberg detectado en ${ticker}: profundidad ASK cayó y se regeneró ${patternMatches} vez/veces sin retroceso de precio. Orden oculta probable en $${currentAskPrice.toFixed(4)}`;
  }

  return {
    detected,
    confidence,
    priceLevel: detected ? currentAskPrice : undefined,
    reason,
  };
}

/**
 * Market Sweep Detection
 *
 * Detecta un barrido de mercado (sweep) cuando el precio salta 2+ micro-puntas
 * (tick levels) en una sola lectura, indicando que una orden de mercado agresiva
 * barrió múltiples niveles de liquidez.
 *
 * CONCEPTO: Un market sweep ocurre cuando un operador envía una orden market
 * de tamaño suficiente como para ejecutarse contra múltiples niveles del order
 * book. Esto resulta en un salto de precio que "salta" (skips) niveles
 * intermedios de precio.
 *
 * LÓGICA:
 *   1. Si tickSize no está disponible, se deriva como fracción del spread
 *   2. Se calcula cuántos niveles de tick fueron saltados
 *   3. Si se saltaron ≥2 niveles → market sweep detectado
 *
 * EJEMPLO: previousPrice=1.1550, currentPrice=1.1580, tickSize=0.0005
 *   priceChange = 1.1580 - 1.1550 = 0.0030
 *   levelsSkipped = floor(0.0030 / 0.0005) - 1 = floor(6) - 1 = 5
 *   → Sweep detectado, direction=UP, 5 niveles saltados
 */
export function detectMarketSweep(params: {
  ticker: string;
  previousPrice: number;
  currentPrice: number;
  previousAsk: number;
  currentAsk: number;
  tickSize?: number;
  timeDeltaMs?: number;
}): CockpitScore['marketSweep'] {
  const { ticker, previousPrice, currentPrice, previousAsk, currentAsk, tickSize } = params;

  // Edge case: invalid prices
  if (previousPrice <= 0 || currentPrice <= 0) {
    return {
      detected: false,
      levelsSkipped: 0,
      direction: 'UP',
      reason: 'Precios inválidos para detección de sweep',
    };
  }

  // Derive tickSize if not provided: use a fraction of the spread as micro-level estimate
  const effectiveTickSize =
    tickSize ?? Math.max(0.0001, (previousAsk - previousPrice) * 0.25);

  // Calculate price change
  const priceChange = currentPrice - previousPrice;

  // Calculate levels skipped (subtract 1 because moving 1 tickSize is normal)
  const levelsSkipped = Math.max(0, Math.floor(Math.abs(priceChange) / effectiveTickSize) - 1);

  // Determine if this is a market sweep (2+ micro-puntas skipped)
  const detected = levelsSkipped >= 2;
  const direction: 'UP' | 'DOWN' = priceChange > 0 ? 'UP' : 'DOWN';

  let reason: string;
  if (!detected) {
    reason = `Movimiento de precio normal (${levelsSkipped} nivel saltado, umbral: 2)`;
  } else {
    reason = `Market sweep en ${ticker}: precio ${direction === 'UP' ? 'subió' : 'bajó'} ${Math.abs(priceChange).toFixed(4)} saltando ${levelsSkipped} micro-puntas (${direction}) en una sola lectura`;
  }

  return {
    detected,
    levelsSkipped,
    direction,
    reason,
  };
}

// ============================================================
// FASE 3: Companion Curve & Arbitraje de Curva Compañera
// ============================================================

/**
 * Define Companion Clusters — Agrupa instrumentos por tipo y vencimiento
 *
 * CONCEPTO: Los instrumentos "compañeros" son aquellos que comparten
 * perfil de vencimiento y duration similar, formando tramos naturales
 * de la curva de tasas. Un desvío de spread entre compañeros indica
 * una oportunidad de arbitraje intra-curva.
 *
 * CLUSTERS:
 *   CORTAS:  days ≤ 60   (letras/bonos cortos — alta liquidez)
 *   MEDIAS:  60 < days ≤ 180  (letras/bonos medios — carry principal)
 *   LARGAS:  days > 180  (letras/bonos largos — sensibilidad máxima)
 *
 * FILTRO: Se eliminan clusters con < 2 miembros (sin par mínimo).
 *
 * EJEMPLO: LECAPs disponibles →
 *   LECORTAS: [T15J7 (42d), T30J7 (57d)]
 *   LEMEDIAS: [S30O6 (196d), S12E5 (135d)]
 *   LELARGAS: (solo 1 instrumento → eliminado)
 */
export function defineCompanionClusters(instruments: Instrument[]): CompanionCluster[] {
  const clusters: CompanionCluster[] = [];

  // Group by type first
  const lecaps = instruments.filter(i => i.type === 'LECAP' && i.days > 0);
  const boncaps = instruments.filter(i => i.type === 'BONCAP' && i.days > 0);

  // Helper: create sub-clusters by maturity band
  const createSubClusters = (type: 'LECAP' | 'BONCAP', items: Instrument[]) => {
    const shortItems = items.filter(i => i.days <= 60).sort((a, b) => a.days - b.days);
    const midItems = items.filter(i => i.days > 60 && i.days <= 180).sort((a, b) => a.days - b.days);
    const longItems = items.filter(i => i.days > 180).sort((a, b) => a.days - b.days);

    const prefix = type === 'LECAP' ? 'LE' : 'BONCAP';

    if (shortItems.length >= 2) {
      const avgDur = shortItems.reduce((s, i) => s + Math.abs(durationMod(i.days, i.tem)), 0) / shortItems.length;
      const avgTEM = shortItems.reduce((s, i) => s + i.tem, 0) / shortItems.length;
      clusters.push({
        id: `${prefix}CORTAS`,
        label: `${type === 'LECAP' ? 'Letras' : 'Bonos'} Cortas (≤60d)`,
        instrumentType: type,
        tickers: shortItems.map(i => i.ticker),
        avgDuration: avgDur,
        avgTEM,
      });
    }

    if (midItems.length >= 2) {
      const avgDur = midItems.reduce((s, i) => s + Math.abs(durationMod(i.days, i.tem)), 0) / midItems.length;
      const avgTEM = midItems.reduce((s, i) => s + i.tem, 0) / midItems.length;
      clusters.push({
        id: `${prefix}MEDIAS`,
        label: `${type === 'LECAP' ? 'Letras' : 'Bonos'} Medias (61-180d)`,
        instrumentType: type,
        tickers: midItems.map(i => i.ticker),
        avgDuration: avgDur,
        avgTEM,
      });
    }

    if (longItems.length >= 2) {
      const avgDur = longItems.reduce((s, i) => s + Math.abs(durationMod(i.days, i.tem)), 0) / longItems.length;
      const avgTEM = longItems.reduce((s, i) => s + i.tem, 0) / longItems.length;
      clusters.push({
        id: `${prefix}LARGAS`,
        label: `${type === 'LECAP' ? 'Letras' : 'Bonos'} Largas (>180d)`,
        instrumentType: type,
        tickers: longItems.map(i => i.ticker),
        avgDuration: avgDur,
        avgTEM,
      });
    }
  };

  createSubClusters('LECAP', lecaps);
  createSubClusters('BONCAP', boncaps);

  return clusters;
}

/**
 * Calculate Curve Spread Anomaly — Desvío de spread entre compañeros
 *
 * CONCEPTO: Mide cuánto se desvía el spread de TEM actual entre un par
 * de instrumentos compañeros contra su propio promedio histórico de 5 días.
 * Un desvío > 1.5σ indica que la curva está "desarbitrada" y presenta
 * oportunidad de rotación.
 *
 * PASO 1: Para cada par dentro del cluster, calcular spread actual
 *   spreadTEM = TEM_mayor - TEM_menor (siempre positivo en curva normal)
 *
 * PASO 2: Calcular promedio móvil y desvío estándar del spread 5d
 *   Usando CurveSpreadHistory (o derivado de DailyOHLC como fallback)
 *
 * PASO 3: Calcular Z-score del spread actual
 *   zScore = (spread_actual - promedio_5d) / sigma_5d
 *
 * PASO 4: Clasificar dirección
 *   Si el instrumento compressiona tasa (sube precio) → LEADING
 *   Si el instrumento se rezaga (no sube) → LAGGING
 *
 * EJEMPLO: T15J7 y T30J7 en cluster LECORTAS
 *   Spread actual: 0.12% TEM
 *   Promedio 5d: 0.05% TEM
 *   σ = 0.03%
 *   Z = (0.12 - 0.05) / 0.03 = 2.33σ → ANOMALÍA
 *   T30J7 se rezaga (LAGGING), beneficio estimado: 7pb de TEM
 */
export function calculateCurveSpreadAnomaly(params: {
  ticker: string;
  companionTicker: string;
  clusterId: string;
  tickerTEM: number;
  companionTEM: number;
  tickerDays: number;
  companionDays: number;
  tickerChange: number;          // daily change % (positive = price up = rate compression)
  companionChange: number;
  historicalSpreads: number[];   // last 5 days of spread values
}): CurveSpreadAnomaly {
  const {
    ticker, companionTicker, clusterId,
    tickerTEM, companionTEM,
    tickerDays, companionDays,
    tickerChange, companionChange,
    historicalSpreads,
  } = params;

  // Determine order: shorter maturity first
  const isShorter = tickerDays <= companionDays;
  const shorterTEM = isShorter ? tickerTEM : companionTEM;
  const longerTEM = isShorter ? companionTEM : tickerTEM;
  const shorterTicker = isShorter ? ticker : companionTicker;
  const longerTicker = isShorter ? companionTicker : ticker;
  const shorterChange = isShorter ? tickerChange : companionChange;
  const longerChange = isShorter ? companionChange : tickerChange;

  // Current spread (positive = normal upward-sloping curve)
  const spreadTEM = longerTEM - shorterTEM;

  // Historical average and standard deviation
  const n = historicalSpreads.length;
  const avgSpread5d = n > 0 ? historicalSpreads.reduce((a, b) => a + b, 0) / n : spreadTEM;
  const variance = n > 1
    ? historicalSpreads.reduce((s, v) => s + (v - avgSpread5d) ** 2, 0) / n
    : 0;
  const sigma5d = Math.sqrt(variance);

  // Z-score: how many standard deviations from the 5d average
  const spreadZScore = sigma5d > 0.0001 ? (spreadTEM - avgSpread5d) / sigma5d : 0;

  // Anomaly detection: |Z| > 1.5
  const isAnomaly = Math.abs(spreadZScore) > 1.5;

  // Direction classification:
  // If the ticker (not companion) compresses rate (price up, change > 0)
  // and the companion doesn't follow → ticker is LEADING, companion is LAGGING
  let direction: 'LEADING' | 'LAGGING';

  if (tickerChange > 0.1 && companionChange < tickerChange * 0.5) {
    // Ticker is compressing rate faster than companion → ticker LEADS
    direction = 'LEADING';
  } else if (companionChange > 0.1 && tickerChange < companionChange * 0.5) {
    // Companion is compressing faster → ticker LAGS behind
    direction = 'LAGGING';
  } else if (spreadZScore > 1.5) {
    // Spread expanded: the longer-dated instrument is LAGGING (yields more than normal)
    direction = isShorter ? 'LAGGING' : 'LEADING';
  } else if (spreadZScore < -1.5) {
    // Spread compressed: the shorter-dated instrument is LEADING (yields less = price up)
    direction = isShorter ? 'LEADING' : 'LAGGING';
  } else {
    direction = spreadTEM > avgSpread5d ? 'LAGGING' : 'LEADING';
  }

  // Estimated benefit in basis points of TEM
  const estimatedBenefitPb = Math.abs(spreadTEM - avgSpread5d) * 100;

  return {
    ticker,
    companionTicker,
    clusterId,
    spreadTEM,
    spreadZScore,
    isAnomaly,
    direction,
    estimatedBenefitPb,
  };
}

/**
 * Detect Curve Rotation Trigger — Señal de rotación por anomalía de curva
 *
 * CONCEPTO: Evalúa si un instrumento en cartera debe rotarse hacia
 * un compañero rezagado, o si una entrada directa está justificada
 * por un desarme desarbitrado en la curva.
 *
 * CASO A — Con posición en cartera:
 *   Si el activo compressiona tasa (Flow metrics F2: VROC > 300% o DESBALANCE COMPRA)
 *   Y un compañero se rezaga (isAnomaly, direction=LAGGING, Z > 1.5)
 *   → ROTACIÓN: "Vender [Ticker Cartera] y Comprar [Ticker Rezagado]"
 *
 * CASO B — Sin posición en cartera:
 *   Si se detecta desarme desarbitrado entre dos activos del mismo cluster
 *   El rezagado tiene direction=LAGGING con Z > 1.5
 *   → ENTRADA: "Comprar [Ticker Rezagado]"
 *
 * RETORNA: rotationAlert para el CockpitScore del instrumento afectado
 */
export function detectCurveRotationTrigger(params: {
  scores: CockpitScore[];
  position: { ticker: string } | null;
  curveAnomalies: CurveSpreadAnomaly[];
}): Map<string, CockpitScore['rotationAlert']> {
  const { scores, position, curveAnomalies } = params;
  const alertMap = new Map<string, CockpitScore['rotationAlert']>();

  // Index anomalies by ticker
  const anomalyByTicker = new Map<string, CurveSpreadAnomaly>();
  for (const anomaly of curveAnomalies) {
    anomalyByTicker.set(anomaly.ticker, anomaly);
    anomalyByTicker.set(anomaly.companionTicker, anomaly);
  }

  // Score lookup
  const scoreByTicker = new Map<string, CockpitScore>();
  for (const s of scores) {
    scoreByTicker.set(s.ticker, s);
  }

  // CASO A: Position in portfolio — check if held instrument should rotate
  if (position) {
    const heldScore = scoreByTicker.get(position.ticker);
    const heldAnomaly = anomalyByTicker.get(position.ticker);

    if (heldScore && heldAnomaly && heldAnomaly.isAnomaly) {
      // Check if held instrument shows Phase 2 compression signals
      const hasFlowCompression =
        (heldScore.volumeVelocity?.momentumTrigger === true) ||
        (heldScore.bookImbalanceLabel === 'DESBALANCE COMPRA') ||
        (heldScore.bookImbalanceLabel === 'DESBALANCE EXTREMO') ||
        (heldScore.sessionGainPct !== undefined && heldScore.sessionGainPct > 0.5);

      if (hasFlowCompression && heldAnomaly.direction === 'LEADING') {
        // Held instrument is LEADING (compressing rate) — look for LAGGING companion to rotate into
        const companionAnomaly = curveAnomalies.find(
          a => a.ticker === heldAnomaly.companionTicker || a.companionTicker === heldAnomaly.companionTicker
        );

        if (companionAnomaly && companionAnomaly.isAnomaly && companionAnomaly.direction === 'LAGGING') {
          const laggingTicker = companionAnomaly.direction === 'LAGGING'
            ? companionAnomaly.ticker
            : companionAnomaly.companionTicker;

          alertMap.set(laggingTicker, {
            type: 'ROTATION',
            sellTicker: position.ticker,
            buyTicker: laggingTicker,
            benefitPb: companionAnomaly.estimatedBenefitPb,
            reason: `ACCIÓN: ROTACIÓN DISPONIBLE | Vender ${position.ticker} y Comprar ${laggingTicker} | Beneficio estimado: +${companionAnomaly.estimatedBenefitPb.toFixed(1)}pb de TEM (Razón: Arbitraje por desvío de Curva Compañera)`,
          });
        }
      }

      // Also: if held instrument is LAGGING behind a companion that's leading
      if (heldAnomaly.direction === 'LAGGING' && heldAnomaly.spreadZScore > 1.5) {
        const leadingTicker = heldAnomaly.companionTicker;
        alertMap.set(position.ticker, {
          type: 'ROTATION',
          sellTicker: position.ticker,
          buyTicker: leadingTicker,
          benefitPb: heldAnomaly.estimatedBenefitPb,
          reason: `ACCIÓN: ROTACIÓN DISPONIBLE | Vender ${position.ticker} y Comprar ${leadingTicker} | Beneficio estimado: +${heldAnomaly.estimatedBenefitPb.toFixed(1)}pb de TEM (Razón: ${position.ticker} rezagado vs Curva Compañera)`,
        });
      }
    }
  }

  // CASO B: No position — detect arbitrage entry opportunities
  for (const anomaly of curveAnomalies) {
    if (!anomaly.isAnomaly || anomaly.spreadZScore <= 1.5) continue;
    if (position && (anomaly.ticker === position.ticker || anomaly.companionTicker === position.ticker)) continue;

    // Determine which ticker is LAGGING (the one to buy)
    if (anomaly.direction === 'LAGGING') {
      // This ticker is lagging — it's cheap relative to its companion
      if (!alertMap.has(anomaly.ticker)) {
        alertMap.set(anomaly.ticker, {
          type: 'ENTRY',
          sellTicker: '',
          buyTicker: anomaly.ticker,
          benefitPb: anomaly.estimatedBenefitPb,
          reason: `ACCIÓN: ENTRADA POR ARBITRAJE | Comprar ${anomaly.ticker} (Razón: Curva Compañera desarbitrada vs ${anomaly.companionTicker}, desvío ${anomaly.spreadZScore.toFixed(1)}σ)`,
        });
      }
    }
  }

  return alertMap;
}

/**
 * Calculate Spread Dispersal Velocity — Propuesta Abierta V7.0-FASE3
 *
 * CONCEPTO: Mide la velocidad a la que se amplía o comprime el spread
 * bid-ask de un instrumento. El spread del order book es un leading
 * indicator de microestructura que anticipa movimientos de precio
 * 30-60 segundos antes.
 *
 * LÓGICA:
 *   1. Calcula spread actual en basis points: ((ask - bid) / mid) * 10000
 *   2. Calcula promedio y σ del spread de los últimos 5 días
 *   3. Calcula Z-score del spread actual
 *   4. Determina dirección:
 *      - TIGHTENING: spread < avg * 0.7 (comprimiéndose → liquidez converge)
 *      - WIDENING: spread > avg * 1.3 (expandiéndose → market makers se retiran)
 *      - STABLE: dentro del rango esperado
 *   5. Señal:
 *      - TIGHTENING + Z < -1.5 → CONVERGENCIA (movimiento inminente)
 *      - WIDENING + Z > 1.5 → DIVERGENCIA (retirada de liquidez)
 *
 * VENTAJA PREDICTIVA: Combinado con F2 triggers:
 *   - Market Sweep + CONVERGENCIA → Señal de entrada de alta confianza
 *   - Market Sweep + DIVERGENCIA → Falso barrido, NO entrar
 *   - VROC Anomalía + CONVERGENCIA → Confirmación de flujo institucional
 *
 * EJEMPLO: LECAP S30O6
 *   Spread actual: 5bp (bid=1.1550, ask=1.1555)
 *   Promedio 5d: 12bp
 *   σ = 4bp
 *   Z = (5 - 12) / 4 = -1.75σ
 *   → TIGHTENING + CONVERGENCIA: movimiento de precio inminente
 */
export function calculateSpreadDispersalVelocity(params: {
  currentBid: number;
  currentAsk: number;
  historicalSpreads5d: number[];  // Daily average spreads in bp for last 5 days
  timeDeltaMinutes?: number;      // Minutes since last reading (for velocity calc)
  previousSpreadBps?: number;     // Previous spread reading in bp
}): SpreadDispersalVelocity {
  const {
    currentBid,
    currentAsk,
    historicalSpreads5d,
    timeDeltaMinutes,
    previousSpreadBps,
  } = params;

  // Calculate current spread in basis points
  const midPrice = (currentBid + currentAsk) / 2;
  if (midPrice <= 0 || currentAsk <= 0 || currentBid <= 0) {
    return {
      currentSpreadBps: 0,
      avgSpread5d: 0,
      velocity: 0,
      direction: 'STABLE',
      zScore: 0,
      signal: 'NEUTRAL',
    };
  }

  const currentSpreadBps = ((currentAsk - currentBid) / midPrice) * 10000;

  // Historical average and standard deviation
  const n = historicalSpreads5d.length;
  const avgSpread5d = n > 0 ? historicalSpreads5d.reduce((a, b) => a + b, 0) / n : currentSpreadBps;
  const variance = n > 1
    ? historicalSpreads5d.reduce((s, v) => s + (v - avgSpread5d) ** 2, 0) / n
    : 0;
  const sigma5d = Math.sqrt(variance);

  // Z-score
  const zScore = sigma5d > 0.01 ? (currentSpreadBps - avgSpread5d) / sigma5d : 0;

  // Direction
  let direction: 'TIGHTENING' | 'WIDENING' | 'STABLE';
  if (avgSpread5d > 0 && currentSpreadBps < avgSpread5d * 0.7) {
    direction = 'TIGHTENING';
  } else if (avgSpread5d > 0 && currentSpreadBps > avgSpread5d * 1.3) {
    direction = 'WIDENING';
  } else {
    direction = 'STABLE';
  }

  // Velocity (bp per minute)
  let velocity = 0;
  if (previousSpreadBps !== undefined && timeDeltaMinutes && timeDeltaMinutes > 0) {
    velocity = (currentSpreadBps - previousSpreadBps) / timeDeltaMinutes;
  }

  // Signal determination
  let signal: 'CONVERGENCIA' | 'DIVERGENCIA' | 'NEUTRAL';
  if (direction === 'TIGHTENING' && zScore < -1.5) {
    signal = 'CONVERGENCIA';  // Spread comprimido → movimiento inminente
  } else if (direction === 'WIDENING' && zScore > 1.5) {
    signal = 'DIVERGENCIA';   // Spread expandido → retirada de liquidez
  } else {
    signal = 'NEUTRAL';
  }

  return {
    currentSpreadBps,
    avgSpread5d,
    velocity,
    direction,
    zScore,
    signal,
  };
}
