'use client';

import React, { useState, useRef } from 'react';
import {
  Instrument,
  Config,
  Position,
  Transaction,
  SimulationRecord,
  ExternalHistoryRecord,
  Snapshot,
} from '@/lib/types';
import {
  PriceHistoryFile,
  mergeInstrumentsIntoHistory,
  mergePriceHistoryIncremental,
  normalizePriceHistory,
  countAuditEntries,
  savePriceHistory as persistPriceHistory,
  clearPriceHistory,
} from '@/lib/priceHistory';
import {
  parseRawData,
  saveToStorage,
  STORAGE_KEYS,
} from '@/lib/sampleData';
import {
  normalizeImportedData,
  BACKUP_FORMAT_VERSION,
} from '@/lib/calculations';
import { savePriceHistory } from '@/lib/priceHistory';

export interface ConfiguracionTabProps {
  rawInput: string;
  setRawInput: (v: string) => void;
  config: Config;
  setConfig: (v: Config) => void;
  instruments: Instrument[];
  setInstruments: (v: Instrument[]) => void;
  setLastUpdate: (v: string) => void;
  position: Position | null;
  setPosition: (v: Position | null) => void;
  transactions: Transaction[];
  setTransactions: (v: Transaction[]) => void;
  simulations: SimulationRecord[];
  setSimulations: (v: SimulationRecord[]) => void;
  externalHistory: ExternalHistoryRecord[];
  setExternalHistory: (v: ExternalHistoryRecord[]) => void;
  priceHistory: PriceHistoryFile | null;
  setPriceHistory: (v: PriceHistoryFile) => void;
  snapshots: Snapshot[];
  onRestoreSnapshots: (snaps: Snapshot[]) => void;
}

