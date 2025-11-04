// ExecutorRevertDecoder: Maps executor revert selectors to human-readable errors
// Provides context for failed liquidation attempts

import { Interface } from 'ethers';

// Executor error signatures from LiquidationExecutor.sol
const EXECUTOR_ERRORS = {
  '0x82b42900': 'Unauthorized',
  '0xab35696f': 'ContractPaused',
  '0xe6c4247b': 'InvalidAddress',
  '0x64e1e2b4': 'AssetNotWhitelisted',
  '0xb629b0e4': 'InsufficientOutput', // Known from problem statement
  '0xc9e2b63e': 'FlashLoanFailed',
  '0xc2f5625a': 'SwapFailed',
  '0x6ec1468e': 'OnlyVault'
};

// Common Aave V3 errors
const AAVE_ERRORS = {
  '0x00000000': 'GenericError',
  '0x3b1e7d68': 'UserNotLiquidatable',
  '0x6f0fd1b2': 'InvalidFlashloanMode',
  '0x3c6a5e44': 'NotEnoughCollateral',
  '0x2b9f0b52': 'LiquidationAmountNotAllowed',
  '0x89a5a3c4': 'HealthFactorNotBelowThreshold',
  '0x59c5c4f9': 'InvalidCloseFactor',
  '0xe433766c': 'CollateralCannotBeLiquidated'
};

// Common ERC20/DEX errors
const COMMON_ERRORS = {
  '0x7939f424': 'InsufficientLiquidity',
  '0x220266b6': 'InsufficientAllowance',
  '0xf4d678b8': 'InsufficientBalance',
  '0x57f447ce': 'K', // Uniswap K invariant violation
  '0xf1b8a1fe': 'TooLittleReceived',
  '0x435e0715': 'SlippageExceeded',
  '0x4e487b71': 'Panic' // Solidity panic
};

// Combine all error mappings
const ERROR_SELECTORS: Record<string, string> = {
  ...EXECUTOR_ERRORS,
  ...AAVE_ERRORS,
  ...COMMON_ERRORS
};

export interface DecodedRevert {
  selector: string;
  name: string;
  reason: string;
  category: 'executor' | 'aave' | 'common' | 'unknown';
}

/**
 * ExecutorRevertDecoder provides human-readable error messages for
 * contract revert reasons from the liquidation executor and related contracts.
 */
export class ExecutorRevertDecoder {
  /**
   * Decode a revert reason from transaction data
   */
  static decode(revertData: string): DecodedRevert {
    // Normalize to lowercase and ensure 0x prefix
    const data = revertData.toLowerCase().startsWith('0x') 
      ? revertData.toLowerCase() 
      : `0x${revertData.toLowerCase()}`;

    // Extract 4-byte selector
    const selector = data.slice(0, 10);

    // Check if it's a known error
    const errorName = ERROR_SELECTORS[selector];
    
    if (errorName) {
      let category: DecodedRevert['category'] = 'unknown';
      if (selector in EXECUTOR_ERRORS) category = 'executor';
      else if (selector in AAVE_ERRORS) category = 'aave';
      else if (selector in COMMON_ERRORS) category = 'common';

      return {
        selector,
        name: errorName,
        reason: this.formatReason(errorName, category),
        category
      };
    }

    // Try to decode as Error(string) or Panic(uint256)
    try {
      const iface = new Interface([
        'error Error(string reason)',
        'error Panic(uint256 code)'
      ]);

      // Try Error(string)
      if (data.startsWith('0x08c379a0')) {
        const decoded = iface.parseError(data);
        if (decoded && decoded.args[0]) {
          return {
            selector: '0x08c379a0',
            name: 'Error',
            reason: decoded.args[0],
            category: 'common'
          };
        }
      }

      // Try Panic(uint256)
      if (data.startsWith('0x4e487b71')) {
        const decoded = iface.parseError(data);
        if (decoded && decoded.args[0] !== undefined) {
          const panicCode = Number(decoded.args[0]);
          return {
            selector: '0x4e487b71',
            name: 'Panic',
            reason: this.formatPanicCode(panicCode),
            category: 'common'
          };
        }
      }
    } catch (err) {
      // Ignore decode errors
    }

    // Unknown error
    return {
      selector,
      name: 'UnknownError',
      reason: `Unknown revert with selector ${selector}`,
      category: 'unknown'
    };
  }

  /**
   * Format a panic code into a human-readable message
   */
  private static formatPanicCode(code: number): string {
    const panicReasons: Record<number, string> = {
      0x01: 'Assertion failed',
      0x11: 'Arithmetic overflow/underflow',
      0x12: 'Division by zero',
      0x21: 'Invalid enum value',
      0x22: 'Invalid storage byte array',
      0x31: 'Pop on empty array',
      0x32: 'Array out of bounds',
      0x41: 'Out of memory',
      0x51: 'Invalid internal function call'
    };

    return panicReasons[code] || `Panic code 0x${code.toString(16)}`;
  }

  /**
   * Format error name into human-readable reason
   */
  private static formatReason(name: string, category: DecodedRevert['category']): string {
    const formatted = name.replace(/([A-Z])/g, ' $1').trim().toLowerCase();
    
    switch (category) {
      case 'executor':
        return `Executor: ${formatted}`;
      case 'aave':
        return `Aave: ${formatted}`;
      case 'common':
        return formatted;
      default:
        return formatted;
    }
  }

  /**
   * Check if a revert is a specific known error
   */
  static isError(revertData: string, errorName: string): boolean {
    const decoded = this.decode(revertData);
    return decoded.name === errorName;
  }

  /**
   * Check if a revert indicates insufficient output (dust/slippage)
   */
  static isInsufficientOutput(revertData: string): boolean {
    const decoded = this.decode(revertData);
    return decoded.name === 'InsufficientOutput' 
        || decoded.name === 'TooLittleReceived'
        || decoded.name === 'SlippageExceeded';
  }

  /**
   * Check if a revert indicates user is not liquidatable
   */
  static isNotLiquidatable(revertData: string): boolean {
    const decoded = this.decode(revertData);
    return decoded.name === 'UserNotLiquidatable'
        || decoded.name === 'HealthFactorNotBelowThreshold';
  }

  /**
   * Get short reason code for notifications
   */
  static getShortReason(revertData: string): string {
    const decoded = this.decode(revertData);
    
    // Map to short codes
    const shortCodes: Record<string, string> = {
      'InsufficientOutput': 'dust_too_small',
      'TooLittleReceived': 'slippage_exceeded',
      'SlippageExceeded': 'slippage_exceeded',
      'UserNotLiquidatable': 'user_not_liquidatable',
      'HealthFactorNotBelowThreshold': 'hf_above_threshold',
      'InsufficientLiquidity': 'no_liquidity',
      'AssetNotWhitelisted': 'asset_not_whitelisted',
      'ContractPaused': 'executor_paused',
      'Unauthorized': 'unauthorized',
      'SwapFailed': 'swap_failed',
      'FlashLoanFailed': 'flash_loan_failed'
    };

    return shortCodes[decoded.name] || decoded.name.toLowerCase().replace(/\s+/g, '_');
  }
}
