// ════════════════════════════════════════════════════════════════════════
// V4.0 BLINDADO — MARKET TRUTH ENGINE
// Motor de Consenso que valida RP y MEP comparando múltiples fuentes.
//
// STABILITY: Returns cached data immediately if available.
// Refreshes cache in background. NEVER blocks the response
// waiting for all 5 external HTTP sources.
//
// First load: fetches from APIs (may take 3-5s)
// Subsequent: returns cache instantly, refreshes in background
// ════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { safeDbOp } from '@/lib/db';
import type { SourceResult, RPConsensus, MEPConsensus, MarketTruthResponse, ConfidenceLevel } from '@/lib/market-truth-types';

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 60 * 1000;
const SOURCE_TIMEOUT_MS = 3_000;
const SOURCE_GAP_MS = 300;

// RP Sources
const ARG_DATOS_ULTIMO_URL = 'https://api.argentinadatos.com/v1/finanzas/indices/riesgo-pais/ultimo';
const ARG_DATOS_URL = 'https://api.argentinadatos.com/v1/finanzas/indices/riesgo-pais';
const BONDTERMINAL_URL = 'https://bondterminal.com/riesgo-pais';

// MEP Sources
const DATA912_BONDS_URL = 'https://data912.com/live/arg_bonds';
const DOLAR_API_URL = 'https://dolarapi.com/v1/dolares';

// Consensus thresholds
const RP_AGREEMENT_THRESHOLD_PCT = 8;
const RP_EXTENDED_THRESHOLD_PCT = 15;
const MEP_AGREEMENT_THRESHOLD_PCT = 3;
const MEP_EXTENDED_THRESHOLD_PCT = 6;

// ── In-Memory Cache ────────────────────────────────────────────────
let cachedTruth: MarketTruthResponse | null = null;
let cachedAt: number = 0;
let isRefreshing = false;

// ── Source Fetchers (same as before, short timeouts) ──────────────

async function fetchArgDatosUltimoRP(): Promise<SourceResult<number>> {
  const start = Date.now();
  try {
    const res = await fetch(ARG_DATOS_ULTIMO_URL, { signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS), headers: { 'Accept': 'application/json' } });
    const latency_ms = Date.now() - start;
    if (!res.ok) return { value: null, source: 'argentinadatos_ultimo', latency_ms, ok: false, timestamp: new Date().toISOString() };
    const data = await res.json();
    const val = parseArgDatosValue(data);
    return val !== null
      ? { value: val, source: 'argentinadatos_ultimo', latency_ms, ok: true, timestamp: new Date().toISOString(), detail: 'Puede estar desactualizado' }
      : { value: null, source: 'argentinadatos_ultimo', latency_ms, ok: false, timestamp: new Date().toISOString() };
  } catch (err) {
    return { value: null, source: 'argentinadatos_ultimo', latency_ms: Date.now() - start, ok: false, timestamp: new Date().toISOString(), detail: err instanceof Error ? err.message : 'timeout' };
  }
}

async function fetchArgDatosArrayRP(): Promise<SourceResult<number>> {
  const start = Date.now();
  try {
    const res = await fetch(ARG_DATOS_URL, { signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS), headers: { 'Accept': 'application/json' } });
    const latency_ms = Date.now() - start;
    if (!res.ok) return { value: null, source: 'argentinadatos_array', latency_ms, ok: false, timestamp: new Date().toISOString() };
    const data = await res.json();
    const val = parseArgDatosValue(data);
    return val !== null
      ? { value: val, source: 'argentinadatos_array', latency_ms, ok: true, timestamp: new Date().toISOString() }
      : { value: null, source: 'argentinadatos_array', latency_ms, ok: false, timestamp: new Date().toISOString() };
  } catch (err) {
    return { value: null, source: 'argentinadatos_array', latency_ms: Date.now() - start, ok: false, timestamp: new Date().toISOString(), detail: err instanceof Error ? err.message : 'timeout' };
  }
}

async function fetchBondTerminalRP(): Promise<SourceResult<number>> {
  const start = Date.now();
  try {
    const res = await fetch(BONDTERMINAL_URL, {
      signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
      headers: { 'Accept': 'text/html', 'User-Agent': 'Mozilla/5.0 (compatible; ARB-RADAR/4.0)' },
    });
    const latency_ms = Date.now() - start;
    if (!res.ok) return { value: null, source: 'bondterminal', latency_ms, ok: false, timestamp: new Date().toISOString() };
    const html = await res.text();
    const match = html.match(/(\d{3,4})\s*pb/);
    if (match) {
      const value = parseInt(match[1], 10);
      if (value > 0 && value < 10000 && isFinite(value))
        return { value, source: 'bondterminal', latency_ms, ok: true, timestamp: new Date().toISOString() };
    }
    return { value: null, source: 'bondterminal', latency_ms, ok: false, timestamp: new Date().toISOString() };
  } catch (err) {
    return { value: null, source: 'bondterminal', latency_ms: Date.now() - start, ok: false, timestamp: new Date().toISOString(), detail: err instanceof Error ? err.message : 'timeout' };
  }
}

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

