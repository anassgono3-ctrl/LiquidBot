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
  healthFactor?: number | null;  // Resolved on-demand for new events
}

export interface HealthFactorResult {
  healthFactor: number;
  totalCollateralETH: number;
  totalDebtETH: number;
  isAtRisk: boolean;
}

/**
 * Annotated health factor result with optional reason for null values.
 * Used when attaching HF to opportunity objects.
 */
export interface AnnotatedHealthFactor {
  value: number | null;
  reason?: 'noDebt' | 'dust' | 'notFound' | 'error';
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

export interface Opportunity {
  id: string;                             // liquidationCall id
  txHash: string | null;
  user: string;
  liquidator: string;
  timestamp: number;
  collateralAmountRaw: string;
  principalAmountRaw: string;
  collateralReserve: { symbol?: string|null; decimals?: number|null; id: string };
  principalReserve: { symbol?: string|null; decimals?: number|null; id: string };
  healthFactor?: number | null;          // from cached snapshot
  collateralValueUsd?: number | null;    // estimated by price lookup
  principalValueUsd?: number | null;
  profitEstimateUsd?: number | null;     // (collateralValue - principalValue) * bonus - fees
  bonusPct?: number | null;              // liquidation bonus percentage
  hfVerified?: number | null;            // verified health factor (if verifier available)
  hfDiff?: number | null;                // difference between original and verified HF
  triggerSource?: 'subgraph' | 'realtime'; // source of opportunity detection
  triggerType?: 'event' | 'head' | 'price'; // real-time trigger type (if realtime source)
  debtToCover?: string | null;           // calculated debt to cover (for real-time execution)
  debtToCoverUsd?: number | null;        // debt to cover in USD
}

export interface HealthSnapshot {
  userId: string;
  healthFactor: number;
  totalCollateralETH: number;
  totalDebtETH: number;
  timestamp: number;
}
