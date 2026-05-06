// ════════════════════════════════════════════════════════════════════════
// CEREBRO TÁCTICO — ARB//RADAR V3.2.4-PRO
// Motor de actualización de precios con validación IOL Nivel 2
// + Acumulación Histórica (PriceSnapshot + DailyOHLC)
//
// ARQUITECTURA:
//   Nivel 1 (Precios):  data912.com + ArgentinaDatos (estable, broker-focused)
//   Nivel 2 (Volumen):  InvertirOnline API (validación de liquidez real)
//   Destino:            Neon PostgreSQL (refleja en Vercel + terminal local)
//
// MODO DE USO:
//   npx tsx scripts/update-prices.ts           → una sola ejecución
//   npx tsx scripts/update-prices.ts --daemon   → loop cada 60s en horario mercado
//
// VARIABLES DE ENTORNO (.env):
//   DATABASE_URL        → Neon PostgreSQL (pooled URL para conexiones desde PC)
//   IOL_USERNAME        → Email de InvertirOnline
//   IOL_PASSWORD        → Password de InvertirOnline
// ════════════════════════════════════════════════════════════════════════

import { PrismaClient } from '@prisma/client';

// ── Load .env ──────────────────────────────────────────────────────────
import * as fs from 'fs';
import * as path from 'path';

function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
  }
}
loadEnv();

// ── Configuration ──────────────────────────────────────────────────────
const COMISION_TOTAL = 0.003;
const LOW_LIQUIDITY_THRESHOLD = 1_000_000; // ARS notional volume (data912)
const CAUCION_HAIRCUT = 0.02;
const DATA912_NOTES_URL = 'https://data912.com/live/arg_notes';
const DATA912_BONDS_URL = 'https://data912.com/live/arg_bonds';
const ARGDATOS_LETRAS_URL = 'https://api.argentinadatos.com/v1/finanzas/letras';
const ARGDATOS_PF_URL = 'https://api.argentinadatos.com/v1/finanzas/tasas/plazoFijo';
const IOL_TOKEN_URL = 'https://api.invertironline.com/token';
const IOL_COTIZACION_URL = 'https://api.invertironline.com/api/v2/Titulos';
// V3.2.4-FIX: BondTerminal as primary source (real-time), ArgentinaDatos as fallback
const BONDTERMINAL_RIESGO_PAIS_URL = 'https://bondterminal.com/riesgo-pais'; // Primary: real-time value
const ARGDATOS_RIESGO_PAIS_ULTIMO_URL = 'https://api.argentinadatos.com/v1/finanzas/indices/riesgo-pais/ultimo'; // Secondary: may be stale
const ARGDATOS_RIESGO_PAIS_URL = 'https://api.argentinadatos.com/v1/finanzas/indices/riesgo-pais'; // Tertiary fallback

// IOL Volume thresholds for "Filtro de Verdad"
const IOL_LOW_VOLUME_PCT = 0.10; // 10% of average daily = "Baja Liquidez"
const IOL_HUNTING_BOOST = 8;     // Points added to Hunting Score when IOL confirms

// Daemon settings
const DAEMON_INTERVAL_MS = 60_000; // 60 seconds
const IOL_TOKEN_REFRESH_MS = 12 * 60 * 1000; // 12 minutes (token expires at 15) — avoid blind spots

// ── Types ──────────────────────────────────────────────────────────────
interface Data912Note {
  symbol: string;
  q_bid: number;
  px_bid: number;
  px_ask: number;
  q_ask: number;
  v: number;
  q_op: number;
  c: number;
  pct_change: number;
}

interface ArgDatosLetra {
  ticker: string;
  fechaEmision: string | null;
  fechaVencimiento: string;
  tem: number | null;
  vpv: number;
}

interface ArgDatosPlazoFijo {
  entidad: string;
  tnaClientes: number | null;
  tnaNoClientes: number | null;
}

interface LiveInstrument {
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
  // ── IOL Level 2 Fields ──
  iol_volume?: number;          // cantidadOperada from IOL
  iol_bid?: number;             // best bid from IOL puntas
  iol_ask?: number;             // best ask from IOL puntas
  iol_avg_daily_volume?: number;// estimated average daily volume
  iol_status?: 'online' | 'offline' | 'no_data'; // IOL data availability per instrument
  iol_liquidity_alert?: boolean;// True when volume < 10% of avg daily
  iol_bid_depth?: number;       // Total bid depth from IOL puntas
  iol_ask_depth?: number;       // Total ask depth from IOL puntas
  iol_market_pressure?: number; // bid_depth / ask_depth ratio
}

interface IOLCotizacion {
  titulo: {
    simbolo: string;
    descripcion: string;
    pais: string;
    mercado: string;
    tipo: string;
  };
  ultimoPrecio: number;
  variacion: number;
  apertura: number;
  maximo: number;
  minimo: number;
  volumen: number;
  cantidadOperada: number;
  puntas?: {
    compra: Array<{ cantidad: number; precio: number }>;
    venta: Array<{ cantidad: number; precio: number }>;
  };
}

// ── Helpers ────────────────────────────────────────────────────────────

function log(level: 'INFO' | 'WARN' | 'ERROR' | 'OK' | 'LEVEL2', msg: string) {
  const ts = new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const prefix: Record<string, string> = {
    INFO: '[36mℹ[0m',
    WARN: '[33m⚠[0m',
    ERROR: '[31m✖[0m',
    OK: '[32m✔[0m',
    LEVEL2: '[35m◆[0m',
  };
  console.log(`${ts} ${prefix[level] || '●'} ${msg}`);
}

