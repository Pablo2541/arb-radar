import type { Instrument, Config, CockpitScore } from './types';

export function daysFromExpiry(expiry: string): number {
  if (!expiry || typeof expiry !== 'string') return 0;
  let expiryDate: Date;
  if (expiry.includes('/')) {
    const parts = expiry.split('/');
    if (parts.length !== 3) return 0;
    expiryDate = new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
  } else if (expiry.includes('-')) {
    expiryDate = new Date(expiry);
  } else {
    return 0;
  }
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  expiryDate.setHours(0, 0, 0, 0);
  return Math.max(0, Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
}

export function caucionTEMFromTNA(tna: number): number {
  return (Math.pow(1 + tna / 100, 1 / 12) - 1) * 100;
}

export function getCaucionForDays(config: Config, days: number): number {
  const t1 = 1, tna1 = config.caucion1d;
  const t7 = 7, tna7 = config.caucion7d;
  const t30 = 30, tna30 = config.caucion30d;
  if (days <= t1) return tna1;
  if (days <= t7) return tna1 + (tna7 - tna1) * ((days - t1) / (t7 - t1));
  if (days <= t30) return tna7 + (tna30 - tna7) * ((days - t7) / (t30 - t7));
  return tna30;
}

export function spreadVsCaucion(tem: number, config: Config, days: number): number {
  const caucionTNA = getCaucionForDays(config, days);
  const caucionTEM = caucionTEMFromTNA(caucionTNA);
  return tem - caucionTEM;
}

export function durationMod(days: number, tem: number): number {
  if (days <= 0) return 0;
  return -days / (365 * (1 + tem / 100));
}

export function gDiaNeta(tem: number, days: number, comisionTotal: number): number {
  if (days <= 0 || tem <= 0) return 0;
  const totalReturn = Math.pow(1 + tem / 100, days / 30.44) - 1;
  const netReturn = totalReturn - comisionTotal / 100;
  const result = (netReturn / days) * 100;
  return isFinite(result) ? result : 0;
}

export function diasRecuperoComision(tem: number, comisionTotal: number): number {
  if (tem <= 0 || !isFinite(tem)) return 999;
  const dailyReturn = (tem / 100) / 30.44;
  if (dailyReturn <= 0) return 999;
  const result = (comisionTotal / 100) / dailyReturn;
  return isFinite(result) ? result : 999;
}

export function calculateRAE(tem: number): number {
  return (Math.pow(1 + tem / 100, 12) - 1) * 100;
}

export function ensureValidDays(instruments: Instrument[]): Instrument[] {
  return instruments.map(inst => {
    const effectiveRate = inst.tem || inst.tir || 0;
    if (inst.expiry) {
      const calculatedDays = daysFromExpiry(inst.expiry);
      if (calculatedDays >= 0) {
        return { ...inst, days: calculatedDays, tem: effectiveRate, tir: effectiveRate };
      }
    }
    return { ...inst, tem: effectiveRate, tir: effectiveRate };
  });
}

export function getSpreadSignal(spread: number): { label: string; color: string } {
  if (spread > 0.40) return { label: 'MUY ATRACTIVO', color: '#2eebc8' };
  if (spread > 0.25) return { label: 'ATRACTIVO', color: '#2eebc8' };
  if (spread > 0.10) return { label: 'MARGINAL', color: '#fbbf24' };
  return { label: 'EVITAR', color: '#f87171' };
}

/**
 * Calculate CockpitScore — 5-factor scalping signal
 */
export function calculateCockpitScore(
  instrument: Instrument,
  config: Config,
  deltaTIR: number | null,
  iolMarketPressure: number | null,
  upsideCapital: number,
  days: number,
): CockpitScore {
  // Spread Neto Score (25% weight)
  const spreadNeto = spreadVsCaucion(instrument.tem, config, instrument.days);
  const spreadNetoScore = Math.max(0, Math.min(10, (spreadNeto + 1) * (10 / 3)));

  // Delta TIR Score (25% weight)
  let deltaTIRScore = 5;
  if (deltaTIR !== null) {
    deltaTIRScore = Math.max(0, Math.min(10, (deltaTIR + 2) * 2.5));
  }

  // Presión Punta Score (20% weight)
  let presionPuntasScore = 5;
  if (iolMarketPressure !== null) {
    presionPuntasScore = Math.max(0, Math.min(10, iolMarketPressure * 5));
  }

  // Upside Capital Score (20% weight)
  const upsideCapitalScore = Math.max(0, Math.min(10, upsideCapital * 5));

  // Velocidad Score (10% weight) — short = fast = good for scalping
  let velocidadScore = 10;
  if (days > 45) velocidadScore = Math.max(0, 10 - (days - 45) / 10);
  else if (days > 20) velocidadScore = Math.max(5, 10 - (days - 20) / 5);

  // Composite
  const cockpitScore =
    spreadNetoScore * 0.25 +
    deltaTIRScore * 0.25 +
    presionPuntasScore * 0.20 +
    upsideCapitalScore * 0.20 +
    velocidadScore * 0.10;

  // Verdict
  let verdict: CockpitScore['verdict'];
  let verdictReason: string;

  if (cockpitScore >= 8.0) {
    verdict = 'SALTO_TACTICO';
    verdictReason = `Score ${cockpitScore.toFixed(1)} — Señal de salto táctico fuerte`;
  } else if (cockpitScore >= 6.5) {
    verdict = 'PUNTO_CARAMELO';
    verdictReason = `Score ${cockpitScore.toFixed(1)} — Punto caramelo para entrada`;
  } else if (cockpitScore >= 4.5) {
    verdict = 'ATRACTIVO';
    verdictReason = `Score ${cockpitScore.toFixed(1)} — Instrumento atractivo`;
  } else if (cockpitScore >= 2.5) {
    verdict = 'NEUTRAL';
    verdictReason = `Score ${cockpitScore.toFixed(1)} — Sin señal clara`;
  } else {
    verdict = 'EVITAR';
    verdictReason = `Score ${cockpitScore.toFixed(1)} — Evitar entrada`;
  }

  const withinHorizon = days <= 45;

  return {
    ticker: instrument.ticker,
    type: instrument.type,
    spreadNetoScore,
    deltaTIRScore,
    presionPuntasScore,
    upsideCapitalScore,
    velocidadScore,
    cockpitScore,
    verdict,
    verdictReason,
    spreadNeto,
    deltaTIR,
    presionPuntas: iolMarketPressure,
    upsideCapital,
    days,
    withinHorizon,
  };
}
