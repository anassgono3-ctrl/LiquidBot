import { describe, it, expect, beforeEach } from 'vitest';

import { ExecutionRpcPool, type ExecutionRpcConfig } from '../../../src/execution/ExecutionRpcPool.js';

describe('ExecutionRpcPool', () => {
  let config: ExecutionRpcConfig;

  beforeEach(() => {
    config = {
      writeRpcs: 'https://rpc1.example.com,https://rpc2.example.com',
      primaryRpcUrl: 'https://primary.example.com',
      privateTxRpcUrl: 'https://private.example.com',
      executionReadRpcUrls: 'https://read1.example.com,https://read2.example.com'
    };
  });

  describe('initialization', () => {
    it('should parse public write endpoints from WRITE_RPCS', () => {
      const pool = new ExecutionRpcPool(config);
      const endpoints = pool.getPublicWriteEndpoints();
      
      expect(endpoints).toHaveLength(2);
      expect(endpoints[0].url).toBe('https://rpc1.example.com');
      expect(endpoints[1].url).toBe('https://rpc2.example.com');
    });

    it('should fall back to primaryRpcUrl when writeRpcs is empty', () => {
      const configWithoutWrite: ExecutionRpcConfig = {
        ...config,
        writeRpcs: ''
      };
      
      const pool = new ExecutionRpcPool(configWithoutWrite);
      const endpoints = pool.getPublicWriteEndpoints();
      
      expect(endpoints).toHaveLength(1);
      expect(endpoints[0].url).toBe('https://primary.example.com');
    });

    it('should initialize private relay endpoint when configured', () => {
      const pool = new ExecutionRpcPool(config);
      const endpoint = pool.getPrivateRelayEndpoint();
      
      expect(endpoint).toBeDefined();
      expect(endpoint?.url).toBe('https://private.example.com');
    });
  });

  describe('endpoint health management', () => {
    it('should mark endpoint as unhealthy', () => {
      const pool = new ExecutionRpcPool(config);
      const error = new Error('Connection timeout');
      
      pool.markUnhealthy('https://rpc1.example.com', error);
      
      const endpoints = pool.getPublicWriteEndpoints();
      expect(endpoints).toHaveLength(1);
      expect(endpoints[0].url).toBe('https://rpc2.example.com');
    });

    it('should mark endpoint as healthy again', () => {
      const pool = new ExecutionRpcPool(config);
      const error = new Error('Connection timeout');
      
      pool.markUnhealthy('https://rpc1.example.com', error);
      pool.markHealthy('https://rpc1.example.com');
      
      const endpoints = pool.getPublicWriteEndpoints();
      expect(endpoints).toHaveLength(2);
    });
  });

  describe('statistics', () => {
    it('should return accurate stats', () => {
      const pool = new ExecutionRpcPool(config);
      const stats = pool.getStats();
      
      expect(stats.publicWrite.total).toBe(2);
      expect(stats.publicWrite.healthy).toBe(2);
      expect(stats.privateRelay.configured).toBe(true);
      expect(stats.privateRelay.healthy).toBe(true);
      expect(stats.read.total).toBe(2);
      expect(stats.read.healthy).toBe(2);
    });
  });
});
