/**
 * BigInt utility functions to avoid literal type comparison issues
 */

/**
 * Check if a bigint value is zero
 * @param v - The bigint value to check
 * @returns true if v is zero, false otherwise
 */
export const isZero = (v: bigint): boolean => v === 0n;

/**
 * Check if two bigint values are equal
 * @param a - First bigint value
 * @param b - Second bigint value
 * @returns true if a and b are equal, false otherwise
 */
export const equals = (a: bigint, b: bigint): boolean => a === b;
