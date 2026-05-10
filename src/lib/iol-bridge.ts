// ════════════════════════════════════════════════════════════════════════
// IOL BRIDGE — ARB//RADAR V3.5 (The Price Action Engine)
// InvertirOnline authentication & Level-2 data fetching
//
// V3.5 CHANGES:
// - Case-insensitive key normalization for IOL JSON responses
//   (handles 'Puntas'/'puntas', 'Compra'/'compra', etc.)
// - Separated volume fields: iol_volume_notional (ARS monto) vs
//   iol_volume_qty (cantidad de títulos)
// - iol_volume_notional is the PRIMARY volume for cross-asset comparison
// - Robust fallback: if IOL is offline, returns null instead of zeros
//   to avoid overwriting valid data from other sources
//
// ⚠️  SERVER-SIDE MODULE — never import in client components.
//
// ENV VARS:
//   IOL_USERNAME  → InvertirOnline email
//   IOL_PASSWORD  → InvertirOnline password
// ════════════════════════════════════════════════════════════════════════

// ── Constants ──────────────────────────────────────────────────────────

const IOL_TOKEN_URL = 'https://api.invertironline.com/token';
const IOL_COTIZACION_URL = 'https://api.invertironline.com/api/v2/Titulos';

/** IOL token expires at 15 min; we refresh at 12 min to avoid blind spots. */
const IOL_TOKEN_REFRESH_MS = 12 * 60 * 1000;

/** 10 % of average daily volume → "Baja Liquidez" threshold */
const IOL_LOW_VOLUME_PCT = 0.10;

/** Request timeout for token endpoint (ms) */
const TOKEN_TIMEOUT_MS = 10_000;

/** Request timeout for cotización endpoint (ms) */
const COTIZACION_TIMEOUT_MS = 5_000;

// ── Case-Insensitive Key Normalization ─────────────────────────────────

/**
 * Recursively normalize all keys in an object to lowercase.
 * This handles IOL API inconsistencies like:
 *   'Puntas' / 'puntas' / 'PUNTAS'
 *   'Compra' / 'compra' / 'COMPRA'
 *   'ultimoPrecio' / 'UltimoPrecio'
 *   'cantidadOperada' / 'CantidadOperada'
 *
 * After normalization, all keys are lowercase, so we can safely
 * access them with consistent lowercase property names.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeKeys(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(normalizeKeys);
  if (typeof obj === 'object') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: Record<string, any> = {};
    for (const key of Object.keys(obj)) {
      result[key.toLowerCase()] = normalizeKeys(obj[key]);
    }
    return result;
  }
  return obj;
}

// ── Types ──────────────────────────────────────────────────────────────

/**
 * Normalized IOL cotización response (all keys lowercase).
 * The raw IOL API can return keys in various casings (Puntas/puntas,
 * Compra/compra, etc.), so we normalize before typing.
 */
export interface IOLCotizacionNormalized {
  titulo: {
    simbolo: string;
    descripcion: string;
    pais: string;
    mercado: string;
    tipo: string;
  };
  ultimoprecio: number;
  variacion: number;
  apertura: number;
  maximo: number;
  minimo: number;
  volumen: number;            // Monto total operado en ARS (NOTIONAL)
  cantidadoperada: number;    // Cantidad de títulos operados (QTY)
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
  /** V3.5: Monto total operado en ARS — PRIMARY volume for cross-asset comparison */
  iol_volume_notional: number;
  /** V3.5: Cantidad de títulos operados — informational only */
  iol_volume_qty: number;
  /** @deprecated Use iol_volume_notional for ARS volume or iol_volume_qty for quantity */
  iol_volume: number;  // kept for backward compat = iol_volume_qty (original behavior)
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

// ── Module-level token cache ──────────────────────────────────────────

let iolAccessToken: string | null = null;
let iolTokenExpiry: number = 0;
let iolAvailable = false;

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Get current trading hours elapsed in Argentina timezone.
 * Market opens at 10:00, closes at 17:00 (7 hours total).
 */
function tradingHoursElapsed(): number {
  const now = new Date();
  const arTime = new Date(
    now.toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }),
  );
  return Math.max(1, arTime.getHours() - 10);
}

