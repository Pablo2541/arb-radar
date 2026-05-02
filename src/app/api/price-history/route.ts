// ════════════════════════════════════════════════════════════════════════
// V3.2 — /api/price-history: Historical Price Data for Historico Tab
//
// GET → Load price history from PriceSnapshot + DailyOHLC tables
//
// Query params:
//   ticker    — Filter by ticker (optional, default: all)
//   days      — Number of days to look back (default: 30)
//   format    — "ohlc" | "snapshots" (default: "ohlc")
// ════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// ── GET: Load price history ─────────────────────────────────────────
export async function GET(request: NextRequest) {
  try {
    const { db } = await import('@/lib/db');
    const searchParams = request.nextUrl.searchParams;
    const ticker = searchParams.get('ticker');
    const days = parseInt(searchParams.get('days') || '30', 10);
    const format = searchParams.get('format') || 'ohlc';

    const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const sinceDateStr = sinceDate.toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' });

    if (format === 'snapshots') {
      // Return raw PriceSnapshot data
      const where = {
        ...(ticker ? { ticker } : {}),
        timestamp: { gte: sinceDate },
      };

      const snapshots = await db.priceSnapshot.findMany({
        where,
        orderBy: { timestamp: 'asc' },
        take: 5000, // Safety limit
      });

      // Get available tickers
      const tickers = await db.priceSnapshot.findMany({
        where: { timestamp: { gte: sinceDate } },
        select: { ticker: true },
        distinct: ['ticker'],
        orderBy: { ticker: 'asc' },
      });

      return NextResponse.json({
        format: 'snapshots',
        tickers: tickers.map(t => t.ticker),
        data: snapshots,
        count: snapshots.length,
        since: sinceDate.toISOString(),
      });
    }

    // Default: OHLC format
    const where = {
      ...(ticker ? { ticker } : {}),
      date: { gte: sinceDateStr },
    };

    const ohlcData = await db.dailyOHLC.findMany({
      where,
      orderBy: [{ ticker: 'asc' }, { date: 'asc' }],
      take: 5000,
    });

    // Get available tickers
    const tickers = await db.dailyOHLC.findMany({
      where: { date: { gte: sinceDateStr } },
      select: { ticker: true },
      distinct: ['ticker'],
      orderBy: { ticker: 'asc' },
    });

    // Get date range
    const latestSnapshot = await db.priceSnapshot.findFirst({
      orderBy: { timestamp: 'desc' },
      select: { timestamp: true },
    });

    // Snapshot count stats
    const snapshotCount = await db.priceSnapshot.count({
      where: { timestamp: { gte: sinceDate } },
    });

    return NextResponse.json({
      format: 'ohlc',
      tickers: tickers.map(t => t.ticker),
      data: ohlcData,
      count: ohlcData.length,
      snapshotCount,
      lastSnapshot: latestSnapshot?.timestamp?.toISOString() || null,
      since: sinceDateStr,
    });
  } catch (error) {
    console.error('[/api/price-history GET] Error:', error);
    return NextResponse.json(
      { fallback: true, error: 'Database unavailable', data: [], tickers: [], count: 0 },
      { status: 200 } // Return 200 with empty data so frontend can show "no data" state
    );
  }
}
