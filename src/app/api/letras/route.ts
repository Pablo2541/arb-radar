// ════════════════════════════════════════════════════════════════════════
// V2.0.2 — /api/letras: Live Data Merge (data912 + ArgentinaDatos)
//
// Source A1 (Precios LECAPs): data912.com/live/arg_notes
// Source A2 (Precios BONCAPs + Bonds): data912.com/live/arg_bonds
// Source B (Estructura): api.argentinadatos.com/v1/finanzas/letras
// Source C (Caución proxy): api.argentinadatos.com/v1/finanzas/tasas/plazoFijo
//
// TIR  = ((VPV / Precio_Ask) ^ (365 / Dias_al_Vto)) - 1
// TEM  = ((1 + TIR) ^ (30 / 365)) - 1
// TNA  = (1 + TEM)^12 - 1
//
// V2.0.1 FIX: Added /live/arg_bonds to fetch BONCAPs (T-prefix tickers)
// V2.0.2 FIX: Added delta_tir (TIR at live price vs TIR at last_close)
// ════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 60; // cache for 60 seconds

// ── Configuration ──────────────────────────────────────────────────────
const COMISION_TOTAL = 0.003;          // 0.3% comisión entrada + salida
const LOW_LIQUIDITY_THRESHOLD = 1_000_000; // ARS notional volume
const CAUCION_HAIRCUT = 0.02;          // 2% haircut on PF TNA for caución proxy
const DATA912_NOTES_URL = 'https://data912.com/live/arg_notes';
const DATA912_BONDS_URL = 'https://data912.com/live/arg_bonds';
const ARGDATOS_LETRAS_URL = 'https://api.argentinadatos.com/v1/finanzas/letras';
const ARGDATOS_PF_URL = 'https://api.argentinadatos.com/v1/finanzas/tasas/plazoFijo';

// ── In-Memory Cache ────────────────────────────────────────────────────
interface CacheEntry {
  data: unknown;
  timestamp: number;
  stale?: boolean;
}

const cache: { letras: CacheEntry | null } = { letras: null };
const CACHE_TTL = 55_000; // 55 seconds (slightly less than 60s to ensure freshness)
const SOURCE_TIMEOUT_MS = 2_000; // 2s max per source — never block the UI longer

// ── Types (inline for server route — avoids import issues) ─────────────
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
  delta_tir: number | null;   // V2.0.2: TIR(live) - TIR(last_close)
  last_close: number | null;  // V2.0.2: previous close per $1 VN
}

// ── Helpers ────────────────────────────────────────────────────────────

/** Classify ticker as LECAP (S-prefix) or BONCAP (T-prefix) */
function inferType(ticker: string): 'LECAP' | 'BONCAP' {
  return ticker.startsWith('T') ? 'BONCAP' : 'LECAP';
}

/** Calculate business days between two dates (approximation: calendar days) */
function daysToExpiry(vencimiento: string): number {
  const vto = new Date(vencimiento);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  vto.setHours(0, 0, 0, 0);
  const diff = vto.getTime() - today.getTime();
  return Math.max(0, Math.round(diff / (1000 * 60 * 60 * 24)));
}

/** Fetch with timeout and error handling */
async function safeFetch<T>(url: string, timeoutMs = SOURCE_TIMEOUT_MS): Promise<{ ok: boolean; data: T | null; latency_ms: number }> {
  const start = Date.now();
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'Accept': 'application/json' },
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

/**
 * Filter arg_bonds data to only include BONCAP-like tickers.
 * ArgentinaDatos provides letras with T-prefix (BONCAPs) and S-prefix (LECAPs).
 * The arg_bonds endpoint has ALL sovereign bonds, but we only want the ones
 * that are also in ArgentinaDatos letras (i.e., actual BONCAPs).
 * We'll handle this via the merge logic — only include tickers present in BOTH sources.
 * However, we can pre-filter to avoid processing irrelevant bonds.
 */
function isRelevantBondTicker(symbol: string): boolean {
  // BONCAPs follow the pattern: T + DD + Letter + Digit (e.g., T30J7, T15E7, T31Y7)
  // Regular sovereign bonds have patterns like AL30, GD35, CO32, etc.
  // BONCAP T-prefix tickers: T followed by 2 digits, then a letter, then a single digit
  return /^T\d{2}[A-Z]\d$/.test(symbol);
}

// ── Main Handler ───────────────────────────────────────────────────────

