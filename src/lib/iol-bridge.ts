// ════════════════════════════════════════════════════════════════════════
// IOL BRIDGE — ARB//RADAR V3.5 (The Price Action Engine)
// InvertirOnline authentication & Level-2 data fetching
//
// Extracted from scripts/update-prices.ts and adapted for Next.js
// API routes (server-side only).
//
// V3.5 CHANGES:
// 1. Case-insensitive key normalizer for IOL JSON responses
//    (handles 'Puntas'/'puntas', 'Compra'/'compra', etc.)
// 2. Separated iol_volume_notional (ARS monto) from iol_volume_qty (títulos)
//    → Radar prioritizes iol_volume_notional for cross-asset comparison
// 3. Fixed avg daily volume to use notional ARS consistently
// 4. Backward compat: iol_volume = iol_volume_notional (deprecated alias)
//
// V3.2.3-PRO: Calculates bid_depth / ask_depth / market_pressure
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

// ── Case-Insensitive Key Normalizer ─────────────────────────────────────

/**
 * Recursively normalize all keys in an object to lowercase.
 *
 * IOL's API is inconsistent with key casing:
 *   'Puntas' vs 'puntas', 'Compra' vs 'compra', 'UltimoPrecio' vs 'ultimoPrecio'
 *
 * This function walks the entire JSON tree and lowercases every key,
 * so downstream code can safely access `data.puntas.compra[0].precio`
 * regardless of the casing IOL returns.
 *
 * Handles: plain objects, arrays, primitives (pass-through).
 */
function normalizeKeys(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(normalizeKeys);
  if (typeof obj === 'object') {
    const result: Record<string, any> = {};
    for (const key of Object.keys(obj)) {
      result[key.toLowerCase()] = normalizeKeys(obj[key]);
    }
    return result;
  }
  return obj; // primitive — return as-is
}

// ── Types ──────────────────────────────────────────────────────────────

/**
 * Normalized IOL cotización response (all keys lowercased).
 *
 * After `normalizeKeys()`, the IOL JSON is guaranteed to have these keys
 * in lowercase, regardless of what casing the API returned.
 */
