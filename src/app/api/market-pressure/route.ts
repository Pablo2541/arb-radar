// ════════════════════════════════════════════════════════════════════════
// ARB//RADAR V3.2.3-PRO — /api/market-pressure
// Aggregated market pressure data with absorption alerts for all instruments
//
// Accepts GET requests with ?tickers=T15E7,S1L5,T30J7 (comma-separated)
// Returns aggregated bid/ask depth, market pressure, and absorption alerts
// for the requested tickers.
//
// Uses iol-bridge.ts for IOL authentication & data.
// Uses absorption-rule.ts for Dynamic Absorption Rule detection.
//
// ⚠️  SERVER-SIDE ONLY — iol-bridge uses env vars IOL_USERNAME / IOL_PASSWORD
// ════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { getIOLCotizacion, isIOLAvailable, getIOLToken, type IOLLevel2Data } from '@/lib/iol-bridge';
import { detectAbsorption, type AbsorptionAlert } from '@/lib/absorption-rule';

export const dynamic = 'force-dynamic';
export const revalidate = 30;

// In-memory store for rolling averages (simple approach)
const depthHistory: Map<string, Array<{ askDepth: number; timestamp: number }>> = new Map();

const HISTORY_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

interface MarketPressureEntry {
  ticker: string;
  bid_depth: number;
  ask_depth: number;
  market_pressure: number | null;
  status: 'online' | 'offline' | 'no_data' | 'error';
  absorption_alert: AbsorptionAlert | null;
  puntas_detalle: {
    compra: Array<{ cantidad: number; precio: number }>;
    venta: Array<{ cantidad: number; precio: number }>;
  };
}

interface MarketPressureResponse {
  iol_available: boolean;
  data: MarketPressureEntry[];
  alerts: AbsorptionAlert[];
  refreshed_at: string;
  meta: {
    total_tickers: number;
    online_count: number;
    alert_count: number;
  };
}

// GET handler - returns market pressure for all requested IOL-available instruments
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tickersParam = searchParams.get('tickers');

  // Check IOL availability
  if (!isIOLAvailable()) {
    const token = await getIOLToken();
    if (!token) {
      return NextResponse.json({
        iol_available: false,
        data: [],
        alerts: [],
        refreshed_at: new Date().toISOString(),
        meta: { total_tickers: 0, online_count: 0, alert_count: 0 },
      });
    }
  }

  if (!tickersParam) {
    return NextResponse.json(
      { error: true, message: 'Missing required parameter: tickers (comma-separated)' },
      { status: 400 },
    );
  }

  const tickers = tickersParam.split(',').map(t => t.trim().toUpperCase()).filter(Boolean);

  const results: MarketPressureEntry[] = [];
  const now = Date.now();

  // Process in batches of 5
  for (let i = 0; i < tickers.length; i += 5) {
    const batch = tickers.slice(i, i + 5);
    const batchResults = await Promise.all(
      batch.map(async (ticker) => {
        try {
          const l2Data = await getIOLCotizacion(ticker);
          if (!l2Data) {
            return { ticker, bid_depth: 0, ask_depth: 0, market_pressure: null, status: 'error' as const, absorption_alert: null, puntas_detalle: { compra: [], venta: [] } };
          }

          const compraPuntas = l2Data.puntas_detalle?.compra ?? [];
          const ventaPuntas = l2Data.puntas_detalle?.venta ?? [];
          const bidDepth = compraPuntas.reduce((s, p) => s + (p.cantidad || 0), 0);
          const askDepth = ventaPuntas.reduce((s, p) => s + (p.cantidad || 0), 0);
          const marketPressure = askDepth > 0 ? parseFloat((bidDepth / askDepth).toFixed(2)) : (bidDepth > 0 ? null : null);

          // Update depth history for rolling average
          const history = depthHistory.get(ticker) || [];
          history.push({ askDepth, timestamp: now });
          // Keep only last 15 minutes
          const cutoff = now - HISTORY_WINDOW_MS;
          const recentHistory = history.filter(h => h.timestamp >= cutoff);
          depthHistory.set(ticker, recentHistory);

          // Calculate rolling average
          const avgAskDepth = recentHistory.length > 1
            ? recentHistory.reduce((s, h) => s + h.askDepth, 0) / recentHistory.length
            : 0;

          // Detect absorption
          const absorptionAlert = detectAbsorption({
            ticker,
            bidDepth,
            askDepth,
            marketPressure: marketPressure ?? 0,
            puntasCompra: compraPuntas,
            puntasVenta: ventaPuntas,
            avgAskDepth15min: avgAskDepth,
            instrumentType: ticker.startsWith('T') ? 'BONCAP' : 'LECAP',
            tem: 0, // We don't have TEM here; the frontend can supplement
          });

          return {
            ticker,
            bid_depth: bidDepth,
            ask_depth: askDepth,
            market_pressure: marketPressure,
            status: l2Data.iol_status as 'online' | 'offline' | 'no_data',
            absorption_alert: absorptionAlert,
            puntas_detalle: { compra: compraPuntas, venta: ventaPuntas },
          };
        } catch {
          return { ticker, bid_depth: 0, ask_depth: 0, market_pressure: null, status: 'error' as const, absorption_alert: null, puntas_detalle: { compra: [], venta: [] } };
        }
      })
    );

    results.push(...batchResults);

    // Rate limit delay between batches
    if (i + 5 < tickers.length) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  // Collect alerts
  const allAlerts = results.filter(r => r.absorption_alert).map(r => r.absorption_alert!);

  return NextResponse.json({
    iol_available: true,
    data: results,
    alerts: allAlerts,
    refreshed_at: new Date().toISOString(),
    meta: {
      total_tickers: tickers.length,
      online_count: results.filter(r => r.status === 'online').length,
      alert_count: allAlerts.length,
    },
  });
}
