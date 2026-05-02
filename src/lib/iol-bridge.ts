// ════════════════════════════════════════════════════════════════════════
// IOL BRIDGE — Shared InvertirOnline Authentication & Cotización Module
// ════════════════════════════════════════════════════════════════════════
//
// SHARED MODULE — works in both:
//   • Next.js API routes (Edge / Node runtime)
//   • Standalone Cerebro Táctico script (Node.js via tsx)
//
// Uses standard `fetch` only (no axios / node-fetch).
// Returns null on failure — NEVER throws.
//
// TOKEN LIFECYCLE:
//   IOL tokens expire at 15 minutes.
//   This module caches tokens with expiry tracking and auto-refreshes
//   at 14 minutes (60s safety buffer before expiration).
//
// VOLUME HEURISTIC:
//   If current volume is X and we're N hours into a 7h trading day,
//   estimated daily volume ≈ X × (7 / N).
// ════════════════════════════════════════════════════════════════════════

// ── Exported Types ─────────────────────────────────────────────────────

export interface IOLCotizacionResult {
  iolVolume: number;          // cantidadOperada
  iolBid: number;             // best bid from puntas
  iolAsk: number;             // best ask from puntas
  iolAvgDailyVolume: number;  // estimated average daily volume
  iolStatus: 'online' | 'offline' | 'no_data';
  iolLiquidityAlert: boolean; // volume < 10% avg daily
}

/** Internal: raw IOL token API response */
interface IOLTokenResponse {
  access_token: string;
  expires_in: number;       // seconds until expiration (typically 900 = 15min)
  token_type?: string;
  refresh_token?: string;
}

/** Internal: raw IOL cotización API response structure */
interface IOLCotizacionAPIResponse {
  titulo?: {
    simbolo: string;
    descripcion: string;
    pais: string;
    mercado: string;
    tipo: string;
  };
  ultimoPrecio?: number;
  variacion?: number;
  apertura?: number;
  maximo?: number;
  minimo?: number;
  volumen?: number;            // Notional ARS volume
  cantidadOperada?: number;    // Nominal units traded today
  puntas?: {
    compra?: Array<{ cantidad: number; precio: number }>;
    venta?: Array<{ cantidad: number; precio: number }>;
  };
}

// ── Token Cache ────────────────────────────────────────────────────────

interface CachedToken {
  token: string;
  expiresAt: number;  // Date.now() timestamp when token expires
}

/**
 * Module-level token cache keyed by username.
 * Allows multiple IOL accounts to coexist (e.g., testing vs production).
 */
const tokenCache = new Map<string, CachedToken>();

/** IOL tokens expire at 15min; we refresh at 14min (60s safety buffer). */
const REFRESH_BUFFER_MS = 60_000;

/** How long to wait for IOL API responses before timing out. */
const FETCH_TIMEOUT_MS = 10_000;

/** Low-liquidity threshold: volume < 10% of estimated avg daily → alert. */
const LOW_VOLUME_PCT = 0.10;

/** Trading day length in hours (Argentina: 10:00–17:00 = 7h). */
const TRADING_DAY_HOURS = 7;

/** Market open hour in Argentina timezone. */
const MARKET_OPEN_HOUR = 10;

// ── IOL Token Management ──────────────────────────────────────────────

/**
 * Authenticate with IOL API and return an access token.
 *
 * Uses module-level token caching: if a valid (non-expired) token exists
 * for the given username, it is returned immediately without making a
 * network request. Tokens are refreshed 60 seconds before expiration.
 *
 * @param username - IOL account email
 * @param password - IOL account password
 * @returns Access token string, or null on any failure
 */
