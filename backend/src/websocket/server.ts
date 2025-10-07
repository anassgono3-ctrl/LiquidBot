// WebSocket server for real-time alerts
import { Server } from 'http';

import { WebSocketServer, WebSocket } from 'ws';

import { config } from '../config/index.js';

export interface RiskEvent {
  type: 'risk';
  user: string;
  healthFactor: number;
  timestamp: string;
}

export interface LiquidationEvent {
  type: 'liquidation.new';
  liquidations: Array<{
    id: string;
    timestamp: number;
    user: string;
    liquidator: string;
  }>;
  timestamp: string;
}

export interface OpportunityEvent {
  type: 'opportunity.new';
  opportunities: Array<{
    id: string;
    user: string;
    profitEstimateUsd: number | null;
    healthFactor: number | null;
    timestamp: number;
  }>;
  timestamp: string;
}

export interface HealthBreachEvent {
  type: 'health.breach';
  user: string;
  healthFactor: number;
  threshold: number;
  timestamp: string;
}

/**
 * Initialize WebSocket server for real-time risk alerts
 */
export function initWebSocketServer(httpServer: Server) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws: WebSocket) => {
    console.log('WebSocket client connected');

    // Send welcome message
    ws.send(
      JSON.stringify({
        type: 'welcome',
        message: 'Connected to LiquidBot real-time risk alerts',
        timestamp: new Date().toISOString(),
      })
    );

    ws.on('message', (message: WebSocket.RawData) => {
      console.log('Received message:', message.toString());
    });

    ws.on('close', () => {
      console.log('WebSocket client disconnected');
    });
  });

  /**
   * Broadcast risk event to all connected clients
   */
  function broadcastRiskEvent(event: RiskEvent) {
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(event));
      }
    });
  }

  /**
   * Broadcast liquidation event to all connected clients
   */
  function broadcastLiquidationEvent(event: LiquidationEvent) {
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(event));
      }
    });
  }

  /**
   * Broadcast opportunity event to all connected clients
   */
  function broadcastOpportunityEvent(event: OpportunityEvent) {
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(event));
      }
    });
  }

  /**
   * Broadcast health breach event to all connected clients
   */
  function broadcastHealthBreachEvent(event: HealthBreachEvent) {
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(event));
      }
    });
  }

  /**
   * Stub: Simulate risk events for testing (broadcasts sample data)
   * In production, this would be triggered by the monitoring worker
   */
  function startMockRiskBroadcast() {
    setInterval(() => {
      if (wss.clients.size > 0) {
        const mockEvent: RiskEvent = {
          type: 'risk',
          user: `0x${Math.random().toString(16).substr(2, 40)}`,
          healthFactor: 1.05 + Math.random() * 0.05, // HF between 1.05 and 1.10
          timestamp: new Date().toISOString(),
        };
        broadcastRiskEvent(mockEvent);
      }
    }, 10000); // Every 10 seconds
  }

  // Start mock broadcast in development
  if (config.nodeEnv === 'development') {
    startMockRiskBroadcast();
  }

  return { 
    wss, 
    broadcastRiskEvent, 
    broadcastLiquidationEvent,
    broadcastOpportunityEvent,
    broadcastHealthBreachEvent
  };
}
