'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';

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
}

interface MarketPressureBadgeProps {
  ticker: string;
  compact?: boolean; // If true, show minimal inline version
}

export default function MarketPressureBadge({ ticker, compact = false }: MarketPressureBadgeProps) {
  const [data, setData] = useState<MarketPressureData | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
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

  const mp = data.market_pressure;
  const isBuyingPressure = mp > 1.3;
  const isSellingPressure = mp < 0.7;
  const isBalanced = !isBuyingPressure && !isSellingPressure;

  // Pressure color
  const pressureColor = isBuyingPressure ? '#2eebc8' : isSellingPressure ? '#f87171' : '#fbbf24';
  const pressureLabel = isBuyingPressure ? 'COMPRA' : isSellingPressure ? 'VENTA' : 'NEUTRO';
  const pressureEmoji = isBuyingPressure ? '🟢' : isSellingPressure ? '🔴' : '🟡';

  // Pressure bar width (logarithmic scale: 0.1 to 10 mapped to 0-100%)
  const barPct = Math.min(100, Math.max(5, (Math.log10(Math.max(0.1, mp)) + 1) / 2 * 100));

  if (compact) {
    return (
      <div className="flex items-center gap-1" title={`Presión: ${mp.toFixed(2)} | Bid: ${(data.bid_depth/1000000).toFixed(1)}M | Ask: ${(data.ask_depth/1000000).toFixed(1)}M | Vol: ${data.volume.toLocaleString()}`}>
        <div className="w-8 h-1 bg-app-subtle rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all duration-500" style={{ width: `${barPct}%`, backgroundColor: pressureColor }} />
        </div>
        <span className="font-mono text-[8px]" style={{ color: pressureColor }}>{mp.toFixed(1)}</span>
      </div>
    );
  }

  // Full version with order book
  return (
    <div className="space-y-1">
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
          {mp.toFixed(2)}
        </span>
      </div>

      {/* Labels */}
      <div className="flex items-center justify-between text-[8px]">
        <span style={{ color: '#2eebc8' }}>BID {(data.bid_depth / 1000000).toFixed(1)}M</span>
        <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold border ${
          isBuyingPressure ? 'bg-[#2eebc8]/10 text-[#2eebc8] border-[#2eebc8]/30' :
          isSellingPressure ? 'bg-[#f87171]/10 text-[#f87171] border-[#f87171]/30' :
          'bg-[#fbbf24]/10 text-[#fbbf24] border-[#fbbf24]/30'
        }`}>
          {pressureLabel}
        </span>
        <span style={{ color: '#f87171' }}>ASK {(data.ask_depth / 1000000).toFixed(1)}M</span>
      </div>

      {/* Expandable order book */}
      {data.puntas_detalle && (
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
                {data.puntas_detalle.compra.slice(0, 5).map((p, i) => (
                  <div key={i} className="flex justify-between text-app-text3">
                    <span>{(p.cantidad / 1000).toFixed(0)}K</span>
                    <span className="text-app-text2">{p.precio.toFixed(2)}</span>
                  </div>
                ))}
              </div>
              <div>
                <div className="text-[#f87171] font-semibold mb-0.5">Venta</div>
                {data.puntas_detalle.venta.slice(0, 5).map((p, i) => (
                  <div key={i} className="flex justify-between text-app-text3">
                    <span className="text-app-text2">{p.precio.toFixed(2)}</span>
                    <span>{(p.cantidad / 1000).toFixed(0)}K</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Volume info */}
      <div className="text-[8px] text-app-text4">
        Vol: {data.volume.toLocaleString()} ops | {data.liquidity_alert ? '⚠️ Baja liquidez' : '✅ Liquidez OK'}
      </div>
    </div>
  );
}
