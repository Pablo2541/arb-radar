// ════════════════════════════════════════════════════════════════════════
// V4.0 BLINDADO — ARB//RADAR Global State Store (Zustand)
//
// ARCHITECTURE: "Data Intelligence ≠ Data Persistence"
//
// 1. Portfolio/Config → READ from data/portfolio.json on startup
// 2. Prices/Rates → FETCH from APIs in real-time (data912, IOL, etc.)
// 3. localStorage → instant backup, always available offline
// 4. NO NEON DB — No cloud persistence that can lose your data
//
// RULES:
// - The Radar NEVER auto-saves portfolio to the server
// - User must explicitly "Save" to persist portfolio changes
// - localStorage is the fast cache, portfolio.json is the truth
// - Prices update automatically from APIs, portfolio does NOT
// ════════════════════════════════════════════════════════════════════════

import { create } from 'zustand';
import type {
  Instrument, Config, Position, Transaction,
  SimulationRecord, ExternalHistoryRecord, LiveInstrument,
  CockpitScore,
} from '@/lib/types';
import {
  SAMPLE_INSTRUMENTS, DEFAULT_CONFIG, DEFAULT_POSITION,
  INITIAL_TRANSACTIONS, STORAGE_KEYS,
} from '@/lib/sampleData';
import { ensureValidDays } from '@/lib/calculations';
import type { PriceHistoryFile } from '@/lib/priceHistory';
import type { MarketTruthResponse } from '@/lib/market-truth-types';
import { loadPriceHistory, savePriceHistory } from '@/lib/priceHistory';

// ════════════════════════════════════════════════════════════════════════
// Types
// ════════════════════════════════════════════════════════════════════════

export type AppTheme = 'dark' | 'light';
export type TabId = 'mercado' | 'cockpit' | 'curvas' | 'estrategias' | 'cartera' | 'historial' | 'historico' | 'configuracion';

export interface ActivityItem {
  id: string;
  icon: string;
  message: string;
  timestamp: string;
  type: 'data' | 'dolar' | 'position' | 'threshold' | 'portfolio';
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

  // ── File Persistence State ─────────────────────────────────────────
  portfolioSource: 'file' | 'defaults' | 'localStorage';  // Where data came from
  portfolioLastSaved: string | null;  // Last save timestamp

  // ── IOL Level 2 State ─────────────────────────────────────────────
  iolLevel2Online: boolean;
  iolCredentialsExist: boolean;
  iolConnectionFailed: boolean;

  // ── Country Risk Auto-Fetch State ───────────────────────────────────
  riesgoPaisAuto: number | null;

  // ── Market Truth Engine State ──────────────────────────────────────
  marketTruth: MarketTruthResponse | null;
  mepConsensus: number | null;
  mepConfidence: string | null;
  rpConfidence: string | null;
  marketTruthStale: boolean;

  // ── Cockpit Score State ──
  cockpitScores: CockpitScore[];
  cockpitScoresLoading: boolean;

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

  // ── IOL Level 2 Actions ───────────────────────────────────────────
  setIolLevel2Online: (v: boolean) => void;
  setIolCredentialsExist: (v: boolean) => void;
  setIolConnectionFailed: (v: boolean) => void;

  // ── Country Risk Auto-Fetch Actions ────────────────────────────────
  setRiesgoPaisAuto: (v: number | null) => void;

  // ── Market Truth Engine Actions ──────────────────────────────────
  setMarketTruth: (v: MarketTruthResponse) => void;

  // ── Cockpit Score Actions ──
  setCockpitScores: (v: CockpitScore[]) => void;
  setCockpitScoresLoading: (v: boolean) => void;

  // ── Portfolio File Actions ──────────────────────────────────────
  savePortfolioToFile: () => Promise<boolean>;  // Explicit save to JSON file
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

  portfolioSource: 'defaults',
  portfolioLastSaved: null,

  iolLevel2Online: false,
  iolCredentialsExist: false,
  iolConnectionFailed: false,
  riesgoPaisAuto: null,
  marketTruth: null,
  mepConsensus: null,
  mepConfidence: null,
  rpConfidence: null,
  marketTruthStale: false,
  cockpitScores: [],
  cockpitScoresLoading: false,

  // ── Setters (write to Zustand + localStorage immediately) ──
  setInstruments: (v: Instrument[]) => {
    const validInstruments = fixInstruments(v);
    set({ instruments: validInstruments });
    saveToStorage(STORAGE_KEYS.INSTRUMENTS, validInstruments);
  },

