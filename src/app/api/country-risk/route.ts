// V3.2.3-PRO — Country Risk Auto-Fetch API
// Fetches Riesgo País from ArgentinaDatos every 15 minutes
// Persists to Neon PostgreSQL for historical tracking

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

const ARG_DATOS_URL = 'https://api.argentinadatos.com/v1/finanzas/indicadores/riesgo-pais';
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

// In-memory cache
let cachedValue: number | null = null;
let cachedAt: number = 0;

async function fetchCountryRisk(): Promise<number | null> {
  try {
    const res = await fetch(ARG_DATOS_URL, {
      signal: AbortSignal.timeout(10_000),
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    // ArgentinaDatos returns { fecha, valor } or array of { fecha, valor }
    if (Array.isArray(data) && data.length > 0) {
      return Number(data[data.length - 1]?.valor ?? data[data.length - 1]?.value ?? null);
    }
    if (data?.valor != null) return Number(data.valor);
    if (data?.value != null) return Number(data.value);
    return null;
  } catch {
    return null;
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

async function saveCountryRiskToDB(value: number): Promise<void> {
  try {
    await db.countryRisk.upsert({
      where: { id: 'main' },
      update: { value, source: 'argentinadatos' },
      create: { id: 'main', value, source: 'argentinadatos' },
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
      source: 'cache',
      updated_at: new Date(cachedAt).toISOString(),
      next_refresh: new Date(cachedAt + CACHE_TTL_MS).toISOString(),
    });
  }

  // Try fetching from ArgentinaDatos API
  const apiValue = await fetchCountryRisk();

  if (apiValue !== null && apiValue > 0 && isFinite(apiValue)) {
    cachedValue = apiValue;
    cachedAt = now;

    // Persist to DB in background (don't await)
    saveCountryRiskToDB(apiValue);

    return NextResponse.json({
      value: apiValue,
      source: 'argentinadatos',
      updated_at: new Date(now).toISOString(),
      next_refresh: new Date(now + CACHE_TTL_MS).toISOString(),
    });
  }

  // API failed — try DB
  const dbValue = await getCountryRiskFromDB();
  if (dbValue !== null) {
    cachedValue = dbValue;
    cachedAt = now; // Reset cache timer to avoid hammering the API

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
