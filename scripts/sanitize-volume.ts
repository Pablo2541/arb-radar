// ════════════════════════════════════════════════════════════════════════
// V4.0.7 — Volume Sanitization Script
//
// PROBLEM: Before FASE1 fix, the daemon ACCUMULATED volume values
// (data912 nota.v + IOL cantidadOperada) every tick, causing
// exponential inflation. Some DailyOHLC records have volume > 10B
// (impossible for Argentine bond market).
//
// This script:
// 1. Finds all DailyOHLC records with impossibly inflated volume
// 2. Resets them to 0 (clean slate — the daily data is already corrupt)
// 3. Does NOT touch today's records (daemon is writing correctly now)
// 4. Also sanitizes iolVolume (same accumulation bug)
//
// Usage: npx tsx scripts/sanitize-volume.ts
// ════════════════════════════════════════════════════════════════════════

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ── Thresholds ──────────────────────────────────────────────────────────
// Real daily volume for Argentine Letras/Boncaps:
//   - data912 nota.v (notional ARS): typically 1M – 500M per ticker
//   - IOL cantidadOperada (nominal units): typically 1K – 50M per ticker
// Anything above these is definitively contaminated.

const VOLUME_THRESHOLD = 2_000_000_000;    // 2 billion ARS — impossibly high for data912
const IOL_VOLUME_THRESHOLD = 200_000_000;  // 200M nominal — impossibly high for IOL

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  V4.0.7 — Volume Sanitization Script');
  console.log('═══════════════════════════════════════════════════════');
  console.log('');

  // Today's date — DO NOT touch today's records
  const today = new Date().toISOString().split('T')[0];
  console.log(`📅 Today: ${today} (today's records will be SKIPPED)`);
  console.log(`📊 Volume threshold: > ${(VOLUME_THRESHOLD / 1e9).toFixed(1)}B ARS`);
  console.log(`📊 IOL volume threshold: > ${(IOL_VOLUME_THRESHOLD / 1e6).toFixed(0)}M units`);
  console.log('');

  // Step 1: Count contaminated records
  const allRecords = await prisma.dailyOHLC.findMany({
    where: {
      date: { not: today }, // Skip today
    },
    select: {
      id: true,
      date: true,
      ticker: true,
      volume: true,
      iolVolume: true,
    },
  });

  console.log(`📋 Total historical records (excl. today): ${allRecords.length}`);

  const contaminated = allRecords.filter(
    r => r.volume > VOLUME_THRESHOLD || (r.iolVolume ?? 0) > IOL_VOLUME_THRESHOLD
  );

  console.log(`🔴 Contaminated records (volume above threshold): ${contaminated.length}`);
  console.log('');

  if (contaminated.length === 0) {
    console.log('✅ No contaminated records found. Database is clean!');
    await prisma.$disconnect();
    return;
  }

  // Step 2: Show samples
  console.log('─ Sample contaminated records ─');
  const samples = contaminated.slice(0, 10);
  for (const r of samples) {
    const volStr = r.volume >= 1e9 ? `${(r.volume / 1e9).toFixed(1)}B` : `${(r.volume / 1e6).toFixed(1)}M`;
    const iolStr = r.iolVolume
      ? r.iolVolume >= 1e6
        ? `${(r.iolVolume / 1e6).toFixed(1)}M`
        : `${r.iolVolume.toFixed(0)}`
      : '0';
    console.log(`  ${r.date} ${r.ticker}: volume=${volStr} iolVolume=${iolStr}`);
  }
  if (contaminated.length > 10) {
    console.log(`  ... and ${contaminated.length - 10} more`);
  }
  console.log('');

  // Step 3: Sanitize — reset inflated volume to 0
  // We reset to 0 (not a guess) because the accumulated data is unreliable.
  // The correct volume for those days is lost, but at least the chart won't
  // have a distorted Y-axis scale.
  console.log('🧹 Sanitizing contaminated records...');

  let fixedCount = 0;
  for (const record of contaminated) {
    try {
      const updates: { volume?: number; iolVolume?: number } = {};
      if (record.volume > VOLUME_THRESHOLD) {
        updates.volume = 0;
      }
      if ((record.iolVolume ?? 0) > IOL_VOLUME_THRESHOLD) {
        updates.iolVolume = 0;
      }

      if (Object.keys(updates).length > 0) {
        await prisma.dailyOHLC.update({
          where: { id: record.id },
          data: updates,
        });
        fixedCount++;
      }
    } catch {
      // Skip individual errors
    }
  }

  console.log(`✅ Sanitized ${fixedCount} records`);
  console.log('');

  // Step 4: Verify
  const remainingContaminated = await prisma.dailyOHLC.findMany({
    where: {
      date: { not: today },
      OR: [
        { volume: { gt: VOLUME_THRESHOLD } },
        { iolVolume: { gt: IOL_VOLUME_THRESHOLD } },
      ],
    },
    select: { id: true },
  });

  if (remainingContaminated.length === 0) {
    console.log('🎉 All contaminated records have been sanitized!');
  } else {
    console.log(`⚠️  ${remainingContaminated.length} records still above threshold (check manually)`);
  }

  // Step 5: Show today's records (for verification — should be healthy)
  const todayRecords = await prisma.dailyOHLC.findMany({
    where: { date: today },
    select: { ticker: true, volume: true, iolVolume: true },
    orderBy: { volume: 'desc' },
    take: 5,
  });

  if (todayRecords.length > 0) {
    console.log('');
    console.log(`─ Today's top 5 by volume (should be healthy) ─`);
    for (const r of todayRecords) {
      const volStr = r.volume >= 1e9 ? `${(r.volume / 1e9).toFixed(1)}B` : r.volume >= 1e6 ? `${(r.volume / 1e6).toFixed(1)}M` : `${r.volume.toFixed(0)}`;
      console.log(`  ${r.ticker}: volume=${volStr} iolVolume=${(r.iolVolume ?? 0).toFixed(0)}`);
    }
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('  Done! Run this script once. Future daemon ticks use');
  console.log('  Last-Value-Wins, so inflation will NOT recur.');
  console.log('═══════════════════════════════════════════════════════');

  await prisma.$disconnect();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