  setConfig: (v: Config) => {
    set({ config: v });
    saveToStorage(STORAGE_KEYS.CONFIG, v);
  },

  setPosition: (v: Position | null) => {
    set({ position: v });
    saveToStorage(STORAGE_KEYS.POSITION, v);
  },

  setTransactions: (v: Transaction[]) => {
    set({ transactions: v });
    saveToStorage(STORAGE_KEYS.TRANSACTIONS, v);
  },

  setSimulations: (v: SimulationRecord[]) => {
    set({ simulations: v });
    saveToStorage(STORAGE_KEYS.SIMULATIONS, v);
  },

  setExternalHistory: (v: ExternalHistoryRecord[]) => {
    set({ externalHistory: v });
    saveToStorage(STORAGE_KEYS.EXTERNAL_HISTORY, v);
  },

  setLastUpdate: (v: string) => {
    set({ lastUpdate: v });
    saveToStorage(STORAGE_KEYS.LAST_UPDATE, v);
  },

  setRawInput: (v: string) => {
    set({ rawInput: v });
    saveToStorage(STORAGE_KEYS.RAW_INPUT, v);
  },

  setMepRate: (v: number | undefined) => {
    set({ mepRate: v });
  },

  setCclRate: (v: number | undefined) => {
    set({ cclRate: v });
  },

  setPriceHistory: (v: PriceHistoryFile) => {
    set({ priceHistory: v });
    savePriceHistory(v);
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

  // IOL Level 2 state setters
  setIolLevel2Online: (v: boolean) => {
    set({ iolLevel2Online: v });
  },
  setIolCredentialsExist: (v: boolean) => {
    set({ iolCredentialsExist: v });
  },
  setIolConnectionFailed: (v: boolean) => {
    set({ iolConnectionFailed: v });
  },

  // Riesgo País setter
  setRiesgoPaisAuto: (v: number | null) => {
    set({ riesgoPaisAuto: v });
    if (v !== null && v > 0) {
      const currentConfig = get().config;
      if (currentConfig.riesgoPais !== v) {
        get().setConfig({ ...currentConfig, riesgoPais: v });
      }
    }
  },

  // Cockpit Scores
  setCockpitScores: (v: CockpitScore[]) => {
    set({ cockpitScores: v });
  },

  setCockpitScoresLoading: (v: boolean) => {
    set({ cockpitScoresLoading: v });
  },

  // Market Truth
  setMarketTruth: (v: MarketTruthResponse) => {
    const rpValue = v.riesgo_pais.value;
    const mepValue = v.mep.value;
    set({
      marketTruth: v,
      riesgoPaisAuto: rpValue > 0 ? rpValue : null,
      mepConsensus: mepValue > 0 ? mepValue : null,
      mepConfidence: v.mep.confidence,
      rpConfidence: v.riesgo_pais.confidence,
      marketTruthStale: v.stale === true,
    });
    // Sync RP to config
    if (rpValue > 0) {
      const currentConfig = get().config;
      if (currentConfig.riesgoPais !== rpValue) {
        get().setConfig({ ...currentConfig, riesgoPais: rpValue });
      }
    }
    // Sync MEP
    if (mepValue > 0) {
      get().setMepRate(mepValue);
    }
  },

  // ════════════════════════════════════════════════════════════════════
  // V4.0: SAVE PORTFOLIO TO FILE — Explicit user action only
  // ════════════════════════════════════════════════════════════════════
  savePortfolioToFile: async () => {
    const state = get();
    try {
      const res = await fetch('/api/portfolio', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          capitalDisponible: state.config.capitalDisponible,
          position: state.position,
          transactions: state.transactions,
          config: {
            caucion1d: state.config.caucion1d,
            caucion7d: state.config.caucion7d,
            caucion30d: state.config.caucion30d,
            riesgoPais: state.config.riesgoPais,
            comisionTotal: state.config.comisionTotal,
          },
        }),
      });

