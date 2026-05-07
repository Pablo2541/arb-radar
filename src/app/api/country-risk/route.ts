// ════════════════════════════════════════════════════════════════════════
// V4.0 BLINDADO — Country Risk Auto-Fetch API
//
// ARCHITECTURE: 
//   1. ArgentinaDatos as PRIMARY (JSON API, fast, reliable)
//   2. BondTerminal as SECONDARY (HTML scraping, can be slow)
//   3. Neon DB as TERTIARY fallback (persisted historical value)
//   4. Static fallback as last resort
//
// STABILITY: Each source has a SHORT timeout (3s) to prevent
// server crashes from hanging external HTTP requests.
// Sources are fetched ONE AT A TIME with gaps between them.
// ════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { safeDbOp } from '@/lib/db';

// Sources
const ARG_DATOS_ULTIMO_URL = 'https://api.argentinadatos.com/v1/finanzas/indices/riesgo-pais/ultimo';
const ARG_DATOS_URL = 'https://api.argentinadatos.com/v1/finanzas/indices/riesgo-pais';
const BONDTERMINAL_URL = 'https://bondterminal.com/riesgo-pais';

const CACHE_TTL_MS = 60 * 1000; // 1 minute refresh
const SOURCE_TIMEOUT_MS = 3_000; // 3s max per source — NEVER block longer
const SOURCE_GAP_MS = 300; // 300ms gap between sources

// In-memory cache
let cachedValue: number | null = null;
let cachedAt: number = 0;
let cachedSource: string | null = null;

/** Parse Riesgo País value from ArgentinaDatos JSON response */
function parseArgDatosData(data: unknown): number | null {
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

/** Parse Riesgo País from BondTerminal HTML (scraping) */
function parseBondTerminalHTML(html: string): number | null {
  const match = html.match(/(\d{3,4})\s*pb/);
  if (match) {
    const value = parseInt(match[1], 10);
    if (value > 0 && value < 10000 && isFinite(value)) return value;
  }
  return null;
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function fetchCountryRisk(): Promise<{ value: number | null; source: string }> {
  // ── SOURCE 1: ArgentinaDatos /ultimo (JSON API — fast & reliable) ──
  try {
    const res = await fetch(ARG_DATOS_ULTIMO_URL, {
      signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
      headers: { 'Accept': 'application/json' },
    });
    if (res.ok) {
      const data = await res.json();
      const value = parseArgDatosData(data);
      if (value !== null && value > 0) {
        return { value, source: 'argentinadatos_ultimo' };
      }
    }
  } catch {
    // /ultimo failed — try next source
  }

  await sleep(SOURCE_GAP_MS);

  // ── SOURCE 2: ArgentinaDatos full array ──
  try {
    const res = await fetch(ARG_DATOS_URL, {
      signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
      headers: { 'Accept': 'application/json' },
    });
    if (res.ok) {
      const data = await res.json();
      const value = parseArgDatosData(data);
      if (value !== null && value > 0) {
        return { value, source: 'argentinadatos' };
      }
    }
  } catch {
    // Full array failed
  }

  await sleep(SOURCE_GAP_MS);

  // ── SOURCE 3: BondTerminal (HTML scraping — last resort, can be slow) ──
  try {
    const res = await fetch(BONDTERMINAL_URL, {
      signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
      headers: {
        'Accept': 'text/html',
        'User-Agent': 'Mozilla/5.0 (compatible; ARB-RADAR/4.0)',
      },
    });
    if (res.ok) {
      const html = await res.text();
      const value = parseBondTerminalHTML(html);
      if (value !== null && value > 0) {
        return { value, source: 'bondterminal' };
      }
    }
  } catch {
    // BondTerminal failed
  }

  return { value: null, source: 'failed' };
}

async function getCountryRiskFromDB(): Promise<number | null> {
  try {
    const record = await safeDbOp((db) =>
      db.countryRisk.findUnique({ where: { id: 'main' } })
    );
    return record?.value ?? null;
  } catch {
    return null;
  }
}

async function saveCountryRiskToDB(value: number, source: string): Promise<void> {
  try {
    await safeDbOp((db) =>
      db.countryRisk.upsert({
        where: { id: 'main' },
        update: { value, source },
        create: { id: 'main', value, source },
      })
    );
  } catch {
    // DB unavailable — silently skip persistence
  }
}

export async function GET() {
  const now = Date.now();
  const isCacheValid = cachedValue !== null && (now - cachedAt) < CACHE_TTL_MS;

  if (isCacheValid) {
    return NextResponse.json({
      value: cachedValue,
      source: cachedSource ?? 'cache',
      updated_at: new Date(cachedAt).toISOString(),
      next_refresh: new Date(cachedAt + CACHE_TTL_MS).toISOString(),
    });
  }

  // Try fetching from API sources (one at a time)
  let apiResult: { value: number | null; source: string } = { value: null, source: 'failed' };
  try {
    apiResult = await fetchCountryRisk();
  } catch (error) {
    // If the entire fetch process crashes (shouldn't happen with short timeouts)
    console.error('[country-risk] Fetch error:', error instanceof Error ? error.message : String(error));
  }

  if (apiResult.value !== null && apiResult.value > 0 && isFinite(apiResult.value)) {
    cachedValue = apiResult.value;
    cachedAt = now;
    cachedSource = apiResult.source;

    // Persist to DB in background (don't await)
    saveCountryRiskToDB(apiResult.value, apiResult.source).catch(() => {});

    return NextResponse.json({
      value: apiResult.value,
      source: apiResult.source,
      updated_at: new Date(now).toISOString(),
      next_refresh: new Date(now + CACHE_TTL_MS).toISOString(),
    });
  }

  // API failed — try DB
  try {
    const dbValue = await getCountryRiskFromDB();
    if (dbValue !== null) {
      cachedValue = dbValue;
      cachedAt = now;
      cachedSource = 'database';

      return NextResponse.json({
        value: dbValue,
        source: 'database',
        updated_at: new Date(now).toISOString(),
        next_refresh: new Date(now + CACHE_TTL_MS).toISOString(),
      });
    }
  } catch {
    // DB also failed
  }

  // Everything failed — return fallback
  return NextResponse.json({
    value: cachedValue ?? 528, // Use last known value or default
    source: cachedValue ? 'stale_cache' : 'fallback',
    updated_at: cachedAt > 0 ? new Date(cachedAt).toISOString() : null,
    next_refresh: new Date(now + CACHE_TTL_MS).toISOString(),
  });
}
