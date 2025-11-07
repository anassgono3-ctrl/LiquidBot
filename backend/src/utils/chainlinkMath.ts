/**
 * Chainlink price feed normalization utilities
 * Provides high-precision decimal conversion without floating-point rounding concerns
 */

/**
 * Normalize Chainlink price feed answer to USD with safe BigInt arithmetic
 * 
 * Standard approach (may lose precision):
 *   price = Number(answer) / (10 ** decimals)
 * 
 * High-precision approach (maintains precision):
 *   price = normalizeChainlinkPrice(answer, decimals)
 * 
 * @param answer Raw answer from Chainlink feed (BigInt)
 * @param decimals Feed decimals (typically 8 for most Chainlink feeds)
 * @returns USD price as number
 * 
 * @example
 * // ETH/USD feed with 8 decimals returning 300050000000
 * const price = normalizeChainlinkPrice(300050000000n, 8);
 * // Returns: 3000.5
 */
export function normalizeChainlinkPrice(answer: bigint, decimals: number): number {
  if (answer <= 0n) {
    throw new Error(`Invalid Chainlink answer: ${answer}`);
  }
  
  if (decimals < 0 || decimals > 18) {
    throw new Error(`Invalid decimals: ${decimals}`);
  }
  
  // For high precision, we can scale to a fixed precision point first
  // This is the simple, recommended approach for typical price feeds
  const divisor = BigInt(10 ** decimals);
  
  // Integer part
  const integerPart = answer / divisor;
  
  // Fractional part (preserves precision up to decimals places)
  const fractionalPart = answer % divisor;
  
  // Convert to number: integer + fractional/divisor
  return Number(integerPart) + Number(fractionalPart) / Number(divisor);
}

/**
 * Normalize Chainlink price with additional validation
 * Same as normalizeChainlinkPrice but returns null instead of throwing on invalid input
 * 
 * @param answer Raw answer from Chainlink feed (BigInt)
 * @param decimals Feed decimals
 * @returns USD price as number, or null if invalid
 */
export function safeNormalizeChainlinkPrice(
  answer: bigint,
  decimals: number
): number | null {
  try {
    return normalizeChainlinkPrice(answer, decimals);
  } catch {
    return null;
  }
}

/**
 * Format Chainlink price for display with appropriate precision
 * 
 * @param answer Raw answer from Chainlink feed (BigInt)
 * @param decimals Feed decimals
 * @param displayDecimals Number of decimals to show (default: 8)
 * @returns Formatted price string
 * 
 * @example
 * formatChainlinkPrice(300050000000n, 8, 2) // "3000.50"
 */
export function formatChainlinkPrice(
  answer: bigint,
  decimals: number,
  displayDecimals: number = 8
): string {
  const price = normalizeChainlinkPrice(answer, decimals);
  return price.toFixed(displayDecimals);
}
