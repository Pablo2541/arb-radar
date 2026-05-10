// ════════════════════════════════════════════════════════════════════════
// V3.3-PRO — MARKET TRUTH ENGINE
// Motor de Consenso que valida RP y MEP comparando múltiples fuentes
// y asigna niveles de confianza automáticamente.
//
// FUENTES RP (Riesgo País):
//   1. BondTerminal (HTML scraping, real-time) — PRIMARY
//   2. ArgentinaDatos /ultimo (may be stale)
//   3. ArgentinaDatos /indices (full array)
//
// FUENTES MEP (Dólar MEP):
//   1. Cálculo directo AL30/AL30D desde data912 — PRIMARY (intraday real)
//   2. Cálculo directo GD30/GD30D desde data912 — SECONDARY
//   3. dolarapi.com/v1/dolares — TERTIARY
//
// MOTOR DE CONSENSO:
//   - Compara todas las fuentes disponibles en paralelo
//   - Si concuerdan (Δ < threshold) → Confianza ALTA
//   - Si discrepan → Usa la fuente más confiable, Confianza MEDIA
//   - Si solo 1 fuente → Confianza BAJA
//   - Si 0 fuentes → Confianza CRITICA
//
// BLINDAJE: La comisión del 0.15% NO se toca.
// ════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import type { ConfidenceLevel, SourceResult, RPConsensus, MEPConsensus, MarketTruthResponse } from '@/lib/market-truth-types';

export const dynamic = 'force-dynamic';

// ── Configuration ──────────────────────────────────────────────────
const CACHE_TTL_MS = 60 * 1000; // 60s refresh for ArgentinaDatos and data912
const SOURCE_TIMEOUT_MS = 2_000; // 2s max per source — never block the UI longer

// RP Sources
const BONDTERMINAL_URL = 'https://bondterminal.com/riesgo-pais';
const ARG_DATOS_ULTIMO_URL = 'https://api.argentinadatos.com/v1/finanzas/indices/riesgo-pais/ultimo';
const ARG_DATOS_URL = 'https://api.argentinadatos.com/v1/finanzas/indices/riesgo-pais';

// MEP Sources
const DATA912_BONDS_URL = 'https://data912.com/live/arg_bonds';
const DOLAR_API_URL = 'https://dolarapi.com/v1/dolares';

// Consensus thresholds
const RP_AGREEMENT_THRESHOLD_PCT = 8;  // ±8% agreement for ALTA confidence
const RP_EXTENDED_THRESHOLD_PCT = 15;  // ±15% for MEDIA confidence
const MEP_AGREEMENT_THRESHOLD_PCT = 3; // ±3% for ALTA confidence
const MEP_EXTENDED_THRESHOLD_PCT = 6;  // ±6% for MEDIA confidence

// ── In-Memory Cache ────────────────────────────────────────────────

let cachedTruth: MarketTruthResponse | null = null;
let cachedAt: number = 0;

// ── RP Source Fetchers ─────────────────────────────────────────────

/** Parse Riesgo País from BondTerminal HTML */
async function fetchBondTerminalRP(): Promise<SourceResult<number>> {
  const start = Date.now();
  try {
    const res = await fetch(BONDTERMINAL_URL, {
      signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
      headers: {
        'Accept': 'text/html',
        'User-Agent': 'Mozilla/5.0 (compatible; ARB-RADAR/3.3)',
      },
    });
    const latency_ms = Date.now() - start;
    if (!res.ok) return { value: null, source: 'bondterminal', latency_ms, ok: false, timestamp: new Date().toISOString() };

    const html = await res.text();
    // BondTerminal shows value as "528 pb" in HTML
    const match = html.match(/(\d{3,4})\s*pb/);
    if (match) {
      const value = parseInt(match[1], 10);
      if (value > 0 && value < 10000 && isFinite(value)) {
        return { value, source: 'bondterminal', latency_ms, ok: true, timestamp: new Date().toISOString() };
      }
    }
    return { value: null, source: 'bondterminal', latency_ms, ok: false, timestamp: new Date().toISOString(), detail: 'No se pudo parsear valor' };
  } catch (err) {
    return { value: null, source: 'bondterminal', latency_ms: Date.now() - start, ok: false, timestamp: new Date().toISOString(), detail: err instanceof Error ? err.message : 'timeout' };
  }
}