/**
 * Calculate total quantity across all order book levels.
 */
function calcDepth(levels: IOLPunta[]): number {
  if (!levels || levels.length === 0) return 0;
  return levels.reduce((sum, p) => sum + (p.cantidad || 0), 0);
}

/**
 * Calculate market pressure ratio from bid/ask depth.
 *   > 1 → buying pressure (more bid depth)
 *   = 1 → balanced
 *   < 1 → selling pressure (more ask depth)
 */
function calcMarketPressure(bidDepth: number, askDepth: number): number {
  if (bidDepth === 0 && askDepth === 0) return 0;
  if (askDepth === 0) return bidDepth > 0 ? 99 : 0;
  const ratio = bidDepth / askDepth;
  return parseFloat(ratio.toFixed(2));
}

/**
 * Extract puntas from the normalized IOL response.
 * Handles both 'puntas' and 'Puntas' keys after normalization.
 */
function extractPuntas(data: IOLCotizacionNormalized): {
  compra: IOLPunta[];
  venta: IOLPunta[];
} {
  const puntas = data.puntas;
  if (!puntas) return { compra: [], venta: [] };

  // After normalizeKeys, keys are lowercase, so 'compra' and 'venta'
  const compra: IOLPunta[] = Array.isArray(puntas.compra)
    ? puntas.compra.map((p: { cantidad: number; precio: number }) => ({
        cantidad: Number(p.cantidad) || 0,
        precio: Number(p.precio) || 0,
      }))
    : [];

  const venta: IOLPunta[] = Array.isArray(puntas.venta)
    ? puntas.venta.map((p: { cantidad: number; precio: number }) => ({
        cantidad: Number(p.cantidad) || 0,
        precio: Number(p.precio) || 0,
      }))
    : [];

  return { compra, venta };
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Authenticate with the IOL API and return an access token.
 *
 * Uses `IOL_USERNAME` / `IOL_PASSWORD` env vars.  The token is cached
 * at module level and auto-refreshed when it approaches expiry
 * (refresh at 12 min, token expires at 15 min).
 *
 * @returns The Bearer access token, or `null` if credentials are missing
 *          or authentication failed.
 */
export async function getIOLToken(): Promise<string | null> {
  const username = process.env.IOL_USERNAME;
  const password = process.env.IOL_PASSWORD;

  if (!username || !password) {
    iolAvailable = false;
    return null;
  }

  // Return cached token if still valid (120 s safety buffer)
  if (iolAccessToken && Date.now() < iolTokenExpiry - 120_000) {
    return iolAccessToken;
  }

  try {
    const params = new URLSearchParams({
      username,
      password,
      grant_type: 'password',
    });

    const res = await fetch(IOL_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error(
        `[iol-bridge] Auth failed (${res.status}): ${errText}`,
      );
      iolAvailable = false;
      return null;
    }

    const data = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };

    iolAccessToken = data.access_token;
    iolTokenExpiry = Date.now() + (data.expires_in || 900) * 1000;
    iolAvailable = true;

    return iolAccessToken;
  } catch (error) {
    console.error(
      `[iol-bridge] Auth error: ${error instanceof Error ? error.message : String(error)}`,
    );
    iolAvailable = false;
    return null;
  }
}

