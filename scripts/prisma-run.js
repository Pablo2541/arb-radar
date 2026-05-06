// ════════════════════════════════════════════════════════════════════════
// V3.4.2-PRO — Cross-Platform Prisma CLI Helper
//
// Replaces prisma-helper.sh — works on Windows CMD, PowerShell, and Unix.
// Reads DATABASE_URL from .env file, validates it, and runs Prisma CLI.
//
// Usage:
//   node scripts/prisma-run.js db push
//   node scripts/prisma-run.js generate
//   node scripts/prisma-run.js validate
//   node scripts/prisma-run.js migrate dev --name init
// ════════════════════════════════════════════════════════════════════════

/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ── Read .env file (cross-platform, handles quoted values) ──
function readDotEnv() {
  const envPath = path.resolve(process.cwd(), '.env');
  const envVars = {};

  if (!fs.existsSync(envPath)) {
    console.error('\u274C .env file not found at: ' + envPath);
    console.error('   Create one with: DATABASE_URL=postgresql://user:pass@host/db');
    process.exit(1);
  }

  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes (Windows .env compatibility)
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    envVars[key] = val;
  }

  return envVars;
}

// ── Validate DATABASE_URL ──
function validateUrl(url) {
  if (!url) {
    console.error('\u274C DATABASE_URL not found in .env');
    console.error('   Add this line to your .env file:');
    console.error('   DATABASE_URL=postgresql://user:pass@host/db');
    process.exit(1);
  }

  // Strip any remaining whitespace
  url = url.trim();

  if (!url.startsWith('postgresql://') && !url.startsWith('postgres://')) {
    console.error('\u274C DATABASE_URL does not start with postgresql://');
    console.error('   Got: ' + url.slice(0, 40) + '...');
    process.exit(1);
  }

  if (!url.includes('@')) {
    console.error('\u274C DATABASE_URL appears truncated (missing @host)');
    console.error('   On Windows CMD, wrap the URL in quotes in .env:');
    console.error('   DATABASE_URL="postgresql://user:pass@host/db?sslmode=require"');
    process.exit(1);
  }

  // Warn if sslmode is missing (Neon requires it)
  if (!url.includes('sslmode=require') && !url.includes('ssl=true')) {
    console.warn('\u26A0\uFE0F  Warning: sslmode=require not found in DATABASE_URL');
    console.warn('   Neon DB requires SSL. Consider appending ?sslmode=require');
    console.warn('   or &sslmode=require if the URL already has query params.');
  }

  return url;
}

// ── Main ──
const envVars = readDotEnv();
const dbUrl = validateUrl(envVars.DATABASE_URL);

// Set DATABASE_URL in the environment so Prisma picks it up
process.env.DATABASE_URL = dbUrl;

// Get the Prisma command from arguments
const prismaArgs = process.argv.slice(2);
if (prismaArgs.length === 0) {
  console.error('Usage: node scripts/prisma-run.js <prisma-command> [args...]');
  console.error('Examples:');
  console.error('  node scripts/prisma-run.js db push');
  console.error('  node scripts/prisma-run.js generate');
  console.error('  node scripts/prisma-run.js validate');
  process.exit(1);
}

const command = 'npx prisma ' + prismaArgs.join(' ');
console.log('\uD83D\uDD04 Running: ' + command);
console.log('   URL: ' + dbUrl.slice(0, 30) + '...\n');

try {
  execSync(command, {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: dbUrl },
  });
} catch (error) {
  // execSync already printed the error output
  process.exit(error.status || 1);
}
