/**
 * Decimal conversion and normalization utilities for Aave V3 accounting.
 * Provides consistent handling of token decimals, RAY math, and price feed decimals.
 */

const RAY = 1n * 10n ** 27n; // Aave uses RAY (1e27) for precision in interest calculations
const WAD = 1n * 10n ** 18n; // Standard 18-decimal precision

/**
 * Normalize a raw token amount to 18 decimals.
 * 
 * @param amountRaw - Raw token amount as BigInt
 * @param tokenDecimals - Token decimals (e.g., 6 for USDC, 18 for WETH)
 * @returns Amount normalized to 18 decimals
 * 
 * @example
 * // USDC (6 decimals): 1000.50 USDC = 1000500000
 * to18(1000500000n, 6) // => 1000500000000000000000n (18 decimals)
 * 
 * // WETH (18 decimals): 1.5 WETH = 1500000000000000000
 * to18(1500000000000000000n, 18) // => 1500000000000000000n (unchanged)
 */
export function to18(amountRaw: bigint, tokenDecimals: number): bigint {
  if (amountRaw === 0n) {
    return 0n;
  }

  const decimalDiff = 18 - tokenDecimals;
  
  if (decimalDiff > 0) {
    // Scale up: multiply by 10^(18 - tokenDecimals)
    return amountRaw * (10n ** BigInt(decimalDiff));
  } else if (decimalDiff < 0) {
    // Scale down: divide by 10^(tokenDecimals - 18)
    return amountRaw / (10n ** BigInt(-decimalDiff));
  } else {
    // Already 18 decimals
    return amountRaw;
  }
}

/**
 * Convert a 18-decimal amount back to token decimals.
 * 
 * @param amount18 - Amount in 18 decimals
 * @param tokenDecimals - Target token decimals
 * @returns Amount in token decimals
 * 
 * @example
 * // 1000.50 normalized (18 decimals) to USDC (6 decimals)
 * from18(1000500000000000000000n, 6) // => 1000500000n
 */
export function from18(amount18: bigint, tokenDecimals: number): bigint {
  if (amount18 === 0n) {
    return 0n;
  }

  const decimalDiff = 18 - tokenDecimals;
  
  if (decimalDiff > 0) {
    // Scale down: divide by 10^(18 - tokenDecimals)
    return amount18 / (10n ** BigInt(decimalDiff));
  } else if (decimalDiff < 0) {
    // Scale up: multiply by 10^(tokenDecimals - 18)
    return amount18 * (10n ** BigInt(-decimalDiff));
  } else {
    // Already target decimals
    return amount18;
  }
}

/**
 * Apply a RAY-denominated index to a value.
 * Used for expanding scaled debt/collateral with Aave indices.
 * 
 * @param value - Value to scale (in token decimals)
 * @param indexRay - Index in RAY format (1e27)
 * @returns Scaled value (in same decimals as input)
 * 
 * @example
 * // Expand scaled variable debt with borrow index
 * // scaledDebt = 1000 USDC (6 decimals) = 1000000000
 * // index = 1.05 * RAY = 1050000000000000000000000000
 * applyRay(1000000000n, 1050000000000000000000000000n) // => 1050000000n (1050 USDC)
 */
export function applyRay(value: bigint, indexRay: bigint): bigint {
  if (value === 0n || indexRay === 0n) {
    return 0n;
  }
  return (value * indexRay) / RAY;
}

/**
 * Calculate USD value from raw token amount with proper decimal normalization.
 * Handles both token decimals and price feed decimals consistently.
 * 
 * @param amountRaw - Raw token amount as BigInt
 * @param tokenDecimals - Token decimals (e.g., 6 for USDC, 18 for WETH)
 * @param priceRaw - Oracle price as BigInt (raw from price feed)
 * @param feedDecimals - Price feed decimals (e.g., 8 for Chainlink, 18 for Aave oracle base)
 * @returns USD value as number
 * 
 * @example
 * // 1000.50 USDC (6 decimals) at $1.00 (8 decimals Chainlink)
 * // amountRaw = 1000500000 (1000.50 * 1e6)
 * // priceRaw = 100000000 (1.00 * 1e8)
 * usdValue(1000500000n, 6, 100000000n, 8) // => 1000.50
 * 
 * // 1.5 WETH (18 decimals) at $2500.00 (8 decimals)
 * // amountRaw = 1500000000000000000 (1.5 * 1e18)
 * // priceRaw = 250000000000 (2500 * 1e8)
 * usdValue(1500000000000000000n, 18, 250000000000n, 8) // => 3750.00
 */
