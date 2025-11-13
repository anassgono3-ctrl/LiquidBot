# Liquidation Sentry - Diagnostics Layer

## Overview

The Liquidation Sentry is a comprehensive diagnostics system that classifies why liquidations were missed or raced. It provides structured insights into liquidation misses with detailed classification, timing analysis, and profit estimates.

## Architecture

### Core Components

1. **LiquidationMissClassifier** (`src/services/LiquidationMissClassifier.ts`)
   - Main classification engine
   - Tracks first-seen timestamps for liquidatable users
   - Classifies misses based on execution decisions and timing

2. **ExecutionDecisionsStore** (`src/services/executionDecisions.ts`)
   - Ring buffer storing recent execution decisions
   - TTL-based expiration (default: 5 minutes)
   - Bounded memory usage (default: 5000 entries)

3. **ProfitEstimator** (`src/services/ProfitEstimator.ts`)
   - Estimates gross profit from liquidations
   - Uses USD values and liquidation bonus
   - Simple formula: `grossProfit = debtUsd * liquidationBonusPct`

### Classification Reasons

| Reason | Description | Triggers |
|--------|-------------|----------|
| `not_in_watch_set` | User not tracked when liquidation occurred | User not in candidate set |
| `raced` | Competitor executed first | No local decision found, or attempt with high gas |
| `hf_transient` | HF recovery (transient violation) | Liquidatable for ≤ MISS_TRANSIENT_BLOCKS |
| `insufficient_profit` | Profit below threshold | Estimated profit < MISS_MIN_PROFIT_USD |
| `execution_filtered` | Suppressed by execution guard | Skip due to dust/scaling/other guard |
| `revert` | Attempt reverted on-chain | Transaction reverted |
| `gas_outbid` | Competitor used higher gas | Gas price < MISS_GAS_THRESHOLD_GWEI |
| `oracle_jitter` | Price swing reversed quickly | (Placeholder - TODO) |
| `unknown` | Unclassified | Fallback category |

## Configuration

### Environment Variables

```bash
# Enable/disable the miss classifier
MISS_CLASSIFIER_ENABLED=false  # Default: false

# HF transience threshold (blocks)
MISS_TRANSIENT_BLOCKS=3  # Default: 3

# Minimum profit threshold (USD)
MISS_MIN_PROFIT_USD=10  # Default: 10

# Gas price threshold for gas_outbid classification (Gwei)
MISS_GAS_THRESHOLD_GWEI=50  # Default: 50

# Enable profit estimation
MISS_ENABLE_PROFIT_CHECK=true  # Default: true
```

### Config Access

```typescript
import { config } from './config/index.js';

const enabled = config.missClassifierEnabled;
const transientBlocks = config.missTransientBlocks;
const minProfitUsd = config.missMinProfitUsd;
const gasThresholdGwei = config.missGasThresholdGwei;
const enableProfitCheck = config.missEnableProfitCheck;
```

## Integration Guide

### Step 1: Initialize Services

```typescript
import { LiquidationMissClassifier } from './services/LiquidationMissClassifier.js';
import { ExecutionDecisionsStore } from './services/executionDecisions.js';
import { config } from './config/index.js';

// Create execution decisions store
const decisionsStore = new ExecutionDecisionsStore(
  5000,    // maxSize
  300000   // ttlMs (5 minutes)
);

// Create classifier
const classifierConfig = {
  enabled: config.missClassifierEnabled,
  transientBlocks: config.missTransientBlocks,
  minProfitUsd: config.missMinProfitUsd,
  gasThresholdGwei: config.missGasThresholdGwei,
  enableProfitCheck: config.missEnableProfitCheck
};

const missClassifier = new LiquidationMissClassifier(
  classifierConfig,
  decisionsStore
);
```

### Step 2: Track First Seen (RealTimeHFService Integration)

When a user's HF first crosses below the liquidation threshold:

