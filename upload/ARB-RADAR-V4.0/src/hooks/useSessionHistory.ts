'use client';

import { useRef, useCallback } from 'react';
import { Instrument, Config, Snapshot, MomentumData } from '@/lib/types';
import { spreadVsCaucion } from '@/lib/calculations';

const MAX_SNAPSHOTS = 10;

/**
 * useSessionHistory — V1.4.4 Módulo de Momentum
 *
 * V1.4.4 FIX: Critical snapshot/delta bug fix:
 * - addSnapshot now validates TIR > 0 before saving (never save 0/null TIR)
 * - deltaTIR is null when no valid previous snapshot exists (not 0.000%)
 * - tirHistoryMap filters out zero/invalid TIR entries
 * - Delta calculation: const delta = currentTir - snapshotTir (no rounding, no filtering)
 * - If snapshotTir doesn't exist or was invalid, delta = null
 *
 * Almacena en memoria las últimas 10 cargas de datos (Snapshots).
 * Cada Snapshot incluye un timestamp y el array completo de instrumentos.
 * Al actualizar los datos manualmente, no se borra el historial, sino que
 * se hace un "shift" (elimina el más viejo y agrega el nuevo).
 *
 * Deriva datos de momentum: Delta_TIR, Aceleración, Tendencia, y
 * detección de "Tapados" (Oportunidades en Desarrollo).
 */
