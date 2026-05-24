// ════════════════════════════════════════════════════════════════════════
// IOL BRIDGE — ARB//RADAR V4.0 BLINDADO
// InvertirOnline authentication & Level-2 data fetching
//
// V4.0 ARCHITECTURE:
//   - Credentials come from .env (IOL_USERNAME, IOL_PASSWORD)
//   - If credentials exist, bridge MUST connect. Period.
//   - Circuit breaker prevents brute-force lockout (3→30min, 5→hard lock)
//   - Token auto-refreshes at 12 min (IOL expires at 15 min)
//   - All credential parsing handles special characters (#, $, !, etc.)
//
// ⚠️  SERVER-SIDE MODULE — never import in client components.
// ════════════════════════════════════════════════════════════════════════

// ── Constants ──────────────────────────────────────────────────────────

const IOL_TOKEN_URL = 'https://api.invertironline.com/token';
const IOL_COTIZACION_URL = 'https://api.invertironline.com/api/v2/Titulos';

/** IOL token expires at 15 min; we refresh at 12 min to avoid blind spots. */
const IOL_TOKEN_REFRESH_MS = 12 * 60 * 1000;

/** 10 % of average daily volume → "Baja Liquidez" threshold */
const IOL_LOW_VOLUME_PCT = 0.10;

/** Request timeout for token endpoint (ms) */
const TOKEN_TIMEOUT_MS = 15_000;

/** Request timeout for cotización endpoint (ms) */
const COTIZACION_TIMEOUT_MS = 8_000;

// ── Types ──────────────────────────────────────────────────────────────

/** Raw IOL cotización response from the API. */
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

/** Raw punta entry from IOL order book. */
export interface IOLPunta {
  cantidad: number;
  precio: number;
}

/** Processed Level-2 data returned by getIOLCotizacion(). */
export interface IOLLevel2Data {
  iol_volume: number;
  iol_bid: number;
  iol_ask: number;
  iol_avg_daily_volume: number;
  iol_status: 'online' | 'offline' | 'no_data';
  iol_liquidity_alert: boolean;
  /** Total quantity across all compra puntas — bid depth. */
  iol_bid_depth: number;
  /** Total quantity across all venta puntas — ask depth. */
  iol_ask_depth: number;
  /** bid_depth / ask_depth ratio (>1 = buying pressure). */
  iol_market_pressure: number;
  /** Raw order-book levels for detailed display / depth calculation. */
  puntas_detalle?: {
    compra: IOLPunta[];
    venta: IOLPunta[];
  };
}

/** Diagnostic info for the IOL status endpoint. */
export interface IOLDiagnostic {
  credentials_configured: boolean;
  username_present: boolean;
  password_present: boolean;
  username_length: number;
  password_length: number;
  token_cached: boolean;
  token_expires_at: string | null;
  iol_available: boolean;
  circuit_breaker: {
    failures: number;
    locked: boolean;
    backoff_until: string | null;
  };
  last_auth_error: string | null;
  last_auth_status: number | null;
}

// ── Module-level token cache ──────────────────────────────────────────

let iolAccessToken: string | null = null;
let iolTokenExpiry: number = 0;
let iolAvailable = false;

// ── Circuit Breaker ──────────────────────────────────────────────────
let consecutiveAuthFailures = 0;
let circuitBreakerUntil = 0;
let lastAuthError: string | null = null;
let lastAuthStatus: number | null = null;
const CB_MAX_RETRIES = 3;
const CB_HARD_LOCK = 5;
const CB_BACKOFF_MS = 30 * 60 * 1000; // 30 minutes

// ── Credential Parsing ──────────────────────────────────────────────

/**
 * Get IOL credentials from environment.
 * Handles the case where .env values might be quoted or unquoted.
 * The .env loader (dotenv) strips quotes, so by the time we read
 * process.env, the values should be clean.
 */
function getCredentials(): { username: string; password: string } {
  let username = process.env.IOL_USERNAME || '';
  let password = process.env.IOL_PASSWORD || '';

  // Strip surrounding whitespace (common .env mistake)
  username = username.trim();
  password = password.trim();

  // Strip surrounding quotes if dotenv didn't already remove them
  // (belt-and-suspenders: some environments don't strip quotes)
  if ((username.startsWith('"') && username.endsWith('"')) || (username.startsWith("'") && username.endsWith("'"))) {
    username = username.slice(1, -1);
  }
  if ((password.startsWith('"') && password.endsWith('"')) || (password.startsWith("'") && password.endsWith("'"))) {
    password = password.slice(1, -1);
  }

  return { username, password };
}

// ── Helpers ────────────────────────────────────────────────────────────

