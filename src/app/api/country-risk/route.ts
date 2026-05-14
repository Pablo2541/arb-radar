// ════════════════════════════════════════════════════════════════════════
// V4.0.2 BLINDADO — Country Risk Auto-Fetch API
//
// ARCHITECTURE (V4.0.2 — RAVA is PRIMARY):
//   1. RAVA Bursátil as PRIMARY (real-time value from rava.com — the truth)
//   2. ArgentinaDatos as SECONDARY (JSON API — can be stale/delayed)
//   3. SQLite DB as TERTIARY fallback (persisted historical value)
//   4. Static fallback as last resort
//
// V4.0.2: BondTerminal removed — replaced with RAVA Bursátil scraper.
//   RAVA provides the real Riesgo País value via:
//   - JSON-LD structured data ("price": NNN)
//   - Main price display (<div id="izqCotiza">)
//   Both are scraped from https://www.rava.com/perfil/RIESGO%20PAIS
//
// STABILITY: Each source has a SHORT timeout (5s) to prevent
// server crashes from hanging external HTTP requests.
// Sources are fetched ONE AT A TIME with gaps between them.
// ════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { safeDbOp } from '@/lib/db';

// Sources
const ARG_DATOS_ULTIMO_URL = 'https://api.argentinadatos.com/v1/finanzas/indices/riesgo-pais/ultimo';
const ARG_DATOS_URL = 'https://api.argentinadatos.com/v1/finanzas/indices/riesgo-pais';
const RAVA_RIESGO_PAIS_URL = 'https://www.rava.com/perfil/RIESGO%20PAIS';

const CACHE_TTL_MS = 60 * 1000; // 1 minute refresh
const SOURCE_TIMEOUT_MS = 3_000; // 3s max for ArgentinaDatos
const RAVA_TIMEOUT_MS = 5_000;   // 5s for RAVA (HTML page, slower)
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

/**
 * V4.0.2 — Parse Riesgo País from RAVA HTML.
 * 
 * Strategy (ordered by reliability):
 *   1. JSON-LD structured data: "price":NNN in FinancialProduct schema
 *   2. Main price display: <div id="izqCotiza"><p>NNN,00</p>
 *   3. Fallback: first 3-4 digit number followed by ",00" pattern
 */
function parseRavaHTML(html: string): number | null {
  // ── Strategy 1: JSON-LD FinancialProduct ──
  // RAVA embeds: {"@type":"FinancialProduct","offers":{"price":522}}
  const ldMatch = html.match(/"price":\s*(\d{2,4})/);
  if (ldMatch) {
    const value = parseInt(ldMatch[1], 10);
    if (value > 50 && value < 10000 && isFinite(value)) return value;
  }

  // ── Strategy 2: izqCotiza main price display ──
  // <div id="izqCotiza"><p>522,00</p>
  const izqMatch = html.match(/id="izqCotiza"[^>]*>\s*<p>([\d,\.]+)<\/p>/);
  if (izqMatch) {
    const parsed = parseFloat(izqMatch[1].replace(',', '.'));
    if (parsed > 50 && isFinite(parsed)) return Math.round(parsed);
  }

  // ── Strategy 3: Fallback — look for NNN,00 pattern near "riesgo" ──
  const riesgoContext = html.substring(
    Math.max(0, html.toLowerCase().indexOf('riesgo pais') - 500),
    html.toLowerCase().indexOf('riesgo pais') + 2000
  );
  const fallbackMatch = riesgoContext.match(/(\d{3,4}),00/);
  if (fallbackMatch) {
    const value = parseInt(fallbackMatch[1], 10);
    if (value > 50 && value < 10000 && isFinite(value)) return value;
  }

  return null;
}

/**
 * V4.0.2 — Extract additional data from RAVA HTML.
 * Returns OHLC (Apertura, Máximo, Mínimo, Anterior) and variation.
 */
export function parseRavaExtra(html: string): {
  anterior: number | null;
  apertura: number | null;
  maximo: number | null;
  minimo: number | null;
  variacion: number | null;
} {
  const result = {
    anterior: null as number | null,
    apertura: null as number | null,
    maximo: null as number | null,
    minimo: null as number | null,
    variacion: null as number | null,
  };

  // Extract from centroCotiza: <span>Anterior:</span><span class="bolder">523,00</span>
  const anteriorMatch = html.match(/Anterior:\s*<\/span>\s*<span[^>]*>([\d,\.]+)<\/span>/);
  if (anteriorMatch) {
    const v = parseFloat(anteriorMatch[1].replace(',', '.'));
    if (isFinite(v)) result.anterior = v;
  }

  const aperturaMatch = html.match(/Apertura:\s*<\/span>\s*<span[^>]*>([\d,\.]+)<\/span>/);
  if (aperturaMatch) {
    const v = parseFloat(aperturaMatch[1].replace(',', '.'));
    if (isFinite(v)) result.apertura = v;
  }

  const maximoMatch = html.match(/M[aá]ximo:\s*<\/span>\s*<span[^>]*>([\d,\.]+)<\/span>/);
  if (maximoMatch) {
    const v = parseFloat(maximoMatch[1].replace(',', '.'));
    if (isFinite(v)) result.maximo = v;
  }

  const minimoMatch = html.match(/M[ií]nimo:\s*<\/span>\s*<span[^>]*>([\d,\.]+)<\/span>/);
  if (minimoMatch) {
    const v = parseFloat(minimoMatch[1].replace(',', '.'));
    if (isFinite(v)) result.minimo = v;
  }

  // Variation: <p class="negativo">-0,20</p> or <p class="positivo">+1,50</p>
  const variacionMatch = html.match(/class="(negativo|positivo)"[^>]*>\s*([+-]?[\d,\.]+)\s*<\/p>/);
  if (variacionMatch) {
    const v = parseFloat(variacionMatch[2].replace(',', '.'));
    if (isFinite(v)) result.variacion = variacionMatch[1] === 'negativo' ? -Math.abs(v) : Math.abs(v);
  }

  return result;
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function fetchCountryRisk(): Promise<{ value: number | null; source: string }> {
  // ── SOURCE 1: RAVA Bursátil (PRIMARY — real-time value, the truth) ──
  // RAVA shows the actual Riesgo País value as it trades right now.
  // ArgentinaDatos can be hours/days stale. RAVA is always current.
  try {
    const res = await fetch(RAVA_RIESGO_PAIS_URL, {
      signal: AbortSignal.timeout(RAVA_TIMEOUT_MS),
      headers: {
        'Accept': 'text/html',
        'User-Agent': 'Mozilla/5.0 (compatible; ARB-RADAR/4.0)',
      },
    });
    if (res.ok) {
      const html = await res.text();
      const value = parseRavaHTML(html);
      if (value !== null && value > 0) {
        return { value, source: 'rava' };
      }
    }
  } catch {
    // RAVA failed — fall through to ArgentinaDatos
  }

  await sleep(SOURCE_GAP_MS);

  // ── SOURCE 2: ArgentinaDatos /ultimo (SECONDARY — can be stale) ──
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

  // ── SOURCE 3: ArgentinaDatos full array (last API resort) ──
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
