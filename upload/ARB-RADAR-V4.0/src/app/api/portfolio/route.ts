// ════════════════════════════════════════════════════════════════════════
// V4.0 BLINDADO — /api/portfolio: Local JSON File Persistence
//
// ARCHITECTURE: The portfolio file (data/portfolio.json) is the SINGLE
// SOURCE OF TRUTH for capital, position, and config. The Radar READS
// this file on startup and NEVER auto-overwrites it. Changes made
// through the UI's Config tab are written explicitly by user action.
//
// RULES:
// 1. GET returns the portfolio data from data/portfolio.json
// 2. PUT writes to data/portfolio.json ONLY when user explicitly saves
// 3. The Radar NEVER writes to this file automatically
// 4. If the file doesn't exist, returns defaults (not an error)
// 5. No Neon DB, no cloud persistence — 100% local filesystem
// ════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';

export const dynamic = 'force-dynamic';

const PORTFOLIO_PATH = join(process.cwd(), 'data', 'portfolio.json');

// Default portfolio (used if file doesn't exist)
const DEFAULT_PORTFOLIO = {
  capitalDisponible: 467587.55,
  position: {
    ticker: 'T30J7',
    entryPrice: 1.1200,
    vn: 417310,
    entryDate: '05/05/2025',
    precioConComision: 1.1234,
  },
  transactions: [],
  config: {
    caucion1d: 21.0,
    caucion7d: 19.2,
    caucion30d: 18.5,
    comisionTotal: 0.30,
  },
  lastUpdated: new Date().toISOString().split('T')[0],
};

// ── GET: Read portfolio from local JSON file ──
export async function GET() {
  try {
    const raw = await readFile(PORTFOLIO_PATH, 'utf-8');
    const data = JSON.parse(raw);

    // Strip _comment and _instructions (they're for humans, not code)
    const { _comment, _instructions, ...portfolio } = data;

    return NextResponse.json({
      ok: true,
      source: 'local_file',
      data: portfolio,
    });
  } catch (error) {
    // File doesn't exist or can't be parsed — return defaults
    const isMissing = error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT';

    if (isMissing) {
      console.warn('[portfolio] data/portfolio.json not found — using defaults');
    } else {
      console.error('[portfolio] Error reading portfolio.json:', error);
    }

    return NextResponse.json({
      ok: true,
      source: 'defaults',
      data: DEFAULT_PORTFOLIO,
    });
  }
}

// ── PUT: Write portfolio to local JSON file (explicit user action only) ──
export async function PUT(request: Request) {
  try {
    const body = await request.json();

    // Validate required fields
    if (typeof body.capitalDisponible !== 'number' || body.capitalDisponible < 0) {
      return NextResponse.json(
        { ok: false, error: 'capitalDisponible must be a non-negative number' },
        { status: 400 }
      );
    }

    // Build clean portfolio object (no internal fields)
    const portfolio = {
      _comment: 'ARB//RADAR V4.0 — Archivo de Cartera Local. El Radar SOLO LEE este archivo.',
      capitalDisponible: body.capitalDisponible,
      position: body.position || null,
      transactions: body.transactions || [],
      config: body.config || DEFAULT_PORTFOLIO.config,
      lastUpdated: new Date().toISOString().split('T')[0],
    };

    // Write to file
    await writeFile(PORTFOLIO_PATH, JSON.stringify(portfolio, null, 2), 'utf-8');

    console.log('[portfolio] Saved to data/portfolio.json');

    return NextResponse.json({
      ok: true,
      message: 'Portfolio saved to local file',
      lastUpdated: portfolio.lastUpdated,
    });
  } catch (error) {
    console.error('[portfolio] Error writing portfolio.json:', error);
    return NextResponse.json(
      { ok: false, error: 'Failed to save portfolio' },
      { status: 500 }
    );
  }
}
