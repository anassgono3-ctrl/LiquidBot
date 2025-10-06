// Unit tests for SubscriptionService
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { SubscriptionService } from '../../src/services/SubscriptionService.js';

// Mock Prisma Client
vi.mock('@prisma/client', () => {
  const PrismaClient = vi.fn();
  return { PrismaClient };
});

describe('SubscriptionService', () => {
  let service: SubscriptionService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockPrisma: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock Prisma client
    mockPrisma = {
      user: {
        upsert: vi.fn(),
        findUnique: vi.fn(),
      },
      subscription: {
        create: vi.fn(),
        update: vi.fn(),
      },
      protectionLog: {
        create: vi.fn(),
        findMany: vi.fn(),
      },
      $disconnect: vi.fn(),
    };

    service = new SubscriptionService(mockPrisma);
  });

  describe('subscribe', () => {
    it('should create a new user and subscription', async () => {
      const mockUser = {
        id: 'user-123',
        address: '0x1234567890123456789012345678901234567890',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockSubscription = {
        id: 'sub-123',
        userId: 'user-123',
        tier: 'PREMIUM',
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        user: mockUser,
      };

      mockPrisma.user.upsert.mockResolvedValueOnce(mockUser);
      mockPrisma.subscription.create.mockResolvedValueOnce(mockSubscription);

      const result = await service.subscribe('0x1234567890123456789012345678901234567890', 'PREMIUM');

      expect(result.tier).toBe('PREMIUM');
      expect(result.active).toBe(true);
      expect(result.user.address).toBe('0x1234567890123456789012345678901234567890');
      expect(mockPrisma.user.upsert).toHaveBeenCalledWith({
        where: { address: '0x1234567890123456789012345678901234567890' },
        update: {},
        create: { address: '0x1234567890123456789012345678901234567890' },
      });
    });

    it('should create subscription for existing user', async () => {
      const mockUser = {
        id: 'user-456',
        address: '0xabcd',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockSubscription = {
        id: 'sub-456',
        userId: 'user-456',
        tier: 'BASIC',
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        user: mockUser,
      };

      mockPrisma.user.upsert.mockResolvedValueOnce(mockUser);
      mockPrisma.subscription.create.mockResolvedValueOnce(mockSubscription);

      const result = await service.subscribe('0xabcd', 'BASIC');

      expect(result.tier).toBe('BASIC');
      expect(mockPrisma.user.upsert).toHaveBeenCalled();
    });
  });

  describe('unsubscribe', () => {
    it('should deactivate an active subscription', async () => {
      const mockUser = {
        id: 'user-123',
        address: '0x1234',
        subscription: {
          id: 'sub-123',
          userId: 'user-123',
          tier: 'PREMIUM',
          active: true,
        },
      };

      mockPrisma.user.findUnique.mockResolvedValueOnce(mockUser);
      mockPrisma.subscription.update.mockResolvedValueOnce({
        ...mockUser.subscription,
        active: false,
      });

      await service.unsubscribe('0x1234');

      expect(mockPrisma.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-123' },
        data: { active: false },
      });
    });

    it('should throw error if user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);

      await expect(service.unsubscribe('0xnonexistent')).rejects.toThrow(
        'No active subscription found'
      );
    });

    it('should throw error if no active subscription', async () => {
      const mockUser = {
        id: 'user-123',
        address: '0x1234',
        subscription: null,
      };

      mockPrisma.user.findUnique.mockResolvedValueOnce(mockUser);

      await expect(service.unsubscribe('0x1234')).rejects.toThrow(
        'No active subscription found'
      );
    });
  });

  describe('getSubscription', () => {
    it('should return subscription for existing user', async () => {
      const mockSubscription = {
        id: 'sub-123',
        userId: 'user-123',
        tier: 'ENTERPRISE',
        active: true,
      };

      const mockUser = {
        id: 'user-123',
        address: '0x5678',
        subscription: mockSubscription,
      };

      mockPrisma.user.findUnique.mockResolvedValueOnce(mockUser);

      const result = await service.getSubscription('0x5678');

      expect(result).toEqual(mockSubscription);
      expect(result?.tier).toBe('ENTERPRISE');
    });

    it('should return null if user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);

      const result = await service.getSubscription('0xnonexistent');

      expect(result).toBeNull();
    });

    it('should return null if user has no subscription', async () => {
      const mockUser = {
        id: 'user-123',
        address: '0x1234',
        subscription: null,
      };

      mockPrisma.user.findUnique.mockResolvedValueOnce(mockUser);

      const result = await service.getSubscription('0x1234');

      expect(result).toBeNull();
    });
  });

  describe('logProtection', () => {
    it('should create a protection log for existing user', async () => {
      const mockUser = {
        id: 'user-123',
        address: '0x1234',
      };

      const mockLog = {
        id: 'log-123',
        userId: 'user-123',
        type: 'REFINANCE',
        feeBps: 15,
        txHash: '0xabc123',
        createdAt: new Date(),
      };

      mockPrisma.user.findUnique.mockResolvedValueOnce(mockUser);
      mockPrisma.protectionLog.create.mockResolvedValueOnce(mockLog);

      const result = await service.logProtection('0x1234', 'REFINANCE', 15, '0xabc123');

      expect(result.type).toBe('REFINANCE');
      expect(result.feeBps).toBe(15);
      expect(result.txHash).toBe('0xabc123');
      expect(mockPrisma.protectionLog.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-123',
          type: 'REFINANCE',
          feeBps: 15,
          txHash: '0xabc123',
        },
      });
    });

    it('should create log without txHash', async () => {
      const mockUser = {
        id: 'user-123',
        address: '0x1234',
      };

      const mockLog = {
        id: 'log-456',
        userId: 'user-123',
        type: 'EMERGENCY',
        feeBps: 50,
        txHash: null,
        createdAt: new Date(),
      };

      mockPrisma.user.findUnique.mockResolvedValueOnce(mockUser);
      mockPrisma.protectionLog.create.mockResolvedValueOnce(mockLog);

      const result = await service.logProtection('0x1234', 'EMERGENCY', 50);

      expect(result.type).toBe('EMERGENCY');
      expect(result.feeBps).toBe(50);
      expect(result.txHash).toBeNull();
    });

    it('should throw error if user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);

      await expect(service.logProtection('0xnonexistent', 'REFINANCE', 15)).rejects.toThrow(
        'User not found'
      );
    });
  });

  describe('getProtectionLogs', () => {
    it('should return protection logs for user', async () => {
      const mockUser = {
        id: 'user-123',
        address: '0x1234',
      };

      const mockLogs = [
        {
          id: 'log-1',
          userId: 'user-123',
          type: 'REFINANCE',
          feeBps: 15,
          txHash: '0xabc',
          createdAt: new Date(),
        },
        {
          id: 'log-2',
          userId: 'user-123',
          type: 'EMERGENCY',
          feeBps: 50,
          txHash: '0xdef',
          createdAt: new Date(),
        },
      ];

      mockPrisma.user.findUnique.mockResolvedValueOnce(mockUser);
      mockPrisma.protectionLog.findMany.mockResolvedValueOnce(mockLogs);

      const result = await service.getProtectionLogs('0x1234', 10);

      expect(result).toHaveLength(2);
      expect(result[0].type).toBe('REFINANCE');
      expect(result[1].type).toBe('EMERGENCY');
      expect(mockPrisma.protectionLog.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-123' },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });
    });

    it('should return empty array if user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);

      const result = await service.getProtectionLogs('0xnonexistent');

      expect(result).toEqual([]);
    });

    it('should use default limit of 100', async () => {
      const mockUser = {
        id: 'user-123',
        address: '0x1234',
      };

      mockPrisma.user.findUnique.mockResolvedValueOnce(mockUser);
      mockPrisma.protectionLog.findMany.mockResolvedValueOnce([]);

      await service.getProtectionLogs('0x1234');

      expect(mockPrisma.protectionLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 })
      );
    });
  });

  describe('disconnect', () => {
    it('should disconnect from Prisma', async () => {
      await service.disconnect();

      expect(mockPrisma.$disconnect).toHaveBeenCalled();
    });
  });
});
