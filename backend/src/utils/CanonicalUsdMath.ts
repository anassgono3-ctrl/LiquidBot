/**
 * Canonical USD Math Utilities
 * 
 * Single source of truth for all USD conversions across the system.
 * Replaces scattered ad-hoc math with precise BigInt calculations.
 */

const RAY = 1n * 10n ** 27n; // Aave RAY precision (1e27)
const WAD = 1n * 10n ** 18n; // Standard 18-decimal precision

/**
 * Expand scaled variable debt using Aave's variable borrow index
 * 
 * @param scaledDebt - Scaled debt amount from AToken
 * @param variableBorrowIndexRay - Variable borrow index in RAY format (1e27)
 * @returns Expanded debt amount in same decimals as scaledDebt
 * 
 * @example
 * // scaledDebt = 1000 USDC (6 decimals) = 1000000000
 * // index = 1.05 * RAY = 1050000000000000000000000000
 * expandVariableDebt(1000000000n, 1050000000000000000000000000n) // => 1050000000n
 */
export function expandVariableDebt(
  scaledDebt: bigint,
  variableBorrowIndexRay: bigint
): bigint {
  if (scaledDebt === 0n || variableBorrowIndexRay === 0n) {
    return 0n;
  }
  return (scaledDebt * variableBorrowIndexRay) / RAY;
}

/**
 * Compute USD value from raw token amount with proper decimal handling
 * 
 * This is the canonical implementation used throughout the system for:
 * - Liquidation audit
 * - Execution gating
 * - Notification formatting
 * - Plan resolution
 * 
 * @param rawAmount - Raw token amount as BigInt
 * @param decimals - Token decimals (e.g., 6 for USDC, 18 for WETH, 8 for cbBTC)
 * @param priceRaw - Oracle price as BigInt
 * @param priceDecimals - Price feed decimals (e.g., 8 for Chainlink, 18 for Aave oracle base)
 * @returns USD value as number (JavaScript safe number, bounded check recommended)
 * 
 * @example
 * // 1000.50 USDC (6 decimals) at $1.00 (8 decimals)
 * computeUsd(1000500000n, 6, 100000000n, 8) // => 1000.50
 * 
 * // 1.5 WETH (18 decimals) at $2500.00 (8 decimals)
 * computeUsd(1500000000000000000n, 18, 250000000000n, 8) // => 3750.00
 * 
 * // 0.05 cbBTC (8 decimals) at $97500.00 (8 decimals)
 * computeUsd(5000000n, 8, 9750000000000n, 8) // => 4875.00
 */
export function computeUsd(
  rawAmount: bigint,
  decimals: number,
  priceRaw: bigint,
  priceDecimals: number
): number {
  if (rawAmount === 0n || priceRaw === 0n) {
    return 0;
  }

  // Normalize both amount and price to 18 decimals
  const amount18 = to18(rawAmount, decimals);
  const price18 = to18(priceRaw, priceDecimals);

  // Calculate USD: (amount18 * price18) / 1e18
  const usd18 = (amount18 * price18) / WAD;

  // Convert to number for final result
  return Number(usd18) / Number(WAD);
}

/**
 * Convert human-readable amount to safe bounded number
 * Prevents scientific notation drift for very small or large values
 * 
 * @param raw - Raw token amount as BigInt
 * @param decimals - Token decimals
 * @param maxSafe - Maximum safe value (default: 1e15 to avoid JS float precision issues)
 * @returns Human-readable amount, clamped to maxSafe
 */
export function safeHumanAmount(
  raw: bigint,
  decimals: number,
  maxSafe: number = 1e15
): number {
  if (raw === 0n) {
    return 0;
  }

  const divisor = 10n ** BigInt(decimals);
  const intPart = Number(raw / divisor);
  const fracPart = Number((raw % divisor) * WAD / divisor) / Number(WAD);
  
  const result = intPart + fracPart;
  
  // Clamp to prevent precision loss
  return Math.min(result, maxSafe);
}

/**
 * Normalize a value to 18 decimals
 * Internal helper for computeUsd
 */
function to18(value: bigint, decimals: number): bigint {
  if (value === 0n) {
    return 0n;
  }

  const decimalDiff = 18 - decimals;
  
  if (decimalDiff > 0) {
    // Scale up
    return value * (10n ** BigInt(decimalDiff));
  } else if (decimalDiff < 0) {
    // Scale down
    return value / (10n ** BigInt(-decimalDiff));
  }
  
  return value;
}

/**
 * Detect suspicious USD scaling (likely decimal mismatch)
 * 
 * Heuristic: If raw amount is substantial (> 10^(decimals-2)) but USD is tiny (< $0.01),
 * likely indicates incorrect decimal handling.
 * 
 * @param rawAmount - Raw token amount
 * @param decimals - Token decimals
 * @param usdValue - Computed USD value
 * @returns true if suspicious scaling detected
 * 
 * @example
 * // 100 USDC (100000000 raw) valued at $0.001 is suspicious
 * detectSuspiciousScaling(100000000n, 6, 0.001) // => true
 * 
 * // 0.01 USDC (10000 raw) valued at $0.01 is fine
 * detectSuspiciousScaling(10000n, 6, 0.01) // => false
 */
export function detectSuspiciousScaling(
  rawAmount: bigint,
  decimals: number,
  usdValue: number
): boolean {
  // Threshold: amount > 10^(decimals-2) (e.g., > 0.01 tokens for USDC, > 0.01 for WETH)
  const minSignificantAmount = 10n ** BigInt(Math.max(0, decimals - 2));
  
  // If amount is significant but USD is tiny, flag as suspicious
  return rawAmount > minSignificantAmount && usdValue < 0.01;
}

/**
 * Format USD value for display
 * @param usd - USD value as number
 * @param precision - Decimal precision (default: 2)
 * @returns Formatted string with $ prefix
 */
export function formatUsd(usd: number, precision: number = 2): string {
  if (!isFinite(usd)) {
    return '$0.00';
  }
  
  return `$${usd.toFixed(precision)}`;
}

/**
 * Constants for decimal operations
 */
export const DecimalConstants = {
  RAY,
  WAD,
  USDC_DECIMALS: 6,
  WETH_DECIMALS: 18,
  DAI_DECIMALS: 18,
  cbBTC_DECIMALS: 8,
  CHAINLINK_DECIMALS: 8,
  AAVE_BASE_DECIMALS: 18,
} as const;
