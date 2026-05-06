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
  iolVolume?: number;              // cantidadOperada from IOL
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
  soporte: number;  // min price from last 15 days (V1.8.3: unified 1.XXXX scale)
  resistencia: number;  // max price from last 15 days (V1.8.3: unified 1.XXXX scale)
  precioActual: number;
  distanciaSoporte: number;  // % distance to support
  distanciaResistencia: number;  // % distance to resistance
  posicionEnCanal: number;  // V1.8.4: 0-100% position within S/R channel (0=at support, 100=at resistance)
  upsideCapital: number;    // V1.7: % upside to resistance
  downsideRisk: number;     // V1.7: % downside to support
  minTEM15d: number;        // V1.7: minimum TEM in last 15 days
  maxTEM15d: number;        // V1.7: maximum TEM in last 15 days
  temPosition: 'CERCANO_MIN' | 'CERCANO_MAX' | 'MEDIO';  // V1.7
}

// V1.5: Price history record from historico_precios.json
export interface PriceHistoryEntry {
  p: number;   // price
  tna: number;
  tem: number;
  dm: number;  // duration modified
}

// V1.7: Rotation Score with Capital Run Potential
export interface RotationScoreV17 {
  ticker: string;
  compositeScore: number;         // from calculateCompositeSignal
  upsideCapital: number;          // % upside to resistance
  downsideRisk: number;           // % downside to support
  temPosition: 'CERCANO_MIN' | 'CERCANO_MAX' | 'MEDIO';
  deltaTIR: number | null;        // momentum ΔTIR
  spreadVsCaucion: number;        // spread vs caución
  tem: number;                    // current TEM
  temCompressionScore: number;    // V1.7: 0-10 score for rate compression potential
  capitalRunScore: number;        // V1.7: 0-10 score for upside potential
  tacticalScore: number;          // V1.7: weighted combination of all factors
  isPositionExhausted: boolean;   // V1.7: upside < 0.1% → "POSICIÓN AGOTADA"
  shouldRotateForRun: boolean;    // V1.7: even with similar TEM, better upside + score
}

// V3.3-PRO Phase 2: Cockpit Score — Unified scalping signal
export interface CockpitScore {
  ticker: string;
  type: 'LECAP' | 'BONCAP';
  
  // ── Component Scores (0-10 each) ──
  spreadNetoScore: number;     // 25% weight — Carry inmediato vs Caución
  deltaTIRScore: number;       // 25% weight — Momentum de tasa intradía
  presionPuntasScore: number;  // 20% weight — Presión de puntas (IOL/bid-ask)
  upsideCapitalScore: number;  // 20% weight — Recorrido a resistencia S/R
  velocidadScore: number;      // 10% weight — Penaliza largos, premia cortos
  
  // ── Composite ──
  cockpitScore: number;        // Weighted total (0-10)
  
  // ── Verdict ──
  verdict: 'SALTO_TACTICO' | 'PUNTO_CARAMELO' | 'ATRACTIVO' | 'NEUTRAL' | 'EVITAR';
  verdictReason: string;
  
  // ── Raw data for display ──
  spreadNeto: number;          // TEM - CauciónTEM - comisionAmortizada
  deltaTIR: number | null;     // Rate momentum
  presionPuntas: number | null; // Bid/ask pressure ratio (>1 = buying)
  upsideCapital: number;       // % to resistance
  days: number;                // Days to expiry
  withinHorizon: boolean;      // Within horizon filter (default 45 days — Scalping Extendido)
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
  last_price: number;          // per $1 VN (data912 price / 100)
  bid: number;                 // per $1 VN
  ask: number;                 // per $1 VN
  vpv: number;                 // valor al vencimiento per $100 VN
  paridad: number;             // (price / VPV) * 100
  tir: number;                 // annualized TIR (decimal, e.g. 0.2421)
  tem: number;                 // monthly TEM (decimal, e.g. 0.0197)
  tna: number;                 // annualized from TEM (decimal)
  spread_neto: number;         // TEM - TEM_caucion (decimal)
  ganancia_directa: number;    // (TEM - TEM_caucion) * (days/30)
  payback_days: number;        // days to recover commission
  change_pct: number;          // daily change %
  volume: number;              // notional ARS volume
  low_liquidity: boolean;      // volume below threshold
  price_estimated: boolean;    // bid/ask were 0, using last_price
  tem_emision: number | null;  // TEM at issuance (from ArgentinaDatos)
  fecha_vencimiento: string;   // ISO date
  updated_at: string;          // ISO-8601 timestamp
  source: 'arg_notes' | 'arg_bonds'; // V2.0.1: which data912 endpoint provided the price
  delta_tir: number | null;  // V2.0.2: TIR(live) - TIR(last_close) in decimal, null if no last_close
  last_close: number | null; // V2.0.2: previous close price per $1 VN, derived from pct_change
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
