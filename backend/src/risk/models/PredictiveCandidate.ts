/**
 * PredictiveCandidate: Type definitions for predictive HF candidates
 */

export type PredictiveScenario = 'baseline' | 'adverse' | 'extreme';

export interface PredictiveCandidate {
  address: string;
  scenario: PredictiveScenario;
  hfCurrent: number;
  hfProjected: number;
  etaSec: number;
  impactedReserves: string[];
  totalDebtUsd: number;
  totalCollateralUsd: number;
  timestamp: number;
  block: number;
}

export interface PriceScenario {
  scenario: PredictiveScenario;
  priceMultiplier: number; // e.g., 1.0 for baseline, 0.99 for adverse (-1%), 0.98 for extreme (-2%)
}

export const DEFAULT_SCENARIOS: PriceScenario[] = [
  { scenario: 'baseline', priceMultiplier: 1.0 },
  { scenario: 'adverse', priceMultiplier: 0.99 },
  { scenario: 'extreme', priceMultiplier: 0.98 }
];