export function usdValue(
  amountRaw: bigint,
  tokenDecimals: number,
  priceRaw: bigint,
  feedDecimals: number
): number {
  if (amountRaw === 0n || priceRaw === 0n) {
    return 0;
  }

  // Normalize both amount and price to 18 decimals
  const amount18 = to18(amountRaw, tokenDecimals);
  const price18 = to18(priceRaw, feedDecimals);

  // Calculate USD: (amount18 * price18) / 1e18
  const usd18 = (amount18 * price18) / WAD;

  // Convert to number for final result
  return Number(usd18) / Number(WAD);
}

/**
 * Format a raw token amount to human-readable string with appropriate precision.
 * 
 * @param rawAmount - Raw token amount as BigInt
 * @param tokenDecimals - Token decimals
 * @param maxDecimals - Maximum decimal places to show (default: token decimals)
 * @returns Human-readable amount string
 * 
 * @example
 * // 1000.50 USDC (6 decimals)
 * formatTokenAmount(1000500000n, 6) // => "1000.5"
 * 
 * // 0.000123 WETH (18 decimals)
 * formatTokenAmount(123000000000000n, 18, 6) // => "0.000123"
 */
export function formatTokenAmount(
  rawAmount: bigint,
  tokenDecimals: number,
  maxDecimals?: number
): string {
  const divisor = 10n ** BigInt(tokenDecimals);
  const integerPart = rawAmount / divisor;
  const fractionalPart = rawAmount % divisor;
  
  if (fractionalPart === 0n) {
    return integerPart.toString();
  }
  
  // Format fractional part with leading zeros
  let fractionalStr = fractionalPart.toString().padStart(tokenDecimals, '0');
  
  // Trim to maxDecimals if specified
  if (maxDecimals !== undefined && maxDecimals < tokenDecimals) {
    fractionalStr = fractionalStr.substring(0, maxDecimals);
  }
  
  // Trim trailing zeros
  fractionalStr = fractionalStr.replace(/0+$/, '');
  
  if (fractionalStr.length === 0) {
    return integerPart.toString();
  }
  
  return `${integerPart}.${fractionalStr}`;
}

/**
 * Convert ETH-denominated base amount (from Aave getUserAccountData) to USD.
 * 
 * @param baseAmountEth - Amount in ETH base (1e18)
 * @param ethPriceRaw - ETH price from Chainlink (typically 8 decimals)
 * @param ethPriceDecimals - ETH price feed decimals (default: 8)
 * @returns USD value as number
 * 
 * @example
 * // totalCollateralBase = 5 ETH = 5000000000000000000n
 * // ethPrice = $2500 = 250000000000n (8 decimals)
 * baseToUsd(5000000000000000000n, 250000000000n, 8) // => 12500.00
 */
export function baseToUsd(
  baseAmountEth: bigint,
  ethPriceRaw: bigint,
  ethPriceDecimals: number = 8
): number {
  // Base amount is already in 18 decimals (ETH)
  // Just need to normalize price and multiply
  return usdValue(baseAmountEth, 18, ethPriceRaw, ethPriceDecimals);
}

/**
 * Validate that a calculated amount is within reasonable bounds.
 * Helps catch scaling errors before they cause incorrect alerts.
 * 
 * @param humanAmount - Amount in human-readable form (e.g., 1000.5 for 1000.5 tokens)
 * @param symbol - Token symbol for logging
 * @param maxReasonable - Maximum reasonable amount (default: 1e9)
 * @returns Object with valid flag and reason if invalid
 */
export function validateAmount(
  humanAmount: number,
  symbol: string,
  maxReasonable: number = 1e9
): { valid: boolean; reason?: string } {
  // Check for non-finite first (catches Infinity and NaN)
  if (!isFinite(humanAmount)) {
    return {
      valid: false,
      reason: `Non-finite amount: ${humanAmount} ${symbol}`
    };
  }
  
  if (humanAmount < 0) {
    return {
      valid: false,
      reason: `Negative amount: ${humanAmount} ${symbol}`
    };
  }
  
  if (humanAmount > maxReasonable) {
    return {
      valid: false,
      reason: `Suspiciously large amount: ${humanAmount} ${symbol} (> ${maxReasonable})`
    };
  }
  
  return { valid: true };
}

/**
 * Constants for common decimal operations
 */
export const DecimalConstants = {
  RAY,
  WAD,
  USDC_DECIMALS: 6,
  WETH_DECIMALS: 18,
  DAI_DECIMALS: 18,
  CHAINLINK_DECIMALS: 8,
  AAVE_BASE_DECIMALS: 18, // Aave uses ETH as base (18 decimals)
} as const;