```typescript
// In RealTimeHFService, when user becomes liquidatable
if (healthFactor < threshold && !wasLiquidatableBefore) {
  missClassifier.recordFirstSeen(userAddress, blockNumber, healthFactor);
}

// Clear when user recovers
if (healthFactor >= threshold && wasLiquidatableBefore) {
  missClassifier.clearFirstSeen(userAddress);
}
```

### Step 3: Record Execution Decisions (ExecutionService Integration)

Record decisions before execution guards and attempts:

```typescript
// In ExecutionService.executeReal(), before guards
const decision: ExecutionDecision = {
  user: opportunity.user,
  timestamp: Date.now(),
  blockNumber: currentBlock,
  type: 'skip',  // or 'attempt' or 'revert'
  reason: skipReason,
  debtAsset: debtAsset,
  collateralAsset: collateralAsset,
  debtUsd: debtToCoverUsd,
  profitEstimateUsd: estimatedProfit,
  gasPriceGwei: currentGasPrice
};

decisionsStore.record(decision);

// For attempts, add txHash
if (attempt) {
  decision.type = 'attempt';
  decision.txHash = tx.hash;
}

// For reverts
if (reverted) {
  decision.type = 'revert';
  decision.reason = revertReason;
  decision.txHash = tx.hash;
}
```

### Step 4: Classify Misses (LiquidationAuditService Integration)

When a liquidation event is detected:

```typescript
// In liquidationAudit.onLiquidationCall()
import { 
  liquidationMissTotal, 
  liquidationLatencyBlocks,
  liquidationProfitGapUsd 
} from '../metrics/index.js';

const classification = missClassifier.classify(
  user,
  liquidator,
  eventTimestamp,
  eventBlockNumber,
  wasInWatchSet,
  debtAsset,
  debtAmount,
  collateralAsset,
  collateralAmount,
  liquidationBonusPct,
  ourBotAddress
);

// Update metrics
liquidationMissTotal.inc({ reason: classification.reason });

if (classification.blocksSinceFirstSeen !== undefined) {
  liquidationLatencyBlocks.observe(classification.blocksSinceFirstSeen);
}

if (classification.profitEstimateUsd !== undefined) {
  liquidationProfitGapUsd.observe(classification.profitEstimateUsd);
}

// Log classification
console.log('[miss-classifier]', {
  user,
  reason: classification.reason,
  blocks: classification.blocksSinceFirstSeen,
  profit: classification.profitEstimateUsd,
  gas: classification.gasPriceGweiAtDecision,
  notes: classification.notes
});
```

## Metrics

### Prometheus Metrics

```
# Miss classification counts by reason
liquidbot_liquidation_miss_total{reason="raced"}
liquidbot_liquidation_miss_total{reason="not_in_watch_set"}
liquidbot_liquidation_miss_total{reason="hf_transient"}
liquidbot_liquidation_miss_total{reason="insufficient_profit"}
liquidbot_liquidation_miss_total{reason="execution_filtered"}
liquidbot_liquidation_miss_total{reason="revert"}
liquidbot_liquidation_miss_total{reason="gas_outbid"}
liquidbot_liquidation_miss_total{reason="unknown"}

# Latency distribution (blocks between detection and event)
liquidbot_liquidation_latency_blocks

# Missed profit distribution
liquidbot_liquidation_profit_gap_usd

# Classifier errors
liquidbot_liquidation_classifier_errors_total

# HF transience events
liquidbot_liquidation_hf_transience_total
```

### Grafana Dashboard Queries

**Miss Rate by Reason:**
```promql
rate(liquidbot_liquidation_miss_total[5m])
```

**Average Detection Latency:**
```promql
histogram_quantile(0.5, liquidbot_liquidation_latency_blocks)
```

**Total Missed Profit:**
```promql
sum(rate(liquidbot_liquidation_profit_gap_usd_sum[1h]))
```

## Testing

### Unit Tests

Run the comprehensive unit test suite:

```bash
npm test -- liquidationMissClassifier
```

Tests cover:
- All classification reasons
- FirstSeen tracking
- Profit estimation
- Decision recording and retrieval
- Cleanup and expiration

### Harness Script

Run synthetic scenarios for manual verification:

