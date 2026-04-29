// ════════════════════════════════════════════════════════════════════════
// ARB//RADAR V3.0.1 — Local Price Engine
//
// Standalone script that fetches live market data from data912.com +
// ArgentinaDatos and pushes the merged Instrument[] to your Neon DB.
//
// USAGE:
//   npx tsx scripts/update-prices.ts          # One-shot update
//   npx tsx scripts/update-prices.ts --daemon  # Loop every 60s
//   npm run prices:update                      # One-shot (shortcut)
//   npm run prices:daemon                      # Daemon mode (shortcut)
//
// REQUIREMENTS:
//   - DATABASE_URL in .env (your Neon PostgreSQL connection string)
//   - npx tsx (installed via npm install)
//
// ARCHITECTURE:
//   This script is the LOCAL equivalent of the Vercel serverless function
//   /api/letras. Instead of responding to HTTP requests, it:
//   1. Fetches from data912 + ArgentinaDatos
//   2. Merges into Instrument[] (same TIR/TEM formulas)
//   3. Upserts to Neon DB via Prisma directly
//   4. Your Vercel app reads from the same DB on next page load
//
// ════════════════════════════════════════════════════════════════════════

import { PrismaClient } from '@prisma/client';

// ── Configuration ──────────────────────────────────────────────────────
const COMISION_TOTAL = 0.003;
const LOW_LIQUIDITY_THRESHOLD = 1_000_000;
const CAUCION_HAIRCUT = 0.02;
const POLL_INTERVAL_MS = 60_000; // 60 seconds

const DATA912_NOTES_URL = 'https://data912.com/live/arg_notes';
const DATA912_BONDS_URL = 'https://data912.com/live/arg_bonds';
const ARGDATOS_LETRAS_URL = 'https://api.argentinadatos.com/v1/finanzas/letras';
const ARGDATOS_PF_URL = 'https://api.argentinadatos.com/v1/finanzas/tasas/plazoFijo';

// ── Types (standalone — no Next.js imports) ────────────────────────────
interface Data912Note {
  symbol: string;
  q_bid: number;
  px_bid: number;
  px_ask: number;
  q_ask: number;
  v: number;
  q_op: number;
  c: number;
  pct_change: number;
}

interface ArgDatosLetra {
  ticker: string;
  fechaEmision: string | null;
  fechaVencimiento: string;
  tem: number | null;
  vpv: number;
}

interface ArgDatosPlazoFijo {
  entidad: string;
  tnaClientes: number | null;
  tnaNoClientes: number | null;
}

interface Instrument {
  ticker: string;
  type: 'LECAP' | 'BONCAP';
  expiry: string;
  days: number;
  price: number;
  change: number;
  tna: number;
  tem: number;
  tir: number;
  gananciaDirecta: number;
  vsPlazoFijo: string;
}

// ── Helpers ────────────────────────────────────────────────────────────

function inferType(ticker: string): 'LECAP' | 'BONCAP' {
  return ticker.startsWith('T') ? 'BONCAP' : 'LECAP';
}

function daysToExpiry(vencimiento: string): number {
  const vto = new Date(vencimiento);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  vto.setHours(0, 0, 0, 0);
  const diff = vto.getTime() - today.getTime();
  return Math.max(0, Math.round(diff / (1000 * 60 * 60 * 24)));
}

function isRelevantBondTicker(symbol: string): boolean {
  return /^T\d{2}[A-Z]\d$/.test(symbol);
}

async function safeFetch<T>(url: string, timeoutMs = 8000): Promise<{ ok: boolean; data: T | null; latency_ms: number }> {
  const start = Date.now();
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'Accept': 'application/json' },
    });
    const latency_ms = Date.now() - start;
    if (!res.ok) return { ok: false, data: null, latency_ms };
    const data = await res.json() as T;
    return { ok: true, data, latency_ms };
  } catch {
    const latency_ms = Date.now() - start;
    return { ok: false, data: null, latency_ms };
  }
}

function isMarketOpen(): boolean {
  const now = new Date();
  // Argentina time: UTC-3
  const arHour = (now.getUTCHours() - 3 + 24) % 24;
  const day = now.getUTCDay();
  return day >= 1 && day <= 5 && arHour >= 10 && arHour < 17;
}

function timestamp(): string {
  return new Date().toISOString();
}

function log(msg: string) {
  console.log(`[${new Date().toLocaleTimeString('es-AR')}] ${msg}`);
}

function logError(msg: string) {
  console.error(`[${new Date().toLocaleTimeString('es-AR')}] ❌ ${msg}`);
}

// ── Core: Fetch + Merge ────────────────────────────────────────────────

