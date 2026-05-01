// ════════════════════════════════════════════════════════════════════════
// V3.0 — ARB//RADAR Global State Store (Zustand)
//
// ARCHITECTURE:
// 1. Zustand store → instant UI updates (synchronous, no lag)
// 2. localStorage → immediate backup on every change (fallback)
// 3. PostgreSQL   → debounced write every 60s (Vercel quota safe)
//
// CRITICAL RULES:
// - LIVE updates the screen INSTANTLY via Zustand (no debounce on read)
// - DB writes are debounced to 60s to avoid exhausting Vercel quotas
// - If DB fails or isn't configured, localStorage is the automatic fallback
// - The store is the SINGLE SOURCE OF TRUTH for all tabs
// ════════════════════════════════════════════════════════════════════════

import { create } from 'zustand';
import type {
  Instrument, Config, Position, Transaction,
  SimulationRecord, ExternalHistoryRecord, LiveInstrument,
} from '@/lib/types';
import {
  SAMPLE_INSTRUMENTS, DEFAULT_CONFIG, DEFAULT_POSITION,
  INITIAL_TRANSACTIONS, STORAGE_KEYS,
} from '@/lib/sampleData';
import { ensureValidDays } from '@/lib/calculations';
import type { PriceHistoryFile } from '@/lib/priceHistory';
import { loadPriceHistory, savePriceHistory } from '@/lib/priceHistory';

// ════════════════════════════════════════════════════════════════════════
// Types
// ════════════════════════════════════════════════════════════════════════

export type AppTheme = 'dark' | 'light';
export type TabId = 'mercado' | 'oportunidades' | 'curvas' | 'arbitraje' | 'estrategias' | 'cartera' | 'diagnostico' | 'historial' | 'configuracion';

export interface ActivityItem {
  id: string;
  icon: string;
  message: string;
  timestamp: string;
  type: 'data' | 'dolar' | 'position' | 'threshold' | 'db';
}

export interface RadarState {
  // ── Core State ─────────────────────────────────────────────────────
  instruments: Instrument[];
  config: Config;
  position: Position | null;
  transactions: Transaction[];
  simulations: SimulationRecord[];
  externalHistory: ExternalHistoryRecord[];
  lastUpdate: string | null;
  rawInput: string;
  mepRate: number | undefined;
  cclRate: number | undefined;
  priceHistory: PriceHistoryFile | null;

  // ── UI State ───────────────────────────────────────────────────────
  activeTab: TabId;
  theme: AppTheme;
  mounted: boolean;
  currentTime: string;
  activityFeed: ActivityItem[];

  // ── DB Sync State ──────────────────────────────────────────────────
  dbAvailable: boolean;        // whether DB is reachable
  lastDbSync: Date | null;     // last successful DB write
  lastDbSyncStatus: 'idle' | 'syncing' | 'error' | 'success';

  // ── IOL Level 2 State ─────────────────────────────────────────────
  iolLevel2Online: boolean;    // V3.1: Whether IOL Level 2 data is available

  // ── Actions ────────────────────────────────────────────────────────
  setInstruments: (v: Instrument[]) => void;
  setConfig: (v: Config) => void;
  setPosition: (v: Position | null) => void;
  setTransactions: (v: Transaction[]) => void;
  setSimulations: (v: SimulationRecord[]) => void;
  setExternalHistory: (v: ExternalHistoryRecord[]) => void;
  setLastUpdate: (v: string) => void;
  setRawInput: (v: string) => void;
  setMepRate: (v: number | undefined) => void;
  setCclRate: (v: number | undefined) => void;
  setPriceHistory: (v: PriceHistoryFile) => void;
  setActiveTab: (v: TabId) => void;
  setTheme: (v: AppTheme) => void;
  setMounted: (v: boolean) => void;
  setCurrentTime: (v: string) => void;
  addActivity: (item: Omit<ActivityItem, 'id' | 'timestamp'>) => void;
  clearActivityFeed: () => void;

  // ── DB Sync Actions ────────────────────────────────────────────────
  persistToDb: () => Promise<void>;
  loadFromDb: () => Promise<boolean>;
  nukeAll: () => void;
}

// ════════════════════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════════════════════

