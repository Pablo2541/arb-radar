// ════════════════════════════════════════════════════════════════════════
// V4.0 BLINDADO — /api/price-history
// Neon DB historical data (READ-ONLY for charts)
//
// ARCHITECTURE: Neon DB is used ONLY for historical OHLC data.
// Portfolio/capital is NOT stored here — that's in portfolio.json.
//
// STABILITY: All DB queries are SEQUENTIAL (not Promise.all)
// to prevent Neon connection overload. Each query has safeDbOp
// wrapping with timeout and cooldown.
// ════════════════════════════════════════════════════════════════════════

import { safeDbOp } from '@/lib/db'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic';

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
        ohlc: ohlc.map((r) => ({
          ticker: r.ticker, date: r.date,
          open: r.open, high: r.high, low: r.low, close: r.close,
          temOpen: r.temOpen, temClose: r.temClose,
          temHigh: r.temHigh, temLow: r.temLow,
          volume: r.volume, iolVolume: r.iolVolume, spreadAvg: r.spreadAvg,
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
        snapshots: snapshots.map((s) => ({
          id: s.id, ticker: s.ticker, price: s.price,
          tem: s.tem, tna: s.tna, spread: s.spread,
          volume: s.volume, source: s.source,
          iolVolume: s.iolVolume, iolBid: s.iolBid, iolAsk: s.iolAsk,
          timestamp: s.timestamp,
        })),
      })
    }

    // ── Tickers ───────────────────────────────────────────────────────
    if (type === 'tickers') {
      const raw = await safeDbOp((db) =>
        db.dailyOHLC.groupBy({
          by: ['ticker'],
          _count: { ticker: true },
          _max: { date: true },
        })
      )

      if (!raw) {
        return NextResponse.json({ tickers: [], fallback: true })
      }

      // Sequential (not Promise.all) — prevent DB overload
      const tickers = []
      for (const row of raw) {
        const latest = await safeDbOp((db) =>
          db.dailyOHLC.findFirst({
            where: { ticker: row.ticker, date: row._max.date! },
            select: { close: true },
          })
        )
        tickers.push({
          ticker: row.ticker,
          count: row._count.ticker,
          latestDate: row._max.date!,
          latestClose: latest?.close ?? 0,
        })
      }

      return NextResponse.json({ tickers })
    }

    // ── Default / Summary ─────────────────────────────────────────────
    // V4.0: SEQUENTIAL queries — not Promise.all (prevents Neon overload)
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
      tickers: (ohlcTickers ?? []).map((t) => t.ticker),
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