/** Fetch RP from ArgentinaDatos /ultimo */
async function fetchArgDatosUltimoRP(): Promise<SourceResult<number>> {
  const start = Date.now();
  try {
    const res = await fetch(ARG_DATOS_ULTIMO_URL, {
      signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
      headers: { 'Accept': 'application/json' },
    });
    const latency_ms = Date.now() - start;
    if (!res.ok) return { value: null, source: 'argentinadatos_ultimo', latency_ms, ok: false, timestamp: new Date().toISOString() };

    const data = await res.json();
    const value = parseArgDatosValue(data);
    if (value !== null) {
      return { value, source: 'argentinadatos_ultimo', latency_ms, ok: true, timestamp: new Date().toISOString(), detail: 'Puede estar desactualizado (datos diarios, no intradía)' };
    }
    return { value: null, source: 'argentinadatos_ultimo', latency_ms, ok: false, timestamp: new Date().toISOString() };
  } catch (err) {
    return { value: null, source: 'argentinadatos_ultimo', latency_ms: Date.now() - start, ok: false, timestamp: new Date().toISOString(), detail: err instanceof Error ? err.message : 'timeout' };
  }
}

/** Fetch RP from ArgentinaDatos full array */
async function fetchArgDatosArrayRP(): Promise<SourceResult<number>> {
  const start = Date.now();
  try {
    const res = await fetch(ARG_DATOS_URL, {
      signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
      headers: { 'Accept': 'application/json' },
    });
    const latency_ms = Date.now() - start;
    if (!res.ok) return { value: null, source: 'argentinadatos_array', latency_ms, ok: false, timestamp: new Date().toISOString() };

    const data = await res.json();
    const value = parseArgDatosValue(data);
    if (value !== null) {
      return { value, source: 'argentinadatos_array', latency_ms, ok: true, timestamp: new Date().toISOString() };
    }
    return { value: null, source: 'argentinadatos_array', latency_ms, ok: false, timestamp: new Date().toISOString() };
  } catch (err) {
    return { value: null, source: 'argentinadatos_array', latency_ms: Date.now() - start, ok: false, timestamp: new Date().toISOString(), detail: err instanceof Error ? err.message : 'timeout' };
  }
}

/** Parse ArgentinaDatos RP value */
function parseArgDatosValue(data: unknown): number | null {
  if (Array.isArray(data) && data.length > 0) {
    const val = Number(data[data.length - 1]?.valor ?? data[data.length - 1]?.value ?? 0);
    return val > 0 && isFinite(val) ? Math.round(val) : null;
  }
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    const val = Number(obj.valor ?? obj.value ?? 0);
    return val > 0 && isFinite(val) ? Math.round(val) : null;
  }
  return null;
}

// ── MEP Source Fetchers ────────────────────────────────────────────

