'use client';

import React, { useState, useRef, useCallback, useMemo } from 'react';
import { Instrument, Config, Position, Transaction, SimulationRecord, ExternalHistoryRecord, MomentumData, SRData, LiveInstrument } from '@/lib/types';
import { calculatePnL, analyzeRotation, durationMod } from '@/lib/calculations';
import { roundTo } from '@/lib/chart-formatters';
import { saveToStorage, STORAGE_KEYS } from '@/lib/sampleData';
import { calculateSR, PriceHistoryFile } from '@/lib/priceHistory';
import { parseCSVLine, parseNumber, excelSerialToDate, isExcelDateSerial, cellToString, cellToNumber, parseXlsxRows } from '@/lib/parsers';
import ChartContainer from './ChartContainer';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts';

interface CarteraTabProps {
  instruments: Instrument[];   // V2.0.3: already effectiveInstruments from page.tsx (with live prices)
  config: Config;
  setConfig: (v: Config) => void;
  position: Position | null;
  setPosition: (v: Position | null) => void;
  transactions: Transaction[];
  setTransactions: (v: Transaction[]) => void;
  externalHistory: ExternalHistoryRecord[];
  setExternalHistory: (v: ExternalHistoryRecord[]) => void;
  momentumMap: Map<string, MomentumData>;
  priceHistory: PriceHistoryFile | null;
  // V2.0.3: Live data from page.tsx for real-time P&L
  liveDataMap: Map<string, LiveInstrument>;
  isLive: boolean;
}

