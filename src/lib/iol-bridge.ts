// ════════════════════════════════════════════════════════════════════════
// IOL BRIDGE — InvertirOnline Authentication & Level 2 Data Module
// ════════════════════════════════════════════════════════════════════════
//
// Server-side module for authenticating with InvertirOnline API
// and fetching Level 2 market data (volume, bid/ask, liquidity alerts).
//
// Consumers:
//   - Next.js API routes (src/app/api/*)
//   - scripts/update-prices.ts daemon
//
// DESIGN PRINCIPLES:
//   - Never throws — always returns gracefully (null / offline status)
//   - No Prisma dependency — pure HTTP + in-memory cache
//   - Token auto-refresh at 14min (expires at 15min)
//   - Batch processing with rate-limit delays
// ════════════════════════════════════════════════════════════════════════

import type { LiveInstrument } from './types';

// ── Configuration Constants ────────────────────────────────────────────

const IOL_TOKEN_URL = 'https://api.invertironline.com/token';
const IOL_COTIZACION_URL = 'https://api.invertironline.com/api/v2/Titulos';

/** Token is considered stale 60 seconds before actual expiry */
const TOKEN_REFRESH_BUFFER_MS = 60_000;
/** Default token lifetime if server doesn't return expires_in (15 min) */
const DEFAULT_TOKEN_LIFETIME_S = 900;
/** HTTP timeout for token endpoint */
const TOKEN_TIMEOUT_MS = 10_000;
/** HTTP timeout for cotización endpoint */
const COTIZACION_TIMEOUT_MS = 5_000;
/** Batch size for enrichWithIOL to respect IOL rate limits */
const ENRICH_BATCH_SIZE = 5;
/** Delay between batches in milliseconds */
const ENRICH_BATCH_DELAY_MS = 200;
/** Volume below this ratio of avg daily triggers liquidity alert */
const LOW_VOLUME_RATIO = 0.10;

// ── Exported Types ─────────────────────────────────────────────────────

/** Processed Level 2 data from IOL for a single instrument */
export interface IOLLevel2Data {
  iol_volume: number;
  iol_bid: number;
  iol_ask: number;
  iol_avg_daily_volume: number;
  iol_status: 'online' | 'offline' | 'no_data';
  iol_liquidity_alert: boolean;
}

/** Raw IOL /Cotizacion API response */
export interface IOLCotizacion {
  titulo: {
    simbolo: string;
    descripcion: string;
    pais: string;
    mercado: string;
    tipo: string;
  };
  ultimoPrecio: number;
  variacion: number;
  apertura: number;
  maximo: number;
  minimo: number;
  volumen: number;
  cantidadOperada: number;
  puntas?: {
    compra: Array<{ cantidad: number; precio: number }>;
    venta: Array<{ cantidad: number; precio: number }>;
  };
}

/** Configuration interface for the IOL bridge */
export interface IOLBridgeConfig {
  tokenUrl?: string;
  cotizacionUrl?: string;
  tokenTimeoutMs?: number;
  cotizacionTimeoutMs?: number;
  batchSize?: number;
  batchDelayMs?: number;
  lowVolumeRatio?: number;
}

/** Status of the IOL bridge connection */
export interface IOLBridgeStatus {
  online: boolean;
  lastTokenRefresh: Date | null;
  credentialsConfigured: boolean;
}

/** Result of batch enrichment */
export interface IOLEnrichResult {
  enriched: LiveInstrument[];
  iolOnline: boolean;
  stats: {
    queried: number;
    success: number;
    alerts: number;
  };
}

// ── Internal State (in-memory token cache) ─────────────────────────────

let cachedToken: string | null = null;
let tokenExpiryTimestamp: number = 0;
let lastTokenRefreshDate: Date | null = null;

/** Lock to prevent concurrent token refreshes */
let tokenRefreshPromise: Promise<string | null> | null = null;

// ── Config (can be overridden for testing) ─────────────────────────────

let config: Required<IOLBridgeConfig> = {
  tokenUrl: IOL_TOKEN_URL,
  cotizacionUrl: IOL_COTIZACION_URL,
  tokenTimeoutMs: TOKEN_TIMEOUT_MS,
  cotizacionTimeoutMs: COTIZACION_TIMEOUT_MS,
  batchSize: ENRICH_BATCH_SIZE,
  batchDelayMs: ENRICH_BATCH_DELAY_MS,
  lowVolumeRatio: LOW_VOLUME_RATIO,
};

/**
 * Override default configuration. Merges with defaults for any
 * fields not provided.
 */
export function configureIOLBridge(overrides: IOLBridgeConfig): void {
  config = { ...config, ...overrides };
}

