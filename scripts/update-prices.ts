import cron from 'node-cron';
import path from 'path';
import fs from 'fs';
import { getDB, upsertDailyVolume } from '../lib/db';
import { PriceSnapshot, InstrumentDailyState, HistoricalPrice } from '../lib/types';

const MARKET_OPEN_HOUR = 11;
const MARKET_CLOSE_HOUR = 18;

const dailyStateMap = new Map<string, InstrumentDailyState>();
const CLEANSE_FLAG_FILE = path.join(process.cwd(), '.volume_cleanse_done');

function formatDateLocal(date: Date): string {
  return date.toLocaleDateString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).split('/').reverse().join('-');
}

function getArgentinaHour(date: Date): number {
  const timeString = date.toLocaleTimeString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    hour: '2-digit',
    hour12: false
  });
  return parseInt(timeString.split(':')[0], 10);
}

function isMarketActive(date: Date): boolean {
  const hour = getArgentinaHour(date);
  const dayOfWeek = date.getDay();
  if (dayOfWeek < 1 || dayOfWeek > 5) return false;
  return hour >= MARKET_OPEN_HOUR && hour < MARKET_CLOSE_HOUR;
}

function detectNewTradingDay(lastTime: Date | null, currentTime: Date): boolean {
  if (!lastTime) return true;
  
  const lastHour = getArgentinaHour(lastTime);
  const currentHour = getArgentinaHour(currentTime);
  const lastDateStr = formatDateLocal(lastTime);
  const currentDateStr = formatDateLocal(currentTime);
  
  const timeDiff = currentTime.getTime() - lastTime.getTime();
  if (timeDiff > 2 * 60 * 60 * 1000) return true;
  
  if (lastDateStr === currentDateStr) {
    if (lastHour < MARKET_OPEN_HOUR && currentHour >= MARKET_OPEN_HOUR) return true;
    return false;
  }
  
  const currentDayOfWeek = currentTime.getDay();
  if (currentDayOfWeek >= 1 && currentDayOfWeek <= 5) {
    if (currentHour >= MARKET_OPEN_HOUR) return true;
  }
  
  return false;
}

function getOrCreateDailyState(instrumentId: string): InstrumentDailyState {
  if (!dailyStateMap.has(instrumentId)) {
    dailyStateMap.set(instrumentId, {
      instrumentId,
      lastResetDate: '',
      dailyVolume: 0,
      lastSnapshotTime: null,
      lastIOLVolume: 0,
      consecutiveSnapshots: 0,
      firstSnapshotTime: null,
      isActive: false
    });
  }
  return dailyStateMap.get(instrumentId)!;
}

async function processSnapshotWithVolumeLogic(
  instrumentId: string,
  rawSnapshot: {
    timestamp: Date;
    price: number;
    bid: number;
    ask: number;
    volume: number;
  }
): Promise<PriceSnapshot> {
  const state = getOrCreateDailyState(instrumentId);
  const currentTime = rawSnapshot.timestamp;
  const currentDateStr = formatDateLocal(currentTime);
  
  const marketActive = isMarketActive(currentTime);
  const isNewTradingDay = detectNewTradingDay(state.lastSnapshotTime, currentTime);
  
  let shouldReset = false;
  if (isNewTradingDay && marketActive) shouldReset = true;
  
  if (!marketActive && state.isActive) {
    console.log(`[MARKET CLOSE] ${instrumentId} - Fuera de horario de mercado`);
    state.isActive = false;
  } else if (marketActive && !state.isActive) {
    console.log(`[MARKET OPEN] ${instrumentId} - Inicio de actividad`);
    state.isActive = true;
    shouldReset = true;
  }
  
  if (shouldReset && state.lastResetDate !== currentDateStr) {
    console.log(`[VOLUME RESET] ${instrumentId} - Nueva rueda iniciada: ${currentDateStr}`);
    if (state.lastResetDate && state.dailyVolume > 0) {
      await persistDailyVolumeToDB(state);
    }
    state.dailyVolume = 0;
    state.lastIOLVolume = 0;
    state.consecutiveSnapshots = 0;
    state.firstSnapshotTime = currentTime;
    state.lastResetDate = currentDateStr;
  }
  
  const volumeIncrement = Math.max(0, rawSnapshot.volume - state.lastIOLVolume);
  if (marketActive) {
    state.dailyVolume += volumeIncrement;
    state.consecutiveSnapshots++;
  }
  
  state.lastSnapshotTime = currentTime;
  state.lastIOLVolume = rawSnapshot.volume;
  
  const enrichedSnapshot: PriceSnapshot = {
    ...rawSnapshot,
    dailyVolume: state.dailyVolume,
    isReset: shouldReset && marketActive,
    instrumentId
  };
  
  return enrichedSnapshot;
}

