// HedgedProvider: Multi-provider read hedge for Base network
// Issues parallel reads to PRIMARY and SECONDARY RPC when primary is slow
// First response wins; cancel the other

import { JsonRpcProvider } from 'ethers';
import { config } from '../config/index.js';
import { hedgeFiredTotal, hedgeWinnerSecondary } from '../metrics/index.js';

export interface HedgedProviderOptions {
  primaryRpcUrl: string;
  secondaryRpcUrl?: string;
  hedgeDelayMs?: number; // Delay before firing secondary request
}

/**
 * HedgedProvider wraps JsonRpcProvider with hedged read capability.
 * When primary RPC is slow, fires a parallel request to secondary RPC.
 * First response wins; the other is cancelled.
 */
export class HedgedProvider {
  private primaryProvider: JsonRpcProvider;
  private secondaryProvider?: JsonRpcProvider;
  private hedgeDelayMs: number;

  constructor(options: HedgedProviderOptions) {
    this.primaryProvider = new JsonRpcProvider(options.primaryRpcUrl);
    this.secondaryProvider = options.secondaryRpcUrl
      ? new JsonRpcProvider(options.secondaryRpcUrl)
      : undefined;
    this.hedgeDelayMs = options.hedgeDelayMs ?? config.headCheckHedgeMs;
  }

  /**
   * Hedged call: race primary against secondary (after delay)
   * @param operation Operation name for metrics
   * @param call Function that executes the RPC call
   */
  async hedgedCall<T>(operation: string, call: (provider: JsonRpcProvider) => Promise<T>): Promise<T> {
    // If no secondary or hedge disabled, just use primary
    if (!this.secondaryProvider || this.hedgeDelayMs <= 0) {
      return call(this.primaryProvider);
    }

    let primaryResolved = false;
    let secondaryFired = false;

    return new Promise<T>((resolve, reject) => {
      let resolved = false;
      let hedgeTimer: NodeJS.Timeout | null = null;

      // Execute primary call
      const primaryPromise = call(this.primaryProvider)
        .then((result) => {
          primaryResolved = true;
          if (!resolved) {
            resolved = true;
            if (hedgeTimer) clearTimeout(hedgeTimer);
            resolve(result);
          }
        })
        .catch((err) => {
          if (!resolved) {
            resolved = true;
            if (hedgeTimer) clearTimeout(hedgeTimer);
            reject(err);
          }
        });

      // Set up hedge timer
      hedgeTimer = setTimeout(() => {
        if (!primaryResolved && this.secondaryProvider) {
          secondaryFired = true;
          hedgeFiredTotal.inc({ operation });

          // Execute secondary call
          call(this.secondaryProvider)
            .then((result) => {
              if (!resolved) {
                resolved = true;
                hedgeWinnerSecondary.inc({ operation });
                resolve(result);
              }
            })
            .catch(() => {
              // Secondary failed, wait for primary
            });
        }
      }, this.hedgeDelayMs);
    });
  }

  /**
   * Get the primary provider directly (for non-hedged calls)
   */
  getPrimaryProvider(): JsonRpcProvider {
    return this.primaryProvider;
  }

  /**
   * Get the secondary provider directly (if configured)
   */
  getSecondaryProvider(): JsonRpcProvider | undefined {
    return this.secondaryProvider;
  }
}
