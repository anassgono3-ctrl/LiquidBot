/**
 * USD calculation utilities with 1e18 normalization
 * Ensures consistent math between plan resolver and executor
 */

/**
 * Calculate USD value from raw token amount using 1e18 normalization
 * This is the canonical implementation used by both plan resolver and executor
 * 
 * Math:
 * - amount1e18 = rawAmount * 10^(18 - tokenDecimals)
 * - usd = (amount1e18 * price1e18) / 1e18
 * 
 * @param rawAmount Raw token amount as BigInt
 * @param tokenDecimals Token decimals (e.g., 6 for USDC, 18 for WETH)
 * @param priceRaw Oracle price as BigInt (in 1e8 format from Aave oracle)
 * @returns USD value as number
 */
export function calculateUsdValue(
  rawAmount: bigint,
  tokenDecimals: number,
  priceRaw: bigint
): number {
  if (rawAmount === 0n) {
    return 0;
  }

  // Convert oracle price from 1e8 to 1e18 format
  const price1e18 = priceRaw * BigInt(1e10);

  // Normalize amount to 1e18
  const decimalDiff = 18 - tokenDecimals;
  let amount1e18: bigint;
  
  if (decimalDiff >= 0) {
    // Scale up: multiply by 10^(18 - tokenDecimals)
    amount1e18 = rawAmount * BigInt(10 ** decimalDiff);
  } else {
    // Scale down: divide by 10^(tokenDecimals - 18)
    amount1e18 = rawAmount / BigInt(10 ** Math.abs(decimalDiff));
  }

  // Calculate USD: (amount1e18 * price1e18) / 1e18
  const usd1e18 = (amount1e18 * price1e18) / BigInt(1e18);

  // Convert to number for final result
  return Number(usd1e18) / 1e18;
}

/**
 * Format raw token amount to human-readable string
 * @param rawAmount Raw token amount as BigInt
 * @param tokenDecimals Token decimals
 * @returns Human-readable amount string
 */
export function formatTokenAmount(
  rawAmount: bigint,
  tokenDecimals: number
): string {
  const divisor = BigInt(10 ** tokenDecimals);
  const integerPart = rawAmount / divisor;
  const fractionalPart = rawAmount % divisor;
  
  // Format with up to tokenDecimals decimal places
  const fractionalStr = fractionalPart.toString().padStart(tokenDecimals, '0');
  
  // Trim trailing zeros
  const trimmed = fractionalStr.replace(/0+$/, '');
  
  if (trimmed.length === 0) {
    return integerPart.toString();
  }
  
  return `${integerPart}.${trimmed}`;
}
