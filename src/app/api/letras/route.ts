// ════════════════════════════════════════════════════════════════════════
// V4.0 BLINDADO — /api/letras: Live Data Merge (data912 + ArgentinaDatos)
//
// STABILITY: This route is the #1 crash risk in the sandbox because
// it makes 4 external HTTP requests. V4.0 approach:
//   1. Return CACHED data immediately if available
//   2. If cache is stale, try to refresh in the background
//   3. Each external fetch has a SHORT timeout (3s)
//   4. Fetches are SEQUENTIAL with gaps
//   5. If ANY source fails, use what we have + stale cache
//   6. NEVER let a failed fetch crash the server
// ════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { getIOLCotizacion, getIOLToken, isIOLAvailable, iolCredentialsExist } from '@/lib/iol-bridge';

export const dynamic = 'force-dynamic';
export const revalidate = 60;

// ── Configuration ──────────────────────────────────────────────────────
const COMISION_TOTAL = 0.003;
const LOW_LIQUIDITY_THRESHOLD = 1_000_000;
const CAUCION_HAIRCUT = 0.02;
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
const CACHE_TTL = 55_000;
const SOURCE_TIMEOUT_MS = 3_000;

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
  iol_volume?: number;
  iol_bid?: number;
  iol_ask?: number;
  iol_bid_depth?: number;
  iol_ask_depth?: number;
  iol_market_pressure?: number;
  iol_status?: 'online' | 'offline' | 'no_data';
}

// ── Helpers ────────────────────────────────────────────────────────────

function inferType(ticker: string): 'LECAP' | 'BONCAP' {
  return ticker.startsWith('T') ? 'BONCAP' : 'LECAP';
}

function daysToExpiry(vencimiento: string): number {
  const vto = new Date(vencimiento);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  vto.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((vto.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));
}

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
    return { ok: false, data: null, latency_ms: Date.now() - start };
  }
}

