import { NextRequest, NextResponse } from 'next/server';
import type { CockpitScore } from '@/lib/types';
import { calculateCockpitScore } from '@/lib/calculations';
import type { Instrument, Config } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface CockpitCache { allScores: CockpitScore[]; data: Record<string, unknown>; timestamp: number; }
let cachedCockpit: CockpitCache | null = null;
const CACHE_TTL_MS = 50_000;
const DEFAULT_CONFIG: Config = { caucion1d: 17.0, caucion7d: 19.2, caucion30d: 18.5, comisionTotal: 0.30, riesgoPais: 528, capitalDisponible: 500000 };

export async function GET(request: NextRequest) {
  const now = Date.now();
  const { searchParams } = new URL(request.url);
  const horizon = Math.max(1, Math.min(365, parseInt(searchParams.get('horizon') || '45', 10) || 45));

  if (cachedCockpit && (now - cachedCockpit.timestamp) < CACHE_TTL_MS) {
    const scores = horizon >= 365 ? cachedCockpit.allScores : cachedCockpit.allScores.filter(s => s.days <= horizon);
    return NextResponse.json({ ...cachedCockpit.data, scores, horizon_days: horizon });
  }

  try {
    let letrasRes: Response;
    try {
      letrasRes = await fetch(new URL('/api/letras', request.url).toString(), { signal: AbortSignal.timeout(2_000) });
    } catch {
      if (cachedCockpit) {
        const scores = horizon >= 365 ? cachedCockpit.allScores : cachedCockpit.allScores.filter(s => s.days <= horizon);
        return NextResponse.json({ ...cachedCockpit.data, scores, horizon_days: horizon, stale: true });
      }
      return NextResponse.json({ error: true, message: 'Live data unavailable' }, { status: 502 });
    }

    if (!letrasRes.ok) {
      if (cachedCockpit) {
        const scores = horizon >= 365 ? cachedCockpit.allScores : cachedCockpit.allScores.filter(s => s.days <= horizon);
        return NextResponse.json({ ...cachedCockpit.data, scores, horizon_days: horizon, stale: true });
      }
      return NextResponse.json({ error: true, message: 'Failed to fetch live data' }, { status: 502 });
    }

    const letrasData = await letrasRes.json();
    const liveInstruments = letrasData.instruments ?? [];
    const caucionProxy = letrasData.caucion_proxy ?? { tna_promedio: 0, tem_caucion: 0 };

    const config = { ...DEFAULT_CONFIG };
    if (caucionProxy.tna_promedio > 0) {
      config.caucion7d = caucionProxy.tna_promedio;
      config.caucion30d = caucionProxy.tna_promedio;
      config.caucion1d = caucionProxy.tna_promedio + 0.5;
    }

    const allScores: CockpitScore[] = liveInstruments.map((inst: Record<string, unknown>) => {
      const instrument: Instrument = {
        ticker: inst.ticker as string,
        type: (inst.type as string) === 'BONCAP' ? 'BONCAP' : 'LECAP',
        expiry: inst.fecha_vencimiento as string,
        days: inst.days_to_expiry as number,
        price: inst.last_price as number,
        change: inst.change_pct as number,
        tna: (inst.tna as number) * 100,
        tem: (inst.tem as number) * 100,
        tir: (inst.tir as number) * 100,
        gananciaDirecta: (inst.ganancia_directa as number) * 100,
        vsPlazoFijo: '',
        iolMarketPressure: inst.iol_market_pressure as number | undefined,
      };
      const deltaTIR = inst.delta_tir != null ? (inst.delta_tir as number) * 100 : null;
      const iolMarketPressure = instrument.iolMarketPressure ?? null;
      const spreadNetoPct = (inst.spread_neto as number) * 100;
      const upsideCapital = Math.max(0, spreadNetoPct * (instrument.days / 30) * 0.5);
      return calculateCockpitScore(instrument, config, deltaTIR, iolMarketPressure, upsideCapital, instrument.days);
    });

    allScores.sort((a, b) => b.cockpitScore - a.cockpitScore);
    const scores = allScores.filter(s => s.days <= horizon);

    const summary = {
      total: allScores.length,
      within_horizon: scores.length,
      salto_tactico: allScores.filter(s => s.verdict === 'SALTO_TACTICO').length,
      punto_caramelo: allScores.filter(s => s.verdict === 'PUNTO_CARAMELO').length,
      atractivo: allScores.filter(s => s.verdict === 'ATRACTIVO').length,
      neutral: allScores.filter(s => s.verdict === 'NEUTRAL').length,
      evitar: allScores.filter(s => s.verdict === 'EVITAR').length,
    };

    const response = { scores, all_scores: allScores, horizon_days: horizon, summary, timestamp: new Date(now).toISOString(), engine_version: 'V5.0-SCANNER', stale: false };
    cachedCockpit = { allScores, data: response, timestamp: now };
    return NextResponse.json(response);
  } catch (error) {
    if (cachedCockpit) {
      const scores = horizon >= 365 ? cachedCockpit.allScores : cachedCockpit.allScores.filter(s => s.days <= horizon);
      return NextResponse.json({ ...cachedCockpit.data, scores, horizon_days: horizon, stale: true, stale_reason: 'computation_error' });
    }
    return NextResponse.json({ error: true, message: 'Cockpit computation failed' }, { status: 500 });
  }
}