export default function CarteraTab({
  instruments,
  config,
  setConfig,
  position,
  setPosition,
  transactions,
  setTransactions,
  externalHistory,
  setExternalHistory,
  momentumMap,
  priceHistory,
  liveDataMap,
  isLive,
}: CarteraTabProps) {
  const [formTicker, setFormTicker] = useState('');
  const [formVN, setFormVN] = useState('');
  const [formPrice, setFormPrice] = useState('');
  const [formDate, setFormDate] = useState('');
  const [formPrecioConComision, setFormPrecioConComision] = useState('');

  // Rotation modal state
  const [showRotation, setShowRotation] = useState(false);
  const [rotationTarget, setRotationTarget] = useState('');
  const [rotationStep, setRotationStep] = useState<'select' | 'confirm' | 'done'>('select');
  const [rotationManualSellPrice, setRotationManualSellPrice] = useState('');
  const [rotationManualBuyPrice, setRotationManualBuyPrice] = useState('');

  // Close position confirmation state
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  // Clipboard feedback state
  const [copiedToClipboard, setCopiedToClipboard] = useState(false);

  // History import state
  const [showHistoryImport, setShowHistoryImport] = useState(false);
  const [historyRawInput, setHistoryRawInput] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Simulation logbook state
  const [simulations, setSimulations] = useState<SimulationRecord[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.SIMULATIONS);
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  });

  const currentInstrument = position
    ? instruments.find(i => i.ticker === position.ticker)
    : null;

  // V2.0.3: Get LIVE price for position's ticker (most real-time source)
  const livePositionData = position ? liveDataMap.get(position.ticker) : null;
  const livePrice = livePositionData?.last_price ?? null;

  // V1.9.2 — S/R data map for hybrid rotation logic
  const srDataMap = useMemo<Map<string, SRData>>(() => {
    if (!priceHistory) return new Map();
    const srArray = calculateSR(priceHistory, instruments);
    return new Map(srArray.map(sr => [sr.ticker, sr]));
  }, [priceHistory, instruments]);

  // Selected instrument from dropdown for auto-fill
  const selectedFormInstrument = formTicker
    ? instruments.find(i => i.ticker === formTicker)
    : null;

  // Group instruments by type for dropdown
  const lecapOptions = instruments.filter(i => i.type === 'LECAP').sort((a, b) => a.days - b.days);
  const boncapOptions = instruments.filter(i => i.type === 'BONCAP').sort((a, b) => a.days - b.days);

  // ====================== CARRY CALCULATION ======================
  const carryData = (() => {
    if (!currentInstrument || !position) return null;
    // V2.0.3: Use LIVE price if available, otherwise fall back to instrument price
    const effectivePrice = livePrice ?? currentInstrument.price;
    const capitalInvested = position.vn * position.entryPrice;
    const currentPrice = effectivePrice;
    const priceChange = ((currentPrice / position.entryPrice) - 1) * 100;

    const entryParts = position.entryDate.split('/');
    const entryDate = new Date(
      parseInt(entryParts[2]),
      parseInt(entryParts[1]) - 1,
      parseInt(entryParts[0])
    );
    const now = new Date();
    const daysHeld = Math.max(1, Math.floor((now.getTime() - entryDate.getTime()) / (1000 * 60 * 60 * 24)));

    // Carry = TEM * (daysHeld / 30)
    const carry = currentInstrument.tem * (daysHeld / 30);

    // Total return = Ganancia de Posición % (bruto, sin descontar comisión de salida)
    const valorActual = position.vn * currentInstrument.price;
    const costoEntrada = position.precioConComision
      ? position.vn * position.precioConComision
      : position.vn * position.entryPrice * (1 + config.comisionTotal / 2 / 100);
    const totalReturn = costoEntrada > 0 ? ((valorActual - costoEntrada) / costoEntrada) * 100 : 0;

    return {
      capitalInvested,
      priceChange,
      carry,
      daysHeld,
      totalReturn,
    };
  })();

  // ====================== ROTATION LOGIC ======================
  const rotationTargetInstrument = rotationTarget
    ? instruments.find(i => i.ticker === rotationTarget)
    : null;

  // Effective prices: manual execution price overrides dashboard market price
  const effectiveSellPrice = rotationManualSellPrice
    ? parseFloat(rotationManualSellPrice)
    : currentInstrument?.price ?? 0;
  const effectiveBuyPrice = rotationManualBuyPrice
    ? parseFloat(rotationManualBuyPrice)
    : rotationTargetInstrument?.price ?? 0;

  const rotationAnalysis = position && currentInstrument && rotationTargetInstrument
    ? (() => {
        const saleGross = position.vn * effectiveSellPrice;
        const comisionSalida = saleGross * (config.comisionTotal / 2 / 100);
        const capitalNetoSalida = saleGross - comisionSalida;

        const precioB = effectiveBuyPrice;
        const comisionEntradaRate = config.comisionTotal / 2 / 100;
        const capitalParaCompra = capitalNetoSalida / (1 + comisionEntradaRate);
        const nuevosNominalesB = Math.floor(capitalParaCompra / precioB);
        const costoTotalB = nuevosNominalesB * precioB * (1 + comisionEntradaRate);
        const capitalSobrante = capitalNetoSalida - costoTotalB;

        const spreadBruto = rotationTargetInstrument.tem - currentInstrument.tem;
        const comisionAmortizada = config.comisionTotal / (rotationTargetInstrument.days / 30);
        const spreadNeto = spreadBruto - comisionAmortizada;

        const carryDiarioDestino = rotationTargetInstrument.tem / 30;
        const paybackDays = carryDiarioDestino > 0 ? config.comisionTotal / carryDiarioDestino : Infinity;

        const costoTotalA = position.precioConComision
          ? position.vn * position.precioConComision
          : position.vn * position.entryPrice * (1 + config.comisionTotal / 2 / 100);
        const pnlRealizado = capitalNetoSalida - costoTotalA;

        // V1.5: TRAMPA evaluation — when rotating to LOWER yield instrument
        const isTrampa = rotationTargetInstrument.tem < currentInstrument.tem;

        // ════════════════════════════════════════════════════════════════
        // V1.9.2 — HYBRID ROTATION LOGIC (Precio + Momentum)
        // ════════════════════════════════════════════════════════════════

        // S/R data for origin and destination
        const srOrigen = srDataMap.get(position.ticker);
        const srDestino = srDataMap.get(rotationTargetInstrument.ticker);

        // Momentum data for origin and destination
        const momentumOrigen = momentumMap.get(position.ticker);
        const momentumDestino = momentumMap.get(rotationTargetInstrument.ticker);

        // ── Hybrid Factor 1: Upside Residual ──
        // If destination upside > origin upside by >0.50%, it's a Capital Jump
        const upsideOrigen = srOrigen?.upsideCapital ?? 0;
        const upsideDestino = srDestino?.upsideCapital ?? 0;
        const upsideDiff = upsideDestino - upsideOrigen;
        const isCapitalJump = upsideDiff > 0.50;

        // ── Hybrid Factor 2: S/R Ceiling Detection (origin > 90%) ──
        const posicionOrigen = srOrigen?.posicionEnCanal ?? 50;
        const isOrigenCeiling = posicionOrigen > 90;
        const isOrigenAgotado = upsideOrigen < 0.10; // <0.1% upside = exhausted

        // ── Hybrid Factor 3: Momentum Direction ──
        const momentumOrigenTendencia = momentumOrigen?.tendencia ?? '→';
        const momentumDestinoTendencia = momentumDestino?.tendencia ?? '→';
        const isDestinoAcelerando = momentumDestinoTendencia === '↑↑' || momentumDestinoTendencia === '↑';
        const isOrigenDecelerando = momentumOrigenTendencia === '↓↓' || momentumOrigenTendencia === '↓';
        const momentumFavorable = isDestinoAcelerando && isOrigenDecelerando;

        // ── Status Labels ──
        const statusTasa: 'Positivo' | 'Neutral' | 'Negativo' =
          spreadNeto > 0.05 ? 'Positivo' : spreadNeto >= -0.05 ? 'Neutral' : 'Negativo';

        const statusPrecio: 'Favorable' | 'Agotado' | 'Sin datos' =
          !srOrigen || !srDestino ? 'Sin datos' :
          isOrigenCeiling || isOrigenAgotado ? 'Agotado' :
          upsideDestino > upsideOrigen ? 'Favorable' : 'Agotado';

        const statusMomentum: 'Acelerando' | 'Estable' | 'Bajista' | 'Sin datos' =
          !momentumOrigen || !momentumDestino ? 'Sin datos' :
          momentumFavorable ? 'Acelerando' :
          isOrigenDecelerando ? 'Bajista' : 'Estable';

        // ── Hybrid Decision Factor ──
        // Determines if a "NO CONVIENE" should be overridden by price/momentum factors
        const hybridOverride =
          (isCapitalJump && spreadNeto > -0.30) || // Capital Jump outweighs small negative spread
          (isOrigenCeiling && upsideDestino > 0.30) || // Ceiling exit + any destination upside
          (momentumFavorable && spreadNeto > -0.15); // Momentum tilt + not too negative spread

        // ── V1.9.2 Evaluation Logic ──
        let evaluacion: string;
        let evaluacionColor: 'red' | 'amber' | 'cyan' | 'green' | 'emerald';

        if (isOrigenCeiling && isOrigenAgotado && upsideDestino > 0.20) {
          // Forced exit: origin is technically exhausted
          evaluacion = 'SALIDA SUGERIDA';
          evaluacionColor = 'cyan';
        } else if (isTrampa && !hybridOverride) {
          // Pure TRAMPA with no mitigating factors
          evaluacion = 'TRAMPA';
          evaluacionColor = 'red';
        } else if (isTrampa && hybridOverride) {
          // TRAMPA overridden by price/momentum → strategic rotation
          evaluacion = 'CONVENIENCIA POR PRECIO';
          evaluacionColor = 'cyan';
        } else if (spreadNeto > 0.25) {
          evaluacion = 'MUY ATRACTIVO';
          evaluacionColor = 'emerald';
        } else if (spreadNeto > 0.15) {
          evaluacion = 'ATRACTIVO';
          evaluacionColor = 'green';
        } else if (spreadNeto > 0.05) {
          evaluacion = 'MARGINAL';
          evaluacionColor = 'amber';
        } else if (spreadBruto < -0.10 && !hybridOverride) {
          evaluacion = 'PERDIDA SIGNIFICATIVA';
          evaluacionColor = 'red';
        } else if (spreadNeto <= 0.05 && hybridOverride) {
          // Spread is weak but price/momentum compensate
          evaluacion = 'CONVENIENCIA POR PRECIO';
          evaluacionColor = 'cyan';
        } else if (spreadBruto < -0.10 && hybridOverride) {
          // Even significant spread loss may be overridden by ceiling exit
          evaluacion = 'CONVENIENCIA POR PRECIO';
          evaluacionColor = 'cyan';
        } else {
          evaluacion = 'NO CONVIENE';
          evaluacionColor = 'red';
        }

        // ── Smart Legend ──
        let leyendaInteligente = '';
        if (evaluacion === 'CONVENIENCIA POR PRECIO' || evaluacion === 'SALIDA SUGERIDA') {
          if (isOrigenCeiling) {
            leyendaInteligente = 'Prioridad de salida: Activo actual agotado técnicamente';
          } else if (isCapitalJump) {
            leyendaInteligente = `Operación estratégica: Se sacrifica spread marginal para capturar un Upside de ${upsideDiff.toFixed(2)}%`;
          } else if (momentumFavorable) {
            leyendaInteligente = 'Momentum favorable: Destino acelerando mientras origen desacelera';
          }
        }

        return {
          fromTicker: position.ticker,
          toTicker: rotationTargetInstrument.ticker,
          saleGross,
          comisionSalida,
          capitalNetoSalida,
          precioB,
          comisionEntradaRate,
          capitalParaCompra,
          nuevosNominalesB,
          costoTotalB,
          capitalSobrante,
          spreadBruto,
          comisionAmortizada,
          spreadNeto,
          pnlRealizado,
          fromTEM: currentInstrument.tem,
          toTEM: rotationTargetInstrument.tem,
          toDays: rotationTargetInstrument.days,
          effectiveSellPrice,
          effectiveBuyPrice,
          carryDiarioDestino,
          paybackDays,
          evaluacion,
          evaluacionColor,
          isTrampa,
          // V1.9.2 hybrid fields
          statusTasa,
          statusPrecio,
          statusMomentum,
          isCapitalJump,
          isOrigenCeiling,
          isOrigenAgotado,
          momentumFavorable,
          upsideOrigen,
          upsideDestino,
          upsideDiff,
          posicionOrigen,
          momentumOrigenTendencia,
          momentumDestinoTendencia,
          leyendaInteligente,
        };
      })()
    : null;

  const handleExecuteRotation = () => {
    if (!position || !currentInstrument || !rotationTargetInstrument || !rotationAnalysis) return;

    const sellTransaction: Transaction = {
      id: Date.now().toString(),
      type: 'SELL',
      ticker: position.ticker,
      price: rotationAnalysis.effectiveSellPrice,
      vn: position.vn,
      date: new Date().toLocaleDateString('es-AR'),
      pnl: rotationAnalysis.pnlRealizado,
    };

    const newPosition: Position = {
      ticker: rotationTargetInstrument.ticker,
      entryPrice: rotationAnalysis.effectiveBuyPrice,
      vn: rotationAnalysis.nuevosNominalesB,
      entryDate: new Date().toLocaleDateString('es-AR'),
    };

    const buyTransaction: Transaction = {
      id: (Date.now() + 1).toString(),
      type: 'BUY',
      ticker: newPosition.ticker,
      price: newPosition.entryPrice,
      vn: newPosition.vn,
      date: newPosition.entryDate,
    };

    const saleNet = rotationAnalysis.capitalNetoSalida;
    const buyCost = rotationAnalysis.costoTotalB;
    const newCapital = config.capitalDisponible + saleNet - buyCost;

    const newConfig = { ...config, capitalDisponible: Math.max(0, newCapital) };
    const newTransactions = [buyTransaction, sellTransaction, ...transactions];

    setPosition(newPosition);
    setTransactions(newTransactions);
    setConfig(newConfig);

    setRotationStep('done');
  };

  // ====================== SIMULATION LOGBOOK ======================
  const handleSaveSimulation = () => {
    if (!rotationAnalysis) return;
    const record: SimulationRecord = {
      id: Date.now().toString(),
      timestamp: new Date().toISOString(),
      fromTicker: rotationAnalysis.fromTicker,
      toTicker: rotationAnalysis.toTicker,
      sellPrice: rotationAnalysis.effectiveSellPrice,
      buyPrice: rotationAnalysis.effectiveBuyPrice,
      sellPriceManual: !!rotationManualSellPrice,
      buyPriceManual: !!rotationManualBuyPrice,
      spreadNeto: rotationAnalysis.spreadNeto,
      spreadBruto: rotationAnalysis.spreadBruto,
      evaluacion: rotationAnalysis.evaluacion,
      paybackDays: rotationAnalysis.paybackDays === Infinity ? -1 : Math.ceil(rotationAnalysis.paybackDays),
      nuevosNominales: rotationAnalysis.nuevosNominalesB,
      capitalNetoSalida: rotationAnalysis.capitalNetoSalida,
      capitalSobrante: rotationAnalysis.capitalSobrante,
    };
    const updated = [record, ...simulations];
    setSimulations(updated);
    saveToStorage(STORAGE_KEYS.SIMULATIONS, updated);
  };

  const handleDeleteSimulation = (id: string) => {
    const updated = simulations.filter(s => s.id !== id);
    setSimulations(updated);
    saveToStorage(STORAGE_KEYS.SIMULATIONS, updated);
  };

  const handleLoadSimulation = (sim: SimulationRecord) => {
    if (!position) return;
    setShowRotation(true);
    setRotationStep('select');
    setRotationTarget(sim.toTicker);
    setRotationManualSellPrice(sim.sellPriceManual ? sim.sellPrice.toString() : '');
    setRotationManualBuyPrice(sim.buyPriceManual ? sim.buyPrice.toString() : '');
  };

  // ====================== HISTORY IMPORT ======================
  // V2.0.5: parseCSVLine, parseNumber, excelSerialToDate, isExcelDateSerial,
  // cellToString, cellToNumber, parseXlsxRows — now imported from @/lib/parsers

  const handleHistoryImport = () => {
    if (!historyRawInput.trim()) return;
    const lines = historyRawInput.trim().split('\n');
    if (lines.length < 2) return;

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

      headers.forEach((header, idx) => {
        if (values[idx] === undefined) return;
        if (header.includes('fecha') || header.includes('date')) record.fecha = values[idx];
        else if (header.includes('ticker') || header.includes('instrumento')) record.ticker = values[idx];
        else if (header.includes('operacion') || header.includes('oper') || header.includes('tipo')) record.operacion = values[idx];
        else if (header.includes('tem')) record.tem = parseNumber(values[idx]);
        else if (header.includes('precio') || header.includes('price')) record.precioConComision = parseNumber(values[idx]);
        else if (header.includes('duration') || header.includes('duracion')) record.duration = parseNumber(values[idx]);
        else if (header.includes('capital') || header.includes('neto')) record.capitalNeto = parseNumber(values[idx]);
        else if (header.includes('nota') || header.includes('note')) record.notas = values[idx];
        else if (header.includes('ganancia') || header.includes('acum') || header.includes('p&l')) record.gananciaAcumulada = parseNumber(values[idx]);
      });

      records.push(record);
    }

    setExternalHistory(records);
    setHistoryRawInput('');
  };

  const [importStatus, setImportStatus] = useState<string>('');

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
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
        setImportStatus(`✅ ${records.length} registros importados de ${file.name} (hoja: ${sheetName})${sheetsInfo}`);
      } else {
        const text = await file.text();
        if (text) {
          setHistoryRawInput(text);
          setImportStatus(`✅ Archivo de texto cargado. Presioná "Importar Historial" para procesar.`);
        }
      }
    } catch (err) {
      console.error('Error importing file:', err);
      setImportStatus(`❌ Error al leer el archivo: ${err instanceof Error ? err.message : 'Error desconocido'}`);
    }

    event.target.value = '';
  };

  // Build capital evolution chart data from transactions + external history
  const capitalEvolutionData = (() => {
    const points: { date: string; capital: number; label: string; ganancia: number }[] = [];

    if (externalHistory.length > 0) {
      const fondeoRow = externalHistory.find(r =>
        r.operacion.toLowerCase().includes('fondeo') ||
        r.operacion.toLowerCase().includes('depósito') ||
        r.operacion.toLowerCase().includes('deposito') ||
        r.operacion.toLowerCase().includes('inicio')
      );
      const initialCapital = fondeoRow
        ? fondeoRow.capitalNeto
        : (externalHistory[0].capitalNeto - externalHistory[0].gananciaAcumulada);

      points.push({ date: 'Inicio', capital: initialCapital, label: 'Capital Inicial', ganancia: 0 });

      for (const rec of externalHistory) {
        if (rec.operacion.toLowerCase().includes('fondeo') ||
            rec.operacion.toLowerCase().includes('depósito') ||
            rec.operacion.toLowerCase().includes('deposito')) {
          continue;
        }
        points.push({
          date: rec.fecha,
          capital: rec.capitalNeto,
          label: `${rec.ticker} ${rec.operacion}`,
          ganancia: rec.gananciaAcumulada,
        });
      }
    }

    if (externalHistory.length === 0) {
      let runningCapital = config.capitalDisponible;

      if (position && currentInstrument) {
        const investido = position.vn * position.entryPrice;
        const comisionCompra = investido * (config.comisionTotal / 2 / 100);
        runningCapital += investido + comisionCompra;
      }

      points.push({ date: 'Inicio', capital: runningCapital, label: 'Capital Inicial', ganancia: 0 });

      if (transactions.length > 0) {
        let txCapital = runningCapital;
        for (const tx of [...transactions].reverse()) {
          if (tx.pnl !== undefined) {
            txCapital += tx.pnl;
            points.push({
              date: tx.date,
              capital: txCapital,
              label: `${tx.ticker} ${tx.type === 'SELL' ? 'Venta' : 'Compra'}`,
              ganancia: txCapital - runningCapital,
            });
          }
        }
      }
    }

    return points;
  })();

  // ====================== ADD POSITION ======================
  const handleAddPosition = () => {
    if (!formTicker || !formVN || !formPrice || !formDate) return;

    const precioConComision = formPrecioConComision ? parseFloat(formPrecioConComision) : 0;
    const effectiveEntryPrice = precioConComision > 0
      ? precioConComision
      : parseFloat(formPrice);

    const newPosition: Position = {
      ticker: formTicker.toUpperCase(),
      entryPrice: effectiveEntryPrice,
      vn: parseInt(formVN),
      entryDate: formDate,
      precioConComision: precioConComision > 0 ? precioConComision : undefined,
    };

    const transaction: Transaction = {
      id: Date.now().toString(),
      type: 'BUY',
      ticker: newPosition.ticker,
      price: newPosition.entryPrice,
      vn: newPosition.vn,
      date: newPosition.entryDate,
      precioConComision: precioConComision > 0 ? precioConComision : undefined,
    };

    const invested = newPosition.vn * newPosition.entryPrice;
    const buyCommission = precioConComision > 0
      ? 0
      : invested * (config.comisionTotal / 2 / 100);
    const totalCost = invested + buyCommission;
    const newConfig = { ...config, capitalDisponible: Math.max(0, config.capitalDisponible - totalCost) };

    setPosition(newPosition);
    const newTransactions = [transaction, ...transactions];
    setTransactions(newTransactions);
    setConfig(newConfig);

    saveToStorage(STORAGE_KEYS.POSITION, newPosition);
    saveToStorage(STORAGE_KEYS.TRANSACTIONS, newTransactions);
    saveToStorage(STORAGE_KEYS.CONFIG, newConfig);

    setFormTicker('');
    setFormVN('');
    setFormPrice('');
    setFormDate('');
    setFormPrecioConComision('');
  };

  const handleClosePosition = () => {
    if (!position || !currentInstrument) return;

    const pnlResult = calculatePnL(position, currentInstrument.price, config.comisionTotal);

    const transaction: Transaction = {
      id: Date.now().toString(),
      type: 'SELL',
      ticker: position.ticker,
      price: currentInstrument.price,
      vn: position.vn,
      date: new Date().toLocaleDateString('es-AR'),
      pnl: pnlResult.pnl,
    };

    const saleProceeds = position.vn * currentInstrument.price;
    const sellCommission = saleProceeds * (config.comisionTotal / 2 / 100);
    const netProceeds = saleProceeds - sellCommission;
    const newConfig = { ...config, capitalDisponible: config.capitalDisponible + netProceeds };

    const newTransactions = [transaction, ...transactions];

    setTransactions(newTransactions);
    setPosition(null);
    setConfig(newConfig);

    // Explicit persistence to ensure capital reflux survives page reload
    saveToStorage(STORAGE_KEYS.POSITION, null);
    saveToStorage(STORAGE_KEYS.TRANSACTIONS, newTransactions);
    saveToStorage(STORAGE_KEYS.CONFIG, newConfig);
  };

  // ====================== P&L GANANCIA DE POSICIÓN ======================
  const mtmNeto = (() => {
    if (!position || !currentInstrument) return null;
    // V2.0.3: Use LIVE price for P&L when available
    const effectivePrice = livePrice ?? currentInstrument.price;
    const valorActual = position.vn * effectivePrice;

    const costoEntrada = position.precioConComision
      ? position.vn * position.precioConComision
      : position.vn * position.entryPrice * (1 + config.comisionTotal / 2 / 100);

    const gananciaPosicion = valorActual - costoEntrada;
    const gananciaPosicionPct = (gananciaPosicion / costoEntrada) * 100;

    const comisionSalidaProy = valorActual * (config.comisionTotal / 2 / 100);
    const valorLiquidacion = valorActual - comisionSalidaProy;

    const pnlNeto = valorLiquidacion - costoEntrada;
    const pnlNetoPct = (pnlNeto / costoEntrada) * 100;

    return {
      valorActual,
      costoEntrada,
      gananciaPosicion,
      gananciaPosicionPct,
      comisionSalidaProy,
      valorLiquidacion,
      pnlNeto,
      pnlNetoPct,
    };
  })();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-app-text mb-1">💼 Cartera</h2>
        <p className="text-sm text-app-text3">Posición actual, Ganancia de Posición, rotación e historial</p>
      </div>

      {/* ──────────────────────────────────────────── */}
      {/* 1. CAPITAL BAR                              */}
      {/* ──────────────────────────────────────────── */}
      <div className="bg-app-card rounded-lg border border-app-accent-border p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] text-app-text3 mb-1">CAPITAL DISPONIBLE</div>
            <div className="font-mono text-2xl font-bold text-app-accent-text">
              ${config.capitalDisponible.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
            </div>
          </div>
          {position && currentInstrument && (
            <div className="text-right">
              <div className="text-[10px] text-app-text3 mb-1">CAPITAL INVERTIDO</div>
              <div className="font-mono text-lg text-app-text2">
                ${(position.vn * position.entryPrice).toLocaleString('es-AR', { maximumFractionDigits: 0 })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ──────────────────────────────────────────── */}
      {/* 2. CURRENT POSITION CARD                    */}
      {/* ──────────────────────────────────────────── */}
      {position && currentInstrument && mtmNeto ? (
        <div className="bg-app-card rounded-lg border border-app-border p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-app-text2">Posición Actual</h3>
            <div className="flex items-center gap-2">
              {currentInstrument && (
                <button
                  onClick={() => { setShowRotation(true); setRotationStep('select'); setRotationTarget(''); setRotationManualSellPrice(''); setRotationManualBuyPrice(''); }}
                  className="px-3 py-1.5 bg-app-accent-dim text-app-accent-text border border-app-accent-border text-xs font-semibold rounded-md hover:bg-app-accent/20 transition-colors"
                >
                  🔄 Rotar
                </button>
              )}
              <button
                onClick={() => setShowCloseConfirm(true)}
                className="px-4 py-1.5 bg-app-danger-dim text-app-danger border border-app-danger/20 text-xs font-semibold rounded-md hover:bg-app-danger/20 transition-colors"
              >
                Cerrar Posición
              </button>
            </div>
          </div>

          {/* Fila 1: Instrumento + Ganancia de Posición (principal) */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <div className="text-[10px] text-app-text3 mb-1">Instrumento</div>
              <div className="font-mono font-bold text-app-text text-lg">{position.ticker}</div>
            </div>
            <div>
              <div className="text-[10px] text-app-text3 mb-1">Costo de Entrada</div>
              <div className="font-mono text-app-text2">${mtmNeto.costoEntrada.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</div>
            </div>
            <div>
              <div className="text-[10px] text-app-text3 mb-1">Ganancia de Posición</div>
              <div className={`font-mono font-bold text-lg ${mtmNeto.gananciaPosicion >= 0 ? 'text-app-accent-text' : 'text-app-danger'}`}>
                {mtmNeto.gananciaPosicion >= 0 ? '+' : ''}${mtmNeto.gananciaPosicion.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                <span className="text-sm ml-1">({mtmNeto.gananciaPosicionPct >= 0 ? '+' : ''}{mtmNeto.gananciaPosicionPct.toFixed(2)}%)</span>
              </div>
              <div className="text-[9px] text-app-text3 mt-0.5">Valor Actual − Costo de entrada (c/com. entrada)</div>
            </div>
          </div>

          {/* Fila 2: Valor de Liquidación Neto (secundario) */}
          <div className="bg-app-subtle rounded-md p-3 mt-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[10px] text-app-text3 mb-1">Valor de Liquidación Neto</div>
                <div className="font-mono text-app-text2">${mtmNeto.valorLiquidacion.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</div>
              </div>
              <div className="text-right">
                <div className="text-[9px] text-app-text3">
                  Si vendieras ahora, recibirías <span className="font-mono text-app-text2">${mtmNeto.valorLiquidacion.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span> netos (luego de comisión de salida)
                </div>
                <div className="text-[9px] text-app-gold mt-1">
                  Comisión de Salida Proyectada: −${mtmNeto.comisionSalidaProy.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                </div>
              </div>
            </div>
          </div>

          {/* Fila 3: Detalles adicionales */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mt-3 pt-3 border-t border-app-border">
            <div>
              <div className="text-[10px] text-app-text3 mb-1">Precio Entrada</div>
              <div className="font-mono text-app-text2 text-sm">${(position?.entryPrice ?? 0).toFixed(4)}</div>
            </div>
            <div>
              <div className="text-[10px] text-app-text3 mb-1 flex items-center gap-1">
                Precio Actual
                {isLive && livePrice !== null ? (
                  <span className="inline-flex items-center gap-0.5 text-[7px] text-[#2eebc8] font-mono">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#2eebc8] animate-pulse" />LIVE
                  </span>
                ) : (
                  <span className="text-[7px] text-app-text4 font-mono">OFFLINE</span>
                )}
              </div>
              <div className={`font-mono text-sm ${isLive && livePrice !== null ? 'text-app-accent-text' : 'text-app-text4'}`}>
                {(livePrice ?? currentInstrument?.price ?? 0).toFixed(4)}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-app-text3 mb-1">VN</div>
              <div className="font-mono text-app-text2 text-sm">{position.vn.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-[10px] text-app-text3 mb-1">Fecha Entrada</div>
              <div className="font-mono text-app-text2 text-sm">{position.entryDate}</div>
            </div>
            <div>
              <div className="text-[10px] text-app-text3 mb-1">TEM Actual</div>
              <div className={`font-mono text-sm ${isLive && livePrice !== null ? 'text-app-accent-text' : 'text-app-text4'}`}>
                {(currentInstrument?.tem ?? 0).toFixed(2)}%
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-app-card rounded-lg border border-app-border p-6 text-center">
          <p className="text-app-text3 text-sm">No hay posición activa. Usá el formulario de abajo para agregar una.</p>
        </div>
      )}

      {/* ──────────────────────────────────────────── */}
      {/* 3. CARRY CALCULATOR                         */}
      {/* ──────────────────────────────────────────── */}
      {carryData && (
        <div className="bg-app-card rounded-lg border border-app-border p-4">
          <h3 className="text-sm font-semibold text-app-text2 mb-3">Calculadora de Carry</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-app-subtle rounded-md p-3">
              <div className="text-[10px] text-app-text3 mb-1">Días Holding</div>
              <div className="font-mono text-app-text2">{carryData.daysHeld} días</div>
            </div>
            <div className="bg-app-subtle rounded-md p-3">
              <div className="text-[10px] text-app-text3 mb-1">Carry Acumulado</div>
              <div className="font-mono text-app-accent-text">+{carryData.carry.toFixed(2)}%</div>
            </div>
            <div className="bg-app-subtle rounded-md p-3">
              <div className="text-[10px] text-app-text3 mb-1">Cambio Precio</div>
              <div className={`font-mono ${carryData.priceChange >= 0 ? 'text-app-accent-text' : 'text-app-danger'}`}>
                {carryData.priceChange >= 0 ? '+' : ''}{carryData.priceChange.toFixed(2)}%
              </div>
            </div>
            <div className="bg-app-subtle rounded-md p-3">
              <div className="text-[10px] text-app-text3 mb-1">Retorno Total</div>
              <div className={`font-mono font-bold ${carryData.totalReturn >= 0 ? 'text-app-accent-text' : 'text-app-danger'}`}>
                {carryData.totalReturn >= 0 ? '+' : ''}{carryData.totalReturn.toFixed(2)}%
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ──────────────────────────────────────────── */}
      {/* 4. CLOSE POSITION CONFIRMATION DIALOG       */}
      {/* ──────────────────────────────────────────── */}
      {showCloseConfirm && position && currentInstrument && mtmNeto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowCloseConfirm(false)}>
          <div className="bg-app-card border border-app-border rounded-xl shadow-2xl max-w-md w-full mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <div className="text-center mb-4">
              <div className="text-4xl mb-2">⚠️</div>
              <h3 className="text-lg font-bold text-app-text">¿Liquidar posición?</h3>
              <p className="text-sm text-app-text3 mt-2">Se registrará la venta al precio de mercado y todo el capital pasará a Saldo Disponible.</p>
            </div>

            <div className="bg-app-subtle rounded-lg p-4 mb-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-app-text3">Instrumento</span>
                <span className="font-mono font-bold text-app-text">{position.ticker}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-app-text3">Nominales</span>
                <span className="font-mono text-app-text2">{position.vn.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-app-text3">Precio Actual</span>
                <span className="font-mono text-app-text2">${(currentInstrument?.price ?? 0).toFixed(4)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-app-text3">Venta Bruta</span>
                <span className="font-mono text-app-text2">${mtmNeto.valorActual.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-app-text3">Comisión Salida (−{(config.comisionTotal / 2).toFixed(2)}%)</span>
                <span className="font-mono text-app-danger">−${mtmNeto.comisionSalidaProy.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
              </div>
              <div className="flex justify-between text-sm border-t border-app-border pt-2">
                <span className="text-app-text3 font-semibold">Liquidez a Saldo Disponible</span>
                <span className="font-mono font-bold text-app-accent-text">${mtmNeto.valorLiquidacion.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
              </div>
              <div className={`flex justify-between text-sm border-t border-app-border pt-2 ${mtmNeto.pnlNeto >= 0 ? 'bg-app-accent-dim' : 'bg-app-danger-dim'} rounded-md px-2 py-1.5 -mx-2`}>
                <span className={`font-semibold ${mtmNeto.pnlNeto >= 0 ? 'text-app-accent-text' : 'text-app-danger'}`}>
                  {mtmNeto.pnlNeto >= 0 ? 'Ganancia' : 'Pérdida'} Realizada
                </span>
                <span className={`font-mono font-bold ${mtmNeto.pnlNeto >= 0 ? 'text-app-accent-text' : 'text-app-danger'}`}>
                  {mtmNeto.pnlNeto >= 0 ? '+' : ''}${mtmNeto.pnlNeto.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                  <span className="text-xs ml-1">({mtmNeto.pnlNetoPct >= 0 ? '+' : ''}{mtmNeto.pnlNetoPct.toFixed(2)}%)</span>
                </span>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowCloseConfirm(false)}
                className="flex-1 px-4 py-2.5 bg-app-subtle text-app-text2 border border-app-border font-semibold text-sm rounded-lg hover:bg-app-hover transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  handleClosePosition();
                  setShowCloseConfirm(false);
                }}
                className="flex-1 px-4 py-2.5 bg-app-danger text-white font-semibold text-sm rounded-lg hover:bg-app-danger/90 transition-colors"
              >
                Confirmar Liquidación
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ──────────────────────────────────────────── */}
      {/* 5. ROTATION MODAL (overlay)                 */}
      {/* ──────────────────────────────────────────── */}
      {showRotation && position && currentInstrument && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 backdrop-blur-sm pt-16 overflow-y-auto" onClick={() => setShowRotation(false)}>
          <div className="bg-app-card border border-app-accent-border rounded-xl shadow-2xl max-w-lg w-full mx-4 mb-8 p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-app-accent-text">🔄 Rotar Instrumento</h3>
              <button
                onClick={() => setShowRotation(false)}
                className="text-app-text3 hover:text-app-text text-lg leading-none"
              >
                ✕
              </button>
            </div>

          {rotationStep === 'select' && (
            <div className="space-y-4">
              <div className="bg-app-subtle rounded-md p-3">
                <span className="text-xs text-app-text3">Posición actual: </span>
                <span className="font-mono font-bold text-app-text">{position.ticker}</span>
                <span className="text-xs text-app-text3 ml-2">TEM: {(currentInstrument?.tem ?? 0).toFixed(2)}%</span>
                <span className="text-xs text-app-text3 ml-2">Precio: ${(currentInstrument?.price ?? 0).toFixed(4)}</span>
              </div>
              <div>
                <label className="block text-xs text-app-text3 mb-1">Rotar hacia:</label>
                <select
                  value={rotationTarget}
                  onChange={(e) => { setRotationTarget(e.target.value); setRotationManualBuyPrice(''); }}
                  className="w-full bg-[#111827] text-white font-mono text-sm border border-[#374151] rounded-md px-3 py-2 focus:outline-none focus:border-[#2eebc8]/50 appearance-none cursor-pointer [&>option]:bg-[#111827] [&>option]:text-white [&>optgroup]:bg-[#111827] [&>optgroup]:text-white"
                >
                  <option value="" className="bg-[#111827] text-white">Seleccionar instrumento destino...</option>
                  {lecapOptions.filter(i => i.ticker !== position.ticker).length > 0 && (
                    <optgroup label="LECAPs" className="bg-[#111827] text-[#2eebc8]">
                      {lecapOptions.filter(i => i.ticker !== position.ticker).map(inst => (
                        <option key={inst.ticker} value={inst.ticker} className="bg-[#111827] text-white">
                          {inst.ticker} — {(inst?.tem ?? 0).toFixed(2)}% TEM — {inst.days}d
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {boncapOptions.filter(i => i.ticker !== position.ticker).length > 0 && (
                    <optgroup label="BONCAPs" className="bg-[#111827] text-[#f472b6]">
                      {boncapOptions.filter(i => i.ticker !== position.ticker).map(inst => (
                        <option key={inst.ticker} value={inst.ticker} className="bg-[#111827] text-white">
                          {inst.ticker} — {(inst?.tem ?? 0).toFixed(2)}% TEM — {inst.days}d
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>

              {/* Manual Execution Prices */}
              <div className="bg-app-subtle rounded-md p-3 space-y-3">
                <div className="text-[10px] text-app-gold font-semibold uppercase tracking-wide">Precio de Ejecución Manual (opcional)</div>
                <div className="text-[9px] text-app-text4">Si el broker te cotiza un precio distinto al del dashboard, ingresalo aquí.</div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] text-app-text3 mb-1">Precio Venta ({position.ticker})</label>
                    <input
                      type="number"
                      step="0.0001"
                      value={rotationManualSellPrice}
                      onChange={(e) => setRotationManualSellPrice(e.target.value)}
                      placeholder={`Dashboard: ${(currentInstrument?.price ?? 0).toFixed(4)}`}
                      className="w-full bg-app-input text-app-text font-mono text-sm border border-app-border rounded-md px-3 py-1.5 focus:outline-none focus:border-app-accent/50 placeholder:text-app-text4"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-app-text3 mb-1">Precio Compra {rotationTarget ? `(${rotationTarget})` : '(destino)'}</label>
                    <input
                      type="number"
                      step="0.0001"
                      value={rotationManualBuyPrice}
                      onChange={(e) => setRotationManualBuyPrice(e.target.value)}
                      placeholder={rotationTargetInstrument ? `Dashboard: ${(rotationTargetInstrument?.price ?? 0).toFixed(4)}` : 'Seleccionar destino...'}
                      className="w-full bg-app-input text-app-text font-mono text-sm border border-app-border rounded-md px-3 py-1.5 focus:outline-none focus:border-app-accent/50 placeholder:text-app-text4 disabled:opacity-40"
                      disabled={!rotationTarget}
                    />
                  </div>
                </div>
                {(rotationManualSellPrice || rotationManualBuyPrice) && (
                  <div className="text-[9px] text-app-accent-text">
                    ✓ Se usarán los precios manuales para el cálculo de la rotación
                  </div>
                )}
              </div>

              {/* Resultado Proyectado */}
              {rotationTarget && rotationAnalysis && (
                <div className="space-y-3">
                  <div className="text-[10px] text-app-gold font-semibold uppercase tracking-wide">Resultado Proyectado</div>

                  {/* V1.5: TRAMPA warning — shows when toTEM < fromTEM but NEVER blocks execution */}
                  {rotationAnalysis.isTrampa && (
                    <div className="bg-red-500/20 border border-red-500/40 rounded-md p-3">
                      <div className="text-red-400 text-xs font-bold">⚠️ TRAMPA: TEM destino &lt; TEM origen</div>
                      <div className="text-[9px] text-red-400/80 mt-1">
                        Estás rotando hacia un instrumento con menor rendimiento ({rotationAnalysis.toTEM.toFixed(2)}% vs {rotationAnalysis.fromTEM.toFixed(2)}%).
                        Solo conviene si esperás una suba de precio por sensibilidad. Podés ejecutar igual, pero es una señal de precaución.
                      </div>
                    </div>
                  )}

                  {/* 1. Venta Neta */}
                  <div className="bg-app-subtle rounded-md p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-[10px] text-app-text3 mb-0.5">Venta Neta ({rotationAnalysis.fromTicker})</div>
                        <div className="text-[9px] text-app-text4">Venta Bruta − Comisión Salida (−{(config.comisionTotal / 2).toFixed(2)}%)</div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono font-bold text-app-accent-text">${rotationAnalysis.capitalNetoSalida.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</div>
                        <div className="text-[9px] text-app-text4">Bruta: ${rotationAnalysis.saleGross.toLocaleString('es-AR', { maximumFractionDigits: 0 })} | Com: −${rotationAnalysis.comisionSalida.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</div>
                      </div>
                    </div>
                  </div>

                  {/* 2. Nuevos Nominales */}
                  <div className={`rounded-md p-3 ${rotationAnalysis.nuevosNominalesB < position.vn ? 'bg-amber-500/10 border border-amber-500/25' : 'bg-app-subtle'}`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-[10px] text-app-text3 mb-0.5">Nuevos Nominales ({rotationAnalysis.toTicker})</div>
                        <div className="text-[9px] text-app-text4">Capital Neto ÷ Precio Destino ÷ (1 + comisión entrada)</div>
                      </div>
                      <div className="text-right">
                        <div className={`font-mono font-bold ${rotationAnalysis.nuevosNominalesB < position.vn ? 'text-amber-400' : 'text-app-text'}`}>
                          {rotationAnalysis.nuevosNominalesB.toLocaleString()} VN
                        </div>
                        {rotationAnalysis.nuevosNominalesB < position.vn ? (
                          <div className="text-[9px] text-amber-400 font-semibold">
                            ▼ Reducción: −{((position.vn - rotationAnalysis.nuevosNominalesB) / position.vn * 100).toFixed(1)}% ({position.vn.toLocaleString()} → {rotationAnalysis.nuevosNominalesB.toLocaleString()})
                          </div>
                        ) : (
                          <div className="text-[9px] text-app-text4">Costo Total: ${rotationAnalysis.costoTotalB.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</div>
                        )}
                        {rotationAnalysis.nuevosNominalesB < position.vn && (
                          <div className="text-[9px] text-app-text4">Costo Total: ${rotationAnalysis.costoTotalB.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 3. Comparativa de Tasa */}
                  <div className="bg-app-subtle rounded-md p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div>
                          <div className="text-[10px] text-app-text3 mb-0.5">TEM Actual</div>
                          <div className="font-mono text-app-text2">{rotationAnalysis.fromTEM.toFixed(2)}%</div>
                        </div>
                        <div className="text-app-text3 text-lg">→</div>
                        <div>
                          <div className="text-[10px] text-app-text3 mb-0.5">TEM Destino</div>
                          <div className={`font-mono font-bold ${rotationAnalysis.toTEM >= rotationAnalysis.fromTEM ? 'text-app-accent-text' : 'text-app-danger'}`}>
                            {rotationAnalysis.toTEM.toFixed(2)}%
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`font-mono font-bold text-lg ${rotationAnalysis.spreadBruto >= 0 ? 'text-app-accent-text' : 'text-app-danger'}`}>
                          {rotationAnalysis.spreadBruto >= 0 ? '+' : ''}{rotationAnalysis.spreadBruto.toFixed(2)}%
                        </div>
                        <div className={`text-[9px] ${rotationAnalysis.spreadBruto >= 0 ? 'text-app-accent-text' : 'text-app-danger'}`}>
                          {rotationAnalysis.spreadBruto >= 0 ? '▲ Sube la tasa' : '▼ Baja la tasa'}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 4. Diferencial de Capital */}
                  <div className="bg-app-subtle rounded-md p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-[10px] text-app-text3 mb-0.5">Diferencial de Capital</div>
                        <div className="text-[9px] text-app-text4">Sobra porque no se pueden comprar nominales fraccionados</div>
                      </div>
                      <div className="text-right">
                        <div className={`font-mono font-bold ${rotationAnalysis.capitalSobrante > 0 ? 'text-app-gold' : 'text-app-text3'}`}>
                          ${rotationAnalysis.capitalSobrante.toLocaleString('es-AR', { maximumFractionDigits: 2 })}
                        </div>
                        {rotationAnalysis.capitalSobrante > 0 && (
                          <div className="text-[9px] text-app-text4">Pasa a Saldo Disponible</div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 5. Días de Recuperación (Payback) */}
                  <div className={`rounded-md p-3 ${
                    rotationAnalysis.paybackDays <= 7 ? 'bg-emerald-500/10 border border-emerald-500/25' :
                    rotationAnalysis.paybackDays <= 15 ? 'bg-app-subtle' :
                    rotationAnalysis.paybackDays <= 30 ? 'bg-amber-500/10 border border-amber-500/25' :
                    'bg-red-500/10 border border-red-500/25'
                  }`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-[10px] text-app-text3 mb-0.5">Días de Recuperación (Payback)</div>
                        <div className="text-[9px] text-app-text4">Días de carry necesarios para cubrir las 2 comisiones ({config.comisionTotal.toFixed(2)}%)</div>
                      </div>
                      <div className="text-right">
                        <div className={`font-mono font-bold ${
                          rotationAnalysis.paybackDays <= 7 ? 'text-emerald-400' :
                          rotationAnalysis.paybackDays <= 15 ? 'text-app-accent-text' :
                          rotationAnalysis.paybackDays <= 30 ? 'text-amber-400' :
                          'text-red-400'
                        }`}>
                          {rotationAnalysis.paybackDays === Infinity ? '∞' : `${Math.ceil(rotationAnalysis.paybackDays)} días`}
                        </div>
                        <div className="text-[9px] text-app-text4">
                          Carry diario: {rotationAnalysis.carryDiarioDestino.toFixed(4)}%/día
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Alerta Semáforo + Evaluación rápida */}
                  {rotationAnalysis.spreadBruto < -0.10 && !rotationAnalysis.isTrampa && rotationAnalysis.evaluacionColor === 'red' && (
                    <div className="bg-red-500/15 border border-red-500/30 rounded-md p-3 text-center">
                      <div className="text-red-400 text-xs font-bold">⚠️ Pérdida significativa de tasa</div>
                      <div className="text-[9px] text-red-400/80 mt-1">
                        El diferencial de tasa es {rotationAnalysis.spreadBruto.toFixed(2)}% (menor a −0.10%). La rotación implica una merma importante de rendimiento.
                      </div>
                    </div>
                  )}
                  <div className={`rounded-md p-2.5 text-center text-xs font-semibold ${
                    rotationAnalysis.evaluacionColor === 'red' ? 'bg-red-500/20 text-red-400 border border-red-500/40' :
                    rotationAnalysis.evaluacionColor === 'emerald' ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' :
                    rotationAnalysis.evaluacionColor === 'green' ? 'bg-app-accent-dim text-app-accent-text border border-app-accent-border' :
                    rotationAnalysis.evaluacionColor === 'amber' ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30' :
                    rotationAnalysis.evaluacionColor === 'cyan' ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30' :
                    'bg-red-500/15 text-red-400 border border-red-500/30'
                  }`}>
                    {rotationAnalysis.evaluacion === 'TRAMPA' && '⚠️ '}
                    {rotationAnalysis.evaluacion === 'PERDIDA SIGNIFICATIVA' && '⚠️ '}
                    {rotationAnalysis.evaluacion === 'SALIDA SUGERIDA' && '🚪 '}
                    {rotationAnalysis.evaluacion === 'CONVENIENCIA POR PRECIO' && '📊 '}
                    {rotationAnalysis.evaluacion} — Spread Neto: {rotationAnalysis.spreadNeto >= 0 ? '+' : ''}{rotationAnalysis.spreadNeto.toFixed(3)}%
                  </div>

                  {/* ════════════════════════════════════════════════════════ */}
                  {/* V1.9.2 — Panel de Resumen Híbrido                      */}
                  {/* ════════════════════════════════════════════════════════ */}
                  <div className="bg-app-subtle/50 border border-app-border/40 rounded-md p-3 space-y-2">
                    <div className="text-[9px] text-app-gold font-semibold uppercase tracking-wider mb-1.5">Visión Híbrida (V1.9.2)</div>
                    <div className="grid grid-cols-3 gap-2">
                      {/* Status Tasa */}
                      <div className="text-center">
                        <div className="text-[8px] text-app-text4 uppercase tracking-wide mb-0.5">Status Tasa</div>
                        <div className={`text-[11px] font-bold font-mono ${
                          rotationAnalysis.statusTasa === 'Positivo' ? 'text-emerald-400' :
                          rotationAnalysis.statusTasa === 'Neutral' ? 'text-amber-400' :
                          'text-red-400'
                        }`}>
                          {rotationAnalysis.statusTasa}
                        </div>
                      </div>
                      {/* Status Precio (S/R) */}
                      <div className="text-center">
                        <div className="text-[8px] text-app-text4 uppercase tracking-wide mb-0.5">Status Precio (S/R)</div>
                        <div className={`text-[11px] font-bold font-mono ${
                          rotationAnalysis.statusPrecio === 'Favorable' ? 'text-cyan-400' :
                          rotationAnalysis.statusPrecio === 'Agotado' ? 'text-red-400' :
                          'text-app-text4'
                        }`}>
                          {rotationAnalysis.statusPrecio}
                        </div>
                      </div>
                      {/* Status Momentum */}
                      <div className="text-center">
                        <div className="text-[8px] text-app-text4 uppercase tracking-wide mb-0.5">Status Momentum</div>
                        <div className={`text-[11px] font-bold font-mono ${
                          rotationAnalysis.statusMomentum === 'Acelerando' ? 'text-emerald-400' :
                          rotationAnalysis.statusMomentum === 'Bajista' ? 'text-red-400' :
                          rotationAnalysis.statusMomentum === 'Sin datos' ? 'text-app-text4' :
                          'text-amber-400'
                        }`}>
                          {rotationAnalysis.statusMomentum === 'Acelerando' && '📈 '}
                          {rotationAnalysis.statusMomentum === 'Bajista' && '📉 '}
                          {rotationAnalysis.statusMomentum}
                        </div>
                      </div>
                    </div>

                    {/* S/R Channel Position detail */}
                    {srDataMap.size > 0 && (
                      <div className="grid grid-cols-2 gap-2 pt-1.5 border-t border-app-border/30">
                        <div className="flex items-center justify-between">
                          <span className="text-[8px] text-app-text4">Origen S/R</span>
                          <span className={`text-[10px] font-mono font-bold ${
                            rotationAnalysis.posicionOrigen > 90 ? 'text-red-400' :
                            rotationAnalysis.posicionOrigen > 70 ? 'text-amber-400' :
                            'text-cyan-400'
                          }`}>
                            {rotationAnalysis.posicionOrigen.toFixed(0)}% canal
                            {rotationAnalysis.isOrigenCeiling && ' ⚠️ Techo'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-[8px] text-app-text4">Upside Δ</span>
                          <span className={`text-[10px] font-mono font-bold ${
                            rotationAnalysis.upsideDiff > 0.50 ? 'text-cyan-400' :
                            rotationAnalysis.upsideDiff > 0 ? 'text-emerald-400' :
                            'text-app-text3'
                          }`}>
                            {rotationAnalysis.upsideDiff >= 0 ? '+' : ''}{rotationAnalysis.upsideDiff.toFixed(2)}%
                            {rotationAnalysis.isCapitalJump && ' 🚀'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-[8px] text-app-text4">Momentum Origen</span>
                          <span className={`text-[10px] font-mono ${
                            rotationAnalysis.momentumOrigenTendencia === '↑↑' || rotationAnalysis.momentumOrigenTendencia === '↑' ? 'text-emerald-400' :
                            rotationAnalysis.momentumOrigenTendencia === '↓↓' || rotationAnalysis.momentumOrigenTendencia === '↓' ? 'text-red-400' :
                            'text-app-text3'
                          }`}>
                            {rotationAnalysis.momentumOrigenTendencia}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-[8px] text-app-text4">Momentum Destino</span>
                          <span className={`text-[10px] font-mono ${
                            rotationAnalysis.momentumDestinoTendencia === '↑↑' || rotationAnalysis.momentumDestinoTendencia === '↑' ? 'text-emerald-400' :
                            rotationAnalysis.momentumDestinoTendencia === '↓↓' || rotationAnalysis.momentumDestinoTendencia === '↓' ? 'text-red-400' :
                            'text-app-text3'
                          }`}>
                            {rotationAnalysis.momentumDestinoTendencia}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Smart Legend */}
                    {rotationAnalysis.leyendaInteligente && (
                      <div className={`rounded-md p-2 text-[10px] font-medium leading-relaxed ${
                        rotationAnalysis.evaluacion === 'SALIDA SUGERIDA'
                          ? 'bg-cyan-500/10 text-cyan-300 border border-cyan-500/25'
                          : 'bg-cyan-500/10 text-cyan-300 border border-cyan-500/25'
                      }`}>
                        💡 {rotationAnalysis.leyendaInteligente}
                      </div>
                    )}
                  </div>

                  {/* V1.9.2 — SALIDA SUGERIDA Alert (S/R ceiling) */}
                  {rotationAnalysis.isOrigenCeiling && rotationAnalysis.evaluacion !== 'SALIDA SUGERIDA' && rotationAnalysis.evaluacion !== 'CONVENIENCIA POR PRECIO' && (
                    <div className="bg-cyan-500/10 border border-cyan-500/25 rounded-md p-3 text-center">
                      <div className="text-cyan-400 text-xs font-bold">🚪 Prioridad de salida: Activo actual agotado técnicamente</div>
                      <div className="text-[9px] text-cyan-400/70 mt-1">
                        {rotationAnalysis.fromTicker} está en zona de techo S/R ({rotationAnalysis.posicionOrigen.toFixed(0)}% del canal).
                        {rotationAnalysis.isOrigenAgotado ? ' Upside residual <0.1% — sin margen de capital.' : ` Upside residual: ${rotationAnalysis.upsideOrigen.toFixed(2)}%.`}
                        Considerá rotar hacia un activo con mayor Upside.
                      </div>
                    </div>
                  )}
                </div>
              )}

              {rotationTarget && (
                <button
                  onClick={() => setRotationStep('confirm')}
                  className="w-full px-4 py-2 bg-app-accent text-white font-semibold text-sm rounded-md hover:bg-app-accent/90 transition-colors"
                >
                  Analizar Rotación →
                </button>
              )}
            </div>
          )}

          {rotationStep === 'confirm' && rotationAnalysis && (
            <div className="space-y-4">
              {/* Manual price indicator */}
              {(rotationManualSellPrice || rotationManualBuyPrice) && (
                <div className="bg-app-gold/10 border border-app-gold/30 rounded-md p-2.5 text-xs">
                  <span className="text-app-gold font-semibold">⚡ Precio manual aplicado:</span>
                  <span className="text-app-text3 ml-1">
                    {rotationManualSellPrice && `Venta ${position.ticker} @ $${rotationAnalysis.effectiveSellPrice.toFixed(4)}`}
                    {rotationManualSellPrice && rotationManualBuyPrice && ' | '}
                    {rotationManualBuyPrice && `Compra ${rotationTargetInstrument?.ticker} @ $${rotationAnalysis.effectiveBuyPrice.toFixed(4)}`}
                  </span>
                </div>
              )}

              {/* V1.5: TRAMPA warning on confirm step — NEVER blocks, only warns */}
              {rotationAnalysis.isTrampa && rotationAnalysis.evaluacionColor === 'red' && (
                <div className="bg-red-500/20 border border-red-500/40 rounded-md p-3">
                  <div className="text-red-400 text-sm font-bold">⚠️ ADVERTENCIA: TRAMPA de Rotación</div>
                  <div className="text-[10px] text-red-400/80 mt-1">
                    TEM destino ({rotationAnalysis.toTEM.toFixed(2)}%) es MENOR que TEM origen ({rotationAnalysis.fromTEM.toFixed(2)}%).
                    Perdés {Math.abs(rotationAnalysis.fromTEM - rotationAnalysis.toTEM).toFixed(2)}% TEM mensual de carry.
                    Solo tiene sentido si esperás ganancia de capital por sensibilidad (duration).
                    Podés ejecutar la rotación de todas formas si es tu decisión.
                  </div>
                </div>
              )}

              {/* V1.9.2: CONVENIENCIA POR PRECIO info on confirm step */}
              {(rotationAnalysis.evaluacion === 'CONVENIENCIA POR PRECIO' || rotationAnalysis.evaluacion === 'SALIDA SUGERIDA') && rotationAnalysis.leyendaInteligente && (
                <div className="bg-cyan-500/10 border border-cyan-500/25 rounded-md p-3">
                  <div className="text-cyan-400 text-sm font-bold">
                    {rotationAnalysis.evaluacion === 'SALIDA SUGERIDA' ? '🚪 SALIDA SUGERIDA' : '📊 CONVENIENCIA POR PRECIO'}
                  </div>
                  <div className="text-[10px] text-cyan-400/80 mt-1">
                    💡 {rotationAnalysis.leyendaInteligente}
                  </div>
                  {rotationAnalysis.isTrampa && (
                    <div className="text-[9px] text-amber-400/70 mt-1">
                      ⚠️ Nota: TEM destino &lt; TEM origen, pero los factores de precio/momentum compensan.
                    </div>
                  )}
                </div>
              )}

              {/* P&L Realizado A */}
              <div className={`rounded-md p-3 ${rotationAnalysis.pnlRealizado >= 0 ? 'bg-app-accent-dim border border-app-accent-border' : 'bg-app-danger-dim border border-app-danger/20'}`}>
                <div className="text-[10px] text-app-text3 mb-1">P&L REALIZADO ({rotationAnalysis.fromTicker})</div>
                <div className={`font-mono font-bold text-lg ${rotationAnalysis.pnlRealizado >= 0 ? 'text-app-accent-text' : 'text-app-danger'}`}>
                  {rotationAnalysis.pnlRealizado >= 0 ? '+' : ''}${rotationAnalysis.pnlRealizado.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                </div>
              </div>

              {/* Rotation Detail */}
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="bg-app-subtle rounded-md p-3">
                  <div className="text-app-text3 mb-1">Venta Bruta ({rotationAnalysis.fromTicker})</div>
                  <div className="font-mono text-app-text">${rotationAnalysis.saleGross.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</div>
                </div>
                <div className="bg-app-subtle rounded-md p-3">
                  <div className="text-app-text3 mb-1">Comisión Salida (−)</div>
                  <div className="font-mono text-app-danger">−${rotationAnalysis.comisionSalida.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</div>
                </div>
                <div className="bg-app-subtle rounded-md p-3">
                  <div className="text-app-text3 mb-1">Capital Neto Salida</div>
                  <div className="font-mono font-bold text-app-accent-text">${rotationAnalysis.capitalNetoSalida.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</div>
                </div>
                <div className="bg-app-subtle rounded-md p-3">
                  <div className="text-app-text3 mb-1">Comisión Entrada B (−)</div>
                  <div className="font-mono text-app-danger">−${(rotationAnalysis.capitalNetoSalida - rotationAnalysis.capitalParaCompra).toLocaleString('es-AR', { maximumFractionDigits: 0 })}</div>
                </div>
                <div className="bg-app-subtle rounded-md p-3">
                  <div className="text-app-text3 mb-1">Nuevos Nominales ({rotationAnalysis.toTicker})</div>
                  <div className="font-mono font-bold text-app-text">{rotationAnalysis.nuevosNominalesB.toLocaleString()} VN</div>
                </div>
                <div className="bg-app-subtle rounded-md p-3">
                  <div className="text-app-text3 mb-1">Capital Sobrante</div>
                  <div className="font-mono text-app-gold">${rotationAnalysis.capitalSobrante.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</div>
                </div>
              </div>

              {/* TEM Spread Analysis */}
              <div className="bg-app-subtle rounded-md p-3">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                  <div>
                    <div className="text-app-text3 mb-1">Spread Bruto</div>
                    <div className={`font-mono font-bold ${rotationAnalysis.spreadBruto >= 0 ? 'text-app-accent-text' : 'text-app-danger'}`}>
                      {rotationAnalysis.spreadBruto >= 0 ? '+' : ''}{rotationAnalysis.spreadBruto.toFixed(3)}%
                    </div>
                  </div>
                  <div>
                    <div className="text-app-text3 mb-1">Comisión Amort.</div>
                    <div className="font-mono text-app-gold">{rotationAnalysis.comisionAmortizada.toFixed(3)}%</div>
                  </div>
                  <div>
                    <div className="text-app-text3 mb-1">Spread Neto</div>
                    <div className={`font-mono font-bold ${rotationAnalysis.spreadNeto >= 0 ? 'text-app-accent-text' : 'text-app-danger'}`}>
                      {rotationAnalysis.spreadNeto >= 0 ? '+' : ''}{rotationAnalysis.spreadNeto.toFixed(3)}%
                    </div>
                  </div>
                  <div>
                    <div className="text-app-text3 mb-1">Evaluación</div>
                    <div className={`font-mono font-bold ${
                      rotationAnalysis.evaluacionColor === 'red' ? 'text-red-400' :
                      rotationAnalysis.evaluacionColor === 'emerald' || rotationAnalysis.evaluacionColor === 'green' ? 'text-app-accent-text' :
                      rotationAnalysis.evaluacionColor === 'cyan' ? 'text-cyan-400' :
                      rotationAnalysis.evaluacionColor === 'amber' ? 'text-app-gold' : 'text-app-danger'
                    }`}>
                      {rotationAnalysis.evaluacion}
                    </div>
                  </div>
                </div>
              </div>

              {/* Resumen para Broker */}
              <div className="bg-app-subtle rounded-md p-3 border border-app-border">
                <div className="text-[10px] text-app-text3 mb-2 uppercase tracking-wide font-semibold">Resumen para Broker</div>
                <div className="font-mono text-xs text-app-text2 leading-relaxed">
                  Vender <span className="text-app-accent-text font-bold">{position.vn.toLocaleString()}</span> VN de <span className="text-app-accent-text font-bold">{rotationAnalysis.fromTicker}</span> a <span className="font-bold">${rotationAnalysis.effectiveSellPrice.toFixed(4)}</span>
                  <span className="text-app-text4"> | </span>
                  Comprar <span className="text-app-accent-text font-bold">{rotationAnalysis.nuevosNominalesB.toLocaleString()}</span> VN de <span className="text-app-accent-text font-bold">{rotationAnalysis.toTicker}</span> a <span className="font-bold">${rotationAnalysis.effectiveBuyPrice.toFixed(4)}</span>
                </div>
                <button
                  onClick={() => {
                    const text = `Vender ${position.vn.toLocaleString()} VN de ${rotationAnalysis.fromTicker} a $${rotationAnalysis.effectiveSellPrice.toFixed(4)} | Comprar ${rotationAnalysis.nuevosNominalesB.toLocaleString()} VN de ${rotationAnalysis.toTicker} a $${rotationAnalysis.effectiveBuyPrice.toFixed(4)}`;
                    navigator.clipboard.writeText(text).then(() => {
                      setCopiedToClipboard(true);
                      setTimeout(() => setCopiedToClipboard(false), 2000);
                    }).catch(() => {});
                  }}
                  className="mt-2 text-[10px] cursor-pointer transition-all duration-200"
                >
                  {copiedToClipboard ? (
                    <span className="text-emerald-400 font-semibold">✓ ¡Copiado!</span>
                  ) : (
                    <span className="text-app-accent-text hover:underline">📋 Copiar al portapapeles</span>
                  )}
                </button>
              </div>

              {/* V1.5: Action buttons — confirm NEVER blocks, only shows warnings */}
              <div className="flex gap-3">
                <button
                  onClick={() => setRotationStep('select')}
                  className="flex-1 px-4 py-2 bg-app-subtle text-app-text2 border border-app-border font-semibold text-sm rounded-md hover:bg-app-hover transition-colors"
                >
                  ← Volver
                </button>
                <button
                  onClick={handleSaveSimulation}
                  className="px-4 py-2 bg-app-gold/15 text-app-gold border border-app-gold/30 font-semibold text-sm rounded-md hover:bg-app-gold/25 transition-colors"
                  title="Guardar simulación en la bitácora para comparar después"
                >
                  📒 Bitácora
                </button>
                {/* V1.5: Confirm button ALWAYS enabled — only changes visual styling for warnings */}
                <button
                  onClick={handleExecuteRotation}
                  className={`flex-1 px-4 py-2 font-semibold text-sm rounded-md transition-colors ${
                    rotationAnalysis.evaluacion === 'TRAMPA'
                      ? 'bg-red-500/60 text-white hover:bg-red-500/80'
                      : rotationAnalysis.evaluacion === 'NO CONVIENE' || rotationAnalysis.evaluacion === 'PERDIDA SIGNIFICATIVA'
                      ? 'bg-app-danger-dim text-app-danger border border-app-danger/20 hover:bg-app-danger/20'
                      : rotationAnalysis.evaluacion === 'CONVENIENCIA POR PRECIO'
                      ? 'bg-cyan-500/60 text-white hover:bg-cyan-500/80'
                      : rotationAnalysis.evaluacion === 'SALIDA SUGERIDA'
                      ? 'bg-cyan-500/60 text-white hover:bg-cyan-500/80'
                      : 'bg-app-accent text-white hover:bg-app-accent/90'
                  }`}
                >
                  {rotationAnalysis.evaluacion === 'TRAMPA' ? '⚠️ Ejecutar (TRAMPA)' : rotationAnalysis.evaluacion === 'PERDIDA SIGNIFICATIVA' ? '⚠️ Ejecutar (Pérdida Tasa)' : rotationAnalysis.evaluacion === 'NO CONVIENE' ? '⚠️ Ejecutar (No Recomendado)' : rotationAnalysis.evaluacion === 'CONVENIENCIA POR PRECIO' ? '📊 Ejecutar (Estratégica)' : rotationAnalysis.evaluacion === 'SALIDA SUGERIDA' ? '🚪 Ejecutar (Salida Sugerida)' : '✓ Ejecutar Rotación'}
                </button>
              </div>
            </div>
          )}

          {rotationStep === 'done' && (
            <div className="text-center py-4">
              <div className="text-app-accent-text text-3xl mb-2">✓</div>
              <p className="text-app-text font-semibold">Rotación ejecutada exitosamente</p>
              <p className="text-app-text3 text-sm mt-1">La posición fue actualizada en la cartera.</p>
              <button
                onClick={() => setShowRotation(false)}
                className="mt-4 px-6 py-2 bg-app-accent text-white font-semibold text-sm rounded-md hover:bg-app-accent/90 transition-colors"
              >
                Cerrar
              </button>
            </div>
          )}
          </div>
        </div>
      )}

      {/* ──────────────────────────────────────────── */}
      {/* 6. EVOLUTION CHART                          */}
      {/* ──────────────────────────────────────────── */}
      {(externalHistory.length > 0 || transactions.length > 0) && (
        <div className="bg-app-card rounded-lg border border-app-border p-4">
          <h3 className="text-sm font-semibold text-app-text2 mb-3">📈 Evolución del Capital</h3>
          {/* Summary stats from external history */}
          {externalHistory.length > 0 && (() => {
            const fondeoRow = externalHistory.find(r =>
              r.operacion.toLowerCase().includes('fondeo') ||
              r.operacion.toLowerCase().includes('depósito') ||
              r.operacion.toLowerCase().includes('deposito') ||
              r.operacion.toLowerCase().includes('inicio')
            );
            const initialCapital = fondeoRow
              ? fondeoRow.capitalNeto
              : (externalHistory[0].capitalNeto - externalHistory[0].gananciaAcumulada);
            const lastRec = externalHistory[externalHistory.length - 1];
            const finalCapital = lastRec.capitalNeto;
            const totalGan = finalCapital - initialCapital;
            const totalGanPct = (totalGan / initialCapital) * 100;
            const ventas = externalHistory.filter(r => r.operacion.toLowerCase().includes('venta') || r.operacion.toLowerCase().includes('sell'));
            const compras = externalHistory.filter(r => r.operacion.toLowerCase().includes('compra') || r.operacion.toLowerCase().includes('buy'));
            return (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
                <div className="bg-app-subtle rounded-md p-3">
                  <div className="text-[10px] text-app-text3 mb-1">Capital Inicial</div>
                  <div className="font-mono text-app-text2">${initialCapital.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</div>
                </div>
                <div className="bg-app-subtle rounded-md p-3">
                  <div className="text-[10px] text-app-text3 mb-1">Capital Actual</div>
                  <div className="font-mono text-app-text">${finalCapital.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</div>
                </div>
                <div className="bg-app-subtle rounded-md p-3">
                  <div className="text-[10px] text-app-text3 mb-1">Ganancia Total</div>
                  <div className={`font-mono font-bold ${totalGan >= 0 ? 'text-app-accent-text' : 'text-app-danger'}`}>
                    {totalGan >= 0 ? '+' : ''}${totalGan.toLocaleString('es-AR', { maximumFractionDigits: 0 })} ({totalGanPct >= 0 ? '+' : ''}{totalGanPct.toFixed(2)}%)
                  </div>
                </div>
                <div className="bg-app-subtle rounded-md p-3">
                  <div className="text-[10px] text-app-text3 mb-1">Operaciones</div>
                  <div className="font-mono text-app-text2">
                    {compras.length}C / {ventas.length}V
                  </div>
                </div>
                <div className="bg-app-subtle rounded-md p-3">
                  <div className="text-[10px] text-app-text3 mb-1">Ganancia/Op. Venta</div>
                  <div className="font-mono text-app-text2">
                    {ventas.length > 0 ? `$${(totalGan / ventas.length).toLocaleString('es-AR', { maximumFractionDigits: 0 })}` : '—'}
                  </div>
                </div>
              </div>
            );
          })()}
          <ChartContainer className="h-64">
            {({ width, height }) => (
              <LineChart width={width} height={height} data={capitalEvolutionData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }} key={`cap-${width}-${height}`}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--app-border)" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--app-text3)' }} />
                <YAxis
                  tick={{ fontSize: 10, fill: 'var(--app-text3)' }}
                  tickFormatter={(v: number) => `$${roundTo(v/1000, 0).toFixed(0)}k`}
                  ticks={(() => {
                    const capitals = capitalEvolutionData.map(p => p.capital);
                    const minCap = Math.min(...capitals);
                    const maxCap = Math.max(...capitals);
                    const step = 50000;
                    const lo = Math.floor(minCap / step) * step;
                    const hi = Math.ceil(maxCap / step) * step;
                    const t: number[] = [];
                    for (let v = lo; v <= hi; v += step) t.push(v);
                    return t;
                  })()}
                  domain={(() => {
                    const capitals = capitalEvolutionData.map(p => p.capital);
                    const minCap = Math.min(...capitals);
                    const maxCap = Math.max(...capitals);
                    const step = 50000;
                    return [Math.floor(minCap / step) * step, Math.ceil(maxCap / step) * step];
                  })()}
                />
                <Tooltip
                  contentStyle={{
                    background: 'var(--app-card)',
                    border: '1px solid var(--app-border)',
                    borderRadius: '8px',
                    color: 'var(--app-text)',
                    fontSize: '12px',
                  }}
                  formatter={((value: number, name: string, props: { payload?: { ganancia?: number } }) => {
                    const gan = props?.payload?.ganancia;
                    const ganStr = gan !== undefined && gan !== 0
                      ? ` | Gan: ${gan >= 0 ? '+' : ''}$${gan.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
                      : '';
                    return [`$${Number(value).toLocaleString('es-AR', { maximumFractionDigits: 0 })}${ganStr}`, 'Capital'];
                  }) as never}
                  labelFormatter={(label: string) => {
                    const point = capitalEvolutionData.find(p => p.date === label);
                    return point ? `${label} — ${point.label}` : String(label);
                  }}
                />
                <ReferenceLine stroke="var(--app-danger)" strokeDasharray="5 5" />
                <Line type="monotone" dataKey="capital" stroke="var(--app-accent)" strokeWidth={2} dot={{ r: 4, fill: 'var(--app-accent)' }} />
              </LineChart>
            )}
          </ChartContainer>
        </div>
      )}

      {/* ──────────────────────────────────────────── */}
      {/* 7. ADD POSITION FORM                        */}
      {/* ──────────────────────────────────────────── */}
      <div className="bg-app-card rounded-lg border border-app-border p-4">
        <h3 className="text-sm font-semibold text-app-text2 mb-3">Agregar Posición</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-6 gap-3">
          <div>
            <label className="block text-[10px] text-app-text3 mb-1">Instrumento</label>
            <select
              value={formTicker}
              onChange={(e) => {
                const ticker = e.target.value;
                setFormTicker(ticker);
                const inst = instruments.find(i => i.ticker === ticker);
                if (inst) {
                  setFormPrice(inst.price.toString());
                }
              }}
              className="w-full bg-[#111827] text-white font-mono text-sm border border-[#374151] rounded-md px-3 py-2 focus:outline-none focus:border-[#2eebc8]/50 appearance-none cursor-pointer [&>option]:bg-[#111827] [&>option]:text-white [&>optgroup]:bg-[#111827] [&>optgroup]:text-white"
            >
              <option value="" className="bg-[#111827] text-white">Seleccionar...</option>
              {lecapOptions.length > 0 && (
                <optgroup label="LECAPs" className="bg-[#111827] text-[#2eebc8]">
                  {lecapOptions.map(inst => (
                    <option key={inst.ticker} value={inst.ticker} className="bg-[#111827] text-white">
                      {inst.ticker} — {(inst?.tem ?? 0).toFixed(2)}% TEM — {inst.days}d — ${(inst?.price ?? 0).toFixed(4)}
                    </option>
                  ))}
                </optgroup>
              )}
              {boncapOptions.length > 0 && (
                <optgroup label="BONCAPs" className="bg-[#111827] text-[#f472b6]">
                  {boncapOptions.map(inst => (
                    <option key={inst.ticker} value={inst.ticker} className="bg-[#111827] text-white">
                      {inst.ticker} — {(inst?.tem ?? 0).toFixed(2)}% TEM — {inst.days}d — ${(inst?.price ?? 0).toFixed(4)}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            {selectedFormInstrument && (
              <div className="mt-1 text-[9px] text-app-text4 font-mono">
                {selectedFormInstrument.type} | Vto: {selectedFormInstrument.expiry} | TNA: {(selectedFormInstrument?.tna ?? 0).toFixed(1)}%
              </div>
            )}
          </div>
          <div>
            <label className="block text-[10px] text-app-text3 mb-1">VN</label>
            <input
              type="number"
              value={formVN}
              onChange={(e) => setFormVN(e.target.value)}
              placeholder="373700"
              className="w-full bg-app-input text-app-text font-mono text-sm border border-app-border rounded-md px-3 py-2 focus:outline-none focus:border-app-accent/50 placeholder:text-app-text4"
            />
          </div>
          <div>
            <label className="block text-[10px] text-app-text3 mb-1">Precio Entrada</label>
            <input
              type="number"
              step="0.0001"
              value={formPrice}
              onChange={(e) => setFormPrice(e.target.value)}
              placeholder="1.1616"
              className="w-full bg-app-input text-app-text font-mono text-sm border border-app-border rounded-md px-3 py-2 focus:outline-none focus:border-app-accent/50 placeholder:text-app-text4"
            />
          </div>
          <div>
            <label className="block text-[10px] text-app-text3 mb-1">Precio con Comisión <span className="text-app-accent-text">(opcional)</span></label>
            <input
              type="number"
              step="0.0001"
              value={formPrecioConComision}
              onChange={(e) => setFormPrecioConComision(e.target.value)}
              placeholder="Broker real"
              className="w-full bg-app-input text-app-text font-mono text-sm border border-app-border rounded-md px-3 py-2 focus:outline-none focus:border-app-accent/50 placeholder:text-app-text4"
            />
            {formPrecioConComision && (
              <div className="mt-1 text-[9px] text-app-accent-text">
                ✓ Se usará este precio (comisión ya incluida)
              </div>
            )}
          </div>
          <div>
            <label className="block text-[10px] text-app-text3 mb-1">Fecha</label>
            <input
              type="text"
              value={formDate}
              onChange={(e) => setFormDate(e.target.value)}
              placeholder="DD/MM/YYYY"
              className="w-full bg-app-input text-app-text font-mono text-sm border border-app-border rounded-md px-3 py-2 focus:outline-none focus:border-app-accent/50 placeholder:text-app-text4"
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={handleAddPosition}
              disabled={!formTicker || !formVN || !formPrice || !formDate}
              className="w-full px-4 py-2 bg-app-accent text-white font-semibold text-sm rounded-md hover:bg-app-accent/90 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Agregar
            </button>
          </div>
        </div>
        {selectedFormInstrument && formVN && (
          <div className="mt-3 p-2.5 bg-app-subtle rounded-md text-xs text-app-text3">
            <span className="text-app-text4">Inversión estimada: </span>
            <span className="font-mono text-app-accent-text">
              ${((parseInt(formVN) || 0) * (parseFloat(formPrice) || 0)).toLocaleString('es-AR', { maximumFractionDigits: 0 })}
            </span>
            {formPrecioConComision ? (
              <>
                <span className="text-app-text4 ml-3">Precio con comisión (broker): </span>
                <span className="font-mono text-app-accent-text">
                  ${((parseInt(formVN) || 0) * parseFloat(formPrecioConComision)).toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                </span>
                <span className="text-app-text4 ml-3 text-app-accent-text">→ Comisión calculada omitida, se usa precio broker</span>
              </>
            ) : (
              <>
                <span className="text-app-text4 ml-3">+ comisión compra: </span>
                <span className="font-mono text-app-gold">
                  ${((parseInt(formVN) || 0) * (parseFloat(formPrice) || 0) * (config.comisionTotal / 2 / 100)).toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                </span>
                <span className="text-app-text4 ml-3">Total: </span>
                <span className="font-mono text-app-text2">
                  ${(((parseInt(formVN) || 0) * (parseFloat(formPrice) || 0)) * (1 + config.comisionTotal / 2 / 100)).toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                </span>
              </>
            )}
          </div>
        )}
      </div>

      {/* ──────────────────────────────────────────── */}
      {/* 8. EXTERNAL HISTORY IMPORT                  */}
      {/* ──────────────────────────────────────────── */}
      <div className="bg-app-card rounded-lg border border-app-border p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-app-text2">📋 Importar Historial Externo</h3>
          <button
            onClick={() => setShowHistoryImport(!showHistoryImport)}
            className="text-xs text-app-text3 hover:text-app-accent-text transition-colors"
          >
            {showHistoryImport ? 'Ocultar ▲' : 'Expandir ▼'}
          </button>
        </div>

        {showHistoryImport && (
          <div className="space-y-3">
            <div className="text-xs text-app-text3">
              Importá tu historial de transacciones desde un archivo <span className="text-app-accent-text">.xlsx</span> o CSV.
              Campos reconocidos: <span className="text-app-accent-text">Fecha, Ticker, Operación, TEM, Precio (con comisión), Duration, Capital Neto, Notas, Ganancia Acumulada</span>.
              Las columnas se detectan automáticamente por sus encabezados.
            </div>
            <div className="flex gap-3">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.tsv,.txt,.xlsx,.xls"
                onChange={handleFileUpload}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2 bg-app-subtle text-app-text2 border border-app-border text-sm rounded-md hover:bg-app-hover transition-colors"
              >
                📁 Subir Excel/CSV
              </button>
              <div className="flex-1">
                <textarea
                  value={historyRawInput}
                  onChange={(e) => setHistoryRawInput(e.target.value)}
                  className="w-full h-24 bg-app-input text-app-text text-xs font-mono border border-app-border rounded-md p-2 focus:outline-none focus:border-app-accent/50 resize-y placeholder:text-app-text4"
                  placeholder="O pegá los datos CSV aquí (con encabezados)..."
                />
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleHistoryImport}
                disabled={!historyRawInput.trim()}
                className="px-4 py-2 bg-app-accent text-white font-semibold text-sm rounded-md hover:bg-app-accent/90 transition-colors disabled:opacity-30"
              >
                Importar Historial
              </button>
              {externalHistory.length > 0 && (
                <span className="text-app-accent-text text-sm self-center">✓ {externalHistory.length} registros importados</span>
              )}
              {externalHistory.length > 0 && (
                <button
                  onClick={() => { setExternalHistory([]); setImportStatus(''); }}
                  className="px-3 py-2 text-xs text-app-danger hover:text-app-danger/80 border border-app-danger/20 rounded-md transition-colors"
                >
                  Limpiar
                </button>
              )}
              {importStatus && (
                <span className={`text-xs self-center ${importStatus.startsWith('✅') ? 'text-app-accent-text' : importStatus.startsWith('❌') || importStatus.startsWith('⚠️') ? 'text-app-gold' : 'text-app-text3'}`}>
                  {importStatus}
                </span>
              )}
            </div>

            {/* Imported records table */}
            {externalHistory.length > 0 && (
              <div className="overflow-x-auto max-h-48 overflow-y-auto custom-scrollbar">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-app-card z-10">
                    <tr className="text-app-text3 border-b border-app-border font-medium">
                      <th className="px-2 py-1.5 text-left">Fecha</th>
                      <th className="px-2 py-1.5 text-left">Ticker</th>
                      <th className="px-2 py-1.5 text-left">Oper.</th>
                      <th className="px-2 py-1.5 text-right">TEM%</th>
                      <th className="px-2 py-1.5 text-right">Precio c/com.</th>
                      <th className="px-2 py-1.5 text-right">Dur.</th>
                      <th className="px-2 py-1.5 text-right">Cap. Neto</th>
                      <th className="px-2 py-1.5 text-right">Gan. Acum.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {externalHistory.map((rec, idx) => (
                      <tr key={idx} className="border-b border-app-border hover:bg-app-subtle">
                        <td className="px-2 py-1.5 font-mono text-app-text2">{rec.fecha}</td>
                        <td className="px-2 py-1.5 font-mono font-semibold text-app-text">{rec.ticker}</td>
                        <td className="px-2 py-1.5">
                          <span className={`px-1 py-0.5 rounded text-[10px] font-semibold ${rec.operacion.toLowerCase().includes('compra') ? 'bg-app-accent-dim text-app-accent-text' : 'bg-app-danger-dim text-app-danger'}`}>
                            {rec.operacion}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 font-mono text-app-text2 text-right">{rec.tem.toFixed(2)}%</td>
                        <td className="px-2 py-1.5 font-mono text-app-text2 text-right">${rec.precioConComision.toFixed(4)}</td>
                        <td className="px-2 py-1.5 font-mono text-app-text2 text-right">{rec.duration.toFixed(2)}</td>
                        <td className="px-2 py-1.5 font-mono text-app-text2 text-right">${rec.capitalNeto.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</td>
                        <td className={`px-2 py-1.5 font-mono text-right ${rec.gananciaAcumulada >= 0 ? 'text-app-accent-text' : 'text-app-danger'}`}>
                          {rec.gananciaAcumulada >= 0 ? '+' : ''}${rec.gananciaAcumulada.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ──────────────────────────────────────────── */}
      {/* 9. SIMULATIONS LOGBOOK                      */}
      {/* ──────────────────────────────────────────── */}
      <div className="bg-app-card rounded-lg border border-app-border overflow-hidden">
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <h3 className="text-sm font-semibold text-app-text2">📒 Simulaciones Guardadas</h3>
          {simulations.length > 0 && (
            <button
              onClick={() => {
                setSimulations([]);
                saveToStorage(STORAGE_KEYS.SIMULATIONS, []);
              }}
              className="text-[10px] text-app-danger hover:underline"
            >
              Limpiar todo
            </button>
          )}
        </div>
        {simulations.length === 0 ? (
          <div className="p-4 text-app-text4 text-xs">
            Sin simulaciones guardadas. Usá el botón "📒 Bitácora" en el análisis de rotación para registrar una.
          </div>
        ) : (
          <div className="overflow-x-auto max-h-80 overflow-y-auto custom-scrollbar">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-app-card z-10">
                <tr className="text-app-text3 border-b border-app-border font-medium">
                  <th className="px-3 py-2 text-left">Fecha/Hora</th>
                  <th className="px-3 py-2 text-left">Operación</th>
                  <th className="px-3 py-2 text-center">Evaluación</th>
                  <th className="px-3 py-2 text-right">Spread Neto</th>
                  <th className="px-3 py-2 text-right">Payback</th>
                  <th className="px-3 py-2 text-right">Precio Vta</th>
                  <th className="px-3 py-2 text-right">Precio Comp</th>
                  <th className="px-3 py-2 text-right">VN Nuevos</th>
                  <th className="px-3 py-2 text-center">Acción</th>
                </tr>
              </thead>
              <tbody>
                {simulations.map((sim) => {
                  const date = new Date(sim.timestamp);
                  const isPositive = sim.spreadNeto > 0;
                  return (
                    <tr
                      key={sim.id}
                      className={`border-b border-app-border hover:bg-app-subtle cursor-pointer transition-colors ${
                        isPositive ? 'border-l-2 border-l-emerald-500' : ''
                      }`}
                      onClick={() => handleLoadSimulation(sim)}
                      title={isPositive ? '★ Oportunidad Detectada — clic para recargar simulación' : 'Clic para recargar simulación con precios actuales'}
                    >
                      <td className="px-3 py-2 font-mono text-app-text2 whitespace-nowrap">
                        {date.toLocaleDateString('es-AR')} {date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="px-3 py-2 font-mono text-app-text whitespace-nowrap">
                        {isPositive && <span className="text-emerald-400 mr-1" title="Oportunidad Detectada">★</span>}
                        {sim.fromTicker} → {sim.toTicker}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                          sim.evaluacion === 'TRAMPA' ? 'bg-red-500/20 text-red-400' :
                          sim.evaluacion === 'MUY ATRACTIVO' ? 'bg-emerald-500/15 text-emerald-400' :
                          sim.evaluacion === 'ATRACTIVO' ? 'bg-app-accent-dim text-app-accent-text' :
                          sim.evaluacion === 'MARGINAL' ? 'bg-amber-500/15 text-amber-400' :
                          sim.evaluacion === 'PERDIDA SIGNIFICATIVA' ? 'bg-red-500/20 text-red-400' :
                          'bg-red-500/15 text-red-400'
                        }`}>
                          {sim.evaluacion}
                        </span>
                      </td>
                      <td className={`px-3 py-2 font-mono text-right font-bold ${sim.spreadNeto >= 0 ? 'text-app-accent-text' : 'text-app-danger'}`}>
                        {sim.spreadNeto >= 0 ? '+' : ''}{sim.spreadNeto.toFixed(3)}%
                      </td>
                      <td className="px-3 py-2 font-mono text-app-text2 text-right">
                        {sim.paybackDays < 0 ? '∞' : `${sim.paybackDays}d`}
                      </td>
                      <td className="px-3 py-2 font-mono text-app-text2 text-right">
                        ${sim.sellPrice.toFixed(4)}
                        {sim.sellPriceManual && <span className="text-app-gold text-[9px] ml-0.5">M</span>}
                      </td>
                      <td className="px-3 py-2 font-mono text-app-text2 text-right">
                        ${sim.buyPrice.toFixed(4)}
                        {sim.buyPriceManual && <span className="text-app-gold text-[9px] ml-0.5">M</span>}
                      </td>
                      <td className="px-3 py-2 font-mono text-app-text2 text-right">
                        {sim.nuevosNominales.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => handleDeleteSimulation(sim.id)}
                          className="text-app-text4 hover:text-app-danger transition-colors"
                          title="Eliminar simulación"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ──────────────────────────────────────────── */}
      {/* 10. TRANSACTION HISTORY                     */}
      {/* ──────────────────────────────────────────── */}
      <div className="bg-app-card rounded-lg border border-app-border overflow-hidden">
        <h3 className="text-sm font-semibold text-app-text2 px-4 pt-4 pb-2">Historial de Operaciones</h3>
        {transactions.length === 0 ? (
          <div className="p-4 text-app-text4 text-xs">Sin operaciones registradas</div>
        ) : (
          <div className="overflow-x-auto max-h-72 overflow-y-auto custom-scrollbar">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-app-card z-10">
                <tr className="text-app-text3 border-b border-app-border font-medium">
                  <th className="px-3 py-2 text-left">Fecha</th>
                  <th className="px-3 py-2 text-left">Tipo</th>
                  <th className="px-3 py-2 text-left">Ticker</th>
                  <th className="px-3 py-2 text-right">VN</th>
                  <th className="px-3 py-2 text-right">Precio</th>
                  <th className="px-3 py-2 text-right">Monto</th>
                  <th className="px-3 py-2 text-right">P&L</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => {
                  const amount = tx.vn * tx.price;
                  return (
                    <tr key={tx.id} className="border-b border-app-border hover:bg-app-subtle">
                      <td className="px-3 py-2 font-mono text-app-text2">{tx.date}</td>
                      <td className="px-3 py-2">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${tx.type === 'BUY' ? 'bg-app-accent-dim text-app-accent-text' : 'bg-app-danger-dim text-app-danger'}`}>
                          {tx.type === 'BUY' ? 'COMPRA' : 'VENTA'}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono font-semibold text-app-text">{tx.ticker}</td>
                      <td className="px-3 py-2 font-mono text-app-text2 text-right">{tx.vn.toLocaleString()}</td>
                      <td className="px-3 py-2 font-mono text-app-text2 text-right">{(tx?.price ?? 0).toFixed(4)}</td>
                      <td className="px-3 py-2 font-mono text-app-text2 text-right">${amount.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</td>
                      <td className={`px-3 py-2 font-mono text-right ${tx.pnl === undefined ? 'text-app-text4' : tx.pnl >= 0 ? 'text-app-accent-text' : 'text-app-danger'}`}>
                        {tx.pnl !== undefined ? `${tx.pnl >= 0 ? '+' : ''}$${tx.pnl.toLocaleString('es-AR', { maximumFractionDigits: 0 })}` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <style jsx>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(255,255,255,0.02);
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255,255,255,0.1);
          border-radius: 3px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255,255,255,0.2);
        }
      `}</style>
    </div>
  );
}
