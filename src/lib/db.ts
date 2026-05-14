// ════════════════════════════════════════════════════════════════════════
// V4.0 BLINDADO — Database Connection (SQLite + Crash-Proof)
//
// Uses Prisma with SQLite (file:./db/custom.db).
// DB is ENABLED by setting ENABLE_DB=true in .env.
// All operations are wrapped in try/catch with cooldown on failure.
// If DB is disabled or fails, the app falls back to localStorage.
// ════════════════════════════════════════════════════════════════════════

import { PrismaClient } from '@prisma/client'

// ── Configuration ──────────────────────────────────────────────────
const DB_ENABLED = process.env.ENABLE_DB === 'true'

// ── Resolve DATABASE_URL ───────────────────────────────────────────
function resolveDatabaseUrl(): string | null {
  // First: check process.env (set by Next.js from .env)
  let url = process.env.DATABASE_URL || ''
  
  // Trim and strip quotes
  url = url.trim()
  if ((url.startsWith('"') && url.endsWith('"')) || (url.startsWith("'") && url.endsWith("'"))) {
    url = url.slice(1, -1).trim()
  }
  
  // Accept SQLite file: URLs and relative paths
  if (url && (url.startsWith('file:') || url.startsWith('sqlite:'))) {
    return url
  }
  
  // Fallback: try reading .env file directly
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path')
    const envPath = path.resolve(process.cwd(), '.env')
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf-8')
      for (const line of content.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const eqIdx = trimmed.indexOf('=')
        if (eqIdx === -1) continue
        const key = trimmed.slice(0, eqIdx).trim()
        if (key === 'DATABASE_URL') {
          let val = trimmed.slice(eqIdx + 1).trim()
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1)
          }
          if (val && (val.startsWith('file:') || val.startsWith('sqlite:'))) {
            return val
          }
        }
      }
    }
  } catch {
    // .env read failed
  }
  
  // Default SQLite path
  return 'file:./db/custom.db'
}

// ── Lazy PrismaClient Initialization ───────────────────────────────
const dbUrl = DB_ENABLED ? resolveDatabaseUrl() : null
let _db: PrismaClient | null = null
let _dbInitialized = false
let _dbDisabledUntil = 0

function getDb(): PrismaClient | null {
  if (!dbUrl) return null
  if (_db) return _db
  if (_dbInitialized) return _db
  if (Date.now() < _dbDisabledUntil) return null

  try {
    const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined }
    _db = globalForPrisma.prisma ?? new PrismaClient({
      log: ['error'],
      datasources: { db: { url: dbUrl } },
    })
    if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = _db
    _dbInitialized = true
    console.log(`[db.ts] ✅ PrismaClient initialized with SQLite: ${dbUrl}`)
    return _db
  } catch (err) {
    console.warn('[db.ts] PrismaClient creation failed:', err instanceof Error ? err.message : String(err))
    _dbInitialized = true
    _db = null
    _dbDisabledUntil = Date.now() + 60000
    return null
  }
}

// ── DB Operation Mutex ─────────────────────────────────────────────
let _dbMutex: Promise<unknown> = Promise.resolve()

function withMutex<T>(fn: () => Promise<T>): Promise<T> {
  const prev = _dbMutex
  let resolve: () => void
  _dbMutex = new Promise<void>(r => { resolve = r })
  return prev.then(() => fn()).finally(() => resolve!())
}

// ── Safe DB Operation ──────────────────────────────────────────────
const DB_TIMEOUT_MS = 8000
const DB_COOLDOWN_MS = 30000

export async function safeDbOp<T>(operation: (db: PrismaClient) => Promise<T>): Promise<T | null> {
  if (!DB_ENABLED || !dbUrl) return null
  if (Date.now() < _dbDisabledUntil) return null

  return withMutex(async () => {
    if (Date.now() < _dbDisabledUntil) return null

    const db = getDb()
    if (!db) return null

    try {
      const result = await Promise.race([
        operation(db),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('DB operation timeout')), DB_TIMEOUT_MS)
        ),
      ])
      return result
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      console.warn(`[db.ts] DB operation failed (${errMsg}), cooldown ${DB_COOLDOWN_MS / 1000}s`)
      _dbDisabledUntil = Date.now() + DB_COOLDOWN_MS
      return null
    }
  })
}

/** Check if DB is currently available */
export function isDbAvailable(): boolean {
  return DB_ENABLED && !!dbUrl && Date.now() >= _dbDisabledUntil
}

/** Force re-enable DB access */
export function reEnableDb(): void {
  _dbDisabledUntil = 0
  console.log('[db.ts] DB re-enabled, cooldown reset')
}

// ════════════════════════════════════════════════════════════════════════
// Convenience export: `db` provides direct access to Prisma models.
// Uses a Proxy to lazily initialize and gracefully handle DB unavailability.
// ════════════════════════════════════════════════════════════════════════
export const db = new Proxy({} as PrismaClient, {
  get(_target, prop: string) {
    const actualDb = getDb()
    if (!actualDb) return undefined
    return (actualDb as Record<string, unknown>)[prop]
  },
})
