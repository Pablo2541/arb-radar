// ════════════════════════════════════════════════════════════════════════
// ARB//RADAR — /api/update-ohlc
// Writes today's OHLC data from the live market feed into DailyOHLC.
//
// ARCHITECTURE:
//   1. Fetches live instrument data from /api/letras (internal call)
//   2. Uses Argentina timezone for the date key (NOT UTC)
//   3. Upserts DailyOHLC: create on first tick, update on subsequent ticks
//   4. Staleness detection: skip if snapshotCount >= 5 unless ?force=true
//
// USAGE:
//   GET /api/update-ohlc          → write OHLC (respects staleness)
//   GET /api/update-ohlc?force=true → force write even if stale
// ════════════════════════════════════════════════════════════════════════

import { safeDbOp } from '@/lib/db';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// ── Staleness threshold ──────────────────────────────────────────────
// If any ticker for today already has this many snapshots, the daemon
// has already written enough ticks — skip unless ?force=true.
const STALENESS_THRESHOLD = 5;

// ── Types (subset of /api/letras instrument shape) ───────────────────
interface LiveInstrument {
  ticker: string;
  last_price: number;
  tem: number;
  volume: number;
  spread_neto: number;
  iol_volume?: number;
}

interface LetrasResponse {
  instruments: LiveInstrument[];
}

// ── GET Handler ──────────────────────────────────────────────────────
export async function GET(request: Request) {
  const startTime = Date.now();

  // ── Argentina timezone date ──────────────────────────────────────
  const argentinaDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  // ── Staleness check (unless ?force=true) ────────────────────────
  const { searchParams } = new URL(request.url);
  const forceMode = searchParams.get('force') === 'true';

  if (!forceMode) {
    const staleRecord = await safeDbOp((db) =>
      db.dailyOHLC.findFirst({
        where: {
          date: argentinaDate,
          snapshotCount: { gte: STALENESS_THRESHOLD },
        },
        select: { ticker: true, snapshotCount: true },
      })
    );

    if (staleRecord) {
      return NextResponse.json({
        success: true,
        date: argentinaDate,
        tickers_updated: 0,
        tickers_skipped: 0,
        source: 'live_api',
        skipped_reason: `staleness_detected`,
        staleness_detail: `${staleRecord.ticker} already has ${staleRecord.snapshotCount} snapshots today (threshold: ${STALENESS_THRESHOLD}). Use ?force=true to override.`,
        timestamp: new Date().toISOString(),
      });
    }
  }

  // ── Fetch live data from /api/letras ─────────────────────────────
  let letrasData: LetrasResponse;
  try {
    const letrasUrl = new URL('/api/letras', request.url);
    const letrasRes = await fetch(letrasUrl.toString(), {
      signal: AbortSignal.timeout(5_000),
      headers: { 'Accept': 'application/json' },
    });

    if (!letrasRes.ok) {
      return NextResponse.json(
        {
          success: false,
          date: argentinaDate,
          tickers_updated: 0,
          tickers_skipped: 0,
          source: 'live_api',
          error: `/api/letras returned status ${letrasRes.status}`,
          timestamp: new Date().toISOString(),
        },
        { status: 502 }
      );
    }

    letrasData = (await letrasRes.json()) as LetrasResponse;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        success: false,
        date: argentinaDate,
        tickers_updated: 0,
        tickers_skipped: 0,
        source: 'live_api',
        error: `Failed to fetch /api/letras: ${errMsg}`,
        timestamp: new Date().toISOString(),
      },
      { status: 502 }
    );
  }

  const instruments = letrasData.instruments;

  if (!instruments || !Array.isArray(instruments) || instruments.length === 0) {
    return NextResponse.json(
      {
        success: false,
        date: argentinaDate,
        tickers_updated: 0,
        tickers_skipped: 0,
        source: 'live_api',
        error: 'No instruments returned from /api/letras',
        timestamp: new Date().toISOString(),
      },
      { status: 502 }
    );
  }

  // ── Upsert DailyOHLC for each instrument ─────────────────────────
  let tickersUpdated = 0;
  let tickersSkipped = 0;
  let dbErrors = 0;

  for (const inst of instruments) {
    // Skip instruments without valid price data
    if (!inst.ticker || !inst.last_price || inst.last_price <= 0) {
      tickersSkipped++;
      continue;
    }

    const price = inst.last_price;
    const tem = inst.tem ?? 0;
    const volume = inst.volume ?? 0;
    const spreadNeto = inst.spread_neto ?? 0;
    const iolVolume = inst.iol_volume ?? 0;

    try {
      const existingOHLC = await safeDbOp((db) =>
        db.dailyOHLC.findUnique({
          where: { date_ticker: { date: argentinaDate, ticker: inst.ticker } },
        })
      );

      if (existingOHLC) {
        // ── Update existing record ──
        // Volume: Last-Value-Wins (data912 `v` is accumulated daily)
        // spreadAvg: incremental average weighted by snapshot count
        const prevSnapshotCount = existingOHLC.snapshotCount ?? 1;
        const newSnapshotCount = prevSnapshotCount + 1;
        const prevSpreadAvg = existingOHLC.spreadAvg ?? 0;
        const newSpreadAvg =
          prevSpreadAvg + (spreadNeto - prevSpreadAvg) / newSnapshotCount;

        const updateResult = await safeDbOp((db) =>
          db.dailyOHLC.update({
            where: { id: existingOHLC.id },
            data: {
              high: Math.max(existingOHLC.high, price),
              low: Math.min(existingOHLC.low, price),
              close: price,
              temHigh: Math.max(existingOHLC.temHigh, tem),
              temLow: Math.min(existingOHLC.temLow, tem),
              temClose: tem,
              volume,
              iolVolume: iolVolume > 0 ? iolVolume : 0,
              spreadAvg: newSpreadAvg,
              snapshotCount: newSnapshotCount,
            },
          })
        );

        if (updateResult) {
          tickersUpdated++;
        } else {
          dbErrors++;
        }
      } else {
        // ── Create new record (first observation of the day) ──
        const createResult = await safeDbOp((db) =>
          db.dailyOHLC.create({
            data: {
              ticker: inst.ticker,
              date: argentinaDate,
              open: price,
              high: price,
              low: price,
              close: price,
              tem: tem,
              temOpen: tem,
              temClose: tem,
              temHigh: tem,
              temLow: tem,
              volume,
              iolVolume: iolVolume > 0 ? iolVolume : 0,
              spreadAvg: spreadNeto,
              snapshotCount: 1,
            },
          })
        );

        if (createResult) {
          tickersUpdated++;
        } else {
          dbErrors++;
        }
      }
    } catch {
      // Per-ticker DB failure — don't cascade, continue with remaining instruments
      dbErrors++;
    }
  }

  // ── Build response ───────────────────────────────────────────────
  const elapsed = Date.now() - startTime;

  // Partial success: some writes failed but we still got data
  const overallSuccess = tickersUpdated > 0;

  return NextResponse.json({
    success: overallSuccess,
    date: argentinaDate,
    tickers_updated: tickersUpdated,
    tickers_skipped: tickersSkipped,
    source: 'live_api',
    ...(dbErrors > 0
      ? {
          db_errors: dbErrors,
          partial_success: true,
          warning: `${dbErrors} ticker(s) failed to write to DB`,
        }
      : {}),
    latency_ms: elapsed,
    timestamp: new Date().toISOString(),
  });
}
