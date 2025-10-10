// Token addresses for Base chain (chainId: 8453)
// Source: https://docs.base.org/tokens/ and DeFi protocols

export interface TokenInfo {
  address: string;
  symbol: string;
  decimals: number;
  isStablecoin: boolean;
}

/**
 * Token addresses on Base mainnet (chainId: 8453)
 */
export const BASE_TOKENS: Record<string, TokenInfo> = {
  // Native and wrapped ETH
  'WETH': {
    address: '0x4200000000000000000000000000000000000006',
    symbol: 'WETH',
    decimals: 18,
    isStablecoin: false
  },
  'ETH': {
    address: '0x4200000000000000000000000000000000000006',
    symbol: 'WETH',
    decimals: 18,
    isStablecoin: false
  },
  
  // Stablecoins
  'USDC': {
    address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    symbol: 'USDC',
    decimals: 6,
    isStablecoin: true
  },
  'USDbC': {
    address: '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA',
    symbol: 'USDbC',
    decimals: 6,
    isStablecoin: true
  },
  'USDT': {
    address: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2',
    symbol: 'USDT',
    decimals: 6,
    isStablecoin: true
  },
  'DAI': {
    address: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb',
    symbol: 'DAI',
    decimals: 18,
    isStablecoin: true
  },
  
  // Other major tokens
  'cbETH': {
    address: '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22',
    symbol: 'cbETH',
    decimals: 18,
    isStablecoin: false
  },
  'WBTC': {
    address: '0x0555E30da8f98308EdB960aa94C0Db47230d2B9c',
    symbol: 'WBTC',
    decimals: 8,
    isStablecoin: false
  },
  'AERO': {
    address: '0x940181a94A35A4569E4529A3CDfB74e38FD98631',
    symbol: 'AERO',
    decimals: 18,
    isStablecoin: false
  }
};

/**
 * Resolve token address from symbol or address
 * @param symbolOrAddress Token symbol (e.g., "USDC") or address (e.g., "0x833...")
 * @returns Token address in checksummed format
 */
export function resolveTokenAddress(symbolOrAddress: string): string {
  if (!symbolOrAddress) {
    throw new Error('Token symbol or address is required');
  }

  // If it's already an address (starts with 0x and is 42 chars), return it
  if (symbolOrAddress.startsWith('0x') && symbolOrAddress.length === 42) {
    return symbolOrAddress;
  }

  // Otherwise, treat it as a symbol and look it up
  const upperSymbol = symbolOrAddress.toUpperCase();
  const tokenInfo = BASE_TOKENS[upperSymbol];
  
  if (!tokenInfo) {
    throw new Error(`Unknown token symbol: ${symbolOrAddress}`);
  }

  return tokenInfo.address;
}

/**
 * Check if a token is a stablecoin (by symbol or address)
 * @param symbolOrAddress Token symbol or address
 * @returns true if token is a stablecoin
 */
export function isStablecoin(symbolOrAddress: string): boolean {
  if (!symbolOrAddress) {
    return false;
  }

  // Try by symbol first
  const upperSymbol = symbolOrAddress.toUpperCase();
  if (BASE_TOKENS[upperSymbol]) {
    return BASE_TOKENS[upperSymbol].isStablecoin;
  }

  // Try by address
  const lowerAddress = symbolOrAddress.toLowerCase();
  for (const tokenInfo of Object.values(BASE_TOKENS)) {
    if (tokenInfo.address.toLowerCase() === lowerAddress) {
      return tokenInfo.isStablecoin;
    }
  }

  return false;
}

/**
 * Get token info by symbol or address
 * @param symbolOrAddress Token symbol or address
 * @returns TokenInfo or null if not found
 */
export function getTokenInfo(symbolOrAddress: string): TokenInfo | null {
  if (!symbolOrAddress) {
    return null;
  }

  // Try by symbol first
  const upperSymbol = symbolOrAddress.toUpperCase();
  if (BASE_TOKENS[upperSymbol]) {
    return BASE_TOKENS[upperSymbol];
  }

  // Try by address
  const lowerAddress = symbolOrAddress.toLowerCase();
  for (const tokenInfo of Object.values(BASE_TOKENS)) {
    if (tokenInfo.address.toLowerCase() === lowerAddress) {
      return tokenInfo;
    }
  }

  return null;
}