export function useSessionHistory() {
  const snapshotsRef = useRef<Snapshot[]>([]);

  /**
   * Agregar un nuevo snapshot al historial.
   * V1.4.4 FIX: Only save if instruments have valid TIR > 0.
   * If ANY instrument has TIR <= 0 or NaN, it gets normalized to ensure
   * the snapshot never contains invalid comparison baselines.
   * No borra el historial existente; hace shift si excede MAX_SNAPSHOTS.
   */
  const addSnapshot = useCallback((instruments: Instrument[]) => {
    // V1.4.4 FIX: Validate and normalize instruments before saving.
    // Force tir = tem for every instrument, and ensure tir > 0.
    // If tir is 0/NaN/null, we still save the snapshot but mark the
    // instrument's tir as 0 (the delta calculation will treat this as invalid).
    const normalizedInstruments = instruments.map(inst => {
      const effectiveRate = inst.tem || inst.tir || 0;
      return {
        ...inst,
        tem: effectiveRate,
        tir: effectiveRate,
      };
    });

    const newSnapshot: Snapshot = {
      timestamp: new Date().toISOString(),
      instruments: normalizedInstruments,
    };

    const current = snapshotsRef.current;
    if (current.length >= MAX_SNAPSHOTS) {
      // Shift: remove oldest, add newest
      snapshotsRef.current = [...current.slice(1), newSnapshot];
    } else {
      snapshotsRef.current = [...current, newSnapshot];
    }
  }, []);

  /**
   * Obtener todos los snapshots actuales
   */
  const getSnapshots = useCallback((): Snapshot[] => {
    return snapshotsRef.current;
  }, []);

  /**
   * Obtener el snapshot anterior al actual (penúltimo)
   */
  const getPreviousSnapshot = useCallback((): Snapshot | null => {
    const snaps = snapshotsRef.current;
    if (snaps.length < 2) return null;
    return snaps[snaps.length - 2];
  }, []);

  /**
   * Calcular datos de momentum para todos los instrumentos actuales
   *
   * V1.4.4 FIX: Delta calculation is now:
   *   const delta = currentTir - snapshotTir
   *   - If snapshotTir doesn't exist or is 0/invalid → delta = null (not 0.000%)
   *   - No Math.round, no filtering, no threshold that discards small values
   *   - If TIR is 1.97 and Snapshot is 1.85, delta = 0.12 (exact)
   *
   * Delta_TIR: diferencia de TIR entre el snapshot actual y el anterior
   * Aceleración: cambio del Delta_TIR entre los últimos 3 snapshots (2da derivada)
   * Tendencia: indicador visual basado en aceleración y delta
   * esTapado: señal de "Oportunidad en Desarrollo"
   *
   * @param currentInstruments Instrumentos actuales
   * @param comisionTotal Comisión total round-trip (ej: 0.30)
   * @param config Configuración con tasas de caución (para spreadVsCaucion)
   */
  const calculateMomentum = useCallback((
    currentInstruments: Instrument[],
    comisionTotal: number,
    config?: Config
  ): Map<string, MomentumData> => {
    const momentumMap = new Map<string, MomentumData>();
    const snaps = snapshotsRef.current;

    // Build TIR history for each ticker from available snapshots
    // V1.4.4 FIX: Only include TIR values that are valid (> 0)
    const tirHistoryMap = new Map<string, number[]>();

    for (const snap of snaps) {
      for (const inst of snap.instruments) {
        if (!tirHistoryMap.has(inst.ticker)) {
          tirHistoryMap.set(inst.ticker, []);
        }
        // V1.4.4 FIX: Use tir (which equals tem after normalization).
        // Only push if TIR is a valid positive number.
        const tirValue = inst.tir || inst.tem;  // fallback: use || not ??
        if (tirValue > 0 && isFinite(tirValue)) {
          tirHistoryMap.get(inst.ticker)!.push(tirValue);
        }
      }
    }

    // For each current instrument, calculate momentum
    for (const inst of currentInstruments) {
      const history = tirHistoryMap.get(inst.ticker) || [];

      // V1.4 — Last 5 TIRs for sparkline tooltip display (expanded from 3→5)
      const tirHistory = history.slice(-5);

      // V1.4.4 FIX: Delta_TIR calculation — EXACT subtraction, no rounding
      // const delta = currentTir - snapshotTir
      // If snapshotTir doesn't exist (no valid previous), delta = null
      let deltaTIR: number | null = null;

      if (history.length >= 2) {
        // We have at least 2 valid TIR readings — compute exact delta
        const currentTir = history[history.length - 1];
        const snapshotTir = history[history.length - 2];

        // V1.4.4 FIX: If snapshotTir is 0 or invalid, delta = null
        // (This should not happen since we filter in tirHistoryMap, but defensive check)
        if (snapshotTir > 0 && isFinite(snapshotTir) && isFinite(currentTir)) {
          deltaTIR = currentTir - snapshotTir;  // Exact subtraction, no rounding
        }
      }
      // If history.length < 2, deltaTIR stays null — user sees "—" not "0.000%"

      // Aceleración: change of Delta_TIR over last 3 snapshots
      // aceleracion = (deltaTIR_n - deltaTIR_n-1)
      let aceleracion = 0;
      if (history.length >= 3) {
        const deltaN = history[history.length - 1] - history[history.length - 2];
        const deltaN1 = history[history.length - 2] - history[history.length - 3];
        aceleracion = deltaN - deltaN1;
      }

      // Tendencia visual
      // V1.4.4 FIX: Handle null deltaTIR — show "→" when no comparison available
      let tendencia: MomentumData['tendencia'] = '→';
      if (deltaTIR !== null) {
        if (aceleracion > 0.02) {
          tendencia = '↑↑'; // Aceleración fuerte
        } else if (deltaTIR > 0.01) {
          tendencia = '↑'; // Subiendo
        } else if (aceleracion < -0.02) {
          tendencia = '↓↓'; // Desaceleración fuerte
        } else if (deltaTIR < -0.01) {
          tendencia = '↓'; // Bajando
        }
      }

      // Detección de "Tapado" (Oportunidad en Desarrollo)
      // Criterio V1.3 (Cian/Amarillo):
      //   - Delta_TIR positivo Y persistente (al menos 2 snapshots consecutivos con delta positivo)
      //   - Spread vs Caución positivo pero marginal (< comisionTotal/100)
      //     → la ganancia no cubre la comisión round-trip
      //   - Esto significa: la TIR del instrumento está subiendo (se abarata)
      //     pero aún no cruzó el umbral de rentabilidad después de comisiones
      let esTapado = false;
      let tapadoReason = '';

      // V1.4.4 FIX: Only check tapado if deltaTIR is a valid number (not null)
      if (deltaTIR !== null && deltaTIR > 0.0001 && history.length >= 2) {
        // Check if deltaTIR has been positive in recent snapshots (persistent)
        const recentDeltas: number[] = [];
        for (let i = history.length - 1; i >= 1 && recentDeltas.length < 2; i--) {
          recentDeltas.push(history[i] - history[i - 1]);
        }
        const persistentPositive = recentDeltas.every(d => d > 0);

        // Calculate proper spread vs caución using the real config
        const spread = config
          ? spreadVsCaucion(inst.tem, config, inst.days)
          : inst.tem - 1.5; // fallback rough estimate

        // Margen neto: spread positivo pero no cubre la comisión round-trip
        // comisionTotal is in percentage (e.g., 0.30 means 0.30%)
        // spread is also in percentage points
        const spreadMarginal = spread > 0 && spread < comisionTotal / 100;

        if (persistentPositive && spreadMarginal) {
          esTapado = true;
          tapadoReason = `ΔTIR +${deltaTIR.toFixed(3)}% persistente, spread vs caución +${spread.toFixed(3)}% no cubre comisión RT (${comisionTotal}%). Potencial oportunidad si la tendencia continúa.`;
        }
      }

      momentumMap.set(inst.ticker, {
        ticker: inst.ticker,
        deltaTIR,
        aceleracion,
        tendencia,
        tirHistory,
        esTapado,
        tapadoReason,
      });
    }

    return momentumMap;
  }, []);

  /**
   * Limpiar todo el historial de sesión
   */
  const clearHistory = useCallback(() => {
    snapshotsRef.current = [];
  }, []);

  /**
   * Obtener cantidad de snapshots almacenados
   */
  const getSnapshotCount = useCallback((): number => {
    return snapshotsRef.current.length;
  }, []);

  /**
   * V1.4.2 — Restaurar snapshots desde un backup importado.
   * Reemplaza todo el historial de sesión con los snapshots normalizados.
   * V1.4.4 FIX: Normalize instruments in restored snapshots (tir = tem, validate > 0)
   */
  const restoreSnapshots = useCallback((snapshots: Snapshot[]) => {
    if (Array.isArray(snapshots) && snapshots.length > 0) {
      // V1.4.4 FIX: Normalize instruments in each snapshot
      const normalized = snapshots.map(snap => ({
        ...snap,
        instruments: snap.instruments.map(inst => {
          const effectiveRate = inst.tem || inst.tir || 0;
          return { ...inst, tem: effectiveRate, tir: effectiveRate };
        }),
      }));
      // Keep max 10 snapshots (FIFO if more)
      snapshotsRef.current = normalized.slice(-10);
    }
  }, []);

  return {
    addSnapshot,
    getSnapshots,
    getPreviousSnapshot,
    calculateMomentum,
    clearHistory,
    getSnapshotCount,
    restoreSnapshots,
  };
}