async function fetchAndMerge(): Promise<{
  instruments: Instrument[];
  stats: { lecaps: number; boncaps: number; total: number };
  sources: { notes: boolean; bonds: boolean; argDatos: boolean };
  temCaucion: number;
}> {
  // Fetch all 4 sources in parallel
  const [notesResult, bondsResult, argDatosResult, pfResult] = await Promise.all([
    safeFetch<Data912Note[]>(DATA912_NOTES_URL),
    safeFetch<Data912Note[]>(DATA912_BONDS_URL),
    safeFetch<ArgDatosLetra[]>(ARGDATOS_LETRAS_URL),
    safeFetch<ArgDatosPlazoFijo[]>(ARGDATOS_PF_URL),
  ]);

  // ── Caución proxy from Plazo Fijo ──
  let temCaucion = 0;
  if (pfResult.ok && pfResult.data && Array.isArray(pfResult.data)) {
    const validBanks = pfResult.data.filter(b => b.tnaClientes != null && b.tnaClientes > 0);
    if (validBanks.length > 0) {
      const tnaPromedio = validBanks.reduce((sum, b) => sum + (b.tnaClientes ?? 0), 0) / validBanks.length;
      const tnaCaucion = tnaPromedio - CAUCION_HAIRCUT;
      temCaucion = Math.pow(1 + tnaCaucion, 30 / 365) - 1;
    }
  }

  // ── Build data912 price map ──
  const data912Map = new Map<string, Data912Note & { _source: 'arg_notes' | 'arg_bonds' }>();

  let notesCount = 0;
  if (notesResult.ok && notesResult.data) {
    for (const note of notesResult.data) {
      data912Map.set(note.symbol, { ...note, _source: 'arg_notes' });
      notesCount++;
    }
  }

  let bondsBONCAPCount = 0;
  if (bondsResult.ok && bondsResult.data) {
    for (const bond of bondsResult.data) {
      if (isRelevantBondTicker(bond.symbol)) {
        if (!data912Map.has(bond.symbol)) {
          data912Map.set(bond.symbol, { ...bond, _source: 'arg_bonds' });
          bondsBONCAPCount++;
        }
      }
    }
  }

  // ── ArgentinaDatos map ──
  const argDatosMap = new Map<string, ArgDatosLetra>();
  if (argDatosResult.ok && argDatosResult.data) {
    for (const letra of argDatosResult.data) {
      argDatosMap.set(letra.ticker, letra);
    }
  }

  // ── Merge ──
  const instruments: Instrument[] = [];

  for (const [ticker, nota] of data912Map) {
    const letra = argDatosMap.get(ticker);
    if (!letra) continue;
    if (!nota.c || nota.c <= 0) continue;

    const days = daysToExpiry(letra.fechaVencimiento);
    if (days <= 0) continue;

    // Price normalization: data912 → per $1 VN
    const lastPrice = nota.c / 100;
    let bidPrice = nota.px_bid > 0 ? nota.px_bid / 100 : 0;
    let askPrice = nota.px_ask > 0 ? nota.px_ask / 100 : 0;
    if (bidPrice === 0) bidPrice = lastPrice;
    if (askPrice === 0) askPrice = lastPrice;

    // TIR Calculation
    const precioAskPer100 = askPrice * 100;
    const ratio = letra.vpv / precioAskPer100;

    let tir = 0;
    let tem = 0;
    let tna = 0;

    if (ratio > 1 && days > 0) {
      tir = Math.pow(ratio, 365 / days) - 1;
      tem = Math.pow(1 + tir, 30 / 365) - 1;
      tna = Math.pow(1 + tem, 12) - 1;
    }

    // Spread Neto
    const spreadNeto = tem - temCaucion;

    // Ganancia Directa (carry total)
    const monthsToExpiry = days / 30;
    const gananciaDirecta = spreadNeto * monthsToExpiry;

    // vs Plazo Fijo label
    const vsPlazoFijo = spreadNeto > 0.005 ? 'SUPERIOR'
      : spreadNeto > 0 ? 'MARGINAL'
      : spreadNeto > -0.005 ? 'INFERIOR'
      : 'MUY INFERIOR';

    instruments.push({
      ticker,
      type: inferType(ticker),
      expiry: letra.fechaVencimiento, // ISO format YYYY-MM-DD
      days,
      price: parseFloat(lastPrice.toFixed(6)),
      change: parseFloat(nota.pct_change.toFixed(4)),
      tna: parseFloat((tna * 100).toFixed(4)),
      tem: parseFloat((tem * 100).toFixed(4)),
      tir: parseFloat((tem * 100).toFixed(4)), // In ARB-RADAR, tir = TEM
      gananciaDirecta: parseFloat((gananciaDirecta * 100).toFixed(4)),
      vsPlazoFijo,
    });
  }

  // Sort by days ascending
  instruments.sort((a, b) => a.days - b.days);

  const lecapCount = instruments.filter(i => i.type === 'LECAP').length;
  const boncapCount = instruments.filter(i => i.type === 'BONCAP').length;

  return {
    instruments,
    stats: { lecaps: lecapCount, boncaps: boncapCount, total: instruments.length },
    sources: { notes: notesResult.ok, bonds: bondsResult.ok, argDatos: argDatosResult.ok },
    temCaucion,
  };
}

