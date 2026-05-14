'use client';

import React, { useState, useMemo, useCallback, useRef } from 'react';
import { Transaction, Instrument, Config, Position, ExternalHistoryRecord } from '@/lib/types';
import { parseCSVLine, parseNumber, excelSerialToDate, isExcelDateSerial, cellToString, cellToNumber, parseXlsxRows, sanitizeNumber, sanitizeExternalRecord } from '@/lib/parsers';

// ════════════════════════════════════════════════════════════════════════
// V2.0 — HistorialTab: PURE EVENT LOG (SSOT Architecture)
//
// PRINCIPLE: This component is a READ-ONLY visual log of operations.
// It does NOT compute Capital Neto or P&L. Those values come EXCLUSIVELY
// from the Cartera tab (computed in page.tsx as SSOT props).
// The external history data is displayed as-is for reference only.
// ════════════════════════════════════════════════════════════════════════

// ── Props ──
interface HistorialTabProps {
  transactions: Transaction[];
  instruments: Instrument[];
  config: Config;
  position: Position | null;
  externalHistory: ExternalHistoryRecord[];
  setExternalHistory: (v: ExternalHistoryRecord[]) => void;
  // V2.0 — SSOT values computed from Cartera state in page.tsx
  capitalNetoSSOT: number;   // Cash + Invested at market price
  pnlTotalSSOT: number;      // Realized PnL + Unrealized PnL
  realizedPnL: number;       // Sum of SELL transaction pnl
  unrealizedPnL: number;     // Current position unrealized P&L
}

// ── Date range filter type ──
type DateRange = 'semana' | 'mes' | 'todo';
type TypeFilter = 'todos' | 'compras' | 'ventas';

// ── Helpers ──
function parseDate(dateStr: string): Date {
  const parts = dateStr.split('/');
  if (parts.length === 3) {
    const [day, month, year] = parts;
    return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
  }
  return new Date(dateStr);
}

function isWithinRange(dateStr: string, range: DateRange): boolean {
  if (range === 'todo') return true;
  const date = parseDate(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  if (range === 'semana') return diffDays <= 7;
  if (range === 'mes') return diffDays <= 30;
  return true;
}

function formatCurrency(value: number): string {
  return value.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ════════════════════════════════════════════════════════════════════════
// V2.0.5 — Parsing utilities now imported from @/lib/parsers
// (parseCSVLine, parseNumber, excelSerialToDate, isExcelDateSerial,
//  cellToString, cellToNumber, parseXlsxRows, sanitizeNumber,
//  sanitizeExternalRecord)
// ════════════════════════════════════════════════════════════════════════

// Detect if a record is a "fondeo/depósito" row that should not be counted as an operation
function isFondeoRow(rec: ExternalHistoryRecord): boolean {
  const op = rec.operacion.toLowerCase();
  return op.includes('fondeo') || op.includes('depósito') || op.includes('deposito') || op.includes('inicio');
}

// ── Mini sparkline SVG for ganancia acumulada ──
function MiniSparkline({ data, width = 64, height = 20 }: { data: number[]; width?: number; height?: number }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 0.01;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  }).join(' ');
  const lastY = height - ((data[data.length - 1] - min) / range) * (height - 4) - 2;
  const isUp = data[data.length - 1] >= data[0];
  const color = isUp ? '#2eebc8' : '#f87171';
  return (
    <svg width={width} height={height} className="inline-block">
      <polyline fill="none" stroke={color} strokeWidth="1.5" points={points} />
      <circle cx={width} cy={lastY} r="2" fill={color} />
    </svg>
  );
}

