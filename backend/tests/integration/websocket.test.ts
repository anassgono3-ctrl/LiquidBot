// Integration tests for WebSocket server
import { createServer } from 'http';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';

import { initWebSocketServer } from '../../src/websocket/server.js';

describe('WebSocket Integration Tests', () => {
  let httpServer: ReturnType<typeof createServer>;
  let wss: ReturnType<typeof initWebSocketServer>;
  let testPort: number;

  beforeAll(async () => {
    httpServer = createServer();
    wss = initWebSocketServer(httpServer);
    testPort = 0; // Let OS assign a free port
    
    await new Promise<void>((resolve) => {
      httpServer.listen(testPort, () => {
        const address = httpServer.address();
        if (address && typeof address === 'object') {
          testPort = address.port;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      wss.wss.close(() => {
        httpServer.close(() => resolve());
      });
    });
  });

  it('should accept WebSocket connections', async () => {
    const client = new WebSocket(`ws://localhost:${testPort}/ws`);

    await new Promise<void>((resolve, reject) => {
      client.on('open', () => {
        expect(client.readyState).toBe(WebSocket.OPEN);
        client.close();
        resolve();
      });

      client.on('error', (error) => {
        reject(error);
      });
    });
  });

  it('should broadcast risk events to connected clients', async () => {
    const client = new WebSocket(`ws://localhost:${testPort}/ws`);

    await new Promise<void>((resolve, reject) => {
      let messageReceived = false;

      client.on('open', () => {
        // Broadcast a test risk event
        wss.broadcastRiskEvent({
          type: 'risk',
          user: '0x1234567890123456789012345678901234567890',
          healthFactor: 1.08,
          timestamp: new Date().toISOString(),
        });
      });

      client.on('message', (data) => {
        const message = JSON.parse(data.toString());
        
        expect(message.type).toBe('risk');
        expect(message.user).toBeTruthy();
        expect(message.healthFactor).toBeGreaterThan(0);
        expect(message.timestamp).toBeTruthy();
        
        messageReceived = true;
        client.close();
      });

      client.on('close', () => {
        if (messageReceived) {
          resolve();
        }
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        if (!messageReceived) {
          client.close();
          reject(new Error('Timeout: No message received'));
        }
      }, 5000);
    });
  });
});
