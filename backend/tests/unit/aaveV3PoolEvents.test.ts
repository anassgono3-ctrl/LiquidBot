import { describe, it, expect } from 'vitest';

import {
  eventRegistry,
  extractUserFromAaveEvent,
  extractReserveFromAaveEvent,
  extractAmountFromAaveEvent,
  formatDecodedEvent,
  aaveV3Interface,
  chainlinkInterface
} from '../../src/abi/aaveV3PoolEvents.js';

describe('aaveV3PoolEvents', () => {
  describe('EventRegistry', () => {
    it('should initialize with Aave V3 events', () => {
      const borrowTopic = aaveV3Interface.getEvent('Borrow')?.topicHash;
      const repayTopic = aaveV3Interface.getEvent('Repay')?.topicHash;
      const supplyTopic = aaveV3Interface.getEvent('Supply')?.topicHash;
      const withdrawTopic = aaveV3Interface.getEvent('Withdraw')?.topicHash;

      expect(borrowTopic).toBeDefined();
      expect(repayTopic).toBeDefined();
      expect(supplyTopic).toBeDefined();
      expect(withdrawTopic).toBeDefined();

      expect(eventRegistry.has(borrowTopic!)).toBe(true);
      expect(eventRegistry.has(repayTopic!)).toBe(true);
      expect(eventRegistry.has(supplyTopic!)).toBe(true);
      expect(eventRegistry.has(withdrawTopic!)).toBe(true);
    });

    it('should initialize with Chainlink events', () => {
      const answerUpdatedTopic = chainlinkInterface.getEvent('AnswerUpdated')?.topicHash;

      expect(answerUpdatedTopic).toBeDefined();
      expect(eventRegistry.has(answerUpdatedTopic!)).toBe(true);
    });

    it('should register LiquidationCall event', () => {
      const liquidationCallTopic = aaveV3Interface.getEvent('LiquidationCall')?.topicHash;

      expect(liquidationCallTopic).toBeDefined();
      expect(eventRegistry.has(liquidationCallTopic!)).toBe(true);
    });

    it('should register optional events (ReserveDataUpdated, FlashLoan)', () => {
      const reserveDataTopic = aaveV3Interface.getEvent('ReserveDataUpdated')?.topicHash;
      const flashLoanTopic = aaveV3Interface.getEvent('FlashLoan')?.topicHash;

      expect(reserveDataTopic).toBeDefined();
      expect(flashLoanTopic).toBeDefined();
      expect(eventRegistry.has(reserveDataTopic!)).toBe(true);
      expect(eventRegistry.has(flashLoanTopic!)).toBe(true);
    });

    it('should get event registry entry by topic0', () => {
      const borrowTopic = aaveV3Interface.getEvent('Borrow')?.topicHash;
      const entry = eventRegistry.get(borrowTopic!);

      expect(entry).toBeDefined();
      expect(entry?.name).toBe('Borrow');
      expect(entry?.decodeFn).toBeTypeOf('function');
    });

    it('should return undefined for unknown topic0', () => {
      const unknownTopic = '0x1234567890123456789012345678901234567890123456789012345678901234';
      const entry = eventRegistry.get(unknownTopic);

      expect(entry).toBeUndefined();
    });

    it('should list all registered topics', () => {
      const topics = eventRegistry.getAllTopics();

      expect(topics.length).toBeGreaterThan(0);
      expect(topics).toContain(aaveV3Interface.getEvent('Borrow')?.topicHash);
      expect(topics).toContain(aaveV3Interface.getEvent('Repay')?.topicHash);
    });
  });

  describe('Event Decoding', () => {
    it('should decode Borrow event', () => {
      // Create a mock Borrow event
      const reserve = '0x0000000000000000000000000000000000000001';
      const user = '0x0000000000000000000000000000000000000002';
      const onBehalfOf = '0x0000000000000000000000000000000000000003';
      const amount = 1000000n;
      const interestRateMode = 2;
      const borrowRate = 50000n;
      const referralCode = 0;

      const iface = aaveV3Interface;
      const fragment = iface.getEvent('Borrow');
      const data = iface.encodeEventLog(fragment!, [
        reserve,
        user,
        onBehalfOf,
        amount,
        interestRateMode,
        borrowRate,
        referralCode
      ]);

      const decoded = eventRegistry.decode(data.topics as string[], data.data);

      expect(decoded).toBeDefined();
      expect(decoded?.name).toBe('Borrow');
      expect(decoded?.args).toBeDefined();
    });

    it('should decode Repay event', () => {
      const reserve = '0x0000000000000000000000000000000000000001';
      const user = '0x0000000000000000000000000000000000000002';
      const repayer = '0x0000000000000000000000000000000000000003';
      const amount = 500000n;
      const useATokens = false;

      const iface = aaveV3Interface;
      const fragment = iface.getEvent('Repay');
      const data = iface.encodeEventLog(fragment!, [reserve, user, repayer, amount, useATokens]);

      const decoded = eventRegistry.decode(data.topics as string[], data.data);

      expect(decoded).toBeDefined();
      expect(decoded?.name).toBe('Repay');
      expect(decoded?.args).toBeDefined();
    });

    it('should decode Supply event', () => {
      const reserve = '0x0000000000000000000000000000000000000001';
      const user = '0x0000000000000000000000000000000000000002';
      const onBehalfOf = '0x0000000000000000000000000000000000000003';
      const amount = 2000000n;
      const referralCode = 0;

      const iface = aaveV3Interface;
      const fragment = iface.getEvent('Supply');
      const data = iface.encodeEventLog(fragment!, [reserve, user, onBehalfOf, amount, referralCode]);

      const decoded = eventRegistry.decode(data.topics as string[], data.data);

      expect(decoded).toBeDefined();
      expect(decoded?.name).toBe('Supply');
      expect(decoded?.args).toBeDefined();
    });

    it('should decode Withdraw event', () => {
      const reserve = '0x0000000000000000000000000000000000000001';
      const user = '0x0000000000000000000000000000000000000002';
      const to = '0x0000000000000000000000000000000000000003';
      const amount = 1500000n;

      const iface = aaveV3Interface;
      const fragment = iface.getEvent('Withdraw');
      const data = iface.encodeEventLog(fragment!, [reserve, user, to, amount]);

      const decoded = eventRegistry.decode(data.topics as string[], data.data);

      expect(decoded).toBeDefined();
      expect(decoded?.name).toBe('Withdraw');
      expect(decoded?.args).toBeDefined();
    });

    it('should decode LiquidationCall event', () => {
      const collateralAsset = '0x0000000000000000000000000000000000000001';
      const debtAsset = '0x0000000000000000000000000000000000000002';
      const user = '0x0000000000000000000000000000000000000003';
      const debtToCover = 1000000n;
      const liquidatedCollateralAmount = 1100000n;
      const liquidator = '0x0000000000000000000000000000000000000004';
      const receiveAToken = false;

      const iface = aaveV3Interface;
      const fragment = iface.getEvent('LiquidationCall');
      const data = iface.encodeEventLog(fragment!, [
        collateralAsset,
        debtAsset,
        user,
        debtToCover,
        liquidatedCollateralAmount,
        liquidator,
        receiveAToken
      ]);

      const decoded = eventRegistry.decode(data.topics as string[], data.data);

      expect(decoded).toBeDefined();
      expect(decoded?.name).toBe('LiquidationCall');
      expect(decoded?.args).toBeDefined();
    });

    it('should decode Chainlink AnswerUpdated event', () => {
      const current = 2000n * 10n ** 8n; // $2000 with 8 decimals
      const roundId = 12345n;
      const updatedAt = BigInt(Math.floor(Date.now() / 1000));

      const iface = chainlinkInterface;
      const fragment = iface.getEvent('AnswerUpdated');
      const data = iface.encodeEventLog(fragment!, [current, roundId, updatedAt]);

      const decoded = eventRegistry.decode(data.topics as string[], data.data);

      expect(decoded).toBeDefined();
      expect(decoded?.name).toBe('AnswerUpdated');
      expect(decoded?.args).toBeDefined();
    });

    it('should return null for invalid event data', () => {
      const invalidTopics = ['0x1234567890123456789012345678901234567890123456789012345678901234'];
      const invalidData = '0x';

      const decoded = eventRegistry.decode(invalidTopics, invalidData);

      expect(decoded).toBeNull();
    });
  });

  describe('extractUserFromAaveEvent', () => {
    it('should extract user from Borrow event', () => {
      const decoded = {
        name: 'Borrow',
        args: {
          user: '0xAbC123',
          onBehalfOf: '0xDeF456'
        },
        signature: ''
      };

      const users = extractUserFromAaveEvent(decoded);

      expect(users).toHaveLength(2);
      expect(users).toContain('0xabc123');
      expect(users).toContain('0xdef456');
    });

    it('should extract single user from Borrow when user and onBehalfOf are same', () => {
      const decoded = {
        name: 'Borrow',
        args: {
          user: '0xAbC123',
          onBehalfOf: '0xAbC123'
        },
        signature: ''
      };

      const users = extractUserFromAaveEvent(decoded);

      expect(users).toHaveLength(1);
      expect(users).toContain('0xabc123');
    });

    it('should extract user from Repay event', () => {
      const decoded = {
        name: 'Repay',
        args: {
          user: '0xAbC123',
          repayer: '0xDeF456'
        },
        signature: ''
      };

      const users = extractUserFromAaveEvent(decoded);

      expect(users).toHaveLength(2);
      expect(users).toContain('0xabc123');
      expect(users).toContain('0xdef456');
    });

    it('should extract user from Supply event', () => {
      const decoded = {
        name: 'Supply',
        args: {
          user: '0xAbC123',
          onBehalfOf: '0xDeF456'
        },
        signature: ''
      };

      const users = extractUserFromAaveEvent(decoded);

      expect(users).toHaveLength(2);
      expect(users).toContain('0xabc123');
      expect(users).toContain('0xdef456');
    });

    it('should extract user from Withdraw event', () => {
      const decoded = {
        name: 'Withdraw',
        args: {
          user: '0xAbC123'
        },
        signature: ''
      };

      const users = extractUserFromAaveEvent(decoded);

      expect(users).toHaveLength(1);
      expect(users).toContain('0xabc123');
    });

    it('should extract user from LiquidationCall event', () => {
      const decoded = {
        name: 'LiquidationCall',
        args: {
          user: '0xAbC123'
        },
        signature: ''
      };

      const users = extractUserFromAaveEvent(decoded);

      expect(users).toHaveLength(1);
      expect(users).toContain('0xabc123');
    });

    it('should return empty array for unknown event', () => {
      const decoded = {
        name: 'UnknownEvent',
        args: {},
        signature: ''
      };

      const users = extractUserFromAaveEvent(decoded);

      expect(users).toHaveLength(0);
    });
  });

  describe('extractReserveFromAaveEvent', () => {
    it('should extract reserve from Borrow event', () => {
      const decoded = {
        name: 'Borrow',
        args: {
          reserve: '0xAbC123'
        },
        signature: ''
      };

      const reserve = extractReserveFromAaveEvent(decoded);

      expect(reserve).toBe('0xabc123');
    });

    it('should extract reserve from Supply event', () => {
      const decoded = {
        name: 'Supply',
        args: {
          reserve: '0xDeF456'
        },
        signature: ''
      };

      const reserve = extractReserveFromAaveEvent(decoded);

      expect(reserve).toBe('0xdef456');
    });

    it('should extract asset from FlashLoan event', () => {
      const decoded = {
        name: 'FlashLoan',
        args: {
          asset: '0x123456'
        },
        signature: ''
      };

      const reserve = extractReserveFromAaveEvent(decoded);

      expect(reserve).toBe('0x123456');
    });

    it('should return null for event without reserve', () => {
      const decoded = {
        name: 'LiquidationCall',
        args: {},
        signature: ''
      };

      const reserve = extractReserveFromAaveEvent(decoded);

      expect(reserve).toBeNull();
    });
  });

  describe('extractAmountFromAaveEvent', () => {
    it('should extract amount from Borrow event', () => {
      const decoded = {
        name: 'Borrow',
        args: {
          amount: 1000000n
        },
        signature: ''
      };

      const amount = extractAmountFromAaveEvent(decoded);

      expect(amount).toBe(1000000n);
    });

    it('should return null for event without amount', () => {
      const decoded = {
        name: 'ReserveDataUpdated',
        args: {},
        signature: ''
      };

      const amount = extractAmountFromAaveEvent(decoded);

      expect(amount).toBeNull();
    });
  });

  describe('formatDecodedEvent', () => {
    it('should format Borrow event', () => {
      const decoded = {
        name: 'Borrow',
        args: {
          reserve: '0x123',
          user: '0x456',
          onBehalfOf: '0x789',
          amount: 1000000n
        },
        signature: ''
      };

      const formatted = formatDecodedEvent(decoded, 12345);

      expect(formatted).toContain('[Borrow]');
      expect(formatted).toContain('block=12345');
      expect(formatted).toContain('user=0x456');
      expect(formatted).toContain('onBehalfOf=0x789');
      expect(formatted).toContain('reserve=0x123');
      expect(formatted).toContain('amount=1000000');
    });

    it('should format LiquidationCall event', () => {
      const decoded = {
        name: 'LiquidationCall',
        args: {
          user: '0x123',
          liquidator: '0x456',
          collateralAsset: '0x789',
          debtAsset: '0xabc',
          debtToCover: 1000000n,
          liquidatedCollateralAmount: 1100000n
        },
        signature: ''
      };

      const formatted = formatDecodedEvent(decoded);

      expect(formatted).toContain('[LiquidationCall]');
      expect(formatted).toContain('user=0x123');
      expect(formatted).toContain('liquidator=0x456');
      expect(formatted).toContain('collateral=0x789');
      expect(formatted).toContain('debt=0xabc');
      expect(formatted).toContain('debtCovered=1000000');
      expect(formatted).toContain('collateralLiquidated=1100000');
    });

    it('should format AnswerUpdated event', () => {
      const decoded = {
        name: 'AnswerUpdated',
        args: {
          current: 2000n * 10n ** 8n,
          roundId: 12345n
        },
        signature: ''
      };

      const formatted = formatDecodedEvent(decoded);

      expect(formatted).toContain('[AnswerUpdated]');
      expect(formatted).toContain('current=200000000000');
      expect(formatted).toContain('roundId=12345');
    });
  });
});
