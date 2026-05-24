import { create } from 'zustand';
import type {
  Instrument, Config, Position, Transaction,
  CockpitScore, MarketTruthResponse, DolarRate,
  LiveInstrument, MomentumData, TabId, ScannerSortKey, ScannerViewMode,
} from './types';
import { SAMPLE_INSTRUMENTS, DEFAULT_CONFIG, DEFAULT_POSITION, INITIAL_TRANSACTIONS, STORAGE_KEYS } from './sampleData';
import { ensureValidDays } from './calculations';

export interface RadarState {
  // Core State
  instruments: Instrument[];
  config: Config;
  position: Position | null;
  transactions: Transaction[];
  lastUpdate: string | null;
  mepRate: number | undefined;
  cclRate: number | undefined;

  // Live Data State
  liveInstruments: LiveInstrument[];
  liveActive: boolean;
  liveLoading: boolean;
  liveError: string | null;
  liveLastRefresh: Date | null;

  // Cockpit State
  cockpitScores: CockpitScore[];
  cockpitScoresLoading: boolean;

  // Dolar State
  dolarRates: DolarRate[];
  dolarLoading: boolean;

  // Market Truth State
  marketTruth: MarketTruthResponse | null;
  marketTruthStale: boolean;

  // UI State
  activeTab: TabId;
  theme: 'dark' | 'light';
  mounted: boolean;
  currentTime: string;

  // Scanner State (V5.0)
  scannerSortKey: ScannerSortKey;
  scannerViewMode: ScannerViewMode;
  scannerHorizon: number;
  scannerSearchText: string;

  // IOL State
  iolLevel2Online: boolean;

  // Actions
  setInstruments: (v: Instrument[]) => void;
  setConfig: (v: Config) => void;
  setPosition: (v: Position | null) => void;
  setTransactions: (v: Transaction[]) => void;
  setLastUpdate: (v: string) => void;
  setMepRate: (v: number | undefined) => void;
  setCclRate: (v: number | undefined) => void;
  setLiveInstruments: (v: LiveInstrument[]) => void;
  setLiveActive: (v: boolean) => void;
  setLiveLoading: (v: boolean) => void;
  setLiveError: (v: string | null) => void;
  setCockpitScores: (v: CockpitScore[]) => void;
  setCockpitScoresLoading: (v: boolean) => void;
  setDolarRates: (v: DolarRate[]) => void;
  setDolarLoading: (v: boolean) => void;
  setMarketTruth: (v: MarketTruthResponse) => void;
  setActiveTab: (v: TabId) => void;
  setTheme: (v: 'dark' | 'light') => void;
  setMounted: (v: boolean) => void;
  setCurrentTime: (v: string) => void;
  setScannerSortKey: (v: ScannerSortKey) => void;
  setScannerViewMode: (v: ScannerViewMode) => void;
  setScannerHorizon: (v: number) => void;
  setScannerSearchText: (v: string) => void;
  setIolLevel2Online: (v: boolean) => void;
  nukeAll: () => void;
}

function saveToStorage<T>(key: string, data: T): void {
  try { localStorage.setItem(key, JSON.stringify(data)); } catch { /* */ }
}

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const stored = localStorage.getItem(key);
    if (stored) return JSON.parse(stored) as T;
  } catch { /* */ }
  return fallback;
}

