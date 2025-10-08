#!/usr/bin/env tsx
// verify-data.ts: Standalone verification script for data integrity and calculations
//
// This script validates the correctness and internal consistency of data pulled from
// the subgraph and the bot's calculations (health factor, pricing, profit estimation).
//
// Usage:
//   1. Verify last 10 liquidation calls (default):
//      node -r dotenv/config dist/scripts/verify-data.js --recent=10
//
//   2. Verify a specific user:
//      node -r dotenv/config dist/scripts/verify-data.js --user=0xabc... --verbose
//
//   3. Output JSON report file:
//      node -r dotenv/config dist/scripts/verify-data.js --recent=25 --out=verify-report.json
//
// Features / Checks:
// - Schema validation of liquidation fields (id, user, amounts, reserve symbols, decimals)
// - Fetch single-user reserves (getSingleUserWithDebt) and verify:
//   * borrowedReservesCount equals number of reserves with non-zero debt
//   * Each reserve with usageAsCollateralEnabled has reserveLiquidationThreshold > 0
//   * No negative balances or debts
// - Health Factor:
//   * Compute with existing HealthCalculator
//   * Independently recompute inline (manual loop) and compare absolute difference

import { writeFileSync } from "fs";

import { config } from "../src/config/index.js";
import { SubgraphService } from "../src/services/SubgraphService.js";
import { HealthCalculator } from "../src/services/HealthCalculator.js";
import type { LiquidationCall, User } from "../src/types/index.js";

interface VerificationIssue {
  type: string;
  severity: "error" | "warning" | "info";
  message: string;
  details?: unknown;
}

type HFClassification = "NO_DEBT" | "DUST_DEBT" | "HUGE" | "MISMATCH" | "OK";

interface HFDetail {
  user: string;
  healthFactor: number | null;
  classification: HFClassification;
  totalCollateralETH: number;
  totalDebtETH: number;
  weightedCollateralETH: number;
  recomputedHF: number | null;
  hfDiff: number | null;
  reason?: string;
}

interface LiquidationVerification {
  liquidationId: string;
  user: string;
  timestamp: number;
  schemaValid: boolean;
  userDataFetched: boolean;
  issues: VerificationIssue[];
  healthFactorCheck?: {
    calculatorHF: number;
    independentHF: number;
    diff: number;
    isConsistent: boolean;
  };
  borrowedReservesCheck?: {
    reported: number;
    actual: number;
    matches: boolean;
    mismatchList?: string[];
  };
  hfDetail?: HFDetail;
}

interface VerificationReport {
  timestamp: string;
  totalLiquidations: number;
  verifiedCount: number;
  errorCount: number;
  warningCount: number;
  liquidations: LiquidationVerification[];
  summary?: {
    hfOk: number;
    hfNull: number;
    hfDust: number;
    hfHuge: number;
    hfMismatch: number;
  };
  hfDetails?: HFDetail[];
}

// Parse command line arguments
function parseArgs(): {
  recent?: number;
  user?: string;
  verbose: boolean;
  out?: string;
  help: boolean;
  showHf: boolean;
  quiet: boolean;
  jsonHf: boolean;
  hfEpsilon: number;
  dustEpsilon: number;
} {
  const args = process.argv.slice(2);
  let recent: number | undefined;
  let user: string | undefined;
  let verbose = false;
  let out: string | undefined;
  let help = false;
  let showHf = false;
  let quiet = false;
  let jsonHf = false;
  let hfEpsilon = 1e-9;
  let dustEpsilon = 1e-9;

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg.startsWith("--recent=")) {
      recent = parseInt(arg.split("=")[1], 10);
    } else if (arg.startsWith("--user=")) {
      user = arg.split("=")[1];
    } else if (arg === "--verbose") {
      verbose = true;
    } else if (arg.startsWith("--out=")) {
      out = arg.split("=")[1];
    } else if (arg === "--show-hf") {
      showHf = true;
    } else if (arg === "--quiet") {
      quiet = true;
    } else if (arg === "--json-hf") {
      jsonHf = true;
    } else if (arg.startsWith("--hf-epsilon=")) {
      hfEpsilon = parseFloat(arg.split("=")[1]);
    } else if (arg.startsWith("--dust-epsilon=")) {
      dustEpsilon = parseFloat(arg.split("=")[1]);
    }
  }

  // Default to 10 recent liquidations if neither recent nor user specified
  if (recent === undefined && user === undefined && !help) {
    recent = 10;
  }

  return { recent, user, verbose, out, help, showHf, quiet, jsonHf, hfEpsilon, dustEpsilon };
}