async function persistDailyVolumeToDB(state: InstrumentDailyState): Promise<void> {
  if (!state.lastResetDate || state.dailyVolume === 0) return;
  
  upsertDailyVolume({
    instrumentId: state.instrumentId,
    date: state.lastResetDate,
    totalVolume: state.dailyVolume,
    firstSnapshot: state.firstSnapshotTime?.toISOString() || undefined,
    lastSnapshot: state.lastSnapshotTime?.toISOString() || undefined,
    snapshotCount: state.consecutiveSnapshots
  });
  
  await updateHistoricalJSONWithDailyVolume(state.instrumentId, state.lastResetDate, state.dailyVolume);
}

async function updateHistoricalJSONWithDailyVolume(
  instrumentId: string,
  date: string,
  dailyVolume: number
): Promise<void> {
  const historicalPath = path.join(process.cwd(), 'data', 'historico_precios.json');
  
  try {
    let historicalData: Record<string, HistoricalPrice[]> = {};
    
    if (fs.existsSync(historicalPath)) {
      const content = fs.readFileSync(historicalPath, 'utf-8');
      historicalData = JSON.parse(content);
    }
    
    if (!historicalData[instrumentId]) historicalData[instrumentId] = [];
    
    const existingIndex = historicalData[instrumentId].findIndex(p => p.date === date);
    
    if (existingIndex >= 0) {
      historicalData[instrumentId][existingIndex].volume = dailyVolume;
    } else {
      historicalData[instrumentId].push({
        date,
        open: 0,
        high: 0,
        low: 0,
        close: 0,
        volume: dailyVolume,
        instrumentId
      });
    }
    
    historicalData[instrumentId].sort((a, b) => a.date.localeCompare(b.date));
    fs.writeFileSync(historicalPath, JSON.stringify(historicalData, null, 2), 'utf-8');
    
  } catch (error) {
    console.error(`[ERROR] Fallo al actualizar historico_precios.json para ${instrumentId}:`, error);
  }
}

async function executeMarketClose(): Promise<void> {
  console.log('\n[CRON CIERRE] Iniciando cierre de mercado (18:30)');
  
  for (const [instrumentId, state] of dailyStateMap.entries()) {
    if (state.dailyVolume > 0 && state.lastResetDate) {
      await persistDailyVolumeToDB(state);
      state.dailyVolume = 0;
      state.lastIOLVolume = 0;
      state.consecutiveSnapshots = 0;
      state.firstSnapshotTime = null;
      state.isActive = false;
    }
  }
  
  console.log('[CRON CIERRE] Finalizado');
}

cron.schedule('30 18 * * 1-5', async () => {
  await executeMarketClose();
}, { timezone: 'America/Argentina/Buenos_Aires' });

async function cleanseHistoricalVolumes(): Promise<void> {
  const historicalPath = path.join(process.cwd(), 'data', 'historico_precios.json');
  if (!fs.existsSync(historicalPath)) return;
  
  try {
    const content = fs.readFileSync(historicalPath, 'utf-8');
    const historicalData: Record<string, HistoricalPrice[]> = JSON.parse(content);
    
    for (const [instrumentId, prices] of Object.entries(historicalData)) {
      let previousVolume = 0;
      
      for (const price of prices) {
        if (previousVolume > 0 && price.volume > previousVolume * 10) {
          console.warn(`[CLEANSE] ${instrumentId} ${price.date}: Volumen anómalo. Reseteando a 0.`);
          price.volume = 0;
        }
        if (price.volume > 0) previousVolume = price.volume;
      }
    }
    
    fs.writeFileSync(historicalPath, JSON.stringify(historicalData, null, 2), 'utf-8');
    fs.writeFileSync(CLEANSE_FLAG_FILE, new Date().toISOString(), 'utf-8');
    console.log('[CLEANSE] Limpieza completada');
    
  } catch (error) {
    console.error('[CLEANSE] Error durante la limpieza:', error);
  }
}

if (!fs.existsSync(CLEANSE_FLAG_FILE)) {
  cleanseHistoricalVolumes().catch(console.error);
}

export async function fetchAndProcessInstrumentData(
  instrumentId: string,
  marketData: any
): Promise<void> {
  const rawSnapshot = {
    timestamp: new Date(),
    price: marketData.price,
    bid: marketData.bid,
    ask: marketData.ask,
    volume: marketData.volume || 0
  };
  
  const enrichedSnapshot = await processSnapshotWithVolumeLogic(instrumentId, rawSnapshot);
  
  const db = getDB();
  const stmt = db.prepare(`
    INSERT INTO price_snapshots (instrument_id, timestamp, price, bid, ask, volume, daily_volume, is_reset)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  stmt.run(
    enrichedSnapshot.instrumentId,
    enrichedSnapshot.timestamp.toISOString(),
    enrichedSnapshot.price,
    enrichedSnapshot.bid,
    enrichedSnapshot.ask,
    enrichedSnapshot.volume,
    enrichedSnapshot.dailyVolume,
    enrichedSnapshot.isReset ? 1 : 0
  );
  
  console.log(`[SNAPSHOT] ${instrumentId} - Precio: ${enrichedSnapshot.price}, Volumen diario: $${enrichedSnapshot.dailyVolume.toLocaleString()}`);
}

export { processSnapshotWithVolumeLogic, dailyStateMap };