interface Data912Bond { symbol: string; c: number; px_bid: number; px_ask: number; pct_change: number; }

async function fetchDirectMEP(): Promise<{
  al30: SourceResult<number>; gd30: SourceResult<number>;
  al30_price: number | undefined; al30d_price: number | undefined;
  gd30_price: number | undefined; gd30d_price: number | undefined;
}> {
  const start = Date.now();
  const empty = {
    al30: { value: null, source: 'data912_al30', latency_ms: 0, ok: false, timestamp: new Date().toISOString() } as SourceResult<number>,
    gd30: { value: null, source: 'data912_gd30', latency_ms: 0, ok: false, timestamp: new Date().toISOString() } as SourceResult<number>,
    al30_price: undefined, al30d_price: undefined, gd30_price: undefined, gd30d_price: undefined,
  };

  try {
    const res = await fetch(DATA912_BONDS_URL, { signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS), headers: { 'Accept': 'application/json' } });
    const latency_ms = Date.now() - start;
    if (!res.ok) { empty.al30.latency_ms = latency_ms; empty.gd30.latency_ms = latency_ms; return empty; }

    const bonds = await res.json() as Data912Bond[];
    const al30 = bonds.find(b => b.symbol === 'AL30');
    const al30d = bonds.find(b => b.symbol === 'AL30D');
    const gd30 = bonds.find(b => b.symbol === 'GD30');
    const gd30d = bonds.find(b => b.symbol === 'GD30D');

    let al30R: SourceResult<number> = { value: null, source: 'data912_al30', latency_ms, ok: false, timestamp: new Date().toISOString() };
    let gd30R: SourceResult<number> = { value: null, source: 'data912_gd30', latency_ms, ok: false, timestamp: new Date().toISOString() };

    if (al30 && al30d && al30.c > 0 && al30d.c > 0) {
      const mep = (al30.c / 100) / (al30d.c / 100);
      if (mep > 0 && isFinite(mep)) al30R = { value: parseFloat(mep.toFixed(2)), source: 'data912_al30_al30d', latency_ms, ok: true, timestamp: new Date().toISOString(), detail: `AL30/AL30D=$${mep.toFixed(2)}` };
    }
    if (gd30 && gd30d && gd30.c > 0 && gd30d.c > 0) {
      const mep = (gd30.c / 100) / (gd30d.c / 100);
      if (mep > 0 && isFinite(mep)) gd30R = { value: parseFloat(mep.toFixed(2)), source: 'data912_gd30_gd30d', latency_ms, ok: true, timestamp: new Date().toISOString(), detail: `GD30/GD30D=$${mep.toFixed(2)}` };
    }

    return {
      al30: al30R, gd30: gd30R,
      al30_price: al30 && al30.c > 0 ? al30.c / 100 : undefined,
      al30d_price: al30d && al30d.c > 0 ? al30d.c / 100 : undefined,
      gd30_price: gd30 && gd30.c > 0 ? gd30.c / 100 : undefined,
      gd30d_price: gd30d && gd30d.c > 0 ? gd30d.c / 100 : undefined,
    };
  } catch (err) {
    empty.al30.latency_ms = Date.now() - start; empty.gd30.latency_ms = Date.now() - start;
    empty.al30.detail = err instanceof Error ? err.message : 'timeout'; empty.gd30.detail = err instanceof Error ? err.message : 'timeout';
    return empty;
  }
}

async function fetchDolarAPIMEP(): Promise<SourceResult<number>> {
  const start = Date.now();
  try {
    const res = await fetch(DOLAR_API_URL, { signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS) });
    const latency_ms = Date.now() - start;
    if (!res.ok) return { value: null, source: 'dolarapi', latency_ms, ok: false, timestamp: new Date().toISOString() };
    const data = await res.json() as Array<{ casa: string; nombre: string; compra: number; venta: number }>;
    const mep = data.find(d => d.casa === 'contadoconliqui2' || d.casa === 'bolsa' || d.nombre?.toLowerCase().includes('mep'));
    if (mep && (mep.compra > 0 || mep.venta > 0)) {
      return { value: parseFloat((mep.venta > 0 ? mep.venta : mep.compra).toFixed(2)), source: 'dolarapi', latency_ms, ok: true, timestamp: new Date().toISOString() };
    }
    return { value: null, source: 'dolarapi', latency_ms, ok: false, timestamp: new Date().toISOString() };
  } catch (err) {
    return { value: null, source: 'dolarapi', latency_ms: Date.now() - start, ok: false, timestamp: new Date().toISOString(), detail: err instanceof Error ? err.message : 'timeout' };
  }
}