function printHelp(): void {
  console.log(`
verify-data: Data Verification Script for LiquidBot

Usage:
  node -r dotenv/config dist/scripts/verify-data.js [options]

Options:
  --recent=<N>           Verify last N liquidation calls (default: 10)
  --user=<address>       Verify a specific user by address
  --verbose              Enable verbose output with detailed checks
  --out=<file>           Output JSON report to file
  --show-hf              Force per-user HF detail output (even if not verbose)
  --quiet                Suppress standard per-liquidation ID lines; only show HF when --show-hf or mismatches
  --json-hf              Include hfDetails array in JSON output (requires --out)
  --hf-epsilon=<float>   HF comparison tolerance (default: 1e-9)
  --dust-epsilon=<float> Dust debt threshold in ETH (default: 1e-9)
  --help, -h             Show this help message

Examples:
  # Verify last 10 liquidations (default)
  node -r dotenv/config dist/scripts/verify-data.js

  # Verify last 25 liquidations
  node -r dotenv/config dist/scripts/verify-data.js --recent=25

  # Show HF details for recent liquidations
  node -r dotenv/config dist/scripts/verify-data.js --recent=5 --show-hf

  # Quiet mode with HF details only
  node -r dotenv/config dist/scripts/verify-data.js --recent=10 --quiet --show-hf

  # Generate JSON report with full HF details
  node -r dotenv/config dist/scripts/verify-data.js --recent=25 --out=report.json --json-hf

  # Verify specific user with verbose output
  node -r dotenv/config dist/scripts/verify-data.js --user=0xabc... --verbose

Checks Performed:
  - Liquidation call schema validation
  - User reserve data consistency (borrowedReservesCount, collateral thresholds)
  - Health factor calculation verification (independent recomputation)
  - Health factor classification (NO_DEBT, DUST_DEBT, HUGE, MISMATCH, OK)
  - Negative balance/debt detection

HF Classifications:
  NO_DEBT    - User has zero debt (HF = Infinity)
  DUST_DEBT  - Debt is below dust-epsilon threshold
  HUGE       - HF > 10000 (effectively no risk)
  MISMATCH   - |primary HF - recomputed HF| > hf-epsilon
  OK         - Normal HF with consistent calculations
`);
}

// Validate liquidation call schema
function validateLiquidationSchema(liq: LiquidationCall): VerificationIssue[] {
  const issues: VerificationIssue[] = [];

  if (!liq.id || typeof liq.id !== "string") {
    issues.push({
      type: "schema",
      severity: "error",
      message: "Missing or invalid liquidation id",
    });
  }

  if (!liq.user || typeof liq.user !== "string") {
    issues.push({
      type: "schema",
      severity: "error",
      message: "Missing or invalid user address",
    });
  }

  if (typeof liq.timestamp !== "number" || liq.timestamp <= 0) {
    issues.push({
      type: "schema",
      severity: "error",
      message: "Invalid timestamp (must be positive number)",
      details: { timestamp: liq.timestamp },
    });
  }

  if (!liq.principalAmount || typeof liq.principalAmount !== "string") {
    issues.push({
      type: "schema",
      severity: "error",
      message: "Missing or invalid principalAmount",
    });
  }

  if (!liq.collateralAmount || typeof liq.collateralAmount !== "string") {
    issues.push({
      type: "schema",
      severity: "error",
      message: "Missing or invalid collateralAmount",
    });
  }

  // Verify reserve decimals are numeric if present
  if (liq.principalReserve && liq.principalReserve.decimals !== null) {
    if (typeof liq.principalReserve.decimals !== "number" || liq.principalReserve.decimals < 0) {
      issues.push({
        type: "schema",
        severity: "error",
        message: "Invalid principalReserve decimals (must be non-negative number)",
        details: { decimals: liq.principalReserve.decimals },
      });
    }
  }

  if (liq.collateralReserve && liq.collateralReserve.decimals !== null) {
    if (typeof liq.collateralReserve.decimals !== "number" || liq.collateralReserve.decimals < 0) {
      issues.push({
        type: "schema",
        severity: "error",
        message: "Invalid collateralReserve decimals (must be non-negative number)",
        details: { decimals: liq.collateralReserve.decimals },
      });
    }
  }

  return issues;
}

