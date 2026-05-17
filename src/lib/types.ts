export interface LiveInstrument {
  ticker: string;
  name: string;
  price: number;
  bid: number;
  ask: number;
  tem: number;
  tir: number;
  daysToMaturity: number;
  volume: number;
  lastUpdate: Date;
}

export interface ManualInstrument {
  ticker: string;
  name: string;
  price: number;
  tem: number;
  tir: number;
  daysToMaturity: number;
  manual: true;
}

export type Instrument = LiveInstrument | ManualInstrument;

export interface RotationAnalysis {
  origen: string;
  destino: string;
  diasOrigen: number;
  diasDestino: number;
  temOrigen: number;
  temDestino: number;
  spreadBruto: number;
  comisionAmortizada: number;
  spreadNeto: number;
  paybackDays: number;
  recomendacion: 'ROTAR' | 'MANTENER' | 'ESPERAR';
}

export interface HistoricalPrice {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  instrumentId: string;
}

export interface PriceSnapshot {
  timestamp: Date;
  price: number;
  bid: number;
  ask: number;
  volume: number;
  dailyVolume: number;
  isReset: boolean;
  instrumentId: string;
}

export interface InstrumentDailyState {
  instrumentId: string;
  lastResetDate: string;
  dailyVolume: number;
  lastSnapshotTime: Date | null;
  lastIOLVolume: number;
  consecutiveSnapshots: number;
  firstSnapshotTime: Date | null;
  isActive: boolean;
}

export interface DailyVolumeRecord {
  id?: number;
  instrumentId: string;
  date: string;
  totalVolume: number;
  firstSnapshot?: string;
  lastSnapshot?: string;
  snapshotCount: number;
  createdAt?: Date;
}

export interface MomentumSnapshot {
  timestamp: number;
  tem: number;
  price: number;
  volume: number;
}

export interface MomentumMetrics {
  ticker: string;
  deltaTIR: number;
  deltaTEM: number;
  gDiaNeta: number;
  paybackDays: number;
  durationMod: number;
  momentum: number;
  aceleracion: number;
  volumenRelativo: number;
}

export interface CockpitVerdict {
  verdict: 'SALTO_TACTICO' | 'SALTO_TEORICO' | 'PUNTO_CARAMELO' | 'NEUTRO' | 'CASTIGAR';
  score: number;
  spreadNeto: number;
  effectiveDeltaTIR: number;
  liquidityPenalty: number;
  reason: string;
}

export interface Config {
  comisionTotal: number;
  ventanaDias: number;
  minVolumenDiario: number;
  maxDesviacionTEM: number;
}