// ── Consensus Engine (same as before) ──────────────────────────────

function computeRPConsensus(sources: SourceResult<number>[]): RPConsensus {
  const validSources = sources.filter(s => s.ok && s.value !== null && s.value > 0);
  const values = validSources.map(s => s.value as number);
  const sources_used = validSources.length;
  const sources_total = sources.length;

  if (sources_used === 0) return { value: 0, confidence: 'CRITICA', confidence_pct: 0, sources_used: 0, sources_total, agreement: false, best_source: 'none', all_sources: sources, spread_between_sources: 0 };
  if (sources_used === 1) return { value: values[0], confidence: 'BAJA', confidence_pct: 35, sources_used: 1, sources_total, agreement: false, best_source: validSources[0].source, all_sources: sources, spread_between_sources: 0 };

  const maxVal = Math.max(...values); const minVal = Math.min(...values);
  const avgVal = values.reduce((a, b) => a + b, 0) / values.length;
  const spreadPct = ((maxVal - minVal) / avgVal) * 100;

  const sourcePriority = ['bondterminal', 'argentinadatos_ultimo', 'argentinadatos_array'];
  let bestSource = validSources[0];
  for (const p of sourcePriority) { const f = validSources.find(s => s.source === p); if (f) { bestSource = f; break; } }

  const isAgreement = spreadPct <= RP_AGREEMENT_THRESHOLD_PCT;
  const isExtendedAgreement = spreadPct <= RP_EXTENDED_THRESHOLD_PCT;

  let confidence: ConfidenceLevel; let confidence_pct: number;
  if (isAgreement && sources_used >= 2) { confidence = 'ALTA'; confidence_pct = Math.min(98, 85 + sources_used * 5 - Math.floor(spreadPct)); }
  else if (isExtendedAgreement || (isAgreement && sources_used === 2)) { confidence = 'MEDIA'; confidence_pct = Math.min(85, 60 + sources_used * 5 - Math.floor(spreadPct)); }
  else { confidence = 'MEDIA'; confidence_pct = Math.max(40, 60 - Math.floor(spreadPct)); }

  return { value: bestSource.value as number, confidence, confidence_pct, sources_used, sources_total, agreement: isAgreement, best_source: bestSource.source, all_sources: sources, spread_between_sources: parseFloat(spreadPct.toFixed(1)) };
}

function computeMEPConsensus(sources: SourceResult<number>[], al30_price?: number, al30d_price?: number, gd30_price?: number, gd30d_price?: number): MEPConsensus {
  const validSources = sources.filter(s => s.ok && s.value !== null && s.value > 0);
  const values = validSources.map(s => s.value as number);
  const sources_used = validSources.length;
  const sources_total = sources.length;

  if (sources_used === 0) return { value: 0, confidence: 'CRITICA', confidence_pct: 0, sources_used: 0, sources_total, agreement: false, best_source: 'none', all_sources: sources, spread_between_sources: 0, al30_price, al30d_price, gd30_price, gd30d_price };
  if (sources_used === 1) return { value: values[0], confidence: 'BAJA', confidence_pct: 35, sources_used: 1, sources_total, agreement: false, best_source: validSources[0].source, all_sources: sources, spread_between_sources: 0, al30_price, al30d_price, gd30_price, gd30d_price };

  const maxVal = Math.max(...values); const minVal = Math.min(...values);
  const avgVal = values.reduce((a, b) => a + b, 0) / values.length;
  const spreadPct = ((maxVal - minVal) / avgVal) * 100;

  const sourcePriority = ['data912_al30_al30d', 'data912_gd30_gd30d', 'dolarapi'];
  let bestSource = validSources[0];
  for (const p of sourcePriority) { const f = validSources.find(s => s.source === p); if (f) { bestSource = f; break; } }

  const isAgreement = spreadPct <= MEP_AGREEMENT_THRESHOLD_PCT;
  const isExtendedAgreement = spreadPct <= MEP_EXTENDED_THRESHOLD_PCT;

  let confidence: ConfidenceLevel; let confidence_pct: number;
  if (isAgreement && sources_used >= 2) { confidence = 'ALTA'; confidence_pct = Math.min(98, 85 + sources_used * 5 - Math.floor(spreadPct)); }
  else if (isExtendedAgreement || (isAgreement && sources_used === 2)) { confidence = 'MEDIA'; confidence_pct = Math.min(85, 60 + sources_used * 5 - Math.floor(spreadPct)); }
  else { confidence = 'MEDIA'; confidence_pct = Math.max(40, 60 - Math.floor(spreadPct)); }

  return { value: bestSource.value as number, confidence, confidence_pct, sources_used, sources_total, agreement: isAgreement, best_source: bestSource.source, all_sources: sources, spread_between_sources: parseFloat(spreadPct.toFixed(1)), al30_price, al30d_price, gd30_price, gd30d_price };
}

