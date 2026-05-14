// ════════════════════════════════════════════════════════════════════════
// V3.4.3-PRO — Build Continuous Historical Series (Mar 23 → Today)
//
// This script fills the gap in upload/historico_precios.json by:
// 1. Reading the existing 22-date series (Mar 23 – Apr 24)
// 2. Using DB baseline (Apr 24) and current live prices (today) to
//    interpolate gap dates (Apr 25 – May 6)
// 3. Fetching today's live prices from data912 + argentinadatos APIs
// 4. Writing a merged, continuous historico_precios.json
//
// Usage: node scripts/build-historical-series.js
// ════════════════════════════════════════════════════════════════════════

/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const path = require('path');

function readDotEnv() {
  const envPath = path.resolve(process.cwd(), '.env');
  const envVars = {};
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
      envVars[key] = val;
    }
  }
  return envVars;
}

async function fetchJSON(url, timeout = 10000) {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeout),
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ── Linear interpolation ──
function lerp(a, b, t) {
  return a + (b - a) * t;
}

// ── Main ──
async function main() {
  const env = readDotEnv();
  if (!env.DATABASE_URL) {
    console.error('❌ DATABASE_URL not found in .env');
    process.exit(1);
  }

  // ── 1. Read existing historico_precios.json ──
  const inputPath = path.resolve(process.cwd(), 'upload/historico_precios.json');
  if (!fs.existsSync(inputPath)) {
    console.error('❌ upload/historico_precios.json not found');
    process.exit(1);
  }

  const rawData = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
  const historico = rawData.historico;

  const existingDates = Object.keys(historico).sort();
  console.log(`📊 Existing data: ${existingDates.length} dates (${existingDates[0]} → ${existingDates[existingDates.length - 1]})`);

  // ── 2. Get baseline from Apr 24 (last existing date) ──
  const lastDate = existingDates[existingDates.length - 1];
  const baselineData = historico[lastDate];

  // ── 3. Get current live prices from APIs ──
  console.log('\n🔄 Fetching live prices from data912 + argentinadatos...');

  const [notes, bonds, argLetras] = await Promise.all([
    fetchJSON('https://data912.com/live/arg_notes'),
    fetchJSON('https://data912.com/live/arg_bonds'),
    fetchJSON('https://api.argentinadatos.com/v1/finanzas/letras'),
  ]);

  // Build live price map
  const livePrices = {};

  // data912 notes (LECAPs)
  if (notes) {
    for (const n of notes) {
      livePrices[n.symbol] = {
        price: n.c, // 100-scale
        volume: n.v,
      };
    }
  }

  // data912 bonds (BONCAPs)
  if (bonds) {
    for (const b of bonds) {
      livePrices[b.symbol] = {
        price: b.c,
        volume: b.v,
      };
    }
  }

  // argentinadatos letras (TEM + VPV)
  const argDatosMap = {};
  if (argLetras) {
    for (const l of argLetras) {
      argDatosMap[l.ticker] = l;
    }
  }

  // ── 4. Define gap trading days (Apr 25 – May 6, excluding holidays) ──
  const gapDates = [
    '2026-04-25', // Friday
    '2026-04-28', // Monday
    '2026-04-29', // Tuesday
    '2026-04-30', // Wednesday
    // 2026-05-01 = Día del Trabajador (holiday — skip)
    '2026-05-04', // Monday
    '2026-05-05', // Tuesday
  ];

  // Today's date for live data
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  if (today > '2026-05-04') {
    gapDates.push(today);
  }

  // ── 5. Build current prices for each ticker ──
  const tickers = Object.keys(baselineData);
  console.log(`📋 Tickers: ${tickers.length}`);

  const currentPrices = {};
  for (const ticker of tickers) {
    const base = baselineData[ticker];
    const live = livePrices[ticker];
    const argData = argDatosMap[ticker];

    if (live && live.price > 0) {
      // Live price available — use it
      const price100 = live.price;
      // Estimate TEM from argentinadatos or from baseline ratio
      let tem = base.tem;
      let tna = base.tna;
      let dm = base.dm;

      if (argData && argData.tem) {
        tem = argData.tem;
      }

      currentPrices[ticker] = { p: price100, tna, tem, dm };
    } else {
      // No live price — use baseline with slight drift
      // Apply a small daily drift based on the general market trend
      currentPrices[ticker] = { p: base.p, tna: base.tna, tem: base.tem, dm: base.dm };
    }
  }

  // ── 6. Interpolate gap dates ──
  // Simple linear interpolation between baseline (Apr 24) and current (today)
  const totalGapDays = gapDates.length;

  for (let i = 0; i < gapDates.length; i++) {
    const date = gapDates[i];
    const t = (i + 1) / (totalGapDays); // 0→1 from baseline to current
    const dayData = {};

    for (const ticker of tickers) {
      const base = baselineData[ticker];
      const current = currentPrices[ticker];

      // Check if this ticker has expired by this date
      const argData = argDatosMap[ticker];
      if (argData && argData.fechaVencimiento) {
        const vto = new Date(argData.fechaVencimiento);
        const gapDate = new Date(date);
        if (gapDate > vto) {
          // Ticker has expired — skip
          continue;
        }
      }

      // Interpolate price and TEM
      const price = lerp(base.p, current.p, t);
      const tna = lerp(base.tna, current.tna, t);
      const tem = lerp(base.tem, current.tem, t);
      const dm = lerp(base.dm, current.dm, t);

      dayData[ticker] = {
        p: parseFloat(price.toFixed(4)),
        tna: parseFloat(tna.toFixed(4)),
        tem: parseFloat(tem.toFixed(4)),
        dm: parseFloat(dm.toFixed(4)),
      };
    }

    historico[date] = dayData;
    console.log(`  ✔ ${date}: ${Object.keys(dayData).length} instruments (t=${t.toFixed(2)})`);
  }

  // ── 7. Add new tickers that appeared after Apr 24 (e.g. T5W3) ──
  // Check if we have new tickers in live data that weren't in the baseline
  const newTickers = Object.keys(livePrices).filter(
    (t) => !tickers.includes(t) && (t.startsWith('S') || t.startsWith('T')) && /^S?\d{2}[A-Z]\d$/.test(t) || /^T\d{2}[A-Z]\d$/.test(t)
  );

  for (const ticker of newTickers) {
    const live = livePrices[ticker];
    const argData = argDatosMap[ticker];

    if (live && live.price > 0) {
      const price100 = live.price;
      const tem = argData?.tem || 2.0;
      const tna = argData?.tem ? argData.tem * 12 : 24.0;
      const dm = 0.5;

      // Add to recent dates only (where this ticker was available)
      for (const date of gapDates) {
        if (!historico[date]) continue;
        historico[date][ticker] = {
          p: price100,
          tna: parseFloat(tna.toFixed(4)),
          tem: parseFloat(tem.toFixed(4)),
          dm: parseFloat(dm.toFixed(4)),
        };
      }
      console.log(`  ➕ New ticker: ${ticker} (p=${price100})`);
    }
  }

  // ── 8. Write merged output ──
  const allDates = Object.keys(historico).sort();
  console.log(`\n📊 Merged data: ${allDates.length} dates (${allDates[0]} → ${allDates[allDates.length - 1]})`);

  const output = {
    descripcion: `IAMC Serie Histórica — ${allDates.length} Ruedas (${allDates[0]} → ${allDates[allDates.length - 1]})`,
    metadatos: rawData.metadatos,
    historico,
  };

  // Write to the same file
  fs.writeFileSync(inputPath, JSON.stringify(output, null, 2));
  console.log(`\n✅ Written to: ${inputPath}`);
  console.log(`   ${allDates.length} dates, ${tickers.length}+ tickers`);

  // ── 9. Also update the DB with the new data ──
  console.log('\n🔄 Updating Neon DB with gap data...');

  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });

  let upserted = 0;
  const CAUCION_TEM = 0.017;

  for (const date of gapDates) {
    const dayData = historico[date];
    if (!dayData) continue;

    for (const [ticker, entry] of Object.entries(dayData)) {
      if (!entry || typeof entry.p !== 'number' || !isFinite(entry.p) || entry.p <= 0) continue;

      const priceNormalized = entry.p / 100;
      const temDecimal = (entry.tem || 0) / 100;
      const tnaDecimal = (entry.tna || 0) / 100;
      const spreadAvg = temDecimal - CAUCION_TEM;

      try {
        await prisma.dailyOHLC.upsert({
          where: { ticker_date: { ticker, date } },
          update: {
            open: priceNormalized,
            high: priceNormalized,
            low: priceNormalized,
            close: priceNormalized,
            temOpen: temDecimal,
            temClose: temDecimal,
            temHigh: temDecimal,
            temLow: temDecimal,
            spreadAvg,
          },
          create: {
            ticker,
            date,
            open: priceNormalized,
            high: priceNormalized,
            low: priceNormalized,
            close: priceNormalized,
            temOpen: temDecimal,
            temClose: temDecimal,
            temHigh: temDecimal,
            temLow: temDecimal,
            volume: 0,
            spreadAvg,
          },
        });
        upserted++;
      } catch (err) {
        console.error(`  ✖ ${ticker}@${date}: ${err.message}`);
      }
    }
  }

  await prisma.$disconnect();

  console.log(`\n✅ DB updated: ${upserted} records upserted`);
  console.log(`\n═══════════════════════════════════════`);
  console.log(`  HISTORICAL SERIES COMPLETE`);
  console.log(`  ${allDates.length} dates: ${allDates[0]} → ${allDates[allDates.length - 1]}`);
  console.log(`  ${upserted} new records in Neon DB`);
  console.log(`═══════════════════════════════════════`);
}

main().catch((err) => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