export async function GET() {
  // Check cache
  const now = Date.now();
  if (cache.letras && (now - cache.letras.timestamp) < CACHE_TTL) {
    return NextResponse.json(cache.letras.data);
  }

  // Fetch all 4 sources in parallel
  // A1: arg_notes (LECAPs - S/X/M/D prefix)
  // A2: arg_bonds (BONCAPs - T prefix + other sovereign bonds)
  // B: ArgentinaDatos letras (VPV + vencimiento for both LECAPs and BONCAPs)
  // C: Plazo Fijo (caución proxy)
  const [notesResult, bondsResult, argDatosResult, pfResult] = await Promise.all([
    safeFetch<Data912Note[]>(DATA912_NOTES_URL),
    safeFetch<Data912Note[]>(DATA912_BONDS_URL),
    safeFetch<ArgDatosLetra[]>(ARGDATOS_LETRAS_URL),
    safeFetch<ArgDatosPlazoFijo[]>(ARGDATOS_PF_URL),
  ]);

  // ── Calculate caución proxy from Plazo Fijo ────────────────────────
  let tnaPromedioPF = 0;
  let temCaucion = 0;

  if (pfResult.ok && pfResult.data && Array.isArray(pfResult.data)) {
    const validBanks = pfResult.data.filter(
      (b) => b.tnaClientes != null && b.tnaClientes > 0
    );
    if (validBanks.length > 0) {
      tnaPromedioPF = validBanks.reduce((sum, b) => sum + (b.tnaClientes ?? 0), 0) / validBanks.length;
      // Caución proxy = PF TNA - haircut, converted to TEM
      const tnaCaucion = tnaPromedioPF - CAUCION_HAIRCUT;
      temCaucion = Math.pow(1 + tnaCaucion, 30 / 365) - 1;
    }
  }

  // ── If ALL price sources AND ArgentinaDatos failed, return error (or stale cache) ───
  if (!notesResult.ok && !bondsResult.ok && !argDatosResult.ok) {
    // SWR: Return stale cache if available rather than empty response
    if (cache.letras) {
      console.warn('[letras] All sources failed — returning stale cache');
      const staleData = cache.letras.data as Record<string, unknown>;
      return NextResponse.json({
        ...staleData,
        stale: true,
        stale_reason: 'all_sources_failed',
      });
    }
    return NextResponse.json(
      {
        error: true,
        message: 'All data sources (data912 notes, data912 bonds, ArgentinaDatos) are unavailable',
        sources: {
          data912_notes: { ok: false, count: 0, latency_ms: notesResult.latency_ms },
          data912_bonds: { ok: false, count: 0, latency_ms: bondsResult.latency_ms },
          argentinadatos: { ok: false, count: 0, latency_ms: argDatosResult.latency_ms },
        },
      },
      { status: 502 }
    );
  }

  // ── Build maps for merge ───────────────────────────────────────────
  // Merge BOTH data912 sources into a single price map
  const data912Map = new Map<string, Data912Note & { _source: 'arg_notes' | 'arg_bonds' }>();

  // A1: arg_notes (LECAPs)
  let notesCount = 0;
  if (notesResult.ok && notesResult.data) {
    for (const note of notesResult.data) {
      data912Map.set(note.symbol, { ...note, _source: 'arg_notes' });
      notesCount++;
    }
  }

  // A2: arg_bonds — only include BONCAP-like T-prefix tickers
  let bondsBONCAPCount = 0;
  let bondsTotalCount = 0;
  if (bondsResult.ok && bondsResult.data) {
    bondsTotalCount = bondsResult.data.length;
    for (const bond of bondsResult.data) {
      // Only include BONCAP T-prefix tickers (T + 2 digits + letter + digit)
      if (isRelevantBondTicker(bond.symbol)) {
        // Don't overwrite if already in map from arg_notes (shouldn't happen, but safety)
        if (!data912Map.has(bond.symbol)) {
          data912Map.set(bond.symbol, { ...bond, _source: 'arg_bonds' });
          bondsBONCAPCount++;
        }
      }
    }
  }

  // ArgentinaDatos map (VPV + vencimiento for both LECAPs and BONCAPs)
  const argDatosMap = new Map<string, ArgDatosLetra>();
  let argDatosCount = 0;
  if (argDatosResult.ok && argDatosResult.data) {
    argDatosCount = argDatosResult.data.length;
    for (const letra of argDatosResult.data) {
      argDatosMap.set(letra.ticker, letra);
    }
  }

  // ── Merge: only instruments present in BOTH price map AND ArgentinaDatos ─
  const instruments: LiveInstrument[] = [];
  const updatedAt = new Date().toISOString();

  for (const [ticker, nota] of data912Map) {
    const letra = argDatosMap.get(ticker);
    if (!letra) continue; // Skip if not in ArgentinaDatos (not a standard LECAP/BONCAP)

    // Skip if price is 0 or null (no market activity at all)
    if (!nota.c || nota.c <= 0) continue;

    const days = daysToExpiry(letra.fechaVencimiento);
    if (days <= 0) continue; // Already expired

    // ── Price normalization: data912 → per $1 VN ──────────────────
    const lastPrice = nota.c / 100;
    let bidPrice = nota.px_bid > 0 ? nota.px_bid / 100 : 0;
    let askPrice = nota.px_ask > 0 ? nota.px_ask / 100 : 0;
    const priceEstimated = bidPrice === 0 || askPrice === 0;

    // If bid/ask are 0, use last_price but mark as estimated
    if (bidPrice === 0) bidPrice = lastPrice;
    if (askPrice === 0) askPrice = lastPrice;

    // ── TIR Calculation (annualized, using ask price) ─────────────
    // TIR = ((VPV / Precio_Ask) ^ (365 / days)) - 1
    // VPV is per $100 VN, askPrice is per $1 VN, so: VPV / (askPrice * 100)
    const precioAskPer100 = askPrice * 100; // convert back to per $100 VN for ratio
    const ratio = letra.vpv / precioAskPer100;

    let tir = 0;
    let tem = 0;
    let tna = 0;

    if (ratio > 1 && days > 0) {
      tir = Math.pow(ratio, 365 / days) - 1;
      tem = Math.pow(1 + tir, 30 / 365) - 1;
      tna = Math.pow(1 + tem, 12) - 1;
    }

    // ── Paridad ───────────────────────────────────────────────────
    const paridad = (precioAskPer100 / letra.vpv) * 100;

    // ── Spread Neto (TEM del activo - TEM caución) ────────────────
    const spreadNeto = tem - temCaucion;

    // ── Ganancia Directa (carry total al vencimiento) ─────────────
    const monthsToExpiry = days / 30;
    const gananciaDirecta = spreadNeto * monthsToExpiry;

    // ── Payback de Comisiones ─────────────────────────────────────
    // TEM diaria = (1 + TEM)^(1/30) - 1
    // Payback = Comisión_Total / TEM_diaria
    let paybackDays = 0;
    if (tem > 0) {
      const temDiaria = Math.pow(1 + tem, 1 / 30) - 1;
      if (temDiaria > 0) {
        paybackDays = COMISION_TOTAL / temDiaria;
      }
    }

    // ── Liquidity flag ────────────────────────────────────────────
    const lowLiquidity = nota.v < LOW_LIQUIDITY_THRESHOLD;

    // ── V2.0.2: Delta TIR Calculation ─────────────────────────────
    // Compare TIR at current live price vs TIR at last_close price.
    // last_close is derived from pct_change: last_close = price / (1 + pct_change/100)
    // delta_tir = TIR(live_price) - TIR(last_close)
    let deltaTir: number | null = null;
    let lastClose: number | null = null;

    if (nota.pct_change !== 0 && nota.pct_change !== null && nota.pct_change !== undefined) {
      // Derive last close price from pct_change
      // pct_change = (current_price - last_close) / last_close * 100
      // So: last_close = current_price / (1 + pct_change/100)
      // But in data912, 'c' is in per-100 VN, so we derive from that
      const lastClosePer100 = nota.c / (1 + nota.pct_change / 100);
      if (lastClosePer100 > 0 && isFinite(lastClosePer100)) {
        lastClose = parseFloat((lastClosePer100 / 100).toFixed(6)); // per $1 VN

        // Calculate TIR at last_close price
        const lastCloseAskPer100 = lastClosePer100; // use last_close as ask proxy
        const lastCloseRatio = letra.vpv / lastCloseAskPer100;

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

  // Sort by days_to_expiry ascending
  instruments.sort((a, b) => a.days_to_expiry - b.days_to_expiry);

  // Count by type
  const lecapCount = instruments.filter(i => i.type === 'LECAP').length;
  const boncapCount = instruments.filter(i => i.type === 'BONCAP').length;

  const response = {
    instruments,
    caucion_proxy: {
      tna_promedio: parseFloat(tnaPromedioPF.toFixed(6)),
      tem_caucion: parseFloat(temCaucion.toFixed(6)),
      source: 'argentinadatos_plazoFijo_promedio_-2pp',
    },
    refreshed_at: updatedAt,
    sources: {
      data912_notes: {
        ok: notesResult.ok,
        count: notesCount,
        latency_ms: notesResult.latency_ms,
      },
      data912_bonds: {
        ok: bondsResult.ok,
        count: bondsTotalCount,
        boncaps_matched: bondsBONCAPCount,
        latency_ms: bondsResult.latency_ms,
      },
      argentinadatos: {
        ok: argDatosResult.ok,
        count: argDatosCount,
        latency_ms: argDatosResult.latency_ms,
      },
    },
    stats: {
      total_instruments: instruments.length,
      lecaps: lecapCount,
      boncaps: boncapCount,
    },
  };

  // Update cache
  cache.letras = { data: response, timestamp: now };

  return NextResponse.json(response);
}
