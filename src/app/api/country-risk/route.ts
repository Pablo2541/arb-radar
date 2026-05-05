// V3.2.4-PRO — Country Risk Auto-Fetch API
// Fetches Riesgo País from ArgentinaDatos (daemon updates every 60s)
// Uses date-specific intraday endpoint for current market value
// Persists to Neon PostgreSQL for historical tracking

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

const ARG_DATOS_URL = 'https://api.argentinadatos.com/v1/finanzas/indicadores/riesgo-pais'; // Generic fallback
const CACHE_TTL_MS = 60 * 1000; // 1 minute (daemon now updates every 60s)

// In-memory cache
let cachedValue: number | null = null;
let cachedAt: number = 0;
let cachedSource: string | null = null;

/** Build date-specific intraday URL for today */
function getIntradayUrl(): string {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `https://api.argentinadatos.com/v1/finanzas/indicadores/riesgo-pais/${year}/${month}/${day}`;
}

/** Parse Riesgo País value from API response */
function parseRiesgoPaisData(data: unknown): number | null {
  // Handle array format [{fecha, valor}]
  if (Array.isArray(data) && data.length > 0) {
    return Number(data[data.length - 1]?.valor ?? data[data.length - 1]?.value ?? null);
  }
  // Handle single object format {fecha, valor} (intraday endpoint)
  if (data?.valor != null) return Number(data.valor);
  if (data?.value != null) return Number(data.value);
  return null;
}

async function fetchCountryRisk(): Promise<{ value: number | null; source: string }> {
  // 1. Try date-specific intraday endpoint first (more reliable for current market value)
  const intradayUrl = getIntradayUrl();
  try {
    const res = await fetch(intradayUrl, {
      signal: AbortSignal.timeout(10_000),
      headers: { 'Accept': 'application/json' },
    });
    if (res.ok) {
      const data = await res.json();
      const value = parseRiesgoPaisData(data);
      if (value !== null && value > 0 && isFinite(value)) {
        return { value, source: 'argentinadatos_intraday' };
      }
    }
  } catch {
    // Intraday endpoint failed, try generic fallback
  }

  // 2. Fallback to generic endpoint
  try {
    const res = await fetch(ARG_DATOS_URL, {
      signal: AbortSignal.timeout(10_000),
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) return { value: null, source: 'argentinadatos' };
    const data = await res.json();
    const value = parseRiesgoPaisData(data);
    return { value, source: 'argentinadatos' };
  } catch {
    return { value: null, source: 'argentinadatos' };
  }
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

  // Try fetching from ArgentinaDatos API (intraday → generic fallback)
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
    cachedAt = now; // Reset cache timer to avoid hammering the API
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
    value: 555, // Fallback default
    source: 'fallback',
    updated_at: null,
    next_refresh: new Date(now + CACHE_TTL_MS).toISOString(),
  });
}
