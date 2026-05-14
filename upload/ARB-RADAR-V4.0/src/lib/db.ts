// ════════════════════════════════════════════════════════════════════════
// V3.4.4-PRO — Database Connection (Crash-Proof)
//
// In this sandbox environment, Prisma+Neon causes the Node.js process
// to crash. This module provides a safe interface that:
//
// 1. NEVER creates PrismaClient unless explicitly enabled
// 2. All DB operations return null (fallback to localStorage)
// 3. The process survives even when Neon DB is completely down
// 4. Can be re-enabled by setting ENABLE_DB=true in .env
//
// URL Resolution Priority:
// 1. ENABLE_DB env var must be "true" to even attempt DB connection
// 2. process.env.DATABASE_URL if it's a valid postgresql:// URL
// 3. .env file DATABASE_URL (bypasses system SQLite override)
// 4. null → DB features disabled, localStorage fallback
// ════════════════════════════════════════════════════════════════════════

import { PrismaClient } from '@prisma/client'

// ── Configuration ──────────────────────────────────────────────────
// DB is DISABLED by default in sandbox. Set ENABLE_DB=true to enable.
const DB_ENABLED = process.env.ENABLE_DB === 'true'

// ── Clean DATABASE_URL ─────────────────────────────────────────────

function cleanDatabaseUrl(raw: string): string | null {
  if (!raw) return null
  let url = raw.trim()
  if ((url.startsWith('"') && url.endsWith('"')) || (url.startsWith("'") && url.endsWith("'"))) {
    url = url.slice(1, -1).trim()
  }
  if (!url.startsWith('postgresql://') && !url.startsWith('postgres://')) return null
  if (!url.includes('@')) return null
  if (!url.includes('sslmode=require') && !url.includes('ssl=true')) {
    const separator = url.includes('?') ? '&' : '?'
    url = url + separator + 'sslmode=require'
  }
  return url
}

// ── Read .env file directly (bypasses system env overrides) ────────

function readDotEnv(): Record<string, string> {
  if (typeof window !== 'undefined') return {}
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path')
    const envPath = path.resolve(process.cwd(), '.env')
    const envVars: Record<string, string> = {}
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf-8')
      for (const line of content.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const eqIdx = trimmed.indexOf('=')
        if (eqIdx === -1) continue
        const key = trimmed.slice(0, eqIdx).trim()
        let val = trimmed.slice(eqIdx + 1).trim()
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1)
        }
        envVars[key] = val
      }
    }
    return envVars
  } catch {
    return {}
  }
}

// ── Resolve DATABASE_URL ───────────────────────────────────────────

function resolveDatabaseUrl(): string | null {
  const sysUrl = cleanDatabaseUrl(process.env.DATABASE_URL || '')
  if (sysUrl) return sysUrl
  const envFile = readDotEnv()
  const envUrl = cleanDatabaseUrl(envFile.DATABASE_URL || '')
  if (envUrl) return envUrl
  return null
}

// ── Lazy PrismaClient Initialization ───────────────────────────────
// PrismaClient is ONLY created when ENABLE_DB=true and first needed.

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

// Legacy export
export const db = _db as PrismaClient
