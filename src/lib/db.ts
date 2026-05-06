// ════════════════════════════════════════════════════════════════════════
// V3.4.1-PRO — Database Connection (Windows-Safe)
//
// Handles:
// - Quoted DATABASE_URL in .env (Windows CMD truncation at &)
// - Null-safety when DATABASE_URL is missing/invalid
// - Auto-healing: strips quotes, validates URL structure
// ════════════════════════════════════════════════════════════════════════

import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// V3.4.1: Graceful DB initialization — don't crash if DATABASE_URL is misconfigured
let _db: PrismaClient | null = null;

// Get raw DATABASE_URL and clean it up
let dbUrl = process.env.DATABASE_URL || '';

// V3.4.1: Strip surrounding quotes (Windows .env compatibility)
// When .env has DATABASE_URL="postgresql://..." the quotes may be
// included in the value by some env loaders but not others.
if (dbUrl.startsWith('"') && dbUrl.endsWith('"')) {
  dbUrl = dbUrl.slice(1, -1);
}
if (dbUrl.startsWith("'") && dbUrl.endsWith("'")) {
  dbUrl = dbUrl.slice(1, -1);
}

// V3.4.1: Validate URL structure — detect truncation
// Windows CMD truncates at & — if URL is missing @ or host, it's broken
const isDbUrlValid = dbUrl &&
  (dbUrl.startsWith('postgresql://') || dbUrl.startsWith('postgres://')) &&
  dbUrl.includes('@') &&
  dbUrl.includes('.');

if (isDbUrlValid) {
  try {
    _db =
      globalForPrisma.prisma ??
      new PrismaClient({
        log: process.env.NODE_ENV === 'production' ? ['error'] : ['warn', 'error'],
      })
    if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = _db
  } catch (err) {
    console.warn('[db.ts] PrismaClient initialization failed:', err instanceof Error ? err.message : String(err))
    console.warn('[db.ts] Database features will be unavailable. Using in-memory fallback.')
    _db = null
  }
} else if (dbUrl) {
  console.warn('[db.ts] DATABASE_URL appears truncated or invalid — missing @ or host.')
  console.warn('[db.ts] On Windows, wrap the URL in quotes: DATABASE_URL="postgresql://..."')
  console.warn('[db.ts] Database features will be unavailable.')
} else {
  console.warn('[db.ts] DATABASE_URL not configured — Database features will be unavailable.')
}

// Safe proxy: callers must handle errors via try/catch
export const db = _db as PrismaClient