```bash
npx tsx scripts/test-liquidation-sentry.ts
```

Output includes:
- Classification results for each scenario
- Expected vs actual reasons
- Notes and diagnostic information
- Profit estimates and gas prices

## Operational Guidelines

### Enabling the Feature

1. Set environment variables:
   ```bash
   MISS_CLASSIFIER_ENABLED=true
   MISS_TRANSIENT_BLOCKS=3
   MISS_MIN_PROFIT_USD=10
   MISS_GAS_THRESHOLD_GWEI=50
   ```

2. Restart the service to apply configuration

3. Monitor metrics dashboard for classification data

### Tuning Parameters

**MISS_TRANSIENT_BLOCKS:**
- Lower (1-2): Detect very brief HF violations
- Higher (5-10): Only flag sustained violations
- Default (3): Balanced threshold

**MISS_MIN_PROFIT_USD:**
- Lower: Catch more marginal opportunities
- Higher: Focus on high-value misses
- Adjust based on gas costs and operational goals

**MISS_GAS_THRESHOLD_GWEI:**
- Lower (30-40): More aggressive gas_outbid classification
- Higher (60-70): Only flag clear gas underpricing
- Tune based on network conditions

### Disabling the Feature

Set `MISS_CLASSIFIER_ENABLED=false` to disable classification without code changes.

## Performance Considerations

### Memory Usage

- **ExecutionDecisionsStore:** ~5000 entries × ~200 bytes ≈ 1 MB
- **FirstSeenMap:** ~1000 users × 50 bytes ≈ 50 KB
- **Total overhead:** < 2 MB

### CPU Impact

- Classification: < 1ms per event
- Cleanup: ~10ms per minute
- Negligible impact on critical path

### Best Practices

1. **Cleanup:** Call `missClassifier.cleanup()` periodically to remove stale firstSeen records
2. **TTL:** Adjust decision store TTL based on liquidation velocity
3. **Metrics:** Monitor `liquidation_classifier_errors_total` for issues
4. **Logging:** Use structured logging for classification events

## Future Enhancements

### Planned Features

1. **Oracle Jitter Detection:** Detect HF swings due to price reversals
2. **Gas Cost Modeling:** Estimate net profit after gas costs
3. **Persistent Storage:** Store classification history in database
4. **Advanced Analytics:** Aggregate statistics by time/reason/user

### Extension Points

The classifier is designed for extension:

```typescript
// Add custom classification logic
export type MissReason = 
  | 'not_in_watch_set'
  | 'raced'
  | 'hf_transient'
  | 'insufficient_profit'
  | 'execution_filtered'
  | 'revert'
  | 'gas_outbid'
  | 'oracle_jitter'
  | 'custom_reason'  // Your custom reason
  | 'unknown';
```

## Troubleshooting

### Classifier Not Working

1. Check `MISS_CLASSIFIER_ENABLED=true`
2. Verify decisionsStore is recording decisions
3. Check `liquidation_classifier_errors_total` metric
4. Review logs for error messages

### High Unknown Classification Rate

- Indicates missing decision traces
- Check ExecutionService integration
- Verify TTL is not too short
- Ensure decisions are recorded before execution

### Inaccurate Classifications

- Review firstSeen tracking in RealTimeHFService
- Validate decision recording in ExecutionService
- Check threshold tuning (transientBlocks, minProfitUsd, gasThresholdGwei)
- Verify timing synchronization

## References

- [DecisionClassifier.ts](../src/services/DecisionClassifier.ts) - Legacy classifier (reference)
- [DecisionTraceStore.ts](../src/services/DecisionTraceStore.ts) - Decision trace storage (reference)
- [liquidationAudit.ts](../src/services/liquidationAudit.ts) - Audit service integration point
- [Test Suite](../tests/unit/liquidationMissClassifier.test.ts) - Unit tests
- [Harness](../scripts/test-liquidation-sentry.ts) - Validation script

## Support

For questions or issues:
1. Check logs for classification events
2. Review metrics dashboard
3. Run harness script to validate behavior
4. Check GitHub issues for known problems
