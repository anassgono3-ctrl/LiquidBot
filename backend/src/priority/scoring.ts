// Priority Sweep Scoring Utilities
// Pure functions for computing user priority scores and filtering candidates

export interface UserData {
  address: string;
  totalCollateralUSD: number;
  totalDebtUSD: number;
  healthFactor: number;
}

export interface ScoringConfig {
  debtWeight: number;
  collateralWeight: number;
  hfPenalty: number;
  hfCeiling: number;
  lowHfBoost: number;
  minDebtUsd: number;
  minCollateralUsd: number;
  hotlistMaxHf: number;
}

export interface ScoredUser extends UserData {
  score: number;
}

/**
 * Clamp a value to prevent infinity and extreme values
 */
function clamp(value: number, min: number = 0, max: number = 1e15): number {
  if (!isFinite(value) || isNaN(value)) return min;
  return Math.max(min, Math.min(max, value));
}

/**
 * Safe natural logarithm with protection against invalid inputs
 */
function safeLn(value: number): number {
  const clamped = clamp(value, 0, 1e15);
  if (clamped <= 0) return 0;
  return Math.log(clamped);
}

/**
 * Compute priority score for a user based on debt, collateral, and health factor
 * 
 * Formula:
 * score = (wDebt * ln(1+debtUSD)) + (wColl * ln(1+collateralUSD)) - (wHfPenalty * max(HF - HF_CEILING, 0))
 * 
 * If HF < HOTLIST_MAX_HF (default 1.05), apply LOW_HF_BOOST multiplier
 * 
 * @param user - User data with collateral, debt, and health factor
 * @param config - Scoring configuration weights and thresholds
 * @returns Computed priority score (higher = more priority)
 */
export function computeScore(user: UserData, config: ScoringConfig): number {
  const debtUsd = clamp(user.totalDebtUSD, 0);
  const collateralUsd = clamp(user.totalCollateralUSD, 0);
  const hf = clamp(user.healthFactor, 0);

  // Base score components
  const debtScore = config.debtWeight * safeLn(1 + debtUsd);
  const collateralScore = config.collateralWeight * safeLn(1 + collateralUsd);
  
  // Health factor penalty (penalize high HF above ceiling)
  const hfExcess = Math.max(hf - config.hfCeiling, 0);
  const hfPenalty = config.hfPenalty * hfExcess;
  
  // Compute base score
  let score = debtScore + collateralScore - hfPenalty;
  
  // Apply low HF boost if user is in critical zone
  if (hf < config.hotlistMaxHf) {
    score *= config.lowHfBoost;
  }
  
  return clamp(score, 0);
}

/**
 * Determine if a user should be included in the priority sweep based on filters
 * 
 * @param user - User data to evaluate
 * @param config - Filter configuration with minimum thresholds
 * @returns true if user passes filters, false otherwise
 */
export function shouldInclude(user: UserData, config: ScoringConfig): boolean {
  const debtUsd = user.totalDebtUSD;
  const collateralUsd = user.totalCollateralUSD;
  
  // Include if debt >= threshold OR collateral >= threshold
  return debtUsd >= config.minDebtUsd || collateralUsd >= config.minCollateralUsd;
}

/**
 * Sort users by score in descending order (highest score first)
 * 
 * @param users - Array of scored users
 * @returns Sorted array (highest scores first)
 */
export function sortFinal(users: ScoredUser[]): ScoredUser[] {
  return users.sort((a, b) => b.score - a.score);
}

/**
 * Compute statistics for a set of scored users
 */
export function computeStats(users: ScoredUser[]): {
  topScore: number;
  medianHf: number;
  avgDebt: number;
  avgCollateral: number;
} {
  if (users.length === 0) {
    return { topScore: 0, medianHf: 0, avgDebt: 0, avgCollateral: 0 };
  }

  const topScore = users.length > 0 ? users[0].score : 0;
  
  // Compute median health factor
  const sortedHfs = users.map(u => u.healthFactor).sort((a, b) => a - b);
  const medianHf = sortedHfs.length > 0 
    ? sortedHfs[Math.floor(sortedHfs.length / 2)] 
    : 0;
  
  // Compute averages
  const totalDebt = users.reduce((sum, u) => sum + u.totalDebtUSD, 0);
  const totalCollateral = users.reduce((sum, u) => sum + u.totalCollateralUSD, 0);
  const avgDebt = totalDebt / users.length;
  const avgCollateral = totalCollateral / users.length;
  
  return { topScore, medianHf, avgDebt, avgCollateral };
}
