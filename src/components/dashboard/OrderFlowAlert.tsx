'use client';

// ════════════════════════════════════════════════════════════════════════
// V3.2.3-PRO — Order Flow Imbalance Alert Component
//
// Monitors bid/ask depth ratio for all instruments.
// Shows a compact alert when the order book has a significant
// imbalance (>3:1 ratio in either direction).
// Uses data from /api/market-pressure endpoint.
// ════════════════════════════════════════════════════════════════════════

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { safeNumber } from '@/lib/utils';

interface FlowData {
  ticker: string;
  pressure: number;
  bidDepth: number;
  askDepth: number;
  type: 'BULLISH_FLOW' | 'BEARISH_FLOW' | 'BALANCED';
}

export default function OrderFlowAlert() {
  const [flows, setFlows] = useState<FlowData[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchFlows = useCallback(async () => {
    try {
      const tickers = 'T15E7,T30J7,T5W3,S1L5,S30A6,S29Y6';
      const res = await fetch(`/api/market-pressure?tickers=${tickers}`);
      if (!res.ok) return;
      const json = await res.json();
      if (!json.iol_available || !json.data) return;

      const detected: FlowData[] = [];
      for (const [ticker, data] of Object.entries(json.data as Record<string, { market_pressure?: number; bid_depth?: number; ask_depth?: number } & Record<string, unknown>>)) {
        const pressure = safeNumber(data?.market_pressure, 0);
        const bidDepth = safeNumber(data?.bid_depth, 0);
        const askDepth = safeNumber(data?.ask_depth, 0);

        if (pressure > 3.0 && bidDepth > 0) {
          detected.push({ ticker, pressure, bidDepth, askDepth, type: 'BULLISH_FLOW' });
        } else if (pressure < 0.33 && askDepth > 0) {
          detected.push({ ticker, pressure, bidDepth, askDepth, type: 'BEARISH_FLOW' });
        }
      }
      setFlows(detected);
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    const initialTimeout = setTimeout(fetchFlows, 3000);
    intervalRef.current = setInterval(fetchFlows, 60_000);
    return () => {
      clearTimeout(initialTimeout);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchFlows]);

  if (flows.length === 0) return null;

  return (
    <div className="px-4 md:px-6 lg:px-8 space-y-1">
      {flows.map((flow, idx) => {
        const isBullish = flow.type === 'BULLISH_FLOW';
        const bgClass = isBullish ? 'bg-[#2eebc8]/8 border-[#2eebc8]/20' : 'bg-[#f87171]/8 border-[#f87171]/20';
        const textClass = isBullish ? 'text-[#2eebc8]' : 'text-[#f87171]';
        const emoji = isBullish ? '📈' : '📉';
        const label = isBullish ? 'FLUJO COMPRADOR' : 'FLUJO VENDEDOR';

        return (
          <div key={`${flow.ticker}-${idx}`} className={`flex items-center justify-between p-2 rounded-lg border ${bgClass}`}>
            <div className="flex items-center gap-2">
              <span className="text-sm">{emoji}</span>
              <span className={`text-[9px] font-bold uppercase tracking-wider ${textClass}`}>{label}</span>
              <span className="text-[9px] font-mono text-app-text">{flow.ticker}</span>
              <span className="text-[8px] text-app-text4 font-mono">
                Ratio {flow.pressure.toFixed(1)}:1 · Bid {safeNumber(flow.bidDepth, 0).toLocaleString()} vs Ask {safeNumber(flow.askDepth, 0).toLocaleString()}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
