// ════════════════════════════════════════════════════════════════════════
// /api/iol-volume — IOL Volume Snapshot Storage (Prisma DB)
//
// GET: Returns IOL volume history from DB (for HistoricoTab).
// POST: Saves a new IOL volume snapshot (called by /api/letras after enrichment).
//
// V3.2.1 FIX: Never crash — use lazy DB import, return empty data if DB unavailable
// ════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// ── Safe DB access ─────────────────────────────────────────────────────
async function getDb() {
  try {
    const { db } = await import('@/lib/db');
    if (db?.iolVolumeSnapshot) return db;
    return null;
  } catch {
    return null;
  }
}

// GET /api/iol-volume?days=30&ticker=T15J7
export async function GET(request: Request) {
  try {
    const db = await getDb();

    if (!db) {
      return NextResponse.json({ history: {}, days: 30, ticker: 'all', totalSnapshots: 0, fallback: true });
    }

    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get('days') || '30', 10);
    const ticker = searchParams.get('ticker');

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    const where: Record<string, unknown> = {
      date: { gte: cutoffStr },
    };
    if (ticker) {
      where.ticker = ticker;
    }

    const snapshots = await db.iolVolumeSnapshot.findMany({
      where,
      orderBy: [{ date: 'desc' }, { ticker: 'asc' }],
    });

    // Group by date → ticker → data
    const history: Record<string, Record<string, { v: number; bid: number; ask: number }>> = {};
    for (const snap of snapshots) {
      if (!history[snap.date]) history[snap.date] = {};
      history[snap.date][snap.ticker] = {
        v: snap.volumen,
        bid: snap.bid,
        ask: snap.ask,
      };
    }

    return NextResponse.json({
      history,
      days,
      ticker: ticker || 'all',
      totalSnapshots: snapshots.length,
    });
  } catch (error) {
    console.error('[/api/iol-volume] GET error:', error);
    return NextResponse.json({ history: {}, days: 30, ticker: 'all', totalSnapshots: 0, fallback: true });
  }
}

// POST /api/iol-volume — saves current IOL snapshot to DB
export async function POST(request: Request) {
  try {
    const db = await getDb();

    if (!db) {
      return NextResponse.json({ ok: false, fallback: true, error: 'Database not available' });
    }

    const body = await request.json() as { tickers: Record<string, { v: number; bid: number; ask: number }> };
    if (!body.tickers || typeof body.tickers !== 'object') {
      return NextResponse.json({ error: 'Missing tickers object' }, { status: 400 });
    }

    // Use Argentina timezone for date
    const arDate = new Date().toLocaleString('en-CA', {
      timeZone: 'America/Argentina/Buenos_Aires',
    });
    const today = arDate.split(',')[0]; // YYYY-MM-DD

    let upserted = 0;

    for (const [ticker, data] of Object.entries(body.tickers)) {
      await db.iolVolumeSnapshot.upsert({
        where: { date_ticker: { date: today, ticker } },
        update: {
          volumen: data.v,
          bid: data.bid,
          ask: data.ask,
        },
        create: {
          date: today,
          ticker,
          volumen: data.v,
          bid: data.bid,
          ask: data.ask,
        },
      }).catch(() => {}); // Non-critical
      upserted++;
    }

    // Prune: delete snapshots older than 90 days
    const pruneDate = new Date();
    pruneDate.setDate(pruneDate.getDate() - 90);
    const pruneStr = pruneDate.toISOString().slice(0, 10);

    let prunedCount = 0;
    try {
      const deleted = await db.iolVolumeSnapshot.deleteMany({
        where: { date: { lt: pruneStr } },
      });
      prunedCount = deleted.count;
    } catch { /* non-critical */ }

    console.log(`[/api/iol-volume] POST: ${upserted} upserted for ${today}, ${prunedCount} pruned`);

    return NextResponse.json({
      ok: true,
      date: today,
      tickersSaved: upserted,
      pruned: prunedCount,
    });
  } catch (error) {
    console.error('[/api/iol-volume] POST error:', error);
    return NextResponse.json({ ok: false, error: 'Failed to save IOL volume snapshot' });
  }
}
