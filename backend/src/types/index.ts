// Type definitions for LiquidBot backend

export interface UserReserve {
  currentATokenBalance: string;
  currentVariableDebt: string;
  currentStableDebt: string;
  reserve: Reserve;
}

export interface Reserve {
  id: string;
  symbol: string;
  name: string;
  decimals: number;
  reserveLiquidationThreshold: number;
  usageAsCollateralEnabled: boolean;
  price: {
    priceInEth: string;
  };
}

export interface User {
  id: string;
  borrowedReservesCount: number;
  reserves: UserReserve[];
}

export interface LiquidationCall {
  id: string;
  timestamp: number;             // normalized from string
  liquidator: string;
  user: string;
  principalAmount: string;
  collateralAmount: string;
  txHash: string | null;
  principalReserve: {
    id: string;
    symbol: string | null;
    decimals: number | null;
  } | null;
  collateralReserve: {
    id: string;
    symbol: string | null;
    decimals: number | null;
  } | null;
}

export interface HealthFactorResult {
  healthFactor: number;
  totalCollateralETH: number;
  totalDebtETH: number;
  isAtRisk: boolean;
}

export interface RefinanceRoute {
  fromAsset: string;
  toAsset: string;
  amount: string;
  slippageBps: number;
  gasEstimate: string;
}

export enum SubscriptionTier {
  BASIC = 'BASIC',
  PREMIUM = 'PREMIUM',
  ENTERPRISE = 'ENTERPRISE',
}

export enum ProtectionType {
  REFINANCE = 'REFINANCE',
  EMERGENCY = 'EMERGENCY',
}
