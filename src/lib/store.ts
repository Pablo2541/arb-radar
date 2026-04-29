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
// Tries DB first, falls back to localStorage, then defaults
// ════════════════════════════════════════════════════════════════════════

export async function initializeStore(): Promise<void> {
  const store = useRadarStore.getState();

  // Step 1: Try loading from DB (async)
  const dbLoaded = await store.loadFromDb();

  if (!dbLoaded) {
    // Step 2: Fallback to localStorage
    const storedInstruments = loadFromStorage<Instrument[]>(STORAGE_KEYS.INSTRUMENTS, SAMPLE_INSTRUMENTS);
    const storedConfig = loadFromStorage<Config>(STORAGE_KEYS.CONFIG, DEFAULT_CONFIG);
    const storedPosition = loadFromStorage<Position | null>(STORAGE_KEYS.POSITION, DEFAULT_POSITION);
    const storedTransactions = loadFromStorage<Transaction[]>(STORAGE_KEYS.TRANSACTIONS, INITIAL_TRANSACTIONS);
    const storedLastUpdate = loadFromStorage<string | null>(STORAGE_KEYS.LAST_UPDATE, null);
    const storedRawInput = loadFromStorage<string>(STORAGE_KEYS.RAW_INPUT, '');
    const storedSimulations = loadFromStorage<SimulationRecord[]>(STORAGE_KEYS.SIMULATIONS, []);
    const storedExternalHistory = loadFromStorage<ExternalHistoryRecord[]>(STORAGE_KEYS.EXTERNAL_HISTORY, []);
    const storedTheme = (localStorage.getItem('arbradar_theme') as AppTheme) || 'dark';
    const storedPriceHistory = loadPriceHistory();

    // Ensure config has capitalDisponible
    if (storedConfig.capitalDisponible === undefined) {
      storedConfig.capitalDisponible = DEFAULT_CONFIG.capitalDisponible;
    }

    const validInstruments = fixInstruments(
      storedInstruments.length > 0 ? storedInstruments : SAMPLE_INSTRUMENTS
    );

    useRadarStore.setState({
      instruments: validInstruments,
      config: storedConfig,
      position: storedPosition,
      transactions: storedTransactions,
      lastUpdate: storedLastUpdate,
      rawInput: storedRawInput,
      simulations: storedSimulations,
      externalHistory: storedExternalHistory,
      theme: storedTheme,
      priceHistory: storedPriceHistory,
    });

    // Apply theme
    if (storedTheme === 'dark') {
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
