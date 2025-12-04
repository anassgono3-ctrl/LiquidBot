// Token address mappings for Base network (chainId 8453)

/**
 * Known token addresses on Base mainnet
 */
export const BASE_TOKENS: Record<string, string> = {
  'WETH': '0x4200000000000000000000000000000000000006',
  'USDC': '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  'USDbC': '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA',
  'DAI': '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb',
  'cbETH': '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22',
  'wstETH': '0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452',
  'AAVE': '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
};

/**
 * Resolve a token symbol or address to its canonical address
 * @param token Token symbol (e.g., 'WETH') or address (e.g., '0x4200...')
 * @returns Token address if found, otherwise returns the input unchanged
 */
export function resolveTokenAddress(token: string): string {
  if (!token) {
    return token;
  }

  // If already an address (starts with 0x and has correct length), return as-is
  if (token.startsWith('0x') && token.length === 42) {
    return token;
  }

  // Try to resolve from symbol mapping
  const upperToken = token.toUpperCase();
  if (BASE_TOKENS[upperToken]) {
    return BASE_TOKENS[upperToken];
  }

  // Return unchanged if not found
  return token;
}
