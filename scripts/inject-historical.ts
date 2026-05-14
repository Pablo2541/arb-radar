// ════════════════════════════════════════════════════════════════════════
// V3.4.1-PRO — Historical Price Injection Script
// Reads historico_precios.json and upserts 22 Ruedas (Mar 23 – Apr 24) into DailyOHLC
//
// Usage: npx tsx scripts/inject-historical.ts
// ════════════════════════════════════════════════════════════════════════

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

// ── Load .env (V3.4.3: Windows-safe — .env overrides system env) ──
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
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      // V3.4.3: DATABASE_URL from .env takes priority over system env
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
interface PriceEntry {
  p: number;   // price in 100-scale (e.g., 125.54)
  tna: number; // TNA in percentage points (e.g., 24.3)
  tem: number; // TEM in percentage points (e.g., 2.0)
  dm: number;  // Duration Modified
}

interface HistoricoFile {
  descripcion: string;
  metadatos: {
    moneda: string;
    periodo: string;
    instrumentos_maestro: Record<string, { vto: string }>;
  };
  historico: Record<string, Record<string, PriceEntry>>;
}

// ── Instrument type detection ──
// JSON doesn't have `tipo`; determine from ticker pattern:
//   LECAPs  → tickers starting with 'S' (e.g. S30A6, S15Y6)
//   BONCAPs → tickers starting with 'T' (e.g. T30J6, T15E7)
function getInstrumentType(ticker: string): 'LECAP' | 'BONCAP' | 'UNKNOWN' {
  if (ticker.startsWith('S')) return 'LECAP';
  if (ticker.startsWith('T')) return 'BONCAP';
  return 'UNKNOWN';
}

// ── Main ──
async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('✖ DATABASE_URL not configured. Cannot write to Neon.');
    process.exit(1);
  }

  // V3.4.1: Validate DATABASE_URL is not truncated (Windows &-in-URL issue)
  if (!databaseUrl.includes('@') || (!databaseUrl.includes('neon.tech') && !databaseUrl.includes('postgresql'))) {
    console.error('✖ DATABASE_URL appears truncated or invalid.');
    console.error('   On Windows, wrap the URL in quotes in .env:');
    console.error('   DATABASE_URL="postgresql://user:pass@host/db?sslmode=require"');
    process.exit(1);
  }

  const jsonPath = path.resolve(process.cwd(), 'upload/historico_precios.json');
  if (!fs.existsSync(jsonPath)) {
    console.error(`✖ File not found: ${jsonPath}`);
    process.exit(1);
  }

  console.log('ℹ Reading historico_precios.json...');
  const raw = fs.readFileSync(jsonPath, 'utf-8');
  const data = JSON.parse(raw) as HistoricoFile;

  const dates = Object.keys(data.historico).sort();
  console.log(`ℹ Found ${dates.length} dates: ${dates[0]} to ${dates[dates.length - 1]}`);

  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  });

  let upserted = 0;
  let skipped = 0;
  let errors = 0;

  // Default caución TEM for spread calculation (estimated from Mar-Apr data)
  const CAUCION_TEM_DEFAULT = 0.017; // ~1.7% monthly

  for (const date of dates) {
    const dayData = data.historico[date];
    const tickers = Object.keys(dayData);

    for (const ticker of tickers) {
      const entry = dayData[ticker];
      if (!entry || typeof entry.p !== 'number' || !isFinite(entry.p) || entry.p <= 0) {
        skipped++;
        continue;
      }

      // ── Scale Conversion ──
      // Price: 100-scale → 1.XXXX scale (divide by 100)
      const priceNormalized = entry.p / 100;
      
      // TEM: percentage points → decimal (divide by 100)  
      // e.g., 2.0% → 0.02
      const temDecimal = (entry.tem ?? 0) / 100;
      const tnaDecimal = (entry.tna ?? 0) / 100;

      // ── OHLC Mapping ──
      // Only closes available → O=H=L=C
      const open = priceNormalized;
      const high = priceNormalized;
      const low = priceNormalized;
      const close = priceNormalized;

      // TEM OHLC (also same for all)
      const temOpen = temDecimal;
      const temClose = temDecimal;
      const temHigh = temDecimal;
      const temLow = temDecimal;

      // Spread estimate: TEM instrument - TEM caución
      const spreadAvg = temDecimal - CAUCION_TEM_DEFAULT;

      try {
        await prisma.dailyOHLC.upsert({
          where: { ticker_date: { ticker, date } },
          update: {
            open, high, low, close,
            temOpen, temClose, temHigh, temLow,
            spreadAvg,
          },
          create: {
            ticker, date,
            open, high, low, close,
            temOpen, temClose, temHigh, temLow,
            volume: 0, // No volume data in JSON
            spreadAvg,
          },
        });
        upserted++;
      } catch (err) {
        errors++;
        console.error(`✖ Error upserting ${ticker} ${date}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const lecaps = tickers.filter(t => getInstrumentType(t) === 'LECAP').length;
    const boncaps = tickers.filter(t => getInstrumentType(t) === 'BONCAP').length;
    console.log(`✔ ${date}: ${tickers.length} instrumentos (${lecaps} LECAP, ${boncaps} BONCAP)`);
  }

  await prisma.$disconnect();

  console.log('');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  ✔ Inyección completada:`);
  console.log(`    Upserted: ${upserted}`);
  console.log(`    Skipped:  ${skipped}`);
  console.log(`    Errors:   ${errors}`);
  console.log(`    Fechas:   ${dates.length} (${dates[0]} → ${dates[dates.length - 1]})`);
  console.log(`    Note:     DailyOHLC has no tna/dm columns — those fields are not upserted`);
  console.log('═══════════════════════════════════════════════════');
}

main().catch(err => {
  console.error('✖ Fatal error:', err);
  process.exit(1);
});