// ── Helper: safe numeric parser ────────────────────────────────────────

function safeNum(val: unknown, fallback = 0): number {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  return fallback;
}

// ── Authentication ─────────────────────────────────────────────────────

/**
 * Obtain a valid IOL access token.
 *
 * - Returns cached token if still valid (with refresh buffer).
 * - Refreshes proactively when the token is near expiry.
 * - Returns `null` if credentials are not configured or auth fails.
 * - Never throws.
 */
export async function getIOLToken(): Promise<string | null> {
  const username = process.env.IOL_USERNAME;
  const password = process.env.IOL_PASSWORD;

  // ── Graceful degradation: no credentials ──
  if (!username || !password) {
    return null;
  }

  // ── Return cached token if still valid ──
  if (cachedToken && Date.now() < tokenExpiryTimestamp - TOKEN_REFRESH_BUFFER_MS) {
    return cachedToken;
  }

  // ── Deduplicate concurrent refresh attempts ──
  if (tokenRefreshPromise) {
    return tokenRefreshPromise;
  }

  tokenRefreshPromise = (async () => {
    try {
      const params = new URLSearchParams({
        username,
        password,
        grant_type: 'password',
      });

      const res = await fetch(config.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
        signal: AbortSignal.timeout(config.tokenTimeoutMs),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        console.warn(
          `[IOL-Bridge] Auth failed (${res.status}): ${errText.slice(0, 200)}`
        );
        cachedToken = null;
        return null;
      }

      const data = (await res.json()) as {
        access_token: string;
        expires_in?: number;
      };

      cachedToken = data.access_token;
      const lifetimeS = data.expires_in ?? DEFAULT_TOKEN_LIFETIME_S;
      tokenExpiryTimestamp = Date.now() + lifetimeS * 1000;
      lastTokenRefreshDate = new Date();

      return cachedToken;
    } catch (err) {
      console.warn(
        `[IOL-Bridge] Auth error: ${err instanceof Error ? err.message : String(err)}`
      );
      cachedToken = null;
      return null;
    } finally {
      tokenRefreshPromise = null;
    }
  })();

  return tokenRefreshPromise;
}

// ── Bridge Status ──────────────────────────────────────────────────────

/**
 * Returns the current status of the IOL bridge, including whether
 * credentials are configured and the last successful token refresh time.
 */
export function getIOLStatus(): IOLBridgeStatus {
  const credentialsConfigured = !!(
    process.env.IOL_USERNAME &&
    process.env.IOL_PASSWORD
  );

  return {
    online: cachedToken !== null && Date.now() < tokenExpiryTimestamp,
    lastTokenRefresh: lastTokenRefreshDate,
    credentialsConfigured,
  };
}

// ── Level 2 Data: Single Instrument ────────────────────────────────────

/**
 * Fetch cotización data for a single ticker from IOL.
 *
 * - Returns `IOLLevel2Data` with `iol_status: 'online'` on success.
 * - Returns `IOLLevel2Data` with `iol_status: 'no_data'` if the ticker
 *   is not listed on IOL (HTTP 404).
 * - Returns `null` if IOL is offline, auth fails, or a network error
 *   occurs.
 * - Never throws.
 */
export async function getIOLCotizacion(
  ticker: string
): Promise<IOLLevel2Data | null> {
  const token = await getIOLToken();
  if (!token) return null;

  try {
    const url = `${config.cotizacionUrl}/${encodeURIComponent(ticker)}/Cotizacion?mercado=BCBA`;

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(config.cotizacionTimeoutMs),
    });

    // ── 404 = ticker not listed on IOL ──
    if (res.status === 404) {
      return {
        iol_volume: 0,
        iol_bid: 0,
        iol_ask: 0,
        iol_avg_daily_volume: 0,
        iol_status: 'no_data',
        iol_liquidity_alert: false,
      };
    }

    if (!res.ok) {
      // Silently return offline — don't log every failed per-ticker request
      return null;
    }

    const data = (await res.json()) as IOLCotizacion;
    return parseIOLCotizacion(data);
  } catch {
    // Network / timeout / parse error — offline for this instrument
    return null;
  }
}

/**
 * Parse a raw IOLCotizacion response into our normalized IOLLevel2Data.
 */
