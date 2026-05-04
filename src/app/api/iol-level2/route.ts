// ════════════════════════════════════════════════════════════════════════
// ARB//RADAR V3.2.2-PRO — /api/iol-level2
// Real-time IOL Level 2 data for frontend queries
//
// Accepts GET requests with ?tickers=T15E7,S1L5 (comma-separated)
// Returns enriched Level-2 data including Market Pressure (bid/ask depth)
// and Absorption Rule alerts for wall detection.
//
// Uses iol-bridge.ts (server-side only) for IOL authentication & data.
// Results are cached for 30 seconds in memory.
//
// V3.2.2-PRO: Added absorption_alert field with Dynamic Absorption Rule.
//
// ⚠️  SERVER-SIDE ONLY — iol-bridge uses env vars IOL_USERNAME / IOL_PASSWORD
// ════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import {
  getIOLToken,
  getIOLCotizacion,
  isIOLAvailable,
  type IOLLevel2Data,
  type IOLPunta,
} from '@/lib/iol-bridge';
import { detectAbsorption, type AbsorptionAlert } from '@/lib/absorption-rule';

export const dynamic = 'force-dynamic';
export const revalidate = 30; // cache for 30 seconds

// ── Configuration ──────────────────────────────────────────────────────

/** In-memory cache TTL (slightly less than revalidate to ensure freshness) */
const CACHE_TTL_MS = 29_000;

/** Maximum number of tickers allowed in a single request */
const MAX_TICKERS = 20;

/** Batch size for IOL API requests (rate-limit respect) */
const BATCH_SIZE = 5;

/** Delay between batches in ms */
const BATCH_DELAY_MS = 200;

// ── Types ──────────────────────────────────────────────────────────────

interface TickerLevel2Data {
  volume: number;
  bid: number;
  ask: number;
  bid_depth: number;
  ask_depth: number;
  market_pressure: number | null;
  avg_daily_volume: number;
  status: 'online' | 'offline' | 'no_data' | 'error';
  liquidity_alert: boolean;
  puntas_detalle: {
    compra: IOLPunta[];
    venta: IOLPunta[];
  };
  /** V3.2.2-PRO: Absorption Rule alert (null if no wall detected) */
  absorption_alert: AbsorptionAlert | null;
}

interface Level2Response {
  iol_available: boolean;
  data: Record<string, TickerLevel2Data>;
  refreshed_at: string;
  token_status: 'valid' | 'invalid' | 'not_configured';
  meta?: {
    tickers_requested: number;
    tickers_resolved: number;
    tickers_failed: number;
    alert_count: number;
  };
}

// ── In-Memory Cache ────────────────────────────────────────────────────

interface CacheEntry {
  key: string;
  data: Level2Response;
  timestamp: number;
}

let cachedEntry: CacheEntry | null = null;

// ── In-Memory Depth History (for rolling averages) ─────────────────────

const depthHistory: Map<string, Array<{ askDepth: number; timestamp: number }>> = new Map();

const HISTORY_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Update the depth history for a ticker and return the rolling average.
 */
function updateDepthHistory(ticker: string, askDepth: number): number {
  const now = Date.now();
  const history = depthHistory.get(ticker) || [];

  // Add new entry
  history.push({ askDepth, timestamp: now });

  // Prune entries older than 15 minutes
  const cutoff = now - HISTORY_WINDOW_MS;
  const recentHistory = history.filter(h => h.timestamp >= cutoff);
  depthHistory.set(ticker, recentHistory);

  // Calculate rolling average (need at least 2 data points for meaningful average)
  if (recentHistory.length < 2) return 0;
  return recentHistory.reduce((sum, h) => sum + h.askDepth, 0) / recentHistory.length;
}

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Calculate total quantity across all order book levels.
 */
function calcDepth(levels: IOLPunta[]): number {
  if (!levels || levels.length === 0) return 0;
  return levels.reduce((sum, p) => sum + (p.cantidad || 0), 0);
}

/**
 * Calculate market pressure ratio.
 *   > 1 → buying pressure (more bid depth)
 *   = 1 → balanced
 *   < 1 → selling pressure (more ask depth)
 *   null → no depth on either side
 */
function calcMarketPressure(bidDepth: number, askDepth: number): number | null {
  if (bidDepth === 0 && askDepth === 0) return null;
  if (askDepth === 0) return bidDepth > 0 ? Infinity : null;
  const ratio = bidDepth / askDepth;
  return parseFloat(ratio.toFixed(2));
}

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Process a single ticker's IOL data into enriched Level-2 data.
 * Includes absorption detection using the Dynamic Absorption Rule.
 */
function enrichLevel2Data(ticker: string, l2: IOLLevel2Data): TickerLevel2Data {
  const compraPuntas = l2.puntas_detalle?.compra ?? [];
  const ventaPuntas = l2.puntas_detalle?.venta ?? [];

  const bidDepth = calcDepth(compraPuntas);
  const askDepth = calcDepth(ventaPuntas);
  const marketPressure = calcMarketPressure(bidDepth, askDepth);

  // Update depth history and get rolling average
  const avgAskDepth15min = updateDepthHistory(ticker, askDepth);

  // Run absorption detection
  const absorptionAlert = detectAbsorption({
    ticker,
    bidDepth,
    askDepth,
    marketPressure: marketPressure ?? 0,
    puntasCompra: compraPuntas,
    puntasVenta: ventaPuntas,
    avgAskDepth15min,
    instrumentType: ticker.startsWith('T') ? 'BONCAP' : 'LECAP',
    tem: 0, // TEM not available in Level-2 data; frontend can supplement
  });

  return {
    volume: l2.iol_volume,
    bid: l2.iol_bid,
    ask: l2.iol_ask,
    bid_depth: bidDepth,
    ask_depth: askDepth,
    market_pressure: marketPressure,
    avg_daily_volume: l2.iol_avg_daily_volume,
    status: l2.iol_status,
    liquidity_alert: l2.iol_liquidity_alert,
    puntas_detalle: {
      compra: compraPuntas,
      venta: ventaPuntas,
    },
    absorption_alert: absorptionAlert,
  };
}