function tradingHoursElapsed(): number {
  const now = new Date();
  const arTime = new Date(
    now.toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }),
  );
  return Math.max(1, arTime.getHours() - 10);
}

function calcDepth(levels: IOLPunta[]): number {
  if (!levels || levels.length === 0) return 0;
  return levels.reduce((sum, p) => sum + (p.cantidad || 0), 0);
}

function calcMarketPressure(bidDepth: number, askDepth: number): number {
  if (bidDepth === 0 && askDepth === 0) return 0;
  if (askDepth === 0) return bidDepth > 0 ? 99 : 0;
  const ratio = bidDepth / askDepth;
  return parseFloat(ratio.toFixed(2));
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Authenticate with the IOL API and return an access token.
 * If credentials exist in .env, this MUST succeed.
 */
export async function getIOLToken(): Promise<string | null> {
  const { username, password } = getCredentials();

  if (!username || !password) {
    iolAvailable = false;
    lastAuthError = 'Credentials not configured in .env (IOL_USERNAME / IOL_PASSWORD are empty)';
    return null;
  }

  // Circuit breaker: check if we're in cooldown
  if (circuitBreakerUntil > Date.now()) {
    return null;
  }

  // Hard lock: too many failures
  if (consecutiveAuthFailures >= CB_HARD_LOCK) {
    console.error(
      `[iol-bridge] 🔒 CIRCUIT BREAKER LOCKED — ${consecutiveAuthFailures} consecutive auth failures. ` +
      `Call resetIOLState() or fix credentials in .env to retry.`
    );
    iolAvailable = false;
    return null;
  }

  // Return cached token if still valid
  if (iolAccessToken && Date.now() < iolTokenExpiry - 120_000) {
    return iolAccessToken;
  }

  try {
    // Build the form data — this is the standard IOL auth flow
    const params = new URLSearchParams();
    params.append('username', username);
    params.append('password', password);
    params.append('grant_type', 'password');

    console.log(`[iol-bridge] Attempting auth for user: ${username.substring(0, 3)}***@*** (pass length: ${password.length})`);

    const res = await fetch(IOL_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    });

    lastAuthStatus = res.status;

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      consecutiveAuthFailures++;
      lastAuthError = `HTTP ${res.status}: ${errText.substring(0, 200)}`;

      if (consecutiveAuthFailures >= CB_HARD_LOCK) {
        console.error(
          `[iol-bridge] 🔒 CIRCUIT BREAKER HARD LOCK — ${consecutiveAuthFailures} failures. ` +
          `IOL DISABLED until manual resetIOLState().`
        );
        circuitBreakerUntil = Infinity;
      } else if (consecutiveAuthFailures >= CB_MAX_RETRIES) {
        circuitBreakerUntil = Date.now() + CB_BACKOFF_MS;
        console.error(
          `[iol-bridge] ⚠️ CIRCUIT BREAKER BACKOFF — ${consecutiveAuthFailures} failures. ` +
          `Backing off for 30 min. Auth failed (${res.status}): ${errText.substring(0, 100)}`
        );
      } else {
        console.error(
          `[iol-bridge] Auth failed (${res.status}): ${errText.substring(0, 100)} ` +
          `[attempt ${consecutiveAuthFailures}/${CB_HARD_LOCK}]`
        );
      }

      iolAvailable = false;
      return null;
    }

    const data = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };

    if (!data.access_token) {
      consecutiveAuthFailures++;
      lastAuthError = 'Token response missing access_token field';
      iolAvailable = false;
      return null;
    }

    iolAccessToken = data.access_token;
    iolTokenExpiry = Date.now() + (data.expires_in || 900) * 1000;
    iolAvailable = true;
    lastAuthError = null;
    lastAuthStatus = 200;

    // Reset circuit breaker on success
    if (consecutiveAuthFailures > 0) {
      console.log(`[iol-bridge] ✅ Auth restored after ${consecutiveAuthFailures} previous failures — circuit breaker reset`);
      consecutiveAuthFailures = 0;
      circuitBreakerUntil = 0;
    } else {
      console.log(`[iol-bridge] ✅ Auth successful — token cached for ${data.expires_in || 900}s`);
    }

    return iolAccessToken;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    lastAuthError = `Network error: ${errMsg}`;
    console.error(`[iol-bridge] Auth error: ${errMsg}`);
    iolAvailable = false;
    return null;
  }
}

/**
 * Fetch cotización (Level-2) data for a specific ticker from IOL.
 */
