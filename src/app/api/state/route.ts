// ════════════════════════════════════════════════════════════════════════
// V3.4.4 — /api/state: Persist & Restore Application State
//
// GET  → Load last persisted state from DB
// PUT  → Save current state to DB (called every 60s by debounced Zustand)
//        ?forceSync=true → immediate write (bypasses debounce on client)
//
// CRITICAL: Uses safeDbOp() — never crashes the server.
// If DB is unavailable, returns { fallback: true } immediately.
// ════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { safeDbOp, isDbAvailable, reEnableDb } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// ── Types ──────────────────────────────────────────────────────────────
interface PersistedState {
  instruments: string;   // JSON
  config: string;        // JSON
  position: string | null; // JSON
  transactions: string;  // JSON
  lastUpdate: string | null;
  rawInput: string | null;
  mepRate: number | null;
  cclRate: number | null;
  liveActive: boolean;
  iolLevel2Online?: boolean; // V3.1: IOL Level 2 status
  externalHistory?: string;  // V3.4: JSON — ExternalHistoryRecord[]
  simulations?: string;      // V3.4: JSON — SimulationRecord[]
  updatedAt?: Date;  // Returned from DB, not part of payload
}

// ── GET: Load persisted state ─────────────────────────────────────────
export async function GET() {
  // Quick check — if DB is known to be down, skip immediately
  if (!isDbAvailable()) {
    return NextResponse.json({ fallback: true, error: 'Database temporarily unavailable' });
  }

  try {
    const state = await safeDbOp((db) =>
      db.appState.findUnique({ where: { id: 'main' } })
    );

    if (state === null) {
      // null means either DB failed or no record found
      // If DB is available but no record, return { exists: false }
      // If DB failed, safeDbOp already handled the error
      if (!isDbAvailable()) {
        return NextResponse.json({ fallback: true, error: 'Database temporarily unavailable' });
      }
      return NextResponse.json({ exists: false });
    }

    return NextResponse.json({
      exists: true,
      data: {
        instruments: state.instruments,
        config: state.config,
        position: state.position,
        transactions: state.transactions,
        lastUpdate: state.lastUpdate,
        rawInput: state.rawInput,
        mepRate: state.mepRate,
        cclRate: state.cclRate,
        liveActive: state.liveActive,
        iolLevel2Online: state.iolLevel2Online,
        externalHistory: state.externalHistory,
        simulations: state.simulations,
        updatedAt: state.updatedAt,
      } satisfies PersistedState,
    });
  } catch (error) {
    // Shouldn't reach here since safeDbOp catches errors, but just in case
    console.error('[/api/state GET] Unexpected error:', error);
    return NextResponse.json({ fallback: true, error: 'Database unavailable' });
  }
}

// ── PUT: Persist state to DB ──────────────────────────────────────────
export async function PUT(request: NextRequest) {
  // Quick check — if DB is known to be down, skip immediately
  if (!isDbAvailable()) {
    return NextResponse.json({ ok: false, fallback: true, error: 'Database temporarily unavailable' });
  }

  try {
    const body = await request.json() as PersistedState;

    const state = await safeDbOp((db) =>
      db.appState.upsert({
        where: { id: 'main' },
        update: {
          instruments: body.instruments,
          config: body.config,
          position: body.position,
          transactions: body.transactions,
          lastUpdate: body.lastUpdate,
          rawInput: body.rawInput,
          mepRate: body.mepRate,
          cclRate: body.cclRate,
          liveActive: body.liveActive,
          iolLevel2Online: body.iolLevel2Online ?? false,
          externalHistory: body.externalHistory ?? '[]',
          simulations: body.simulations ?? '[]',
        },
        create: {
          id: 'main',
          instruments: body.instruments,
          config: body.config,
          position: body.position,
          transactions: body.transactions,
          lastUpdate: body.lastUpdate,
          rawInput: body.rawInput,
          mepRate: body.mepRate,
          cclRate: body.cclRate,
          liveActive: body.liveActive,
          iolLevel2Online: body.iolLevel2Online ?? false,
          externalHistory: body.externalHistory ?? '[]',
          simulations: body.simulations ?? '[]',
        },
      })
    );

    if (state === null) {
      return NextResponse.json(
        { ok: false, fallback: true, error: 'Database temporarily unavailable' },
        { status: 503 }
      );
    }

    return NextResponse.json({ ok: true, updatedAt: state.updatedAt });
  } catch (error) {
    console.error('[/api/state PUT] Unexpected error:', error);
    return NextResponse.json(
      { ok: false, fallback: true, error: 'Database unavailable' },
      { status: 503 }
    );
  }
}

// ── POST: Re-enable DB connection ──────────────────────────────────────
// Client can call this after detecting a DB failure to force a retry
export async function POST() {
  reEnableDb();
  return NextResponse.json({ ok: true, message: 'DB connection re-enabled' });
}
