/**
 * PythListener: Pyth Network price feed listener
 * 
 * Subscribes to Pyth Network WebSocket for real-time price updates
 * Provides early-warning price signals for predictive liquidation pipeline
 * 
 * Features:
 * - WebSocket subscription to Pyth Hermes
 * - Staleness detection
 * - Auto-reconnect on errors
 * - Price update callbacks
 */

import WebSocket from 'ws';
import { config } from '../config/index.js';
import {
  pythPriceUpdatesTotal,
  pythConnectionErrorsTotal,
  pythReconnectsTotal,
  recordPythPriceUpdate
} from '../metrics/preSubmitMetrics.js';

interface PythPriceUpdate {
  symbol: string;
  price: number;
  timestamp: number; // Unix timestamp in seconds
  confidence?: number;
  publishTime: number; // Pyth publish time
}

type PriceUpdateCallback = (update: PythPriceUpdate) => void;

/**
 * Pyth price feed IDs for common assets
 * These are Pyth's official price feed IDs
 */
const PYTH_PRICE_FEED_IDS: Record<string, string> = {
  // Base network price feeds
  'WETH': '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace', // ETH/USD
  'WBTC': '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43', // BTC/USD
  'cbETH': '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace', // Use ETH/USD as proxy
  'USDC': '0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a', // USDC/USD
  'cbBTC': '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43', // Use BTC/USD as proxy
  'AAVE': '0x2b9ab1e972a281585084148ba1389800799bd4be63b957507db1349314e47445', // AAVE/USD
};

export class PythListener {
  private ws: WebSocket | null = null;
  private callbacks: PriceUpdateCallback[] = [];
  private enabled: boolean;
  private wsUrl: string;
  private httpUrl: string;
  private assets: string[];
  private staleSecs: number;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelayMs = 5000;
  private isConnected = false;
  private shouldReconnect = true;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private lastMessageTime = 0;

  constructor() {
    this.enabled = config.pythEnabled;
    this.wsUrl = config.pythWsUrl;
    this.httpUrl = config.pythHttpUrl;
    this.assets = config.pythAssets;
    this.staleSecs = config.pythStaleSecs;

    if (this.enabled) {
      console.log(
        `[pyth-listener] Initialized: assets=${this.assets.join(',')}, staleSecs=${this.staleSecs}`
      );
    }
  }

  /**
   * Start listening to Pyth price updates
   */
  public async start(): Promise<void> {
    if (!this.enabled) {
      console.log('[pyth-listener] Disabled, skipping start');
      return;
    }

    if (this.isConnected) {
      console.warn('[pyth-listener] Already connected');
      return;
    }

    this.shouldReconnect = true;
    await this.connect();
  }

  /**
   * Stop listening and disconnect
   */
  public async stop(): Promise<void> {
    console.log('[pyth-listener] Stopping');
    this.shouldReconnect = false;
    
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.isConnected = false;
  }

  /**
   * Register callback for price updates
   */
  public onPriceUpdate(callback: PriceUpdateCallback): void {
    this.callbacks.push(callback);
  }

  /**
   * Connect to Pyth WebSocket
   */
  private async connect(): Promise<void> {
    try {
      console.log(`[pyth-listener] Connecting to ${this.wsUrl}`);
      
      this.ws = new WebSocket(this.wsUrl);

      this.ws.on('open', () => {
        console.log('[pyth-listener] Connected');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.lastMessageTime = Date.now();
        
        // Subscribe to price feeds
        this.subscribe();
        
        // Start heartbeat monitoring
        this.startHeartbeat();
      });

      this.ws.on('message', (data: WebSocket.RawData) => {
        this.handleMessage(data);
      });

      this.ws.on('error', (error) => {
        console.error('[pyth-listener] WebSocket error:', error);
        pythConnectionErrorsTotal.inc();
      });

      this.ws.on('close', () => {
        console.warn('[pyth-listener] Connection closed');
        this.isConnected = false;
        
        if (this.heartbeatInterval) {
          clearInterval(this.heartbeatInterval);
          this.heartbeatInterval = null;
        }

        // Attempt reconnect if enabled
        if (this.shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnect();
        }
      });
    } catch (error) {
      console.error('[pyth-listener] Connection error:', error);
      pythConnectionErrorsTotal.inc();
      
      if (this.shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnect();
      }
    }
  }

