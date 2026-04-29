'use client';

import React, { useState, useMemo } from 'react';
import { Instrument, Config, MomentumData } from '@/lib/types';
import { PriceHistoryFile, calculateSR } from '@/lib/priceHistory';
import {
  spreadVsCaucion,
  durationMod,
  caucionTEMFromTNA,
  getCaucionForDays,
} from '@/lib/calculations';

// ─── Props ───
interface InstrumentCompareProps {
  instruments: Instrument[];
  config: Config;
  momentumMap: Map<string, MomentumData>;
  priceHistory: PriceHistoryFile | null;
}

// ─── Slot colors for A / B / C ───
const SLOT_COLORS = ['#2eebc8', '#f472b6', '#22d3ee'] as const;
const SLOT_LABELS = ['A', 'B', 'C'] as const;

// ─── Composite score for comparison ───
const compositeScore = (
  inst: Instrument,
  cfg: Config,
  momentum: MomentumData | undefined
): number => {
  const spread = spreadVsCaucion(inst.tem, cfg, inst.days);
  const dm = Math.abs(durationMod(inst.days, inst.tem));
  const spreadScore = Math.min(Math.max(spread / 0.5, 0), 1) * 4;
  const momentumScore = momentum?.deltaTIR
    ? Math.min(Math.max((momentum.deltaTIR + 0.3) / 0.6, 0), 1) * 3
    : 1.5;
  const durationScore = Math.min(Math.max((1 - dm / 2) * 1, 0), 1) * 3;
  return Math.min(spreadScore + momentumScore + durationScore, 10);
};

// ─── Metric row definition ───
interface MetricRow {
  label: string;
  key: string;
  getValue: (inst: Instrument, cfg: Config, mom: MomentumData | undefined) => number;
  format: (v: number) => string;
  higherIsBetter: boolean;
  unit?: string;
}

// ─── Radar axis definition ───
interface RadarAxis {
  label: string;
  key: string;
  getNormalized: (inst: Instrument, cfg: Config, mom: MomentumData | undefined, allInsts: Instrument[]) => number;
}

// ─── Metric definitions ───
const METRICS: MetricRow[] = [
  {
    label: 'Precio',
    key: 'price',
    getValue: (inst) => inst.price,
    format: (v) => `$${v.toFixed(4)}`,
    higherIsBetter: false,
  },
  {
    label: 'TEM',
    key: 'tem',
    getValue: (inst) => inst.tem,
    format: (v) => `${v.toFixed(2)}%`,
    higherIsBetter: true,
  },
  {
    label: 'TIR',
    key: 'tir',
    getValue: (inst) => inst.tir,
    format: (v) => `${v.toFixed(2)}%`,
    higherIsBetter: true,
  },
  {
    label: 'TNA',
    key: 'tna',
    getValue: (inst) => inst.tna,
    format: (v) => `${v.toFixed(2)}%`,
    higherIsBetter: true,
  },
  {
    label: 'Spread vs Caución',
    key: 'spread',
    getValue: (inst, cfg) => spreadVsCaucion(inst.tem, cfg, inst.days),
    format: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(3)}%`,
    higherIsBetter: true,
  },
  {
    label: 'Duration Modified',
    key: 'dm',
    getValue: (inst) => Math.abs(durationMod(inst.days, inst.tem)),
    format: (v) => v.toFixed(4),
    higherIsBetter: false,
  },
  {
    label: 'Días al Vencimiento',
    key: 'days',
    getValue: (inst) => inst.days,
    format: (v) => `${v}`,
    higherIsBetter: false,
  },
  {
    label: 'ΔTIR',
    key: 'deltaTIR',
    getValue: (_inst, _cfg, mom) => mom?.deltaTIR ?? 0,
    format: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(3)}%`,
    higherIsBetter: true,
  },
  {
    label: 'Composite Score',
    key: 'composite',
    getValue: (inst, cfg, mom) => compositeScore(inst, cfg, mom),
    format: (v) => `${v.toFixed(1)}/10`,
    higherIsBetter: true,
  },
];

