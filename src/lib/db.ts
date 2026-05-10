// ════════════════════════════════════════════════════════════════════════
// V3.4.3-PRO — Database Connection (Windows-Native)
//
// Handles:
// - Quoted DATABASE_URL in .env (Windows CMD safety) — auto-stripped
// - Spaces in DATABASE_URL — auto-trimmed
// - sslmode=require validation (Neon DB requires SSL)
// - System DATABASE_URL override (e.g., SQLite sandbox) — bypassed by
//   reading .env file directly when the system URL is not PostgreSQL
// - Graceful fallback to localStorage when DB is unavailable
//
// URL Resolution Priority:
// 1. process.env.DATABASE_URL if it's a valid postgresql:// URL
// 2. .env file DATABASE_URL (bypasses system SQLite override)
// 3. null → DB features disabled, localStorage fallback
// ════════════════════════════════════════════════════════════════════════

import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// ── Clean DATABASE_URL ─────────────────────────────────────────────
// Strips quotes, spaces, and validates the URL structure

function cleanDatabaseUrl(raw: string): string | null {
  if (!raw) return null

  // Step 1: Strip surrounding quotes (Windows .env compatibility)
  let url = raw.trim()
  if (
    (url.startsWith('"') && url.endsWith('"')) ||
    (url.startsWith("'") && url.endsWith("'"))
  ) {
    url = url.slice(1, -1).trim()
  }

  // Step 2: Validate it's a PostgreSQL URL
  if (!url.startsWith('postgresql://') && !url.startsWith('postgres://')) {
    return null
  }

  // Step 3: Validate URL contains a host (has @ symbol)
  if (!url.includes('@')) {
    console.warn('[db.ts] DATABASE_URL appears truncated (missing @host). Windows users: wrap URL in quotes in .env')
    return null
  }

  // Step 4: Ensure sslmode=require (Neon DB requires SSL)
  if (!url.includes('sslmode=require') && !url.includes('ssl=true')) {
    // Auto-append sslmode=require
    const separator = url.includes('?') ? '&' : '?'
    url = url + separator + 'sslmode=require'
    console.log('[db.ts] Auto-appended sslmode=require to DATABASE_URL')
  }

  return url
}

// ── Read .env file directly (bypasses system env overrides) ────────

function readDotEnv(): Record<string, string> {
  // Only works in Node.js (server-side)
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
        // Strip surrounding quotes
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
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
  // 1. Check process.env first — if it's a valid PostgreSQL URL, use it
  const sysUrl = cleanDatabaseUrl(process.env.DATABASE_URL || '')
  if (sysUrl) return sysUrl

  // 2. System URL is not PostgreSQL (e.g., SQLite override) — read .env directly
  const envFile = readDotEnv()
  const envUrl = cleanDatabaseUrl(envFile.DATABASE_URL || '')
  if (envUrl) return envUrl

  // 3. No valid PostgreSQL URL found
  return null
}

// ── Initialize Prisma Client ───────────────────────────────────────

let _db: PrismaClient | null = null

const dbUrl = resolveDatabaseUrl()

if (dbUrl) {
  try {
    _db =
      globalForPrisma.prisma ??
      new PrismaClient({
        log: process.env.NODE_ENV === 'production' ? ['error'] : ['warn', 'error'],
        datasources: {
          db: {
            url: dbUrl,
          },
        },
      })
    if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = _db
  } catch (err) {
    console.warn('[db.ts] PrismaClient initialization failed:', err instanceof Error ? err.message : String(err))
    console.warn('[db.ts] Database features will be unavailable. Using localStorage fallback.')
    _db = null
  }
} else {
  console.warn('[db.ts] No valid PostgreSQL DATABASE_URL found — Database features will be unavailable.')
  console.warn('[db.ts] Set DATABASE_URL in .env: DATABASE_URL=postgresql://user:pass@host/db')
}

// Safe proxy: callers must handle errors via try/catch
export const db = _db as PrismaClient
