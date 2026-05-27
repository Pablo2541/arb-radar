'use client';

// ════════════════════════════════════════════════════════════════════════
// V7.0 — CONFIG TAB — QUANT X ENGINE
//
// Redesigned for automated operation:
// - Riesgo País: READ-ONLY (auto-fetched from RAVA API)
// - Caución: ONLY manual parameter (super clean input)
// - QUANT X Engine status section replaces old workflow
// - Premium QUANT X aesthetics (translucent cards, mono typography)
// ════════════════════════════════════════════════════════════════════════

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
  /** Auto-fetched Riesgo País from RAVA API (null = not yet fetched) */
  riesgoPaisAuto?: number | null;
  /** Whether the market is currently open (for QUANT X status display) */
  marketOpen?: boolean;
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
  riesgoPaisAuto,
  marketOpen,
}: ConfiguracionTabProps) {
  // ── Local state ──
  const [parseError, setParseError] = useState<string | null>(null);
  const [parseSuccess, setParseSuccess] = useState(false);
  const [addCapitalAmount, setAddCapitalAmount] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [backupStatus, setBackupStatus] = useState<string>('');
  const [priceHistoryStatus, setPriceHistoryStatus] = useState<string>('');
  const [eodStatus, setEodStatus] = useState<string>('');
  const [rawInputExpanded, setRawInputExpanded] = useState(false);

  const importFileRef = useRef<HTMLInputElement>(null);
  const priceHistoryFileRef = useRef<HTMLInputElement>(null);

  // ── Effective Riesgo País: auto takes priority, manual as fallback ──
  const effectiveRP = riesgoPaisAuto ?? config.riesgoPais;
  const rpSource = riesgoPaisAuto != null ? 'RAVA API' : 'Manual';
  const rpStatusColor = riesgoPaisAuto != null
    ? effectiveRP < 450 ? '#2eebc8'
    : effectiveRP < 550 ? '#fbbf24'
    : effectiveRP < 650 ? '#fb923c'
    : '#f87171'
    : '#6b7280';

  const rpStatusLabel = riesgoPaisAuto != null
    ? effectiveRP < 450 ? 'NORMAL'
    : effectiveRP < 550 ? 'PRECAUCIÓN'
    : effectiveRP < 650 ? 'ALERTA'
    : 'PELIGRO'
    : 'SIN DATOS';

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

      if (!rawData.version && !rawData.config) {
        setBackupStatus(
          '❌ Archivo no válido: no es un backup de ARB-RADAR'
        );
        setTimeout(() => setBackupStatus(''), 4000);
        return;
      }

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

      setConfig(normConfig);
      saveToStorage(STORAGE_KEYS.CONFIG, normConfig);
      setPosition(normPosition);
      saveToStorage(STORAGE_KEYS.POSITION, normPosition);
      setTransactions(normTransactions);
      saveToStorage(STORAGE_KEYS.TRANSACTIONS, normTransactions);
      setSimulations(normSimulations);
      saveToStorage(STORAGE_KEYS.SIMULATIONS, normSimulations);
      setInstruments(normInstruments.length > 0 ? normInstruments : instruments);
      if (normInstruments.length > 0) {
        saveToStorage(STORAGE_KEYS.INSTRUMENTS, normInstruments);
      }
      setExternalHistory(normHistory);
      saveToStorage(STORAGE_KEYS.EXTERNAL_HISTORY, normHistory);
      if (normSnapshots.length > 0) {
        onRestoreSnapshots(normSnapshots);
      } else {
        onRestoreSnapshots([]);
      }

      const exportDate = rawData.exportDate || new Date().toISOString();
      const dateKey = exportDate.slice(0, 10);
      try {
        localStorage.setItem(`arbradar_backup_${dateKey}`, JSON.stringify(rawData));
      } catch { /* storage full */ }

      if (normInstruments.length > 0) {
        const newHistory = mergeInstrumentsIntoHistory(
          null as Parameters<typeof mergeInstrumentsIntoHistory>[0],
          normInstruments,
          dateKey
        );
        setPriceHistory(newHistory);
        persistPriceHistory(newHistory);
      }

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

    event.target.value = '';
  };

  // ── 4. PRICE HISTORY IMPORT ────────────────────────────────────────────

  const handleLoadPriceHistory = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text) as PriceHistoryFile;

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

      const normResult = normalizePriceHistory(data);
      const normalized = normResult.normalized;
      const normalizedDateCount = Object.keys(normalized.historico).length;

      const mergeResult = mergePriceHistoryIncremental(priceHistory, normalized);
      const merged = mergeResult.merged;

      setPriceHistory(merged);
      savePriceHistory(merged);

      const phTickerCount = new Set(
        Object.values(merged.historico as Record<string, Record<string, unknown>>).flatMap((day) => Object.keys(day))
      ).size;

      const newDatesAdded = priceHistory
        ? Object.keys(normalized.historico).filter(d => !(d in priceHistory.historico)).length
        : normalizedDateCount;

      let statusMsg = `✅ Historial mergeado: ${newDatesAdded} día(s) nuevo(s), ${phTickerCount} tickers, ${normalizedDateCount} días totales`;
      const totalScaled = normResult.scaledCount + mergeResult.scaledCount;
      if (totalScaled > 0) {
        statusMsg += ` | 🔄 ${totalScaled} precio(s) normalizado(s)`;
      }
      const totalRejected = normResult.rejectedCount + mergeResult.rejectedCount;
      if (totalRejected > 0) {
        statusMsg += ` | ⚠️ ${totalRejected} entrada(s) basura rechazada(s)`;
      }

      setPriceHistoryStatus(statusMsg);
      setTimeout(() => setPriceHistoryStatus(''), 3000);
    } catch (err) {
      setPriceHistoryStatus(
        `❌ Error al cargar historial: ${err instanceof Error ? err.message : 'JSON inválido'}`
      );
      setTimeout(() => setPriceHistoryStatus(''), 5000);
    }

    event.target.value = '';
  };

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

  const handleResetPriceHistory = () => {
    clearPriceHistory();
    const empty: PriceHistoryFile = {
      descripcion: 'Histórico limpiado — V7.0',
      metadatos: { moneda: 'ARS', periodo: '', instrumentos_maestro: {} },
      historico: {},
    };
    setPriceHistory(empty);
    savePriceHistory(empty);
    setPriceHistoryStatus('✅ Historial de precios reseteado.');
    setTimeout(() => setPriceHistoryStatus(''), 5000);
  };

  const handleEODAppend = () => {
    if (instruments.length === 0) {
      setEodStatus('❌ No hay instrumentos cargados para guardar el cierre');
      setTimeout(() => setEodStatus(''), 4000);
      return;
    }

    const today = new Date();
    const dateKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

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
      setEodStatus(`✅ Cierre EOD guardado: ${newTickerCount} instrumento(s) registrados al ${dateKey}`);
    }
    setTimeout(() => setEodStatus(''), 5000);
  };

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
      parts.push(`${result.scaledCount} precio(s) normalizado(s)`);
    }
    if (result.rejectedCount > 0) {
      parts.push(`${result.rejectedCount} entrada(s) basura eliminada(s)`);
    }
    if (parts.length > 0) {
      setPriceHistoryStatus(`✅ Normalización completada: ${parts.join(', ')} de ${result.totalCount} totales`);
    } else {
      setPriceHistoryStatus('✅ Historial limpio — todos los precios en escala 1.XXXX');
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

  const auditStats = hasPriceHistory ? countAuditEntries(priceHistory!) : null;
  const phTickerCount = hasPriceHistory
    ? new Set(Object.values(priceHistory!.historico).flatMap(d => Object.keys(d))).size
    : 0;

  // ── Shared status toast helper (returns JSX, NOT a component) ──
  const renderStatusToast = (message: string) => (
    <div className={`mt-3 p-3 rounded-xl text-xs font-medium animate-fadeIn backdrop-blur-sm ${
      message.startsWith('✅') ? 'bg-[#2eebc8]/8 text-[#2eebc8] border border-[#2eebc8]/15' :
      message.startsWith('❌') ? 'bg-[#f87171]/8 text-[#f87171] border border-[#f87171]/15' :
      'bg-slate-900/40 text-app-text3 border border-white/10'
    }`}>
      {message}
    </div>
  );

  return (
    <div className="space-y-5">
      {/* ══════════════════════════════════════════════════════════════════
          HEADER — QUANT X ENGINE
          ══════════════════════════════════════════════════════════════════ */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-app-text mb-0.5">
            <span className="text-[#2eebc8]">◈</span> CONFIG — <span className="text-[#2eebc8]">QUANT X</span>
          </h2>
          <p className="text-[11px] text-app-text3 font-mono">
            Motor automatizado · Parámetros de referencia · Persistencia
          </p>
        </div>
        <div className="flex items-center gap-3">
          {saveSuccess && (
            <span className="text-[#2eebc8] text-xs font-mono font-medium animate-fadeIn">
              ✓ Guardado
            </span>
          )}
          <button
            onClick={handleSaveConfig}
            className="px-4 py-1.5 bg-[#2eebc8]/10 text-[#2eebc8] font-mono text-xs font-medium rounded-lg border border-[#2eebc8]/20 hover:bg-[#2eebc8]/20 transition-all duration-200"
          >
            💾 Guardar
          </button>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          ◈ OPERACIÓN AUTOMATIZADA — QUANT X ENGINE
          ══════════════════════════════════════════════════════════════════ */}
      <div className="bg-slate-900/40 rounded-xl border border-white/10 p-5 backdrop-blur-sm">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-[#2eebc8] text-sm">◈</span>
          <h3 className="text-sm font-bold text-app-text tracking-wide uppercase">
            Operación Automatizada — QUANT X Engine
          </h3>
        </div>

        <div className="space-y-3">
          {/* Polling Status */}
          <div className="flex items-start gap-3">
            <div className="mt-0.5">
              <div className={`w-2 h-2 rounded-full ${marketOpen ? 'bg-[#2eebc8] animate-pulse' : 'bg-[#fb923c]'}`} />
            </div>
            <div className="flex-1">
              <div className="text-xs text-app-text2 font-medium">
                Polling activo de instrumentos e historial vía IOL API
              </div>
              <div className="text-[10px] text-app-text4 font-mono mt-0.5">
                Adaptativo: <span className="text-[#2eebc8]">60s</span> rueda / <span className="text-[#fb923c]">5m</span> cierre · Estado actual:{' '}
                <span className={marketOpen ? 'text-[#2eebc8]' : 'text-[#fb923c]'}>
                  {marketOpen ? 'RUEDA' : 'FUERA DE HORARIO'}
                </span>
              </div>
            </div>
          </div>

          {/* RAVA API — Riesgo País */}
          <div className="flex items-start gap-3">
            <div className="mt-0.5">
              <div
                className="w-2 h-2 rounded-full"
                style={{
                  backgroundColor: riesgoPaisAuto != null ? '#2eebc8' : '#6b7280',
                  animation: riesgoPaisAuto != null ? 'pulse 2s infinite' : 'none',
                }}
              />
            </div>
            <div className="flex-1">
              <div className="text-xs text-app-text2 font-medium">
                Sincronización de Riesgo País automatizada vía RAVA API
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[10px] font-mono text-app-text4">
                  Status:
                </span>
                <span className={`text-[10px] font-mono font-bold ${riesgoPaisAuto != null ? 'text-[#2eebc8]' : 'text-app-text4'}`}>
                  {riesgoPaisAuto != null ? 'CONECTADO A RAVA' : 'ESPERANDO DATOS'}
                </span>
                {riesgoPaisAuto != null && (
                  <>
                    <span className="text-[10px] text-app-text4">·</span>
                    <span className="text-[10px] font-mono" style={{ color: rpStatusColor }}>
                      {effectiveRP.toFixed(0)} pb — {rpStatusLabel}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Caución — Only Manual Requirement */}
          <div className="flex items-start gap-3">
            <div className="mt-0.5">
              <div className="w-2 h-2 rounded-full bg-[#fbbf24]" />
            </div>
            <div className="flex-1">
              <div className="text-xs text-app-text2 font-medium">
                Único requerimiento manual: Validar/setear la tasa de Caución de referencia al inicio de la rueda
              </div>
              <div className="text-[10px] text-app-text4 font-mono mt-0.5">
                Fuente: PPI Cauciones · Setear abajo ↓
              </div>
            </div>
          </div>
        </div>

        {/* V5.4: TEST AUDIO — Unblock browser autoplay policy */}
        <div className="mt-4 pt-3 border-t border-white/5">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-app-text4 font-mono uppercase tracking-wider">
                🔊 Audio Alertas:
              </span>
              <button
                type="button"
                onClick={() => {
                  try {
                    const ctx = new AudioContext();
                    if (ctx.state === 'suspended') ctx.resume();
                    // Play test beep: 880Hz square wave
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.type = 'square';
                    osc.frequency.setValueAtTime(880, ctx.currentTime);
                    gain.gain.setValueAtTime(0.15, ctx.currentTime);
                    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
                    osc.connect(gain);
                    gain.connect(ctx.destination);
                    osc.start(ctx.currentTime);
                    osc.stop(ctx.currentTime + 0.2);
                  } catch (e) {
                    alert('Audio no disponible: ' + (e instanceof Error ? e.message : String(e)));
                  }
                }}
                className="px-3 py-1 rounded-lg text-[10px] font-bold font-mono uppercase tracking-wide transition-all hover:scale-105 active:scale-95"
                style={{
                  background: 'rgba(46,235,200,0.1)',
                  color: '#2eebc8',
                  border: '1px solid rgba(46,235,200,0.2)',
                }}
              >
                TEST AUDIO
              </button>
              <span className="text-[9px] text-app-text4 font-mono">
                (Desbloquea el contexto de audio del navegador)
              </span>
            </div>
          </div>
        </div>

        {/* Divider */}
        <div className="mt-4 pt-3 border-t border-white/5">
          <div className="flex items-center gap-4 text-[9px] text-app-text4 font-mono uppercase tracking-wider">
            <span>Instrumentos: <span className="text-app-text2">{instruments.length}</span></span>
            <span>·</span>
            <span>RP: <span style={{ color: rpStatusColor }}>{effectiveRP.toFixed(0)} pb</span></span>
            <span>·</span>
            <span>Comisión: <span className="text-app-text2">{config.comisionTotal.toFixed(2)}%</span></span>
            <span>·</span>
            <span>Capital: <span className="text-[#2eebc8]">${config.capitalDisponible.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span></span>
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          CAUCIÓN DE REFERENCIA — The ONLY Manual Action
          Premium monospace input with QUANT X styling
          ══════════════════════════════════════════════════════════════════ */}
      <div className="bg-slate-900/40 rounded-xl border border-[#fbbf24]/15 p-5 backdrop-blur-sm">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-[#fbbf24] text-xs">◉</span>
          <h3 className="text-sm font-bold text-app-text tracking-wide uppercase">
            Tasa de Caución — Referencia Manual
          </h3>
          <span className="text-[8px] px-1.5 py-0.5 rounded bg-[#fbbf24]/10 text-[#fbbf24] font-mono font-bold border border-[#fbbf24]/20">
            MANUAL
          </span>
        </div>
        <p className="text-[10px] text-app-text4 mb-4 font-mono">
          Extraída visualmente de PPI Cauciones. Setear al inicio de cada rueda.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-[9px] text-app-text4 uppercase tracking-[0.15em] font-mono font-medium mb-2">
              Caución 1 día <span className="text-[#fbbf24]">★</span>
            </label>
            <div className="relative">
              <input
                type="number"
                step="0.1"
                value={Number(config.caucion1d.toFixed(1))}
                onChange={(e) => handleConfigChange('caucion1d', e.target.value)}
                className="w-full bg-slate-950/60 border border-white/10 rounded-lg px-4 py-3 text-[#fbbf24] font-mono text-xl font-bold focus:border-[#fbbf24]/40 focus:outline-none focus:ring-1 focus:ring-[#fbbf24]/20 transition-all placeholder:text-app-text4/30"
                placeholder="TNA %"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-app-text4 font-mono">TNA%</span>
            </div>
          </div>
          <div>
            <label className="block text-[9px] text-app-text4 uppercase tracking-[0.15em] font-mono font-medium mb-2">
              Caución 7 días
            </label>
            <div className="relative">
              <input
                type="number"
                step="0.1"
                value={Number(config.caucion7d.toFixed(1))}
                onChange={(e) => handleConfigChange('caucion7d', e.target.value)}
                className="w-full bg-slate-950/60 border border-white/10 rounded-lg px-4 py-3 text-app-text font-mono text-lg font-bold focus:border-[#2eebc8]/30 focus:outline-none focus:ring-1 focus:ring-[#2eebc8]/10 transition-all placeholder:text-app-text4/30"
                placeholder="TNA %"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-app-text4 font-mono">TNA%</span>
            </div>
          </div>
          <div>
            <label className="block text-[9px] text-app-text4 uppercase tracking-[0.15em] font-mono font-medium mb-2">
              Caución 30 días
            </label>
            <div className="relative">
              <input
                type="number"
                step="0.1"
                value={Number(config.caucion30d.toFixed(1))}
                onChange={(e) => handleConfigChange('caucion30d', e.target.value)}
                className="w-full bg-slate-950/60 border border-white/10 rounded-lg px-4 py-3 text-app-text font-mono text-lg font-bold focus:border-[#2eebc8]/30 focus:outline-none focus:ring-1 focus:ring-[#2eebc8]/10 transition-all placeholder:text-app-text4/30"
                placeholder="TNA %"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-app-text4 font-mono">TNA%</span>
            </div>
          </div>
        </div>

        <div className="text-[10px] text-app-text4 mt-3 font-mono">
          Fuente: PPI Cauciones · Actualizar al inicio de cada rueda
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          CAPITAL Y COMISIÓN — Compact Section
          ══════════════════════════════════════════════════════════════════ */}
      <div className="bg-slate-900/40 rounded-xl border border-white/10 p-5 backdrop-blur-sm">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-[#2eebc8] text-xs">◈</span>
          <h3 className="text-sm font-bold text-app-text tracking-wide uppercase">
            Capital y Comisión
          </h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Capital Disponible */}
          <div>
            <label className="block text-[9px] text-app-text4 uppercase tracking-[0.15em] font-mono font-medium mb-2">
              Capital Disponible
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] text-app-text4 font-mono">$</span>
              <input
                type="number"
                step="1000"
                value={Math.round(config.capitalDisponible)}
                onChange={(e) => handleConfigChange('capitalDisponible', e.target.value)}
                className="w-full bg-slate-950/60 border border-white/10 rounded-lg pl-7 pr-4 py-2.5 text-[#2eebc8] font-mono text-lg font-bold focus:border-[#2eebc8]/30 focus:outline-none focus:ring-1 focus:ring-[#2eebc8]/10 transition-all"
              />
            </div>
          </div>

          {/* Agregar Capital */}
          <div>
            <label className="block text-[9px] text-app-text4 uppercase tracking-[0.15em] font-mono font-medium mb-2">
              Agregar Capital
            </label>
            <div className="flex gap-2">
              <input
                type="number"
                step="1000"
                value={addCapitalAmount}
                onChange={(e) => setAddCapitalAmount(e.target.value)}
                placeholder="Monto"
                className="w-full bg-slate-950/60 border border-white/10 rounded-lg px-3 py-2.5 text-app-text font-mono text-sm focus:border-[#2eebc8]/30 focus:outline-none transition-all placeholder:text-app-text4/30"
              />
              <button
                onClick={handleAddCapital}
                disabled={!addCapitalAmount || parseFloat(addCapitalAmount) <= 0}
                className="px-3 py-2.5 bg-[#2eebc8]/10 text-[#2eebc8] font-mono text-xs font-medium rounded-lg border border-[#2eebc8]/20 hover:bg-[#2eebc8]/20 transition-all disabled:opacity-30 disabled:cursor-not-allowed whitespace-nowrap"
              >
                + Add
              </button>
            </div>
          </div>

          {/* Comisión */}
          <div>
            <label className="block text-[9px] text-app-text4 uppercase tracking-[0.15em] font-mono font-medium mb-2">
              Comisión Round-Trip
            </label>
            <div className="relative">
              <input
                type="number"
                step="0.01"
                value={Number(config.comisionTotal.toFixed(2))}
                onChange={(e) => handleConfigChange('comisionTotal', e.target.value)}
                className="w-full bg-slate-950/60 border border-white/10 rounded-lg px-4 py-2.5 text-app-text font-mono text-sm focus:border-[#2eebc8]/30 focus:outline-none transition-all"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-app-text4 font-mono">%</span>
            </div>
          </div>

          {/* Capital Total Display */}
          <div className="flex items-end">
            <div className="bg-slate-950/60 rounded-lg p-3 w-full border border-white/5">
              <div className="text-[8px] text-app-text4 uppercase tracking-[0.15em] font-mono mb-1">
                Capital Total
              </div>
              <div className="font-mono text-xl font-bold text-[#2eebc8]">
                ${config.capitalDisponible.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
              </div>
            </div>
          </div>
        </div>

        <div className="text-[10px] text-app-text4 mt-3 font-mono">
          El capital se descuenta automáticamente al comprar y se suma al vender. Usá &quot;Agregar&quot; para registrar aportes adicionales.
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          RIESGO PAÍS — READ ONLY (Auto from RAVA API)
          ══════════════════════════════════════════════════════════════════ */}
      <div className="bg-slate-900/40 rounded-xl border border-white/10 p-5 backdrop-blur-sm">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[#a78bfa] text-xs">◈</span>
          <h3 className="text-sm font-bold text-app-text tracking-wide uppercase">
            Riesgo País
          </h3>
          <span className="text-[8px] px-1.5 py-0.5 rounded bg-[#2eebc8]/10 text-[#2eebc8] font-mono font-bold border border-[#2eebc8]/20">
            AUTO
          </span>
        </div>

        <div className="flex items-center gap-4">
          {/* Live indicator dot */}
          <div className="flex flex-col items-center gap-1">
            <div
              className="w-3 h-3 rounded-full"
              style={{
                backgroundColor: riesgoPaisAuto != null ? '#2eebc8' : '#6b7280',
                animation: riesgoPaisAuto != null ? 'pulse 2s infinite' : 'none',
                boxShadow: riesgoPaisAuto != null ? '0 0 8px #2eebc8' : 'none',
              }}
            />
            <span className="text-[7px] text-app-text4 font-mono">
              {riesgoPaisAuto != null ? 'LIVE' : 'OFF'}
            </span>
          </div>

          {/* Value display */}
          <div className="flex-1">
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-3xl font-bold" style={{ color: rpStatusColor }}>
                {effectiveRP.toFixed(0)}
              </span>
              <span className="text-xs text-app-text4 font-mono">pb</span>
              <span
                className="text-[10px] font-mono font-bold px-2 py-0.5 rounded"
                style={{
                  color: rpStatusColor,
                  backgroundColor: `${rpStatusColor}15`,
                  border: `1px solid ${rpStatusColor}25`,
                }}
              >
                {rpStatusLabel}
              </span>
            </div>
            <div className="text-[10px] text-app-text4 font-mono mt-1">
              Fuente: <span className="text-[#2eebc8]">RAVA API</span> · Sincronización automática · Último: {riesgoPaisAuto != null ? 'Conectado' : 'Pendiente'}
            </div>
          </div>

          {/* Threshold legend */}
          <div className="hidden md:block text-[9px] font-mono space-y-0.5">
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-[#2eebc8]" />
              <span className="text-app-text4">&lt;450 OK</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-[#fbbf24]" />
              <span className="text-app-text4">450-550 Precaución</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-[#fb923c]" />
              <span className="text-app-text4">550-650 Alerta</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-[#f87171]" />
              <span className="text-app-text4">&gt;650 Peligro</span>
            </div>
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          BACKUP Y RESTAURACIÓN
          ══════════════════════════════════════════════════════════════════ */}
      <div className="bg-slate-900/40 rounded-xl border border-white/10 p-5 backdrop-blur-sm">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-app-text3 text-xs">◈</span>
          <h3 className="text-sm font-bold text-app-text tracking-wide uppercase">
            Backup y Restauración
          </h3>
        </div>
        <p className="text-[10px] text-app-text4 mb-4 font-mono">
          Exportá/importá un JSON con toda tu configuración, posición, historial y simulaciones.
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={handleExportBackup}
            className="px-4 py-2 bg-[#2eebc8]/10 text-[#2eebc8] font-mono text-xs font-medium rounded-lg border border-[#2eebc8]/20 hover:bg-[#2eebc8]/20 transition-all"
          >
            📥 Exportar Backup
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
            className="px-4 py-2 bg-slate-800/60 border border-white/10 text-app-text2 font-mono text-xs rounded-lg hover:bg-slate-700/60 transition-all"
          >
            📤 Importar Backup
          </button>
        </div>
        {backupStatus && renderStatusToast(backupStatus)}
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          HISTORIAL DE PRECIOS
          ══════════════════════════════════════════════════════════════════ */}
      <div className="bg-slate-900/40 rounded-xl border border-white/10 p-5 backdrop-blur-sm">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-app-text3 text-xs">◈</span>
          <h3 className="text-sm font-bold text-app-text tracking-wide uppercase">
            Historial de Precios
          </h3>
        </div>

        {/* Status indicator */}
        <div className="mb-4 p-3 border border-dashed border-white/10 rounded-xl hover:border-[#2eebc8]/20 transition-colors">
          <div className="flex items-center gap-2">
            <div
              className={`w-2 h-2 rounded-full ${hasPriceHistory ? 'bg-[#2eebc8]' : 'bg-app-text4'}`}
              style={{ animation: hasPriceHistory ? 'pulse 2s infinite' : 'none' }}
            />
            <span className="text-xs text-app-text2 font-mono">
              {hasPriceHistory ? 'Historial cargado' : 'Sin historial'}
            </span>
          </div>
          {hasPriceHistory && (
            <div className="mt-2 space-y-1 text-[10px] text-app-text4 font-mono ml-4">
              <div>Rango: {priceHistoryDateRange}</div>
              <div>Tickers: {phTickerCount}</div>
              <div className={`flex items-center gap-1.5 ${isHistoryStale ? 'text-[#fbbf24]' : 'text-[#2eebc8]'}`}>
                <div className={`w-1.5 h-1.5 rounded-full ${isHistoryStale ? 'bg-[#fbbf24]' : 'bg-[#2eebc8]'}`} />
                <span>
                  {lastCloseDate
                    ? isHistoryStale
                      ? `Último cierre: ${lastCloseDate} (hace ${daysSinceLastClose}d — DESACTUALIZADO)`
                      : `Último cierre: ${lastCloseDate} (actualizado)`
                    : 'Sin cierres registrados'}
                </span>
              </div>
              {auditStats && auditStats.scaled === 0 && auditStats.rejected === 0 && (
                <div className="text-[#2eebc8]">✓ Normalizado — escala 1.XXXX</div>
              )}
            </div>
          )}
        </div>

        {/* Stale Warning */}
        {hasPriceHistory && isHistoryStale && (
          <div className="mb-4 p-3 rounded-xl bg-[#fbbf24]/6 border border-[#fbbf24]/15 animate-fadeInUp">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs">⚠️</span>
              <span className="text-[#fbbf24] text-[10px] font-bold font-mono uppercase">Historial desactualizado</span>
            </div>
            <p className="text-[10px] text-app-text3 font-mono">
              Último cierre: <span className="text-app-text2">{lastCloseDate}</span> (hace <span className="text-[#fbbf24]">{daysSinceLastClose}d</span>).
              Usá <strong className="text-app-text2">💾 Guardar Cierre</strong> para actualizar.
            </p>
          </div>
        )}

        {/* Today Close Status */}
        {hasPriceHistory && todayCloseExists && (
          <div className="mb-4 p-3 rounded-xl bg-[#2eebc8]/6 border border-[#2eebc8]/15 animate-fadeInUp">
            <div className="flex items-center gap-2">
              <span className="text-xs">✅</span>
              <span className="text-[#2eebc8] text-[10px] font-bold font-mono uppercase">Cierre de hoy registrado</span>
              <span className="text-[9px] text-app-text4 font-mono">— {Object.keys(todayCloseExists).length} instrumentos</span>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          <input
            ref={priceHistoryFileRef}
            type="file"
            accept=".json"
            onChange={handleLoadPriceHistory}
            className="hidden"
          />
          <button
            onClick={() => priceHistoryFileRef.current?.click()}
            className="px-3 py-1.5 bg-[#2eebc8]/10 text-[#2eebc8] font-mono text-[11px] font-medium rounded-lg border border-[#2eebc8]/20 hover:bg-[#2eebc8]/20 transition-all"
          >
            📂 Cargar JSON
          </button>
          <button
            onClick={handleEODAppend}
            disabled={instruments.length === 0}
            className={`px-3 py-1.5 font-mono text-[11px] font-medium rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed ${
              todayCloseExists
                ? 'bg-slate-800/60 border border-[#2eebc8]/20 text-[#2eebc8] hover:bg-[#2eebc8]/10'
                : 'bg-[#22d3ee]/10 text-[#22d3ee] border border-[#22d3ee]/20 hover:bg-[#22d3ee]/20'
            }`}
            title={todayCloseExists ? 'Ya existe cierre de hoy — se agregarán tickers faltantes' : 'Guardar precios actuales como cierre EOD'}
          >
            💾 Guardar Cierre
          </button>
          {hasPriceHistory && (
            <button
              onClick={handleDownloadPriceHistory}
              className="px-3 py-1.5 bg-slate-800/60 border border-white/10 text-app-text3 font-mono text-[11px] rounded-lg hover:bg-slate-700/60 transition-all"
              title="Descargar JSON para auditoría"
            >
              🔍 Auditar JSON
            </button>
          )}
          {hasPriceHistory && auditStats && (auditStats.scaled > 0 || auditStats.rejected > 0) && (
            <button
              onClick={handleNormalizeHistory}
              className="px-3 py-1.5 bg-[#fbbf24]/8 text-[#fbbf24] border border-[#fbbf24]/15 font-mono text-[11px] rounded-lg hover:bg-[#fbbf24]/15 transition-all"
            >
              🔄 Normalizar
            </button>
          )}
          {hasPriceHistory && (
            <button
              onClick={handleResetPriceHistory}
              className="px-3 py-1.5 bg-[#f87171]/8 text-[#f87171] border border-[#f87171]/15 font-mono text-[11px] rounded-lg hover:bg-[#f87171]/15 transition-all"
              title="Resetear historial completo"
            >
              🗑️ Resetear
            </button>
          )}
        </div>

        {eodStatus && renderStatusToast(eodStatus)}
        {priceHistoryStatus && renderStatusToast(priceHistoryStatus)}
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          DATOS MANUALES (Collapsible — fallback for offline use)
          ══════════════════════════════════════════════════════════════════ */}
      <div className="bg-slate-900/40 rounded-xl border border-white/10 backdrop-blur-sm overflow-hidden">
        <button
          onClick={() => setRawInputExpanded(prev => !prev)}
          className="w-full flex items-center justify-between p-4 hover:bg-white/[0.02] transition-all"
        >
          <div className="flex items-center gap-2">
            <span className="text-app-text4 text-xs">◈</span>
            <h3 className="text-sm font-bold text-app-text4 tracking-wide uppercase">
              Datos Manuales (Fallback)
            </h3>
            <span className="text-[8px] px-1.5 py-0.5 rounded bg-app-text4/10 text-app-text4/60 font-mono font-bold border border-app-text4/10">
              OFFLINE
            </span>
          </div>
          <span className="text-app-text4 text-xs font-mono">
            {rawInputExpanded ? '▲' : '▼'}
          </span>
        </button>

        {rawInputExpanded && (
          <div className="px-5 pb-5 animate-fadeIn">
            <p className="text-[10px] text-app-text4 mb-3 font-mono">
              Pegá datos crudos de acuantoesta.com.ar — solo necesario si LIVE está desactivado.
            </p>
            <textarea
              value={rawInput}
              onChange={(e) => setRawInput(e.target.value)}
              className="w-full h-36 rounded-lg bg-slate-950/60 border border-white/10 font-mono text-[10px] focus:border-[#2eebc8]/30 focus:outline-none resize-y p-3 text-app-text2 placeholder:text-app-text4/30 transition-all"
              placeholder={`Formato vertical (copy-paste de acuantoesta.com.ar):\nS30A6LECAP\n30/04/2026\n12\n1,2685\n0.19%\n...\n\nO formato pipe-delimited:\nS30O6|LECAP|30/10/2026|196|1.1550|0.57|28.0|2.15|16.95`}
            />
            <div className="flex items-center gap-3 mt-2">
              <button
                onClick={handleParse}
                disabled={!rawInput.trim()}
                className="px-4 py-1.5 bg-[#2eebc8]/10 text-[#2eebc8] font-mono text-xs font-medium rounded-lg border border-[#2eebc8]/20 hover:bg-[#2eebc8]/20 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Parsear
              </button>
              <button
                onClick={handleClearRawInput}
                className="px-4 py-1.5 bg-slate-800/60 border border-white/10 text-app-text4 font-mono text-xs rounded-lg hover:bg-slate-700/60 transition-all"
              >
                Limpiar
              </button>
              {parseSuccess && (
                <span className="text-[10px] text-[#2eebc8] font-mono">✓ {instruments.length} instrumento(s) cargado(s)</span>
              )}
              {parseError && (
                <span className="text-[10px] text-[#f87171] font-mono">✗ {parseError}</span>
              )}
            </div>
            {instruments.length > 0 && (
              <div className="text-[9px] text-app-text4 mt-2 font-mono">
                {instruments.length} instrumento(s) — último update: {localStorage.getItem(STORAGE_KEYS.LAST_UPDATE)?.replace(/"/g, '') || '—'}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
