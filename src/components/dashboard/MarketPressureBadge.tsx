'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { safeNumber, safeVolume } from '@/lib/utils';

interface MarketPressureData {
  volume: number;
  bid: number;
  ask: number;
  bid_depth: number;
  ask_depth: number;
  market_pressure: number;
  status: 'online' | 'offline' | 'no_data';
  liquidity_alert: boolean;
  puntas_detalle?: {
    compra: Array<{ cantidad: number; precio: number }>;
    venta: Array<{ cantidad: number; precio: number }>;
  };
  absorption_alert?: {
    ticker: string;
    wallSize: number;
    wallAvgMultiple: number;
    absorbedPct: number;
    alertType: 'WALL_DETECTED' | 'ABSORPTION_IMMINENT' | 'ABSORPTION_COMPLETE';
    alertMessage: string;
    priority: boolean;
  } | null;
}

interface MarketPressureBadgeProps {
  ticker: string;
  compact?: boolean; // If true, show minimal inline version
}

export default function MarketPressureBadge({ ticker, compact = false }: MarketPressureBadgeProps) {
  const [data, setData] = useState<MarketPressureData | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/iol-level2?tickers=${encodeURIComponent(ticker)}`);
      if (!res.ok) { setData(null); return; }
      const json = await res.json();
      if (json.iol_available && json.data?.[ticker]) {
        setData(json.data[ticker]);
      } else {
        setData(null);
      }
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [ticker]);

  // Fetch on mount and every 60s when market is open
  useEffect(() => {
    fetchData();
    intervalRef.current = setInterval(fetchData, 60_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchData]);

  if (!data && !loading) {
    // No IOL data available
    return compact ? (
      <span className="text-[8px] text-app-text4 font-mono">—</span>
    ) : null;
  }

  if (loading && !data) {
    return compact ? (
      <span className="text-[8px] text-app-text4 animate-pulse">...</span>
    ) : null;
  }

  if (!data) return null;

  const mp = safeNumber(data?.market_pressure, 0);
  const isBuyingPressure = mp > 1.3;
  const isSellingPressure = mp < 0.7;
  const isBalanced = !isBuyingPressure && !isSellingPressure;

  // Pressure color
  const pressureColor = isBuyingPressure ? '#2eebc8' : isSellingPressure ? '#f87171' : '#fbbf24';
  const pressureLabel = isBuyingPressure ? 'COMPRA' : isSellingPressure ? 'VENTA' : 'NEUTRO';
  const pressureEmoji = isBuyingPressure ? '🟢' : isSellingPressure ? '🔴' : '🟡';

  // Pressure bar width (logarithmic scale: 0.1 to 10 mapped to 0-100%)
  const barPct = Math.min(100, Math.max(5, (Math.log10(Math.max(0.1, mp)) + 1) / 2 * 100));

  // 5-bid vs 5-ask accumulated volume
  const top5Compra = (data?.puntas_detalle?.compra ?? []).slice(0, 5);
  const top5Venta = (data?.puntas_detalle?.venta ?? []).slice(0, 5);
  const top5CompraVol = top5Compra.reduce((sum, p) => sum + (p?.cantidad ?? 0), 0);
  const top5VentaVol = top5Venta.reduce((sum, p) => sum + (p?.cantidad ?? 0), 0);

  // Absorption alert
  const absorption = data?.absorption_alert ?? null;
  const hasAbsorption = absorption != null;
  const isImminent = absorption?.alertType === 'ABSORPTION_IMMINENT';

  // Absorption alert color scheme
  const absorptionColors: Record<string, { bg: string; border: string; text: string; emoji: string }> = {
    WALL_DETECTED: { bg: 'bg-[#fbbf24]/8', border: 'border-[#fbbf24]/30', text: 'text-[#fbbf24]', emoji: '🧱' },
    ABSORPTION_IMMINENT: { bg: 'bg-[#f87171]/10', border: 'border-[#f87171]/40', text: 'text-[#f87171]', emoji: '🚨' },
    ABSORPTION_COMPLETE: { bg: 'bg-[#2eebc8]/8', border: 'border-[#2eebc8]/30', text: 'text-[#2eebc8]', emoji: '✅' },
  };
  const absorptionStyle = absorption ? absorptionColors[absorption.alertType] ?? absorptionColors.WALL_DETECTED : null;

  if (compact) {
    return (
      <div
        className={`flex items-center gap-1 relative ${isImminent ? 'ring-1 ring-[#f87171]/60 rounded animate-pulse' : ''}`}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        <div className="w-8 h-1 bg-app-subtle rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all duration-500" style={{ width: `${barPct}%`, backgroundColor: pressureColor }} />
        </div>
        <span className="font-mono text-[8px]" style={{ color: pressureColor }}>{(mp ?? 0).toFixed(1)}</span>
        {/* Absorption pulsing dot */}
        {hasAbsorption && (
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${isImminent ? 'bg-[#f87171] animate-pulse' : 'bg-[#fbbf24]'} `} title={absorption?.alertMessage ?? 'Absorption alert'} />
        )}
        {/* Tooltip with 5-bid/5-ask breakdown */}
        {showTooltip && (
          <div className="absolute z-50 bottom-full mb-2 left-1/2 -translate-x-1/2 bg-black/95 border border-app-border/60 rounded-lg p-3 shadow-2xl min-w-[200px] backdrop-blur-sm">
            <div className="text-[9px] text-app-text4 font-mono mb-1.5">{ticker} — Presión de Mercado</div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[9px]" style={{ color: pressureColor }}>{pressureEmoji} {pressureLabel}</span>
              <span className="font-mono text-[10px] font-bold" style={{ color: pressureColor }}>{(mp ?? 0).toFixed(2)}</span>
            </div>
            <div className="text-[8px] text-app-text4 mb-1">Depth</div>
            <div className="flex justify-between text-[8px] font-mono mb-1">
              <span className="text-[#2eebc8]">BID {safeVolume(data?.bid_depth, '0')}</span>
              <span className="text-[#f87171]">ASK {safeVolume(data?.ask_depth, '0')}</span>
            </div>
            {/* 5 Compra vs 5 Venta summary */}
            {top5CompraVol > 0 || top5VentaVol > 0 ? (
              <div className="border-t border-app-border/40 pt-1 mt-1">
                <div className="text-[8px] text-app-text4 mb-0.5">Top 5 Puntas</div>
                <div className="flex justify-between text-[8px] font-mono">
                  <span className="text-[#2eebc8]">5 Compra: {safeVolume(top5CompraVol, '0')}</span>
                  <span className="text-[#f87171]">5 Venta: {safeVolume(top5VentaVol, '0')}</span>
                </div>
              </div>
            ) : null}
            {/* Volume */}
            <div className="text-[8px] text-app-text4 mt-1">
              Vol: {(data?.volume ?? 0).toLocaleString()} ops
            </div>
            {/* Absorption alert in tooltip */}
            {hasAbsorption && absorptionStyle && (
              <div className={`mt-1.5 p-1.5 rounded text-[8px] ${absorptionStyle.bg} ${absorptionStyle.border} border`}>
                <span className={absorptionStyle.text}>{absorptionStyle.emoji} {absorption?.alertType?.replace('_', ' ') ?? 'ALERT'}</span>
                <div className="text-app-text3 text-[7px] mt-0.5">{absorption?.alertMessage ?? ''}</div>
              </div>
            )}
            {/* V3.2.2-PRO: Priority instrument indicator */}
            {ticker.match(/^T\d+[A-Z]\d+$/i) && (
              <div className="mt-1 text-[7px] text-[#fbbf24] font-mono font-bold uppercase tracking-wider">
                ⚡ BONCAP PRIORITY — Alta tasa
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // Full version with order book
  return (
    <div className={`space-y-1 ${isImminent ? 'ring-2 ring-[#f87171]/60 rounded-lg p-1 animate-pulse' : ''}`}>
      {/* Pressure indicator */}
      <div className="flex items-center gap-2">
        <span className="text-[9px]">{pressureEmoji}</span>
        <div className="flex-1 h-1.5 bg-app-subtle rounded-full overflow-hidden relative">
          {/* Center marker at 50% (represents mp=1.0) */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-px h-full bg-app-text4/30" />
          </div>
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${barPct}%`,
              backgroundColor: pressureColor,
              opacity: 0.8,
            }}
          />
        </div>
        <span className="font-mono text-[10px] font-semibold min-w-[32px] text-right" style={{ color: pressureColor }}>
          {(mp ?? 0).toFixed(2)}
        </span>
      </div>

      {/* Labels */}
      <div className="flex items-center justify-between text-[8px]">
        <span style={{ color: '#2eebc8' }}>BID {safeVolume(data?.bid_depth, '0')}</span>
        <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold border ${
          isBuyingPressure ? 'bg-[#2eebc8]/10 text-[#2eebc8] border-[#2eebc8]/30' :
          isSellingPressure ? 'bg-[#f87171]/10 text-[#f87171] border-[#f87171]/30' :
          'bg-[#fbbf24]/10 text-[#fbbf24] border-[#fbbf24]/30'
        }`}>
          {pressureLabel}
        </span>
        <span style={{ color: '#f87171' }}>ASK {safeVolume(data?.ask_depth, '0')}</span>
      </div>

      {/* 5 Compra vs 5 Venta summary */}
      {(top5CompraVol > 0 || top5VentaVol > 0) && (
        <div className="flex items-center justify-between text-[8px] font-mono px-0.5">
          <span className="text-[#2eebc8]/80">5 Compra: {safeVolume(top5CompraVol, '0')}</span>
          <span className="text-app-text4">vs</span>
          <span className="text-[#f87171]/80">5 Venta: {safeVolume(top5VentaVol, '0')}</span>
        </div>
      )}

      {/* Expandable order book */}
      {data?.puntas_detalle && (
        <>
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-[8px] text-app-text4 hover:text-app-text2 transition-colors"
          >
            {expanded ? '▲ Ocultar puntas' : '▼ Ver puntas'}
          </button>
          {expanded && (
            <div className="grid grid-cols-2 gap-1 text-[8px] font-mono mt-1">
              <div>
                <div className="text-[#2eebc8] font-semibold mb-0.5">Compra</div>
                {(data?.puntas_detalle?.compra ?? []).slice(0, 5).map((p, i) => (
                  <div key={i} className="flex justify-between text-app-text3">
                    <span>{((p?.cantidad ?? 0) / 1000).toFixed(0)}K</span>
                    <span className="text-app-text2">{(p?.precio ?? 0).toFixed(2)}</span>
                  </div>
                ))}
              </div>
              <div>
                <div className="text-[#f87171] font-semibold mb-0.5">Venta</div>
                {(data?.puntas_detalle?.venta ?? []).slice(0, 5).map((p, i) => (
                  <div key={i} className="flex justify-between text-app-text3">
                    <span className="text-app-text2">{(p?.precio ?? 0).toFixed(2)}</span>
                    <span>{((p?.cantidad ?? 0) / 1000).toFixed(0)}K</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Absorption Alert banner */}
      {hasAbsorption && absorptionStyle && (
        <div className={`rounded p-2 text-[8px] border ${absorptionStyle.bg} ${absorptionStyle.border} ${isImminent ? 'ring-1 ring-[#f87171]/50 animate-pulse' : ''}`}>
          <div className="flex items-center gap-1.5">
            <span className={absorptionStyle.text}>{absorptionStyle.emoji}</span>
            <span className={`font-bold ${absorptionStyle.text}`}>{absorption?.alertType?.replace('_', ' ') ?? 'ALERT'}</span>
          </div>
          <div className="text-app-text3 text-[7px] mt-0.5">{absorption?.alertMessage ?? ''}</div>
          {absorption && (
            <div className="text-app-text4 text-[7px] mt-0.5 font-mono">
              Wall: {safeVolume(absorption?.wallSize, '0')} · {(absorption?.wallAvgMultiple ?? 0).toFixed(1)}x avg · {(absorption?.absorbedPct ?? 0).toFixed(0)}% absorbed
            </div>
          )}
        </div>
      )}
      {isImminent && absorption?.priority && (
        <div className="mt-1 p-2 rounded bg-[#f87171]/15 border border-[#f87171]/50 text-[9px] font-bold text-[#f87171] animate-pulse">
          🚨 FUERZA COMPRADORA INMINENTE — {ticker} — Capturar salto de precio PRE-LIMPIEZA de pared
        </div>
      )}

      {/* Volume info */}
      <div className="text-[8px] text-app-text4">
        Vol: {(data?.volume ?? 0).toLocaleString()} ops | {data?.liquidity_alert ? '⚠️ Baja liquidez' : '✅ Liquidez OK'}
      </div>
      {/* V3.2.2-PRO: Priority instrument badge */}
      {ticker.match(/^T\d+[A-Z]\d+$/i) && (
        <div className="mt-1 px-2 py-1 rounded bg-[#fbbf24]/10 border border-[#fbbf24]/30 text-[8px] font-bold text-[#fbbf24] uppercase tracking-wider">
          ⚡ BONCAP PRIORITY — Detección de Absorción Prioritaria
        </div>
      )}
    </div>
  );
}