// ─── Radar axes (5 axes, each normalized 0–1) ───
const RADAR_AXES: RadarAxis[] = [
  {
    label: 'Spread',
    key: 'spread',
    getNormalized: (inst, cfg, _mom, _all) => {
      const s = spreadVsCaucion(inst.tem, cfg, inst.days);
      return Math.min(Math.max((s + 0.5) / 1.5, 0), 1);
    },
  },
  {
    label: 'Momentum',
    key: 'momentum',
    getNormalized: (_inst, _cfg, mom, _all) => {
      if (!mom?.deltaTIR) return 0.5;
      return Math.min(Math.max((mom.deltaTIR + 0.3) / 0.6, 0), 1);
    },
  },
  {
    label: 'Duración',
    key: 'duration',
    getNormalized: (inst, _cfg, _mom, all) => {
      const maxDays = Math.max(...all.map((i) => i.days), 1);
      return inst.days / maxDays;
    },
  },
  {
    label: 'Liquidez',
    key: 'liquidity',
    getNormalized: (inst, _cfg, _mom, all) => {
      const maxDays = Math.max(...all.map((i) => i.days), 1);
      return 1 - inst.days / maxDays;
    },
  },
  {
    label: 'Paridad',
    key: 'parity',
    getNormalized: (inst, cfg, _mom, _all) => {
      const caucionTEM = caucionTEMFromTNA(getCaucionForDays(cfg, inst.days));
      return Math.min(Math.max(inst.tem / (caucionTEM || 1), 0), 2) / 2;
    },
  },
];

// ─── Radar chart SVG helper ───
function RadarChart({
  data,
  colors,
  labels,
}: {
  data: number[][]; // [slotIndex][axisIndex] normalized 0–1
  colors: string[];
  labels: string[];
}) {
  const size = 280;
  const cx = size / 2;
  const cy = size / 2;
  const r = 110;
  const n = RADAR_AXES.length;
  const angleStep = (2 * Math.PI) / n;
  const startAngle = -Math.PI / 2; // top

  // Axis endpoint for a given index and optional radius scale
  const axisPoint = (i: number, scale: number = 1) => ({
    x: cx + r * scale * Math.cos(startAngle + i * angleStep),
    y: cy + r * scale * Math.sin(startAngle + i * angleStep),
  });

  // Grid rings at 20%, 40%, 60%, 80%, 100%
  const rings = [0.2, 0.4, 0.6, 0.8, 1.0];

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className="w-full max-w-[320px] mx-auto"
      role="img"
      aria-label="Gráfico radar de comparación de instrumentos"
    >
      {/* Grid rings */}
      {rings.map((scale, ri) => (
        <polygon
          key={`ring-${ri}`}
          points={Array.from({ length: n }, (_, i) => {
            const p = axisPoint(i, scale);
            return `${p.x},${p.y}`;
          }).join(' ')}
          fill="none"
          stroke="rgba(148,163,184,0.12)"
          strokeWidth={1}
        />
      ))}

      {/* Axis lines */}
      {Array.from({ length: n }, (_, i) => {
        const p = axisPoint(i);
        return (
          <line
            key={`axis-${i}`}
            x1={cx}
            y1={cy}
            x2={p.x}
            y2={p.y}
            stroke="rgba(148,163,184,0.15)"
            strokeWidth={1}
          />
        );
      })}

      {/* Data polygons */}
      {data.map((values, si) => {
        if (!values || values.length === 0) return null;
        const points = values
          .map((v, i) => {
            const p = axisPoint(i, Math.min(Math.max(v, 0), 1));
            return `${p.x},${p.y}`;
          })
          .join(' ');
        return (
          <polygon
            key={`poly-${si}`}
            points={points}
            fill={colors[si]}
            fillOpacity={0.2}
            stroke={colors[si]}
            strokeWidth={2}
            strokeLinejoin="round"
          />
        );
      })}

      {/* Axis labels */}
      {RADAR_AXES.map((axis, i) => {
        const labelR = r + 22;
        const p = {
          x: cx + labelR * Math.cos(startAngle + i * angleStep),
          y: cy + labelR * Math.sin(startAngle + i * angleStep),
        };
        // Adjust text anchor based on position
        let textAnchor: string = 'middle';
        if (p.x < cx - 10) textAnchor = 'end';
        else if (p.x > cx + 10) textAnchor = 'start';

        return (
          <text
            key={`label-${i}`}
            x={p.x}
            y={p.y}
            textAnchor={textAnchor}
            dominantBaseline="central"
            fill="#7a8599"
            fontSize={10}
            fontFamily="var(--font-geist-sans), system-ui, sans-serif"
          >
            {axis.label}
          </text>
        );
      })}

      {/* Data points (dots) */}
      {data.map((values, si) => {
        if (!values || values.length === 0) return null;
        return values.map((v, i) => {
          const p = axisPoint(i, Math.min(Math.max(v, 0), 1));
          return (
            <circle
              key={`dot-${si}-${i}`}
              cx={p.x}
              cy={p.y}
              r={3}
              fill={colors[si]}
              stroke="#0c1220"
              strokeWidth={1.5}
            />
          );
        });
      })}
    </svg>
  );
}