/**
 * Fetch cotización (Level-2) data for a specific ticker from IOL.
 *
 * V3.5 KEY CHANGES:
 * 1. Case-insensitive key normalization via normalizeKeys()
 * 2. Clear separation of iol_volume_notional (ARS) vs iol_volume_qty (títulos)
 * 3. If IOL is offline/closed, returns null (not zeros) so callers can
 *    preserve existing valid data from other sources
 *
 * @param ticker - Instrument ticker (e.g. "T5W3" or "LECAPX9S").
 * @returns `IOLLevel2Data` with status, or `null` on unrecoverable error.
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
      // 404 = ticker not listed on IOL — return no_data sentinel
      if (res.status === 404) {
        return {
          iol_volume_notional: 0,
          iol_volume_qty: 0,
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
      // Other errors (rate limit, server error) → return null so caller
      // preserves existing data instead of overwriting with zeros
      return null;
    }

    const rawData = await res.json();

    // V3.5: Normalize all keys to lowercase for case-insensitive access
    const data = normalizeKeys(rawData) as IOLCotizacionNormalized;

    // ── Volume fields (V3.5: clearly separated) ──────────────────────
    // IOL API: 'volumen' = Monto total operado en ARS (NOTIONAL)
    // IOL API: 'cantidadoperada' = Cantidad de títulos operados (QTY)
    const volumenNotionalARS = Number(data.volumen) || 0;        // ARS monto
    const cantidadOperadaQty = Number(data.cantidadoperada) || 0; // títulos

    // Best bid / ask from puntas (order book) — case-insensitive access
    const puntas = extractPuntas(data);
    let iolBid = 0;
    let iolAsk = 0;
    if (puntas.compra.length > 0) {
      iolBid = puntas.compra[0].precio;
    }
    if (puntas.venta.length > 0) {
      iolAsk = puntas.venta[0].precio;
    }

    // Estimate average daily volume:
    //   avgDaily ≈ currentNotional × (7 / tradingHoursElapsed)
    // V3.5: Use notional ARS for avg daily (cross-asset comparable)
    const hoursElapsed = tradingHoursElapsed();
    const estimatedAvgDaily =
      volumenNotionalARS > 0
        ? volumenNotionalARS * (7 / hoursElapsed)
        : cantidadOperadaQty * 100 * (7 / hoursElapsed);

    // Liquidity alert: volume ratio < 10 % of estimated avg daily
    const volumeRatio =
      estimatedAvgDaily > 0 ? volumenNotionalARS / estimatedAvgDaily : 0;
    const liquidityAlert =
      volumeRatio < IOL_LOW_VOLUME_PCT && volumenNotionalARS > 0;

    // V3.2.3-PRO: Calculate depth & market pressure from puntas
    const bidDepth = calcDepth(puntas.compra);
    const askDepth = calcDepth(puntas.venta);
    const marketPressure = calcMarketPressure(bidDepth, askDepth);

    return {
      // V3.5: Primary volume fields — clearly separated
      iol_volume_notional: volumenNotionalARS,     // ARS — use for radar VOL column
      iol_volume_qty: cantidadOperadaQty,           // Títulos — informational
      iol_volume: cantidadOperadaQty,               // Backward compat (original behavior)
      iol_bid: iolBid,
      iol_ask: iolAsk,
      iol_avg_daily_volume: Math.round(estimatedAvgDaily),
      iol_status: 'online',
      iol_liquidity_alert: liquidityAlert,
      iol_bid_depth: bidDepth,
      iol_ask_depth: askDepth,
      iol_market_pressure: marketPressure,
      puntas_detalle: puntas,
    };
  } catch {
    // V3.5: Return null (not zeros) so caller can preserve existing data
    // This is the KEY robustness fix for weekends/off-hours
    return null;
  }
}

/**
 * Check whether IOL credentials are configured and the token is valid.
 *
 * @returns `true` if credentials exist and the last token fetch succeeded.
 */
export function isIOLAvailable(): boolean {
  if (!process.env.IOL_USERNAME || !process.env.IOL_PASSWORD) {
    return false;
  }
  return iolAvailable;
}

/**
 * Reset IOL connection state — allows re-authentication after a failure.
 * Useful for recovery from transient auth errors.
 */
export function resetIOLState(): void {
  iolAccessToken = null;
  iolTokenExpiry = 0;
  iolAvailable = false;
}