// ── CSV Export ──
function exportTransactionsCSV(transactions: Transaction[]) {
  const today = new Date().toISOString().split('T')[0];
  const header = 'Fecha,Tipo,Ticker,Precio,VN,PnL,PrecioConComision\n';
  const rows = transactions.map(tx => {
    const pnlStr = tx.pnl !== undefined ? tx.pnl.toFixed(2) : '';
    const pccStr = tx.precioConComision !== undefined ? tx.precioConComision.toFixed(4) : '';
    return `${tx.date},${tx.type},${tx.ticker},${tx.price.toFixed(4)},${tx.vn},${pnlStr},${pccStr}`;
  }).join('\n');
  const csv = header + rows;
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `historial_${today}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

// ── Summary Export ──
function exportSummary(transactions: Transaction[], pnlTotalSSOT: number) {
  const today = new Date().toISOString().split('T')[0];
  const buyCount = transactions.filter(t => t.type === 'BUY').length;
  const sellCount = transactions.filter(t => t.type === 'SELL').length;
  const tickers = [...new Set(transactions.map(t => t.ticker))];

  const lines = [
    `Resumen de Historial ARB-RADAR (V2.0 SSOT)`,
    `Fecha de exportación: ${today}`,
    ``,
    `--- Fuente de Verdad: Cartera ---`,
    `P&L Total (SSOT): ${pnlTotalSSOT >= 0 ? '+' : ''}${formatCurrency(pnlTotalSSOT)}`,
    ``,
    `--- Operaciones en Vivo ---`,
    `Total Operaciones: ${transactions.length}`,
    `Compras: ${buyCount}`,
    `Ventas: ${sellCount}`,
    `Instrumentos operados: ${tickers.join(', ')}`,
    ``,
    `--- Detalle por Ticker ---`,
  ];

  tickers.forEach(ticker => {
    const tickerTxs = transactions.filter(t => t.ticker === ticker);
    const buys = tickerTxs.filter(t => t.type === 'BUY');
    const sells = tickerTxs.filter(t => t.type === 'SELL');
    const pnl = tickerTxs.reduce((sum, t) => sum + (t.pnl || 0), 0);
    lines.push(`${ticker}: ${buys.length} compras, ${sells.length} ventas, P&L: ${pnl >= 0 ? '+' : ''}${formatCurrency(pnl)}`);
  });

  const text = lines.join('\n');
  const blob = new Blob(['\ufeff' + text], { type: 'text/plain;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `resumen_historial_${today}.txt`;
  link.click();
  URL.revokeObjectURL(url);
}

// ── Main Component ──
export default function HistorialTab({
  transactions,
  instruments,
  config,
  position,
  externalHistory,
  setExternalHistory,
  capitalNetoSSOT,
  pnlTotalSSOT,
  realizedPnL,
  unrealizedPnL,
}: HistorialTabProps) {
  // ── Filter State ──
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('todos');
  const [dateRange, setDateRange] = useState<DateRange>('todo');
  const [externalExpanded, setExternalExpanded] = useState(externalHistory.length === 0);

  // V2.0 — Upload state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importStatus, setImportStatus] = useState<string>('');
  const [isDragOver, setIsDragOver] = useState(false);

  // ── V2.0 — Sanitized external history (normalized data) ──
  const sanitizedExternalHistory = useMemo(() => {
    return externalHistory.map(sanitizeExternalRecord);
  }, [externalHistory]);

  // ── V2.0 — File Upload Handler ──
  const handleFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const fileName = file.name.toLowerCase();
    const isExcel = fileName.endsWith('.xlsx') || fileName.endsWith('.xls');

    setImportStatus(`Procesando ${file.name}...`);

    try {
      if (isExcel) {
        const XLSX = await import('xlsx');
        const arrayBuffer = await file.arrayBuffer();
        const workbook = XLSX.read(arrayBuffer, { type: 'array' });

        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const sheetsInfo = workbook.SheetNames.length > 1
          ? ` (${workbook.SheetNames.length} hojas disponibles, se usó "${sheetName}")`
          : '';

        const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: '' });

        if (jsonData.length === 0) {
          setImportStatus('⚠️ El archivo está vacío o no tiene datos.');
          return;
        }

        const headers = Object.keys(jsonData[0]);
        const records = parseXlsxRows(jsonData, headers);

        if (records.length === 0) {
          setImportStatus('⚠️ No se encontraron registros válidos. Verificá las columnas.');
          return;
        }

        setExternalHistory(records);
        setExternalExpanded(true);
        setImportStatus(`✅ ${records.length} registros importados de ${file.name} (hoja: ${sheetName})${sheetsInfo}`);
      } else {
        // CSV / TSV / text
        const text = await file.text();
        if (!text || text.trim().length === 0) {
          setImportStatus('⚠️ El archivo está vacío.');
          return;
        }

        const lines = text.trim().split('\n');
        if (lines.length < 2) {
          setImportStatus('⚠️ El archivo debe tener al menos una fila de encabezado y una de datos.');
          return;
        }

        const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().replace(/[^a-z0-9áéíóúñ_]/g, ''));

        const records: ExternalHistoryRecord[] = [];
        for (let i = 1; i < lines.length; i++) {
          const values = parseCSVLine(lines[i]);
          if (values.length < 3) continue;

          const record: ExternalHistoryRecord = {
            fecha: values[0] || '',
            ticker: values[1] || '',
            operacion: values[2] || '',
            tem: values[3] ? parseNumber(values[3]) : 0,
            precioConComision: values[4] ? parseNumber(values[4]) : 0,
            duration: values[5] ? parseNumber(values[5]) : 0,
            capitalNeto: values[6] ? parseNumber(values[6]) : 0,
            notas: values[7] || '',
            gananciaAcumulada: values[8] ? parseNumber(values[8]) : 0,
          };

          // Smart header matching
          headers.forEach((header, idx) => {
            if (values[idx] === undefined) return;
            if (header.includes('fecha') || header.includes('date')) record.fecha = values[idx];
            else if (header.includes('ticker') || header.includes('instrumento')) record.ticker = values[idx];
            else if (header.includes('operacion') || header.includes('oper') || header.includes('tipo')) record.operacion = values[idx];
            else if (header.includes('tem')) record.tem = parseNumber(values[idx]);
            else if (header.includes('precio') || header.includes('price')) record.precioConComision = parseNumber(values[idx]);
            else if (header.includes('duration') || header.includes('duracion')) record.duration = parseNumber(values[idx]);
            else if (header.includes('capital') || header.includes('neto')) record.capitalNeto = parseNumber(values[idx]);
            else if (header.includes('nota') || header.includes('note') || header.includes('obs')) record.notas = values[idx];
            else if (header.includes('ganancia') || header.includes('acum') || header.includes('p&l') || header.includes('profit')) record.gananciaAcumulada = parseNumber(values[idx]);
          });

          // V2.0: Sanitize before adding
          records.push(sanitizeExternalRecord(record));
        }

        if (records.length === 0) {
          setImportStatus('⚠️ No se encontraron registros válidos. Verificá las columnas.');
          return;
        }

        setExternalHistory(records);
        setExternalExpanded(true);
        setImportStatus(`✅ ${records.length} registros importados de ${file.name}`);
      }
    } catch (err) {
      console.error('Error importing file:', err);
      setImportStatus(`❌ Error al leer el archivo: ${err instanceof Error ? err.message : 'Error desconocido'}`);
    }

    // Reset file input
    if (event.target) event.target.value = '';
  }, [setExternalHistory]);

  // ── Drag & Drop Handlers ──
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileUpload({ target: { files, value: '' } } as React.ChangeEvent<HTMLInputElement>);
    }
  }, [handleFileUpload]);

  // ── Computed: Filtered Transactions ──
  const filteredTransactions = useMemo(() => {
    let result = [...transactions];

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(tx => tx.ticker.toLowerCase().includes(q));
    }

    if (typeFilter === 'compras') {
      result = result.filter(tx => tx.type === 'BUY');
    } else if (typeFilter === 'ventas') {
      result = result.filter(tx => tx.type === 'SELL');
    }

    if (dateRange !== 'todo') {
      result = result.filter(tx => isWithinRange(tx.date, dateRange));
    }

    return result;
  }, [transactions, searchQuery, typeFilter, dateRange]);

  // ════════════════════════════════════════════════════════════════════════
  // V2.0 — LOG-ONLY STATS (no financial accumulation)
  // These are purely descriptive counts for the event log.
  // Capital Neto and P&L come exclusively from SSOT props.
  // ════════════════════════════════════════════════════════════════════════
  const logStats = useMemo(() => {
    // Live transaction counts
    const liveTotal = transactions.length;
    const liveBuys = transactions.filter(t => t.type === 'BUY').length;
    const liveSells = transactions.filter(t => t.type === 'SELL').length;

    // External counts (excluding fondeo rows to avoid inflation)
    const extAll = sanitizedExternalHistory.length;
    const extOperations = sanitizedExternalHistory.filter(r => !isFondeoRow(r)).length;
    const extFondeos = extAll - extOperations;

    return {
      liveTotal,
      liveBuys,
      liveSells,
      extAll,
      extOperations,
      extFondeos,
    };
  }, [transactions, sanitizedExternalHistory]);

  // ── Computed: External-only ganancia acumulada sparkline data ──
  // This is purely visual — shows the imported data's trajectory.
  // It does NOT feed into any financial calculation.
  const externalGananciaData = useMemo(() => {
    if (sanitizedExternalHistory.length === 0) return [];
    return sanitizedExternalHistory.map(r => r.gananciaAcumulada);
  }, [sanitizedExternalHistory]);

  // ── Computed: Event Timeline (purely visual, read-only) ──
  // Lists events chronologically. Shows external capitalNeto as reference only.
  // Does NOT reconstruct or compute capital.
  const eventTimeline = useMemo(() => {
    const events: {
      date: string;
      label: string;
      detail: string;
      isExternal: boolean;
      referenceCapital?: number; // External data reference (read-only)
      pnl?: number;             // Live PnL for SELL transactions
    }[] = [];

    // External history events (reference data, not computed)
    for (const rec of sanitizedExternalHistory) {
      events.push({
        date: rec.fecha,
        label: `${rec.ticker} ${rec.operacion}`,
        detail: `TEM: ${rec.tem.toFixed(2)}% · Precio: $${rec.precioConComision.toFixed(4)}${rec.notas ? ` · ${rec.notas}` : ''}`,
        isExternal: true,
        referenceCapital: rec.capitalNeto, // As recorded in the external file
        pnl: undefined,
      });
    }

    // Live transaction events
    for (const tx of transactions) {
      events.push({
        date: tx.date,
        label: `${tx.type === 'BUY' ? 'Compra' : 'Venta'} ${tx.ticker}`,
        detail: `${tx.vn.toLocaleString('es-AR')} VN @ $${tx.price.toFixed(4)}`,
        isExternal: false,
        referenceCapital: undefined,
        pnl: tx.type === 'SELL' ? tx.pnl : undefined,
      });
    }

    // Sort by date
    events.sort((a, b) => {
      const da = parseDate(a.date);
      const db = parseDate(b.date);
      return da.getTime() - db.getTime();
    });

    return events;
  }, [sanitizedExternalHistory, transactions]);

  // ── Clear Filters ──
  const clearFilters = useCallback(() => {
    setSearchQuery('');
    setTypeFilter('todos');
    setDateRange('todo');
  }, []);

  // ── Has active filters ──
  const hasActiveFilters = searchQuery.trim() !== '' || typeFilter !== 'todos' || dateRange !== 'todo';

  return (
    <div className="space-y-6 animate-fadeInUp">
      {/* ── Header ── */}
      <div>
        <h2 className="text-lg font-light text-app-text mb-1">📋 Historial</h2>
        <p className="text-sm text-app-text3">Registro visual de operaciones · Fuente de verdad: Cartera</p>
      </div>

      {/* ════════════════════════════════════════════════════════════════ */}
      {/* V2.0 — SSOT SUMMARY: All financial data from Cartera          */}
      {/* These values are NOT computed here. They come from page.tsx      */}
      {/* which computes them from the same state as CarteraTab.           */}
      {/* ════════════════════════════════════════════════════════════════ */}
      <div className="glass-card-accent p-5">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-2 h-2 rounded-full bg-[#2eebc8] animate-pulse" />
          <span className="text-[10px] text-[#2eebc8] uppercase tracking-wider font-semibold">Fuente de Verdad · Cartera</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* Capital Neto SSOT */}
          <div>
            <div className="text-[10px] text-app-text3 uppercase tracking-wider mb-1">Capital Neto</div>
            <div className="font-mono text-xl font-medium text-app-accent-text">
              ${formatCurrency(capitalNetoSSOT)}
            </div>
            <div className="text-[8px] text-app-text4 mt-0.5">
              Caja: ${formatCurrency(config.capitalDisponible)}
              {position && ' + Invertido'}
            </div>
          </div>

          {/* P&L Total SSOT */}
          <div>
            <div className="text-[10px] text-app-text3 uppercase tracking-wider mb-1">P&L Total</div>
            <div className={`font-mono text-xl font-medium ${pnlTotalSSOT >= 0 ? 'text-[#2eebc8]' : 'text-[#f87171]'}`}>
              {pnlTotalSSOT >= 0 ? '+' : ''}${formatCurrency(pnlTotalSSOT)}
            </div>
            <div className="text-[8px] text-app-text4 mt-0.5">
              Realizado: {realizedPnL >= 0 ? '+' : ''}${formatCurrency(realizedPnL)}
              {unrealizedPnL !== 0 && (
                <> · No realizado: {unrealizedPnL >= 0 ? '+' : ''}${formatCurrency(unrealizedPnL)}</>
              )}
            </div>
          </div>

          {/* Live Operation Count (LOG ONLY) */}
          <div>
            <div className="text-[10px] text-app-text3 uppercase tracking-wider mb-1">Operaciones Vivo</div>
            <div className="font-mono text-xl font-medium text-app-text">
              {logStats.liveTotal}
            </div>
            <div className="text-[8px] text-app-text4 mt-0.5">
              {logStats.liveBuys} compras · {logStats.liveSells} ventas
            </div>
          </div>

          {/* External Record Count (LOG ONLY) */}
          <div>
            <div className="text-[10px] text-app-text3 uppercase tracking-wider mb-1">Registros Externos</div>
            <div className="font-mono text-xl font-medium text-app-text">
              {logStats.extOperations}
            </div>
            <div className="text-[8px] text-app-text4 mt-0.5">
              {logStats.extAll} total{logStats.extFondeos > 0 ? ` (${logStats.extFondeos} fondeo)` : ''}
            </div>
          </div>
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════════════ */}
      {/* V2.0 — UPLOAD SECTION: Cargar Operaciones (Excel/CSV)        */}
      {/* ════════════════════════════════════════════════════════════════ */}
      <div className="glass-card p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-app-text2">📂 Cargar Operaciones (Excel/CSV)</h3>
          <div className="flex items-center gap-2">
            {externalHistory.length > 0 && (
              <button
                onClick={() => setExternalHistory([])}
                className="px-3 py-1.5 rounded-lg text-[11px] font-medium bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-all"
                title="Limpiar historial externo"
              >
                🗑️ Limpiar
              </button>
            )}
          </div>
        </div>

        {/* Column mapping guide */}
        <div className="bg-app-subtle/50 rounded-lg p-3 mb-3">
          <div className="text-[9px] text-app-text4 uppercase tracking-wider font-semibold mb-1.5">Columnas reconocidas</div>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {['Fecha', 'Ticker', 'Operación', 'TEM', 'Precio (c/com)', 'Duration', 'Capital Neto', 'Notas', 'Ganancia Acum.'].map(col => (
              <span key={col} className="text-[10px] font-mono text-app-text3 bg-app-card/60 px-1.5 py-0.5 rounded">
                {col}
              </span>
            ))}
          </div>
          <div className="text-[9px] text-app-text4 mt-1.5">
            Formatos: .xlsx, .xls, .csv, .tsv, .txt · Separadores: coma, punto y coma, tabulación
          </div>
          <div className="text-[8px] text-[#fbbf24]/70 mt-1">
            ⚠ Los datos importados son solo de referencia visual. El cálculo de Capital Neto y P&L depende exclusivamente de la pestaña Cartera (SSOT).
          </div>
        </div>

        {/* Drag & Drop Zone */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`relative border-2 border-dashed rounded-xl p-6 text-center transition-all duration-200 cursor-pointer ${
            isDragOver
              ? 'border-[#2eebc8]/60 bg-[#2eebc8]/5'
              : 'border-app-border/40 hover:border-app-border/60 hover:bg-app-subtle/20'
          }`}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv,.tsv,.txt"
            onChange={handleFileUpload}
            className="hidden"
          />
          <div className="text-3xl mb-2 opacity-40">📄</div>
          <p className="text-sm text-app-text3">
            {isDragOver ? (
              <span className="text-[#2eebc8] font-medium">Soltá el archivo aquí</span>
            ) : (
              <>
                Arrastrá tu archivo o <span className="text-[#22d3ee] hover:underline">hacé clic para seleccionar</span>
              </>
            )}
          </p>
          <p className="text-[10px] text-app-text4 mt-1">Excel (.xlsx/.xls) o CSV/TSV con las operaciones en simulación</p>
        </div>

        {/* Import status */}
        {importStatus && (
          <div className={`mt-3 p-2.5 rounded-lg text-xs ${
            importStatus.startsWith('✅') ? 'bg-[#2eebc8]/10 text-[#2eebc8]' :
            importStatus.startsWith('⚠️') ? 'bg-amber-500/10 text-amber-400' :
            importStatus.startsWith('❌') ? 'bg-red-500/10 text-red-400' :
            'bg-app-subtle/50 text-app-text3'
          }`}>
            {importStatus}
          </div>
        )}
      </div>

      {/* ── Search and Filter Bar ── */}
      <div className="glass-card p-5">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          {/* Search Input */}
          <div className="relative flex-1 w-full sm:max-w-xs">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-app-text4 text-sm">🔍</span>
            <input
              type="text"
              placeholder="Buscar por ticker..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-app-input border border-app-border rounded-lg text-xs text-app-text placeholder:text-app-text4 focus:border-[#2eebc8]/40 focus:ring-0 transition-colors"
            />
          </div>

          {/* Type Filter Chips */}
          <div className="flex items-center gap-1.5">
            {([
              { key: 'todos' as TypeFilter, label: 'Todos' },
              { key: 'compras' as TypeFilter, label: 'Compras' },
              { key: 'ventas' as TypeFilter, label: 'Ventas' },
            ]).map(chip => (
              <button
                key={chip.key}
                onClick={() => setTypeFilter(chip.key)}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all duration-200 ${
                  typeFilter === chip.key
                    ? chip.key === 'compras'
                      ? 'bg-[#2eebc8]/15 text-[#2eebc8] border border-[#2eebc8]/30'
                      : chip.key === 'ventas'
                        ? 'bg-[#f87171]/15 text-[#f87171] border border-[#f87171]/30'
                        : 'bg-app-accent-dim text-app-accent-text border border-app-accent-border'
                    : 'bg-app-subtle/60 text-app-text3 border border-app-border/60 hover:bg-app-hover'
                }`}
              >
                {chip.label}
              </button>
            ))}
          </div>

          {/* Date Range Filter */}
          <div className="flex items-center gap-1.5">
            {([
              { key: 'semana' as DateRange, label: 'Última semana' },
              { key: 'mes' as DateRange, label: 'Último mes' },
              { key: 'todo' as DateRange, label: 'Todo' },
            ]).map(range => (
              <button
                key={range.key}
                onClick={() => setDateRange(range.key)}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all duration-200 ${
                  dateRange === range.key
                    ? 'bg-[#22d3ee]/10 text-[#22d3ee] border border-[#22d3ee]/30'
                    : 'bg-app-subtle/60 text-app-text3 border border-app-border/60 hover:bg-app-hover'
                }`}
              >
                {range.label}
              </button>
            ))}
          </div>

          {/* Clear Filters */}
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="px-3 py-1.5 rounded-lg text-[11px] font-medium bg-app-subtle/60 text-app-text3 border border-app-border/60 hover:bg-app-hover hover:text-app-text2 transition-all"
            >
              ✕ Limpiar
            </button>
          )}

          {/* Result Count */}
          <div className="text-[10px] text-app-text4 font-mono whitespace-nowrap ml-auto">
            {filteredTransactions.length} resultado{filteredTransactions.length !== 1 ? 's' : ''}
          </div>
        </div>
      </div>

      {/* ── Transaction Table (Live) — EVENT LOG ── */}
      <div className="glass-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-app-text2">
            Operaciones en Vivo
            <span className="text-[10px] text-app-text4 ml-1.5 font-mono">({logStats.liveTotal})</span>
          </h3>
          <div className="flex items-center gap-2">
            {/* Export Buttons */}
            <button
              onClick={() => exportTransactionsCSV(filteredTransactions)}
              disabled={filteredTransactions.length === 0}
              className="px-3 py-1.5 rounded-lg text-[11px] font-medium bg-app-subtle/60 text-app-text3 border border-app-border/60 hover:bg-app-hover hover:text-app-text2 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
              title="Exportar CSV"
            >
              📥 CSV
            </button>
            <button
              onClick={() => exportSummary(filteredTransactions, pnlTotalSSOT)}
              disabled={filteredTransactions.length === 0}
              className="px-3 py-1.5 rounded-lg text-[11px] font-medium bg-app-subtle/60 text-app-text3 border border-app-border/60 hover:bg-app-hover hover:text-app-text2 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
              title="Exportar Resumen"
            >
              📊 Resumen
            </button>
          </div>
        </div>

        {filteredTransactions.length === 0 ? (
          /* Empty State */
          <div className="text-center py-8">
            <div className="text-3xl mb-2 opacity-40">📋</div>
            <p className="text-sm text-app-text3">Sin operaciones en vivo registradas</p>
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="mt-2 text-[11px] text-[#22d3ee] hover:underline"
              >
                Limpiar filtros para ver todas las operaciones
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto max-h-96 overflow-y-auto custom-scrollbar">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-app-card z-10">
                <tr className="border-b border-app-border/60">
                  <th className="px-4 py-3 text-left text-[11px] uppercase tracking-wider font-medium text-app-text3">Fecha</th>
                  <th className="px-4 py-3 text-left text-[11px] uppercase tracking-wider font-medium text-app-text3">Tipo</th>
                  <th className="px-4 py-3 text-left text-[11px] uppercase tracking-wider font-medium text-app-text3">Ticker</th>
                  <th className="px-4 py-3 text-right text-[11px] uppercase tracking-wider font-medium text-app-text3">Precio</th>
                  <th className="px-4 py-3 text-right text-[11px] uppercase tracking-wider font-medium text-app-text3">VN</th>
                  <th className="px-4 py-3 text-right text-[11px] uppercase tracking-wider font-medium text-app-text3">P&amp;L</th>
                  <th className="px-4 py-3 text-right text-[11px] uppercase tracking-wider font-medium text-app-text3 hidden sm:table-cell">Comisión</th>
                  <th className="px-4 py-3 text-right text-[11px] uppercase tracking-wider font-medium text-app-text3 hidden md:table-cell">Costo c/Com.</th>
                </tr>
              </thead>
              <tbody>
                {filteredTransactions.map((tx) => {
                  const isBuy = tx.type === 'BUY';
                  const grossValue = tx.vn * tx.price;
                  const commissionHalf = grossValue * (config.comisionTotal / 2 / 100);

                  return (
                    <tr
                      key={tx.id}
                      className={`border-b border-app-border/40 table-row-highlight ${
                        isBuy ? 'hover:bg-[#2eebc8]/5' : 'hover:bg-[#f87171]/5'
                      }`}
                    >
                      <td className="px-4 py-3 font-mono text-app-text3">{tx.date}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-lg text-[10px] font-semibold ${
                            isBuy
                              ? 'bg-[#2eebc8]/10 text-[#2eebc8] border border-[#2eebc8]/20'
                              : 'bg-[#f87171]/10 text-[#f87171] border border-[#f87171]/20'
                          }`}
                        >
                          {isBuy ? 'COMPRA' : 'VENTA'}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono font-medium text-app-text2">{tx.ticker}</td>
                      <td className="px-4 py-3 font-mono text-app-text2 text-right">${tx.price.toFixed(4)}</td>
                      <td className="px-4 py-3 font-mono text-app-text3 text-right">{tx.vn.toLocaleString('es-AR')}</td>
                      <td className="px-4 py-3 font-mono text-right">
                        {tx.pnl !== undefined ? (
                          <span className={tx.pnl >= 0 ? 'text-[#2eebc8]' : 'text-[#f87171]'}>
                            {tx.pnl >= 0 ? '+' : ''}${formatCurrency(tx.pnl)}
                          </span>
                        ) : (
                          <span className="text-app-text4">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-app-text4 text-right hidden sm:table-cell">
                        -${formatCurrency(commissionHalf)}
                      </td>
                      <td className="px-4 py-3 font-mono text-app-text3 text-right hidden md:table-cell">
                        {tx.precioConComision !== undefined ? (
                          `$${tx.precioConComision.toFixed(4)}`
                        ) : (
                          <span className="text-app-text4">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── External History Section — REFERENCE DATA ONLY ── */}
      {sanitizedExternalHistory.length > 0 && (
        <div className="glass-card p-5">
          {/* Collapsible Header */}
          <button
            onClick={() => setExternalExpanded(!externalExpanded)}
            className="w-full flex items-center justify-between group"
          >
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-medium text-app-text2">Historial Externo</h3>
              <span className="text-[10px] text-app-text4 font-mono">
                {logStats.extOperations} operaciones
              </span>
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#22d3ee]/10 text-[#22d3ee] border border-[#22d3ee]/20">Referencia</span>
            </div>
            <span
              className={`text-app-text3 text-sm transition-transform duration-200 ${
                externalExpanded ? 'rotate-180' : ''
              }`}
            >
              ▾
            </span>
          </button>

          {/* Collapsible Content */}
          {externalExpanded && (
            <div className="mt-4 animate-fadeIn">
              {/* V2.0 — Disclaimer */}
              <div className="bg-[#fbbf24]/5 border border-[#fbbf24]/20 rounded-lg px-3 py-2 mb-3">
                <div className="text-[9px] text-[#fbbf24]/80 flex items-center gap-1.5">
                  <span>⚠</span>
                  <span>Los valores de Capital Neto y Ganancia Acum. son datos de referencia del archivo importado. No participan en el cálculo del patrimonio actual (SSOT: Cartera).</span>
                </div>
              </div>

              <div className="overflow-x-auto max-h-96 overflow-y-auto custom-scrollbar">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-app-card z-10">
                    <tr className="border-b border-app-border/60">
                      <th className="px-4 py-3 text-left text-[11px] uppercase tracking-wider font-medium text-app-text3">Fecha</th>
                      <th className="px-4 py-3 text-left text-[11px] uppercase tracking-wider font-medium text-app-text3">Ticker</th>
                      <th className="px-4 py-3 text-left text-[11px] uppercase tracking-wider font-medium text-app-text3">Operación</th>
                      <th className="px-4 py-3 text-right text-[11px] uppercase tracking-wider font-medium text-app-text3">TEM</th>
                      <th className="px-4 py-3 text-right text-[11px] uppercase tracking-wider font-medium text-app-text3">Precio c/Com.</th>
                      <th className="px-4 py-3 text-right text-[11px] uppercase tracking-wider font-medium text-app-text3 hidden sm:table-cell">Duration</th>
                      <th className="px-4 py-3 text-right text-[11px] uppercase tracking-wider font-medium text-app-text3 hidden sm:table-cell">Capital Neto*</th>
                      <th className="px-4 py-3 text-right text-[11px] uppercase tracking-wider font-medium text-app-text3">Ganancia Acum.*</th>
                      <th className="px-4 py-3 text-left text-[11px] uppercase tracking-wider font-medium text-app-text3 hidden md:table-cell">Notas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sanitizedExternalHistory.map((rec, idx) => (
                      <tr
                        key={`ext-${idx}`}
                        className={`border-b border-app-border/40 table-row-highlight ${
                          isFondeoRow(rec) ? 'opacity-60' : ''
                        }`}
                      >
                        <td className="px-4 py-3 font-mono text-app-text3">{rec.fecha}</td>
                        <td className="px-4 py-3 font-mono font-medium text-app-text2">{rec.ticker}</td>
                        <td className="px-4 py-3 text-app-text3">
                          {rec.operacion}
                          {isFondeoRow(rec) && (
                            <span className="ml-1 text-[8px] px-1 py-0.5 rounded bg-app-subtle/60 text-app-text4">fondeo</span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono text-app-text2 text-right">{rec.tem.toFixed(2)}%</td>
                        <td className="px-4 py-3 font-mono text-app-text3 text-right">${rec.precioConComision.toFixed(4)}</td>
                        <td className="px-4 py-3 font-mono text-app-text3 text-right hidden sm:table-cell">
                          {rec.duration > 0 ? `${rec.duration.toFixed(0)}d` : '—'}
                        </td>
                        <td className="px-4 py-3 font-mono text-app-text3 text-right hidden sm:table-cell">
                          ${formatCurrency(rec.capitalNeto)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <span className={`font-mono ${rec.gananciaAcumulada >= 0 ? 'text-[#2eebc8]' : 'text-[#f87171]'}`}>
                              {rec.gananciaAcumulada >= 0 ? '+' : ''}${formatCurrency(rec.gananciaAcumulada)}
                            </span>
                            <div className="w-12 h-3 bg-app-subtle rounded-full overflow-hidden hidden sm:block">
                              <div
                                className={`h-full rounded-full ${
                                  rec.gananciaAcumulada >= 0 ? 'bg-[#2eebc8]/60' : 'bg-[#f87171]/60'
                                }`}
                                style={{
                                  width: `${Math.min(Math.abs(rec.gananciaAcumulada) / Math.max(
                                    ...sanitizedExternalHistory.map(r => Math.abs(r.gananciaAcumulada) || 1)
                                  ) * 100, 100)}%`,
                                }}
                              />
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-app-text4 text-[10px] max-w-24 truncate hidden md:table-cell">{rec.notas || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* External history sparkline — visual reference only */}
              {externalGananciaData.length >= 2 && (
                <div className="mt-4 pt-4 border-t border-app-border/40 flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-app-text4 uppercase tracking-wider">Evolución Ganancia (ref.)</span>
                    <MiniSparkline data={externalGananciaData} width={120} height={28} />
                  </div>
                  <div className="text-right ml-auto">
                    <div className="text-[9px] text-app-text4">Ganancia final (ref.)</div>
                    <div className={`font-mono text-sm font-bold ${externalGananciaData[externalGananciaData.length - 1] >= 0 ? 'text-[#2eebc8]' : 'text-[#f87171]'}`}>
                      {externalGananciaData[externalGananciaData.length - 1] >= 0 ? '+' : ''}${formatCurrency(externalGananciaData[externalGananciaData.length - 1])}
                    </div>
                  </div>
                </div>
              )}

              {/* Column asterisk note */}
              <div className="text-[8px] text-app-text4 mt-2">
                * Columnas con datos de referencia del archivo importado. No influyen en el cálculo del patrimonio (SSOT: Cartera).
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Event Timeline (purely visual log) ── */}
      {eventTimeline.length >= 1 && (
        <div className="glass-card p-5">
          <h3 className="text-sm font-medium text-app-text2 mb-4">
            Línea de Eventos
            <span className="text-[9px] text-app-text4 ml-2">Registro cronológico (solo lectura)</span>
          </h3>
          <div className="max-h-80 overflow-y-auto custom-scrollbar">
            <div className="space-y-0">
              {eventTimeline.map((event, idx) => {
                const isGain = event.pnl !== undefined ? event.pnl >= 0 : true;

                return (
                  <div key={`event-${idx}`} className="flex items-start gap-3 animate-fadeInUp" style={{ animationDelay: `${Math.min(idx * 0.02, 0.3)}s` }}>
                    {/* Timeline line & dot */}
                    <div className="flex flex-col items-center shrink-0">
                      <div
                        className={`w-3 h-3 rounded-full border-2 ${
                          event.isExternal
                            ? isGain ? 'bg-[#22d3ee]/20 border-[#22d3ee]' : 'bg-[#f87171]/20 border-[#f87171]'
                            : isGain ? 'bg-[#2eebc8]/20 border-[#2eebc8]' : 'bg-[#f87171]/20 border-[#f87171]'
                        }`}
                      />
                      {idx < eventTimeline.length - 1 && (
                        <div className="w-px h-6 bg-app-border/40" />
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 pb-3 min-w-0">
                      <div className="flex items-baseline justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-mono text-app-text2 text-xs truncate">{event.label}</span>
                          <span className="text-[9px] text-app-text4 font-mono">{event.date}</span>
                          {event.isExternal && (
                            <span className="text-[8px] px-1 py-0.5 rounded bg-[#22d3ee]/10 text-[#22d3ee]">ext</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {event.pnl !== undefined && (
                            <span className={`text-xs font-mono ${isGain ? 'text-[#2eebc8]' : 'text-[#f87171]'}`}>
                              {isGain ? '▲' : '▼'} {event.pnl >= 0 ? '+' : ''}${formatCurrency(event.pnl)}
                            </span>
                          )}
                          {event.referenceCapital !== undefined && (
                            <span className="text-[10px] font-mono text-app-text4" title="Capital Neto de referencia (externo)">
                              ${formatCurrency(event.referenceCapital)}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-[9px] text-app-text4 mt-0.5 truncate">{event.detail}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── No Data Hint ── */}
      {transactions.length === 0 && sanitizedExternalHistory.length === 0 && (
        <div className="glass-card p-8 text-center">
          <div className="text-5xl mb-4 opacity-30">📋</div>
          <h3 className="text-base font-light text-app-text2 mb-2">Sin historial de operaciones</h3>
          <p className="text-sm text-app-text3 max-w-md mx-auto">
            Las operaciones de compra y venta aparecerán aquí. Agregá una posición en la pestaña Cartera o importá tu historial externo usando el botón de arriba.
          </p>
        </div>
      )}
    </div>
  );
}