// ── Persist to Neon DB ─────────────────────────────────────────────────

async function persistToDb(prisma: PrismaClient, instruments: Instrument[]): Promise<boolean> {
  try {
    // Read existing state to preserve config, position, transactions, etc.
    const existing = await prisma.appState.findUnique({ where: { id: 'main' } });

    const now = timestamp();

    await prisma.appState.upsert({
      where: { id: 'main' },
      update: {
        instruments: JSON.stringify(instruments),
        lastUpdate: now,
        liveActive: true,
      },
      create: {
        id: 'main',
        instruments: JSON.stringify(instruments),
        config: existing?.config ?? JSON.stringify({
          caucion1d: 21.0,
          caucion7d: 19.2,
          caucion30d: 18.5,
          riesgoPais: 528,
          comisionTotal: 0.30,
          capitalDisponible: 390000,
        }),
        position: existing?.position ?? null,
        transactions: existing?.transactions ?? JSON.stringify([]),
        lastUpdate: now,
        rawInput: existing?.rawInput ?? '',
        mepRate: existing?.mepRate ?? null,
        cclRate: existing?.cclRate ?? null,
        liveActive: true,
      },
    });

    return true;
  } catch (error) {
    logError(`DB write failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

// ── Main Loop ──────────────────────────────────────────────────────────

async function runOnce(prisma: PrismaClient): Promise<boolean> {
  const marketStatus = isMarketOpen() ? '🟢 ABIERTO' : '🔴 CERRADO';
  log(`Iniciando update — Mercado: ${marketStatus}`);

  try {
    const { instruments, stats, sources, temCaucion } = await fetchAndMerge();

    if (instruments.length === 0) {
      logError('No se obtuvieron instrumentos. Verificar APIs.');
      return false;
    }

    log(`Fetched: ${stats.total} instruments (${stats.lecaps} LECAPs, ${stats.boncaps} BONCAPs)`);
    log(`Sources: data912-notes=${sources.notes ? '✅' : '❌'} data912-bonds=${sources.bonds ? '✅' : '❌'} argDatos=${sources.argDatos ? '✅' : '❌'}`);
    log(`Caución proxy TEM: ${(temCaucion * 100).toFixed(3)}%`);

    // Show top 5 spreads
    const topSpreads = [...instruments]
      .sort((a, b) => b.tem - a.tem)
      .slice(0, 5);
    for (const inst of topSpreads) {
      log(`  ${inst.ticker} (${inst.type}) — ${inst.days}d — TEM ${inst.tem.toFixed(2)}% — $${inst.price.toFixed(4)}`);
    }

    // Persist to Neon DB
    const dbOk = await persistToDb(prisma, instruments);
    if (dbOk) {
      log(`✅ Persisted ${instruments.length} instruments to Neon DB`);
    } else {
      logError('Failed to persist to DB');
    }

    return dbOk;
  } catch (error) {
    logError(`Unexpected error: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const isDaemon = args.includes('--daemon');

  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('  ARB//RADAR V3.0.1 — Local Price Engine');
  console.log(`  Mode: ${isDaemon ? 'DAEMON (loop every 60s)' : 'ONE-SHOT'}`);
  console.log(`  DB: ${process.env.DATABASE_URL ? 'Neon PostgreSQL ✅' : '❌ DATABASE_URL not set!'}`);
  console.log('═══════════════════════════════════════════════════════');
  console.log('');

  if (!process.env.DATABASE_URL) {
    logError('DATABASE_URL environment variable is not set!');
    logError('Create a .env file in the project root with:');
    logError('  DATABASE_URL=postgresql://user:pass@host/db?sslmode=require');
    process.exit(1);
  }

  const prisma = new PrismaClient({
    log: ['error', 'warn'],
  });

  try {
    if (isDaemon) {
      log('🔄 Starting daemon mode — Ctrl+C to stop');
      log('');

      // Run immediately
      await runOnce(prisma);

      // Then loop
      const interval = setInterval(async () => {
        await runOnce(prisma);
      }, POLL_INTERVAL_MS);

      // Graceful shutdown
      const shutdown = async () => {
        log('🛑 Shutting down gracefully...');
        clearInterval(interval);
        await prisma.$disconnect();
        log('👋 Adiós!');
        process.exit(0);
      };

      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    } else {
      // One-shot mode
      const ok = await runOnce(prisma);
      await prisma.$disconnect();
      process.exit(ok ? 0 : 1);
    }
  } catch (error) {
    logError(`Fatal error: ${error instanceof Error ? error.message : String(error)}`);
    await prisma.$disconnect();
    process.exit(1);
  }
}

main();
