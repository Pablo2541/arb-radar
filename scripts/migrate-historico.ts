// ════════════════════════════════════════════════════════════════════════
// V3.2.4-PRO — Historical Price Migration Script
// Injects April 2026 historical OHLC data from historico_precios.json → Neon DB
//
// Usage: npx tsx scripts/migrate-historico.ts
// ════════════════════════════════════════════════════════════════════════

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

// ── Load .env ──
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
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
  }
}
loadEnv();

// ── Types ──
interface OHLCRecord {
  fecha: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface HistoricoData {
  instrumentos: Record<string, OHLCRecord[]>;
}

// ── VPV approximation per ticker for TEM estimation ──
const VPV_MAP: Record<string, number> = {
  'S1L5': 1.02, 'S2L7': 1.04, 'S3L6': 1.07, 'S4L7': 1.10,
  'S5L8': 1.14, 'S6L9': 1.18, 'S7L0': 1.22, 'S8L1': 1.27,
  'T15E7': 1.09, 'T25E7': 1.15, 'T30J7': 1.22, 'T5W3': 1.30,
};

// Approximate days to expiry for April 2026
const DAYS_MAP: Record<string, number> = {
  'S1L5': 45, 'S2L7': 75, 'S3L6': 105, 'S4L7': 135,
  'S5L8': 165, 'S6L9': 195, 'S7L0': 225, 'S8L1': 260,
  'T15E7': 120, 'T25E7': 210, 'T30J7': 300, 'T5W3': 400,
};

const CAUCION_TEM = 0.015; // ~1.5% monthly cauction rate estimate

function estimateTEM(closePrice: number, ticker: string): number {
  const vpv = VPV_MAP[ticker] ?? 1.10;
  const days = DAYS_MAP[ticker] ?? 180;
  const ratio = vpv / (closePrice * 100);
  if (ratio > 1 && days > 0) {
    const tir = Math.pow(ratio, 365 / days) - 1;
    return Math.pow(1 + tir, 30 / 365) - 1;
  }
  return 0.02; // fallback 2% monthly
}

// ── Main ──
async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('❌ DATABASE_URL not configured. Set it in .env');
    process.exit(1);
  }

  // Load JSON data
  const jsonPath = path.resolve(__dirname, 'historico_precios.json');
  if (!fs.existsSync(jsonPath)) {
    console.error(`❌ File not found: ${jsonPath}`);
    process.exit(1);
  }

  const rawData = fs.readFileSync(jsonPath, 'utf-8');
  const data: HistoricoData = JSON.parse(rawData);

  const tickers = Object.keys(data.instrumentos);
  console.log(`📊 Loaded historical data for ${tickers.length} instruments`);
  console.log(`📋 Tickers: ${tickers.join(', ')}`);

  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  });

  try {
    let totalRecords = 0;
    let skippedRecords = 0;

    for (const ticker of tickers) {
      const records = data.instrumentos[ticker];
      console.log(`\n🔄 Migrating ${ticker}: ${records.length} records...`);

      for (const rec of records) {
        const tem = estimateTEM(rec.close, ticker);
        const spreadAvg = tem - CAUCION_TEM;

        try {
          await prisma.dailyOHLC.upsert({
            where: {
              ticker_date: { ticker, date: rec.fecha },
            },
            update: {
              open: rec.open,
              high: rec.high,
              low: rec.low,
              close: rec.close,
              temOpen: tem,
              temClose: tem,
              temHigh: tem * 1.02, // slight variation
              temLow: tem * 0.98,
              volume: rec.volume,
              spreadAvg: spreadAvg,
            },
            create: {
              ticker,
              date: rec.fecha,
              open: rec.open,
              high: rec.high,
              low: rec.low,
              close: rec.close,
              temOpen: tem,
              temClose: tem,
              temHigh: tem * 1.02,
              temLow: tem * 0.98,
              volume: rec.volume,
              spreadAvg: spreadAvg,
            },
          });
          totalRecords++;
        } catch (error) {
          console.warn(`  ⚠️ Skipped ${ticker}@${rec.fecha}: ${error instanceof Error ? error.message : String(error)}`);
          skippedRecords++;
        }
      }

      console.log(`  ✅ ${ticker}: done`);
    }

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`✅ Migration complete!`);
    console.log(`   Total records: ${totalRecords}`);
    console.log(`   Skipped: ${skippedRecords}`);
    console.log(`   Instruments: ${tickers.length}`);
    console.log(`${'═'.repeat(60)}`);
  } catch (error) {
    console.error('❌ Migration failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
