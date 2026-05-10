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
  dm?: number; // V1.5: Duration Modified from historico_precios.json

  // ── V3.1: IOL Level 2 Fields (from Cerebro Táctico local script) ──
  iolVolume?: number;              // @deprecated Use iolVolumeNotional for ARS or iolVolumeQty for titles
  iolBid?: number;                 // best bid price from IOL puntas
  iolAsk?: number;                 // best ask price from IOL puntas
  iolAvgDailyVolume?: number;      // estimated average daily volume
  iolStatus?: 'online' | 'offline' | 'no_data'; // IOL data availability
  iolLiquidityAlert?: boolean;     // True when volume < 10% avg daily
  iolHuntingAdjustment?: number;   // Score adjustment from Filtro de Verdad
  iolBidDepth?: number;          // V3.2.1: Total quantity across all compra puntas
  iolAskDepth?: number;          // V3.2.1: Total quantity across all venta puntas
  iolMarketPressure?: number;    // V3.2.1: bid_depth / ask_depth ratio (>1 = buying pressure)
  iolVerdict?: string;           // V3.2.1: Human-readable Filtro de Verdad verdict
  data912Volume?: number;        // V3.4: Notional ARS volume from data912 (fallback for VOL column)

  // ── V3.5: IOL Volume Separation (Price Action Engine) ──
  iolVolumeNotional?: number;     // V3.5: Monto total en ARS from IOL — PRIMARY for radar VOL comparison
  iolVolumeQty?: number;          // V3.5: Cantidad de títulos from IOL — informational only
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

export interface RotationAnalysis {
  fromTicker: string;
  toTicker: string;
  fromTEM: number;
  toTEM: number;
  spreadBruto: number;
  comisionAmortizada: number;
  spreadNeto: number;
  diasPE: number;
  toDays: number;
  evaluacion: 'MUY ATRACTIVO' | 'ATRACTIVO' | 'MARGINAL' | 'NO CONVIENE' | 'TRAMPA';
}

export interface SwingSignal {
  ticker: string;
  type: 'LECAP' | 'BONCAP';
  durationMod: number;
  priceMinus10bps: number;
  priceMinus25bps: number;
  pricePlus10bps: number;
  pricePlus25bps: number;
  momentumScore: number;
  spreadScore: number;
  sensitivityScore: number;
  liquidityScore: number;
  compositeScore: number;
  signal: 'BUY STRONG' | 'BUY MODERATE' | 'NEUTRAL' | 'SELL/AVOID';
}

export interface DolarRate {
  nombre: string;
  compra: number;
  venta: number;
  casa: string;
  fechaActualizacion: string;
  variacion?: number; // V1.5.2: daily variation % from API
}

export interface CurveAnomaly {
  longerTicker: string;
  shorterTicker: string;
  longerDays: number;
  shorterDays: number;
  longerTEM: number;
  shorterTEM: number;
  temDiff: number;
  severity: 'CRITICA' | 'ALTA' | 'MEDIA';
  anomalyType: 'INVERSION' | 'APLANAMIENTO' | 'SALTO_ANORMAL' | 'HUECO';
  anomalyDescription: string;
  action: 'EVITAR' | 'EVALUAR_SALIDA' | 'PRECAUCION' | 'MONITOREAR';
  actionDetail: string;
  recommendation: string;
}

export interface CompositeSignal {
  ticker: string;
  type: 'LECAP' | 'BONCAP';
  momentumScore: number;
  spreadScore: number;
  durationScore: number;
  compositeScore: number;
  signal: 'COMPRA FUERTE' | 'COMPRA' | 'NEUTRAL' | 'VENDER' | 'EVITAR';
  signalColor: string;
  signalEmoji: string;
  momentumLabel: string;
  spreadLabel: string;
  durationLabel: string;
  diasRecuperoComision: number;
  gDiaNeta: number;
  rae: number;
  priceMinus10bps: number;
  priceMinus25bps: number;
  pricePlus10bps: number;
  pricePlus25bps: number;
  durationMod: number;
}

export interface DiagnosticResult {
  curveShape: 'NORMAL' | 'PLANA' | 'INVERTIDA' | 'CON_ANOMALIAS';
  curveShapeDescription: string;
  anomalyCount: number;
  anomalies: CurveAnomaly[];
  bestOpportunity: { ticker: string; reason: string; signal: string; };
  positionVerdict: 'MANTENER' | 'ROTAR' | 'VENDER' | 'COMPRAR' | 'SIN_POSICION';
  positionVerdictReason: string;
  riesgoPaisStatus: 'NORMAL' | 'PRECAUCION' | 'ALERTA' | 'PELIGRO';
  mepAlert: boolean;
  mepMessage: string;
}