// Verify user reserve data consistency
function verifyUserReserves(user: User): VerificationIssue[] {
  const issues: VerificationIssue[] = [];

  // Count reserves with actual debt
  const reservesWithDebt = user.reserves.filter((ur) => {
    const varDebt = parseFloat(ur.currentVariableDebt);
    const stableDebt = parseFloat(ur.currentStableDebt);
    return varDebt > 0 || stableDebt > 0;
  });

  // Check if borrowedReservesCount matches actual debt count
  if (user.borrowedReservesCount !== reservesWithDebt.length) {
    const mismatchList = reservesWithDebt.map((ur) => ur.reserve.symbol);
    issues.push({
      type: "borrowedReservesCount",
      severity: "warning",
      message: `borrowedReservesCount mismatch: reported=${user.borrowedReservesCount}, actual=${reservesWithDebt.length}`,
      details: { mismatchList },
    });
  }

  // Check collateral threshold consistency
  for (const ur of user.reserves) {
    if (ur.reserve.usageAsCollateralEnabled) {
      if (ur.reserve.reserveLiquidationThreshold <= 0) {
        issues.push({
          type: "collateralThreshold",
          severity: "error",
          message: `Reserve ${ur.reserve.symbol} has usageAsCollateralEnabled but reserveLiquidationThreshold <= 0`,
          details: {
            symbol: ur.reserve.symbol,
            threshold: ur.reserve.reserveLiquidationThreshold,
          },
        });
      }
    }
  }

  // Check for negative balances or debts
  for (const ur of user.reserves) {
    const balance = parseFloat(ur.currentATokenBalance);
    const varDebt = parseFloat(ur.currentVariableDebt);
    const stableDebt = parseFloat(ur.currentStableDebt);

    if (balance < 0) {
      issues.push({
        type: "negativeBalance",
        severity: "error",
        message: `Negative aToken balance for ${ur.reserve.symbol}`,
        details: { symbol: ur.reserve.symbol, balance },
      });
    }

    if (varDebt < 0) {
      issues.push({
        type: "negativeDebt",
        severity: "error",
        message: `Negative variable debt for ${ur.reserve.symbol}`,
        details: { symbol: ur.reserve.symbol, varDebt },
      });
    }

    if (stableDebt < 0) {
      issues.push({
        type: "negativeDebt",
        severity: "error",
        message: `Negative stable debt for ${ur.reserve.symbol}`,
        details: { symbol: ur.reserve.symbol, stableDebt },
      });
    }
  }

  return issues;
}