function isRelevantBondTicker(symbol: string): boolean {
  return /^T\d{2}[A-Z]\d$/.test(symbol);
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// ── Background Refresh ────────────────────────────────────────────────
let isRefreshing = false;

async function refreshCache(): Promise<void> {
  if (isRefreshing) return;
  isRefreshing = true;

  try {
    // Sequential fetch with gaps — ONE AT A TIME
    const notesResult = await safeFetch<Data912Note[]>(DATA912_NOTES_URL);
    await sleep(400);
    const bondsResult = await safeFetch<Data912Note[]>(DATA912_BONDS_URL);
    await sleep(400);
    const argDatosResult = await safeFetch<ArgDatosLetra[]>(ARGDATOS_LETRAS_URL);
    await sleep(400);
    const pfResult = await safeFetch<ArgDatosPlazoFijo[]>(ARGDATOS_PF_URL);

    // ── Calculate caución proxy ──
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

    // If ALL sources failed, don't update cache
    if (!notesResult.ok && !bondsResult.ok && !argDatosResult.ok) {
      if (cache.letras) {
        // Mark as stale but keep it
        cache.letras.stale = true;
      }
      return;
    }

    // ── Build maps ──
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

    const argDatosMap = new Map<string, ArgDatosLetra>();
    let argDatosCount = 0;
    if (argDatosResult.ok && argDatosResult.data) {
      argDatosCount = argDatosResult.data.length;
      for (const letra of argDatosResult.data) {
        argDatosMap.set(letra.ticker, letra);
      }
    }

    // ── Merge ──
    const instruments: LiveInstrument[] = [];
    const updatedAt = new Date().toISOString();

    for (const [ticker, nota] of data912Map) {
      const letra = argDatosMap.get(ticker);
      if (!letra) continue;
      if (!nota.c || nota.c <= 0) continue;

      const days = daysToExpiry(letra.fechaVencimiento);
      if (days <= 0) continue;

      const lastPrice = nota.c / 100;
      let bidPrice = nota.px_bid > 0 ? nota.px_bid / 100 : 0;
      let askPrice = nota.px_ask > 0 ? nota.px_ask / 100 : 0;
      const priceEstimated = bidPrice === 0 || askPrice === 0;
      if (bidPrice === 0) bidPrice = lastPrice;
      if (askPrice === 0) askPrice = lastPrice;

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
        ticker, type: inferType(ticker), days_to_expiry: days,
        last_price: parseFloat(lastPrice.toFixed(6)),
        bid: parseFloat(bidPrice.toFixed(6)), ask: parseFloat(askPrice.toFixed(6)),
        vpv: letra.vpv, paridad: parseFloat(paridad.toFixed(4)),
        tir: parseFloat(tir.toFixed(6)), tem: parseFloat(tem.toFixed(6)), tna: parseFloat(tna.toFixed(6)),
        spread_neto: parseFloat(spreadNeto.toFixed(6)),
        ganancia_directa: parseFloat(gananciaDirecta.toFixed(4)),
        payback_days: parseFloat(paybackDays.toFixed(1)),
        change_pct: nota.pct_change, volume: nota.v,
        low_liquidity: lowLiquidity, price_estimated: priceEstimated,
        tem_emision: letra.tem, fecha_vencimiento: letra.fechaVencimiento,
        updated_at: updatedAt, source: nota._source,
        delta_tir: deltaTir, last_close: lastClose,
      });
    }

    instruments.sort((a, b) => a.days_to_expiry - b.days_to_expiry);

    // ── IOL Level 2 Enrichment ──
    let iolEnrichedCount = 0;
    const hasIOLCreds = iolCredentialsExist();
    if (hasIOLCreds && instruments.length > 0) {
      const iolToken = await getIOLToken();
      if (!iolToken) {
        console.warn('[letras] IOL auth failed — skipping Level 2 enrichment');
      } else {
        const IOL_BATCH_DELAY_MS = 300;
        // Only enrich top 20 instruments to reduce request count
        const topInstruments = instruments.slice(0, 20);
        for (const inst of topInstruments) {
          try {
            const l2 = await getIOLCotizacion(inst.ticker);
            if (l2) {
              inst.iol_volume = l2.iol_volume;
              inst.iol_bid = l2.iol_bid;
              inst.iol_ask = l2.iol_ask;
              inst.iol_bid_depth = l2.iol_bid_depth;
              inst.iol_ask_depth = l2.iol_ask_depth;
              inst.iol_market_pressure = l2.iol_market_pressure;
              inst.iol_status = l2.iol_status;
              iolEnrichedCount++;
            }
          } catch {
            // Per-ticker failure — don't cascade
          }
          await sleep(IOL_BATCH_DELAY_MS);
        }
      }
    }

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
        data912_notes: { ok: notesResult.ok, count: notesCount, latency_ms: notesResult.latency_ms },
        data912_bonds: { ok: bondsResult.ok, count: bondsTotalCount, boncaps_matched: bondsBONCAPCount, latency_ms: bondsResult.latency_ms },
        argentinadatos: { ok: argDatosResult.ok, count: argDatosCount, latency_ms: argDatosResult.latency_ms },
        iol_level2: { ok: iolEnrichedCount > 0, count: iolEnrichedCount },
      },
      stats: { total_instruments: instruments.length, lecaps: lecapCount, boncaps: boncapCount },
    };

    cache.letras = { data: response, timestamp: Date.now(), stale: false };
    console.log(`[letras] Cache refreshed: ${instruments.length} instruments, IOL enriched: ${iolEnrichedCount}`);
  } catch (error) {
    console.error('[letras] Refresh error:', error instanceof Error ? error.message : String(error));
    if (cache.letras) cache.letras.stale = true;
  } finally {
    isRefreshing = false;
  }
}

// ── Main Handler ───────────────────────────────────────────────────────

export async function GET() {
  const now = Date.now();

  // If cache is fresh, return it immediately
  if (cache.letras && (now - cache.letras.timestamp) < CACHE_TTL) {
    const responseData = cache.letras.data as Record<string, unknown>;
    return NextResponse.json({
      ...responseData,
      ...(cache.letras.stale ? { stale: true, stale_reason: 'partial_source_failure' } : {}),
    });
  }

  // Cache is stale — trigger background refresh
  // If we have stale cache, return it while refreshing
  if (cache.letras) {
    // Start background refresh (don't await)
    refreshCache().catch(() => {});
    const responseData = cache.letras.data as Record<string, unknown>;
    return NextResponse.json({
      ...responseData,
      stale: true,
      stale_reason: 'refreshing_in_background',
    });
  }

  // No cache at all — must do a blocking refresh (first load)
  await refreshCache();

  if (cache.letras) {
    return NextResponse.json(cache.letras.data);
  }

  // Complete failure
  return NextResponse.json(
    { error: true, message: 'No data available — all sources failed', instruments: [] },
    { status: 502 }
  );
}