function inferType(ticker: string): 'LECAP' | 'BONCAP' {
  return ticker.startsWith('T') ? 'BONCAP' : 'LECAP';
}

function daysToExpiry(vencimiento: string): number {
  const vto = new Date(vencimiento);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  vto.setHours(0, 0, 0, 0);
  const diff = vto.getTime() - today.getTime();
  return Math.max(0, Math.round(diff / (1000 * 60 * 60 * 24)));
}

function isRelevantBondTicker(symbol: string): boolean {
  return /^T\d{2}[A-Z]\d$/.test(symbol);
}

function isMarketHours(): boolean {
  const now = new Date();
  // Argentina timezone offset check (UTC-3)
  const arTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }));
  const hour = arTime.getHours();
  const day = arTime.getDay();
  return day >= 1 && day <= 5 && hour >= 10 && hour < 17;
}

/** Fetch with timeout and error handling */
async function safeFetch<T>(url: string, timeoutMs = 8000, headers?: Record<string, string>): Promise<{ ok: boolean; data: T | null; latency_ms: number }> {
  const start = Date.now();
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'Accept': 'application/json', ...headers },
    });
    const latency_ms = Date.now() - start;
    if (!res.ok) return { ok: false, data: null, latency_ms };
    const data = await res.json() as T;
    return { ok: true, data, latency_ms };
  } catch {
    const latency_ms = Date.now() - start;
    return { ok: false, data: null, latency_ms };
  }
}

// ── Riesgo País Fetcher (V3.2.4-PRO) ──────────────────────────────────

// V3.2.4-FIX: BondTerminal as primary (real-time), ArgentinaDatos as fallback
// BondTerminal scrapes the latest JP Morgan EMBI+ value directly

/** Parse Riesgo País from BondTerminal HTML */
function parseBondTerminalHTML(html: string): number | null {
  const match = html.match(/(\d{3,4})\s*pb/);
  if (match) {
    const value = parseInt(match[1], 10);
    return value > 0 && value < 10000 && isFinite(value) ? value : null;
  }
  return null;
}

/** Parse Riesgo País value from ArgentinaDatos API response */
function parseRiesgoPaisData(data: unknown): number | null {
  // Handle array format [{fecha, valor}]
  if (Array.isArray(data) && data.length > 0) {
    const latest = data[data.length - 1] as Record<string, unknown>;
    const valor = Number(latest.valor ?? latest.value ?? 0);
    return valor > 0 && isFinite(valor) ? Math.round(valor) : null;
  }
  // Handle single object format {fecha, valor}
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    const valor = Number(obj.valor ?? obj.value ?? 0);
    return valor > 0 && isFinite(valor) ? Math.round(valor) : null;
  }
  return null;
}

async function fetchRiesgoPais(): Promise<{ value: number | null; source: string }> {
  // ── SOURCE 1: BondTerminal (real-time, most reliable) ──
  try {
    const { ok, data } = await safeFetch<string>(BONDTERMINAL_RIESGO_PAIS_URL, 8000);
    if (ok && data && typeof data === 'string') {
      const value = parseBondTerminalHTML(data);
      if (value !== null) return { value, source: 'bondterminal' };
    }
  } catch {
    // BondTerminal failed
  }

  // ── SOURCE 2: ArgentinaDatos /ultimo (may be stale by days) ──
  try {
    const { ok, data } = await safeFetch<unknown>(ARGDATOS_RIESGO_PAIS_ULTIMO_URL, 10000);
    if (ok && data) {
      const value = parseRiesgoPaisData(data);
      if (value !== null) return { value, source: 'argentinadatos_ultimo' };
    }
  } catch {
    // /ultimo endpoint failed
  }

  // ── SOURCE 3: ArgentinaDatos generic (full historical array) ──
  try {
    const { ok, data } = await safeFetch<unknown>(ARGDATOS_RIESGO_PAIS_URL, 10000);
    if (ok && data) {
      const value = parseRiesgoPaisData(data);
      if (value !== null) return { value, source: 'argentinadatos' };
    }
  } catch {
    // Generic endpoint also failed
  }

  return { value: null, source: 'failed' };
}

// ════════════════════════════════════════════════════════════════════════
// IOL AUTHENTICATION MODULE
// ════════════════════════════════════════════════════════════════════════

let iolAccessToken: string | null = null;
let iolTokenExpiry: number = 0;
let iolAvailable = false;