// Calculate health factor independently (manual recomputation)
function calculateHealthFactorIndependent(user: User): number {
  let weightedCollateralETH = 0;
  let totalDebtETH = 0;

  for (const userReserve of user.reserves) {
    const reserve = userReserve.reserve;
    const decimals = reserve.decimals;
    const priceInEth = parseFloat(reserve.price.priceInEth);

    // Calculate collateral value in ETH
    if (reserve.usageAsCollateralEnabled) {
      const collateralBalance =
        parseFloat(userReserve.currentATokenBalance) / Math.pow(10, decimals);
      const collateralValueETH = collateralBalance * priceInEth;

      // Apply liquidation threshold (basis points to decimal)
      const liquidationThreshold = reserve.reserveLiquidationThreshold / 10000;
      weightedCollateralETH += collateralValueETH * liquidationThreshold;
    }

    // Calculate debt value in ETH
    const variableDebt = parseFloat(userReserve.currentVariableDebt) / Math.pow(10, decimals);
    const stableDebt = parseFloat(userReserve.currentStableDebt) / Math.pow(10, decimals);
    const totalDebt = variableDebt + stableDebt;
    const debtValueETH = totalDebt * priceInEth;
    totalDebtETH += debtValueETH;
  }

  // Handle zero debt case
  if (totalDebtETH === 0) {
    return Infinity;
  }

  return weightedCollateralETH / totalDebtETH;
}

// Compute detailed HF with classification
function computeHFDetail(
  user: User,
  healthCalculator: HealthCalculator,
  hfEpsilon: number,
  dustEpsilon: number,
): HFDetail {
  // Calculate using HealthCalculator
  const calcResult = healthCalculator.calculateHealthFactor(user);
  let totalCollateralETH = 0;
  let weightedCollateralETH = 0;
  let totalDebtETH = 0;

  // Independent recomputation with detailed tracking
  for (const userReserve of user.reserves) {
    const reserve = userReserve.reserve;
    const decimals = reserve.decimals;
    const priceInEth = parseFloat(reserve.price.priceInEth);

    // Calculate collateral value in ETH
    if (reserve.usageAsCollateralEnabled) {
      const collateralBalance =
        parseFloat(userReserve.currentATokenBalance) / Math.pow(10, decimals);
      const collateralValueETH = collateralBalance * priceInEth;
      totalCollateralETH += collateralValueETH;

      // Apply liquidation threshold (basis points to decimal)
      const liquidationThreshold = reserve.reserveLiquidationThreshold / 10000;
      weightedCollateralETH += collateralValueETH * liquidationThreshold;
    }

    // Calculate debt value in ETH
    const variableDebt = parseFloat(userReserve.currentVariableDebt) / Math.pow(10, decimals);
    const stableDebt = parseFloat(userReserve.currentStableDebt) / Math.pow(10, decimals);
    const totalDebt = variableDebt + stableDebt;
    const debtValueETH = totalDebt * priceInEth;
    totalDebtETH += debtValueETH;
  }

  // Determine classification
  let classification: HFClassification;
  let healthFactor: number | null;
  let recomputedHF: number | null;
  let hfDiff: number | null = null;
  let reason: string | undefined;

  // Handle special cases
  if (totalDebtETH === 0) {
    classification = "NO_DEBT";
    healthFactor = null;
    recomputedHF = null;
    reason = "Zero debt";
  } else if (totalDebtETH > 0 && totalDebtETH < dustEpsilon) {
    classification = "DUST_DEBT";
    healthFactor = calcResult.healthFactor === Infinity ? null : calcResult.healthFactor;
    recomputedHF = weightedCollateralETH / totalDebtETH;
    reason = `Debt ${totalDebtETH.toExponential(2)} ETH < dust threshold`;
  } else {
    // Normal case - compute HF
    const primaryHF = calcResult.healthFactor;
    recomputedHF = weightedCollateralETH / totalDebtETH;

    // Guard against Infinity/undefined
    if (!isFinite(primaryHF) || primaryHF === undefined) {
      healthFactor = null;
      classification = "MISMATCH";
      reason = "Primary HF is not finite";
    } else if (!isFinite(recomputedHF) || recomputedHF === undefined) {
      healthFactor = primaryHF;
      recomputedHF = null;
      classification = "MISMATCH";
      reason = "Recomputed HF is not finite";
    } else {
      healthFactor = primaryHF;
      hfDiff = Math.abs(primaryHF - recomputedHF);

      if (hfDiff > hfEpsilon) {
        classification = "MISMATCH";
        reason = `HF diff ${hfDiff.toExponential(2)} > epsilon`;
      } else if (healthFactor > 10000) {
        classification = "HUGE";
        reason = "HF > 10000";
      } else {
        classification = "OK";
      }
    }
  }

  return {
    user: user.id,
    healthFactor,
    classification,
    totalCollateralETH,
    totalDebtETH,
    weightedCollateralETH,
    recomputedHF,
    hfDiff,
    reason,
  };
}

