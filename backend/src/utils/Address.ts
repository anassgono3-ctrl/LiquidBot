/**
 * Address normalization utilities for consistent address handling
 * across borrower indexes, near-threshold sets, and watch lists.
 * 
 * Ensures all address comparisons and lookups use normalized lowercase keys.
 */

import { config } from '../config/index.js';

/**
 * Normalize an Ethereum address to lowercase if normalization is enabled
 * @param address - The address to normalize
 * @returns Normalized address (lowercase if enabled, otherwise unchanged)
 */
export function normalizeAddress(address: string): string {
  if (!address) return address;
  
  if (config.addressNormalizeLowercase) {
    return address.toLowerCase();
  }
  
  return address;
}

/**
 * Normalize an array of addresses
 * @param addresses - Array of addresses to normalize
 * @returns Array of normalized addresses
 */
export function normalizeAddresses(addresses: string[]): string[] {
  return addresses.map(normalizeAddress);
}

/**
 * Check if two addresses are equal (case-insensitive)
 * @param addr1 - First address
 * @param addr2 - Second address
 * @returns true if addresses are equal
 */
export function addressesEqual(addr1: string, addr2: string): boolean {
  if (!addr1 || !addr2) return false;
  return normalizeAddress(addr1) === normalizeAddress(addr2);
}

/**
 * Compute intersection of two address sets with normalization
 * @param setA - First set of addresses
 * @param setB - Second set of addresses
 * @returns Intersection of the two sets (normalized addresses)
 */
export function addressSetIntersection(
  setA: Set<string> | string[],
  setB: Set<string> | string[]
): Set<string> {
  const normalizedA = new Set(
    Array.from(setA).map(normalizeAddress)
  );
  const normalizedB = new Set(
    Array.from(setB).map(normalizeAddress)
  );
  
  const intersection = new Set<string>();
  for (const addr of normalizedA) {
    if (normalizedB.has(addr)) {
      intersection.add(addr);
    }
  }
  
  return intersection;
}

/**
 * Diagnostic assertion for intersection consistency
 * Emits warning if intersection is unexpectedly empty when both sets are non-empty
 * 
 * @param setA - First set
 * @param setB - Second set
 * @param intersection - Computed intersection
 * @param context - Context string for logging
 */
export function assertIntersectionConsistency(
  setA: Set<string> | string[],
  setB: Set<string> | string[],
  intersection: Set<string>,
  context: string
): void {
  const sizeA = Array.from(setA).length;
  const sizeB = Array.from(setB).length;
  
  if (sizeA > 0 && sizeB > 0 && intersection.size === 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `[address-normalize] ${context}: intersection=0 but setA=${sizeA}, setB=${sizeB}. ` +
      `Possible normalization mismatch.`
    );
  }
}
