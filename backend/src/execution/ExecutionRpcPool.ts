/**
 * ExecutionRpcPool: Dedicated RPC management for execution path
 * 
 * Provides separate RPC providers for:
 * - Public write endpoints (from WRITE_RPCS or fallback to RPC_URL)
 * - Private relay endpoints (from PRIVATE_TX_RPC_URL, PRIVATE_BUNDLE_RPC)
 * - Read endpoints for execution (from EXECUTION_READ_RPC_URLS or RPC_URL)
 * 
 * Isolated from classification/scan providers to prevent contention.
 */

import { ethers } from 'ethers';

export interface ExecutionRpcConfig {
  // Public write RPCs (comma-separated)
  writeRpcs?: string;
  // Primary RPC URL (fallback when writeRpcs empty)
  primaryRpcUrl?: string;
  // Private relay endpoint (single)
  privateTxRpcUrl?: string;
  // Bundle relay (optional, for future)
  privateBundleRpc?: string;
  // Execution read endpoints (comma-separated)
  executionReadRpcUrls?: string;
}

export interface RpcEndpoint {
  url: string;
  provider: ethers.JsonRpcProvider;
  isHealthy: boolean;
  lastError?: Error;
  lastErrorTime?: number;
}

/**
 * ExecutionRpcPool manages RPC providers for the execution path
 */
export class ExecutionRpcPool {
  private publicWriteEndpoints: RpcEndpoint[] = [];
  private privateRelayEndpoint?: RpcEndpoint;
  private readEndpoints: RpcEndpoint[] = [];
  private config: ExecutionRpcConfig;

  constructor(config: ExecutionRpcConfig) {
    this.config = config;
    this.initializeEndpoints();
  }

  /**
   * Initialize RPC endpoints based on configuration
   */
  private initializeEndpoints(): void {
    // Parse public write endpoints
    const writeRpcList = this.config.writeRpcs
      ?.split(',')
      .map(url => url.trim())
      .filter(url => url.length > 0);

    if (writeRpcList && writeRpcList.length > 0) {
      // Use explicit WRITE_RPCS
      this.publicWriteEndpoints = writeRpcList.map(url => ({
        url,
        provider: new ethers.JsonRpcProvider(url),
        isHealthy: true
      }));
      // eslint-disable-next-line no-console
      console.log(`[exec-rpc] Initialized ${this.publicWriteEndpoints.length} public write endpoints`);
    } else if (this.config.primaryRpcUrl) {
      // Fallback to RPC_URL
      this.publicWriteEndpoints = [{
        url: this.config.primaryRpcUrl,
        provider: new ethers.JsonRpcProvider(this.config.primaryRpcUrl),
        isHealthy: true
      }];
      // eslint-disable-next-line no-console
      console.log(`[exec-rpc] Using primary RPC_URL for writes: ${this.maskUrl(this.config.primaryRpcUrl)}`);
    }

    // Initialize private relay endpoint if configured
    if (this.config.privateTxRpcUrl) {
      this.privateRelayEndpoint = {
        url: this.config.privateTxRpcUrl,
        provider: new ethers.JsonRpcProvider(this.config.privateTxRpcUrl),
        isHealthy: true
      };
      // eslint-disable-next-line no-console
      console.log(`[exec-rpc] Private relay configured: ${this.maskUrl(this.config.privateTxRpcUrl)}`);
    }

    // Parse execution read endpoints
    const readRpcList = this.config.executionReadRpcUrls
      ?.split(',')
      .map(url => url.trim())
      .filter(url => url.length > 0);

    if (readRpcList && readRpcList.length > 0) {
      this.readEndpoints = readRpcList.map(url => ({
        url,
        provider: new ethers.JsonRpcProvider(url),
        isHealthy: true
      }));
      // eslint-disable-next-line no-console
      console.log(`[exec-rpc] Initialized ${this.readEndpoints.length} execution read endpoints`);
    } else if (this.config.primaryRpcUrl) {
      // Fallback to primary RPC for reads
      this.readEndpoints = [{
        url: this.config.primaryRpcUrl,
        provider: new ethers.JsonRpcProvider(this.config.primaryRpcUrl),
        isHealthy: true
      }];
    }
  }

  /**
   * Get public write endpoints
   */
  getPublicWriteEndpoints(): RpcEndpoint[] {
    return this.publicWriteEndpoints.filter(ep => ep.isHealthy);
  }