export async function getIOLToken(
  username: string,
  password: string,
): Promise<string | null> {
  if (!username || !password) {
    console.warn('[iol-bridge] getIOLToken: username or password is empty');
    return null;
  }

  // Check cache — return early if token is still valid (with refresh buffer)
  const cached = tokenCache.get(username);
  if (cached && Date.now() < cached.expiresAt - REFRESH_BUFFER_MS) {
    return cached.token;
  }

  // Authenticate with IOL
  try {
    const params = new URLSearchParams({
      username,
      password,
      grant_type: 'password',
    });

    const res = await fetch('https://api.invertironline.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.warn(
        `[iol-bridge] getIOLToken: IOL auth failed (${res.status}): ${errText.slice(0, 200)}`,
      );
      return null;
    }

    const data = (await res.json()) as IOLTokenResponse;

    if (!data.access_token) {
      console.warn('[iol-bridge] getIOLToken: IOL response missing access_token');
      return null;
    }

    // Cache the token with its expiration time
    const expiresIn = (data.expires_in || 900) * 1000; // default 15min if not provided
    const expiresAt = Date.now() + expiresIn;

    tokenCache.set(username, { token: data.access_token, expiresAt });

    const validMin = Math.round((data.expires_in || 900) / 60);
    console.log(
      `[iol-bridge] getIOLToken: token obtained for ${username.slice(0, 3)}***, valid for ~${validMin}min`,
    );

    return data.access_token;
  } catch (error) {
    console.warn(
      `[iol-bridge] getIOLToken: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

/**
 * Force-clear the cached token for a given username.
 * Useful when a 401 is received mid-session and a fresh login is needed.
 */
export function clearIOLToken(username: string): void {
  tokenCache.delete(username);
}

// ── IOL Cotización Query ──────────────────────────────────────────────

/**
 * Get real-time cotización data for a ticker from IOL.
 *
 * @param token  - Valid IOL access token (from getIOLToken)
 * @param ticker - Instrument ticker symbol (e.g. "T15J7", "LECAP4J25")
 * @returns Parsed cotización result, or null on any failure
 */
export async function getIOLCotizacion(
  token: string,
  ticker: string,
): Promise<IOLCotizacionResult | null> {
  if (!token || !ticker) {
    console.warn('[iol-bridge] getIOLCotizacion: token or ticker is empty');
    return null;
  }

  try {
    const url = `https://api.invertironline.com/api/v2/Titulos/${encodeURIComponent(ticker)}/Cotizacion?mercado=BCBA`;

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(5_000),
    });

    // 404 = ticker not listed on IOL (some instruments aren't available)
    if (res.status === 404) {
      return {
        iolVolume: 0,
        iolBid: 0,
        iolAsk: 0,
        iolAvgDailyVolume: 0,
        iolStatus: 'no_data',
        iolLiquidityAlert: false,
      };
    }

    if (!res.ok) {
      console.warn(
        `[iol-bridge] getIOLCotizacion: IOL cotización failed for ${ticker} (${res.status})`,
      );
      return null;
    }

    const data = (await res.json()) as IOLCotizacionAPIResponse;

    // Extract best bid/ask from puntas (order book)
    let iolBid = 0;
    let iolAsk = 0;

    if (data.puntas) {
      // Bid = best (highest) compra price
      if (data.puntas.compra && data.puntas.compra.length > 0) {
        iolBid = data.puntas.compra[0].precio;
      }
      // Ask = best (lowest) venta price
      if (data.puntas.venta && data.puntas.venta.length > 0) {
        iolAsk = data.puntas.venta[0].precio;
      }
    }

    // cantidadOperada = number of nominal units traded today
    const cantidadOperada = data.cantidadOperada || 0;
    const volumenNominal = data.volumen || 0; // Notional ARS volume

    // ── Volume estimation heuristic ──
    // If current volume is X and we're N hours into a 7h trading day,
    // estimated daily volume ≈ X × (7 / N).
    const estimatedAvgDaily = estimateDailyVolume(cantidadOperada, volumenNominal);

    // Filtro de Verdad: volume < 10% of avg daily → liquidity alert
    const volumeRatio =
      estimatedAvgDaily > 0 ? volumenNominal / estimatedAvgDaily : 0;
    const liquidityAlert = volumeRatio < LOW_VOLUME_PCT && volumenNominal > 0;

    return {
      iolVolume: cantidadOperada,
      iolBid,
      iolAsk,
      iolAvgDailyVolume: Math.round(estimatedAvgDaily),
      iolStatus: 'online',
      iolLiquidityAlert: liquidityAlert,
    };
  } catch (error) {
    console.warn(
      `[iol-bridge] getIOLCotizacion: failed for ${ticker} — ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

// ── Volume Estimation Heuristic ────────────────────────────────────────

/**
 * Estimate the total daily volume by extrapolating current volume
 * across the full trading day.
 *
 * Formula: estimated daily ≈ currentVolume × (TRADING_DAY_HOURS / hoursElapsed)
 *
 * Falls back gracefully if outside market hours:
 *   - Before market open → assume 1 hour elapsed (conservative)
 *   - After market close → assume full day elapsed (no extrapolation)
 *
 * @param cantidadOperada - Nominal units traded today
 * @param volumenNominal  - Notional ARS volume traded today
 * @returns Estimated total daily volume in notional ARS
 */
function estimateDailyVolume(
  cantidadOperada: number,
  volumenNominal: number,
): number {
  // Determine how many hours of the trading day have elapsed
  const hoursElapsed = getTradingHoursElapsed();

  if (volumenNominal > 0) {
    return volumenNominal * (TRADING_DAY_HOURS / hoursElapsed);
  }

  // Fallback: rough estimate from cantidadOperada × assumed price
  // This is a very rough heuristic when volumenNominal is not available
  if (cantidadOperada > 0) {
    // Assume ~100 ARS per nominal unit as a conservative multiplier
    return cantidadOperada * 100 * (TRADING_DAY_HOURS / hoursElapsed);
  }

  return 0;
}

/**
 * Determine how many hours have elapsed in the current trading day.
 * Uses Argentina timezone (America/Argentina/Buenos_Aires).
 *
 * @returns Hours elapsed (clamped to [1, TRADING_DAY_HOURS])
 */
function getTradingHoursElapsed(): number {
  try {
    // Use Intl for timezone-safe hour calculation (works in both Node & Edge)
    const arTimeString = new Date().toLocaleString('en-US', {
      timeZone: 'America/Argentina/Buenos_Aires',
    });
    const currentHour = new Date(arTimeString).getHours();

    // How many hours since market open (10:00)
    const hoursSinceOpen = currentHour - MARKET_OPEN_HOUR;

    // Clamp: before open → 1 (conservative), after close → full day
    if (hoursSinceOpen < 1) return 1;
    if (hoursSinceOpen >= TRADING_DAY_HOURS) return TRADING_DAY_HOURS;

    return hoursSinceOpen;
  } catch {
    // If timezone detection fails, assume mid-day (conservative default)
    return Math.ceil(TRADING_DAY_HOURS / 2);
  }
}

// ── Convenience: Combined Auth + Cotización ───────────────────────────

/**
 * One-shot helper: authenticate with IOL and fetch cotización.
 *
 * This is a convenience wrapper for the common pattern of:
 *   1. Get token (or use cached)
 *   2. Fetch cotización
 *
 * @param username - IOL account email
 * @param password - IOL account password
 * @param ticker   - Instrument ticker to query
 * @returns Cotización result, or null on any failure (auth or fetch)
 */
export async function getIOLCotizacionWithAuth(
  username: string,
  password: string,
  ticker: string,
): Promise<IOLCotizacionResult | null> {
  const token = await getIOLToken(username, password);
  if (!token) return null;

  const result = await getIOLCotizacion(token, ticker);

  // If we got a 401-style failure, try once more with a fresh token
  // (the cached token might have just expired between calls)
  if (result === null) {
    clearIOLToken(username);
    const freshToken = await getIOLToken(username, password);
    if (!freshToken) return null;
    return getIOLCotizacion(freshToken, ticker);
  }

  return result;
}
