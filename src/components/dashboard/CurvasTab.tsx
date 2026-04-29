'use client';

import React, { useState, useMemo } from 'react';
import { Instrument, Config, Position, MomentumData } from '@/lib/types';
import {
  caucionTEMFromTNA,
  durationMod,
  spreadVsCaucion,
  getCaucionForDays,
  analyzeCurveShape,
  detectCurveAnomalies,
} from '@/lib/calculations';
import ChartContainer from './ChartContainer';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  BarChart, Bar, Cell, ReferenceLine, AreaChart, Area,
} from 'recharts';

interface CurvasTabProps {
  instruments: Instrument[];
  config: Config;
  position: Position | null;
  momentumMap: Map<string, MomentumData>;
}

export default function CurvasTab({ instruments, config, position, momentumMap }: CurvasTabProps) {
  const [chartMode, setChartMode] = useState<'tem' | 'spread' | 'pendiente'>('tem');

  // ── Yield curve data ──
  const yieldCurveData = useMemo(() =>
    [...instruments]
      .sort((a, b) => a.days - b.days)
      .map(inst => ({
        days: inst.days,
        tem: inst.tem,
        type: inst.type,
        ticker: inst.ticker,
        price: inst.price,
        spread: spreadVsCaucion(inst.tem, config, inst.days),
        dm: Math.abs(durationMod(inst.days, inst.tem)),
        momentum: momentumMap.get(inst.ticker)?.deltaTIR ?? null,
      })),
    [instruments, config, momentumMap]
  );

  const lecapYield = yieldCurveData.filter(d => d.type === 'LECAP');
  const boncapYield = yieldCurveData.filter(d => d.type === 'BONCAP');

  // ── Slope (pendiente) data: TEM difference between consecutive instruments ──
  const slopeData = useMemo(() => {
    const sorted = [...yieldCurveData];
    const result: { days: number; ticker: string; slope: number; type: string }[] = [];
    for (let i = 1; i < sorted.length; i++) {
      const dayDiff = sorted[i].days - sorted[i - 1].days;
      const temDiff = sorted[i].tem - sorted[i - 1].tem;
      const slope = dayDiff > 0 ? (temDiff / dayDiff) * 30 : 0; // % per 30 days
      result.push({
        days: sorted[i].days,
        ticker: sorted[i].ticker,
        slope: parseFloat(slope.toFixed(4)),
        type: sorted[i].type,
      });
    }
    return result;
  }, [yieldCurveData]);

  // ── Spread curve data ──
  const spreadCurveData = useMemo(() =>
    [...yieldCurveData]
      .sort((a, b) => a.days - b.days)
      .map(d => ({
        days: d.days,
        spread: parseFloat(d.spread.toFixed(4)),
        ticker: d.ticker,
        type: d.type,
      })),
    [yieldCurveData]
  );

  // ── Curve analysis ──
  const curveAnalysis = analyzeCurveShape(instruments);
  const anomalies = detectCurveAnomalies(instruments);

  // ── Caución reference ──
  const caucionTEM7 = caucionTEMFromTNA(config.caucion7d);

  // ── Duration profile ──
  const durationData = useMemo(() =>
    [...instruments]
      .sort((a, b) => a.days - b.days)
      .map(inst => ({
        ticker: inst.ticker,
        days: inst.days,
        dm: Math.abs(durationMod(inst.days, inst.tem)),
        type: inst.type,
      })),
    [instruments]
  );

  // Chart theming — V1.6: Dark mode optimized
  const chartGridStroke = 'rgba(128, 128, 128, 0.12)';
  const chartTickFill = 'rgba(220, 220, 220, 0.8)';
  const chartLabelFill = 'rgba(220, 220, 220, 0.8)';

  const getCurveShapeColor = (s: string) => {
    switch (s) {
      case 'NORMAL': return '#00d4aa';
      case 'PLANA': return '#ffd700';
      case 'INVERTIDA': return '#ff4444';
      case 'CON_ANOMALIAS': return '#ff6b9d';
      default: return '#888';
    }
  };

  const getCurveShapeEmoji = (s: string) => {
    switch (s) {
      case 'NORMAL': return '✅';
      case 'PLANA': return '➡️';
      case 'INVERTIDA': return '⚠️';
      case 'CON_ANOMALIAS': return '🚨';
      default: return '❓';
    }
  };

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div>
        <h2 className="text-lg font-light text-app-text mb-1">📈 Curvas</h2>
        <p className="text-sm text-app-text4 font-light">Pendiente de tasas, spread por plazo y perfil de duration</p>
      </div>

      {/* ── SlopeChart SVG (V1.6.2 compact visual summary) ── */}
      <div className="glass-card p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] text-app-text3 uppercase tracking-wider font-medium">Resumen Visual — Curva TEM</span>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <svg width="8" height="8" viewBox="0 0 8 8"><circle cx="4" cy="4" r="4" fill="#2eebc8" /></svg>
              <span className="text-[8px] text-app-text4">LECAP</span>
            </div>
            <div className="flex items-center gap-1">
              <svg width="8" height="8" viewBox="0 0 8 8"><circle cx="4" cy="4" r="4" fill="#f472b6" /></svg>
              <span className="text-[8px] text-app-text4">BONCAP</span>
            </div>
          </div>
        </div>
        <svg width="100%" height="200" viewBox="0 0 600 200" preserveAspectRatio="xMidYMid meet">
          {/* Gradient fill under LECAP curve */}
          <defs>
            <linearGradient id="lecapAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2eebc8" stopOpacity="0.15" />
              <stop offset="100%" stopColor="#2eebc8" stopOpacity="0.01" />
            </linearGradient>
            <linearGradient id="boncapAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f472b6" stopOpacity="0.10" />
              <stop offset="100%" stopColor="#f472b6" stopOpacity="0.01" />
            </linearGradient>
          </defs>

          {/* Grid lines */}
          {Array.from({ length: 5 }).map((_, i) => (
            <line key={`grid-${i}`} x1="50" y1={20 + i * 40} x2="580" y2={20 + i * 40} stroke="rgba(128,128,128,0.1)" strokeWidth="0.5" />
          ))}

          {/* Axes */}
          <line x1="50" y1="20" x2="50" y2="180" stroke="rgba(128,128,128,0.2)" strokeWidth="1" />
          <line x1="50" y1="180" x2="580" y2="180" stroke="rgba(128,128,128,0.2)" strokeWidth="1" />

          {/* Y-axis labels (TEM %) */}
          {(() => {
            if (yieldCurveData.length === 0) return null;
            const minTEM = Math.min(...yieldCurveData.map(d => d.tem));
            const maxTEM = Math.max(...yieldCurveData.map(d => d.tem));
            const range = maxTEM - minTEM || 0.5;
            const toY = (tem: number) => 180 - ((tem - minTEM) / range) * 140 - 10;
            const maxDays = Math.max(...yieldCurveData.map(d => d.days), 1);
            const toX = (days: number) => 60 + (days / maxDays) * 510;

            // Draw area fills
            const lecapPoints = lecapYield.map(d => `${toX(d.days)},${toY(d.tem)}`).join(' ');
            const boncapPoints = boncapYield.map(d => `${toX(d.days)},${toY(d.tem)}`).join(' ');

            return (
              <>
                {/* LECAP area fill */}
                {lecapYield.length > 1 && (
                  <polygon
                    points={`60,180 ${lecapPoints} ${toX(lecapYield[lecapYield.length - 1].days)},180`}
                    fill="url(#lecapAreaGrad)"
                  />
                )}
                {/* BONCAP area fill */}
                {boncapYield.length > 1 && (
                  <polygon
                    points={`60,180 ${boncapPoints} ${toX(boncapYield[boncapYield.length - 1].days)},180`}
                    fill="url(#boncapAreaGrad)"
                  />
                )}

                {/* LECAP line */}
                {lecapYield.length > 1 && (
                  <polyline
                    fill="none"
                    stroke="#2eebc8"
                    strokeWidth="2"
                    points={lecapPoints}
                  />
                )}
                {/* BONCAP line */}
                {boncapYield.length > 1 && (
                  <polyline
                    fill="none"
                    stroke="#f472b6"
                    strokeWidth="2"
                    points={boncapPoints}
                  />
                )}

                {/* LECAP dots */}
                {lecapYield.map(d => (
                  <g key={`lecap-${d.ticker}`}>
                    <circle cx={toX(d.days)} cy={toY(d.tem)} r="4" className="slope-chart-dot slope-chart-dot-lecap" />
                    <text x={toX(d.days)} y={toY(d.tem) - 10} textAnchor="middle" fill="rgba(46,235,200,0.6)" fontSize="8" fontFamily="monospace">{d.ticker}</text>
                  </g>
                ))}
                {/* BONCAP dots */}
                {boncapYield.map(d => (
                  <g key={`boncap-${d.ticker}`}>
                    <circle cx={toX(d.days)} cy={toY(d.tem)} r="4" className="slope-chart-dot slope-chart-dot-boncap" />
                    <text x={toX(d.days)} y={toY(d.tem) - 10} textAnchor="middle" fill="rgba(244,114,182,0.6)" fontSize="8" fontFamily="monospace">{d.ticker}</text>
                  </g>
                ))}

                {/* Y-axis TEM labels */}
                <text x="45" y={toY(maxTEM) + 4} textAnchor="end" fill="rgba(128,128,128,0.5)" fontSize="8" fontFamily="monospace">{maxTEM.toFixed(1)}%</text>
                <text x="45" y={toY(minTEM) + 4} textAnchor="end" fill="rgba(128,128,128,0.5)" fontSize="8" fontFamily="monospace">{minTEM.toFixed(1)}%</text>
                <text x="45" y={toY((maxTEM + minTEM) / 2) + 4} textAnchor="end" fill="rgba(128,128,128,0.5)" fontSize="8" fontFamily="monospace">{((maxTEM + minTEM) / 2).toFixed(1)}%</text>

                {/* X-axis days labels */}
                <text x="60" y="195" textAnchor="middle" fill="rgba(128,128,128,0.5)" fontSize="8" fontFamily="monospace">0d</text>
                <text x={toX(maxDays)} y="195" textAnchor="middle" fill="rgba(128,128,128,0.5)" fontSize="8" fontFamily="monospace">{maxDays}d</text>
              </>
            );
          })()}
        </svg>
      </div>

      {/* ── Curve Summary ── */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="bg-app-card rounded-xl border border-app-border border-b-2 border-b-app-accent/20 p-4 card-hover-lift">
          <div className="flex items-center gap-2 mb-2">
            <span>{getCurveShapeEmoji(curveAnalysis.shape)}</span>
            <span className="text-[10px] text-app-text3 uppercase tracking-wider font-medium">Forma de Curva</span>
          </div>
          <div className="text-xl font-medium" style={{ color: getCurveShapeColor(curveAnalysis.shape) }}>
            {curveAnalysis.shape.replace('_', ' ')}
          </div>
          <div className="text-[10px] text-app-text4 mt-1">
            Pendiente: {curveAnalysis.slope.toFixed(3)}% TEM/30d
          </div>
        </div>

        <div className="bg-app-card rounded-xl border border-app-border border-b-2 border-b-app-accent/20 p-4 card-hover-lift">
          <div className="flex items-center gap-2 mb-2">
            <span>{anomalies.length === 0 ? '✅' : '🚨'}</span>
            <span className="text-[10px] text-app-text3 uppercase tracking-wider font-medium">Anomalías</span>
          </div>
          <div className="text-xl font-medium text-app-text">
            {anomalies.length}
          </div>
          <div className="text-[10px] text-app-text4 mt-1">
            {anomalies.filter(a => a.severity === 'CRITICA').length} crítica(s)
          </div>
        </div>

        <div className="bg-app-card rounded-xl border border-app-border border-b-2 border-b-app-accent/20 p-4 card-hover-lift">
          <div className="flex items-center gap-2 mb-2">
            <span>📊</span>
            <span className="text-[10px] text-app-text3 uppercase tracking-wider font-medium">Avg Spread</span>
          </div>
          <div className="text-xl font-medium text-app-accent-text">
            {yieldCurveData.length > 0
              ? `${(yieldCurveData.reduce((s, d) => s + d.spread, 0) / yieldCurveData.length).toFixed(3)}%`
              : '—'}
          </div>
          <div className="text-[10px] text-app-text4 mt-1">
            vs caución equivalente
          </div>
        </div>

        <div className="bg-app-card rounded-xl border border-app-border border-b-2 border-b-app-accent/20 p-4 card-hover-lift">
          <div className="flex items-center gap-2 mb-2">
            <span>📐</span>
            <span className="text-[10px] text-app-text3 uppercase tracking-wider font-medium">Avg DM</span>
          </div>
          <div className="text-xl font-medium text-app-text">
            {durationData.length > 0
              ? (durationData.reduce((s, d) => s + d.dm, 0) / durationData.length).toFixed(4)
              : '—'}
          </div>
          <div className="text-[10px] text-app-text4 mt-1">
            Duration modificada promedio
          </div>
        </div>
      </div>

      {/* ── Chart Mode Toggle ── */}
      <div className="flex gap-2">
        {[
          { mode: 'tem' as const, label: 'Curva TEM', icon: '📈' },
          { mode: 'spread' as const, label: 'Spread Caución', icon: '📊' },
          { mode: 'pendiente' as const, label: 'Pendiente', icon: '📐' },
        ].map(({ mode, label, icon }) => (
          <button
            key={mode}
            onClick={() => setChartMode(mode)}
            className={`px-4 py-2 text-xs font-medium rounded-lg border transition-all duration-200 ${
              chartMode === mode
                ? 'bg-[#2eebc8] text-[#0c1220] font-semibold border-[#2eebc8] shadow-lg shadow-[#2eebc8]/20 btn-ripple'
                : 'bg-app-card text-app-text2 border-app-border hover:bg-app-subtle/60'
            }`}
          >
            {icon} {label}
          </button>
        ))}
      </div>

      <div className="section-divider" />

      {/* ── Main Chart ── */}
      <div className="bg-app-card rounded-xl border border-app-border p-5">
        {chartMode === 'tem' && (
          <>
            <h3 className="text-sm font-medium text-app-text2 mb-4">Curva de Tasas (TEM vs Días al Vencimiento)</h3>
            <ChartContainer className="h-80">
              {({ width, height }) => (
                <LineChart width={width} height={height} margin={{ top: 10, right: 30, left: 15, bottom: 10 }} key={`tem-${width}-${height}`}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} />
                  <XAxis dataKey="days" type="number" domain={[0, 'dataMax']} tick={{ fill: chartTickFill, fontSize: 11 }} label={{ value: 'Días', position: 'insideBottomRight', offset: -5, fill: chartLabelFill, fontSize: 11 }} />
                  <YAxis domain={['dataMin - 0.1', 'dataMax + 0.1']} tick={{ fill: chartTickFill, fontSize: 11 }} label={{ value: 'TEM %', angle: -90, position: 'insideLeft', fill: chartLabelFill, fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '12px', fontSize: 12, color: '#FFFFFF', boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}
                    labelStyle={{ color: '#9CA3AF' }}
                    itemStyle={{ color: '#FFFFFF' }}
                    formatter={((value: number, name: string) => [`${Number(value).toFixed(2)}%`, name]) as never}
                    labelFormatter={(label: number) => `${label} días`}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line data={lecapYield} dataKey="tem" name="LECAPs" stroke="var(--app-accent)" strokeWidth={2.5} dot={{ fill: 'var(--app-accent)', r: 5 }} activeDot={{ r: 7, stroke: 'var(--app-accent)', strokeWidth: 2, fill: 'var(--app-accent)' }} />
                  <Line data={boncapYield} dataKey="tem" name="BONCAPs" stroke="var(--app-pink)" strokeWidth={2.5} dot={{ fill: 'var(--app-pink)', r: 5 }} activeDot={{ r: 7, stroke: 'var(--app-accent)', strokeWidth: 2, fill: 'var(--app-accent)' }} />
                  <ReferenceLine y={caucionTEM7} stroke="#ffd700" strokeDasharray="4 4" strokeWidth={1.5} label={{ value: `Cauc 7d ${caucionTEM7.toFixed(2)}%`, fill: '#ffd700', fontSize: 10 }} />
                </LineChart>
              )}
            </ChartContainer>
          </>
        )}

        {chartMode === 'spread' && (
          <>
            <h3 className="text-sm font-medium text-app-text2 mb-4">Spread vs Caución por Plazo</h3>
            <ChartContainer className="h-80">
              {({ width, height }) => (
                <AreaChart width={width} height={height} data={spreadCurveData} margin={{ top: 10, right: 30, left: 15, bottom: 10 }} key={`spc-${width}-${height}`}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} />
                  <XAxis dataKey="days" type="number" domain={[0, 'dataMax']} tick={{ fill: chartTickFill, fontSize: 11 }} label={{ value: 'Días', position: 'insideBottomRight', offset: -5, fill: chartLabelFill, fontSize: 11 }} />
                  <YAxis tick={{ fill: chartTickFill, fontSize: 11 }} label={{ value: 'Spread %', angle: -90, position: 'insideLeft', fill: chartLabelFill, fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '12px', fontSize: 12, color: '#FFFFFF', boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}
                    itemStyle={{ color: '#FFFFFF' }}
                    labelStyle={{ color: '#9CA3AF' }}
                    formatter={((value: number) => [`${Number(value).toFixed(3)}%`, 'Spread']) as never}
                    labelFormatter={(label: number) => `${label} días`}
                  />
                  <ReferenceLine y={0} stroke="rgba(128,128,128,0.3)" strokeWidth={1} />
                  <ReferenceLine y={config.comisionTotal} stroke="#ff6b9d" strokeDasharray="4 4" label={{ value: `Comisión ${config.comisionTotal.toFixed(2)}%`, fill: '#ff6b9d', fontSize: 10 }} />
                  <defs>
                    <linearGradient id="spreadGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#00d4aa" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#00d4aa" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <Area type="monotone" dataKey="spread" stroke="#00d4aa" strokeWidth={2} fill="url(#spreadGrad)" dot={{ fill: '#00d4aa', r: 4 }} />
                </AreaChart>
              )}
            </ChartContainer>
          </>
        )}

        {chartMode === 'pendiente' && (
          <>
            <h3 className="text-sm font-medium text-app-text2 mb-4">Pendiente de Tasas (ΔTEM cada 30 días)</h3>
            <ChartContainer className="h-80">
              {({ width, height }) => (
                <BarChart width={width} height={height} data={slopeData} margin={{ top: 10, right: 30, left: 15, bottom: 10 }} key={`sl-${width}-${height}`}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} />
                  <XAxis dataKey="ticker" type="category" tick={{ fill: '#FFFFFF', fontSize: 10 }} angle={-45} textAnchor="end" height={60} />
                  <YAxis tick={{ fill: chartTickFill, fontSize: 11 }} label={{ value: '% TEM/30d', angle: -90, position: 'insideLeft', fill: chartLabelFill, fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '12px', fontSize: 12, color: '#FFFFFF', boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}
                    itemStyle={{ color: '#FFFFFF' }}
                    labelStyle={{ color: '#9CA3AF', fontWeight: 600 }}
                    cursor={{ fill: 'rgba(46, 235, 200, 0.07)' }}
                    formatter={((value: number) => [`${Number(value).toFixed(4)}% /30d`, 'Pendiente']) as never}
                    labelFormatter={(label: string) => `${label}`}
                  />
                  <ReferenceLine y={0} stroke="rgba(128,128,128,0.3)" />
                  <Bar dataKey="slope" radius={[4, 4, 0, 0]}>
                    {slopeData.map((entry, index) => (
                      <Cell
                        key={index}
                        fill={entry.slope > 0 ? '#00d4aa' : entry.slope < -0.05 ? '#ff4444' : '#ffd700'}
                        fillOpacity={0.85}
                        style={{ transition: 'fill-opacity 150ms ease' }}
                        onMouseEnter={(e) => { e.target.style.fillOpacity = '0.7'; }}
                        onMouseLeave={(e) => { e.target.style.fillOpacity = '0.85'; }}
                      />
                    ))}
                  </Bar>
                </BarChart>
              )}
            </ChartContainer>
          </>
        )}
      </div>

      <div className="section-divider" />

      {/* ── Duration Profile ── */}
      <div className="glass-card p-5">
        <h3 className="text-sm font-medium text-app-text2 mb-4">Perfil de Duration Modificada</h3>
        <ChartContainer className="h-64">
          {({ width, height }) => (
            <BarChart width={width} height={height} data={durationData} margin={{ top: 5, right: 30, left: 15, bottom: 5 }} key={`dm-${width}-${height}`}>
              <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} />
              <XAxis dataKey="ticker" tick={{ fill: '#FFFFFF', fontSize: 9 }} angle={-45} textAnchor="end" height={60} />
              <YAxis tick={{ fill: chartTickFill, fontSize: 11 }} label={{ value: 'DM', angle: -90, position: 'insideLeft', fill: chartLabelFill, fontSize: 11 }} />
              <Tooltip
                contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '12px', fontSize: 12, color: '#FFFFFF', boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}
                itemStyle={{ color: '#FFFFFF' }}
                labelStyle={{ color: '#9CA3AF' }}
                cursor={{ fill: 'rgba(46, 235, 200, 0.07)' }}
                formatter={((value: number) => [Number(value).toFixed(4), 'Duration Mod.']) as never}
              />
              <Bar dataKey="dm" radius={[4, 4, 0, 0]}>
                {durationData.map((entry, index) => (
                  <Cell
                    key={index}
                    fill={entry.type === 'LECAP' ? 'var(--app-accent)' : 'var(--app-pink)'}
                    fillOpacity={0.75}
                    style={{ transition: 'fill-opacity 150ms ease' }}
                    onMouseEnter={(e) => { e.target.style.fillOpacity = '0.55'; }}
                    onMouseLeave={(e) => { e.target.style.fillOpacity = '0.75'; }}
                  />
                ))}
              </Bar>
            </BarChart>
          )}
        </ChartContainer>
      </div>

      <div className="section-divider" />

      {/* ── Anomaly Detail ── */}
      {anomalies.length > 0 && (
        <div className="glass-card p-5">
          <h3 className="text-sm font-medium text-app-text2 mb-3">🚨 Anomalías Detectadas en la Curva</h3>
          <div className="space-y-2">
            {anomalies.map((a, i) => {
              const isPositionAffected = position?.ticker === a.longerTicker || position?.ticker === a.shorterTicker;
              return (
                <div
                  key={`anom-${i}`}
                  className={`text-xs p-3.5 rounded-lg border-l-4 ${isPositionAffected ? 'bg-red-500/8' : 'bg-app-subtle/40'}`}
                  style={{ borderLeftColor: a.severity === 'CRITICA' ? '#ff4444' : a.severity === 'ALTA' ? '#d97706' : '#ca8a04' }}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide" style={{ backgroundColor: a.anomalyType === 'INVERSION' ? '#dc2626' : a.anomalyType === 'SALTO_ANORMAL' ? '#d97706' : '#ca8a04', color: '#fff' }}>
                      {a.anomalyType}
                    </span>
                    <span className="font-mono font-medium text-app-text2">{a.longerTicker} ({a.longerDays}d)</span>
                    <span className="text-app-danger">vs</span>
                    <span className="font-mono font-medium text-app-text2">{a.shorterTicker} ({a.shorterDays}d)</span>
                    <span className="text-app-danger font-medium">Δ = −{a.temDiff.toFixed(3)}% TEM</span>
                    <span className="px-2 py-0.5 rounded text-[9px] font-medium" style={{ backgroundColor: a.severity === 'CRITICA' ? '#991b1b' : '#854d0e', color: a.severity === 'CRITICA' ? '#fecaca' : '#fef08a' }}>
                      {a.severity}
                    </span>
                    {isPositionAffected && (
                      <span className="px-1.5 py-0.5 rounded text-[8px] font-medium bg-app-accent/20 text-app-accent-text">
                        📌 EN CARTERA
                      </span>
                    )}
                  </div>
                  {a.actionDetail && (
                    <div className="mt-1.5 text-app-text3">{a.actionDetail}</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Curve Description ── */}
      <div className="glass-card p-5">
        <div className="text-[10px] text-app-text3 uppercase tracking-wider mb-2 font-medium">Descripción de la Curva</div>
        <div className="text-sm text-app-text2 font-light leading-relaxed">
          {curveAnalysis.description}
        </div>
      </div>
    </div>
  );
}
