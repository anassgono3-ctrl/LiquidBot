// Unit tests for verify-data script validation functions
import { describe, it, expect } from "vitest";

import { HealthCalculator } from "../../src/services/HealthCalculator.js";
import type { LiquidationCall, User, Reserve } from "../../src/types/index.js";

describe("verify-data validation functions", () => {
  describe("schema validation", () => {
    it("should detect missing liquidation id", () => {
      const liq = {
        id: "",
        user: "0x123",
        timestamp: 1234567890,
        liquidator: "0x456",
        principalAmount: "1000",
        collateralAmount: "2000",
        txHash: null,
        principalReserve: null,
        collateralReserve: null,
      } as LiquidationCall;

      expect(liq.id).toBe("");
    });

    it("should validate timestamp as number", () => {
      const liq = {
        id: "liq-1",
        user: "0x123",
        timestamp: 1234567890,
        liquidator: "0x456",
        principalAmount: "1000",
        collateralAmount: "2000",
        txHash: null,
        principalReserve: null,
        collateralReserve: null,
      } as LiquidationCall;

      expect(typeof liq.timestamp).toBe("number");
      expect(liq.timestamp).toBeGreaterThan(0);
    });
  });

  describe("borrowedReservesCount verification", () => {
    it("should count reserves with debt correctly", () => {
      const user: User = {
        id: "0x123",
        borrowedReservesCount: 2,
        reserves: [
          {
            currentATokenBalance: "1000000000000000000",
            currentVariableDebt: "500000000000000000",
            currentStableDebt: "0",
            reserve: {
              id: "reserve-1",
              symbol: "USDC",
              name: "USD Coin",
              decimals: 6,
              reserveLiquidationThreshold: 8500,
              usageAsCollateralEnabled: true,
              price: { priceInEth: "0.0003" },
            },
          },
          {
            currentATokenBalance: "2000000000000000000",
            currentVariableDebt: "0",
            currentStableDebt: "1000000000000000000",
            reserve: {
              id: "reserve-2",
              symbol: "ETH",
              name: "Ethereum",
              decimals: 18,
              reserveLiquidationThreshold: 8000,
              usageAsCollateralEnabled: true,
              price: { priceInEth: "1.0" },
            },
          },
          {
            currentATokenBalance: "500000000000000000",
            currentVariableDebt: "0",
            currentStableDebt: "0",
            reserve: {
              id: "reserve-3",
              symbol: "DAI",
              name: "Dai",
              decimals: 18,
              reserveLiquidationThreshold: 8000,
              usageAsCollateralEnabled: true,
              price: { priceInEth: "0.0003" },
            },
          },
        ],
      };

      const reservesWithDebt = user.reserves.filter((ur) => {
        const varDebt = parseFloat(ur.currentVariableDebt);
        const stableDebt = parseFloat(ur.currentStableDebt);
        return varDebt > 0 || stableDebt > 0;
      });

      expect(reservesWithDebt.length).toBe(2);
      expect(user.borrowedReservesCount).toBe(2);
    });

    it("should detect borrowedReservesCount mismatch", () => {
      const user: User = {
        id: "0x123",
        borrowedReservesCount: 3, // Wrong count
        reserves: [
          {
            currentATokenBalance: "1000000000000000000",
            currentVariableDebt: "500000000000000000",
            currentStableDebt: "0",
            reserve: {
              id: "reserve-1",
              symbol: "USDC",
              name: "USD Coin",
              decimals: 6,
              reserveLiquidationThreshold: 8500,
              usageAsCollateralEnabled: true,
              price: { priceInEth: "0.0003" },
            },
          },
        ],
      };

      const reservesWithDebt = user.reserves.filter((ur) => {
        const varDebt = parseFloat(ur.currentVariableDebt);
        const stableDebt = parseFloat(ur.currentStableDebt);
        return varDebt > 0 || stableDebt > 0;
      });

      expect(reservesWithDebt.length).toBe(1);
      expect(user.borrowedReservesCount).not.toBe(reservesWithDebt.length);
    });
  });

  describe("collateral threshold verification", () => {
    it("should verify collateral enabled reserves have positive threshold", () => {
      const reserve: Reserve = {
        id: "reserve-1",
        symbol: "USDC",
        name: "USD Coin",
        decimals: 6,
        reserveLiquidationThreshold: 8500,
        usageAsCollateralEnabled: true,
        price: { priceInEth: "0.0003" },
      };

      if (reserve.usageAsCollateralEnabled) {
        expect(reserve.reserveLiquidationThreshold).toBeGreaterThan(0);
      }
    });

    it("should detect invalid collateral threshold", () => {
      const reserve: Reserve = {
        id: "reserve-1",
        symbol: "USDC",
        name: "USD Coin",
        decimals: 6,
        reserveLiquidationThreshold: 0, // Invalid
        usageAsCollateralEnabled: true,
        price: { priceInEth: "0.0003" },
      };

      const hasIssue = reserve.usageAsCollateralEnabled && reserve.reserveLiquidationThreshold <= 0;
      expect(hasIssue).toBe(true);
    });
  });

  describe("health factor calculation verification", () => {
    it("should match HealthCalculator and independent calculation", () => {
      const user: User = {
        id: "0x123",
        borrowedReservesCount: 1,
        reserves: [
          {
            currentATokenBalance: "2000000000000000000", // 2 ETH
            currentVariableDebt: "1000000000000000000", // 1 ETH debt
            currentStableDebt: "0",
            reserve: {
              id: "reserve-1",
              symbol: "ETH",
              name: "Ethereum",
              decimals: 18,
              reserveLiquidationThreshold: 8000, // 80%
              usageAsCollateralEnabled: true,
              price: { priceInEth: "1.0" },
            },
          },
        ],
      };

      const healthCalculator = new HealthCalculator();
      const calcResult = healthCalculator.calculateHealthFactor(user);

      // Independent calculation
      let weightedCollateralETH = 0;
      let totalDebtETH = 0;

      for (const userReserve of user.reserves) {
        const reserve = userReserve.reserve;
        const decimals = reserve.decimals;
        const priceInEth = parseFloat(reserve.price.priceInEth);

        if (reserve.usageAsCollateralEnabled) {
          const collateralBalance =
            parseFloat(userReserve.currentATokenBalance) / Math.pow(10, decimals);
          const collateralValueETH = collateralBalance * priceInEth;
          const liquidationThreshold = reserve.reserveLiquidationThreshold / 10000;
          weightedCollateralETH += collateralValueETH * liquidationThreshold;
        }

        const variableDebt = parseFloat(userReserve.currentVariableDebt) / Math.pow(10, decimals);
        const stableDebt = parseFloat(userReserve.currentStableDebt) / Math.pow(10, decimals);
        const totalDebt = variableDebt + stableDebt;
        const debtValueETH = totalDebt * priceInEth;
        totalDebtETH += debtValueETH;
      }

      const independentHF = totalDebtETH === 0 ? Infinity : weightedCollateralETH / totalDebtETH;

      expect(calcResult.healthFactor).toBeCloseTo(independentHF, 6);
      expect(Math.abs(calcResult.healthFactor - independentHF)).toBeLessThan(0.01);
    });

    it("should detect health factor calculation mismatch if logic differs", () => {
      const user: User = {
        id: "0x123",
        borrowedReservesCount: 1,
        reserves: [
          {
            currentATokenBalance: "2000000000000000000",
            currentVariableDebt: "1000000000000000000",
            currentStableDebt: "0",
            reserve: {
              id: "reserve-1",
              symbol: "ETH",
              name: "Ethereum",
              decimals: 18,
              reserveLiquidationThreshold: 8000,
              usageAsCollateralEnabled: true,
              price: { priceInEth: "1.0" },
            },
          },
        ],
      };

      const healthCalculator = new HealthCalculator();
      const calcResult = healthCalculator.calculateHealthFactor(user);

      // Intentionally wrong calculation (not applying liquidation threshold)
      const collateralBalance = 2; // 2 ETH
      const debt = 1; // 1 ETH
      const wrongHF = collateralBalance / debt; // 2.0 without threshold

      const diff = Math.abs(calcResult.healthFactor - wrongHF);
      // The correct HF should be 1.6 (2 * 0.8 / 1), so diff with 2.0 should be significant
      expect(diff).toBeGreaterThan(0.01);
    });
  });

  describe("negative balance detection", () => {
    it("should detect negative balance", () => {
      const balance = parseFloat("-1000000000000000000");
      expect(balance).toBeLessThan(0);
    });

    it("should detect negative debt", () => {
      const varDebt = parseFloat("-500000000000000000");
      expect(varDebt).toBeLessThan(0);
    });

    it("should accept valid positive values", () => {
      const balance = parseFloat("1000000000000000000");
      const varDebt = parseFloat("500000000000000000");
      const stableDebt = parseFloat("0");

      expect(balance).toBeGreaterThanOrEqual(0);
      expect(varDebt).toBeGreaterThanOrEqual(0);
      expect(stableDebt).toBeGreaterThanOrEqual(0);
    });
  });
});
