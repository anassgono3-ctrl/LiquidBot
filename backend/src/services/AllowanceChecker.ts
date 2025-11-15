// AllowanceChecker: Pre-warmed allowances for repay tokens
// Checks allowances on startup and periodically
// Stages approvals when EXECUTION_ENABLED=true, sends when APPROVALS_AUTO_SEND=true

import { JsonRpcProvider, Contract, parseUnits } from 'ethers';
import { config } from '../config/index.js';

const ERC20_ABI = [
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function symbol() external view returns (string)',
  'function decimals() external view returns (uint8)'
];

export interface AllowanceStatus {
  token: string;
  symbol: string;
  current: bigint;
  required: bigint;
  needsApproval: boolean;
}

/**
 * AllowanceChecker monitors and manages ERC20 allowances for liquidation executor.
 * Checks configured repay tokens (USDC, EURC, WETH, cbETH) on startup and periodically.
 */
export class AllowanceChecker {
  private provider: JsonRpcProvider;
  private executorAddress: string;
  private spenderAddress: string; // Liquidation executor/router contract
  private repayTokens: string[]; // Token addresses to check
  private checkIntervalMs: number;
  private intervalHandle?: NodeJS.Timeout;

  constructor(
    provider: JsonRpcProvider,
    executorAddress: string,
    spenderAddress: string,
    repayTokens: string[],
    checkIntervalMs: number = 3600000 // 1 hour default
  ) {
    this.provider = provider;
    this.executorAddress = executorAddress;
    this.spenderAddress = spenderAddress;
    this.repayTokens = repayTokens;
    this.checkIntervalMs = checkIntervalMs;
  }

  /**
   * Start periodic allowance checks
   */
  async start(): Promise<void> {
    console.log('[approvals] Starting allowance checker...');
    
    // Initial check
    await this.checkAllowances();
    
    // Periodic checks
    this.intervalHandle = setInterval(async () => {
      await this.checkAllowances();
    }, this.checkIntervalMs);
  }

  /**
   * Stop periodic checks
   */
  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
    }
  }

  /**
   * Check allowances for all configured repay tokens
   */
  async checkAllowances(): Promise<AllowanceStatus[]> {
    const statuses: AllowanceStatus[] = [];

    for (const tokenAddress of this.repayTokens) {
      try {
        const status = await this.checkTokenAllowance(tokenAddress);
        statuses.push(status);

        if (status.needsApproval) {
          console.log(
            `[approvals] needed token=${status.symbol} current=${status.current.toString()} required=${status.required.toString()}`
          );

          // If APPROVALS_AUTO_SEND=true and EXECUTION_ENABLED=true, send approval
          if (config.approvalsAutoSend && config.executionEnabled) {
            await this.approveToken(tokenAddress, status.required);
          } else {
            console.log(`[approvals] dry-run token=${status.symbol} (APPROVALS_AUTO_SEND=${config.approvalsAutoSend})`);
          }
        } else {
          console.log(`[approvals] ok token=${status.symbol} current=${status.current.toString()}`);
        }
      } catch (err) {
        console.error(`[approvals] error checking ${tokenAddress}:`, err);
      }
    }

    return statuses;
  }

  /**
   * Check allowance for a single token
   */
  private async checkTokenAllowance(tokenAddress: string): Promise<AllowanceStatus> {
    const token = new Contract(tokenAddress, ERC20_ABI, this.provider);
    
    const [allowance, symbol, decimals] = await Promise.all([
      token.allowance(this.executorAddress, this.spenderAddress),
      token.symbol(),
      token.decimals()
    ]);

    // Require at least 1M units of the token (should be sufficient for most liquidations)
    const requiredAmount = parseUnits('1000000', decimals);
    const needsApproval = allowance < requiredAmount;

    return {
      token: tokenAddress,
      symbol,
      current: allowance,
      required: requiredAmount,
      needsApproval
    };
  }

  /**
   * Approve a token for spending
   */
  private async approveToken(tokenAddress: string, amount: bigint): Promise<void> {
    try {
      // Note: In production, this would need a wallet with the executor's private key
      // For now, just log the intent
      console.log(`[approvals] would approve token=${tokenAddress} amount=${amount.toString()}`);
      
      // TODO: Implement actual approval transaction when wallet is available
      // const wallet = new ethers.Wallet(config.executionPrivateKey, this.provider);
      // const token = new Contract(tokenAddress, ERC20_ABI, wallet);
      // const tx = await token.approve(this.spenderAddress, amount);
      // console.log(`[approvals] tx sent token=${tokenAddress} txHash=${tx.hash}`);
      // await tx.wait();
      // console.log(`[approvals] tx confirmed token=${tokenAddress} txHash=${tx.hash}`);
    } catch (err) {
      console.error(`[approvals] failed to approve ${tokenAddress}:`, err);
    }
  }

  /**
   * Get configured repay token addresses for Base network
   */
  static getDefaultRepayTokens(): string[] {
    return [
      '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC
      '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42', // EURC
      '0x4200000000000000000000000000000000000006', // WETH
      '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22'  // cbETH
    ];
  }
}
