// ════════════════════════════════════════════════════════════════════════
// V3.3-PRO — Market Truth Engine Types
// Shared types for the Market Truth consensus engine
// ════════════════════════════════════════════════════════════════════════

export type ConfidenceLevel = 'ALTA' | 'MEDIA' | 'BAJA' | 'CRITICA';

export interface SourceResult<T> {
  value: T | null;
  source: string;
  latency_ms: number;
  ok: boolean;
  timestamp: string;
  detail?: string;
}

export interface RPConsensus {
  value: number;
  confidence: ConfidenceLevel;
  confidence_pct: number;
  sources_used: number;
  sources_total: number;
  agreement: boolean;
  best_source: string;
  all_sources: SourceResult<number>[];
  spread_between_sources: number;
}

export interface MEPConsensus {
  value: number;
  confidence: ConfidenceLevel;
  confidence_pct: number;
  sources_used: number;
  sources_total: number;
  agreement: boolean;
  best_source: string;
  all_sources: SourceResult<number>[];
  spread_between_sources: number;
  al30_price?: number;
  al30d_price?: number;
  gd30_price?: number;
  gd30d_price?: number;
}

export interface MarketTruthResponse {
  riesgo_pais: RPConsensus;
  mep: MEPConsensus;
  timestamp: string;
  next_refresh: string;
  engine_version: string;
}