// Format and print HF detail line
function printHFDetail(hfDetail: HFDetail): void {
  const hfStr = hfDetail.healthFactor !== null ? hfDetail.healthFactor.toFixed(4) : "null";
  const collateralStr = hfDetail.totalCollateralETH.toExponential(4);
  const debtStr = hfDetail.totalDebtETH.toExponential(4);
  const weightedStr = hfDetail.weightedCollateralETH.toExponential(4);
  const diffStr = hfDetail.hfDiff !== null ? hfDetail.hfDiff.toExponential(2) : "-";
  const reasonStr = hfDetail.reason ? ` reason="${hfDetail.reason}"` : "";

  console.log(
    `  - HF: ${hfStr} classification=${hfDetail.classification} collateralETH=${collateralStr} debtETH=${debtStr} weightedCollateral=${weightedStr} diff=${diffStr}${reasonStr}`,
  );
}

// Verify health factor calculation
function verifyHealthFactor(user: User, healthCalculator: HealthCalculator): VerificationIssue[] {
  const issues: VerificationIssue[] = [];

  const calcResult = healthCalculator.calculateHealthFactor(user);
  const independentHF = calculateHealthFactorIndependent(user);

  const calculatorHF = calcResult.healthFactor;

  // Compare the two calculations
  if (isFinite(calculatorHF) && isFinite(independentHF)) {
    const diff = Math.abs(calculatorHF - independentHF);
    const tolerance = 0.01; // 1% tolerance

    if (diff > tolerance) {
      issues.push({
        type: "healthFactorMismatch",
        severity: "error",
        message: `Health factor mismatch: calculator=${calculatorHF.toFixed(4)}, independent=${independentHF.toFixed(4)}, diff=${diff.toFixed(4)}`,
        details: { calculatorHF, independentHF, diff },
      });
    }
  } else if (calculatorHF !== independentHF) {
    // Both should be Infinity if one is
    issues.push({
      type: "healthFactorMismatch",
      severity: "error",
      message: `Health factor infinity mismatch: calculator=${calculatorHF}, independent=${independentHF}`,
      details: { calculatorHF, independentHF },
    });
  }

  return issues;
}

