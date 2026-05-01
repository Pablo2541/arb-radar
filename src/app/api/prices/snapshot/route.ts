// ════════════════════════════════════════════════════════════════════════
// V3.2 — Price Snapshot Capture Endpoint
//
// Captures current LECAP/BONCAP prices from data912 + ArgentinaDatos
// and stores them as PriceSnapshot records. Called periodically
// by the frontend (every 60s during market hours).
//
// This builds our OWN historical dataset since no public
// LECAP/BONCAP price history exists in CSV/XLSX format.
// ════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

const DATA912_BASE = 'https://data912.com';
const ARGDATOS_BASE = 'https://api.argentinadatos.com';

// Known LECAP/BONCAP ticker patterns from data912
function isLECAPBONCAP(symbol: string): { match: boolean; type: 'LECAP' | 'BONCAP' } {
  if (/^[ST]\d{2}[A-Z]\d$/.test(symbol)) {
    return { match: true, type: symbol.startsWith('T') ? 'BONCAP' : 'LECAP' };
  }
  if (/^T[ZX]{1,2}[A-Z]?\d{1,2}$/.test(symbol)) {
    return { match: true, type: 'BONCAP' };
  }
  return { match: false, type: 'LECAP' };
}

export async function POST(request: NextRequest) {
  try {
    const now = new Date();
    const body = await request.json().catch(() => ({}));
    
    // Allow passing instruments from the frontend (if LIVE data is available)
    const frontendInstruments = body.instruments as Array<{
      ticker: string;
      type: 'LECAP' | 'BONCAP';
      last_price: number;
      bid?: number;
      ask?: number;
      volume?: number;
      change_pct?: number;
      vpv?: number;
      tem?: number;
      tir?: number;
      tna?: number;
      days_to_expiry?: number;
    }> | null;

    let snapshots: Array<{
      ticker: string;
      type: string;
      price: number;
      bid: number | null;
      ask: number | null;
      volume: number;
      pctChange: number;
      vpv: number | null;
      tem: number | null;
      tir: number | null;
      tna: number | null;
      daysToExpiry: number | null;
      source: string;
    }> = [];

    if (frontendInstruments && frontendInstruments.length > 0) {
      snapshots = frontendInstruments.map(inst => ({
        ticker: inst.ticker,
        type: inst.type,
        price: inst.last_price,
        bid: inst.bid ?? null,
        ask: inst.ask ?? null,
        volume: inst.volume ?? 0,
        pctChange: inst.change_pct ?? 0,
        vpv: inst.vpv ?? null,
        tem: inst.tem ?? null,
        tir: inst.tir ?? null,
        tna: inst.tna ?? null,
        daysToExpiry: inst.days_to_expiry ?? null,
        source: 'live_merge',
      }));
    } else {
      // Fetch directly from data912 + ArgentinaDatos
      const [bondsRes, letrasRes] = await Promise.allSettled([
        fetch(`${DATA912_BASE}/live/arg_bonds`, { 
          signal: AbortSignal.timeout(10000) 
        }),
        fetch(`${ARGDATOS_BASE}/v1/finanzas/letras`, { 
          signal: AbortSignal.timeout(10000) 
        }),
      ]);

      let bondsData: Array<{
        symbol: string; price: number; bid: number | null; ask: number | null;
        volume: number; pctChange: number; type: 'LECAP' | 'BONCAP';
      }> = [];

      if (bondsRes.status === 'fulfilled' && bondsRes.value.ok) {
        const rawBonds = await bondsRes.value.json();
        for (const b of rawBonds as Array<{ symbol: string; px_bid: number | null; px_ask: number | null; v: number; c: number; pct_change: number }>) {
          const { match, type } = isLECAPBONCAP(b.symbol);
          if (!match) continue;
          
          const rawPrice = b.c;
          const pricePerVN = rawPrice < 10 ? rawPrice : rawPrice / 100;
          const bidPerVN = b.px_bid ? (b.px_bid < 10 ? b.px_bid : b.px_bid / 100) : null;
          const askPerVN = b.px_ask ? (b.px_ask < 10 ? b.px_ask : b.px_ask / 100) : null;

          bondsData.push({
            symbol: b.symbol, price: pricePerVN, bid: bidPerVN, ask: askPerVN,
            volume: b.v, pctChange: b.pct_change, type,
          });
        }
      }

      let letrasData: Map<string, { ticker: string; fechaVencimiento: string; tem: number | null; vpv: number }> = new Map();
      if (letrasRes.status === 'fulfilled' && letrasRes.value.ok) {
        const rawLetras = await letrasRes.value.json();
        for (const l of rawLetras as Array<{ ticker: string; fechaVencimiento: string; tem: number | null; vpv: number }>) {
          letrasData.set(l.ticker, l);
        }
      }

      for (const bond of bondsData) {
        const letra = letrasData.get(bond.symbol);
        const daysToExpiry = letra ? Math.max(0, Math.ceil((new Date(letra.fechaVencimiento).getTime() - now.getTime()) / (1000 * 60 * 60 * 24))) : null;
        snapshots.push({
          ticker: bond.symbol, type: bond.type, price: bond.price,
          bid: bond.bid, ask: bond.ask, volume: bond.volume, pctChange: bond.pctChange,
          vpv: letra ? letra.vpv / 100 : null,
          tem: letra?.tem ? letra.tem / 100 : null,
          tir: null, tna: null, daysToExpiry,
          source: 'data912',
        });
      }

      for (const [ticker, letra] of letrasData) {
        if (!bondsData.find(b => b.symbol === ticker)) {
          const daysToExpiry = Math.max(0, Math.ceil((new Date(letra.fechaVencimiento).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
          const instType = daysToExpiry > 365 || /^T\d{2}[A-Z]\d$/.test(ticker) ? 'BONCAP' : 'LECAP';
          snapshots.push({
            ticker, type: instType, price: 0, bid: null, ask: null,
            volume: 0, pctChange: 0, vpv: letra.vpv / 100,
            tem: letra.tem ? letra.tem / 100 : null, tir: null, tna: null,
            daysToExpiry, source: 'argentinadatos',
          });
        }
      }
    }

    if (snapshots.length === 0) {
      return NextResponse.json({ ok: true, captured: 0, message: 'No LECAP/BONCAP instruments found' });
    }

    let saved = 0;
    const timestamp = now;

    for (const snap of snapshots) {
      try {
        await db.priceSnapshot.create({
          data: {
            ticker: snap.ticker, type: snap.type, timestamp,
            price: snap.price, bid: snap.bid, ask: snap.ask,
            volume: snap.volume, pctChange: snap.pctChange,
            vpv: snap.vpv, tem: snap.tem, tir: snap.tir, tna: snap.tna,
            daysToExpiry: snap.daysToExpiry, source: snap.source,
          },
        });
        saved++;
      } catch { /* skip individual failures */ }
    }

    // Update daily OHLC aggregation
    const today = now.toISOString().split('T')[0];
    for (const snap of snapshots) {
      if (snap.price <= 0) continue;
      try {
        const existing = await db.dailyOHLC.findUnique({
          where: { ticker_date: { ticker: snap.ticker, date: today } },
        });

        if (existing) {
          await db.dailyOHLC.update({
            where: { id: existing.id },
            data: {
              high: Math.max(existing.high, snap.price),
              low: Math.min(existing.low, snap.price),
              close: snap.price,
              volume: existing.volume + snap.volume,
              avgTem: snap.tem != null ? ((existing.avgTem ?? 0) * existing.snapshotCount + snap.tem) / (existing.snapshotCount + 1) : existing.avgTem,
              avgTir: snap.tir != null ? ((existing.avgTir ?? 0) * existing.snapshotCount + snap.tir) / (existing.snapshotCount + 1) : existing.avgTir,
              vpv: snap.vpv ?? existing.vpv,
              snapshotCount: existing.snapshotCount + 1,
            },
          });
        } else {
          await db.dailyOHLC.create({
            data: {
              ticker: snap.ticker, date: today,
              open: snap.price, high: snap.price, low: snap.price, close: snap.price,
              volume: snap.volume, avgTem: snap.tem, avgTir: snap.tir,
              vpv: snap.vpv, snapshotCount: 1,
            },
          });
        }
      } catch { /* skip OHLC failures */ }
    }

    return NextResponse.json({ 
      ok: true, captured: saved,
      total_instruments: snapshots.length,
      timestamp: timestamp.toISOString(),
      tickers: snapshots.map(s => s.ticker),
    });
  } catch (error) {
    console.error('[/api/prices/snapshot] Error:', error);
    return NextResponse.json(
      { ok: false, error: 'Failed to capture price snapshots' },
      { status: 500 }
    );
  }
}
