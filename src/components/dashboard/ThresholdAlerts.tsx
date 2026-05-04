'use client';

import React, { useMemo } from 'react';
import { Instrument, Config, MomentumData } from '@/lib/types';
import { spreadVsCaucion, caucionTEMFromTNA, getCaucionForDays } from '@/lib/calculations';

interface ThresholdAlert {
  id: string;
  type: 'danger' | 'warning' | 'info';
  icon: string;
  title: string;
  message: string;
  ticker?: string;
}

interface ThresholdAlertsProps {
  instruments: Instrument[];
  config: Config;
  position: { ticker: string } | null;
  momentumMap: Map<string, MomentumData>;
}

export default function ThresholdAlerts({ instruments, config, position, momentumMap }: ThresholdAlertsProps) {
  const alerts = useMemo<ThresholdAlert[]>(() => {
    const result: ThresholdAlert[] = [];

    // 1. TRAMPA alerts: instruments with TEM below caución
    for (const inst of instruments) {
      const caucionTNA = getCaucionForDays(config, inst.days);
      const caucionTEM = caucionTEMFromTNA(caucionTNA);
      if (inst.tem < caucionTEM) {
        const isHeld = position?.ticker === inst.ticker;
        result.push({
          id: `trampa-${inst.ticker}`,
          type: isHeld ? 'danger' : 'warning',
          icon: isHeld ? '🚨' : '⚠️',
          title: isHeld ? 'TRAMPA en Cartera' : 'TRAMPA Detectada',
          message: `${inst.ticker} TEM ${(inst?.tem ?? 0).toFixed(2)}% < Caución ${caucionTEM.toFixed(2)}%`,
          ticker: inst.ticker,
        });
      }
    }

    // 2. Strong negative momentum alerts
    for (const inst of instruments) {
      const momentum = momentumMap.get(inst.ticker);
      if (momentum && momentum.deltaTIR !== null && momentum.deltaTIR < -0.15) {
        const isHeld = position?.ticker === inst.ticker;
        if (isHeld) {
          result.push({
            id: `momentum-${inst.ticker}`,
            type: 'warning',
            icon: '📉',
            title: 'Momentum Negativo en Cartera',
            message: `${inst.ticker} ΔTIR: ${momentum.deltaTIR >= 0 ? '+' : ''}${(momentum?.deltaTIR ?? 0).toFixed(3)}%`,
            ticker: inst.ticker,
          });
        }
      }
    }

    // 3. Position spread compression warning
    if (position) {
      const heldInst = instruments.find(i => i.ticker === position.ticker);
      if (heldInst) {
        const spread = spreadVsCaucion(heldInst.tem, config, heldInst.days);
        if (spread < 0.05 && spread > 0) {
          result.push({
            id: `spread-compression-${position.ticker}`,
            type: 'info',
            icon: '💨',
            title: 'Spread Comprimido',
            message: `${position.ticker} spread vs caución: ${spread.toFixed(3)}% — cerca de zona de riesgo`,
            ticker: position.ticker,
          });
        }
      }
    }

    // 4. High country risk
    if (config.riesgoPais > 700) {
      result.push({
        id: 'riesgo-pais',
        type: 'danger',
        icon: '🔴',
        title: 'Riesgo País Elevado',
        message: `Riesgo País: ${config.riesgoPais}pb — Zona de alta volatilidad`,
      });
    } else if (config.riesgoPais > 550) {
      result.push({
        id: 'riesgo-pais',
        type: 'warning',
        icon: '🟡',
        title: 'Riesgo País en Alerta',
        message: `Riesgo País: ${config.riesgoPais}pb — Monitorear de cerca`,
      });
    }

    // Sort: danger first, then warning, then info
    const order = { danger: 0, warning: 1, info: 2 };
    result.sort((a, b) => order[a.type] - order[b.type]);

    // Cap at 5 alerts
    return result.slice(0, 5);
  }, [instruments, config, position, momentumMap]);

  if (alerts.length === 0) return null;

  const alertStyles = {
    danger: {
      bg: 'bg-[#f87171]/8',
      border: 'border-[#f87171]/30',
      title: 'text-[#f87171]',
      badge: 'bg-[#f87171]/15 text-[#f87171]',
    },
    warning: {
      bg: 'bg-[#fbbf24]/8',
      border: 'border-[#fbbf24]/30',
      title: 'text-[#fbbf24]',
      badge: 'bg-[#fbbf24]/15 text-[#fbbf24]',
    },
    info: {
      bg: 'bg-[#22d3ee]/8',
      border: 'border-[#22d3ee]/30',
      title: 'text-[#22d3ee]',
      badge: 'bg-[#22d3ee]/15 text-[#22d3ee]',
    },
  };

  return (
    <div className="space-y-2">
      {alerts.map((alert) => {
        const style = alertStyles[alert.type];
        return (
          <div
            key={alert.id}
            className={`${style.bg} border ${style.border} rounded-lg px-4 py-3 flex items-start gap-3 animate-fadeIn`}
          >
            <span className="text-lg shrink-0 mt-0.5">{alert.icon}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className={`text-[11px] font-semibold uppercase tracking-wider ${style.title}`}>
                  {alert.title}
                </span>
                {alert.ticker && (
                  <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${style.badge}`}>
                    {alert.ticker}
                  </span>
                )}
              </div>
              <div className="text-xs text-app-text3 mt-0.5">{alert.message}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