  /**
   * Subscribe to configured price feeds
   */
  private subscribe(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    // Get feed IDs for configured assets
    const feedIds: string[] = [];
    for (const symbol of this.assets) {
      const feedId = PYTH_PRICE_FEED_IDS[symbol.toUpperCase()];
      if (feedId) {
        feedIds.push(feedId);
      } else {
        console.warn(`[pyth-listener] No feed ID found for ${symbol}`);
      }
    }

    if (feedIds.length === 0) {
      console.warn('[pyth-listener] No valid feed IDs to subscribe to');
      return;
    }

    // Subscribe using Pyth's WebSocket protocol
    const subscribeMessage = {
      type: 'subscribe',
      ids: feedIds
    };

    this.ws.send(JSON.stringify(subscribeMessage));
    console.log(`[pyth-listener] Subscribed to ${feedIds.length} price feeds`);
  }

  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(data: WebSocket.RawData): void {
    this.lastMessageTime = Date.now();

    try {
      const message = JSON.parse(data.toString());

      // Handle price update messages
      if (message.type === 'price_update') {
        this.processPriceUpdate(message);
      }
    } catch (error) {
      console.error('[pyth-listener] Error parsing message:', error);
    }
  }

  /**
   * Process a price update from Pyth
   */
  private processPriceUpdate(message: any): void {
    try {
      const priceData = message.price_feed;
      if (!priceData) {
        return;
      }

      const feedId = priceData.id;
      const price = priceData.price;
      const publishTime = priceData.publish_time || Math.floor(Date.now() / 1000);

      if (!price || !price.price) {
        return;
      }

      // Find symbol for this feed ID
      const symbol = Object.entries(PYTH_PRICE_FEED_IDS).find(
        ([_, id]) => id === feedId
      )?.[0];

      if (!symbol) {
        return;
      }

      // Parse price (Pyth uses exponent notation)
      const priceValue = Number(price.price) * Math.pow(10, price.expo);
      const confidence = price.conf ? Number(price.conf) * Math.pow(10, price.expo) : undefined;

      // Check staleness
      const now = Math.floor(Date.now() / 1000);
      const ageSec = now - publishTime;
      const isStale = ageSec > this.staleSecs;

      // Record metrics
      recordPythPriceUpdate(symbol, ageSec, isStale);

      if (isStale) {
        console.warn(
          `[pyth-listener] STALE price for ${symbol}: age=${ageSec}s (threshold=${this.staleSecs}s)`
        );
      }

      // Create update object
      const update: PythPriceUpdate = {
        symbol,
        price: priceValue,
        timestamp: now,
        confidence,
        publishTime
      };

      // Notify callbacks
      this.notifyCallbacks(update);

      console.log(
        `[pyth-listener] Price update: ${symbol}=$${priceValue.toFixed(2)} (age: ${ageSec.toFixed(1)}s${isStale ? ' STALE' : ''})`
      );
    } catch (error) {
      console.error('[pyth-listener] Error processing price update:', error);
    }
  }

  /**
   * Notify all registered callbacks
   */
  private notifyCallbacks(update: PythPriceUpdate): void {
    for (const callback of this.callbacks) {
      try {
        callback(update);
      } catch (error) {
        console.error('[pyth-listener] Error in callback:', error);
      }
    }
  }

  /**
   * Start heartbeat monitoring
   */
  private startHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    // Check for message timeout every 30 seconds
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      const timeSinceLastMessage = now - this.lastMessageTime;

      // If no message in 2 minutes, reconnect
      if (timeSinceLastMessage > 120000) {
        console.warn(
          `[pyth-listener] No messages received for ${Math.floor(timeSinceLastMessage / 1000)}s, reconnecting`
        );
        this.ws?.close();
      }
    }, 30000);
  }

  /**
   * Attempt reconnection
   */
  private reconnect(): void {
    this.reconnectAttempts++;
    
    console.log(
      `[pyth-listener] Reconnecting (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`
    );
    
    pythReconnectsTotal.inc();

    // Exponential backoff
    const delay = this.reconnectDelayMs * Math.pow(2, this.reconnectAttempts - 1);
    
    setTimeout(() => {
      if (this.shouldReconnect) {
        this.connect();
      }
    }, Math.min(delay, 60000)); // Max 1 minute delay
  }

  /**
   * Check if listener is enabled
   */
  public isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Check if connected
   */
  public isConnectedStatus(): boolean {
    return this.isConnected;
  }

  /**
   * Get configured assets
   */
  public getAssets(): string[] {
    return this.assets;
  }
}
