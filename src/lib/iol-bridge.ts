// ════════════════════════════════════════════════════════════════════════
// IOL BRIDGE — ARB//RADAR V3.2.3-PRO
// InvertirOnline authentication & Level-2 data fetching
//
// Extracted from scripts/update-prices.ts and adapted for Next.js
// API routes (server-side only).
//
// V3.2.3-PRO: Now calculates bid_depth / ask_depth / market_pressure
// from puntas_detalle order-book levels.
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

  // Return cached token if still valid (120 s safety buffer — avoid blind spots)
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
 * Automatically obtains / refreshes the Bearer token before making
 * the request.  Returns processed `IOLLevel2Data` with volume,
 * bid/ask, depth, market pressure, estimated average daily volume,
 * and liquidity alert.
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

    // Volume fields
    const cantidadOperada = data.cantidadOperada || 0;
    const volumenNominal = data.volumen || 0;

    // Estimate average daily volume:
    //   avgDaily ≈ currentNominal × (7 / tradingHoursElapsed)
    const hoursElapsed = tradingHoursElapsed();
    const estimatedAvgDaily =
      volumenNominal > 0
        ? volumenNominal * (7 / hoursElapsed)
        : cantidadOperada * 100 * (7 / hoursElapsed);

    // Liquidity alert: volume ratio < 10 % of estimated avg daily
    const volumeRatio =
      estimatedAvgDaily > 0 ? volumenNominal / estimatedAvgDaily : 0;
    const liquidityAlert =
      volumeRatio < IOL_LOW_VOLUME_PCT && volumenNominal > 0;

    // Raw puntas for depth calculations
    const puntasDetalle = data.puntas
      ? {
          compra: data.puntas.compra?.map((p) => ({ cantidad: p.cantidad, precio: p.precio })) ?? [],
          venta: data.puntas.venta?.map((p) => ({ cantidad: p.cantidad, precio: p.precio })) ?? [],
        }
      : { compra: [], venta: [] };

    // V3.2.3-PRO: Calculate depth & market pressure from puntas
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
    // Intentionally silent — per-ticker failures should not cascade
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
