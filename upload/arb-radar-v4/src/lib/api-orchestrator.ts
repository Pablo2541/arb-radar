// ════════════════════════════════════════════════════════════════════════
// V4.0 BLINDADO — API Orchestrator: Sequential API calls
//
// ALL API calls happen ONE AT A TIME through a strict queue.
// V4.0 OPTIMIZED: Reduced delays for instant radar experience.
//
// Timeline (approximate, after orchestrator starts at t=2s):
//   2s    → /api/letras (LIVE data + caución) — INSTANT RADAR
//   ~5s   → /api/dolar (dollar rates)
//   ~8s   → /api/market-truth (RP + MEP consensus)
//   ~11s  → /api/iol-level2 (IOL status check)
//   ~14s  → /api/market-pressure (absorption alerts)
//
// Total from page load: ~5s to first data, ~16s to full data
// Refresh: Each API refreshes on its own interval, also sequentially
// ════════════════════════════════════════════════════════════════════════

// ── API Call Schedule ────────────────────────────────────────────────
export interface ApiCallDef {
  name: string;
  initialDelayMs: number;  // Delay before first call
  intervalMs: number;      // 0 = one-time, otherwise refresh interval
  endpoint: string;
  timeoutMs: number;
}

export const API_SCHEDULE: ApiCallDef[] = [
  {
    name: 'letras',
    initialDelayMs: 1000,     // 1s after orchestrator starts — PRIORITY
    intervalMs: 60_000,       // Refresh every 60s
    endpoint: '/api/letras',
    timeoutMs: 30_000,        // 30s timeout (letras can be slow)
  },
  {
    name: 'dolar',
    initialDelayMs: 4000,     // 4s after start
    intervalMs: 300_000,      // Refresh every 5 min
    endpoint: '/api/dolar',
    timeoutMs: 12_000,
  },
  {
    name: 'market-truth',
    initialDelayMs: 7000,     // 7s after start
    intervalMs: 90_000,       // Refresh every 90s
    endpoint: '/api/market-truth',
    timeoutMs: 20_000,        // 20s timeout (5 sequential fetches)
  },
  {
    name: 'iol-status',
    initialDelayMs: 10_000,   // 10s after start
    intervalMs: 120_000,      // Refresh every 2 min
    endpoint: '/api/iol-level2?tickers=T5W3',
    timeoutMs: 12_000,
  },
  {
    name: 'market-pressure',
    initialDelayMs: 13_000,   // 13s after start
    intervalMs: 120_000,      // Refresh every 2 min
    endpoint: '/api/market-pressure?tickers=T15E7,T30J7,T5W3,S1L5',
    timeoutMs: 12_000,
  },
];

// ── API Result Cache ────────────────────────────────────────────────
interface ApiResult {
  data: unknown;
  timestamp: number;
  error: boolean;
}

const apiCache = new Map<string, ApiResult>();

export function getCachedResult(name: string): ApiResult | undefined {
  return apiCache.get(name);
}

// ── Strict Sequential Fetch Queue ────────────────────────────────────
// Only ONE fetch can be in flight at any time. Period.

interface QueueItem {
  endpoint: string;
  timeoutMs: number;
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
}

let fetchQueue: QueueItem[] = [];
let isFetching = false;

async function processQueue(): Promise<void> {
  if (isFetching || fetchQueue.length === 0) return;
  isFetching = true;

  const { endpoint, timeoutMs, resolve, reject } = fetchQueue.shift()!;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(endpoint, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      reject(new Error(`API ${endpoint} returned ${res.status}`));
      return;
    }

    const data = await res.json();
    resolve(data);
  } catch (err) {
    reject(err instanceof Error ? err : new Error(String(err)));
  } finally {
    // Wait 1 second before processing next item — let server breathe
    isFetching = false;
    if (fetchQueue.length > 0) {
      setTimeout(() => processQueue(), 1000);
    }
  }
}

function queueFetch(endpoint: string, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    fetchQueue.push({ endpoint, timeoutMs, resolve, reject });
    if (!isFetching) {
      processQueue();
    }
  });
}

// ── Public: Start the sequential initialization ──────────────────────

export type ApiCallback = (name: string, data: unknown, error: boolean) => void;

let started = false;
const activeTimers: ReturnType<typeof setTimeout>[] = [];
const activeIntervals: ReturnType<typeof setInterval>[] = [];

export function startApiSequence(onResult: ApiCallback): void {
  if (started) return;
  started = true;

  for (const api of API_SCHEDULE) {
    // Initial delayed fetch
    const timer = setTimeout(async () => {
      try {
        const data = await queueFetch(api.endpoint, api.timeoutMs);
        apiCache.set(api.name, { data, timestamp: Date.now(), error: false });
        onResult(api.name, data, false);
      } catch (err) {
        console.warn(`[api-orchestrator] ${api.name} failed:`, err instanceof Error ? err.message : String(err));
        apiCache.set(api.name, { data: null, timestamp: Date.now(), error: true });
        onResult(api.name, null, true);
      }

      // Set up refresh interval if configured
      if (api.intervalMs > 0) {
        const interval = setInterval(async () => {
          try {
            const data = await queueFetch(api.endpoint, api.timeoutMs);
            apiCache.set(api.name, { data, timestamp: Date.now(), error: false });
            onResult(api.name, data, false);
          } catch {
            // Silent retry failure
          }
        }, api.intervalMs);
        activeIntervals.push(interval);
      }
    }, api.initialDelayMs);
    activeTimers.push(timer);
  }
}

export function stopApiSequence(): void {
  for (const t of activeTimers) clearTimeout(t);
  for (const i of activeIntervals) clearInterval(i);
  activeTimers.length = 0;
  activeIntervals.length = 0;
  started = false;
  fetchQueue.length = 0;
  isFetching = false;
}
