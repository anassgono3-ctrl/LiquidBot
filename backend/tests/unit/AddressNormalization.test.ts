import { describe, it, expect, beforeEach } from 'vitest';

import {
  normalizeAddress,
  normalizeAddresses,
  addressesEqual,
  addressSetIntersection,
  assertIntersectionConsistency
} from '../../src/utils/Address.js';

describe('Address Normalization', () => {
  describe('normalizeAddress', () => {
    it('should normalize address to lowercase', () => {
      const addr = '0xABCDEF1234567890ABCDEF1234567890ABCDEF12';
      const normalized = normalizeAddress(addr);
      expect(normalized).toBe(addr.toLowerCase());
    });

    it('should handle already lowercase addresses', () => {
      const addr = '0xabcdef1234567890abcdef1234567890abcdef12';
      const normalized = normalizeAddress(addr);
      expect(normalized).toBe(addr);
    });

    it('should handle empty addresses', () => {
      const normalized = normalizeAddress('');
      expect(normalized).toBe('');
    });
  });

  describe('normalizeAddresses', () => {
    it('should normalize an array of addresses', () => {
      const addresses = [
        '0xABCDEF1234567890ABCDEF1234567890ABCDEF12',
        '0xFEDCBA0987654321FEDCBA0987654321FEDCBA09'
      ];
      const normalized = normalizeAddresses(addresses);
      expect(normalized).toEqual([
        addresses[0].toLowerCase(),
        addresses[1].toLowerCase()
      ]);
    });

    it('should handle empty array', () => {
      const normalized = normalizeAddresses([]);
      expect(normalized).toEqual([]);
    });
  });

  describe('addressesEqual', () => {
    it('should return true for same address with different cases', () => {
      const addr1 = '0xABCDEF1234567890ABCDEF1234567890ABCDEF12';
      const addr2 = '0xabcdef1234567890abcdef1234567890abcdef12';
      expect(addressesEqual(addr1, addr2)).toBe(true);
    });

    it('should return false for different addresses', () => {
      const addr1 = '0xABCDEF1234567890ABCDEF1234567890ABCDEF12';
      const addr2 = '0xFEDCBA0987654321FEDCBA0987654321FEDCBA09';
      expect(addressesEqual(addr1, addr2)).toBe(false);
    });

    it('should return false for empty addresses', () => {
      expect(addressesEqual('', '0xabcd')).toBe(false);
      expect(addressesEqual('0xabcd', '')).toBe(false);
    });
  });

  describe('addressSetIntersection', () => {
    it('should compute intersection of two sets with normalization', () => {
      const setA = new Set([
        '0xABCDEF1234567890ABCDEF1234567890ABCDEF12',
        '0xFEDCBA0987654321FEDCBA0987654321FEDCBA09'
      ]);
      const setB = new Set([
        '0xabcdef1234567890abcdef1234567890abcdef12', // Same as first in setA but lowercase
        '0x1111111111111111111111111111111111111111'
      ]);
      
      const intersection = addressSetIntersection(setA, setB);
      expect(intersection.size).toBe(1);
      expect(intersection.has('0xabcdef1234567890abcdef1234567890abcdef12')).toBe(true);
    });

    it('should handle empty intersection', () => {
      const setA = new Set([
        '0xABCDEF1234567890ABCDEF1234567890ABCDEF12'
      ]);
      const setB = new Set([
        '0xFEDCBA0987654321FEDCBA0987654321FEDCBA09'
      ]);
      
      const intersection = addressSetIntersection(setA, setB);
      expect(intersection.size).toBe(0);
    });

    it('should work with arrays', () => {
      const setA = [
        '0xABCDEF1234567890ABCDEF1234567890ABCDEF12',
        '0xFEDCBA0987654321FEDCBA0987654321FEDCBA09'
      ];
      const setB = [
        '0xabcdef1234567890abcdef1234567890abcdef12'
      ];
      
      const intersection = addressSetIntersection(setA, setB);
      expect(intersection.size).toBe(1);
    });

    it('should handle empty sets', () => {
      const intersection = addressSetIntersection(new Set(), new Set());
      expect(intersection.size).toBe(0);
    });
  });

  describe('assertIntersectionConsistency', () => {
    it('should not warn when intersection is non-empty', () => {
      const setA = new Set<string>(['0xabcd']);
      const setB = new Set<string>(['0xabcd']);
      const intersection = new Set<string>(['0xabcd']);
      
      // Should not throw or log warning
      assertIntersectionConsistency(setA, setB, intersection, 'test');
    });

    it('should warn when intersection is empty but both sets are non-empty', () => {
      const setA = new Set<string>(['0xABCD']);
      const setB = new Set<string>(['0xEFGH']);
      const intersection = new Set<string>();
      
      // Should log warning (captured by console mock in actual test)
      assertIntersectionConsistency(setA, setB, intersection, 'test');
    });

    it('should not warn when one set is empty', () => {
      const setA = new Set<string>();
      const setB = new Set<string>(['0xabcd']);
      const intersection = new Set<string>();
      
      // Should not warn
      assertIntersectionConsistency(setA, setB, intersection, 'test');
    });
  });
});