export interface IOLCotizacion {
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
  /** Monto total operado en ARS (notional volume) */
  volumen: number;
  /** Cantidad de títulos operados (quantity of bonds/notes traded) */
  cantidadoperada: number;
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

/**
 * Processed Level-2 data returned by getIOLCotizacion().
 *
 * V3.5: Volume fields are now clearly separated:
 *   - iol_volume_notional → Monto total en ARS (from IOL `volumen`)
 *   - iol_volume_qty      → Cantidad de títulos (from IOL `cantidadOperada`)
 *   - iol_volume          → DEPRECATED alias for iol_volume_notional
 *
 * The radar must prioritize iol_volume_notional for cross-asset comparison,
 * since nominal ARS volume normalizes across different price levels.
 */
export interface IOLLevel2Data {
  /** @deprecated Use iol_volume_notional instead. Kept for backward compat. */
  iol_volume: number;
  /** Monto total operado en ARS (notional volume) — PRIORITIZED for comparison */
  iol_volume_notional: number;
  /** Cantidad de títulos operados (qty of instruments traded) */
  iol_volume_qty: number;
  iol_bid: number;
  iol_ask: number;
  /** Estimated average daily volume in ARS notional */
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
 * Safely extract puntas from a normalized IOL response.
 *
 * IOL may return puntas as:
 *   { puntas: { compra: [...], venta: [...] } }
 * or sometimes with different nesting. After normalizeKeys(),
 * we can safely access lowercase keys.
 */
function extractPuntas(normalizedData: any): { compra: IOLPunta[]; venta: IOLPunta[] } {
  const empty = { compra: [] as IOLPunta[], venta: [] as IOLPunta[] };

  if (!normalizedData || typeof normalizedData !== 'object') return empty;

  // Direct puntas field
  const puntas = normalizedData.puntas;
  if (puntas && typeof puntas === 'object') {
    const compra = Array.isArray(puntas.compra)
      ? puntas.compra.map((p: IOLPunta) => ({ cantidad: Number(p.cantidad) || 0, precio: Number(p.precio) || 0 }))
      : [];
    const venta = Array.isArray(puntas.venta)
      ? puntas.venta.map((p: IOLPunta) => ({ cantidad: Number(p.cantidad) || 0, precio: Number(p.precio) || 0 }))
      : [];
    return { compra, venta };
  }

  return empty;
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
 * V3.5: The raw JSON from IOL is now normalized via `normalizeKeys()`
 * before processing, so all key accesses are case-insensitive.
 *
 * Volume is now separated into:
 *   - iol_volume_notional: Monto total en ARS (from IOL `volumen`)
 *   - iol_volume_qty: Cantidad de títulos (from IOL `cantidadOperada`)
 *
 * The avg daily volume estimation uses notional ARS consistently.
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
          iol_volume_notional: 0,
          iol_volume_qty: 0,
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

    // ── V3.5: Normalize ALL keys to lowercase before processing ────
    // This handles IOL's inconsistent casing: 'Puntas'/'puntas',
    // 'Compra'/'compra', 'UltimoPrecio'/'ultimoPrecio', etc.
    const rawData = await res.json();
    const data = normalizeKeys(rawData) as IOLCotizacion;

    // ── Extract puntas using case-insensitive normalized data ───────
    const puntasExtraidas = extractPuntas(data);

    // Best bid / ask from puntas (order book)
    let iolBid = 0;
    let iolAsk = 0;
    if (puntasExtraidas.compra.length > 0) {
      iolBid = puntasExtraidas.compra[0].precio;
    }
    if (puntasExtraidas.venta.length > 0) {
      iolAsk = puntasExtraidas.venta[0].precio;
    }

    // ── V3.5: Volume Separation ────────────────────────────────────
    // volumen = Monto total operado en ARS (notional)
    // cantidadOperada = Cantidad de títulos operados (qty)
    const volumenNotional = Number(data.volumen) || 0;       // ARS
    const cantidadOperada = Number(data.cantidadoperada) || 0; // qty of titles

    // ── Estimate average daily volume (in ARS notional) ────────────
    // V3.5 FIX: Always use notional ARS for avg daily volume.
    // Previous version mixed qty × 100 as a rough proxy when volumen was 0,
    // but this conflates quantity with nominal value.
    // Now: if volumenNotional is 0, we estimate from qty × lastPrice × 100
    // (approximate notional = qty × price_per_100_VN)
    const hoursElapsed = tradingHoursElapsed();
    let estimatedAvgDaily = 0;

    if (volumenNotional > 0) {
      estimatedAvgDaily = volumenNotional * (7 / hoursElapsed);
    } else if (cantidadOperada > 0) {
      // Fallback: estimate notional from qty × approximate price
      // ultimoPrecio is per $1 VN, so notional ≈ qty × price × 100
      const approxPrice = Number(data.ultimoprecio) || 0;
      if (approxPrice > 0) {
        const estimatedNotional = cantidadOperada * approxPrice * 100;
        estimatedAvgDaily = estimatedNotional * (7 / hoursElapsed);
      }
    }

    // Liquidity alert: notional volume ratio < 10 % of estimated avg daily
    const volumeRatio =
      estimatedAvgDaily > 0 ? volumenNotional / estimatedAvgDaily : 0;
    const liquidityAlert =
      volumeRatio < IOL_LOW_VOLUME_PCT && volumenNotional > 0;

    // Raw puntas for depth calculations (already extracted above)
    const puntasDetalle = puntasExtraidas;

    // V3.2.3-PRO: Calculate depth & market pressure from puntas
    const bidDepth = calcDepth(puntasDetalle.compra);
    const askDepth = calcDepth(puntasDetalle.venta);
    const marketPressure = calcMarketPressure(bidDepth, askDepth);

    return {
      iol_volume: volumenNotional, // DEPRECATED — backward compat alias
      iol_volume_notional: volumenNotional,
      iol_volume_qty: cantidadOperada,
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
