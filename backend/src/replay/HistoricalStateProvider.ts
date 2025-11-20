// HistoricalStateProvider: Wrapper for state queries with historical block support
import { JsonRpcProvider, Contract } from 'ethers';

/**
 * HistoricalStateProvider wraps existing data services to inject blockTag
 * for historical state queries during replay.
 * 
 * This is a lightweight adapter that ensures all state reads happen at a specific block.
 */
export class HistoricalStateProvider {
  private provider: JsonRpcProvider;
  private currentBlock: number;
  
  constructor(provider: JsonRpcProvider) {
    this.provider = provider;
    this.currentBlock = 0;
  }
  
  /**
   * Set the current replay block for subsequent queries.
   */
  setBlock(blockNumber: number): void {
    this.currentBlock = blockNumber;
  }
  
  /**
   * Get the current replay block.
   */
  getBlock(): number {
    return this.currentBlock;
  }
  
  /**
   * Get block header information for metrics.
   */
  async getBlockHeader(blockNumber: number): Promise<{
    number: number;
    timestamp: number;
    baseFeePerGas?: bigint;
  }> {
    const block = await this.provider.getBlock(blockNumber);
    if (!block) {
      throw new Error(`Block ${blockNumber} not found`);
    }
    
    return {
      number: block.number,
      timestamp: block.timestamp,
      baseFeePerGas: block.baseFeePerGas || undefined,
    };
  }
  
  /**
   * Create a contract instance with historical block tag support.
   */
  getContract(address: string, abi: any[]): Contract {
    return new Contract(address, abi, this.provider);
  }
  
  /**
   * Execute a contract call at the current replay block.
   */
  async call(contract: Contract, method: string, args: any[]): Promise<any> {
    const blockTag = this.currentBlock;
    return contract[method](...args, { blockTag });
  }
  
  /**
   * Batch multicall at the current replay block.
   * This is a helper for efficient batch queries.
   */
  async multicall(
    multicall3Address: string,
    calls: Array<{ target: string; allowFailure: boolean; callData: string }>
  ): Promise<Array<{ success: boolean; returnData: string }>> {
    const multicall3ABI = [
      'function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) external payable returns (tuple(bool success, bytes returnData)[] returnData)'
    ];
    
    const multicall = new Contract(multicall3Address, multicall3ABI, this.provider);
    const blockTag = this.currentBlock;
    
    const result = await multicall.aggregate3(calls, { blockTag });
    return result;
  }
  
  /**
   * Get user account data from Aave Pool at current block.
   */
  async getUserAccountData(
    poolAddress: string,
    userAddress: string
  ): Promise<{
    totalCollateralBase: bigint;
    totalDebtBase: bigint;
    availableBorrowsBase: bigint;
    currentLiquidationThreshold: bigint;
    ltv: bigint;
    healthFactor: bigint;
  }> {
    const poolABI = [
      'function getUserAccountData(address user) external view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)'
    ];
    
    const pool = new Contract(poolAddress, poolABI, this.provider);
    const blockTag = this.currentBlock;
    
    const result = await pool.getUserAccountData(userAddress, { blockTag });
    
    return {
      totalCollateralBase: result[0],
      totalDebtBase: result[1],
      availableBorrowsBase: result[2],
      currentLiquidationThreshold: result[3],
      ltv: result[4],
      healthFactor: result[5],
    };
  }
  
  /**
   * Get asset price from Aave Oracle at current block.
   */
  async getAssetPrice(
    oracleAddress: string,
    assetAddress: string
  ): Promise<bigint> {
    const oracleABI = [
      'function getAssetPrice(address asset) external view returns (uint256)'
    ];
    
    const oracle = new Contract(oracleAddress, oracleABI, this.provider);
    const blockTag = this.currentBlock;
    
    return await oracle.getAssetPrice(assetAddress, { blockTag });
  }
  
  /**
   * Get reserve data from Aave Pool at current block.
   */
  async getReserveData(
    poolAddress: string,
    assetAddress: string
  ): Promise<{
    configuration: bigint;
    liquidityIndex: bigint;
    currentLiquidityRate: bigint;
    variableBorrowIndex: bigint;
    currentVariableBorrowRate: bigint;
    currentStableBorrowRate: bigint;
    lastUpdateTimestamp: bigint;
    aTokenAddress: string;
    stableDebtTokenAddress: string;
    variableDebtTokenAddress: string;
  }> {
    const poolABI = [
      'function getReserveData(address asset) external view returns (tuple(uint256 configuration, uint128 liquidityIndex, uint128 currentLiquidityRate, uint128 variableBorrowIndex, uint128 currentVariableBorrowRate, uint128 currentStableBorrowRate, uint40 lastUpdateTimestamp, uint16 id, address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress, address interestRateStrategyAddress, uint128 accruedToTreasury, uint128 unbacked, uint128 isolationModeTotalDebt))'
    ];
    
    const pool = new Contract(poolAddress, poolABI, this.provider);
    const blockTag = this.currentBlock;
    
    const result = await pool.getReserveData(assetAddress, { blockTag });
    
    return {
      configuration: result[0],
      liquidityIndex: result[1],
      currentLiquidityRate: result[2],
      variableBorrowIndex: result[3],
      currentVariableBorrowRate: result[4],
      currentStableBorrowRate: result[5],
      lastUpdateTimestamp: result[6],
      aTokenAddress: result[8],
      stableDebtTokenAddress: result[9],
      variableDebtTokenAddress: result[10],
    };
  }
}
