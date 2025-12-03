// AaveDataService.providerFallback.test.ts - Tests for WS provider fallback to HTTP
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ethers } from 'ethers';

import { AaveDataService } from '../../src/services/AaveDataService.js';

describe('AaveDataService Provider Fallback', () => {
  let service: AaveDataService;
  
  beforeEach(() => {
    // Set RPC_URL environment variable for HTTP fallback
    process.env.RPC_URL = 'https://mainnet.base.org';
  });
  
  afterEach(() => {
    delete process.env.RPC_URL;
  });

  describe('isWsHealthy with HTTP provider', () => {
    it('should return false for HTTP-only provider', () => {
      const httpProvider = {
        getNetwork: vi.fn().mockResolvedValue({ chainId: 8453n }),
      } as unknown as ethers.JsonRpcProvider;
      
      const httpService = new AaveDataService(httpProvider);
      
      expect(httpService.isWsHealthy()).toBe(false);
    });
  });

  describe('Provider health tracking concept', () => {
    it('should expose isWsHealthy method', () => {
      const mockProvider = {
        getNetwork: vi.fn().mockResolvedValue({ chainId: 8453n }),
      } as unknown as ethers.JsonRpcProvider;
      
      service = new AaveDataService(mockProvider);
      
      // Method should exist
      expect(typeof service.isWsHealthy).toBe('function');
      
      // Should return boolean
      const result = service.isWsHealthy();
      expect(typeof result).toBe('boolean');
    });
  });

  describe('Dual provider setup (integration concept)', () => {
    it('should initialize service without errors when RPC_URL is set', () => {
      const mockProvider = {
        getNetwork: vi.fn().mockResolvedValue({ chainId: 8453n }),
      } as unknown as ethers.JsonRpcProvider;
      
      // Should not throw when initializing with HTTP fallback configured
      expect(() => {
        const testService = new AaveDataService(mockProvider);
        expect(testService.isInitialized()).toBe(true);
      }).not.toThrow();
    });

    it('should initialize service without errors when RPC_URL is not set', () => {
      delete process.env.RPC_URL;
      
      const mockProvider = {
        getNetwork: vi.fn().mockResolvedValue({ chainId: 8453n }),
      } as unknown as ethers.JsonRpcProvider;
      
      // Should not throw even without HTTP fallback
      expect(() => {
        const testService = new AaveDataService(mockProvider);
        expect(testService.isInitialized()).toBe(true);
      }).not.toThrow();
    });
  });

  describe('Service initialization', () => {
    it('should initialize with provider', () => {
      const mockProvider = {
        getNetwork: vi.fn().mockResolvedValue({ chainId: 8453n }),
      } as unknown as ethers.JsonRpcProvider;
      
      service = new AaveDataService(mockProvider);
      
      expect(service.isInitialized()).toBe(true);
    });

    it('should not initialize without provider', () => {
      service = new AaveDataService();
      
      expect(service.isInitialized()).toBe(false);
    });
  });
});