async function main() {
  const { recent, user, verbose, out, help, showHf, quiet, jsonHf, hfEpsilon, dustEpsilon } = parseArgs();

  if (help) {
    printHelp();
    process.exit(0);
  }

  console.log("[verify-data] Starting data verification...");
  if (recent) {
    console.log(`[verify-data] Mode: Verify last ${recent} liquidations`);
  } else if (user) {
    console.log(`[verify-data] Mode: Verify specific user ${user}`);
  }
  console.log(`[verify-data] Verbose: ${verbose}`);
  if (showHf) {
    console.log("[verify-data] Show HF: enabled");
  }
  if (quiet) {
    console.log("[verify-data] Quiet mode: enabled");
  }
  if (out) {
    console.log(`[verify-data] Output file: ${out}`);
    if (jsonHf) {
      console.log("[verify-data] JSON HF details: enabled");
    }
  }
  console.log(`[verify-data] HF epsilon: ${hfEpsilon}, Dust epsilon: ${dustEpsilon}`);


  // Initialize services
  if (config.useMockSubgraph) {
    console.error("[verify-data] Cannot run with USE_MOCK_SUBGRAPH=true");
    process.exit(1);
  }

  const subgraphService = new SubgraphService();
  const healthCalculator = new HealthCalculator();

  const report: VerificationReport = {
    timestamp: new Date().toISOString(),
    totalLiquidations: 0,
    verifiedCount: 0,
    errorCount: 0,
    warningCount: 0,
    liquidations: [],
    summary: {
      hfOk: 0,
      hfNull: 0,
      hfDust: 0,
      hfHuge: 0,
      hfMismatch: 0,
    },
  };

  const hfDetailsArray: HFDetail[] = [];

  let liquidationsToVerify: LiquidationCall[] = [];

  // Fetch liquidations
  if (user) {
    // For specific user, fetch recent liquidations and filter
    console.log("[verify-data] Fetching recent liquidations to find user...");
    const allLiquidations = await subgraphService.getLiquidationCalls(100);
    liquidationsToVerify = allLiquidations.filter(
      (l) => l.user.toLowerCase() === user.toLowerCase(),
    );

    if (liquidationsToVerify.length === 0) {
      console.log(`[verify-data] No liquidations found for user ${user}`);
      // Still verify the user's current state if we can fetch it
      try {
        const userData = await subgraphService.getSingleUserWithDebt(user);
        if (userData) {
          console.log(`[verify-data] Verifying user ${user} current state...`);

          const verification: LiquidationVerification = {
            liquidationId: "N/A",
            user: user,
            timestamp: Date.now(),
            schemaValid: true,
            userDataFetched: true,
            issues: [],
          };

          // Verify user reserves
          const reserveIssues = verifyUserReserves(userData);
          verification.issues.push(...reserveIssues);

          // Verify health factor
          const hfIssues = verifyHealthFactor(userData, healthCalculator);
          verification.issues.push(...hfIssues);

          const calcResult = healthCalculator.calculateHealthFactor(userData);
          const independentHF = calculateHealthFactorIndependent(userData);

          if (isFinite(calcResult.healthFactor) && isFinite(independentHF)) {
            verification.healthFactorCheck = {
              calculatorHF: calcResult.healthFactor,
              independentHF: independentHF,
              diff: Math.abs(calcResult.healthFactor - independentHF),
              isConsistent: Math.abs(calcResult.healthFactor - independentHF) <= 0.01,
            };
          }

          // Compute HF detail with classification
          const hfDetail = computeHFDetail(userData, healthCalculator, hfEpsilon, dustEpsilon);
          verification.hfDetail = hfDetail;
          hfDetailsArray.push(hfDetail);

          // Update HF summary counters
          if (hfDetail.classification === "NO_DEBT") {
            report.summary!.hfNull++;
          } else if (hfDetail.classification === "DUST_DEBT") {
            report.summary!.hfDust++;
          } else if (hfDetail.classification === "HUGE") {
            report.summary!.hfHuge++;
          } else if (hfDetail.classification === "MISMATCH") {
            report.summary!.hfMismatch++;
          } else {
            report.summary!.hfOk++;
          }

          // Check borrowedReservesCount
          const reservesWithDebt = userData.reserves.filter((ur) => {
            const varDebt = parseFloat(ur.currentVariableDebt);
            const stableDebt = parseFloat(ur.currentStableDebt);
            return varDebt > 0 || stableDebt > 0;
          });

          verification.borrowedReservesCheck = {
            reported: userData.borrowedReservesCount,
            actual: reservesWithDebt.length,
            matches: userData.borrowedReservesCount === reservesWithDebt.length,
          };

          if (!verification.borrowedReservesCheck.matches) {
            verification.borrowedReservesCheck.mismatchList = reservesWithDebt.map(
              (ur) => ur.reserve.symbol,
            );
          }

          report.liquidations.push(verification);
          report.totalLiquidations = 1;
          report.verifiedCount = 1;

          const errorCount = verification.issues.filter((i) => i.severity === "error").length;
          const warningCount = verification.issues.filter((i) => i.severity === "warning").length;
          report.errorCount = errorCount;
          report.warningCount = warningCount;

          if (verbose) {
            console.log(`[verify-data] User ${user}:`);
            console.log(
              `  - Borrowed reserves: ${verification.borrowedReservesCheck.reported} (actual: ${verification.borrowedReservesCheck.actual})`,
            );
            if (verification.healthFactorCheck) {
              console.log(
                `  - Health factor: ${verification.healthFactorCheck.calculatorHF.toFixed(4)} (independent: ${verification.healthFactorCheck.independentHF.toFixed(4)})`,
              );
            }
            if (verification.issues.length > 0) {
              console.log(`  - Issues: ${verification.issues.length}`);
              for (const issue of verification.issues) {
                console.log(`    [${issue.severity}] ${issue.type}: ${issue.message}`);
              }
            } else {
              console.log("  - No issues found");
            }
          }

          // Print HF detail if requested
          if (showHf || verbose) {
            printHFDetail(hfDetail);
          }
        } else {
          console.log(`[verify-data] User ${user} not found in subgraph`);
        }
      } catch (err) {
        console.error(`[verify-data] Error fetching user ${user}:`, err);
      }
    } else {
      console.log(
        `[verify-data] Found ${liquidationsToVerify.length} liquidations for user ${user}`,
      );
    }
  } else if (recent) {
    console.log(`[verify-data] Fetching ${recent} recent liquidations...`);
    liquidationsToVerify = await subgraphService.getLiquidationCalls(recent);
    console.log(`[verify-data] Found ${liquidationsToVerify.length} liquidations`);
  }

  report.totalLiquidations = liquidationsToVerify.length;

  // Verify each liquidation
  for (let i = 0; i < liquidationsToVerify.length; i++) {
    const liq = liquidationsToVerify[i];

    if (!quiet) {
      if (verbose) {
        console.log(
          `[verify-data] [${i + 1}/${liquidationsToVerify.length}] Verifying liquidation ${liq.id}...`,
        );
      } else {
        console.log(`[verify-data] [${i + 1}/${liquidationsToVerify.length}] ${liq.id}`);
      }
    }

    const verification: LiquidationVerification = {
      liquidationId: liq.id,
      user: liq.user,
      timestamp: liq.timestamp,
      schemaValid: true,
      userDataFetched: false,
      issues: [],
    };

    // 1. Validate liquidation schema
    const schemaIssues = validateLiquidationSchema(liq);
    verification.issues.push(...schemaIssues);
    if (schemaIssues.some((i) => i.severity === "error")) {
      verification.schemaValid = false;
    }

    // 2. Fetch user data and verify
    try {
      const userData = await subgraphService.getSingleUserWithDebt(liq.user);

      if (userData) {
        verification.userDataFetched = true;

        // Verify user reserves
        const reserveIssues = verifyUserReserves(userData);
        verification.issues.push(...reserveIssues);

        // Verify health factor
        const hfIssues = verifyHealthFactor(userData, healthCalculator);
        verification.issues.push(...hfIssues);

        // Store health factor comparison
        const calcResult = healthCalculator.calculateHealthFactor(userData);
        const independentHF = calculateHealthFactorIndependent(userData);

        if (isFinite(calcResult.healthFactor) && isFinite(independentHF)) {
          verification.healthFactorCheck = {
            calculatorHF: calcResult.healthFactor,
            independentHF: independentHF,
            diff: Math.abs(calcResult.healthFactor - independentHF),
            isConsistent: Math.abs(calcResult.healthFactor - independentHF) <= 0.01,
          };
        }

        // Compute HF detail with classification
        const hfDetail = computeHFDetail(userData, healthCalculator, hfEpsilon, dustEpsilon);
        verification.hfDetail = hfDetail;
        hfDetailsArray.push(hfDetail);

        // Update HF summary counters
        if (hfDetail.classification === "NO_DEBT") {
          report.summary!.hfNull++;
        } else if (hfDetail.classification === "DUST_DEBT") {
          report.summary!.hfDust++;
        } else if (hfDetail.classification === "HUGE") {
          report.summary!.hfHuge++;
        } else if (hfDetail.classification === "MISMATCH") {
          report.summary!.hfMismatch++;
        } else {
          report.summary!.hfOk++;
        }

        // Check borrowedReservesCount
        const reservesWithDebt = userData.reserves.filter((ur) => {
          const varDebt = parseFloat(ur.currentVariableDebt);
          const stableDebt = parseFloat(ur.currentStableDebt);
          return varDebt > 0 || stableDebt > 0;
        });

        verification.borrowedReservesCheck = {
          reported: userData.borrowedReservesCount,
          actual: reservesWithDebt.length,
          matches: userData.borrowedReservesCount === reservesWithDebt.length,
        };

        if (!verification.borrowedReservesCheck.matches) {
          verification.borrowedReservesCheck.mismatchList = reservesWithDebt.map(
            (ur) => ur.reserve.symbol,
          );
        }

        if (verbose) {
          console.log(`  - User: ${liq.user}`);
          console.log(
            `  - Borrowed reserves: ${verification.borrowedReservesCheck.reported} (actual: ${verification.borrowedReservesCheck.actual})`,
          );
          if (verification.healthFactorCheck) {
            console.log(
              `  - Health factor: ${verification.healthFactorCheck.calculatorHF.toFixed(4)} (independent: ${verification.healthFactorCheck.independentHF.toFixed(4)})`,
            );
          }
          if (verification.issues.length > 0) {
            console.log(`  - Issues: ${verification.issues.length}`);
            for (const issue of verification.issues) {
              console.log(`    [${issue.severity}] ${issue.type}: ${issue.message}`);
            }
          } else {
            console.log("  - No issues found");
          }
        }

        // Print HF detail if requested or if there's a mismatch
        if (showHf || verbose || hfDetail.classification === "MISMATCH") {
          printHFDetail(hfDetail);
        }
      } else {
        verification.issues.push({
          type: "userData",
          severity: "warning",
          message: "User not found in subgraph",
        });
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      verification.issues.push({
        type: "userData",
        severity: "error",
        message: `Failed to fetch user data: ${errorMessage}`,
      });
    }

    report.liquidations.push(verification);
    report.verifiedCount++;

    // Update error/warning counts
    const errorCount = verification.issues.filter((i) => i.severity === "error").length;
    const warningCount = verification.issues.filter((i) => i.severity === "warning").length;
    report.errorCount += errorCount;
    report.warningCount += warningCount;
  }

  // Print summary
  console.log("\n[verify-data] Verification Summary:");
  console.log(`  Total liquidations: ${report.totalLiquidations}`);
  console.log(`  Verified: ${report.verifiedCount}`);
  console.log(`  Errors: ${report.errorCount}`);
  console.log(`  Warnings: ${report.warningCount}`);

  // Print HF summary breakdown
  if (report.summary) {
    console.log("\n[verify-data] Health Factor Summary:");
    console.log(`  OK: ${report.summary.hfOk}`);
    console.log(`  NO_DEBT (null): ${report.summary.hfNull}`);
    console.log(`  DUST_DEBT: ${report.summary.hfDust}`);
    console.log(`  HUGE (>10000): ${report.summary.hfHuge}`);
    console.log(`  MISMATCH: ${report.summary.hfMismatch}`);
  }

  // Add hfDetails to report if requested
  if (jsonHf && out) {
    report.hfDetails = hfDetailsArray;
  }

  // Write JSON report if requested
  if (out) {
    writeFileSync(out, JSON.stringify(report, null, 2));
    console.log(`\n[verify-data] Report written to ${out}`);
    if (jsonHf) {
      console.log(`[verify-data] JSON includes ${hfDetailsArray.length} HF details`);
    }
  }

  console.log("[verify-data] Complete.");

  // Exit with error code if there were errors or HF mismatches
  if (report.errorCount > 0 || (report.summary && report.summary.hfMismatch > 0)) {
    process.exit(2);
  }
}

main().catch((err) => {
  console.error("[verify-data] Fatal error:", err);
  process.exit(1);
});