function saveToStorage<T>(key: string, data: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(data));
    // V3.0: Track last persist time for DB vs localStorage comparison on init
    localStorage.setItem('arbradar_lastPersistTime', String(Date.now()));
  } catch {
    // Storage full or unavailable
  }
}

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const stored = localStorage.getItem(key);
    if (stored) return JSON.parse(stored) as T;
  } catch {
    // Parse error or unavailable
  }
  return fallback;
}

/** Fix instruments: ensure tir = tem, validate days */
function fixInstruments(instruments: Instrument[]): Instrument[] {
  const fixed = instruments.map(inst => {
    const effectiveRate = inst.tem || inst.tir || 0;
    return { ...inst, tir: effectiveRate, tem: effectiveRate };
  });
  return ensureValidDays(fixed);
}

// ════════════════════════════════════════════════════════════════════════
// Debounce Timer (60s) for DB writes
// ════════════════════════════════════════════════════════════════════════

let dbDebounceTimer: ReturnType<typeof setTimeout> | null = null;
const DB_DEBOUNCE_MS = 60_000; // 60 seconds

function scheduleDbPersist(store: () => RadarState) {
  if (dbDebounceTimer) {
    clearTimeout(dbDebounceTimer);
  }
  dbDebounceTimer = setTimeout(async () => {
    const state = store();
    if (state.mounted) {
      await state.persistToDb();
    }
    dbDebounceTimer = null;
  }, DB_DEBOUNCE_MS);
}

// ════════════════════════════════════════════════════════════════════════
// Zustand Store
// ════════════════════════════════════════════════════════════════════════

