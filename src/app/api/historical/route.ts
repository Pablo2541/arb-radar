// ════════════════════════════════════════════════════════════════════════
// V3.2 — Historical Price Data Query Endpoint
//
// Returns accumulated historical LECAP/BONCAP data from our DB.
// Supports: ticker-specific, date range, OHLC aggregation,
// and CSV/XLSX export.
// ════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const ticker = searchParams.get('ticker');
    const format = searchParams.get('format') || 'json'; // json | csv
    const days = parseInt(searchParams.get('days') || '30');
    const view = searchParams.get('view') || 'ohlc'; // ohlc | snapshots | summary
    
    // Limit query range
    const maxDays = Math.min(days, 365);
    const since = new Date();
    since.setDate(since.getDate() - maxDays);

    if (view === 'summary') {
      // ── Summary: available tickers with date ranges ──
      const tickers = await db.dailyOHLC.groupBy({
        by: ['ticker'],
        _count: { ticker: true },
        _min: { date: true },
        _max: { date: true },
        orderBy: { ticker: 'asc' },
      });

      const summary = await Promise.all(tickers.map(async (t) => {
        const latest = await db.dailyOHLC.findFirst({
          where: { ticker: t.ticker },
          orderBy: { date: 'desc' },
        });
        return {
          ticker: t.ticker,
          days_available: t._count.ticker,
          first_date: t._min.date,
          last_date: t._max.date,
          latest_close: latest?.close ?? null,
          latest_vpv: latest?.vpv ?? null,
          latest_tem: latest?.avgTem ?? null,
        };
      }));

      return NextResponse.json({ ok: true, summary, total_tickers: summary.length });
    }

    if (view === 'snapshots' && ticker) {
      // ── Raw snapshots for a specific ticker ──
      const snapshots = await db.priceSnapshot.findMany({
        where: {
          ticker,
          timestamp: { gte: since },
        },
        orderBy: { timestamp: 'desc' },
        take: 1000,
      });

      if (format === 'csv') {
        const headers = 'timestamp,ticker,type,price,bid,ask,volume,pctChange,vpv,tem,tir,tna,daysToExpiry,source';
        const rows = snapshots.map(s => 
          `${s.timestamp.toISOString()},${s.ticker},${s.type},${s.price},${s.bid ?? ''},${s.ask ?? ''},${s.volume},${s.pctChange},${s.vpv ?? ''},${s.tem ?? ''},${s.tir ?? ''},${s.tna ?? ''},${s.daysToExpiry ?? ''},${s.source}`
        );
        const csv = [headers, ...rows].join('\n');
        return new NextResponse(csv, {
          headers: {
            'Content-Type': 'text/csv',
            'Content-Disposition': `attachment; filename="snapshots_${ticker}_${new Date().toISOString().split('T')[0]}.csv"`,
          },
        });
      }

      return NextResponse.json({ ok: true, ticker, snapshots, count: snapshots.length });
    }

    // ── OHLC view (default) ──
    const where: Record<string, unknown> = {};
    if (ticker) where.ticker = ticker;
    where.date = { gte: since.toISOString().split('T')[0] };

    const ohlc = await db.dailyOHLC.findMany({
      where,
      orderBy: [{ ticker: 'asc' }, { date: 'asc' }],
      take: 5000,
    });

    if (format === 'csv') {
      const headers = 'date,ticker,open,high,low,close,volume,avgTem,avgTir,vpv,snapshotCount';
      const rows = ohlc.map(d =>
        `${d.date},${d.ticker},${d.open},${d.high},${d.low},${d.close},${d.volume},${d.avgTem ?? ''},${d.avgTir ?? ''},${d.vpv ?? ''},${d.snapshotCount}`
      );
      const csv = [headers, ...rows].join('\n');
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="historical_${ticker || 'all'}_${new Date().toISOString().split('T')[0]}.csv"`,
        },
      });
    }

    // Group by ticker for chart-friendly format
    const grouped: Record<string, Array<{
      date: string; open: number; high: number; low: number; close: number;
      volume: number; avgTem: number | null; avgTir: number | null;
      vpv: number | null; snapshotCount: number;
    }>> = {};

    for (const d of ohlc) {
      if (!grouped[d.ticker]) grouped[d.ticker] = [];
      grouped[d.ticker].push({
        date: d.date, open: d.open, high: d.high, low: d.low, close: d.close,
        volume: d.volume, avgTem: d.avgTem, avgTir: d.avgTir,
        vpv: d.vpv, snapshotCount: d.snapshotCount,
      });
    }

    return NextResponse.json({ 
      ok: true, 
      ticker: ticker || 'all',
      days: maxDays,
      data: grouped,
      total_records: ohlc.length,
      tickers: Object.keys(grouped),
    });
  } catch (error) {
    console.error('[/api/historical] Error:', error);
    return NextResponse.json(
      { ok: false, error: 'Failed to query historical data' },
      { status: 500 }
    );
  }
}
