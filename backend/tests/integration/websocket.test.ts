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

  it('should send welcome message on connection', async () => {
    const client = new WebSocket(`ws://localhost:${testPort}/ws`);

    await new Promise<void>((resolve, reject) => {
      client.on('message', (data) => {
        const message = JSON.parse(data.toString());
        
        expect(message.type).toBe('welcome');
        expect(message.message).toContain('LiquidBot');
        expect(message.timestamp).toBeTruthy();
        
        client.close();
        resolve();
      });

      client.on('error', (error) => {
        reject(error);
      });

      setTimeout(() => {
        client.close();
        reject(new Error('Timeout: No welcome message received'));
      }, 2000);
    });
  });

  it('should broadcast risk events to connected clients', async () => {
    const client = new WebSocket(`ws://localhost:${testPort}/ws`);

    await new Promise<void>((resolve, reject) => {
      let messageReceived = false;

      client.on('open', () => {
        // Broadcast a test risk event after connection
        setTimeout(() => {
          wss.broadcastRiskEvent({
            type: 'risk',
            user: '0x1234567890123456789012345678901234567890',
            healthFactor: 1.08,
            timestamp: new Date().toISOString(),
          });
        }, 100);
      });

      client.on('message', (data) => {
        const message = JSON.parse(data.toString());
        
        // Skip welcome message
        if (message.type === 'welcome') {
          return;
        }

        expect(message.type).toBe('risk');
        expect(message.user).toBeTruthy();
        expect(message.healthFactor).toBeGreaterThan(0);
        expect(message.timestamp).toBeTruthy();
        
        messageReceived = true;
        clearTimeout(timeoutId);
        client.close();
      });

      client.on('close', () => {
        if (messageReceived) {
          resolve();
        } else {
          reject(new Error('Connection closed before message received'));
        }
      });

      client.on('error', (error) => {
        clearTimeout(timeoutId);
        reject(error);
      });

      // Timeout after 5 seconds
      const timeoutId = setTimeout(() => {
        if (!messageReceived) {
          client.close();
          reject(new Error('Timeout: No message received'));
        }
      }, 5000);
    });
  });
});