function parseIOLCotizacion(data: IOLCotizacion): IOLLevel2Data {
  // ── Extract best bid/ask from puntas ──
  let iolBid = 0;
  let iolAsk = 0;

  if (data.puntas) {
    if (data.puntas.compra && data.puntas.compra.length > 0) {
      iolBid = safeNum(data.puntas.compra[0].precio);
    }
    if (data.puntas.venta && data.puntas.venta.length > 0) {
      iolAsk = safeNum(data.puntas.venta[0].precio);
    }
  }

  // ── Volume metrics ──
  const cantidadOperada = safeNum(data.cantidadOperada);
  const volumenNominal = safeNum(data.volumen);

  // ── Estimate average daily volume ──
  // Heuristic: project current volume across full 7-hour trading day
  let estimatedAvgDaily = 0;
  try {
    const hourAR = new Date().toLocaleString('en-US', {
      timeZone: 'America/Argentina/Buenos_Aires',
    });
    const currentHour = new Date(hourAR).getHours();
    const tradingHoursElapsed = Math.max(1, currentHour - 10); // Market opens at 10
    estimatedAvgDaily =
      volumenNominal > 0
        ? volumenNominal * (7 / tradingHoursElapsed)
        : cantidadOperada * 100 * (7 / tradingHoursElapsed);
  } catch {
    estimatedAvgDaily = volumenNominal;
  }

  // ── Liquidity alert: volume < 10% of avg daily ──
  const volumeRatio =
    estimatedAvgDaily > 0 ? volumenNominal / estimatedAvgDaily : 0;
  const liquidityAlert =
    volumeRatio < config.lowVolumeRatio && volumenNominal > 0;

  return {
    iol_volume: cantidadOperada,
    iol_bid: iolBid,
    iol_ask: iolAsk,
    iol_avg_daily_volume: Math.round(estimatedAvgDaily),
    iol_status: 'online',
    iol_liquidity_alert: liquidityAlert,
  };
}

// ── Batch Enrichment ───────────────────────────────────────────────────

/**
 * Enrich an array of LiveInstrument[] with IOL Level 2 data.
 *
 * - Processes instruments in batches of 5 with 200ms delay between
 *   batches to respect IOL rate limits.
 * - If IOL credentials are not configured, returns instruments unchanged
 *   with `iol_status: 'offline'`.
 * - Never throws.
 */
export async function enrichWithIOL(
  instruments: LiveInstrument[]
): Promise<IOLEnrichResult> {
  // ── Graceful degradation: no credentials ──
  const status = getIOLStatus();
  if (!status.credentialsConfigured) {
    return {
      enriched: instruments.map((inst) => ({
        ...inst,
        iol_status: 'offline' as const,
      })),
      iolOnline: false,
      stats: { queried: 0, success: 0, alerts: 0 },
    };
  }

  // ── Try to get token ──
  const token = await getIOLToken();
  if (!token) {
    return {
      enriched: instruments.map((inst) => ({
        ...inst,
        iol_status: 'offline' as const,
      })),
      iolOnline: false,
      stats: { queried: 0, success: 0, alerts: 0 },
    };
  }

  let iolSuccess = 0;
  let iolAlerts = 0;
  const enriched: LiveInstrument[] = [];

  // ── Process in batches ──
  for (let i = 0; i < instruments.length; i += config.batchSize) {
    const batch = instruments.slice(i, i + config.batchSize);

    const results = await Promise.allSettled(
      batch.map(async (inst) => {
        const iolData = await getIOLCotizacion(inst.ticker);
        return { inst, iolData };
      })
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const { inst, iolData } = result.value;
        if (iolData) {
          enriched.push({
            ...inst,
            iol_volume: iolData.iol_volume,
            iol_bid: iolData.iol_bid,
            iol_ask: iolData.iol_ask,
            iol_avg_daily_volume: iolData.iol_avg_daily_volume,
            iol_status: iolData.iol_status,
            iol_liquidity_alert: iolData.iol_liquidity_alert,
          });
          if (iolData.iol_status === 'online') iolSuccess++;
          if (iolData.iol_liquidity_alert) iolAlerts++;
        } else {
          enriched.push({ ...inst, iol_status: 'offline' });
        }
      } else {
        // Promise rejected — keep instrument without IOL data
        const failedInst = batch[results.indexOf(result)];
        enriched.push({ ...failedInst, iol_status: 'offline' });
      }
    }

    // ── Rate-limit delay between batches ──
    if (i + config.batchSize < instruments.length) {
      await new Promise((r) => setTimeout(r, config.batchDelayMs));
    }
  }

  return {
    enriched,
    iolOnline: iolSuccess > 0,
    stats: {
      queried: instruments.length,
      success: iolSuccess,
      alerts: iolAlerts,
    },
  };
}

// ── Reset (useful for testing) ─────────────────────────────────────────

/**
 * Clear the cached token and reset bridge state.
 * Primarily intended for testing; production code should not need this.
 */
export function resetIOLBridge(): void {
  cachedToken = null;
  tokenExpiryTimestamp = 0;
  lastTokenRefreshDate = null;
  tokenRefreshPromise = null;
}
