import type { Instrument, Config, Position, Transaction } from './types';

export const DEFAULT_CONFIG: Config = {
  caucion1d: 17.0,
  caucion7d: 19.2,
  caucion30d: 18.5,
  riesgoPais: 528,
  comisionTotal: 0.30,
  capitalDisponible: 500000,
};

export const DEFAULT_POSITION: Position | null = null;

export const INITIAL_TRANSACTIONS: Transaction[] = [];

export const SAMPLE_INSTRUMENTS: Instrument[] = [
  { ticker: 'S1L5', type: 'LECAP', expiry: '2025-07-15', days: 51, price: 1.0085, change: 0.12, tna: 22.5, tem: 1.89, tir: 1.89, gananciaDirecta: 0.42, vsPlazoFijo: 'SUPERIOR' },
  { ticker: 'T5W3', type: 'BONCAP', expiry: '2025-08-20', days: 87, price: 1.0195, change: -0.05, tna: 21.8, tem: 1.83, tir: 1.83, gananciaDirecta: 0.38, vsPlazoFijo: 'SUPERIOR' },
  { ticker: 'S30A6', type: 'LECAP', expiry: '2025-10-30', days: 158, price: 1.0420, change: 0.08, tna: 20.5, tem: 1.72, tir: 1.72, gananciaDirecta: 0.28, vsPlazoFijo: 'MARGINAL' },
  { ticker: 'T15E7', type: 'BONCAP', expiry: '2025-09-15', days: 113, price: 1.0265, change: 0.15, tna: 21.2, tem: 1.78, tir: 1.78, gananciaDirecta: 0.33, vsPlazoFijo: 'SUPERIOR' },
  { ticker: 'S12E5', type: 'LECAP', expiry: '2025-11-12', days: 171, price: 1.0485, change: -0.03, tna: 20.1, tem: 1.69, tir: 1.69, gananciaDirecta: 0.25, vsPlazoFijo: 'MARGINAL' },
  { ticker: 'T30J7', type: 'BONCAP', expiry: '2025-07-30', days: 66, price: 1.0142, change: 0.22, tna: 22.1, tem: 1.85, tir: 1.85, gananciaDirecta: 0.39, vsPlazoFijo: 'SUPERIOR' },
  { ticker: 'S15J7', type: 'LECAP', expiry: '2025-08-15', days: 82, price: 1.0210, change: 0.10, tna: 21.5, tem: 1.81, tir: 1.81, gananciaDirecta: 0.36, vsPlazoFijo: 'SUPERIOR' },
  { ticker: 'T20S7', type: 'BONCAP', expiry: '2025-09-20', days: 118, price: 1.0280, change: -0.08, tna: 20.8, tem: 1.75, tir: 1.75, gananciaDirecta: 0.30, vsPlazoFijo: 'SUPERIOR' },
];

export const STORAGE_KEYS = {
  INSTRUMENTS: 'arbradar_instruments',
  CONFIG: 'arbradar_config',
  POSITION: 'arbradar_position',
  TRANSACTIONS: 'arbradar_transactions',
  LAST_UPDATE: 'arbradar_lastUpdate',
  RAW_INPUT: 'arbradar_rawInput',
  SIMULATIONS: 'arbradar_simulations',
  EXTERNAL_HISTORY: 'arbradar_externalHistory',
};