export async function getIOLCotizacion(
  ticker: string,
): Promise<IOLLevel2Data | null> {
  const token = await getIOLToken();
  if (!token) return null;

  try {
    const url = `${IOL_COTIZACION_URL}/${encodeURIComponent(ticker)}/Cotizacion?mercado=BCBA`;

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(COTIZACION_TIMEOUT_MS),
    });

    if (!res.ok) {
      // 404 = ticker not listed on IOL
      if (res.status === 404) {
        return {
          iol_volume: 0,
          iol_bid: 0,
          iol_ask: 0,
          iol_avg_daily_volume: 0,
          iol_status: 'no_data',
          iol_liquidity_alert: false,
          iol_bid_depth: 0,
          iol_ask_depth: 0,
          iol_market_pressure: 0,
          puntas_detalle: { compra: [], venta: [] },
        };
      }
      return null;
    }

    const data = (await res.json()) as IOLCotizacion;

    // Best bid / ask from puntas (order book)
    let iolBid = 0;
    let iolAsk = 0;
    if (data.puntas) {
      if (data.puntas.compra?.length) {
        iolBid = data.puntas.compra[0].precio;
      }
      if (data.puntas.venta?.length) {
        iolAsk = data.puntas.venta[0].precio;
      }
    }

    const cantidadOperada = data.cantidadOperada || 0;
    const volumenNominal = data.volumen || 0;
    const hoursElapsed = tradingHoursElapsed();
    const estimatedAvgDaily =
      volumenNominal > 0
        ? volumenNominal * (7 / hoursElapsed)
        : cantidadOperada * 100 * (7 / hoursElapsed);

    const volumeRatio =
      estimatedAvgDaily > 0 ? volumenNominal / estimatedAvgDaily : 0;
    const liquidityAlert =
      volumeRatio < IOL_LOW_VOLUME_PCT && volumenNominal > 0;

    const puntasDetalle = data.puntas
      ? {
          compra: data.puntas.compra?.map((p) => ({ cantidad: p.cantidad, precio: p.precio })) ?? [],
          venta: data.puntas.venta?.map((p) => ({ cantidad: p.cantidad, precio: p.precio })) ?? [],
        }
      : { compra: [], venta: [] };

    const bidDepth = calcDepth(puntasDetalle.compra);
    const askDepth = calcDepth(puntasDetalle.venta);
    const marketPressure = calcMarketPressure(bidDepth, askDepth);

    return {
      iol_volume: cantidadOperada,
      iol_bid: iolBid,
      iol_ask: iolAsk,
      iol_avg_daily_volume: Math.round(estimatedAvgDaily),
      iol_status: 'online',
      iol_liquidity_alert: liquidityAlert,
      iol_bid_depth: bidDepth,
      iol_ask_depth: askDepth,
      iol_market_pressure: marketPressure,
      puntas_detalle: puntasDetalle,
    };
  } catch {
    return null;
  }
}

/**
 * Check whether IOL credentials are configured and the token is valid.
 */
export function isIOLAvailable(): boolean {
  const { username, password } = getCredentials();
  if (!username || !password) return false;
  return iolAvailable;
}

/**
 * Check if IOL credentials exist in .env (regardless of auth state).
 */
export function iolCredentialsExist(): boolean {
  const { username, password } = getCredentials();
  return !!(username && password);
}

/**
 * Reset IOL connection state — allows re-authentication after a failure.
 */
export function resetIOLState(): void {
  iolAccessToken = null;
  iolTokenExpiry = 0;
  iolAvailable = false;
  consecutiveAuthFailures = 0;
  circuitBreakerUntil = 0;
  lastAuthError = null;
  lastAuthStatus = null;
  console.log('[iol-bridge] State reset — circuit breaker cleared, ready to retry');
}

/**
 * Get full diagnostic info about IOL state.
 * Used by the /api/iol-status endpoint to show the user exactly what's wrong.
 */
export function getIOLDiagnostic(): IOLDiagnostic {
  const { username, password } = getCredentials();
  const cbStatus = getIOLCircuitBreakerStatus();

  return {
    credentials_configured: !!(username && password),
    username_present: !!username,
    password_present: !!password,
    username_length: username.length,
    password_length: password.length,
    token_cached: !!iolAccessToken,
    token_expires_at: iolTokenExpiry > 0 ? new Date(iolTokenExpiry).toISOString() : null,
    iol_available: iolAvailable,
    circuit_breaker: cbStatus,
    last_auth_error: lastAuthError,
    last_auth_status: lastAuthStatus,
  };
}

/**
 * Get circuit breaker status for diagnostics.
 */
export function getIOLCircuitBreakerStatus(): {
  failures: number;
  locked: boolean;
  backoff_until: string | null;
} {
  return {
    failures: consecutiveAuthFailures,
    locked: consecutiveAuthFailures >= CB_HARD_LOCK,
    backoff_until: circuitBreakerUntil > 0 && circuitBreakerUntil < Infinity ? new Date(circuitBreakerUntil).toISOString() : null,
  };
}