export default function ConfiguracionTab({
  rawInput,
  setRawInput,
  config,
  setConfig,
  instruments,
  setInstruments,
  setLastUpdate,
  position,
  setPosition,
  transactions,
  setTransactions,
  simulations,
  setSimulations,
  externalHistory,
  setExternalHistory,
  priceHistory,
  setPriceHistory,
  snapshots,
  onRestoreSnapshots,
}: ConfiguracionTabProps) {
  // ── Local state ──
  const [parseError, setParseError] = useState<string | null>(null);
  const [parseSuccess, setParseSuccess] = useState(false);
  const [addCapitalAmount, setAddCapitalAmount] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [backupStatus, setBackupStatus] = useState<string>('');
  const [priceHistoryStatus, setPriceHistoryStatus] = useState<string>('');
  const [eodStatus, setEodStatus] = useState<string>('');

  const importFileRef = useRef<HTMLInputElement>(null);
  const priceHistoryFileRef = useRef<HTMLInputElement>(null);

  // ── 1. RAW DATA INPUT ──────────────────────────────────────────────────

  const handleParse = () => {
    setParseError(null);
    setParseSuccess(false);
    try {
      const parsed = parseRawData(rawInput);
      if (parsed.length === 0) {
        setParseError(
          'No se pudieron extraer instrumentos del texto. Verificá el formato.'
        );
        return;
      }
      setInstruments(parsed);
      saveToStorage(STORAGE_KEYS.INSTRUMENTS, parsed);
      const now = new Date().toLocaleString('es-AR');
      setLastUpdate(now);
      saveToStorage(STORAGE_KEYS.LAST_UPDATE, now);
      saveToStorage(STORAGE_KEYS.RAW_INPUT, rawInput);
      setParseSuccess(true);
      setRawInput('');
      setTimeout(() => setParseSuccess(false), 3000);
    } catch (e) {
      setParseError(
        `Error al parsear: ${e instanceof Error ? e.message : 'desconocido'}`
      );
    }
  };

  const handleClearRawInput = () => {
    setRawInput('');
    setParseError(null);
    setParseSuccess(false);
  };

  // ── 2. CONFIGURATION ───────────────────────────────────────────────────

  const handleConfigChange = (field: keyof Config, value: string) => {
    const numVal = parseFloat(value);
    if (isNaN(numVal)) return;
    const newConfig = { ...config, [field]: numVal };
    setConfig(newConfig);
    saveToStorage(STORAGE_KEYS.CONFIG, newConfig);
  };

  const handleAddCapital = () => {
    const amount = parseFloat(addCapitalAmount);
    if (isNaN(amount) || amount <= 0) return;
    const newConfig = {
      ...config,
      capitalDisponible: config.capitalDisponible + amount,
    };
    setConfig(newConfig);
    saveToStorage(STORAGE_KEYS.CONFIG, newConfig);
    setAddCapitalAmount('');
  };

  const handleSaveConfig = () => {
    saveToStorage(STORAGE_KEYS.CONFIG, config);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2500);
  };

  // ── 3. IMPORT/EXPORT JSON ──────────────────────────────────────────────

  const handleExportBackup = () => {
    const backup = {
      version: BACKUP_FORMAT_VERSION,
      exportDate: new Date().toISOString(),
      config,
      position,
      transactions,
      simulations,
      instruments,
      externalHistory,
      snapshots,
    };
    const json = JSON.stringify(backup, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `arbradar_backup_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setBackupStatus('✅ Backup exportado exitosamente');
    setTimeout(() => setBackupStatus(''), 3000);
  };

  const handleImportBackup = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const rawData = JSON.parse(text);

      // Basic validation
      if (!rawData.version && !rawData.config) {
        setBackupStatus(
          '❌ Archivo no válido: no es un backup de ARB-RADAR'
        );
        setTimeout(() => setBackupStatus(''), 4000);
        return;
      }

      // Normalize data (backward compatibility)
      const {
        config: normConfig,
        position: normPosition,
        transactions: normTransactions,
        simulations: normSimulations,
        instruments: normInstruments,
        externalHistory: normHistory,
        snapshots: normSnapshots,
        migrationLog,
      } = normalizeImportedData(rawData);

      // ════════════════════════════════════════════════════════════════
      // V2.0.4 — OVERWRITE MODE: Backup replaces ALL existing data
      // The JSON is the single source of truth. If capital is $463.706,
      // that's the final value — regardless of what existed before.
      // ════════════════════════════════════════════════════════════════

      // ── 1. Config: ALWAYS overwrite (this is the key fix) ──
      setConfig(normConfig);
      saveToStorage(STORAGE_KEYS.CONFIG, normConfig);

      // ── 2. Position: Overwrite (null means "no position" — valid state) ──
      setPosition(normPosition);
      saveToStorage(STORAGE_KEYS.POSITION, normPosition);

      // ── 3. Transactions: Overwrite (empty array = no ghost operations) ──
      setTransactions(normTransactions);
      saveToStorage(STORAGE_KEYS.TRANSACTIONS, normTransactions);

      // ── 4. Simulations: Overwrite ──
      setSimulations(normSimulations);
      saveToStorage(STORAGE_KEYS.SIMULATIONS, normSimulations);

      // ── 5. Instruments: Overwrite ──
      setInstruments(normInstruments.length > 0 ? normInstruments : instruments);
      if (normInstruments.length > 0) {
        saveToStorage(STORAGE_KEYS.INSTRUMENTS, normInstruments);
      }

      // ── 6. External History: Overwrite ──
      setExternalHistory(normHistory);
      saveToStorage(STORAGE_KEYS.EXTERNAL_HISTORY, normHistory);

      // ── 7. Snapshots: Overwrite (not merge) ──
      if (normSnapshots.length > 0) {
        onRestoreSnapshots(normSnapshots);
      } else {
        onRestoreSnapshots([]); // V2.0.4: Clear snapshots if backup has none
      }

      // ── 8. Price History: Overwrite (not incremental merge) ──
      // Store the raw backup for potential future reference
      const exportDate = rawData.exportDate || new Date().toISOString();
      const dateKey = exportDate.slice(0, 10);
      try {
        localStorage.setItem(`arbradar_backup_${dateKey}`, JSON.stringify(rawData));
      } catch { /* storage full */ }

      // V2.0.4: Replace price history entirely if backup has instruments
      // If backup has no instruments, keep existing price history
      if (normInstruments.length > 0) {
        const newHistory = mergeInstrumentsIntoHistory(
          null as any, // Start from scratch — no merge with existing
          normInstruments,
          dateKey
        );
        setPriceHistory(newHistory);
        persistPriceHistory(newHistory);
      }

      // Build status message
      const parts: string[] = [];
      if (normInstruments.length > 0)
        parts.push(normInstruments.length + ' instr.');
      if (normSnapshots.length > 0)
        parts.push(normSnapshots.length + ' snaps');
      parts.push('config');
      if (normPosition) parts.push('posición: ' + normPosition.ticker);
      parts.push(normTransactions.length + ' tx');

      const migrationMsg =
        migrationLog.length > 0
          ? ' | Normalización: ' + migrationLog.join('; ')
          : '';
      setBackupStatus(
        `✅ Backup v${rawData.version || '?'} importado (OVERWRITE): ${parts.join(', ')}${migrationMsg}`
      );
      setTimeout(() => setBackupStatus(''), 4000);
    } catch (err) {
      setBackupStatus(
        `❌ Error al importar: ${err instanceof Error ? err.message : 'JSON inválido'}`
      );
      setTimeout(() => setBackupStatus(''), 5000);
    }

    // Reset file input
    event.target.value = '';
  };

  // ── 4. PRICE HISTORY IMPORT ────────────────────────────────────────────
  // V1.8.2: Incremental merge — new data adds to existing history, never overwrites

  const handleLoadPriceHistory = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text) as PriceHistoryFile;

      // Basic validation
      if (!data.historico || typeof data.historico !== 'object') {
        setPriceHistoryStatus(
          '❌ Archivo no válido: no contiene campo "historico"'
        );
        setTimeout(() => setPriceHistoryStatus(''), 4000);
        return;
      }

      const dateCount = Object.keys(data.historico).length;
      if (dateCount === 0) {
        setPriceHistoryStatus(
          '❌ El archivo no contiene datos históricos'
        );
        setTimeout(() => setPriceHistoryStatus(''), 4000);
        return;
      }

      // V1.8.3: Normalize incoming data — auto-divide prices > 10 by 100
      const normResult = normalizePriceHistory(data);
      const normalized = normResult.normalized;
      const normalizedDateCount = Object.keys(normalized.historico).length;

      // V1.8.3: Incremental merge — adds to existing history without overwriting
      const mergeResult = mergePriceHistoryIncremental(priceHistory, normalized);
      const merged = mergeResult.merged;

      setPriceHistory(merged);
      savePriceHistory(merged);

      const tickerCount = new Set(
        Object.values(merged.historico as Record<string, Record<string, unknown>>).flatMap((day) => Object.keys(day))
      ).size;

      const newDatesAdded = priceHistory
        ? Object.keys(normalized.historico).filter(d => !(d in priceHistory.historico)).length
        : normalizedDateCount;

      // Build audit status message
      let statusMsg = `✅ Historial mergeado: ${newDatesAdded} día(s) nuevo(s), ${tickerCount} tickers, ${normalizedDateCount} días totales`;
      // V1.8.3: Show scale normalization info
      const totalScaled = normResult.scaledCount + mergeResult.scaledCount;
      if (totalScaled > 0) {
        statusMsg += ` | 🔄 ${totalScaled} precio(s) normalizado(s) (×÷100 → escala 1.XXXX)`;
      }
      const totalRejected = normResult.rejectedCount + mergeResult.rejectedCount;
      if (totalRejected > 0) {
        statusMsg += ` | ⚠️ ${totalRejected} entrada(s) basura rechazada(s)`;
      }
      if (normalizedDateCount < dateCount) {
        statusMsg += ` | ${dateCount - normalizedDateCount} día(s) sin datos válidos`;
      }

      setPriceHistoryStatus(statusMsg);
      setTimeout(() => setPriceHistoryStatus(''), 3000);
    } catch (err) {
      setPriceHistoryStatus(
        `❌ Error al cargar historial: ${err instanceof Error ? err.message : 'JSON inválido'}`
      );
      setTimeout(() => setPriceHistoryStatus(''), 5000);
    }

    // Reset file input
    event.target.value = '';
  };

  // V1.8.2: Download JSON — export the actual in-memory priceHistory for auditing
  const handleDownloadPriceHistory = () => {
    if (!priceHistory) {
      setPriceHistoryStatus('❌ No hay historial para descargar');
      setTimeout(() => setPriceHistoryStatus(''), 3000);
      return;
    }

    const json = JSON.stringify(priceHistory, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `priceHistory_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setPriceHistoryStatus('✅ JSON de historial descargado para auditoría');
    setTimeout(() => setPriceHistoryStatus(''), 4000);
  };

  // V1.8.3: Reset History — complete wipe of price history
  const handleResetPriceHistory = () => {
    clearPriceHistory();
    const empty: PriceHistoryFile = {
      descripcion: 'Histórico limpiado — V1.8.3',
      metadatos: { moneda: 'ARS', periodo: '', instrumentos_maestro: {} },
      historico: {},
    };
    setPriceHistory(empty);
    savePriceHistory(empty);
    setPriceHistoryStatus('✅ Historial de precios reseteado. Todos los datos eliminados incluyendo backups.');
    setTimeout(() => setPriceHistoryStatus(''), 5000);
  };

  // V1.9.1: EOD Append — Save today's instruments as closing prices in price history
  const handleEODAppend = () => {
    if (instruments.length === 0) {
      setEodStatus('❌ No hay instrumentos cargados para guardar el cierre');
      setTimeout(() => setEodStatus(''), 4000);
      return;
    }

    const today = new Date();
    const dateKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    // Check if today's data already exists
    const todayExists = priceHistory && priceHistory.historico[dateKey];
    const existingTickerCount = todayExists ? Object.keys(todayExists).length : 0;

    const merged = mergeInstrumentsIntoHistory(priceHistory, instruments, dateKey);
    setPriceHistory(merged);
    persistPriceHistory(merged);

    const newTickerCount = Object.keys(merged.historico[dateKey] || {}).length;
    const addedCount = newTickerCount - existingTickerCount;

    if (todayExists && addedCount === 0) {
      setEodStatus(`✅ Cierre del ${dateKey} ya registrado — ${existingTickerCount} instrumentos sin cambios`);
    } else if (todayExists && addedCount > 0) {
      setEodStatus(`✅ Cierre del ${dateKey} actualizado — ${addedCount} ticker(s) nuevo(s), ${newTickerCount} totales`);
    } else {
      setEodStatus(`✅ Cierre EOD guardado: ${newTickerCount} instrumento(s) registrados al ${dateKey} — S/R se recalculará automáticamente`);
    }
    setTimeout(() => setEodStatus(''), 5000);
  };

  // V1.8.3: Normalize existing history — auto-scale prices > 10 and remove garbage
  const handleNormalizeHistory = () => {
    if (!priceHistory) {
      setPriceHistoryStatus('❌ No hay historial para normalizar');
      setTimeout(() => setPriceHistoryStatus(''), 3000);
      return;
    }

    const result = normalizePriceHistory(priceHistory);
    setPriceHistory(result.normalized);
    savePriceHistory(result.normalized);

    const parts: string[] = [];
    if (result.scaledCount > 0) {
      parts.push(`${result.scaledCount} precio(s) normalizado(s) (×÷100)`);
    }
    if (result.rejectedCount > 0) {
      parts.push(`${result.rejectedCount} entrada(s) basura eliminada(s)`);
    }
    if (parts.length > 0) {
      setPriceHistoryStatus(`✅ Normalización completada: ${parts.join(', ')} de ${result.totalCount} totales`);
    } else {
      setPriceHistoryStatus('✅ Historial limpio — todos los precios ya están en escala 1.XXXX');
    }
    setTimeout(() => setPriceHistoryStatus(''), 5000);
  };

  // ── Price History status ──
  const hasPriceHistory = priceHistory !== null && Object.keys(priceHistory.historico || {}).length > 0;
  const priceHistoryDateRange = hasPriceHistory
    ? (() => {
        const dates = Object.keys(priceHistory!.historico).sort();
        if (dates.length === 0) return 'Sin datos';
        return `${dates[0]} → ${dates[dates.length - 1]} (${dates.length} días)`;
      })()
    : '';

  // V1.9.1: Price history freshness — how many days since last EOD close
  const lastCloseDate = hasPriceHistory
    ? (() => {
        const dates = Object.keys(priceHistory!.historico).sort();
        return dates.length > 0 ? dates[dates.length - 1] : null;
      })()
    : null;
  const daysSinceLastClose = (() => {
    if (!lastCloseDate) return Infinity;
    const last = new Date(lastCloseDate + 'T23:59:59');
    const now = new Date();
    return Math.floor((now.getTime() - last.getTime()) / (1000 * 60 * 60 * 24));
  })();
  const isHistoryStale = daysSinceLastClose > 1;
  const todayKey = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`;
  const todayCloseExists = hasPriceHistory && priceHistory!.historico[todayKey];

  // V1.8.3: Compute audit stats for current history
  const auditStats = hasPriceHistory ? countAuditEntries(priceHistory!) : null;
  const tickerCount = hasPriceHistory
    ? new Set(Object.values(priceHistory!.historico).flatMap(d => Object.keys(d))).size
    : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-app-text mb-1">
            ⚙️ Configuración
          </h2>
          <p className="text-sm text-app-text3">
            Datos del mercado, parámetros, backup y historial de precios
          </p>
        </div>
        <div className="flex items-center gap-3">
          {saveSuccess && (
            <span className="text-[#2eebc8] text-sm font-medium">
              ✓ Configuración guardada
            </span>
          )}
          <button
            onClick={handleSaveConfig}
            className="px-5 py-2 bg-[#2eebc8] text-[#0c1220] font-medium text-sm rounded-lg hover:opacity-90 transition-colors"
          >
            💾 Guardar Configuración
          </button>
        </div>
      </div>

      {/* ── 1. RAW DATA INPUT ──────────────────────────────────────────────── */}
      <div className="bg-app-card rounded-xl border border-app-border/60 p-5">
        <h3 className="text-sm font-medium text-app-text2 mb-4">
          📥 Cargar Datos del Mercado
        </h3>
        <p className="text-xs text-app-text4 mb-3">
          Pegá los datos crudos de acuantoesta.com.ar — detecta formato automático
        </p>
        <textarea
          value={rawInput}
          onChange={(e) => setRawInput(e.target.value)}
          className="w-full h-48 rounded-xl bg-app-input border border-app-border/60 font-mono text-xs focus:border-[#2eebc8]/50 focus:outline-none resize-y p-3 text-app-text2 placeholder:text-app-text4"
          placeholder={`Formato vertical (copy-paste directo de acuantoesta.com.ar):
S30A6LECAP
30/04/2026
12
1,2685
0.19%
...

O formato pipe-delimited:
S30O6|LECAP|30/10/2026|196|1.1550|0.57|28.0|2.15|16.95`}
        />
        <div className="flex items-center gap-3 mt-3">
          <button
            onClick={handleParse}
            disabled={!rawInput.trim()}
            className="px-6 py-2 bg-[#2eebc8] text-[#0c1220] font-medium text-sm rounded-lg hover:opacity-90 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Parsear y Actualizar
          </button>
          <button
            onClick={handleClearRawInput}
            className="px-6 py-2 bg-app-subtle/60 border border-app-border/60 text-app-text2 rounded-lg hover:bg-app-hover transition-colors"
          >
            Limpiar
          </button>
          {parseSuccess && (
            <div className="mt-2 p-2.5 rounded-lg text-xs font-medium bg-[#2eebc8]/10 text-[#2eebc8] border border-[#2eebc8]/20 animate-fadeIn">
              ✓ {instruments.length} instrumento(s) cargado(s) correctamente
            </div>
          )}
          {parseError && (
            <span className="text-[#f87171] text-sm">✗ {parseError}</span>
          )}
        </div>
        {instruments.length > 0 && (
          <div className="text-[10px] text-app-text4 mt-2">
            {instruments.length} instrumento(s) cargado(s) — último update:{' '}
            {localStorage.getItem(STORAGE_KEYS.LAST_UPDATE)?.replace(/"/g, '') || '—'}
          </div>
        )}
      </div>

      {/* ── 2. CONFIGURATION SECTION ───────────────────────────────────────── */}
      {/* Capital Disponible */}
      <div className="bg-app-card rounded-xl border border-app-border/60 p-5">
        <h3 className="text-sm font-medium text-app-text2 mb-4">
          💰 Capital Disponible para Invertir
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-[10px] text-app-text3 uppercase tracking-wider font-medium mb-1.5">
              Capital Disponible ($)
            </label>
            <input
              type="number"
              step="1000"
              value={Math.round(config.capitalDisponible)}
              onChange={(e) =>
                handleConfigChange('capitalDisponible', e.target.value)
              }
              className="w-full bg-app-input border border-app-border/60 rounded-lg px-4 py-2.5 text-app-accent-text font-mono text-lg font-bold focus:border-[#2eebc8]/50 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[10px] text-app-text3 uppercase tracking-wider font-medium mb-1.5">
              Agregar Capital ($)
            </label>
            <div className="flex gap-2">
              <input
                type="number"
                step="1000"
                value={addCapitalAmount}
                onChange={(e) => setAddCapitalAmount(e.target.value)}
                placeholder="Monto a agregar"
                className="w-full bg-app-input border border-app-border/60 rounded-lg px-4 py-2.5 text-app-text font-mono text-sm focus:border-[#2eebc8]/50 focus:outline-none placeholder:text-app-text4"
              />
              <button
                onClick={handleAddCapital}
                disabled={
                  !addCapitalAmount || parseFloat(addCapitalAmount) <= 0
                }
                className="px-4 py-2.5 bg-[#2eebc8] text-[#0c1220] font-medium text-sm rounded-lg hover:opacity-90 transition-colors disabled:opacity-30 disabled:cursor-not-allowed whitespace-nowrap"
              >
                + Agregar
              </button>
            </div>
          </div>
          <div className="flex items-end">
            <div className="bg-app-subtle/60 rounded-lg p-3 w-full">
              <div className="text-[10px] text-app-text3 uppercase tracking-wider font-medium mb-1">
                Capital Total
              </div>
              <div className="font-mono text-2xl font-bold text-[#2eebc8]">
                $
                {config.capitalDisponible.toLocaleString('es-AR', {
                  maximumFractionDigits: 0,
                })}
              </div>
              <div className="text-[10px] text-app-text4 mt-1">
                Se actualiza automáticamente al comprar/vender en Cartera
              </div>
            </div>
          </div>
        </div>
        <div className="text-[10px] text-app-text4 mt-3">
          💡 El capital se descuenta automáticamente cuando comprás un
          instrumento y se suma al vender. Usá &quot;Agregar Capital&quot; para
          registrar aportes adicionales a tu cuenta.
        </div>
      </div>

      {/* Tasas de Caución */}
      <div className="bg-app-card rounded-xl border border-app-border/60 p-5">
        <h3 className="text-sm font-medium text-app-text2 mb-4">
          Tasas de Caución (TNA %)
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-[10px] text-app-text3 uppercase tracking-wider font-medium mb-1.5">
              Caución 1 día
            </label>
            <input
              type="number"
              step="0.1"
              value={Number(config.caucion1d.toFixed(1))}
              onChange={(e) =>
                handleConfigChange('caucion1d', e.target.value)
              }
              className="w-full bg-app-input border border-app-border/60 rounded-lg px-4 py-2.5 text-app-text font-mono text-sm focus:border-[#2eebc8]/50 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[10px] text-app-text3 uppercase tracking-wider font-medium mb-1.5">
              Caución 7 días
            </label>
            <input
              type="number"
              step="0.1"
              value={Number(config.caucion7d.toFixed(1))}
              onChange={(e) =>
                handleConfigChange('caucion7d', e.target.value)
              }
              className="w-full bg-app-input border border-app-border/60 rounded-lg px-4 py-2.5 text-app-text font-mono text-sm focus:border-[#2eebc8]/50 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[10px] text-app-text3 uppercase tracking-wider font-medium mb-1.5">
              Caución 30 días
            </label>
            <input
              type="number"
              step="0.1"
              value={Number(config.caucion30d.toFixed(1))}
              onChange={(e) =>
                handleConfigChange('caucion30d', e.target.value)
              }
              className="w-full bg-app-input border border-app-border/60 rounded-lg px-4 py-2.5 text-app-text font-mono text-sm focus:border-[#2eebc8]/50 focus:outline-none"
            />
          </div>
        </div>
        <div className="text-[10px] text-app-text4 mt-2">
          Fuente recomendada: a3mercados.com.ar — actualizar 2-3 veces por día
        </div>
      </div>

      {/* Riesgo País y Comisión */}
      <div className="bg-app-card rounded-xl border border-app-border/60 p-5">
        <h3 className="text-sm font-medium text-app-text2 mb-4">
          Riesgo País y Comisión
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] text-app-text3 uppercase tracking-wider font-medium mb-1.5">
              Riesgo País (pb)
            </label>
            <input
              type="number"
              step="1"
              value={config.riesgoPais}
              onChange={(e) =>
                handleConfigChange('riesgoPais', e.target.value)
              }
              className="w-full bg-app-input border border-app-border/60 rounded-lg px-4 py-2.5 text-app-text font-mono text-sm focus:border-[#2eebc8]/50 focus:outline-none"
            />
            <div className="text-[10px] text-app-text4 mt-1">
              Umbrales: &lt;450 OK | 450-550 Precaución | 550-650 Alerta | &gt;650
              Peligro
            </div>
          </div>
          <div>
            <label className="block text-[10px] text-app-text3 uppercase tracking-wider font-medium mb-1.5">
              Comisión total round-trip (%)
            </label>
            <input
              type="number"
              step="0.01"
              value={Number(config.comisionTotal.toFixed(2))}
              onChange={(e) =>
                handleConfigChange('comisionTotal', e.target.value)
              }
              className="w-full bg-app-input border border-app-border/60 rounded-lg px-4 py-2.5 text-app-text font-mono text-sm focus:border-[#2eebc8]/50 focus:outline-none"
            />
            <div className="text-[10px] text-app-text4 mt-1">
              0.15% compra + 0.15% venta = 0.30% total (acuantoesta.com.ar).
              Usá &quot;Precio con Comisión&quot; en Cartera para priorizar el
              dato del broker.
            </div>
          </div>
        </div>
      </div>

      {/* ── 3. IMPORT/EXPORT JSON ───────────────────────────────────────────── */}
      <div className="bg-app-card rounded-xl border border-app-border/60 p-5">
        <h3 className="text-sm font-medium text-app-text2 mb-4">
          💾 Backup y Restauración de Datos
        </h3>
        <p className="text-xs text-app-text3 mb-4">
          Exportá un archivo JSON con toda tu configuración, posición, historial
          y simulaciones. Si borrás el caché del navegador, podés importar el
          backup para restaurar todo.
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={handleExportBackup}
            className="px-4 py-2 bg-[#2eebc8] text-[#0c1220] font-medium text-sm rounded-lg hover:opacity-90 transition-colors"
          >
            📥 Exportar Backup (JSON)
          </button>
          <input
            ref={importFileRef}
            type="file"
            accept=".json"
            onChange={handleImportBackup}
            className="hidden"
          />
          <button
            onClick={() => importFileRef.current?.click()}
            className="px-4 py-2 bg-app-subtle/60 border border-app-border/60 text-app-text2 rounded-lg hover:bg-app-hover transition-colors"
          >
            📤 Importar Backup (JSON)
          </button>
        </div>
        {backupStatus && (
          <div className={`mt-3 p-3 rounded-lg text-xs font-medium animate-fadeIn ${
            backupStatus.startsWith('✅') ? 'bg-[#2eebc8]/10 text-[#2eebc8] border border-[#2eebc8]/20' :
            backupStatus.startsWith('❌') ? 'bg-[#f87171]/10 text-[#f87171] border border-[#f87171]/20' :
            'bg-app-subtle/40 text-app-text3 border border-app-border/40'
          }`}>
            {backupStatus}
          </div>
        )}
        <div className="mt-3 text-[10px] text-app-text4">
          El backup incluye: configuración, posición activa, transacciones,
          simulaciones, instrumentos, historial externo y snapshots de sesión
          (historial momentum). Al importar un backup de una versión anterior,
          los datos se normalizan automáticamente (TEM/TNA/días se recalculan si
          faltan).
        </div>
      </div>

      {/* ── 4. PRICE HISTORY (V1.8.4) ────────────────────────────────────────── */}
      <div className="bg-app-card rounded-xl border border-app-border/60 p-5">
        <div className="flex items-center gap-2 mb-4">
          <h3 className="text-sm font-medium text-app-text2">
            📜 Historial de Precios
          </h3>
          <span className="text-[8px] px-1.5 py-0.5 rounded bg-[#f472b6]/15 text-[#f472b6] font-mono font-bold">V1.8.5</span>
        </div>
        <p className="text-xs text-app-text3 mb-4">
          Cargá el archivo <code className="text-[#2eebc8]">historico_precios.json</code> para
          habilitar análisis de soporte/resistencia (15 días), momentum de precios y
          Duration Modified (DM) desde datos históricos reales. El sistema hace <strong className="text-app-text2">merge incremental</strong> y <strong className="text-app-text2">normalización automática</strong>: precios {'>'} 10 se dividen por 100 (ej. 116.15 → 1.1615).
        </p>

        {/* Status */}
        <div className="mb-4 p-4 border-2 border-dashed border-app-border/40 rounded-xl hover:border-[#2eebc8]/30 transition-colors">
          <div className="flex items-center gap-2">
            <span
              className={`inline-block w-2.5 h-2.5 rounded-full ${
                hasPriceHistory ? 'bg-[#2eebc8]' : 'bg-app-text4'
              }`}
            />
            <span className="text-sm text-app-text2">
              {hasPriceHistory
                ? 'Historial de precios cargado'
                : 'Sin historial de precios'}
            </span>
          </div>
          {hasPriceHistory && (
            <div className="mt-2 space-y-1 text-[10px] text-app-text4 ml-4">
              <div>Rango: {priceHistoryDateRange}</div>
              <div>Instrumentos: {tickerCount} tickers</div>
              <div>Descripción: {priceHistory!.descripcion || 'Sin descripción'}</div>
              {/* V1.9.1: Freshness indicator */}
              <div className={`flex items-center gap-1.5 ${isHistoryStale ? 'text-[#fbbf24]' : 'text-[#2eebc8]'}`}>
                <span className={`inline-block w-1.5 h-1.5 rounded-full ${isHistoryStale ? 'bg-[#fbbf24]' : 'bg-[#2eebc8]'}`} />
                <span>
                  {lastCloseDate
                    ? isHistoryStale
                      ? `Último cierre: ${lastCloseDate} (hace ${daysSinceLastClose}d — DESACTUALIZADO)`
                      : `Último cierre: ${lastCloseDate} (actualizado)`
                    : 'Sin cierres registrados'}
                </span>
              </div>
              {/* V1.8.3: Audit stats */}
              {auditStats && (auditStats.scaled > 0 || auditStats.rejected > 0) && (
                <div className="text-[#fbbf24]">
                  ⚠️ {auditStats.scaled > 0 && `${auditStats.scaled} precio(s) en escala 100 (necesitan ÷100)`}{auditStats.scaled > 0 && auditStats.rejected > 0 && ' · '}{auditStats.rejected > 0 && `${auditStats.rejected} entrada(s) basura`} de {auditStats.total} totales — normalizá el historial
                </div>
              )}
              {auditStats && auditStats.scaled === 0 && auditStats.rejected === 0 && (
                <div className="text-[#2eebc8]">
                  ✓ Historial normalizado — todos los precios en escala 1.XXXX
                </div>
              )}
            </div>
          )}
        </div>

        {/* V1.9.1: Stale Data Warning */}
        {hasPriceHistory && isHistoryStale && (
          <div className="mb-4 p-3 rounded-xl bg-[#fbbf24]/10 border border-[#fbbf24]/30 animate-fadeInUp">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm">⚠️</span>
              <span className="text-[#fbbf24] text-xs font-semibold">HISTORIAL DESACTUALIZADO</span>
            </div>
            <p className="text-[10px] text-app-text3">
              Último cierre: <span className="font-mono text-app-text2">{lastCloseDate}</span> (hace <span className="font-mono text-[#fbbf24]">{daysSinceLastClose} día{daysSinceLastClose !== 1 ? 's' : ''}</span>).
              Los cálculos de S/R y posición en canal pueden estar desactualizados.
              Usá <strong className="text-app-text2">💾 Guardar Cierre del Día</strong> para actualizar.
            </p>
          </div>
        )}

        {/* V1.9.1: Today's Close Status */}
        {hasPriceHistory && todayCloseExists && (
          <div className="mb-4 p-3 rounded-xl bg-[#2eebc8]/10 border border-[#2eebc8]/20 animate-fadeInUp">
            <div className="flex items-center gap-2">
              <span className="text-sm">✅</span>
              <span className="text-[#2eebc8] text-xs font-semibold">CIERRE DE HOY REGISTRADO</span>
              <span className="text-[10px] text-app-text4">— {Object.keys(todayCloseExists).length} instrumentos al {todayKey}</span>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap gap-3">
          <input
            ref={priceHistoryFileRef}
            type="file"
            accept=".json"
            onChange={handleLoadPriceHistory}
            className="hidden"
          />
          <button
            onClick={() => priceHistoryFileRef.current?.click()}
            className="px-4 py-2 bg-[#2eebc8] text-[#0c1220] font-medium text-sm rounded-lg hover:opacity-90 transition-colors"
          >
            📂 Cargar historico_precios.json
          </button>
          {/* V1.9.1: EOD Append button */}
          <button
            onClick={handleEODAppend}
            disabled={instruments.length === 0}
            className={`px-4 py-2 font-medium text-sm rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
              todayCloseExists
                ? 'bg-app-subtle/60 border border-[#2eebc8]/30 text-[#2eebc8] hover:bg-[#2eebc8]/10'
                : 'bg-[#22d3ee] text-[#0c1220] hover:opacity-90'
            }`}
            title={todayCloseExists ? 'Ya existe cierre de hoy — se agregarán tickers faltantes' : 'Guardar precios actuales como cierre EOD en el historial'}
          >
            💾 Guardar Cierre del Día
          </button>
          {/* V1.8.2: Download JSON button for auditing */}
          {hasPriceHistory && (
            <button
              onClick={handleDownloadPriceHistory}
              className="px-4 py-2 bg-app-subtle/60 border border-app-border/60 text-[#22d3ee] rounded-lg hover:bg-app-hover transition-colors"
              title="Descargar el JSON real que el sistema tiene en memoria para auditar errores"
            >
              🔍 Descargar JSON de Historial
            </button>
          )}
          {/* V1.8.3: Normalize button — auto-scale prices > 10 and remove garbage */}
          {hasPriceHistory && auditStats && (auditStats.scaled > 0 || auditStats.rejected > 0) && (
            <button
              onClick={handleNormalizeHistory}
              className="px-4 py-2 bg-[#fbbf24]/10 text-[#fbbf24] border border-[#fbbf24]/20 rounded-lg hover:bg-[#fbbf24]/20 transition-colors"
              title="Normalizar precios > 10 (÷100) y eliminar entradas basura"
            >
              🔄 Normalizar Historial (1.XXXX)
            </button>
          )}
          {/* V1.8.2: Reset button — complete wipe */}
          {hasPriceHistory && (
            <button
              onClick={handleResetPriceHistory}
              className="px-4 py-2 bg-[#f87171]/10 text-[#f87171] border border-[#f87171]/20 rounded-lg hover:bg-[#f87171]/20 transition-colors"
              title="Resetear historial completo incluyendo backups"
            >
              🗑️ Resetear Historial
            </button>
          )}
        </div>
        {/* V1.9.1: EOD Append status */}
        {eodStatus && (
          <div className={`mt-3 p-3 rounded-lg text-xs font-medium animate-fadeIn ${
            eodStatus.startsWith('✅') ? 'bg-[#2eebc8]/10 text-[#2eebc8] border border-[#2eebc8]/20' :
            eodStatus.startsWith('❌') ? 'bg-[#f87171]/10 text-[#f87171] border border-[#f87171]/20' :
            'bg-app-subtle/40 text-app-text3 border border-app-border/40'
          }`}>
            {eodStatus}
          </div>
        )}

        {priceHistoryStatus && (
          <div className={`mt-3 p-3 rounded-lg text-xs font-medium animate-fadeIn ${
            priceHistoryStatus.startsWith('✅') ? 'bg-[#2eebc8]/10 text-[#2eebc8] border border-[#2eebc8]/20' :
            priceHistoryStatus.startsWith('❌') ? 'bg-[#f87171]/10 text-[#f87171] border border-[#f87171]/20' :
            'bg-app-subtle/40 text-app-text3 border border-app-border/40'
          }`}>
            {priceHistoryStatus}
          </div>
        )}

        <div className="mt-3 space-y-1.5 text-[10px] text-app-text4">
          <div>
            💡 <strong className="text-app-text3">Merge incremental</strong>: cada carga agrega datos nuevos sin pisar los existentes. Si una fecha ya existe, solo se agregan tickers nuevos.
          </div>
          <div>
            🔄 <strong className="text-app-text3">Importación inteligente</strong>: precios {'>'} 10 se dividen por 100 automáticamente (ej. 116.15 → 1.1615). Todo el sistema funciona en escala 1.XXXX.
          </div>
          <div>
            📊 <strong className="text-app-text3">S/R recalibrado</strong>: soporte y resistencia se calculan sobre los últimos 15 días en escala 1.XXXX. Precios mostrados con 4 decimales.
          </div>
          <div>
            🔍 <strong className="text-app-text3">Auditoría</strong>: usá &quot;Descargar JSON&quot; para bajar el historial real y verificar que los precios estén en escala 1.XXXX.
          </div>
        </div>
      </div>

      {/* ── 5. FORMAT REFERENCE ─────────────────────────────────────────────── */}
      <div className="bg-app-card rounded-xl border border-app-border/60 p-5">
        <h3 className="text-sm font-medium text-app-text2 mb-4">
          📋 Referencia de Formatos Soportados
        </h3>
        <div className="space-y-3 text-xs">
          {/* Vertical format */}
          <div>
            <span className="text-[#2eebc8] font-semibold">
              Formato vertical (recomendado — copy-paste directo):
            </span>
            <div className="mt-1 bg-app-input p-2.5 rounded-lg text-app-text2 font-mono text-[10px] leading-relaxed">
              <span className="text-app-text4">
                {'//'} Simplemente copiá la tabla de acuantoesta.com.ar y pegá
                acá
              </span>
              <br />
              S30A6LECAP
              <br />
              30/04/2026
              <br />
              12
              <br />
              1,2685
              <br />
              0.19%&nbsp;&nbsp;&nbsp;&nbsp;1,2704&nbsp;&nbsp;&nbsp;&nbsp;1,2749
              <br />
              ...<br />
              $ 0,00&nbsp;&nbsp;&nbsp;&nbsp;+0.35%&nbsp;&nbsp;&nbsp;&nbsp;10.67%&nbsp;&nbsp;&nbsp;&nbsp;0.88%&nbsp;&nbsp;&nbsp;&nbsp;$
              0,00&nbsp;&nbsp;&nbsp;&nbsp;-
            </div>
            <div className="text-app-text4 mt-1">
              El sistema detecta automáticamente TICKER+TIPO, vencimiento, días,
              precio, TNA y TEM.
            </div>
          </div>

          {/* Pipe format */}
          <div>
            <span className="text-[#fbbf24] font-semibold">
              Formato pipe-delimited:
            </span>
            <code className="block mt-1 bg-app-input p-2.5 rounded-lg text-app-text2 font-mono text-[10px]">
              TICKER|TIPO|VENCIMIENTO|DIAS|PRECIO|CAMBIO|TNA|TEM|GANANCIA
            </code>
            <code className="block mt-0.5 bg-app-input p-2.5 rounded-lg text-[#2eebc8] font-mono text-[10px]">
              S30O6|LECAP|30/10/2026|196|1.1550|0.57|28.0|2.15|16.95
            </code>
          </div>

          {/* Price history format */}
          <div>
            <span className="text-[#f472b6] font-semibold">
              Formato historico_precios.json (V1.8.3):
            </span>
            <code className="block mt-1 bg-app-input p-2.5 rounded-lg text-app-text2 font-mono text-[10px] leading-relaxed">
              {'{'}
              <br />
              &nbsp;&nbsp;&quot;descripcion&quot;: &quot;Histórico de precios
              LECAP/BONCAP&quot;,
              <br />
              &nbsp;&nbsp;&quot;metadatos&quot;: {'{'}
              &quot;moneda&quot;: &quot;ARS&quot;, &quot;periodo&quot;:
              &quot;...&quot;, &quot;instrumentos_maestro&quot;: {'{'}...{'}'} {'}'},
              <br />
              &nbsp;&nbsp;&quot;historico&quot;: {'{'}
              <br />
              &nbsp;&nbsp;&nbsp;&nbsp;&quot;2026-04-14&quot;: {'{'}
              &quot;S30O6&quot;: {'{'}
              &quot;p&quot;: 1.155, &quot;tna&quot;: 28.0, &quot;tem&quot;:
              2.15, &quot;dm&quot;: -0.526 {'}'}, ...{'}'},
              <br />
              &nbsp;&nbsp;&nbsp;&nbsp;...
              <br />
              &nbsp;&nbsp;{'}'}
              <br />
              {'}'}
            </code>
            <div className="text-app-text4 mt-1">
              Cada entrada tiene: p (precio), tna, tem, dm (duration modified).
              Las claves del &quot;historico&quot; son fechas ISO (YYYY-MM-DD).
              V1.8.3: precios {'>'} 10 se normalizan automáticamente (÷100 → escala 1.XXXX).
            </div>
          </div>
        </div>
      </div>

      {/* ── 6. WORKFLOW REFERENCE ───────────────────────────────────────────── */}
      <div className="bg-app-card rounded-xl border border-app-border/60 p-5">
        <h3 className="text-sm font-medium text-app-text2 mb-4">
          📌 Flujo de Trabajo Diario
        </h3>
        <div className="space-y-2 text-xs text-app-text3">
          <div className="flex items-start gap-3 py-1">
            <span className="text-[#2eebc8] font-bold w-6 shrink-0">
              1.
            </span>
            <span>
              Abrir dashboard y cargar datos en la sección{' '}
              <strong className="text-app-text2">
                &quot;Cargar Datos del Mercado&quot;
              </strong>{' '}
              arriba
            </span>
          </div>
          <div className="flex items-start gap-3 py-1">
            <span className="text-[#22d3ee] font-bold w-6 shrink-0">
              2.
            </span>
            <span>
              Cargar <code className="text-[#2eebc8]">historico_precios.json</code> si no está
              cargado (para soporte/resistencia y DM) — merge incremental, no pisa datos
            </span>
          </div>
          <div className="flex items-start gap-3 py-1">
            <span className="text-[#22d3ee] font-bold w-6 shrink-0">
              2b.
            </span>
            <span>
              <strong className="text-[#22d3ee]">💾 Guardar Cierre del Día</strong> — al final de cada jornada, 
              presioná este botón para que los precios actuales se guarden en el historial. 
              Así el S/R se recalcula con datos frescos cada noche (EOD). Si no lo hacés, 
              los techos y soportes quedan desactualizados.
            </span>
          </div>
          <div className="flex items-start gap-3 py-1">
            <span className="text-[#fbbf24] font-bold w-6 shrink-0">
              3.
            </span>
            <span>
              Actualizar caución y riesgo país en la configuración de arriba
            </span>
          </div>
          <div className="flex items-start gap-3 py-1">
            <span className="text-[#2eebc8] font-bold w-6 shrink-0">
              4.
            </span>
            <span>
              Revisar <strong className="text-app-text2">Diagnóstico</strong>{' '}
              para veredicto automático de posición
            </span>
          </div>
          <div className="flex items-start gap-3 py-1">
            <span className="text-[#22d3ee] font-bold w-6 shrink-0">
              5.
            </span>
            <span>
              Ver <strong className="text-app-text2">Mercado</strong> para
              anomalías de curva
            </span>
          </div>
          <div className="flex items-start gap-3 py-1">
            <span className="text-[#fbbf24] font-bold w-6 shrink-0">
              6.
            </span>
            <span>
              <strong className="text-app-text2">Estrategias</strong> para
              señales detalladas por instrumento
            </span>
          </div>
          <div className="flex items-start gap-3 py-1">
            <span className="text-[#f472b6] font-bold w-6 shrink-0">
              7.
            </span>
            <span>
              <strong className="text-app-text2">Arbitraje</strong> para
              evaluar rotaciones y simular operaciones
            </span>
          </div>
          <div className="flex items-start gap-3 py-1">
            <span className="text-[#f87171] font-bold w-6 shrink-0">
              8.
            </span>
            <span>
              Actualizar 2-3 veces/día: ~10:30, ~13:00, ~16:30
            </span>
          </div>
        </div>
      </div>

      {/* ── Thresholds Reference ────────────────────────────────────────────── */}
      <div className="bg-app-card rounded-xl border border-app-border/60 p-5">
        <h3 className="text-sm font-medium text-app-text2 mb-4">
          📐 Referencia de Umbrales de Señales
        </h3>
        <div className="space-y-2 text-xs">
          <div className="flex items-center gap-3 py-1">
            <span className="px-2 py-0.5 rounded-lg bg-[#2eebc8]/10 text-[#2eebc8] text-[10px] font-semibold w-28 text-center">
              COMPRA FUERTE
            </span>
            <span className="text-app-text3">
              Score ≥ 7.5 | RAE &gt; 35% y Spread &gt; 0.5%
            </span>
          </div>
          <div className="flex items-center gap-3 py-1">
            <span className="px-2 py-0.5 rounded-lg bg-[#2eebc8]/10 text-[#2eebc8] text-[10px] font-semibold w-28 text-center">
              COMPRA
            </span>
            <span className="text-app-text3">
              Score 5.5–7.5 | Spread &gt; 0.25%
            </span>
          </div>
          <div className="flex items-center gap-3 py-1">
            <span className="px-2 py-0.5 rounded-lg bg-[#fbbf24]/15 text-[#fbbf24] text-[10px] font-semibold w-28 text-center">
              NEUTRAL
            </span>
            <span className="text-app-text3">
              Score 3.5–5.5 | Spread 0.10–0.25%
            </span>
          </div>
          <div className="flex items-center gap-3 py-1">
            <span className="px-2 py-0.5 rounded-lg bg-[#f472b6]/15 text-[#f472b6] text-[10px] font-semibold w-28 text-center">
              VENDER
            </span>
            <span className="text-app-text3">
              Score 2.0–3.5 | Spread comprimiendo
            </span>
          </div>
          <div className="flex items-center gap-3 py-1">
            <span className="px-2 py-0.5 rounded-lg bg-[#f87171]/10 text-[#f87171] text-[10px] font-semibold w-28 text-center">
              EVITAR
            </span>
            <span className="text-app-text3">
              Score &lt; 2.0 | Spread negativo o curva invertida
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