// ─── Comparison bar component ───
function ComparisonBar({
  label,
  values,
  colors,
  formatFn,
  higherIsBetter,
}: {
  label: string;
  values: { value: number; slotLabel: string }[];
  colors: string[];
  formatFn: (v: number) => string;
  higherIsBetter: boolean;
}) {
  // Determine max absolute value for scaling
  const absValues = values.map((v) => Math.abs(v.value));
  const maxAbs = Math.max(...absValues, 0.001);

  // Find best/worst
  const bestIdx = higherIsBetter
    ? values.indexOf(values.reduce((a, b) => (a.value > b.value ? a : b), values[0]))
    : values.indexOf(values.reduce((a, b) => (a.value < b.value ? a : b), values[0]));
  const worstIdx = higherIsBetter
    ? values.indexOf(values.reduce((a, b) => (a.value < b.value ? a : b), values[0]))
    : values.indexOf(values.reduce((a, b) => (a.value > b.value ? a : b), values[0]));

  return (
    <div className="mb-4">
      <div className="text-[10px] text-app-text4 uppercase tracking-wider mb-1.5 font-medium">
        {label}
      </div>
      <div className="space-y-1.5">
        {values.map((v, i) => {
          const barWidth = Math.min(Math.abs(v.value) / maxAbs, 1) * 100;
          const isBest = i === bestIdx && values.length > 1;
          const isWorst = i === worstIdx && values.length > 1;
          return (
            <div key={i} className="flex items-center gap-2">
              <span
                className="text-[10px] font-bold w-4 text-center shrink-0"
                style={{ color: colors[i] }}
              >
                {v.slotLabel}
              </span>
              <div className="flex-1 h-4 bg-app-subtle/60 rounded overflow-hidden relative">
                <div
                  className="h-full rounded score-bar-fill"
                  style={{
                    width: `${barWidth}%`,
                    backgroundColor: isBest
                      ? '#2eebc8'
                      : isWorst
                        ? '#f87171'
                        : colors[i],
                    opacity: 0.7,
                  }}
                />
              </div>
              <span
                className={`text-[10px] font-mono w-[80px] text-right shrink-0 ${
                  isBest
                    ? 'text-[#2eebc8] font-bold'
                    : isWorst
                      ? 'text-[#f87171]'
                      : 'text-app-text2'
                }`}
              >
                {formatFn(v.value)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════
export default function InstrumentCompare({
  instruments,
  config,
  momentumMap,
  priceHistory,
}: InstrumentCompareProps) {
  // ─── Selected slots (ticker strings; empty string = unselected) ───
  const [selections, setSelections] = useState<[string, string, string]>(['', '', '']);

  // ─── Group instruments by type ───
  const lecaps = useMemo(() => instruments.filter((i) => i.type === 'LECAP'), [instruments]);
  const boncaps = useMemo(() => instruments.filter((i) => i.type === 'BONCAP'), [instruments]);

  // ─── Auto-select best spread instrument for slot A on first render ───
  const bestSpreadTicker = useMemo(() => {
    if (instruments.length === 0) return '';
    const best = [...instruments].sort(
      (a, b) => spreadVsCaucion(b.tem, config, b.days) - spreadVsCaucion(a.tem, config, a.days)
    )[0];
    return best.ticker;
  }, [instruments, config]);

  // Initialize slot A with best spread if not already set
  React.useEffect(() => {
    if (selections[0] === '' && bestSpreadTicker) {
      setSelections((prev) => [bestSpreadTicker, prev[1], prev[2]]);
    }
  }, [bestSpreadTicker]);

  // ─── Resolved selected instruments ───
  const selectedInstruments = useMemo(() => {
    return selections
      .map((ticker, idx) => {
        if (!ticker) return null;
        const inst = instruments.find((i) => i.ticker === ticker);
        return inst ? { inst, slotIndex: idx } : null;
      })
      .filter(Boolean) as { inst: Instrument; slotIndex: number }[];
  }, [selections, instruments]);

  const selectedCount = selectedInstruments.length;

  // ─── S/R data ───
  const srData = useMemo(
    () => (priceHistory ? calculateSR(priceHistory, instruments) : []),
    [priceHistory, instruments]
  );

  // ─── Comparison table data ───
  const comparisonData = useMemo(() => {
    if (selectedCount < 2) return null;

    return selectedInstruments.map(({ inst, slotIndex }) => {
      const mom = momentumMap.get(inst.ticker);
      const spread = spreadVsCaucion(inst.tem, config, inst.days);
      const dm = durationMod(inst.days, inst.tem);
      const caucionTEM = caucionTEMFromTNA(getCaucionForDays(config, inst.days));
      const isTrampa = inst.tem < caucionTEM;
      const score = compositeScore(inst, config, mom);
      const sr = srData.find((s) => s.ticker === inst.ticker);

      return {
        inst,
        slotIndex,
        mom,
        spread,
        dm,
        isTrampa,
        caucionTEM,
        score,
        sr,
      };
    });
  }, [selectedInstruments, selectedCount, config, momentumMap, srData]);

  // ─── Radar data ───
  const radarData = useMemo(() => {
    if (selectedCount < 2) return [];

    return selectedInstruments.map(({ inst, slotIndex }) => {
      const mom = momentumMap.get(inst.ticker);
      return RADAR_AXES.map((axis) =>
        axis.getNormalized(inst, config, mom, instruments)
      );
    });
  }, [selectedInstruments, selectedCount, config, momentumMap, instruments]);

  // ─── Verdict ───
  const verdict = useMemo(() => {
    if (!comparisonData || comparisonData.length < 2) return null;

    // Find best by composite score
    const sorted = [...comparisonData].sort((a, b) => b.score - a.score);
    const winner = sorted[0];

    // Best per category
    const bestSpread = [...comparisonData].sort((a, b) => b.spread - a.spread)[0];
    const bestMomentum = [...comparisonData].sort((a, b) => {
      const aDelta = a.mom?.deltaTIR ?? 0;
      const bDelta = b.mom?.deltaTIR ?? 0;
      return bDelta - aDelta;
    })[0];
    const bestDuration = [...comparisonData].sort(
      (a, b) => Math.abs(a.dm) - Math.abs(b.dm)
    )[0];

    return {
      winner,
      bestSpread,
      bestMomentum,
      bestDuration,
    };
  }, [comparisonData]);

  // ─── Dropdown change handler ───
  const handleSelectChange = (slotIndex: number, ticker: string) => {
    setSelections((prev) => {
      const next: [string, string, string] = [...prev];
      // Prevent duplicate selections
      if (ticker && next.some((t, i) => i !== slotIndex && t === ticker)) {
        return prev; // ignore duplicate
      }
      next[slotIndex] = ticker;
      return next;
    });
  };

  // ─── Render select dropdown ───
  const renderSelect = (slotIndex: number) => {
    const color = SLOT_COLORS[slotIndex];
    const label = SLOT_LABELS[slotIndex];
    const value = selections[slotIndex];

    return (
      <div key={slotIndex} className="flex items-center gap-2">
        <span
          className="inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold shrink-0"
          style={{ backgroundColor: `${color}20`, color }}
        >
          {label}
        </span>
        <select
          value={value}
          onChange={(e) => handleSelectChange(slotIndex, e.target.value)}
          className="bg-[#111827] text-white font-mono text-sm border border-[#374151] rounded-md px-3 py-2 w-full [&>option]:bg-[#111827] [&>option]:text-white"
          aria-label={`Instrumento ${label}`}
        >
          <option value="">— Seleccionar —</option>
          {lecaps.length > 0 && (
            <optgroup label="LECAPs">
              {lecaps.map((inst) => (
                <option key={inst.ticker} value={inst.ticker}>
                  {inst.ticker} ({inst.days}d · {inst.tem.toFixed(2)}% TEM)
                </option>
              ))}
            </optgroup>
          )}
          {boncaps.length > 0 && (
            <optgroup label="BONCAPs">
              {boncaps.map((inst) => (
                <option key={inst.ticker} value={inst.ticker}>
                  {inst.ticker} ({inst.days}d · {inst.tem.toFixed(2)}% TEM)
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* ═══════════════════════════════════════════════════════════ */}
      {/* HEADER                                                      */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <div>
        <h2 className="text-lg font-light text-app-text mb-1">⚖️ Comparador</h2>
        <p className="text-sm text-app-text3">
          Compara hasta 3 instrumentos lado a lado
        </p>
      </div>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* INSTRUMENT SELECTORS                                        */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <div className="glass-card p-5 animate-fadeInUp stagger-1">
        <h3 className="text-sm font-light text-app-text2 mb-3">Seleccioná instrumentos</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {renderSelect(0)}
          {renderSelect(1)}
          {renderSelect(2)}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* COMPARISON TABLE                                            */}
      {/* ═══════════════════════════════════════════════════════════ */}
      {comparisonData && selectedCount >= 2 && (
        <div className="glass-card p-5 animate-fadeInUp stagger-2">
          <h3 className="text-sm font-light text-app-text2 mb-1">📊 Tabla Comparativa</h3>
          <p className="text-[10px] text-app-text4 mb-4">
            Mejor valor en <span className="text-[#2eebc8] font-semibold">verde</span> · Peor valor en <span className="text-[#f87171] font-semibold">rojo</span>
          </p>
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-app-card z-10">
                <tr className="text-[11px] uppercase tracking-wider font-medium text-app-text3 border-b border-app-border/60">
                  <th className="px-4 py-3 text-left">Métrica</th>
                  {comparisonData.map((d) => (
                    <th key={d.inst.ticker} className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <span
                          className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[9px] font-bold"
                          style={{
                            backgroundColor: `${SLOT_COLORS[d.slotIndex]}20`,
                            color: SLOT_COLORS[d.slotIndex],
                          }}
                        >
                          {SLOT_LABELS[d.slotIndex]}
                        </span>
                        <span className="font-mono">{d.inst.ticker}</span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {METRICS.map((metric) => {
                  const values = comparisonData.map((d) =>
                    metric.getValue(d.inst, config, d.mom)
                  );
                  const bestVal = metric.higherIsBetter
                    ? Math.max(...values)
                    : Math.min(...values);
                  const worstVal = metric.higherIsBetter
                    ? Math.min(...values)
                    : Math.max(...values);
                  const maxAbsVal = Math.max(...values.map(Math.abs), 0.001);

                  return (
                    <tr
                      key={metric.key}
                      className="border-b border-app-border/60 table-row-highlight"
                    >
                      <td className="px-4 py-3 text-app-text2 font-medium">
                        {metric.label}
                      </td>
                      {comparisonData.map((d, i) => {
                        const val = values[i];
                        const isBest = val === bestVal && comparisonData.length > 1;
                        const isWorst = val === worstVal && comparisonData.length > 1;
                        const barWidth =
                          Math.min(Math.abs(val) / maxAbsVal, 1) * 100;

                        return (
                          <td key={d.inst.ticker} className="px-4 py-3 text-right">
                            <div
                              className={`font-mono text-sm ${
                                isBest
                                  ? 'text-[#2eebc8] font-bold'
                                  : isWorst
                                    ? 'text-[#f87171]'
                                    : 'text-app-text'
                              }`}
                            >
                              {metric.format(val)}
                            </div>
                            {/* Mini bar */}
                            <div className="w-full h-1 bg-app-subtle/60 rounded mt-1 overflow-hidden">
                              <div
                                className="h-full rounded score-bar-fill"
                                style={{
                                  width: `${barWidth}%`,
                                  backgroundColor: isBest
                                    ? '#2eebc8'
                                    : isWorst
                                      ? '#f87171'
                                      : SLOT_COLORS[d.slotIndex],
                                  opacity: 0.5,
                                }}
                              />
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}

                {/* S/R row */}
                {srData.length > 0 && (
                  <tr className="border-b border-app-border/60 table-row-highlight">
                    <td className="px-4 py-3 text-app-text2 font-medium">
                      Soporte / Resistencia
                    </td>
                    {comparisonData.map((d) => {
                      const sr = srData.find((s) => s.ticker === d.inst.ticker);
                      if (!sr) {
                        return (
                          <td key={d.inst.ticker} className="px-4 py-3 text-right font-mono text-app-text4">
                            —
                          </td>
                        );
                      }
                      return (
                        <td
                          key={d.inst.ticker}
                          className="px-4 py-3 text-right font-mono text-app-text2 text-sm"
                        >
                          <span className="text-[#2eebc8]">${sr.soporte.toFixed(4)}</span>
                          <span className="text-app-text4 mx-1">/</span>
                          <span className="text-[#f87171]">${sr.resistencia.toFixed(4)}</span>
                          {/* V1.8.4: Canal % badge */}
                          <span
                            className="ml-1 font-mono font-bold text-[9px] px-1 py-0.5 rounded"
                            style={{ backgroundColor: `${sr.posicionEnCanal >= 90 ? '#f87171' : sr.posicionEnCanal >= 70 ? '#fbbf24' : '#2eebc8'}15`, color: sr.posicionEnCanal >= 90 ? '#f87171' : sr.posicionEnCanal >= 70 ? '#fbbf24' : '#2eebc8' }}
                          >
                            {sr.posicionEnCanal.toFixed(0)}%
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                )}

                {/* TRAMPA row */}
                <tr className="border-b border-app-border/60 table-row-highlight">
                  <td className="px-4 py-3 text-app-text2 font-medium">TRAMPA</td>
                  {comparisonData.map((d) => (
                    <td key={d.inst.ticker} className="px-4 py-3 text-right">
                      <span className={`text-lg ${d.isTrampa ? 'badge-trampa' : ''}`}>
                        {d.isTrampa ? '🚫' : '✅'}
                      </span>
                      {d.isTrampa && (
                        <div className="text-[9px] text-[#f87171] mt-0.5">
                          TEM &lt; Caución
                        </div>
                      )}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* RADAR / SPIDER CHART                                        */}
      {/* ═══════════════════════════════════════════════════════════ */}
      {selectedCount >= 2 && radarData.length > 0 && (
        <div className="glass-card p-5 animate-fadeInUp stagger-3">
          <h3 className="text-sm font-light text-app-text2 mb-1">🕸️ Gráfico Radar</h3>
          <p className="text-[10px] text-app-text4 mb-4">
            Perfil multidimensional de cada instrumento (0–1 normalizado)
          </p>
          <RadarChart
            data={radarData}
            colors={selectedInstruments.map((s) => SLOT_COLORS[s.slotIndex])}
            labels={selectedInstruments.map((s) => s.inst.ticker)}
          />
          {/* Legend */}
          <div className="flex items-center justify-center gap-4 mt-4">
            {selectedInstruments.map(({ inst, slotIndex }) => (
              <div key={inst.ticker} className="flex items-center gap-1.5">
                <span
                  className="w-3 h-3 rounded-sm"
                  style={{ backgroundColor: SLOT_COLORS[slotIndex], opacity: 0.7 }}
                />
                <span className="text-[10px] font-mono text-app-text2">
                  {SLOT_LABELS[slotIndex]}: {inst.ticker}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* BAR COMPARISON                                              */}
      {/* ═══════════════════════════════════════════════════════════ */}
      {comparisonData && selectedCount >= 2 && (
        <div className="glass-card p-5 animate-fadeInUp stagger-3">
          <h3 className="text-sm font-light text-app-text2 mb-1">📈 Barras Comparativas</h3>
          <p className="text-[10px] text-app-text4 mb-4">
            Visualización lado a lado de métricas clave
          </p>
          {METRICS.map((metric) => (
            <ComparisonBar
              key={metric.key}
              label={metric.label}
              values={comparisonData.map((d) => ({
                value: metric.getValue(d.inst, config, d.mom),
                slotLabel: SLOT_LABELS[d.slotIndex],
              }))}
              colors={comparisonData.map((d) => SLOT_COLORS[d.slotIndex])}
              formatFn={metric.format}
              higherIsBetter={metric.higherIsBetter}
            />
          ))}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* VERDICT CARD                                                */}
      {/* ═══════════════════════════════════════════════════════════ */}
      {verdict && (
        <div className="glass-card-accent p-6 animate-fadeInUp stagger-3">
          <div className="flex items-center gap-2 mb-4">
            <span className="px-3 py-1 rounded-full text-[10px] font-semibold bg-[#2eebc8]/15 text-[#2eebc8] compra-pulse">
              ⭐ GANADOR: {verdict.winner.inst.ticker}
            </span>
          </div>

          {/* Winner details */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 mb-4">
            <div>
              <div className="text-[10px] text-app-text4 uppercase tracking-wider mb-1">
                Instrumento
              </div>
              <div className="font-mono font-bold text-xl text-[#2eebc8]">
                {verdict.winner.inst.ticker}
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span
                  className={`px-2 py-0.5 rounded text-[9px] font-semibold ${
                    verdict.winner.inst.type === 'LECAP'
                      ? 'bg-app-accent-dim text-[#2eebc8]'
                      : 'bg-[#f472b6]/10 text-[#f472b6]'
                  }`}
                >
                  {verdict.winner.inst.type}
                </span>
                <span className="text-app-text4 text-[10px] font-mono">
                  {verdict.winner.inst.days}d
                </span>
              </div>
            </div>
            <div>
              <div className="text-[10px] text-app-text4 uppercase tracking-wider mb-1">
                Score Compuesto
              </div>
              <div className="font-mono font-bold text-xl text-app-text">
                {verdict.winner.score.toFixed(1)}
                <span className="text-app-text4 text-sm font-light">/10</span>
              </div>
            </div>
            <div>
              <div className="text-[10px] text-app-text4 uppercase tracking-wider mb-1">
                Spread vs Caución
              </div>
              <div
                className={`font-mono font-bold text-xl ${
                  verdict.winner.spread > 0.25
                    ? 'text-[#2eebc8]'
                    : verdict.winner.spread > 0
                      ? 'text-[#fbbf24]'
                      : 'text-[#f87171]'
                }`}
              >
                {verdict.winner.spread >= 0 ? '+' : ''}
                {verdict.winner.spread.toFixed(3)}%
              </div>
            </div>
          </div>

          {/* Category breakdown */}
          <div className="p-3 rounded-lg bg-app-subtle/30 mb-4">
            <div className="text-[10px] text-app-text4 uppercase tracking-wider mb-2">
              Desglose por Categoría
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              <span className="text-app-text2">
                Mejor Spread:{' '}
                <span
                  className="font-bold"
                  style={{ color: SLOT_COLORS[verdict.bestSpread.slotIndex] }}
                >
                  {SLOT_LABELS[verdict.bestSpread.slotIndex]} ({verdict.bestSpread.inst.ticker})
                </span>
              </span>
              <span className="text-app-text2">
                Mejor Momentum:{' '}
                <span
                  className="font-bold"
                  style={{ color: SLOT_COLORS[verdict.bestMomentum.slotIndex] }}
                >
                  {SLOT_LABELS[verdict.bestMomentum.slotIndex]} ({verdict.bestMomentum.inst.ticker})
                </span>
              </span>
              <span className="text-app-text2">
                Mejor Duración:{' '}
                <span
                  className="font-bold"
                  style={{ color: SLOT_COLORS[verdict.bestDuration.slotIndex] }}
                >
                  {SLOT_LABELS[verdict.bestDuration.slotIndex]} ({verdict.bestDuration.inst.ticker})
                </span>
              </span>
            </div>
          </div>

          {/* Reason text */}
          <div className="text-xs text-app-text3 mb-4">
            {verdict.winner.inst.ticker} lidera con un score compuesto de{' '}
            {verdict.winner.score.toFixed(1)}/10, impulsado por su spread de{' '}
            {verdict.winner.spread >= 0 ? '+' : ''}
            {verdict.winner.spread.toFixed(3)}% vs caución y duration modified de{' '}
            {Math.abs(verdict.winner.dm).toFixed(4)}.
            {verdict.winner.isTrampa && (
              <span className="text-[#f87171] font-semibold ml-1">
                ⚠️ TRAMPA: TEM inferior a la caución equivalente.
              </span>
            )}
          </div>

          {/* Quick action buttons (UI only) */}
          <div className="flex gap-2">
            <button
              className="px-4 py-2 rounded-lg text-xs font-semibold bg-app-accent-dim text-[#2eebc8] border border-app-accent-border btn-ripple transition-colors hover:bg-[#2eebc8]/15"
              type="button"
              aria-label={`Ver detalle de ${verdict.winner.inst.ticker}`}
            >
              Ver detalle
            </button>
            <button
              className="px-4 py-2 rounded-lg text-xs font-semibold bg-app-subtle/60 text-app-text2 border border-app-border/60 btn-ripple transition-colors hover:bg-app-hover"
              type="button"
              aria-label="Simular rotación"
            >
              Simular rotación
            </button>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* EMPTY STATE                                                 */}
      {/* ═══════════════════════════════════════════════════════════ */}
      {selectedCount < 2 && (
        <div className="glass-card p-5">
          <div className="text-center py-8">
            <div className="text-3xl mb-3">⚖️</div>
            <p className="text-app-text3 text-sm mb-2">
              Seleccioná al menos 2 instrumentos para comparar
            </p>
            <p className="text-[10px] text-app-text4">
              Usá los selectores de arriba para elegir los instrumentos A, B y C.
              El instrumento A ya tiene la mejor oportunidad preseleccionada.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
