// ═══════════════════════════════════════════════════════════════════
// ARB//RADAR V5.0 — SCANNER EDITION — Core Types
// High-Speed Price Action / Scalping / Intraday Terminal
// ═══════════════════════════════════════════════════════════════════

// ── Instrument Types ──────────────────────────────────────────────

export interface Instrument {
  ticker: string;
  type: 'LECAP' | 'BONCAP';
  expiry: string;
  days: number;
  price: number;
  change: number;
  tna: number;
  tem: number;
  tir: number;
  gananciaDirecta: number;
  vsPlazoFijo: string;
  dm?: number;
  // IOL Level 2
  iolVolume?: number;
  iolBid?: number;
  iolAsk?: number;
  iolBidDepth?: number;
  iolAskDepth?: number;
  iolMarketPressure?: number;
  iolStatus?: 'online' | 'offline' | 'no_data';
  data912Volume?: number;
}

export interface Config {
  caucion1d: number;
  caucion7d: number;
  caucion30d: number;
  riesgoPais: number;
  comisionTotal: number;
  capitalDisponible: number;
}

export interface Position {
  ticker: string;
  entryPrice: number;
  vn: number;
  entryDate: string;
  precioConComision?: number;
}

export interface Transaction {
  id: string;
  type: 'BUY' | 'SELL';
  ticker: string;
  price: number;
  vn: number;
  date: string;
  pnl?: number;
  precioConComision?: number;
}

// ── Live Data Types (from /api/letras) ────────────────────────────

export interface LiveInstrument {
  ticker: string;
  type: 'LECAP' | 'BONCAP';
  days_to_expiry: number;
  last_price: number;
  bid: number;
  ask: number;
  vpv: number;
  paridad: number;
  tir: number;
  tem: number;
  tna: number;
  spread_neto: number;
  ganancia_directa: number;
  payback_days: number;
  change_pct: number;
  volume: number;
  low_liquidity: boolean;
  price_estimated: boolean;
  tem_emision: number | null;
  fecha_vencimiento: string;
  updated_at: string;
  source: 'arg_notes' | 'arg_bonds';
  delta_tir: number | null;
  last_close: number | null;
  iol_volume?: number;
  iol_bid?: number;
  iol_ask?: number;
  iol_bid_depth?: number;
  iol_ask_depth?: number;
  iol_market_pressure?: number;
  iol_status?: 'online' | 'offline' | 'no_data';
}

export interface LetrasApiResponse {
  instruments: LiveInstrument[];
  caucion_proxy: {
    tna_promedio: number;
    tem_caucion: number;
    source: string;
  };
  refreshed_at: string;
  sources: {
    data912_notes: { ok: boolean; count: number; latency_ms: number };
    data912_bonds: { ok: boolean; count: number; boncaps_matched: number; latency_ms: number };
    argentinadatos: { ok: boolean; count: number; latency_ms: number };
  };
  stats?: {
    total_instruments: number;
    lecaps: number;
    boncaps: number;
  };
}

// ── Cockpit Score Types ───────────────────────────────────────────

export interface CockpitScore {
  ticker: string;
  type: 'LECAP' | 'BONCAP';
  spreadNetoScore: number;
  deltaTIRScore: number;
  presionPuntasScore: number;
  upsideCapitalScore: number;
  velocidadScore: number;
  cockpitScore: number;
  verdict: 'SALTO_TACTICO' | 'PUNTO_CARAMELO' | 'ATRACTIVO' | 'NEUTRAL' | 'EVITAR';
  verdictReason: string;
  spreadNeto: number;
  deltaTIR: number | null;
  presionPuntas: number | null;
  upsideCapital: number;
  days: number;
  withinHorizon: boolean;
}

// ── Dolar Rate Types ──────────────────────────────────────────────

export interface DolarRate {
  nombre: string;
  compra: number;
  venta: number;
  casa: string;
  fechaActualizacion: string;
  variacion?: number;
}

// ── Market Truth Types ────────────────────────────────────────────

export type ConfidenceLevel = 'ALTA' | 'MEDIA' | 'BAJA' | 'CRITICA';

export interface SourceResult<T> {
  value: T | null;
  source: string;
  latency_ms: number;
  ok: boolean;
  timestamp: string;
  detail?: string;
}

export interface RPConsensus {
  value: number;
  confidence: ConfidenceLevel;
  confidence_pct: number;
  sources_used: number;
  sources_total: number;
  agreement: boolean;
  best_source: string;
  all_sources: SourceResult<number>[];
  spread_between_sources: number;
}

export interface MEPConsensus {
  value: number;
  confidence: ConfidenceLevel;
  confidence_pct: number;
  sources_used: number;
  sources_total: number;
  agreement: boolean;
  best_source: string;
  all_sources: SourceResult<number>[];
  spread_between_sources: number;
}

export interface MarketTruthResponse {
  riesgo_pais: RPConsensus;
  mep: MEPConsensus;
  timestamp: string;
  next_refresh: string;
  engine_version: string;
  stale?: boolean;
  stale_reason?: string;
}

// ── Momentum Types ────────────────────────────────────────────────

export interface MomentumData {
  ticker: string;
  deltaTIR: number | null;
  aceleracion: number;
  tendencia: '↑↑' | '↑' | '→' | '↓' | '↓↓';
  tirHistory: number[];
  esTapado: boolean;
  tapadoReason: string;
}

// ── Scanner Grid Types (V5.0 NEW) ─────────────────────────────────

export interface ScannerCell {
  ticker: string;
  type: 'LECAP' | 'BONCAP';
  days: number;
  price: number;
  tem: number;
  change: number;
  spreadNeto: number;
  cockpitScore: number;
  verdict: string;
  deltaTIR: number | null;
  iolMarketPressure: number | null;
  volume: number;
  heatmapValue: number; // 0-1 normalized for color
}

export type ScannerSortKey = 'tem' | 'change' | 'spreadNeto' | 'cockpitScore' | 'volume' | 'deltaTIR' | 'days';
export type ScannerViewMode = 'heatmap' | 'table' | 'compact';

// ── Tab Types ─────────────────────────────────────────────────────

export type TabId = 'scanner' | 'cockpit' | 'mercado' | 'configuracion';
