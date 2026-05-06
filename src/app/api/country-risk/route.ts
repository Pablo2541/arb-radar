// V3.3-PRO — Country Risk Auto-Fetch API
// V3.3-PRO: BondTerminal as primary source (real-time, 558pb current)
// ArgentinaDatos /ultimo as secondary (often stale, e.g. 539pb from days ago)
// ArgentinaDatos /indices/ as tertiary fallback
// Persists to Neon PostgreSQL for historical tracking

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

// Sources — priority order
const BONDTERMINAL_URL = 'https://bondterminal.com/riesgo-pais';
const ARG_DATOS_ULTIMO_URL = 'https://api.argentinadatos.com/v1/finanzas/indices/riesgo-pais/ultimo';
const ARG_DATOS_URL = 'https://api.argentinadatos.com/v1/finanzas/indices/riesgo-pais';
const CACHE_TTL_MS = 60 * 1000; // 1 minute refresh

// In-memory cache
let cachedValue: number | null = null;
let cachedAt: number = 0;
let cachedSource: string | null = null;

/** Parse Riesgo País from BondTerminal HTML (scraping) */
function parseBondTerminalHTML(html: string): number | null {
  // BondTerminal shows the value as "558 pb" in the HTML
  const match = html.match(/(\d{3,4})\s*pb/);
  if (match) {
    const value = parseInt(match[1], 10);
    if (value > 0 && value < 10000 && isFinite(value)) return value;
  }
  return null;
}

/** Parse Riesgo País value from ArgentinaDatos JSON response */
function parseArgDatosData(data: unknown): number | null {
  // Handle array format [{fecha, valor}]
  if (Array.isArray(data) && data.length > 0) {
    const val = Number(data[data.length - 1]?.valor ?? data[data.length - 1]?.value ?? 0);
    return val > 0 && isFinite(val) ? Math.round(val) : null;
  }
  // Handle single object format {fecha, valor} (intraday/ultimo endpoint)
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    const val = Number(obj.valor ?? obj.value ?? 0);
    return val > 0 && isFinite(val) ? Math.round(val) : null;
  }
  return null;
}

async function fetchCountryRisk(): Promise<{ value: number | null; source: string }> {
  // ── SOURCE 1: BondTerminal (real-time, most reliable) ──
  try {
    const res = await fetch(BONDTERMINAL_URL, {
      signal: AbortSignal.timeout(8_000),
      headers: {
        'Accept': 'text/html',
        'User-Agent': 'Mozilla/5.0 (compatible; ARB-RADAR/3.2.4)',
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
    // BondTerminal failed, try next source
  }

  // ── SOURCE 2: ArgentinaDatos /ultimo (may be stale by days) ──
  try {
    const res = await fetch(ARG_DATOS_ULTIMO_URL, {
      signal: AbortSignal.timeout(8_000),
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
    // /ultimo failed
  }

  // ── SOURCE 3: ArgentinaDatos generic (full historical array) ──
  try {
    const res = await fetch(ARG_DATOS_URL, {
      signal: AbortSignal.timeout(8_000),
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
    // Generic endpoint also failed
  }

  return { value: null, source: 'failed' };
}

async function getCountryRiskFromDB(): Promise<number | null> {
  try {
    const record = await db.countryRisk.findUnique({ where: { id: 'main' } });
    return record?.value ?? null;
  } catch {
    return null;
  }
}

async function saveCountryRiskToDB(value: number, source: string): Promise<void> {
  try {
    await db.countryRisk.upsert({
      where: { id: 'main' },
      update: { value, source },
      create: { id: 'main', value, source },
    });
  } catch {
    // DB unavailable — silent fail, use in-memory cache
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

  // Try fetching from all sources (BondTerminal → ArgentinaDatos → ArgentinaDatos/ultimo)
  const { value: apiValue, source: apiSource } = await fetchCountryRisk();

  if (apiValue !== null && apiValue > 0 && isFinite(apiValue)) {
    cachedValue = apiValue;
    cachedAt = now;
    cachedSource = apiSource;

    // Persist to DB in background (don't await)
    saveCountryRiskToDB(apiValue, apiSource);

    return NextResponse.json({
      value: apiValue,
      source: apiSource,
      updated_at: new Date(now).toISOString(),
      next_refresh: new Date(now + CACHE_TTL_MS).toISOString(),
    });
  }

  // API failed — try DB
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

  // Everything failed — return fallback
  return NextResponse.json({
    value: 558, // Fallback default (updated from latest BondTerminal value)
    source: 'fallback',
    updated_at: null,
    next_refresh: new Date(now + CACHE_TTL_MS).toISOString(),
  });
}