export interface SimulationRecord {
  id: string;
  timestamp: string;
  fromTicker: string;
  toTicker: string;
  sellPrice: number;
  buyPrice: number;
  sellPriceManual: boolean;
  buyPriceManual: boolean;
  spreadNeto: number;
  spreadBruto: number;
  evaluacion: string;
  paybackDays: number;
  nuevosNominales: number;
  capitalNetoSalida: number;
  capitalSobrante: number;
}

export interface ExternalHistoryRecord {
  fecha: string;
  ticker: string;
  operacion: string;
  tem: number;
  precioConComision: number;
  duration: number;
  capitalNeto: number;
  notas: string;
  gananciaAcumulada: number;
}

export interface Snapshot {
  timestamp: string;
  instruments: Instrument[];
}

export interface MomentumData {
  ticker: string;
  deltaTIR: number | null;
  aceleracion: number;
  tendencia: '↑↑' | '↑' | '→' | '↓' | '↓↓';
  tirHistory: number[];
  esTapado: boolean;
  tapadoReason: string;
}

// V1.5: Support/Resistance data from historico_precios.json
export interface SRData {
  ticker: string;
  soporte: number;
  resistencia: number;
  precioActual: number;
  distanciaSoporte: number;
  distanciaResistencia: number;
  posicionEnCanal: number;
  upsideCapital: number;
  downsideRisk: number;
  minTEM15d: number;
  maxTEM15d: number;
  temPosition: 'CERCANO_MIN' | 'CERCANO_MAX' | 'MEDIO';
}

// V1.5: Price history record from historico_precios.json
export interface PriceHistoryEntry {
  p: number;
  tna: number;
  tem: number;
  dm: number;
}

// V1.7: Rotation Score with Capital Run Potential
export interface RotationScoreV17 {
  ticker: string;
  compositeScore: number;
  upsideCapital: number;
  downsideRisk: number;
  temPosition: 'CERCANO_MIN' | 'CERCANO_MAX' | 'MEDIO';
  deltaTIR: number | null;
  spreadVsCaucion: number;
  tem: number;
  temCompressionScore: number;
  capitalRunScore: number;
  tacticalScore: number;
  isPositionExhausted: boolean;
  shouldRotateForRun: boolean;
}

// V3.3-PRO Phase 2: Cockpit Score — Unified scalping signal
export interface CockpitScore {
  ticker: string;
  type: 'LECAP' | 'BONCAP';
  
  // ── Component Scores (0-10 each) ──
  spreadNetoScore: number;
  deltaTIRScore: number;
  presionPuntasScore: number;
  upsideCapitalScore: number;
  velocidadScore: number;
  
  // ── Composite ──
  cockpitScore: number;
  
  // ── Verdict ──
  verdict: 'SALTO_TACTICO' | 'PUNTO_CARAMELO' | 'ATRACTIVO' | 'NEUTRAL' | 'EVITAR';
  verdictReason: string;
  
  // ── Raw data for display ──
  spreadNeto: number;
  deltaTIR: number | null;
  presionPuntas: number | null;
  upsideCapital: number;
  days: number;
  withinHorizon: boolean;
}

export type TabId = 'mercado' | 'cockpit' | 'curvas' | 'estrategias' | 'cartera' | 'historial' | 'historico' | 'configuracion';

// ═══════════════════════════════════════════════════════════════
// V2.0 — Live Data API Types (data912 + ArgentinaDatos merge)
// ═══════════════════════════════════════════════════════════════

/** Raw response from data912.com /live/arg_notes */
export interface Data912Note {
  symbol: string;
  q_bid: number;
  px_bid: number;
  px_ask: number;
  q_ask: number;
  v: number;       // volume (notional ARS)
  q_op: number;    // number of operations
  c: number;       // last price
  pct_change: number;
}

/** Raw response from api.argentinadatos.com /v1/finanzas/letras */
export interface ArgDatosLetra {
  ticker: string;
  fechaEmision: string | null;
  fechaVencimiento: string;
  tem: number | null;
  vpv: number;
}

/** Raw response from api.argentinadatos.com /v1/finanzas/tasas/plazoFijo */
export interface ArgDatosPlazoFijo {
  entidad: string;
  logo: string | null;
  tnaClientes: number | null;
  tnaNoClientes: number | null;
  enlace: string | null;
}

/** Merged instrument from /api/letras — the V2.0 live data response */
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

  // ── V3.4: IOL Level 2 Fields (enriched from IOL API) ──
  iol_volume?: number;              // @deprecated Use iol_volume_notional for ARS or iol_volume_qty for titles
  iol_bid?: number;
  iol_ask?: number;
  iol_bid_depth?: number;
  iol_ask_depth?: number;
  iol_market_pressure?: number;
  iol_status?: 'online' | 'offline' | 'no_data';

  // ── V3.5: IOL Volume Separation (Price Action Engine) ──
  iol_volume_notional?: number;     // V3.5: Monto total en ARS — PRIMARY for radar VOL comparison
  iol_volume_qty?: number;          // V3.5: Cantidad de títulos — informational only
}

/** Full /api/letras response (V2.0.1 with multi-source) */
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