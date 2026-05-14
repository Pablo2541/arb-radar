// ════════════════════════════════════════════════════════════════════════
// V3.4.1-PRO — Historical Price Migration Script (UNIFIED)
// Injects historical OHLC data from BOTH JSON formats into Neon DB
//
// Supports TWO JSON formats:
//   1. upload/historico_precios.json (V3.4.1 format — 14-16 instruments, 22 dates)
//   2. scripts/historico_precios.json (V3.2 format — OHLC records per ticker)
//
// Usage: npx tsx scripts/migrate-historico.ts [--both | --upload | --scripts]
//   Default: --both (processes both files if they exist)
// ════════════════════════════════════════════════════════════════════════

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

// ── Load .env (Windows-safe: handles quoted values with & symbols) ──
// V3.4.3: .env values OVERRIDE system env (fixes system SQLite override)
function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      // V3.4.1: Strip surrounding quotes but preserve & and special chars inside
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      // V3.4.3: For DATABASE_URL, .env file takes priority over system env
      // (system may have a SQLite URL that overrides our PostgreSQL one)
      if (key === 'DATABASE_URL' && val) {
        process.env[key] = val;
      } else if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}
loadEnv();

// ── Types ──

// V3.2 format: { instrumentos: { TICKER: OHLCRecord[] } }
interface OHLCRecord {
  fecha: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface HistoricoV32Format {
  instrumentos: Record<string, OHLCRecord[]>;
}

// V3.4.1 format: { historico: { DATE: { TICKER: PriceEntry } } }
interface PriceEntry {
  p: number;   // price in 100-scale (e.g., 125.54)
  tna: number; // TNA in percentage points
  tem: number; // TEM in percentage points
  dm: number;  // Duration Modified
}

interface HistoricoV34Format {
  descripcion: string;
  metadatos: {
    moneda: string;
    periodo: string;
    instrumentos_maestro: Record<string, { vto: string }>;
  };
  historico: Record<string, Record<string, PriceEntry>>;
}

// ── TEM estimation (fallback for V3.2 format) ──
const CAUCION_TEM = 0.017; // ~1.7% monthly caución rate estimate

function estimateTEMFromPrice(closePrice: number, daysToExpiry: number): number {
  // Simple linear approximation: TEM ≈ (1 - closePrice) * (365 / days) / 12
  if (closePrice > 0 && daysToExpiry > 0) {
    const annualYield = (1 / closePrice - 1) * (365 / daysToExpiry);
    return Math.pow(1 + annualYield, 30 / 365) - 1;
  }
  return 0.02; // fallback 2% monthly
}

// ── Days to expiry from ticker pattern ──
function daysFromTicker(ticker: string, refDate: Date = new Date('2026-04-17')): number {
  // Extract expiry from ticker: S30A6 = LECAP vto 30/04/2026, T30J7 = BONCAP vto 30/06/2027
  const match = ticker.match(/^[ST](\d{2})([A-Z])(\d)$/);
  if (!match) return 180; // default

  const day = parseInt(match[1]);
  const monthCode = match[2];
  const yearSuffix = parseInt(match[3]);

  const MONTH_MAP: Record<string, number> = {
    'A': 0, 'B': 1, 'C': 2, 'D': 3, 'E': 4, 'F': 5,
    'G': 6, 'H': 7, 'I': 8, 'J': 9, 'K': 10, 'L': 11,
    'M': 0, 'N': 1, 'O': 2, 'P': 3, 'Q': 4, 'R': 5,
    'S': 6, 'T': 7, 'U': 8, 'V': 9, 'W': 10, 'X': 11,
    'Y': 4, 'Z': 5, // Y=May, Z=Jun (extended)
  };

  const month = MONTH_MAP[monthCode] ?? 0;
  const year = 2026 + yearSuffix;

  const expiry = new Date(year, month, day);
  const diffMs = expiry.getTime() - refDate.getTime();
  return Math.max(1, Math.round(diffMs / (1000 * 60 * 60 * 24)));
}

// ── Process V3.4.1 format (upload/historico_precios.json) ──
async function processV34Format(prisma: PrismaClient, data: HistoricoV34Format): Promise<{upserted: number, skipped: number, errors: number}> {
  let upserted = 0, skipped = 0, errors = 0;
  const dates = Object.keys(data.historico).sort();

  console.log(`\n📊 V3.4.1 Format: ${dates.length} dates, maestro: ${Object.keys(data.metadatos.instrumentos_maestro).length} instruments`);

  for (const date of dates) {
    const dayData = data.historico[date];
    const tickers = Object.keys(dayData);

    for (const ticker of tickers) {
      const entry = dayData[ticker];
      if (!entry || typeof entry.p !== 'number' || !isFinite(entry.p) || entry.p <= 0) {
        skipped++;
        continue;
      }

      // Scale conversion: price 100-scale → 1.XXXX
      const priceNormalized = entry.p / 100;

      // TEM: percentage points → decimal
      const temDecimal = (entry.tem ?? 0) / 100;
      const tnaDecimal = (entry.tna ?? 0) / 100;

      // OHLC: Only closes → O=H=L=C
      const open = priceNormalized;
      const high = priceNormalized;
      const low = priceNormalized;
      const close = priceNormalized;

      const temOpen = temDecimal;
      const temClose = temDecimal;
      const temHigh = temDecimal;
      const temLow = temDecimal;

      const spreadAvg = temDecimal - CAUCION_TEM;

      try {
        await prisma.dailyOHLC.upsert({
          where: { ticker_date: { ticker, date } },
          update: { open, high, low, close, temOpen, temClose, temHigh, temLow, spreadAvg },
          create: { ticker, date, open, high, low, close, temOpen, temClose, temHigh, temLow, volume: 0, spreadAvg },
        });
        upserted++;
      } catch (err) {
        errors++;
        console.error(`  ✖ ${ticker}@${date}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const lecaps = tickers.filter(t => t.startsWith('S')).length;
    const boncaps = tickers.filter(t => t.startsWith('T')).length;
    console.log(`  ✔ ${date}: ${tickers.length} (${lecaps} LECAP, ${boncaps} BONCAP)`);
  }

  return { upserted, skipped, errors };
}

// ── Process V3.2 format (scripts/historico_precios.json) ──
async function processV32Format(prisma: PrismaClient, data: HistoricoV32Format): Promise<{upserted: number, skipped: number, errors: number}> {
  let upserted = 0, skipped = 0, errors = 0;
  const tickers = Object.keys(data.instrumentos);

  console.log(`\n📊 V3.2 Format: ${tickers.length} instruments`);
  console.log(`📋 Tickers: ${tickers.join(', ')}`);

  for (const ticker of tickers) {
    const records = data.instrumentos[ticker];
    console.log(`  🔄 Migrating ${ticker}: ${records.length} records...`);

    for (const rec of records) {
      const days = daysFromTicker(ticker);
      const tem = estimateTEMFromPrice(rec.close, days);
      const spreadAvg = tem - CAUCION_TEM;

      try {
        await prisma.dailyOHLC.upsert({
          where: { ticker_date: { ticker, date: rec.fecha } },
          update: {
            open: rec.open, high: rec.high, low: rec.low, close: rec.close,
            temOpen: tem, temClose: tem, temHigh: tem * 1.02, temLow: tem * 0.98,
            volume: rec.volume, spreadAvg,
          },
          create: {
            ticker, date: rec.fecha, open: rec.open, high: rec.high, low: rec.low, close: rec.close,
            temOpen: tem, temClose: tem, temHigh: tem * 1.02, temLow: tem * 0.98,
            volume: rec.volume, spreadAvg,
          },
        });
        upserted++;
      } catch (error) {
        console.warn(`  ⚠️ Skipped ${ticker}@${rec.fecha}: ${error instanceof Error ? error.message : String(error)}`);
        skipped++;
      }
    }
    console.log(`  ✅ ${ticker}: done`);
  }

  return { upserted, skipped, errors };
}

// ── Main ──
async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('❌ DATABASE_URL not configured. Set it in .env');
    process.exit(1);
  }

  // V3.4.1: Validate DATABASE_URL is not truncated (Windows &-in-URL issue)
  if (!databaseUrl.includes('@') || (!databaseUrl.includes('neon.tech') && !databaseUrl.includes('postgresql'))) {
    console.error('❌ DATABASE_URL appears truncated or invalid.');
    console.error('   On Windows, wrap the URL in quotes in .env:');
    console.error('   DATABASE_URL="postgresql://user:pass@host/db?sslmode=require"');
    process.exit(1);
  }

  const mode = process.argv[2] || '--both';
  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  });

  let totalUpserted = 0, totalSkipped = 0, totalErrors = 0;

  try {
    // ── Process upload/historico_precios.json (V3.4.1 format) ──
    if (mode === '--both' || mode === '--upload') {
      const uploadPath = path.resolve(process.cwd(), 'upload/historico_precios.json');
      if (fs.existsSync(uploadPath)) {
        console.log('\n' + '═'.repeat(60));
        console.log('📁 Processing: upload/historico_precios.json (V3.4.1 format)');
        console.log('═'.repeat(60));
        const raw = fs.readFileSync(uploadPath, 'utf-8');
        const data = JSON.parse(raw) as HistoricoV34Format;
        const result = await processV34Format(prisma, data);
        totalUpserted += result.upserted;
        totalSkipped += result.skipped;
        totalErrors += result.errors;
      } else {
        console.log('⚠️ upload/historico_precios.json not found, skipping V3.4.1 format');
      }
    }

    // ── Process scripts/historico_precios.json (V3.2 format) ──
    if (mode === '--both' || mode === '--scripts') {
      const scriptsPath = path.resolve(__dirname, 'historico_precios.json');
      if (fs.existsSync(scriptsPath)) {
        console.log('\n' + '═'.repeat(60));
        console.log('📁 Processing: scripts/historico_precios.json (V3.2 format)');
        console.log('═'.repeat(60));
        const raw = fs.readFileSync(scriptsPath, 'utf-8');
        const data = JSON.parse(raw) as HistoricoV32Format;
        const result = await processV32Format(prisma, data);
        totalUpserted += result.upserted;
        totalSkipped += result.skipped;
        totalErrors += result.errors;
      } else {
        console.log('⚠️ scripts/historico_precios.json not found, skipping V3.2 format');
      }
    }

    console.log('\n' + '═'.repeat(60));
    console.log('✅ Migration complete!');
    console.log(`   Total upserted: ${totalUpserted}`);
    console.log(`   Total skipped:  ${totalSkipped}`);
    console.log(`   Total errors:   ${totalErrors}`);
    console.log('═'.repeat(60));
  } catch (error) {
    console.error('❌ Migration failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
