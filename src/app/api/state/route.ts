// ════════════════════════════════════════════════════════════════════════
// V3.0 — /api/state: Persist & Restore Application State
//
// GET  → Load last persisted state from DB
// PUT  → Save current state to DB (called every 60s by debounced Zustand)
//
// If DATABASE_URL is not configured, returns { fallback: true }
// so the client knows to use localStorage instead.
// ════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';

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
  updatedAt?: Date;  // Returned from DB, not part of payload
}

// ── GET: Load persisted state ─────────────────────────────────────────
export async function GET() {
  try {
    const { db } = await import('@/lib/db');

    // V3.3-PRO: Handle null db (DATABASE_URL invalid/missing)
    if (!db) {
      return NextResponse.json({ fallback: true, error: 'Database not configured' });
    }

    const state = await db.appState.findUnique({ where: { id: 'main' } });

    if (!state) {
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
        updatedAt: state.updatedAt,
      } satisfies PersistedState,
    });
  } catch (error) {
    // DB not available — signal fallback to localStorage
    console.error('[/api/state GET] DB error, falling back to localStorage:', error);
    return NextResponse.json({ fallback: true, error: 'Database unavailable' });
  }
}

// ── PUT: Persist state to DB ──────────────────────────────────────────
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json() as PersistedState;

    const { db } = await import('@/lib/db');

    // V3.3-PRO: Handle null db (DATABASE_URL invalid/missing)
    if (!db) {
      return NextResponse.json({ ok: false, fallback: true, error: 'Database not configured' });
    }

    // Upsert: create if not exists, update if exists
    const state = await db.appState.upsert({
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
      },
    });

    return NextResponse.json({ ok: true, updatedAt: state.updatedAt });
  } catch (error) {
    console.error('[/api/state PUT] DB error:', error);
    return NextResponse.json(
      { ok: false, error: 'Database unavailable' },
      { status: 503 }
    );
  }
}