export const useRadarStore = create<RadarState>((set, get) => ({
  // ── Initial State ──────────────────────────────────────────────────
  instruments: SAMPLE_INSTRUMENTS,
  config: DEFAULT_CONFIG,
  position: DEFAULT_POSITION,
  transactions: INITIAL_TRANSACTIONS,
  simulations: [],
  externalHistory: [],
  lastUpdate: null,
  rawInput: '',
  mepRate: undefined,
  cclRate: undefined,
  priceHistory: null,

  activeTab: 'mercado',
  theme: 'dark',
  mounted: false,
  currentTime: '',
  activityFeed: [],

  dbAvailable: true,
  lastDbSync: null,
  lastDbSyncStatus: 'idle',
  iolLevel2Online: false,

  // ── Setters (write to Zustand + localStorage immediately, schedule DB) ─
  setInstruments: (v: Instrument[]) => {
    const validInstruments = fixInstruments(v);
    set({ instruments: validInstruments });
    saveToStorage(STORAGE_KEYS.INSTRUMENTS, validInstruments);
    scheduleDbPersist(get);
  },

  setConfig: (v: Config) => {
    set({ config: v });
    saveToStorage(STORAGE_KEYS.CONFIG, v);
    scheduleDbPersist(get);
  },

  setPosition: (v: Position | null) => {
    set({ position: v });
    saveToStorage(STORAGE_KEYS.POSITION, v);
    scheduleDbPersist(get);
  },

  setTransactions: (v: Transaction[]) => {
    set({ transactions: v });
    saveToStorage(STORAGE_KEYS.TRANSACTIONS, v);
    scheduleDbPersist(get);
  },

  setSimulations: (v: SimulationRecord[]) => {
    set({ simulations: v });
    saveToStorage(STORAGE_KEYS.SIMULATIONS, v);
    scheduleDbPersist(get);
  },

  setExternalHistory: (v: ExternalHistoryRecord[]) => {
    set({ externalHistory: v });
    saveToStorage(STORAGE_KEYS.EXTERNAL_HISTORY, v);
    scheduleDbPersist(get);
  },

  setLastUpdate: (v: string) => {
    set({ lastUpdate: v });
    saveToStorage(STORAGE_KEYS.LAST_UPDATE, v);
    scheduleDbPersist(get);
  },

  setRawInput: (v: string) => {
    set({ rawInput: v });
    saveToStorage(STORAGE_KEYS.RAW_INPUT, v);
    scheduleDbPersist(get);
  },

  setMepRate: (v: number | undefined) => {
    set({ mepRate: v });
    scheduleDbPersist(get);
  },

  setCclRate: (v: number | undefined) => {
    set({ cclRate: v });
    scheduleDbPersist(get);
  },

  setPriceHistory: (v: PriceHistoryFile) => {
    set({ priceHistory: v });
    savePriceHistory(v);
    scheduleDbPersist(get);
  },

  setActiveTab: (v: TabId) => {
    set({ activeTab: v });
  },

  setTheme: (v: AppTheme) => {
    set({ theme: v });
    try {
      localStorage.setItem('arbradar_theme', v);
    } catch { /* */ }
    if (typeof document !== 'undefined') {
      if (v === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.setAttribute('data-theme', 'light');
        document.documentElement.classList.remove('dark');
      }
    }
  },

  setMounted: (v: boolean) => {
    set({ mounted: v });
  },

  setCurrentTime: (v: string) => {
    set({ currentTime: v });
  },

  addActivity: (item: Omit<ActivityItem, 'id' | 'timestamp'>) => {
    const itemId = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const newItem: ActivityItem = {
      ...item,
      id: itemId,
      timestamp: new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    };
    set(prev => ({
      activityFeed: [newItem, ...prev.activityFeed].slice(0, 5),
    }));
    // Auto-dismiss after 3 seconds
    setTimeout(() => {
      set(prev => ({
        activityFeed: prev.activityFeed.filter(i => i.id !== itemId),
      }));
    }, 3000);
  },

  clearActivityFeed: () => {
    set({ activityFeed: [] });
  },

  // ════════════════════════════════════════════════════════════════════
  // DB PERSISTENCE — Debounced write (every 60s when data changes)
  // ════════════════════════════════════════════════════════════════════
  persistToDb: async () => {
    const state = get();
    set({ lastDbSyncStatus: 'syncing' });

    try {
      const payload = {
        instruments: JSON.stringify(state.instruments),
        config: JSON.stringify(state.config),
        position: state.position ? JSON.stringify(state.position) : null,
        transactions: JSON.stringify(state.transactions),
        lastUpdate: state.lastUpdate,
        rawInput: state.rawInput,
        mepRate: state.mepRate ?? null,
        cclRate: state.cclRate ?? null,
        liveActive: false, // Will be set by LIVE hook
        iolLevel2Online: state.iolLevel2Online,
      };

      const res = await fetch('/api/state', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        set({
          dbAvailable: true,
          lastDbSync: new Date(),
          lastDbSyncStatus: 'success',
        });
      } else {
        const data = await res.json().catch(() => ({}));
        if (data.fallback) {
          // DB not configured — this is fine, localStorage is the fallback
          set({ dbAvailable: false, lastDbSyncStatus: 'idle' });
        } else {
          set({ lastDbSyncStatus: 'error' });
          console.warn('[persistToDb] DB write failed, localStorage is fallback');
        }
      }
    } catch (error) {
      // Network error or DB unavailable — localStorage already has the data
      set({ dbAvailable: false, lastDbSyncStatus: 'error' });
      console.warn('[persistToDb] Network error, localStorage is fallback:', error);
    }
  },

  // ════════════════════════════════════════════════════════════════════
  // DB RESTORE — Load state from DB on startup
  // Priority: DB > localStorage > defaults
  // ════════════════════════════════════════════════════════════════════
  loadFromDb: async () => {
    try {
      const res = await fetch('/api/state', {
        headers: { 'Content-Type': 'application/json' },
      });

      if (!res.ok) {
        set({ dbAvailable: false });
        return false;
      }

      const data = await res.json();

      if (data.fallback) {
        // DB not configured — use localStorage
        set({ dbAvailable: false });
        return false;
      }

      if (!data.exists) {
        // No DB state yet — use localStorage
        return false;
      }

      // Parse DB state and merge
      const dbState = data.data;
      try {
        const instruments = fixInstruments(JSON.parse(dbState.instruments));
        const config = JSON.parse(dbState.config) as Config;
        const position = dbState.position ? JSON.parse(dbState.position) as Position : null;
        const transactions = JSON.parse(dbState.transactions) as Transaction[];

        // Ensure config has capitalDisponible
        if (config.capitalDisponible === undefined) {
          config.capitalDisponible = DEFAULT_CONFIG.capitalDisponible;
        }

        set({
          instruments: instruments.length > 0 ? instruments : SAMPLE_INSTRUMENTS,
          config,
          position,
          transactions,
          lastUpdate: dbState.lastUpdate,
          rawInput: dbState.rawInput ?? '',
          mepRate: dbState.mepRate ?? undefined,
          cclRate: dbState.cclRate ?? undefined,
          dbAvailable: true,
          lastDbSync: new Date(),
          // V3.1: Detect IOL Level 2 status from DB flag OR from instrument data
          iolLevel2Online: dbState.iolLevel2Online === true || instruments.some(i => i.iolStatus === 'online'),
        });

        return true;
      } catch (parseError) {
        console.error('[loadFromDb] Parse error:', parseError);
        return false;
      }
    } catch (error) {
      // Network error — DB unavailable, use localStorage
      set({ dbAvailable: false });
      console.warn('[loadFromDb] Network error, using localStorage:', error);
      return false;
    }
  },

  // ════════════════════════════════════════════════════════════════════
  // NUKE — Wipe everything (localStorage + DB)
  // ════════════════════════════════════════════════════════════════════
  nukeAll: () => {
    // Clear localStorage
    try {
      localStorage.clear();
    } catch { /* */ }

    // Reset Zustand to defaults
    set({
      instruments: SAMPLE_INSTRUMENTS,
      config: DEFAULT_CONFIG,
      position: DEFAULT_POSITION,
      transactions: INITIAL_TRANSACTIONS,
      simulations: [],
      externalHistory: [],
      lastUpdate: null,
      rawInput: '',
      mepRate: undefined,
      cclRate: undefined,
      priceHistory: null,
      activityFeed: [],
    });

    // Clear DB via API
    fetch('/api/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instruments: JSON.stringify(SAMPLE_INSTRUMENTS),
        config: JSON.stringify(DEFAULT_CONFIG),
        position: null,
        transactions: JSON.stringify(INITIAL_TRANSACTIONS),
        lastUpdate: null,
        rawInput: '',
        mepRate: null,
        cclRate: null,
        liveActive: false,
      }),
    }).catch(() => { /* DB unavailable */ });

    // Hard reload — clean slate
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  },
}));

