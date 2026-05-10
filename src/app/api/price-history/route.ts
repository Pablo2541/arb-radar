import { db } from '@/lib/db'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type')
    const ticker = searchParams.get('ticker')

    // ── OHLC ──────────────────────────────────────────────────────────
    if (type === 'ohlc') {
      const days = Math.max(1, Number(searchParams.get('days')) || 30)
      const fromDate = formatDate(subDays(new Date(), days))

      const where: Record<string, unknown> = {
        date: { gte: fromDate },
      }
      if (ticker) {
        where.ticker = ticker
      }

      const ohlc = await db.dailyOHLC.findMany({
        where,
        orderBy: [{ ticker: 'asc' }, { date: 'asc' }],
      })

      return NextResponse.json({
        ohlc: ohlc.map((r) => ({
          ticker: r.ticker,
          date: r.date,
          open: r.open,
          high: r.high,
          low: r.low,
          close: r.close,
          temOpen: r.temOpen,
          temClose: r.temClose,
          temHigh: r.temHigh,
          temLow: r.temLow,
          volume: r.volume,
          iolVolume: r.iolVolume,
          spreadAvg: r.spreadAvg,
        })),
      })
    }

    // ── Snapshots ─────────────────────────────────────────────────────
    if (type === 'snapshots') {
      const hours = Math.max(1, Number(searchParams.get('hours')) || 24)
      const fromTimestamp = subHours(new Date(), hours)

      const where: Record<string, unknown> = {
        timestamp: { gte: fromTimestamp },
      }
      if (ticker) {
        where.ticker = ticker
      }

      const snapshots = await db.priceSnapshot.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        take: 500,
      })

      return NextResponse.json({
        snapshots: snapshots.map((s) => ({
          id: s.id,
          ticker: s.ticker,
          price: s.price,
          tem: s.tem,
          tna: s.tna,
          spread: s.spread,
          volume: s.volume,
          source: s.source,
          iolVolume: s.iolVolume,
          iolBid: s.iolBid,
          iolAsk: s.iolAsk,
          timestamp: s.timestamp,
        })),
      })
    }

    // ── Tickers ───────────────────────────────────────────────────────
    if (type === 'tickers') {
      const raw = await db.dailyOHLC.groupBy({
        by: ['ticker'],
        _count: { ticker: true },
        _max: { date: true },
      })

      // Fetch latest close for each ticker
      const tickers = await Promise.all(
        raw.map(async (row) => {
          const latest = await db.dailyOHLC.findFirst({
            where: { ticker: row.ticker, date: row._max.date! },
            select: { close: true },
          })
          return {
            ticker: row.ticker,
            count: row._count.ticker,
            latestDate: row._max.date!,
            latestClose: latest?.close ?? 0,
          }
        }),
      )

      return NextResponse.json({ tickers })
    }

    // ── Default / Summary ─────────────────────────────────────────────
    const [totalOHLC, totalSnapshots, ohlcTickers, dateRange] =
      await Promise.all([
        db.dailyOHLC.count(),
        db.priceSnapshot.count(),
        db.dailyOHLC.findMany({
          distinct: ['ticker'],
          select: { ticker: true },
          orderBy: { ticker: 'asc' },
        }),
        db.dailyOHLC.aggregate({
          _min: { date: true },
          _max: { date: true },
        }),
      ])

    return NextResponse.json({
      available: totalOHLC > 0,
      tickers: ohlcTickers.map((t) => t.ticker),
      totalOHLC,
      totalSnapshots,
      dateRange: {
        from: dateRange._min.date ?? '',
        to: dateRange._max.date ?? '',
      },
    })
  } catch (error) {
    console.error('[price-history] Error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch price history data' },
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