async function getIOLToken(): Promise<string | null> {
  const username = process.env.IOL_USERNAME;
  const password = process.env.IOL_PASSWORD;

  if (!username || !password) {
    log('WARN', 'IOL credentials not configured (IOL_USERNAME / IOL_PASSWORD). Level 2 offline.');
    iolAvailable = false;
    return null;
  }

  // Check if current token is still valid (with 120s buffer — avoid blind spots)
  if (iolAccessToken && Date.now() < iolTokenExpiry - 120_000) {
    return iolAccessToken;
  }

  try {
    const params = new URLSearchParams({
      username,
      password,
      grant_type: 'password',
    });

    const res = await fetch(IOL_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      log('ERROR', `IOL auth failed (${res.status}): ${errText}`);
      iolAvailable = false;
      return null;
    }

    const data = await res.json() as { access_token: string; expires_in: number };
    iolAccessToken = data.access_token;
    iolTokenExpiry = Date.now() + (data.expires_in || 900) * 1000;
    iolAvailable = true;
    log('OK', `IOL token obtenido. Válido por ${Math.round((data.expires_in || 900) / 60)} minutos.`);
    return iolAccessToken;
  } catch (error) {
    log('ERROR', `IOL auth error: ${error instanceof Error ? error.message : String(error)}`);
    iolAvailable = false;
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════════
// IOL LEVEL 2 — Cotización & Volumen
// ════════════════════════════════════════════════════════════════════════

interface IOLLevel2Data {
  iol_volume: number;
  iol_bid: number;
  iol_ask: number;
  iol_avg_daily_volume: number;
  iol_status: 'online' | 'offline' | 'no_data';
  iol_liquidity_alert: boolean;
  iol_bid_depth: number;
  iol_ask_depth: number;
  iol_market_pressure: number;
}

async function getIOLCotizacion(ticker: string): Promise<IOLLevel2Data | null> {
  const token = await getIOLToken();
  if (!token) return null;

  try {
    const url = `${IOL_COTIZACION_URL}/${encodeURIComponent(ticker)}/Cotizacion?mercado=BCBA`;
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      // 404 = ticker not found in IOL (some instruments are not listed)
      if (res.status === 404) {
        return {
          iol_volume: 0,
          iol_bid: 0,
          iol_ask: 0,
          iol_avg_daily_volume: 0,
          iol_status: 'no_data',
          iol_liquidity_alert: false,
          iol_bid_depth: 0,
          iol_ask_depth: 0,
          iol_market_pressure: 0,
        };
      }
      return null;
    }

    const data = await res.json() as IOLCotizacion;

    // Extract best bid/ask from puntas
    let iolBid = 0;
    let iolAsk = 0;
    if (data.puntas) {
      if (data.puntas.compra && data.puntas.compra.length > 0) {
        iolBid = data.puntas.compra[0].precio;
      }
      if (data.puntas.venta && data.puntas.venta.length > 0) {
        iolAsk = data.puntas.venta[0].precio;
      }
    }

    // Calculate bid/ask depth from puntas (order book)
    let iolBidDepth = 0;
    let iolAskDepth = 0;
    if (data.puntas) {
      if (data.puntas.compra) {
        iolBidDepth = data.puntas.compra.reduce((sum, p) => sum + p.cantidad, 0);
      }
      if (data.puntas.venta) {
        iolAskDepth = data.puntas.venta.reduce((sum, p) => sum + p.cantidad, 0);
      }
    }
    const iolMarketPressure = iolAskDepth > 0 ? iolBidDepth / iolAskDepth : (iolBidDepth > 0 ? 99 : 0);

    // cantidadOperada = number of nominal units traded today
    const cantidadOperada = data.cantidadOperada || 0;
    const volumenNominal = data.volumen || 0; // Notional ARS volume

    // Estimate average daily volume
    // We use a simple heuristic: if current volume is X, avg daily ≈ X * 3
    // (assuming we're ~1/3 through the trading day on average)
    // This is a rough estimate; a proper implementation would query historical data
    const hourAR = new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' });
    const currentHour = new Date(hourAR).getHours();
    const tradingHoursElapsed = Math.max(1, currentHour - 10); // Market opens at 10
    const estimatedAvgDaily = volumenNominal > 0
      ? volumenNominal * (7 / tradingHoursElapsed) // 7 hours of trading
      : cantidadOperada * 100 * (7 / tradingHoursElapsed); // Rough estimate

    // Filtro de Verdad: volume < 10% of avg daily = Baja Liquidez
    const volumeRatio = estimatedAvgDaily > 0 ? volumenNominal / estimatedAvgDaily : 0;
    const liquidityAlert = volumeRatio < IOL_LOW_VOLUME_PCT && volumenNominal > 0;

    return {
      iol_volume: cantidadOperada,
      iol_bid: iolBid,
      iol_ask: iolAsk,
      iol_avg_daily_volume: Math.round(estimatedAvgDaily),
      iol_status: 'online',
      iol_liquidity_alert: liquidityAlert,
      iol_bid_depth: iolBidDepth,
      iol_ask_depth: iolAskDepth,
      iol_market_pressure: parseFloat(iolMarketPressure.toFixed(2)),
    };
  } catch (error) {
    // Don't log every failed IOL request (too noisy)
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════════
// LEVEL 1 — data912 + ArgentinaDatos Price Fetch
// ════════════════════════════════════════════════════════════════════════

async function fetchLevel1Data(): Promise<{
  instruments: LiveInstrument[];
  caucionProxy: { tnaPromedio: number; temCaucion: number };
  sources: { data912_notes: { ok: boolean; count: number }; data912_bonds: { ok: boolean; count: number }; argentinadatos: { ok: boolean; count: number } };
}> {
  // Fetch all 4 sources in parallel
  const [notesResult, bondsResult, argDatosResult, pfResult] = await Promise.all([
    safeFetch<Data912Note[]>(DATA912_NOTES_URL),
    safeFetch<Data912Note[]>(DATA912_BONDS_URL),
    safeFetch<ArgDatosLetra[]>(ARGDATOS_LETRAS_URL),
    safeFetch<ArgDatosPlazoFijo[]>(ARGDATOS_PF_URL),
  ]);

  // Caución proxy from Plazo Fijo
  let tnaPromedioPF = 0;
  let temCaucion = 0;

  if (pfResult.ok && pfResult.data && Array.isArray(pfResult.data)) {
    const validBanks = pfResult.data.filter(b => b.tnaClientes != null && b.tnaClientes > 0);
    if (validBanks.length > 0) {
      tnaPromedioPF = validBanks.reduce((sum, b) => sum + (b.tnaClientes ?? 0), 0) / validBanks.length;
      const tnaCaucion = tnaPromedioPF - CAUCION_HAIRCUT;
      temCaucion = Math.pow(1 + tnaCaucion, 30 / 365) - 1;
    }
  }

  // Build price map from data912
  const data912Map = new Map<string, Data912Note & { _source: 'arg_notes' | 'arg_bonds' }>();

  let notesCount = 0;
  if (notesResult.ok && notesResult.data) {
    for (const note of notesResult.data) {
      data912Map.set(note.symbol, { ...note, _source: 'arg_notes' });
      notesCount++;
    }
  }

  let bondsBONCAPCount = 0;
  let bondsTotalCount = 0;
  if (bondsResult.ok && bondsResult.data) {
    bondsTotalCount = bondsResult.data.length;
    for (const bond of bondsResult.data) {
      if (isRelevantBondTicker(bond.symbol)) {
        if (!data912Map.has(bond.symbol)) {
          data912Map.set(bond.symbol, { ...bond, _source: 'arg_bonds' });
          bondsBONCAPCount++;
        }
      }
    }
  }

  // ArgentinaDatos map
  const argDatosMap = new Map<string, ArgDatosLetra>();
  let argDatosCount = 0;
  if (argDatosResult.ok && argDatosResult.data) {
    argDatosCount = argDatosResult.data.length;
    for (const letra of argDatosResult.data) {
      argDatosMap.set(letra.ticker, letra);
    }
  }

  // Merge: only instruments present in BOTH sources
  const instruments: LiveInstrument[] = [];
  const updatedAt = new Date().toISOString();

  for (const [ticker, nota] of data912Map) {
    const letra = argDatosMap.get(ticker);
    if (!letra) continue;
    if (!nota.c || nota.c <= 0) continue;

    const days = daysToExpiry(letra.fechaVencimiento);
    if (days <= 0) continue;

    // Price normalization
    const lastPrice = nota.c / 100;
    let bidPrice = nota.px_bid > 0 ? nota.px_bid / 100 : 0;
    let askPrice = nota.px_ask > 0 ? nota.px_ask / 100 : 0;
    const priceEstimated = bidPrice === 0 || askPrice === 0;
    if (bidPrice === 0) bidPrice = lastPrice;
    if (askPrice === 0) askPrice = lastPrice;

    // TIR Calculation
    const precioAskPer100 = askPrice * 100;
    const ratio = letra.vpv / precioAskPer100;
    let tir = 0, tem = 0, tna = 0;
    if (ratio > 1 && days > 0) {
      tir = Math.pow(ratio, 365 / days) - 1;
      tem = Math.pow(1 + tir, 30 / 365) - 1;
      tna = Math.pow(1 + tem, 12) - 1;
    }

    const paridad = (precioAskPer100 / letra.vpv) * 100;
    const spreadNeto = tem - temCaucion;
    const monthsToExpiry = days / 30;
    const gananciaDirecta = spreadNeto * monthsToExpiry;

    let paybackDays = 0;
    if (tem > 0) {
      const temDiaria = Math.pow(1 + tem, 1 / 30) - 1;
      if (temDiaria > 0) paybackDays = COMISION_TOTAL / temDiaria;
    }

    const lowLiquidity = nota.v < LOW_LIQUIDITY_THRESHOLD;

    // Delta TIR
    let deltaTir: number | null = null;
    let lastClose: number | null = null;
    if (nota.pct_change !== 0 && nota.pct_change !== null && nota.pct_change !== undefined) {
      const lastClosePer100 = nota.c / (1 + nota.pct_change / 100);
      if (lastClosePer100 > 0 && isFinite(lastClosePer100)) {
        lastClose = parseFloat((lastClosePer100 / 100).toFixed(6));
        const lastCloseRatio = letra.vpv / lastClosePer100;
        if (lastCloseRatio > 1 && days > 0) {
          const tirAtLastClose = Math.pow(lastCloseRatio, 365 / days) - 1;
          deltaTir = parseFloat((tir - tirAtLastClose).toFixed(6));
        }
      }
    }

    instruments.push({
      ticker,
      type: inferType(ticker),
      days_to_expiry: days,
      last_price: parseFloat(lastPrice.toFixed(6)),
      bid: parseFloat(bidPrice.toFixed(6)),
      ask: parseFloat(askPrice.toFixed(6)),
      vpv: letra.vpv,
      paridad: parseFloat(paridad.toFixed(4)),
      tir: parseFloat(tir.toFixed(6)),
      tem: parseFloat(tem.toFixed(6)),
      tna: parseFloat(tna.toFixed(6)),
      spread_neto: parseFloat(spreadNeto.toFixed(6)),
      ganancia_directa: parseFloat(gananciaDirecta.toFixed(4)),
      payback_days: parseFloat(paybackDays.toFixed(1)),
      change_pct: nota.pct_change,
      volume: nota.v,
      low_liquidity: lowLiquidity,
      price_estimated: priceEstimated,
      tem_emision: letra.tem,
      fecha_vencimiento: letra.fechaVencimiento,
      updated_at: updatedAt,
      source: nota._source,
      delta_tir: deltaTir,
      last_close: lastClose,
    });
  }

  instruments.sort((a, b) => a.days_to_expiry - b.days_to_expiry);

  log('INFO', `Nivel 1: ${instruments.length} instrumentos (${notesCount} notes, ${bondsBONCAPCount} BONCAPs, ${argDatosCount} ArgDatos)`);

  return {
    instruments,
    caucionProxy: { tnaPromedio: tnaPromedioPF, temCaucion },
    sources: {
      data912_notes: { ok: notesResult.ok, count: notesCount },
      data912_bonds: { ok: bondsResult.ok, count: bondsTotalCount },
      argentinadatos: { ok: argDatosResult.ok, count: argDatosCount },
    },
  };
}

// ════════════════════════════════════════════════════════════════════════
// LEVEL 2 — IOL Volume Validation (Filtro de Verdad)
// ════════════════════════════════════════════════════════════════════════

async function enrichWithIOL(instruments: LiveInstrument[]): Promise<{
  enriched: LiveInstrument[];
  iolOnline: boolean;
  iolStats: { queried: number; success: number; alerts: number };
}> {
  const token = await getIOLToken();
  if (!token) {
    log('WARN', 'Nivel 2 IOL: OFFLINE (sin token). Operando solo con Nivel 1.');
    return { enriched: instruments, iolOnline: false, iolStats: { queried: 0, success: 0, alerts: 0 } };
  }

  log('LEVEL2', `Consultando IOL para ${instruments.length} instrumentos...`);

  let iolSuccess = 0;
  let iolAlerts = 0;

  // Process instruments in batches of 5 to avoid IOL rate limits
  const BATCH_SIZE = 5;
  const enriched: LiveInstrument[] = [];

  for (let i = 0; i < instruments.length; i += BATCH_SIZE) {
    const batch = instruments.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (inst) => {
        const iolData = await getIOLCotizacion(inst.ticker);
        return { inst, iolData };
      })
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const { inst, iolData } = result.value;
        if (iolData) {
          enriched.push({
            ...inst,
            iol_volume: iolData.iol_volume,
            iol_bid: iolData.iol_bid,
            iol_ask: iolData.iol_ask,
            iol_avg_daily_volume: iolData.iol_avg_daily_volume,
            iol_status: iolData.iol_status,
            iol_liquidity_alert: iolData.iol_liquidity_alert,
            iol_bid_depth: iolData.iol_bid_depth,
            iol_ask_depth: iolData.iol_ask_depth,
            iol_market_pressure: iolData.iol_market_pressure,
          });
          if (iolData.iol_status === 'online') iolSuccess++;
          if (iolData.iol_liquidity_alert) iolAlerts++;
        } else {
          enriched.push({ ...inst, iol_status: 'offline' });
        }
      } else {
        // Failed request — keep instrument without IOL data
        enriched.push({ ...instruments[enriched.length], iol_status: 'offline' });
      }
    }

    // Small delay between batches to respect IOL rate limits
    if (i + BATCH_SIZE < instruments.length) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  log('LEVEL2', `IOL: ${iolSuccess}/${instruments.length} consultados OK | ${iolAlerts} alertas de baja liquidez`);

  if (iolAlerts > 0) {
    const alertTickers = enriched
      .filter(i => i.iol_liquidity_alert)
      .map(i => `${i.ticker} (vol: ${(i.iol_volume || 0).toLocaleString()})`)
      .join(', ');
    log('WARN', `⚠️ BAJA LIQUIDEZ IOL: ${alertTickers}`);
  }

  return { enriched, iolOnline: iolSuccess > 0, iolStats: { queried: instruments.length, success: iolSuccess, alerts: iolAlerts } };
}

// ════════════════════════════════════════════════════════════════════════
// FILTRO DE VERDAD — Hunting Score Adjustment
// ════════════════════════════════════════════════════════════════════════

interface FiltroVerdadResult {
  ticker: string;
  spread_neto: number;       // TEM - TEM_caucion (decimal)
  upside_pct: number;        // estimated upside from current price
  iol_volume_confirmed: boolean;  // True if IOL shows growing volume
  liquidity_alert: boolean;  // True if volume < 10% avg daily
  hunting_adjustment: number; // Score adjustment from IOL data
  verdict: string;           // Human-readable verdict
}

function applyFiltroVerdad(instruments: LiveInstrument[], temCaucion: number): FiltroVerdadResult[] {
  return instruments.map(inst => {
    const spreadPct = (inst.spread_neto) * 100; // Convert to percentage points
    const upsidePct = inst.change_pct > 0 ? inst.change_pct : 0;

    // IOL Volume Confirmation
    const iolVolumeConfirmed = inst.iol_status === 'online' && (inst.iol_volume || 0) > 0 && !inst.iol_liquidity_alert;

    // Filtro de Verdad Logic
    let huntingAdjustment = 0;
    let verdict = '';

    if (inst.iol_status === 'online') {
      if (spreadPct > 0.50 && inst.iol_liquidity_alert) {
        // Upside > 0.50% but volume < 10% avg daily → BAJA LIQUIDEZ
        huntingAdjustment = -15; // Heavy penalty
        verdict = '⚠️ BAJA LIQUIDEZ — Upside atractivo pero sin volumen real que lo respalde';
      } else if (iolVolumeConfirmed && spreadPct > 0.25) {
        // Good spread + growing IOL volume → CONFIRMADO
        huntingAdjustment = IOL_HUNTING_BOOST;
        verdict = '✅ CONFIRMADO — Spread positivo con volumen creciente en IOL';
      } else if (iolVolumeConfirmed) {
        // Volume confirmed but spread is marginal
        huntingAdjustment = 3;
        verdict = '📊 Volumen OK — Spread marginal pero liquidez respalda';
      } else if (inst.iol_liquidity_alert) {
        // Low liquidity regardless of spread
        huntingAdjustment = -8;
        verdict = '⚠️ ALERTA LIQUIDEZ — Volumen insuficiente en IOL';
      } else {
        const vol = inst.iol_volume ?? 0;
        if (vol === 0) {
          verdict = '📡 IOL Online — Sin volumen operado (0 ops en la rueda)';
        } else if (vol > 0 && inst.spread_neto <= 0.25) {
          verdict = `📡 IOL Online — Vol: ${vol.toLocaleString()} nominales pero spread marginal (≤0.25%)`;
        } else {
          verdict = `📡 IOL Online — Vol: ${vol.toLocaleString()} — Sin señal direccional clara`;
        }
      }
    } else if (inst.iol_status === 'no_data') {
      verdict = '📭 IOL: Ticker no disponible en IOL';
    } else {
      verdict = '🔌 IOL Offline — Sin datos de Nivel 2';
    }

    return {
      ticker: inst.ticker,
      spread_neto: inst.spread_neto,
      upside_pct: upsidePct,
      iol_volume_confirmed: iolVolumeConfirmed,
      liquidity_alert: inst.iol_liquidity_alert || false,
      hunting_adjustment: huntingAdjustment,
      verdict,
    };
  });
}

// ════════════════════════════════════════════════════════════════════════
// V3.2 — HISTORICAL ACCUMULATION
// Write PriceSnapshot + DailyOHLC for the Histórico tab
// ════════════════════════════════════════════════════════════════════════

async function writeHistoricalData(
  prisma: PrismaClient,
  instruments: LiveInstrument[],
  caucionProxy: { tnaPromedio: number; temCaucion: number },
): Promise<void> {
  const now = new Date();
  const today = now.toISOString().split('T')[0]; // YYYY-MM-DD
  let snapshotCount = 0;
  let ohlcCount = 0;

  for (const inst of instruments) {
    // ── 1. Write PriceSnapshot ──
    try {
      await prisma.priceSnapshot.create({
        data: {
          ticker: inst.ticker,
          price: inst.last_price,
          tem: inst.tem,
          tna: inst.tna,
          spread: inst.spread_neto,
          volume: inst.volume,
          source: inst.iol_status === 'online' ? 'level2' : 'level1',
          iolVolume: inst.iol_volume ?? null,
          iolBid: inst.iol_bid ?? null,
          iolAsk: inst.iol_ask ?? null,
          timestamp: now,
        },
      });
      snapshotCount++;
    } catch {
      // Skip if snapshot write fails (non-critical)
    }

    // ── 2. Upsert DailyOHLC ──
    try {
      const existingOHLC = await prisma.dailyOHLC.findUnique({
        where: { ticker_date: { ticker: inst.ticker, date: today } },
      });

      if (existingOHLC) {
        // Update: recalculate high/low/close from all snapshots today
        const newHigh = Math.max(existingOHLC.high, inst.last_price);
        const newLow = Math.min(existingOHLC.low, inst.last_price);
        const newTemHigh = Math.max(existingOHLC.temHigh, inst.tem);
        const newTemLow = Math.min(existingOHLC.temLow, inst.tem);
        const totalVolume = existingOHLC.volume + inst.volume;
        const iolTotalVolume = (existingOHLC.iolVolume ?? 0) + (inst.iol_volume ?? 0);
        // Update running average spread
        const newSpreadAvg = (existingOHLC.spreadAvg * existingOHLC.volume + inst.spread_neto * inst.volume) / totalVolume;

        await prisma.dailyOHLC.update({
          where: { id: existingOHLC.id },
          data: {
            high: newHigh,
            low: newLow,
            close: inst.last_price,
            temHigh: newTemHigh,
            temLow: newTemLow,
            temClose: inst.tem,
            volume: totalVolume,
            iolVolume: iolTotalVolume > 0 ? iolTotalVolume : null,
            spreadAvg: newSpreadAvg,
          },
        });
        ohlcCount++;
      } else {
        // First observation of the day → create OHLC record
        await prisma.dailyOHLC.create({
          data: {
            ticker: inst.ticker,
            date: today,
            open: inst.last_price,
            high: inst.last_price,
            low: inst.last_price,
            close: inst.last_price,
            temOpen: inst.tem,
            temClose: inst.tem,
            temHigh: inst.tem,
            temLow: inst.tem,
            volume: inst.volume,
            iolVolume: inst.iol_volume ?? null,
            spreadAvg: inst.spread_neto,
          },
        });
        ohlcCount++;
      }
    } catch {
      // Skip if OHLC write fails (non-critical)
    }
  }

  log('OK', `📊 Histórico: ${snapshotCount} snapshots + ${ohlcCount} OHLC registros para ${today}`);

  // ── 3. Cleanup: keep only last 90 days of snapshots (prevent DB bloat) ──
  try {
    const cutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const deleted = await prisma.priceSnapshot.deleteMany({
      where: { timestamp: { lt: cutoff } },
    });
    if (deleted.count > 0) {
      log('INFO', `🧹 Cleanup: ${deleted.count} snapshots >90d eliminados`);
    }
  } catch {
    // Non-critical
  }
}

// ════════════════════════════════════════════════════════════════════════
// DATABASE — Read/Write to Neon via Prisma
// ════════════════════════════════════════════════════════════════════════

async function writeToNeon(
  instruments: LiveInstrument[],
  caucionProxy: { tnaPromedio: number; temCaucion: number },
  iolOnline: boolean,
  filtroResults: FiltroVerdadResult[],
): Promise<boolean> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    log('ERROR', 'DATABASE_URL not configured. Cannot write to Neon.');
    return false;
  }

  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  });

  try {
    // Read existing state to preserve config, position, transactions
    const existing = await prisma.appState.findUnique({ where: { id: 'main' } });

    let config = JSON.stringify({
      caucion1d: caucionProxy.tnaPromedio > 0 ? caucionProxy.tnaPromedio + 2 : 19,
      caucion7d: caucionProxy.tnaPromedio > 0 ? caucionProxy.tnaPromedio + 1 : 19.2,
      caucion30d: caucionProxy.tnaPromedio > 0 ? caucionProxy.tnaPromedio : 18.5,
      riesgoPais: 450,
      comisionTotal: 0.30,
      capitalDisponible: 500000,
    });

    let position = null as string | null;
    let transactions = '[]';
    let lastUpdate = new Date().toISOString();
    let rawInput = '';

    if (existing) {
      // Preserve existing user data
      config = existing.config;
      position = existing.position;
      transactions = existing.transactions;
      rawInput = existing.rawInput ?? '';

      // Parse existing config to update caución rates from fresh data
      try {
        const parsedConfig = JSON.parse(existing.config);
        if (caucionProxy.tnaPromedio > 0) {
          parsedConfig.caucion1d = parseFloat((caucionProxy.tnaPromedio + 2).toFixed(2));
          parsedConfig.caucion7d = parseFloat((caucionProxy.tnaPromedio + 1).toFixed(2));
          parsedConfig.caucion30d = parseFloat(caucionProxy.tnaPromedio.toFixed(2));
          config = JSON.stringify(parsedConfig);
        }
      } catch { /* keep existing config */ }
    }

    // Convert LiveInstrument[] to Instrument[] format for the store
    const storeInstruments = instruments.map(inst => ({
      ticker: inst.ticker,
      type: inst.type,
      expiry: inst.fecha_vencimiento,
      days: inst.days_to_expiry,
      price: inst.last_price,
      change: inst.change_pct,
      tna: inst.tna * 100,
      tem: inst.tem * 100,
      tir: inst.tem * 100,
      gananciaDirecta: inst.ganancia_directa * 100,
      vsPlazoFijo: inst.spread_neto > 0 ? 'ATRACTIVO' : 'NO CONVIENE',
      // IOL Level 2 fields
      iolVolume: inst.iol_volume,
      iolBid: inst.iol_bid,
      iolAsk: inst.iol_ask,
      iolAvgDailyVolume: inst.iol_avg_daily_volume,
      iolStatus: inst.iol_status,
      iolLiquidityAlert: inst.iol_liquidity_alert,
      iolHuntingAdjustment: filtroResults.find(f => f.ticker === inst.ticker)?.hunting_adjustment || 0,
      iolBidDepth: inst.iol_bid_depth,
      iolAskDepth: inst.iol_ask_depth,
      iolMarketPressure: inst.iol_market_pressure,
      iolVerdict: filtroResults.find(f => f.ticker === inst.ticker)?.verdict || '',
      // data912 fields
      vpv: inst.vpv,
      bid: inst.bid,
      ask: inst.ask,
      paridad: inst.paridad,
      volume: inst.volume,
      lowLiquidity: inst.low_liquidity,
      deltaTir: inst.delta_tir,
      lastClose: inst.last_close,
    }));

    // Build caución proxy info
    const caucionInfo = {
      tna_promedio: caucionProxy.tnaPromedio,
      tem_caucion: caucionProxy.temCaucion,
      source: 'argentinadatos_plazoFijo_promedio_-2pp',
    };

    // Upsert to Neon
    await prisma.appState.upsert({
      where: { id: 'main' },
      update: {
        instruments: JSON.stringify(storeInstruments),
        config,
        position,
        transactions,
        lastUpdate,
        rawInput,
        mepRate: existing?.mepRate ?? null,
        cclRate: existing?.cclRate ?? null,
        liveActive: true,
        iolLevel2Online: iolOnline,
      },
      create: {
        id: 'main',
        instruments: JSON.stringify(storeInstruments),
        config,
        position,
        transactions,
        lastUpdate,
        rawInput,
        liveActive: true,
        iolLevel2Online: iolOnline,
      },
    });

    log('OK', `✅ Neon DB actualizado: ${storeInstruments.length} instrumentos | IOL Nivel 2: ${iolOnline ? 'ONLINE' : 'OFFLINE'}`);

    // V3.2: Write historical accumulation data (snapshots + OHLC)
    await writeHistoricalData(prisma, instruments, caucionProxy);

    // V3.2.4-FIX: Fetch and persist Riesgo País every cycle (using /ultimo endpoint)
    const riesgoPaisResult = await fetchRiesgoPais();
    if (riesgoPaisResult.value !== null && riesgoPaisResult.value > 0) {
      try {
        await prisma.countryRisk.upsert({
          where: { id: 'main' },
          update: { value: riesgoPaisResult.value, source: riesgoPaisResult.source },
          create: { id: 'main', value: riesgoPaisResult.value, source: riesgoPaisResult.source },
        });
        log('OK', `🇦🇷 Riesgo País: ${riesgoPaisResult.value}pb (${riesgoPaisResult.source})`);
      } catch {
        log('WARN', 'Riesgo País: no se pudo persistir en DB');
      }
    } else {
      log('WARN', 'Riesgo País: no se pudo obtener de ArgentinaDatos (todos los endpoints fallaron)');
    }

    return true;
  } catch (error) {
    log('ERROR', `Neon DB write failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  } finally {
    await prisma.$disconnect();
  }
}

// ════════════════════════════════════════════════════════════════════════
// DISPLAY — Top 5 Spreads + IOL Status
// ════════════════════════════════════════════════════════════════════════

function displayTopSpreads(instruments: LiveInstrument[], filtroResults: FiltroVerdadResult[]) {
  const top5 = [...instruments]
    .sort((a, b) => b.spread_neto - a.spread_neto)
    .slice(0, 5);

  console.log('');
  console.log('  ┌──────────────────────────────────────────────────────────────────────────────────┐');
  console.log('  │  🎯 TOP 5 SPREADS NETOS + FILTRO DE VERDAD                                       │');
  console.log('  ├──────────┬──────────┬──────────┬──────────┬────────────────────────────────────────┤');
  console.log('  │ Ticker   │ Spread%  │ TEM%     │ IOL      │ Veredicto                             │');
  console.log('  ├──────────┼──────────┼──────────┼──────────┼────────────────────────────────────────┤');

  for (const inst of top5) {
    const filtro = filtroResults.find(f => f.ticker === inst.ticker);
    const spreadPct = (inst.spread_neto * 100).toFixed(3);
    const temPct = (inst.tem * 100).toFixed(2);
    const iolIcon = inst.iol_status === 'online' ? '🟢' : inst.iol_status === 'no_data' ? '📭' : '🔴';
    const verdict = filtro?.verdict || '—';

    console.log(`  │ ${inst.ticker.padEnd(8)} │ ${(spreadPct.startsWith('+') ? '' : '+') + spreadPct.padStart(7)} │ ${temPct.padStart(7)} │ ${iolIcon}       │ ${verdict.slice(0, 38).padEnd(38)} │`);
  }

  console.log('  └──────────┴──────────┴──────────┴──────────┴────────────────────────────────────────┘');
  console.log('');
}

// ════════════════════════════════════════════════════════════════════════
// MAIN — Orchestrator
// ════════════════════════════════════════════════════════════════════════

async function runOnce(): Promise<boolean> {
  const startTime = Date.now();
  console.log('');
  log('INFO', '═══ CEREBRO TÁCTICO — Ciclo de actualización ═══');

  // Step 1: Level 1 — Fetch prices
  log('INFO', 'Nivel 1: Obteniendo precios data912 + ArgentinaDatos...');
  const { instruments, caucionProxy, sources } = await fetchLevel1Data();

  if (instruments.length === 0) {
    log('ERROR', 'No se obtuvieron instrumentos de Nivel 1. Abortando.');
    return false;
  }

  // Step 2: Level 2 — IOL Volume Validation
  log('INFO', 'Nivel 2: Consultando IOL para validación de volumen...');
  const { enriched, iolOnline, iolStats } = await enrichWithIOL(instruments);

  // Step 3: Apply Filtro de Verdad
  const filtroResults = applyFiltroVerdad(enriched, caucionProxy.temCaucion);

  // Step 4: Display results
  displayTopSpreads(enriched, filtroResults);

  // Step 5: Write to Neon DB
  log('INFO', 'Escribiendo a Neon PostgreSQL...');
  const dbOk = await writeToNeon(enriched, caucionProxy, iolOnline, filtroResults);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('');
  log('INFO', `Ciclo completado en ${elapsed}s | L1: ${instruments.length} inst | L2: ${iolStats.success}/${iolStats.queried} IOL OK | ${iolStats.alerts} alertas | DB: ${dbOk ? 'OK' : 'FAIL'}`);

  if (!iolOnline) {
    log('WARN', '🔌 NIVEL 2 OFFLINE — El sistema sigue operando con APIs base, pero sin validación de volumen.');
  }

  return dbOk;
}

async function daemonLoop() {
  log('INFO', '🚀 CEREBRO TÁCTICO iniciado en modo DAEMON (cada 60s, solo horario de mercado)');
  log('INFO', 'Presiona Ctrl+C para detener.');

  // IOL token refresh interval
  const iolRefreshInterval = setInterval(async () => {
    if (process.env.IOL_USERNAME && process.env.IOL_PASSWORD) {
      await getIOLToken();
    }
  }, IOL_TOKEN_REFRESH_MS);

  // Graceful shutdown
  let running = true;
  const shutdown = async () => {
    if (!running) return;
    running = false;
    log('INFO', 'Deteniendo CEREBRO TÁCTICO...');
    clearInterval(iolRefreshInterval);
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  while (running) {
    if (isMarketHours()) {
      await runOnce();
    } else {
      const arTime = new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' });
      log('INFO', `Mercado cerrado (${arTime}). Próxima verificación en 60s.`);
    }

    await new Promise(r => setTimeout(r, DAEMON_INTERVAL_MS));
  }
}

// ── Entry Point ────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const isDaemon = args.includes('--daemon');

if (isDaemon) {
  daemonLoop().catch(err => {
    log('ERROR', `Daemon crashed: ${err}`);
    process.exit(1);
  });
} else {
  runOnce().then(ok => {
    process.exit(ok ? 0 : 1);
  }).catch(err => {
    log('ERROR', `Fatal: ${err}`);
    process.exit(1);
  });
}
