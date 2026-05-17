import Database from 'better-sqlite3';
import path from 'path';
import { DailyVolumeRecord } from './types';

let db: Database.Database | null = null;

export function getDB(): Database.Database {
  if (!db) {
    const dbPath = path.join(process.cwd(), 'prisma', 'dev.db');
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    initTables();
  }
  return db;
}

function initTables(): void {
  const database = getDB();
  
  database.exec(`
    CREATE TABLE IF NOT EXISTS price_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instrument_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      price REAL NOT NULL,
      bid REAL NOT NULL,
      ask REAL NOT NULL,
      volume REAL NOT NULL,
      daily_volume REAL DEFAULT 0,
      is_reset INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  database.exec(`
    CREATE TABLE IF NOT EXISTS daily_volumes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instrument_id TEXT NOT NULL,
      date TEXT NOT NULL,
      total_volume REAL NOT NULL DEFAULT 0,
      first_snapshot TEXT,
      last_snapshot TEXT,
      snapshot_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(instrument_id, date)
    )
  `);
  
  database.exec(`
    CREATE TABLE IF NOT EXISTS historical_prices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instrument_id TEXT NOT NULL,
      date TEXT NOT NULL,
      open REAL NOT NULL,
      high REAL NOT NULL,
      low REAL NOT NULL,
      close REAL NOT NULL,
      volume REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(instrument_id, date)
    )
  `);
  
  database.exec(`
    CREATE TABLE IF NOT EXISTS market_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL UNIQUE,
      open_time TEXT NOT NULL,
      close_time TEXT,
      status TEXT DEFAULT 'open',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  database.exec(`CREATE INDEX IF NOT EXISTS idx_snapshots_instrument ON price_snapshots(instrument_id, timestamp)`);
  database.exec(`CREATE INDEX IF NOT EXISTS idx_daily_volumes_date ON daily_volumes(date)`);
  database.exec(`CREATE INDEX IF NOT EXISTS idx_daily_volumes_instrument ON daily_volumes(instrument_id)`);
}

export function upsertDailyVolume(record: {
  instrumentId: string;
  date: string;
  totalVolume: number;
  firstSnapshot?: string;
  lastSnapshot?: string;
  snapshotCount: number;
}): void {
  const database = getDB();
  const stmt = database.prepare(`
    INSERT OR REPLACE INTO daily_volumes 
    (instrument_id, date, total_volume, first_snapshot, last_snapshot, snapshot_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?, COALESCE(
      (SELECT created_at FROM daily_volumes WHERE instrument_id = ? AND date = ?),
      CURRENT_TIMESTAMP
    ))
  `);
  stmt.run(
    record.instrumentId,
    record.date,
    record.totalVolume,
    record.firstSnapshot || null,
    record.lastSnapshot || null,
    record.snapshotCount,
    record.instrumentId,
    record.date
  );
}

export function getDailyVolumes(instrumentId: string, limit: number = 30): any[] {
  const database = getDB();
  const stmt = database.prepare(`
    SELECT 
      date,
      total_volume,
      snapshot_count,
      created_at
    FROM daily_volumes
    WHERE instrument_id = ?
    ORDER BY date DESC
    LIMIT ?
  `);
  return stmt.all(instrumentId, limit) as any[];
}

export function getRecentSnapshots(instrumentId: string, limit: number = 100): any[] {
  const database = getDB();
  const stmt = database.prepare(`
    SELECT 
      timestamp,
      price,
      bid,
      ask,
      volume,
      daily_volume,
      is_reset
    FROM price_snapshots
    WHERE instrument_id = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `);
  return stmt.all(instrumentId, limit) as any[];
}

export function close(): void {
  if (db) {
    db.close();
    db = null;
  }
}