// ── DB Persistence ─────────────────────────────────────────────────

async function saveRPToDB(value: number, source: string): Promise<void> {
  try { await safeDbOp((db) => db.countryRisk.upsert({ where: { id: 'main' }, update: { value, source }, create: { id: 'main', value, source } })); } catch { /* */ }
}
async function loadRPFromDB(): Promise<number | null> {
  try { const r = await safeDbOp((db) => db.countryRisk.findUnique({ where: { id: 'main' } })); return r?.value ?? null; } catch { return null; }
}

// ── Background Refresh ────────────────────────────────────────────

async function refreshCache(): Promise<void> {
  if (isRefreshing) return;
  isRefreshing = true;

  try {
    const argDatosUltimoRP = await fetchArgDatosUltimoRP();
    await sleep(SOURCE_GAP_MS);
    const argDatosArrayRP = await fetchArgDatosArrayRP();
    await sleep(SOURCE_GAP_MS);
    const bondTerminalRP = await fetchBondTerminalRP();
    await sleep(SOURCE_GAP_MS);
    const directMEP = await fetchDirectMEP();
    await sleep(SOURCE_GAP_MS);
    const dolarAPIMEP = await fetchDolarAPIMEP();

    const rpSources = [argDatosUltimoRP, argDatosArrayRP, bondTerminalRP];
    const rpConsensus = computeRPConsensus(rpSources);

    if (rpConsensus.confidence === 'CRITICA') {
      const dbValue = await loadRPFromDB();
      if (dbValue !== null && dbValue > 0) { rpConsensus.value = dbValue; rpConsensus.confidence = 'BAJA'; rpConsensus.confidence_pct = 30; rpConsensus.best_source = 'database_fallback'; }
    }

    if (rpConsensus.value > 0 && rpConsensus.confidence !== 'CRITICA') saveRPToDB(rpConsensus.value, rpConsensus.best_source).catch(() => {});

    const mepSources = [directMEP.al30, directMEP.gd30, dolarAPIMEP];
    const mepConsensus = computeMEPConsensus(mepSources, directMEP.al30_price, directMEP.al30d_price, directMEP.gd30_price, directMEP.gd30d_price);

    const bothCritical = rpConsensus.confidence === 'CRITICA' && mepConsensus.confidence === 'CRITICA';
    if (bothCritical && cachedTruth) {
      cachedTruth = { ...cachedTruth, stale: true, stale_reason: 'all_sources_failed', next_refresh: new Date(Date.now() + CACHE_TTL_MS).toISOString() };
      return;
    }

    cachedTruth = {
      riesgo_pais: rpConsensus,
      mep: mepConsensus,
      timestamp: new Date().toISOString(),
      next_refresh: new Date(Date.now() + CACHE_TTL_MS).toISOString(),
      engine_version: 'V4.0-BLINDADO',
      stale: false,
    };
    cachedAt = Date.now();
    console.log(`[market-truth] Cache refreshed: RP=${rpConsensus.value} (${rpConsensus.confidence}), MEP=${mepConsensus.value} (${mepConsensus.confidence})`);
  } catch (error) {
    console.error('[market-truth] Refresh error:', error instanceof Error ? error.message : String(error));
    if (cachedTruth) cachedTruth.stale = true;
  } finally {
    isRefreshing = false;
  }
}

// ── Main Handler ───────────────────────────────────────────────────

export async function GET() {
  const now = Date.now();

  // Return cache if fresh
  if (cachedTruth && (now - cachedAt) < CACHE_TTL_MS) {
    return NextResponse.json(cachedTruth);
  }

  // Cache is stale — trigger background refresh
  if (cachedTruth) {
    refreshCache().catch(() => {});
    return NextResponse.json({ ...cachedTruth, stale: true, stale_reason: 'refreshing_in_background' });
  }

  // No cache at all — must do blocking refresh (first load)
  await refreshCache();

  if (cachedTruth) {
    return NextResponse.json(cachedTruth);
  }

  // Complete failure — return error structure
  return NextResponse.json({
    riesgo_pais: { value: 0, confidence: 'CRITICA', confidence_pct: 0, sources_used: 0, sources_total: 3, agreement: false, best_source: 'none', all_sources: [], spread_between_sources: 0 },
    mep: { value: 0, confidence: 'CRITICA', confidence_pct: 0, sources_used: 0, sources_total: 3, agreement: false, best_source: 'none', all_sources: [], spread_between_sources: 0 },
    timestamp: new Date(now).toISOString(),
    next_refresh: new Date(now + CACHE_TTL_MS).toISOString(),
    engine_version: 'V4.0-BLINDADO',
    stale: false,
  });
}
