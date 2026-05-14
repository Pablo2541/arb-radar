// ════════════════════════════════════════════════════════════════════════
// V4.0.1 BLINDADO — /api/price-history
// SQLite DB historical data (READ-ONLY for charts)
//
// ARCHITECTURE: SQLite DB is used for historical OHLC data.
// Portfolio/capital is NOT stored here — that's in portfolio.json.
//
// STABILITY: All DB queries are SEQUENTIAL (not Promise.all)
// to prevent SQLite connection overload. Each query has safeDbOp
// wrapping with timeout and cooldown.
//
// V4.0.1: Handles missing fields gracefully — if a field doesn't
// exist in a particular record (e.g., older records without
// temOpen/iolVolume), returns 0 as fallback.
// ════════════════════════════════════════════════════════════════════════

import { safeDbOp } from '@/lib/db'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic';

// ── Safe field accessor ────────────────────────────────────────────
// Returns 0 if the field is undefined/null (e.g., older records
// that were created before the V4.0.1 schema expansion).
function numOrZero(val: unknown): number {
  if (typeof val === 'number' && isFinite(val)) return val;
  return 0;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type')
    const ticker = searchParams.get('ticker')

    // ── OHLC ──────────────────────────────────────────────────────────
    if (type === 'ohlc') {
      const days = Math.max(1, Number(searchParams.get('days')) || 30)
      const fromDate = formatDate(subDays(new Date(), days))

      const where: Record<string, unknown> = { date: { gte: fromDate } }
      if (ticker) where.ticker = ticker

      const ohlc = await safeDbOp((db) =>
        db.dailyOHLC.findMany({
          where,
          orderBy: [{ ticker: 'asc' }, { date: 'asc' }],
        })
      )

      if (!ohlc) {
        return NextResponse.json({ ohlc: [], fallback: true })
      }

      return NextResponse.json({
        ohlc: ohlc.map((r: Record<string, unknown>) => ({
          ticker: r.ticker as string,
          date: r.date as string,
          open: numOrZero(r.open),
          high: numOrZero(r.high),
          low: numOrZero(r.low),
          close: numOrZero(r.close),
          // V4.0.1: Use safe accessors for fields that may not exist in older records
          temOpen: numOrZero(r.temOpen),
          temClose: numOrZero(r.temClose),
          temHigh: numOrZero(r.temHigh),
          temLow: numOrZero(r.temLow),
          volume: numOrZero(r.volume),
          iolVolume: numOrZero(r.iolVolume),
          spreadAvg: numOrZero(r.spreadAvg),
        })),
      })
    }

    // ── Snapshots ─────────────────────────────────────────────────────
    if (type === 'snapshots') {
      const hours = Math.max(1, Number(searchParams.get('hours')) || 24)
      const fromTimestamp = subHours(new Date(), hours)

      const where: Record<string, unknown> = { timestamp: { gte: fromTimestamp } }
      if (ticker) where.ticker = ticker

      const snapshots = await safeDbOp((db) =>
        db.priceSnapshot.findMany({
          where,
          orderBy: { timestamp: 'desc' },
          take: 500,
        })
      )

      if (!snapshots) {
        return NextResponse.json({ snapshots: [], fallback: true })
      }

      return NextResponse.json({
        snapshots: snapshots.map((s: Record<string, unknown>) => ({
          id: s.id as string,
          ticker: s.ticker as string,
          price: numOrZero(s.price),
          tem: numOrZero(s.tem),
          tna: numOrZero(s.tir), // note: field is 'tir' in schema but returned as 'tna'
          spread: numOrZero(s.spread),
          volume: numOrZero(s.volume),
          source: (s.source as string) || 'live',
          iolVolume: numOrZero(s.iolVolume),
          iolBid: numOrZero(s.iolBid),
          iolAsk: numOrZero(s.iolAsk),
          timestamp: s.timestamp,
        })),
      })
    }

    // ── Tickers ───────────────────────────────────────────────────────
    if (type === 'tickers') {
      // V4.0.1: SQLite doesn't support all groupBy combinations reliably.
      // Use findMany + distinct instead of groupBy for better compatibility.
      const ohlcTickers = await safeDbOp((db) =>
        db.dailyOHLC.findMany({
          distinct: ['ticker'],
          select: { ticker: true, date: true, close: true },
          orderBy: [{ ticker: 'asc' }, { date: 'desc' }],
        })
      )

      if (!ohlcTickers) {
        return NextResponse.json({ tickers: [], fallback: true })
      }

      // Build unique tickers with latest close price
      const seenTickers = new Set<string>();
      const tickers = [];
      for (const row of ohlcTickers) {
        if (!seenTickers.has(row.ticker)) {
          seenTickers.add(row.ticker);
          tickers.push({
            ticker: row.ticker,
            latestDate: row.date,
            latestClose: row.close ?? 0,
          });
        }
      }

      return NextResponse.json({ tickers })
    }

    // ── Default / Summary ─────────────────────────────────────────────
    // V4.0.1: SEQUENTIAL queries — not Promise.all (prevents SQLite overload)
    const totalOHLC = await safeDbOp((db) => db.dailyOHLC.count());
    const totalSnapshots = await safeDbOp((db) => db.priceSnapshot.count());
    const ohlcTickers = await safeDbOp((db) =>
      db.dailyOHLC.findMany({
        distinct: ['ticker'],
        select: { ticker: true },
        orderBy: { ticker: 'asc' },
      })
    );
    const dateRange = await safeDbOp((db) =>
      db.dailyOHLC.aggregate({
        _min: { date: true },
        _max: { date: true },
      })
    );

    return NextResponse.json({
      available: (totalOHLC ?? 0) > 0,
      tickers: (ohlcTickers ?? []).map((t: { ticker: string }) => t.ticker),
      totalOHLC: totalOHLC ?? 0,
      totalSnapshots: totalSnapshots ?? 0,
      dateRange: {
        from: dateRange?._min.date ?? '',
        to: dateRange?._max.date ?? '',
      },
    })
  } catch (error) {
    console.error('[price-history] Error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch price history data', fallback: true, totalOHLC: 0, tickers: [] },
      { status: 500 },
    )
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────

function subDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() - days)
  return d
}

function subHours(date: Date, hours: number): Date {
  const d = new Date(date)
  d.setTime(d.getTime() - hours * 60 * 60 * 1000)
  return d
}

function formatDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