      if (res.ok) {
        const data = await res.json();
        set({ portfolioLastSaved: data.lastUpdated });
        console.log('[store] Portfolio saved to file:', data.lastUpdated);
        return true;
      }
      console.warn('[store] Failed to save portfolio:', res.status);
      return false;
    } catch (error) {
      console.warn('[store] Error saving portfolio:', error);
      return false;
    }
  },

  // ════════════════════════════════════════════════════════════════════
  // NUKE — Wipe localStorage only (portfolio.json stays untouched!)
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
      riesgoPaisAuto: null,
      marketTruth: null,
      mepConsensus: null,
      mepConfidence: null,
      rpConfidence: null,
      marketTruthStale: false,
      cockpitScores: [],
      cockpitScoresLoading: false,
      portfolioSource: 'defaults',
    });

    // Hard reload — will re-read portfolio.json on mount
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  },
}));

// ════════════════════════════════════════════════════════════════════════
// Initialization — call once on app mount
//
// V4.0 BLINDADO PRIORITY:
// 1. Read portfolio.json from server (the TRUTH file)
// 2. If that fails, fall back to localStorage
// 3. If that fails, use defaults
// 4. After loading — portfolio.json data is king
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

  // Ensure config has capitalDisponible
  if (lsConfig.capitalDisponible === undefined) {
    lsConfig.capitalDisponible = DEFAULT_CONFIG.capitalDisponible;
  }

  // ── Step 2: Try loading from portfolio.json (the TRUTH file) ──
  let fileData: {
    capitalDisponible: number;
    position: Position | null;
    transactions: Transaction[];
    config: {
      caucion1d: number;
      caucion7d: number;
      caucion30d: number;
      riesgoPais?: number;
      comisionTotal: number;
    };
    lastUpdated?: string;
  } | null = null;
  let portfolioSource: 'file' | 'defaults' | 'localStorage' = 'defaults';

  try {
    const res = await fetch('/api/portfolio');
    if (res.ok) {
      const data = await res.json();
      if (data.ok && data.data) {
        fileData = data.data;
        portfolioSource = data.source === 'local_file' ? 'file' : 'defaults';
      }
    }
  } catch {
    // Server unreachable — use localStorage
    portfolioSource = 'localStorage';
  }

  // ── Step 3: Merge data — portfolio.json wins for position/config ──
  let finalConfig = lsConfig;
  let finalPosition: Position | null = lsPosition;
  let finalTransactions = lsTransactions;

  if (fileData) {
    // Portfolio.json is the TRUTH for position and config
    // BUT: riesgoPais is excluded from the file — it must come from the
    // Market Truth API only. If the file has riesgoPais (legacy), use
    // it only as a fallback; the API-fetched riesgoPaisAuto takes priority.
    if (fileData.config) {
      finalConfig = {
        caucion1d: fileData.config.caucion1d ?? lsConfig.caucion1d,
        caucion7d: fileData.config.caucion7d ?? lsConfig.caucion7d,
        caucion30d: fileData.config.caucion30d ?? lsConfig.caucion30d,
        riesgoPais: lsConfig.riesgoPais ?? fileData.config.riesgoPais ?? DEFAULT_CONFIG.riesgoPais,
        comisionTotal: fileData.config.comisionTotal ?? lsConfig.comisionTotal,
        capitalDisponible: fileData.capitalDisponible ?? lsConfig.capitalDisponible,
      };
    } else {
      finalConfig = { ...lsConfig, capitalDisponible: fileData.capitalDisponible ?? lsConfig.capitalDisponible };
    }

    finalPosition = fileData.position !== undefined ? fileData.position : lsPosition;

    if (fileData.transactions && Array.isArray(fileData.transactions) && fileData.transactions.length > 0) {
      finalTransactions = fileData.transactions;
    }
  }

  // ── Step 4: Apply ──
  const validInstruments = fixInstruments(
    lsInstruments.length > 0 ? lsInstruments : SAMPLE_INSTRUMENTS
  );

  useRadarStore.setState({
    instruments: validInstruments,
    config: finalConfig,
    position: finalPosition,
    transactions: finalTransactions,
    lastUpdate: lsLastUpdate,
    rawInput: lsRawInput,
    simulations: lsSimulations,
    externalHistory: lsExternalHistory,
    theme: lsTheme,
    priceHistory: lsPriceHistory,
    portfolioSource,
    mounted: true,
  });

  // Apply theme
  if (typeof document !== 'undefined') {
    if (lsTheme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.setAttribute('data-theme', 'light');
      document.documentElement.classList.remove('dark');
    }
  }

  console.log(`[initializeStore] Source: ${portfolioSource} | Position: ${finalPosition?.ticker || 'CASH'} | Capital: $${finalConfig.capitalDisponible?.toLocaleString('es-AR')}`);
}