// ════════════════════════════════════════════════════════════════════════
// Initialization helper — call once on app mount
//
// PRIORITY (V3.0 with timestamp comparison):
// 1. Load both DB and localStorage data
// 2. Compare timestamps — use whichever is MORE RECENT
// 3. If DB has no data or is unreachable → use localStorage
// 4. If localStorage has no data → use DB
// 5. If neither has data → use defaults
//
// This ensures that if a user made changes on another device
// (synced to DB), those changes won't be overwritten by stale
// localStorage data from the current browser.
// ════════════════════════════════════════════════════════════════════════

export async function initializeStore(): Promise<void> {
  // ── Step 1: Load localStorage data (synchronous, fast) ──
  const lsInstruments = loadFromStorage<Instrument[]>(STORAGE_KEYS.INSTRUMENTS, SAMPLE_INSTRUMENTS);
  const lsConfig = loadFromStorage<Config>(STORAGE_KEYS.CONFIG, DEFAULT_CONFIG);
  const lsPosition = loadFromStorage<Position | null>(STORAGE_KEYS.POSITION, DEFAULT_POSITION);
  const lsTransactions = loadFromStorage<Transaction[]>(STORAGE_KEYS.TRANSACTIONS, INITIAL_TRANSACTIONS);
  const lsLastUpdate = loadFromStorage<string | null>(STORAGE_KEYS.LAST_UPDATE, null);
  const lsRawInput = loadFromStorage<string>(STORAGE_KEYS.RAW_INPUT, '');
  const lsSimulations = loadFromStorage<SimulationRecord[]>(STORAGE_KEYS.SIMULATIONS, []);
  const lsExternalHistory = loadFromStorage<ExternalHistoryRecord[]>(STORAGE_KEYS.EXTERNAL_HISTORY, []);
  const lsTheme = (localStorage.getItem('arbradar_theme') as AppTheme) || 'dark';
  const lsPriceHistory = loadPriceHistory();
  const lsPersistTime = loadFromStorage<number | null>('arbradar_lastPersistTime', null);

  // Ensure config has capitalDisponible
  if (lsConfig.capitalDisponible === undefined) {
    lsConfig.capitalDisponible = DEFAULT_CONFIG.capitalDisponible;
  }

  // ── Step 2: Try loading from DB (async) ──
  let dbData: {
    instruments: string;
    config: string;
    position: string | null;
    transactions: string;
    lastUpdate: string | null;
    rawInput: string | null;
    mepRate: number | null;
    cclRate: number | null;
    liveActive: boolean;
    updatedAt?: string;
  } | null = null;
  let dbAvailable = false;

  try {
    const res = await fetch('/api/state', {
      headers: { 'Content-Type': 'application/json' },
    });

    if (res.ok) {
      const data = await res.json();
      if (data.fallback) {
        // DB not configured — signal to use localStorage
        dbAvailable = false;
      } else if (data.exists) {
        dbData = data.data;
        dbAvailable = true;
      }
    }
  } catch {
    // Network error — DB unreachable
    dbAvailable = false;
  }

  // ── Step 3: Compare timestamps and decide source ──
  let useDB = false;

  if (dbData) {
    const dbUpdatedAt = dbData.updatedAt ? new Date(dbData.updatedAt).getTime() : 0;

    if (lsPersistTime && dbUpdatedAt > 0) {
      // Both have timestamps → use the MORE RECENT one
      useDB = dbUpdatedAt > lsPersistTime;
      if (useDB) {
        console.log(`[initializeStore] DB wins: DB updatedAt=${new Date(dbUpdatedAt).toISOString()} > LS persistTime=${new Date(lsPersistTime).toISOString()}`);
      } else {
        console.log(`[initializeStore] LS wins: LS persistTime=${new Date(lsPersistTime).toISOString()} >= DB updatedAt=${new Date(dbUpdatedAt).toISOString()}`);
      }
    } else if (dbUpdatedAt > 0) {
      // DB has timestamp but localStorage doesn't → prefer DB (cross-device sync)
      useDB = true;
      console.log('[initializeStore] DB wins: no LS timestamp, DB has data');
    } else {
      // DB has no timestamp → can't determine recency, prefer localStorage (more reliable)
      useDB = false;
      console.log('[initializeStore] LS wins: DB has no updatedAt timestamp');
    }
  }

  // ── Step 4: Apply the chosen source ──
  if (useDB && dbData) {
    try {
      const instruments = fixInstruments(JSON.parse(dbData.instruments));
      const config = JSON.parse(dbData.config) as Config;
      const position = dbData.position ? JSON.parse(dbData.position) as Position : null;
      const transactions = JSON.parse(dbData.transactions) as Transaction[];

      if (config.capitalDisponible === undefined) {
        config.capitalDisponible = DEFAULT_CONFIG.capitalDisponible;
      }

      useRadarStore.setState({
        instruments: instruments.length > 0 ? instruments : SAMPLE_INSTRUMENTS,
        config,
        position,
        transactions,
        lastUpdate: dbData.lastUpdate,
        rawInput: dbData.rawInput ?? '',
        mepRate: dbData.mepRate ?? undefined,
        cclRate: dbData.cclRate ?? undefined,
        simulations: lsSimulations, // DB doesn't store simulations, keep LS
        externalHistory: lsExternalHistory, // DB doesn't store extHistory, keep LS
        theme: lsTheme, // Theme is local-only, not synced
        priceHistory: lsPriceHistory, // Price history is local-only
        dbAvailable: true,
        lastDbSync: new Date(),
        // V3.1: Detect IOL Level 2 from DB flag or instrument data
        iolLevel2Online: (dbData as Record<string, unknown>).iolLevel2Online === true || instruments.some(i => i.iolStatus === 'online'),
      });

      // Apply theme from localStorage (theme is device-specific, not synced)
      if (lsTheme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.setAttribute('data-theme', 'light');
        document.documentElement.classList.remove('dark');
      }
    } catch (parseError) {
      console.error('[initializeStore] DB data corrupted, falling back to localStorage:', parseError);
      useDB = false;
    }
  }

  if (!useDB) {
    const validInstruments = fixInstruments(
      lsInstruments.length > 0 ? lsInstruments : SAMPLE_INSTRUMENTS
    );

    useRadarStore.setState({
      instruments: validInstruments,
      config: lsConfig,
      position: lsPosition,
      transactions: lsTransactions,
      lastUpdate: lsLastUpdate,
      rawInput: lsRawInput,
      simulations: lsSimulations,
      externalHistory: lsExternalHistory,
      theme: lsTheme,
      priceHistory: lsPriceHistory,
      dbAvailable,
    });

    // Apply theme
    if (lsTheme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.setAttribute('data-theme', 'light');
      document.documentElement.classList.remove('dark');
    }
  }

  // Mark as mounted
  useRadarStore.setState({ mounted: true });
}
