/**
 * Token Metadata Overrides for Base Network
 * 
 * Provides hardcoded metadata for known tokens to avoid on-chain lookups
 * and eliminate symbol_missing warnings.
 * 
 * IMPORTANT: These are ONLY used when base metadata is missing.
 * They do NOT overwrite existing entries in AaveMetadata.
 */

export interface TokenOverride {
  address: string; // lowercase
  symbol: string;
  decimals: number;
  name?: string;
}

/**
 * Base mainnet token overrides
 * Addresses are normalized to lowercase
 */
export const BASE_TOKEN_OVERRIDES: TokenOverride[] = [
  {
    address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    symbol: 'USDC',
    decimals: 6,
    name: 'USD Coin'
  },
  {
    address: '0x4200000000000000000000000000000000000006',
    symbol: 'WETH',
    decimals: 18,
    name: 'Wrapped Ether'
  },
  {
    address: '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf',
    symbol: 'cbBTC',
    decimals: 8,
    name: 'Coinbase Wrapped BTC'
  },
  {
    address: '0x9506a02b003d7a7eaf86579863a29601528ca0be',
    symbol: 'USDbC',
    decimals: 6,
    name: 'USD Base Coin (Bridged)'
  },
  {
    address: '0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22',
    symbol: 'cbETH',
    decimals: 18,
    name: 'Coinbase Wrapped Staked ETH'
  },
  {
    address: '0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452',
    symbol: 'wstETH',
    decimals: 18,
    name: 'Wrapped liquid staked Ether 2.0'
  },
  {
    address: '0x04c0599ae5a44757c0af6f9ec3b93da8976c150a',
    symbol: 'weETH',
    decimals: 18,
    name: 'Wrapped eETH'
  },
  {
    address: '0x63706e401c06ac8513145b7687a14804d17f814b',
    symbol: 'AAVE',
    decimals: 18,
    name: 'Aave Token'
  },
  {
    address: '0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42',
    symbol: 'EURC',
    decimals: 6,
    name: 'Euro Coin'
  },
  {
    address: '0x6bb7a212910682dcfdbd5bcbb3e28fb4e8da10ee',
    symbol: 'GHO',
    decimals: 18,
    name: 'Gho Token'
  }
];

/**
 * Get override metadata for a token address
 * Returns undefined if not found
 */
export function getTokenOverride(address: string): TokenOverride | undefined {
  const normalized = address.toLowerCase();
  return BASE_TOKEN_OVERRIDES.find(t => t.address === normalized);
}

/**
 * Check if an address has an override
 */
export function hasTokenOverride(address: string): boolean {
  return getTokenOverride(address) !== undefined;
}

/**
 * Get all override addresses
 */
export function getOverrideAddresses(): string[] {
  return BASE_TOKEN_OVERRIDES.map(t => t.address);
}