  /**
   * Get private relay endpoint (if configured)
   */
  getPrivateRelayEndpoint(): RpcEndpoint | undefined {
    return this.privateRelayEndpoint?.isHealthy ? this.privateRelayEndpoint : undefined;
  }

  /**
   * Get read endpoints for execution path
   */
  getReadEndpoints(): RpcEndpoint[] {
    return this.readEndpoints.filter(ep => ep.isHealthy);
  }

  /**
   * Get fastest read provider (first healthy one)
   */
  getFastestReadProvider(): ethers.JsonRpcProvider | null {
    const healthy = this.getReadEndpoints();
    return healthy.length > 0 ? healthy[0].provider : null;
  }

  /**
   * Get fastest write provider (first healthy public endpoint)
   */
  getFastestWriteProvider(): ethers.JsonRpcProvider | null {
    const healthy = this.getPublicWriteEndpoints();
    return healthy.length > 0 ? healthy[0].provider : null;
  }

  /**
   * Mark an endpoint as unhealthy
   */
  markUnhealthy(url: string, error: Error): void {
    const allEndpoints = [
      ...this.publicWriteEndpoints,
      ...(this.privateRelayEndpoint ? [this.privateRelayEndpoint] : []),
      ...this.readEndpoints
    ];

    for (const endpoint of allEndpoints) {
      if (endpoint.url === url) {
        endpoint.isHealthy = false;
        endpoint.lastError = error;
        endpoint.lastErrorTime = Date.now();
        // eslint-disable-next-line no-console
        console.warn(`[exec-rpc] Marked unhealthy: ${this.maskUrl(url)} - ${error.message}`);
        break;
      }
    }
  }

  /**
   * Mark an endpoint as healthy again
   */
  markHealthy(url: string): void {
    const allEndpoints = [
      ...this.publicWriteEndpoints,
      ...(this.privateRelayEndpoint ? [this.privateRelayEndpoint] : []),
      ...this.readEndpoints
    ];

    for (const endpoint of allEndpoints) {
      if (endpoint.url === url) {
        endpoint.isHealthy = true;
        endpoint.lastError = undefined;
        endpoint.lastErrorTime = undefined;
        break;
      }
    }
  }

  /**
   * Get pool statistics
   */
  getStats(): {
    publicWrite: { total: number; healthy: number };
    privateRelay: { configured: boolean; healthy: boolean };
    read: { total: number; healthy: number };
  } {
    return {
      publicWrite: {
        total: this.publicWriteEndpoints.length,
        healthy: this.publicWriteEndpoints.filter(ep => ep.isHealthy).length
      },
      privateRelay: {
        configured: !!this.privateRelayEndpoint,
        healthy: this.privateRelayEndpoint?.isHealthy ?? false
      },
      read: {
        total: this.readEndpoints.length,
        healthy: this.readEndpoints.filter(ep => ep.isHealthy).length
      }
    };
  }

  /**
   * Mask sensitive parts of URL (API keys, credentials)
   */
  private maskUrl(url: string): string {
    try {
      const parsed = new URL(url);
      // Mask password if present
      if (parsed.password) {
        parsed.password = '***';
      }
      // Mask API keys in pathname or query
      let masked = parsed.toString();
      // Replace API key patterns in path (e.g., /api/abc123def -> /api/***)
      masked = masked.replace(/(\/api\/)[a-zA-Z0-9_-]+/g, '$1***');
      // Replace API key query params
      masked = masked.replace(/([?&])(apikey|api_key|key)=([^&]+)/gi, '$1$2=***');
      return masked;
    } catch {
      return url.substring(0, 20) + '...';
    }
  }
}

/**
 * Load ExecutionRpcPool from environment variables
 */
export function loadExecutionRpcPool(): ExecutionRpcPool {
  const config: ExecutionRpcConfig = {
    writeRpcs: process.env.WRITE_RPCS,
    primaryRpcUrl: process.env.RPC_URL,
    privateTxRpcUrl: process.env.PRIVATE_TX_RPC_URL,
    privateBundleRpc: process.env.PRIVATE_BUNDLE_RPC,
    executionReadRpcUrls: process.env.EXECUTION_READ_RPC_URLS
  };

  return new ExecutionRpcPool(config);
}