/** Data912 bond structure */
interface Data912Bond {
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

/** Fetch all bonds from data912 and calculate MEP from AL30/AL30D and GD30/GD30D */
async function fetchDirectMEP(): Promise<{
  al30: SourceResult<number>;
  gd30: SourceResult<number>;
  al30_price: number | undefined;
  al30d_price: number | undefined;
  gd30_price: number | undefined;
  gd30d_price: number | undefined;
}> {
  const start = Date.now();
  const emptyResult = {
    al30: { value: null, source: 'data912_al30', latency_ms: 0, ok: false, timestamp: new Date().toISOString() } as SourceResult<number>,
    gd30: { value: null, source: 'data912_gd30', latency_ms: 0, ok: false, timestamp: new Date().toISOString() } as SourceResult<number>,
    al30_price: undefined as number | undefined,
    al30d_price: undefined as number | undefined,
    gd30_price: undefined as number | undefined,
    gd30d_price: undefined as number | undefined,
  };

  try {
    const res = await fetch(DATA912_BONDS_URL, {
      signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
      headers: { 'Accept': 'application/json' },
    });
    const latency_ms = Date.now() - start;
    if (!res.ok) {
      emptyResult.al30.latency_ms = latency_ms;
      emptyResult.gd30.latency_ms = latency_ms;
      return emptyResult;
    }

    const bonds = await res.json() as Data912Bond[];

    // Find AL30 and AL30D
    const al30 = bonds.find(b => b.symbol === 'AL30');
    const al30d = bonds.find(b => b.symbol === 'AL30D');
    const gd30 = bonds.find(b => b.symbol === 'GD30');
    const gd30d = bonds.find(b => b.symbol === 'GD30D');

    let al30MEPResult: SourceResult<number> = { value: null, source: 'data912_al30', latency_ms, ok: false, timestamp: new Date().toISOString() };
    let gd30MEPResult: SourceResult<number> = { value: null, source: 'data912_gd30', latency_ms, ok: false, timestamp: new Date().toISOString() };

    // AL30 / AL30D — the TRUE intraday MEP
    if (al30 && al30d && al30.c > 0 && al30d.c > 0) {
      // Prices in data912 are per 100 VN, so we divide by 100 to get per 1 VN
      const al30Price = al30.c / 100;
      const al30dPrice = al30d.c / 100;
      const mep = al30Price / al30dPrice;
      if (mep > 0 && isFinite(mep)) {
        al30MEPResult = {
          value: parseFloat(mep.toFixed(2)),
          source: 'data912_al30_al30d',
          latency_ms,
          ok: true,
          timestamp: new Date().toISOString(),
          detail: `AL30=$${al30Price.toFixed(4)} / AL30D=$${al30dPrice.toFixed(4)} = $${mep.toFixed(2)}`,
        };
      }
    }

    // GD30 / GD30D — alternative MEP pair (backup)
    if (gd30 && gd30d && gd30.c > 0 && gd30d.c > 0) {
      const gd30Price = gd30.c / 100;
      const gd30dPrice = gd30d.c / 100;
      const mep = gd30Price / gd30dPrice;
      if (mep > 0 && isFinite(mep)) {
        gd30MEPResult = {
          value: parseFloat(mep.toFixed(2)),
          source: 'data912_gd30_gd30d',
          latency_ms,
          ok: true,
          timestamp: new Date().toISOString(),
          detail: `GD30=$${gd30Price.toFixed(4)} / GD30D=$${gd30dPrice.toFixed(4)} = $${mep.toFixed(2)}`,
        };
      }
    }

    return {
      al30: al30MEPResult,
      gd30: gd30MEPResult,
      al30_price: al30 && al30.c > 0 ? al30.c / 100 : undefined,
      al30d_price: al30d && al30d.c > 0 ? al30d.c / 100 : undefined,
      gd30_price: gd30 && gd30.c > 0 ? gd30.c / 100 : undefined,
      gd30d_price: gd30d && gd30d.c > 0 ? gd30d.c / 100 : undefined,
    };
  } catch (err) {
    emptyResult.al30.latency_ms = Date.now() - start;
    emptyResult.gd30.latency_ms = Date.now() - start;
    emptyResult.al30.detail = err instanceof Error ? err.message : 'timeout';
    emptyResult.gd30.detail = err instanceof Error ? err.message : 'timeout';
    return emptyResult;
  }
}

/** Fetch MEP from dolarapi.com */
async function fetchDolarAPIMEP(): Promise<SourceResult<number>> {
  const start = Date.now();
  try {
    const res = await fetch(DOLAR_API_URL, {
      signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
    });
    const latency_ms = Date.now() - start;
    if (!res.ok) return { value: null, source: 'dolarapi', latency_ms, ok: false, timestamp: new Date().toISOString() };

    const data = await res.json() as Array<{ casa: string; nombre: string; compra: number; venta: number }>;
    // Find MEP entry
    const mep = data.find(d => d.casa === 'contadoconliqui2' || d.casa === 'bolsa' || d.nombre?.toLowerCase().includes('mep') || d.nombre?.toLowerCase().includes('bolsa'));
    if (mep && (mep.compra > 0 || mep.venta > 0)) {
      const value = mep.venta > 0 ? mep.venta : mep.compra;
      return { value: parseFloat(value.toFixed(2)), source: 'dolarapi', latency_ms, ok: true, timestamp: new Date().toISOString() };
    }
    return { value: null, source: 'dolarapi', latency_ms, ok: false, timestamp: new Date().toISOString(), detail: 'MEP no encontrado en respuesta' };
  } catch (err) {
    return { value: null, source: 'dolarapi', latency_ms: Date.now() - start, ok: false, timestamp: new Date().toISOString(), detail: err instanceof Error ? err.message : 'timeout' };
  }
}

// ── Consensus Engine ───────────────────────────────────────────────

function computeRPConsensus(sources: SourceResult<number>[]): RPConsensus {
  const validSources = sources.filter(s => s.ok && s.value !== null && s.value > 0);
  const values = validSources.map(s => s.value as number);
  const sources_used = validSources.length;
  const sources_total = sources.length;

  // No valid sources
  if (sources_used === 0) {
    return {
      value: 0,
      confidence: 'CRITICA',
      confidence_pct: 0,
      sources_used: 0,
      sources_total,
      agreement: false,
      best_source: 'none',
      all_sources: sources,
      spread_between_sources: 0,
    };
  }

  // Only one source
  if (sources_used === 1) {
    return {
      value: values[0],
      confidence: 'BAJA',
      confidence_pct: 35,
      sources_used: 1,
      sources_total,
      agreement: false,
      best_source: validSources[0].source,
      all_sources: sources,
      spread_between_sources: 0,
    };
  }

  // Multiple sources — compute consensus
  const maxVal = Math.max(...values);
  const minVal = Math.min(...values);
  const avgVal = values.reduce((a, b) => a + b, 0) / values.length;
  const spreadPct = ((maxVal - minVal) / avgVal) * 100;

  // Determine best source: BondTerminal is king, then ArgDatos
  const sourcePriority = ['bondterminal', 'argentinadatos_ultimo', 'argentinadatos_array'];
  let bestSource = validSources[0];
  for (const priority of sourcePriority) {
    const found = validSources.find(s => s.source === priority);
    if (found) {
      bestSource = found;
      break;
    }
  }

  // Agreement check
  const isAgreement = spreadPct <= RP_AGREEMENT_THRESHOLD_PCT;
  const isExtendedAgreement = spreadPct <= RP_EXTENDED_THRESHOLD_PCT;

  let confidence: ConfidenceLevel;
  let confidence_pct: number;

  if (isAgreement && sources_used >= 2) {
    confidence = 'ALTA';
    confidence_pct = Math.min(98, 85 + sources_used * 5 - Math.floor(spreadPct));
  } else if (isExtendedAgreement || (isAgreement && sources_used === 2)) {
    confidence = 'MEDIA';
    confidence_pct = Math.min(85, 60 + sources_used * 5 - Math.floor(spreadPct));
  } else {
    // Significant disagreement — still use best source but flag it
    confidence = 'MEDIA';
    confidence_pct = Math.max(40, 60 - Math.floor(spreadPct));
  }

  // Use best source value (not average) — BondTerminal is real-time truth
  return {
    value: bestSource.value as number,
    confidence,
    confidence_pct,
    sources_used,
    sources_total,
    agreement: isAgreement,
    best_source: bestSource.source,
    all_sources: sources,
    spread_between_sources: parseFloat(spreadPct.toFixed(1)),
  };
}

function computeMEPConsensus(
  sources: SourceResult<number>[],
  al30_price?: number,
  al30d_price?: number,
  gd30_price?: number,
  gd30d_price?: number,
): MEPConsensus {
  const validSources = sources.filter(s => s.ok && s.value !== null && s.value > 0);
  const values = validSources.map(s => s.value as number);
  const sources_used = validSources.length;
  const sources_total = sources.length;

  if (sources_used === 0) {
    return {
      value: 0,
      confidence: 'CRITICA',
      confidence_pct: 0,
      sources_used: 0,
      sources_total,
      agreement: false,
      best_source: 'none',
      all_sources: sources,
      spread_between_sources: 0,
      al30_price,
      al30d_price,
      gd30_price,
      gd30d_price,
    };
  }

  if (sources_used === 1) {
    return {
      value: values[0],
      confidence: 'BAJA',
      confidence_pct: 35,
      sources_used: 1,
      sources_total,
      agreement: false,
      best_source: validSources[0].source,
      all_sources: sources,
      spread_between_sources: 0,
      al30_price,
      al30d_price,
      gd30_price,
      gd30d_price,
    };
  }

  const maxVal = Math.max(...values);
  const minVal = Math.min(...values);
  const avgVal = values.reduce((a, b) => a + b, 0) / values.length;
  const spreadPct = ((maxVal - minVal) / avgVal) * 100;

  // Best source: direct AL30/AL30D calculation is king
  const sourcePriority = ['data912_al30_al30d', 'data912_gd30_gd30d', 'dolarapi'];
  let bestSource = validSources[0];
  for (const priority of sourcePriority) {
    const found = validSources.find(s => s.source === priority);
    if (found) {
      bestSource = found;
      break;
    }
  }

  const isAgreement = spreadPct <= MEP_AGREEMENT_THRESHOLD_PCT;
  const isExtendedAgreement = spreadPct <= MEP_EXTENDED_THRESHOLD_PCT;

  let confidence: ConfidenceLevel;
  let confidence_pct: number;

  if (isAgreement && sources_used >= 2) {
    confidence = 'ALTA';
    confidence_pct = Math.min(98, 85 + sources_used * 5 - Math.floor(spreadPct));
  } else if (isExtendedAgreement || (isAgreement && sources_used === 2)) {
    confidence = 'MEDIA';
    confidence_pct = Math.min(85, 60 + sources_used * 5 - Math.floor(spreadPct));
  } else {
    confidence = 'MEDIA';
    confidence_pct = Math.max(40, 60 - Math.floor(spreadPct));
  }

  return {
    value: bestSource.value as number,
    confidence,
    confidence_pct,
    sources_used,
    sources_total,
    agreement: isAgreement,
    best_source: bestSource.source,
    all_sources: sources,
    spread_between_sources: parseFloat(spreadPct.toFixed(1)),
    al30_price,
    al30d_price,
    gd30_price,
    gd30d_price,
  };
}

// ── DB Persistence ─────────────────────────────────────────────────

async function saveRPToDB(value: number, source: string): Promise<void> {
  try {
    await db.countryRisk.upsert({
      where: { id: 'main' },
      update: { value, source },
      create: { id: 'main', value, source },
    });
  } catch {
    // DB unavailable — silent fail
  }
}

async function loadRPFromDB(): Promise<number | null> {
  try {
    const record = await db.countryRisk.findUnique({ where: { id: 'main' } });
    return record?.value ?? null;
  } catch {
    return null;
  }
}

// ── Main Handler ───────────────────────────────────────────────────

export async function GET() {
  const now = Date.now();

  // Return cache if fresh
  if (cachedTruth && (now - cachedAt) < CACHE_TTL_MS) {
    return NextResponse.json(cachedTruth);
  }

  // ── FETCH ALL SOURCES IN PARALLEL ──
  const [
    bondTerminalRP,
    argDatosUltimoRP,
    argDatosArrayRP,
    directMEP,
    dolarAPIMEP,
  ] = await Promise.all([
    fetchBondTerminalRP(),
    fetchArgDatosUltimoRP(),
    fetchArgDatosArrayRP(),
    fetchDirectMEP(),
    fetchDolarAPIMEP(),
  ]);

  // ── COMPUTE RP CONSENSUS ──
  const rpSources = [bondTerminalRP, argDatosUltimoRP, argDatosArrayRP];
  const rpConsensus = computeRPConsensus(rpSources);

  // If no valid RP sources, try DB fallback
  if (rpConsensus.confidence === 'CRITICA') {
    const dbValue = await loadRPFromDB();
    if (dbValue !== null && dbValue > 0) {
      rpConsensus.value = dbValue;
      rpConsensus.confidence = 'BAJA';
      rpConsensus.confidence_pct = 30;
      rpConsensus.best_source = 'database_fallback';
    }
  }

  // Persist RP to DB in background (best source value)
  if (rpConsensus.value > 0 && rpConsensus.confidence !== 'CRITICA') {
    saveRPToDB(rpConsensus.value, rpConsensus.best_source).catch(() => {});
  }

  // ── COMPUTE MEP CONSENSUS ──
  const mepSources = [directMEP.al30, directMEP.gd30, dolarAPIMEP];
  const mepConsensus = computeMEPConsensus(
    mepSources,
    directMEP.al30_price,
    directMEP.al30d_price,
    directMEP.gd30_price,
    directMEP.gd30d_price,
  );

  // ── BUILD RESPONSE ──
  const timestamp = new Date(now).toISOString();

  // SWR: If BOTH RP and MEP are CRITICA (all sources failed), return stale cache if available
  const bothCritical = rpConsensus.confidence === 'CRITICA' && mepConsensus.confidence === 'CRITICA';
  if (bothCritical && cachedTruth) {
    console.warn('[market-truth] All sources CRITICA — returning stale cache');
    const staleResponse: MarketTruthResponse = {
      ...cachedTruth,
      stale: true,
      stale_reason: 'all_sources_failed',
      next_refresh: new Date(now + CACHE_TTL_MS).toISOString(),
    };
    return NextResponse.json(staleResponse);
  }

  const response: MarketTruthResponse = {
    riesgo_pais: rpConsensus,
    mep: mepConsensus,
    timestamp,
    next_refresh: new Date(now + CACHE_TTL_MS).toISOString(),
    engine_version: 'V3.4.2-PRO',
    stale: false,
  };

  // Cache it
  cachedTruth = response;
  cachedAt = now;

  return NextResponse.json(response);
}
