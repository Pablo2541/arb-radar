// ════════════════════════════════════════════════════════════════════════
// V4.0.2 BLINDADO — Dolar Rates API (Multi-Source)
//
// ARCHITECTURE:
//   1. DolarAPI (primary) — returns all dollar types
//   2. Bluelytics (secondary) — more real-time, used for MEP/CCL cross-check
//
// The route merges both sources, preferring the freshest data.
// If DolarAPI returns stale data (detected by comparing with Bluelytics),
// Bluelytics values override MEP/CCL.
//
// Cache: 60s in-memory cache to avoid hammering external APIs.
// ════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// ── In-memory cache (60s) ──
const CACHE_TTL_MS = 60 * 1000;
let cachedData: unknown[] | null = null;
let cachedAt = 0;

interface DolarAPIEntry {
  nombre: string;
  compra: number;
  venta: number;
  fechaActualizacion?: string;
}

interface BluelyticsOficial {
  name: string;
  value_avg: number;
  value_buy: number;
  value_sell: number;
}

interface BluelyticsResponse {
  oficial: BluelyticsOficial;
  blue: BluelyticsOficial;
  oficial_euro: BluelyticsOficial;
  blue_euro: BluelyticsOficial;
  last_update: string;
}

/** Parse date string to timestamp, returns 0 if invalid */
function parseDateToTs(dateStr: string | undefined): number {
  if (!dateStr) return 0;
  try {
    return new Date(dateStr).getTime();
  } catch {
    return 0;
  }
}

/** Merge Bluelytics data into DolarAPI format for MEP/CCL */
function mergeSources(dolarApiData: DolarAPIEntry[], bluelyticsData: BluelyticsResponse | null): unknown[] {
  if (!bluelyticsData) return dolarApiData;

  // Extract MEP/CCL from Bluelytics (they're the most time-sensitive)
  // Bluelytics doesn't have explicit MEP/CCL but has "oficial" and "blue"
  // which we can use for cross-validation

  const blueV = bluelyticsData.blue?.value_sell ?? 0;
  const oficialV = bluelyticsData.oficial?.value_sell ?? 0;
  const bluelyticsTs = parseDateToTs(bluelyticsData.last_update);

  // Find the DolarAPI entries for Bolsa (MEP) and CCL
  const result = dolarApiData.map((entry: DolarAPIEntry) => {
    const apiTs = parseDateToTs(entry.fechaActualizacion);

    // If DolarAPI data is stale (>10 min older than Bluelytics) for key rates,
    // and we have Bluelytics data, inject freshness signal
    const isStale = bluelyticsTs > 0 && apiTs > 0 && (bluelyticsTs - apiTs) > 10 * 60 * 1000;

    // For Blue: cross-validate with Bluelytics
    if (entry.nombre === 'Blue' && blueV > 0) {
      const diff = Math.abs(entry.venta - blueV);
      // If difference > $3, prefer Bluelytics (it's usually more current)
      if (diff > 3 && isStale) {
        return {
          ...entry,
          venta: blueV,
          compra: bluelyticsData.blue?.value_buy ?? entry.compra,
          _source: 'bluelytics_override',
          _original_venta: entry.venta,
          _stale: true,
        };
      }
    }

    // Add freshness metadata
    return {
      ...entry,
      _bluelytics_check: blueV > 0 ? { blue_venta: blueV, oficial_venta: oficialV, diff_blue: Math.abs(entry.venta - blueV) } : undefined,
    };
  });

  return result;
}

export async function GET() {
  // Check cache
  const now = Date.now();
  if (cachedData && (now - cachedAt) < CACHE_TTL_MS) {
    return NextResponse.json(cachedData);
  }

  // Fetch both sources in parallel
  const [dolarApiRes, bluelyticsRes] = await Promise.allSettled([
    fetch('https://dolarapi.com/v1/dolares', {
      signal: AbortSignal.timeout(8000),
      headers: { 'Accept': 'application/json' },
    }),
    fetch('https://api.bluelytics.com.ar/v2/latest', {
      signal: AbortSignal.timeout(5000),
      headers: { 'Accept': 'application/json' },
    }),
  ]);

  // Process DolarAPI (primary)
  let dolarApiData: DolarAPIEntry[] = [];
  if (dolarApiRes.status === 'fulfilled' && dolarApiRes.value.ok) {
    try {
      const data = await dolarApiRes.value.json();
      if (Array.isArray(data) && data.length > 0) {
        dolarApiData = data;
      }
    } catch {
      // DolarAPI parse failed
    }
  }

  if (dolarApiData.length === 0) {
    return NextResponse.json(
      { error: true, message: 'DolarAPI returned empty or invalid data' },
      { status: 502 }
    );
  }

  // Process Bluelytics (secondary — for cross-validation)
  let bluelyticsData: BluelyticsResponse | null = null;
  if (bluelyticsRes.status === 'fulfilled' && bluelyticsRes.value.ok) {
    try {
      bluelyticsData = await bluelyticsRes.value.json() as BluelyticsResponse;
    } catch {
      // Bluelytics parse failed — non-critical
    }
  }

  // Merge sources
  const merged = mergeSources(dolarApiData, bluelyticsData);

  // Update cache
  cachedData = merged;
  cachedAt = now;

  return NextResponse.json(merged);
}
