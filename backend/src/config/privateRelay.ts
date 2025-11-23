/**
 * Private Relay Configuration
 * 
 * Unified configuration for private transaction relay submission.
 * Consolidates and deprecates legacy TX_SUBMIT_MODE and PRIVATE_BUNDLE_RPC.
 */

export interface PrivateRelayConfig {
  enabled: boolean;
  mode: 'disabled' | 'protect' | 'bundle';
  rpcUrl?: string;
  signatureRandom: boolean;
  maxRetries: number;
  fallbackMode: 'race' | 'direct';
}

/**
 * Parse and validate private relay configuration from environment variables.
 * Provides backward compatibility with legacy variables.
 */
export function getPrivateRelayConfig(): PrivateRelayConfig {
  // New unified variables (preferred)
  const rpcUrl = process.env.PRIVATE_TX_RPC_URL;
  let mode = (process.env.PRIVATE_TX_MODE || '').toLowerCase() as 'disabled' | 'protect' | 'bundle';
  const signatureRandom = process.env.PRIVATE_TX_SIGNATURE_RANDOM === 'true';
  const maxRetries = parseInt(process.env.PRIVATE_TX_MAX_RETRIES || '2', 10);
  const fallbackMode = (process.env.PRIVATE_TX_FALLBACK_MODE || 'race') as 'race' | 'direct';

  // Backward compatibility: PRIVATE_BUNDLE_RPC (deprecated)
  const legacyBundleRpc = process.env.PRIVATE_BUNDLE_RPC;
  const effectiveRpcUrl = rpcUrl || legacyBundleRpc;

  // Backward compatibility: TX_SUBMIT_MODE (deprecated)
  const legacyTxMode = process.env.TX_SUBMIT_MODE;
  
  // Determine effective mode with backward compatibility
  if (!mode || mode === 'disabled') {
    if (effectiveRpcUrl) {
      // If RPC URL is set but mode is not, default to 'protect'
      mode = 'protect';
    } else if (legacyTxMode === 'private' && legacyBundleRpc) {
      // Legacy private mode mapping
      mode = 'protect';
    } else {
      mode = 'disabled';
    }
  }

  const enabled = mode !== 'disabled' && !!effectiveRpcUrl;

  return {
    enabled,
    mode,
    rpcUrl: effectiveRpcUrl,
    signatureRandom,
    maxRetries: Math.max(0, maxRetries),
    fallbackMode
  };
}

/**
 * Log private relay configuration on startup (once)
 */
let configLogged = false;
export function logPrivateRelayConfig(config: PrivateRelayConfig): void {
  if (configLogged) return;
  configLogged = true;

  if (config.enabled) {
    console.log('[private-relay] Configuration:', {
      mode: config.mode,
      rpcUrlHost: config.rpcUrl ? new URL(config.rpcUrl).host : 'none',
      signatureRandom: config.signatureRandom,
      maxRetries: config.maxRetries,
      fallbackMode: config.fallbackMode
    });
  } else {
    console.log('[private-relay] Private relay disabled');
  }
}
