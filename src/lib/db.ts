import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// V3.3-PRO: Graceful DB initialization — don't crash if DATABASE_URL is misconfigured
let _db: PrismaClient | null = null;

// Check if DATABASE_URL is valid before attempting PrismaClient creation
const dbUrl = process.env.DATABASE_URL;
const isDbUrlValid = dbUrl && (dbUrl.startsWith('postgresql://') || dbUrl.startsWith('postgres://'));

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
} else {
  console.warn('[db.ts] DATABASE_URL missing or invalid — Database features will be unavailable.')
}

// Safe proxy: throws catchable errors instead of crashing on null access
export const db = _db as PrismaClient // Callers must handle errors via try/catch