export const useRadarStore = create<RadarState>((set, get) => ({
  // Initial State
  instruments: SAMPLE_INSTRUMENTS,
  config: DEFAULT_CONFIG,
  position: DEFAULT_POSITION,
  transactions: INITIAL_TRANSACTIONS,
  lastUpdate: null,
  mepRate: undefined,
  cclRate: undefined,

  liveInstruments: [],
  liveActive: false,
  liveLoading: false,
  liveError: null,
  liveLastRefresh: null,

  cockpitScores: [],
  cockpitScoresLoading: false,

  dolarRates: [],
  dolarLoading: true,

  marketTruth: null,
  marketTruthStale: false,

  activeTab: 'scanner',
  theme: 'dark',
  mounted: false,
  currentTime: '',

  scannerSortKey: 'cockpitScore',
  scannerViewMode: 'heatmap',
  scannerHorizon: 45,
  scannerSearchText: '',

  iolLevel2Online: false,

  // Setters
  setInstruments: (v) => { const fixed = ensureValidDays(v); set({ instruments: fixed }); saveToStorage(STORAGE_KEYS.INSTRUMENTS, fixed); },
  setConfig: (v) => { set({ config: v }); saveToStorage(STORAGE_KEYS.CONFIG, v); },
  setPosition: (v) => { set({ position: v }); saveToStorage(STORAGE_KEYS.POSITION, v); },
  setTransactions: (v) => { set({ transactions: v }); saveToStorage(STORAGE_KEYS.TRANSACTIONS, v); },
  setLastUpdate: (v) => { set({ lastUpdate: v }); saveToStorage(STORAGE_KEYS.LAST_UPDATE, v); },
  setMepRate: (v) => set({ mepRate: v }),
  setCclRate: (v) => set({ cclRate: v }),
  setLiveInstruments: (v) => set({ liveInstruments: v }),
  setLiveActive: (v) => {
    set({ liveActive: v });
    try { localStorage.setItem('arbradar_live_active', String(v)); } catch { /* */ }
  },
  setLiveLoading: (v) => set({ liveLoading: v }),
  setLiveError: (v) => set({ liveError: v }),
  setCockpitScores: (v) => set({ cockpitScores: v }),
  setCockpitScoresLoading: (v) => set({ cockpitScoresLoading: v }),
  setDolarRates: (v) => set({ dolarRates: v }),
  setDolarLoading: (v) => set({ dolarLoading: v }),
  setMarketTruth: (v) => set({ marketTruth: v, marketTruthStale: v.stale === true }),
  setActiveTab: (v) => set({ activeTab: v }),
  setTheme: (v) => {
    set({ theme: v });
    try { localStorage.setItem('arbradar_theme', v); } catch { /* */ }
    if (typeof document !== 'undefined') {
      if (v === 'dark') {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    }
  },
  setMounted: (v) => set({ mounted: v }),
  setCurrentTime: (v) => set({ currentTime: v }),
  setScannerSortKey: (v) => set({ scannerSortKey: v }),
  setScannerViewMode: (v) => set({ scannerViewMode: v }),
  setScannerHorizon: (v) => set({ scannerHorizon: v }),
  setScannerSearchText: (v) => set({ scannerSearchText: v }),
  setIolLevel2Online: (v) => set({ iolLevel2Online: v }),
  nukeAll: () => {
    try { localStorage.clear(); } catch { /* */ }
    set({
      instruments: SAMPLE_INSTRUMENTS,
      config: DEFAULT_CONFIG,
      position: DEFAULT_POSITION,
      transactions: INITIAL_TRANSACTIONS,
      lastUpdate: null,
      liveInstruments: [],
      cockpitScores: [],
      dolarRates: [],
      marketTruth: null,
    });
  },
}));

// Initialize store from localStorage
export function initializeStore(): void {
  const lsInstruments = loadFromStorage<Instrument[]>(STORAGE_KEYS.INSTRUMENTS, SAMPLE_INSTRUMENTS);
  const lsConfig = loadFromStorage<Config>(STORAGE_KEYS.CONFIG, DEFAULT_CONFIG);
  const lsPosition = loadFromStorage<Position | null>(STORAGE_KEYS.POSITION, DEFAULT_POSITION);
  const lsTransactions = loadFromStorage<Transaction[]>(STORAGE_KEYS.TRANSACTIONS, INITIAL_TRANSACTIONS);
  const lsTheme = (localStorage.getItem('arbradar_theme') as 'dark' | 'light') || 'dark';
  const lsLiveActive = localStorage.getItem('arbradar_live_active') === 'true';

  useRadarStore.setState({
    instruments: ensureValidDays(lsInstruments),
    config: lsConfig,
    position: lsPosition,
    transactions: lsTransactions,
    theme: lsTheme,
    liveActive: lsLiveActive,
    mounted: true,
  });

  if (typeof document !== 'undefined' && lsTheme === 'dark') {
    document.documentElement.classList.add('dark');
  }
}