/**
 * Process tickers in batches with rate-limit delays.
 */
async function fetchTickersInBatches(
  tickers: string[],
): Promise<Record<string, TickerLevel2Data>> {
  const results: Record<string, TickerLevel2Data> = {};

  for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
    const batch = tickers.slice(i, i + BATCH_SIZE);

    // Process batch in parallel
    const batchResults = await Promise.all(
      batch.map(async (ticker) => {
        try {
          const l2Data = await getIOLCotizacion(ticker);
          if (l2Data) {
            return { ticker, data: enrichLevel2Data(ticker, l2Data) };
          }
          // getIOLCotizacion returned null — token or network error
          return {
            ticker,
            data: {
              volume: 0,
              bid: 0,
              ask: 0,
              bid_depth: 0,
              ask_depth: 0,
              market_pressure: null,
              avg_daily_volume: 0,
              status: 'error' as const,
              liquidity_alert: false,
              puntas_detalle: { compra: [], venta: [] },
              absorption_alert: null,
            },
          };
        } catch {
          return {
            ticker,
            data: {
              volume: 0,
              bid: 0,
              ask: 0,
              bid_depth: 0,
              ask_depth: 0,
              market_pressure: null,
              avg_daily_volume: 0,
              status: 'error' as const,
              liquidity_alert: false,
              puntas_detalle: { compra: [], venta: [] },
              absorption_alert: null,
            },
          };
        }
      }),
    );

    for (const { ticker, data } of batchResults) {
      results[ticker] = data;
    }

    // Rate-limit delay between batches (skip after last batch)
    if (i + BATCH_SIZE < tickers.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  return results;
}

// ── Main Handler ───────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tickersParam = searchParams.get('tickers');

  // ── Validate tickers parameter ─────────────────────────────────────
  if (!tickersParam) {
    return NextResponse.json(
      {
        error: true,
        message: 'Missing required query parameter: tickers (comma-separated list, e.g. ?tickers=T15E7,S1L5)',
      },
      { status: 400 },
    );
  }

  const tickers = tickersParam
    .split(',')
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean);

  if (tickers.length === 0) {
    return NextResponse.json(
      {
        error: true,
        message: 'No valid tickers provided. Use comma-separated list, e.g. ?tickers=T15E7,S1L5',
      },
      { status: 400 },
    );
  }

  if (tickers.length > MAX_TICKERS) {
    return NextResponse.json(
      {
        error: true,
        message: `Too many tickers requested (${tickers.length}). Maximum is ${MAX_TICKERS}.`,
      },
      { status: 400 },
    );
  }

  // ── Check IOL availability ─────────────────────────────────────────
  if (!isIOLAvailable()) {
    // Check if credentials are even configured
    const hasCredentials = !!(process.env.IOL_USERNAME && process.env.IOL_PASSWORD);

    if (!hasCredentials) {
      return NextResponse.json({
        iol_available: false,
        data: {},
        refreshed_at: new Date().toISOString(),
        token_status: 'not_configured',
        meta: {
          tickers_requested: tickers.length,
          tickers_resolved: 0,
          tickers_failed: tickers.length,
          alert_count: 0,
        },
      });
    }

    // Credentials exist but token is stale — try to authenticate
    const token = await getIOLToken();
    if (!token) {
      return NextResponse.json({
        iol_available: false,
        data: {},
        refreshed_at: new Date().toISOString(),
        token_status: 'invalid',
        meta: {
          tickers_requested: tickers.length,
          tickers_resolved: 0,
          tickers_failed: tickers.length,
          alert_count: 0,
        },
      });
    }
  }

  // ── Check cache ────────────────────────────────────────────────────
  const cacheKey = tickers.sort().join(',');
  const now = Date.now();

  if (cachedEntry && cachedEntry.key === cacheKey && (now - cachedEntry.timestamp) < CACHE_TTL_MS) {
    return NextResponse.json(cachedEntry.data);
  }

  // ── Ensure token is valid before batch fetch ───────────────────────
  const token = await getIOLToken();
  const tokenStatus = token ? 'valid' : 'invalid';

  if (!token) {
    return NextResponse.json({
      iol_available: false,
      data: {},
      refreshed_at: new Date().toISOString(),
      token_status: 'invalid',
      meta: {
        tickers_requested: tickers.length,
        tickers_resolved: 0,
        tickers_failed: tickers.length,
        alert_count: 0,
      },
    });
  }

  // ── Fetch data in batches ──────────────────────────────────────────
  const data = await fetchTickersInBatches(tickers);

  // ── Build response ─────────────────────────────────────────────────
  const tickersResolved = Object.values(data).filter((d) => d.status !== 'error').length;
  const tickersFailed = Object.values(data).filter((d) => d.status === 'error').length;
  const alertCount = Object.values(data).filter((d) => d.absorption_alert !== null).length;

  const response: Level2Response = {
    iol_available: true,
    data,
    refreshed_at: new Date().toISOString(),
    token_status: tokenStatus,
    meta: {
      tickers_requested: tickers.length,
      tickers_resolved: tickersResolved,
      tickers_failed: tickersFailed,
      alert_count: alertCount,
    },
  };

  // ── Update cache ───────────────────────────────────────────────────
  cachedEntry = { key: cacheKey, data: response, timestamp: now };

  return NextResponse.json(response);
}
