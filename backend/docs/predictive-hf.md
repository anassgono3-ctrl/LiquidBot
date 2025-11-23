# Predictive Health Factor Engine

The Predictive HF Engine projects short-horizon health factors for users to preemptively identify liquidation candidates before they cross the threshold.

## Overview

Traditional liquidation bots are reactive - they detect liquidatable positions after the health factor has already dropped below 1.0. The Predictive Engine adds a proactive layer by:

1. **Monitoring** price and rate index movements
2. **Projecting** health factor changes over a short time horizon (default 180s)
3. **Identifying** users likely to cross the liquidation threshold
4. **Precomputing** liquidation calldata for near-threshold candidates
5. **Fast-pathing** execution when conditions are met

## Architecture

```
Price/Rate Updates → PriceWindow/RateIndexTracker
                           ↓
                    PredictiveEngine
                           ↓
                  [Scenario Evaluation]
                   baseline/adverse/extreme
                           ↓
                  PredictiveCandidate
                           ↓
                    Redis predictive:eta:zset
                           ↓
                  PrecomputeCalldata
                           ↓
                  FastPathExecutor
```

## Configuration

### Environment Variables

```env
# Enable predictive HF projection (default: false)
PREDICTIVE_ENABLED=true

# HF buffer in basis points for prediction threshold (default: 40 = 0.40%)
# Triggers when HF projected to cross below 1.0 + buffer
PREDICTIVE_HF_BUFFER_BPS=40

# Maximum users to evaluate per predictive tick (default: 800)
PREDICTIVE_MAX_USERS_PER_TICK=800

# Projection horizon in seconds (default: 180 = 3 minutes)
PREDICTIVE_HORIZON_SEC=180

# Prediction scenarios to evaluate (default: baseline,adverse,extreme)
# - baseline: current price trajectory
# - adverse: -1σ price move (1% drop)
# - extreme: -2σ price move (2% drop)
PREDICTIVE_SCENARIOS=baseline,adverse,extreme

# ==== PREDICTIVE INTEGRATION CONFIGURATION ====

# Enable feeding predictive output into hot/warm queues & micro-verify (default: true)
PREDICTIVE_QUEUE_ENABLED=true

# Enable micro-verification when scenario-projected HF < 1.0 (default: true)
PREDICTIVE_MICRO_VERIFY_ENABLED=true

# Allow predictive scenario < 1.0 with ETA <= 30s to pre-mark for fast-path (default: false)
PREDICTIVE_FASTPATH_ENABLED=false

# Enable dynamic buffer scaling based on volatility (default: false)
PREDICTIVE_DYNAMIC_BUFFER_ENABLED=false

# Dynamic buffer scaling bounds (basis points)
PREDICTIVE_VOLATILITY_BPS_SCALE_MIN=20   # 0.20%
PREDICTIVE_VOLATILITY_BPS_SCALE_MAX=100  # 1.00%
```

**Note**: Predictive engine operates **independently** of `PRE_SIM_ENABLED`. Disabling pre-simulation caching does not affect predictive candidate generation or integration.

## Prediction Model

### Health Factor Formula

```
HF(t) = Σ(collateral_i × P_i(t) × LT_i) / Σ(debt_j × P_j(t))
```

Where:
- `P_i(t)` = projected price at time t
- `LT_i` = liquidation threshold for asset i
- `t` = projection horizon (seconds from now)

### Price Scenarios

| Scenario | Price Multiplier | Description |
|----------|-----------------|-------------|
| **Baseline** | 1.0 | Current price (no change) |
| **Adverse** | 0.99 | -1% collateral price drop |
| **Extreme** | 0.98 | -2% collateral price drop |

### ETA Calculation

```typescript
hfDelta = hfCurrent - hfProjected
threshold = 1.0 + (PREDICTIVE_HF_BUFFER_BPS / 10000)
etaSec = ((hfCurrent - threshold) / hfDelta) * PREDICTIVE_HORIZON_SEC
```

## Usage

### Programmatic API

```typescript
import { PredictiveEngine } from './src/risk/PredictiveEngine.js';
import { UserSnapshot } from './src/risk/HFCalculator.js';

// Initialize engine
const engine = new PredictiveEngine();

// Update price data
engine.updatePrice('ETH', 2000, Date.now(), currentBlock);

// Evaluate users
const candidates = await engine.evaluate(userSnapshots, currentBlock);

// Process candidates
for (const candidate of candidates) {
  console.log(`User ${candidate.address} projected to cross in ${candidate.etaSec}s`);
  console.log(`Scenario: ${candidate.scenario}, HF: ${candidate.hfProjected}`);
}
```

### Development Harness

Test the predictive engine with sample data:

```bash
# Run harness with default config
npm run dev:predictive

# Run with custom config
PREDICTIVE_ENABLED=true \
PREDICTIVE_HF_BUFFER_BPS=50 \
PREDICTIVE_HORIZON_SEC=300 \
npm run dev:predictive
```

Sample output:

```
[predictive-harness] Starting predictive HF engine harness
[predictive-harness] Configuration:
  - Enabled: true
  - HF Buffer: 40 bps
  - Max Users Per Tick: 800
  - Horizon: 180s
  - Scenarios: baseline, adverse, extreme

[predictive-harness] Current health factors:
  0x1111...: HF=2.4000, Debt=5000 USD, Collateral=12000 USD
  0x2222...: HF=0.9600, Debt=10000 USD, Collateral=11000 USD
  0x3333...: HF=0.8421, Debt=9500 USD, Collateral=10500 USD

[predictive-harness] Generated 2 predictive candidates:
  User: 0x2222...
    Scenario: adverse
    Current HF: 0.9600
    Projected HF: 0.9504
    ETA to threshold: 45s
    Total Debt: 10000.00 USD
    Total Collateral: 11000.00 USD
```

## Integration Points

The predictive engine now integrates directly with the execution pipeline via **PredictiveOrchestrator**:

### 1. PredictiveOrchestrator

Central integration layer that:
- Subscribes to price updates from `PriceService`
- Receives user snapshot batches from `RealTimeHFService`
- Evaluates candidates using `PredictiveEngine`
- Routes candidates to execution primitives

```typescript
import { PredictiveOrchestrator } from './src/risk/PredictiveOrchestrator.js';

const orchestrator = new PredictiveOrchestrator();

// Update prices
orchestrator.updatePrice('ETH', 2000, Date.now(), currentBlock);

// Evaluate users and trigger integrations
await orchestrator.evaluate(userSnapshots, currentBlock);
```

### 2. Queue Integration

Candidates flow into **PriorityQueues** with `entryReason='predictive_scenario'`:

```typescript
// HotCriticalQueue or WarmProjectedQueue
const entry: QueueEntry = {
  user: candidate.address,
  healthFactor: candidate.hfCurrent,
  projectedHF: candidate.hfProjected,
  entryReason: 'predictive_scenario',
  predictiveScenario: candidate.scenario,
  predictiveEtaSec: candidate.etaSec,
  priority: computedPriority,
  // ... other fields
};
```

Controlled by `PREDICTIVE_QUEUE_ENABLED` (default: true).

### 3. Micro-Verification Integration

When projected HF < threshold, triggers micro-verification:

```typescript
// In RealTimeHFService
public async ingestPredictiveCandidates(candidates: PredictiveCandidate[]): Promise<void> {
  for (const candidate of candidates) {
    if (candidate.hfProjected < 1.0 + buffer) {
      await this.scheduleMicroVerify(candidate.address);
    }
  }
}
```

Controlled by `PREDICTIVE_MICRO_VERIFY_ENABLED` (default: true).

### 4. Sprinter Pre-Staging Integration

Candidates with projected HF below pre-stage threshold feed into Sprinter:

```typescript
// In SprinterEngine
public prestageFromPredictive(
  user: string,
  debtToken: string,
  collateralToken: string,
  debtWei: bigint,
  collateralWei: bigint,
  projectedHF: number,
  currentBlock: number,
  debtPriceUsd: number
): boolean {
  // Applies same filters, delegates to prestage()
}
```

Candidates are pre-staged when projected HF < 1.02 (configurable via `PRESTAGE_HF_BPS`).

### 5. Fast-Path Readiness (Optional)

When enabled, candidates with projected HF < 1.0 and ETA ≤ 30s are flagged for fast-path:

```typescript
if (config.predictiveFastpathEnabled && 
    candidate.hfProjected < 1.0 && 
    candidate.etaSec <= 30) {
  // Flag for CriticalLane attempt on next confirmation
}
```

Controlled by `PREDICTIVE_FASTPATH_ENABLED` (default: false).

### 6. Event Listener Pattern

Custom integration via listener interface:

```typescript
class MyPredictiveListener implements PredictiveEventListener {
  async onPredictiveCandidate(event: PredictiveScenarioEvent): Promise<void> {
    if (event.shouldMicroVerify) {
      // Custom micro-verify logic
    }
  }
}

orchestrator.addListener(new MyPredictiveListener());
```

## Metrics

Prometheus metrics exported at `/metrics`:

### Ingestion & Integration Metrics

```
# Total predictive candidates ingested by scenario
liquidbot_predictive_ingested_total{scenario="baseline"} 42
liquidbot_predictive_ingested_total{scenario="adverse"} 15
liquidbot_predictive_ingested_total{scenario="extreme"} 3

# Queue entries from predictive scenarios
liquidbot_predictive_queue_entries_total{reason="predictive_scenario"} 38

# Micro-verifications scheduled from predictive scenarios
liquidbot_predictive_micro_verify_scheduled_total{scenario="adverse"} 12

# Pre-staged candidates from predictive scenarios
liquidbot_predictive_prestaged_total{scenario="baseline"} 8
liquidbot_predictive_prestaged_total{scenario="adverse"} 5

# Fast-path flags from predictive scenarios (if enabled)
liquidbot_predictive_fastpath_flagged_total{scenario="adverse"} 3

# Current dynamic buffer value (gauge)
liquidbot_predictive_dynamic_buffer_current_bps 45
```

### Accuracy & Performance Metrics

```
# Projection accuracy histogram (basis points)
liquidbot_predictive_projection_accuracy_bps_bucket{le="10"} 24
liquidbot_predictive_projection_accuracy_bps_bucket{le="50"} 41
liquidbot_predictive_projection_accuracy_bps_bucket{le="100"} 53

# False negatives (missed crossings without predictive candidate)
liquidbot_predictive_false_negative_total{scenario="baseline"} 2

# Calculation performance
hf_calc_batch_ms_bucket{le="100"} 156
hf_calc_users_per_sec 2400
```

## Tuning Guide

### Scenario Selection

**Conservative (Low False Positives)**
```env
PREDICTIVE_SCENARIOS=extreme
PREDICTIVE_HF_BUFFER_BPS=80
```

**Aggressive (High Coverage)**
```env
PREDICTIVE_SCENARIOS=baseline,adverse,extreme
PREDICTIVE_HF_BUFFER_BPS=20
```

**Balanced (Recommended)**
```env
PREDICTIVE_SCENARIOS=baseline,adverse
PREDICTIVE_HF_BUFFER_BPS=40
```

### Horizon Tuning

Longer horizons = more advance warning but higher false positive rate

| Horizon | Use Case | Trade-off |
|---------|----------|-----------|
| 60s | Reactive++ | High precision, less prep time |
| 180s | **Recommended** | Balanced precision & coverage |
| 300s | Proactive | Early warning, more false positives |

### User Limit Tuning

```env
# Low-power mode (CPU constrained)
PREDICTIVE_MAX_USERS_PER_TICK=200

# Balanced (Recommended)
PREDICTIVE_MAX_USERS_PER_TICK=800

# Aggressive (High CPU available)
PREDICTIVE_MAX_USERS_PER_TICK=2000
```

## Monitoring

### Logs

```
[predictive-engine] Generated 15 candidates (evaluated 800 users)
[predictive-engine] Candidate 0x1234... scenario=adverse hf=0.9950→0.9890 eta=45s
```

### Dashboard Queries

```promql
# Prediction accuracy
rate(predictive_crossings_confirmed_total[5m]) / 
rate(predictive_candidates_total[5m])

# False positive rate by scenario
rate(predictive_false_positive_total{scenario="adverse"}[5m])

# Average calculation time
rate(hf_calc_batch_ms_sum[5m]) / 
rate(hf_calc_batch_ms_count[5m])
```

## Troubleshooting

### High False Positive Rate

- Increase `PREDICTIVE_HF_BUFFER_BPS` (e.g., 40 → 60)
- Use fewer scenarios (e.g., only `baseline,adverse`)
- Reduce `PREDICTIVE_HORIZON_SEC` (e.g., 180 → 120)

### Missing Liquidations

- Decrease `PREDICTIVE_HF_BUFFER_BPS` (e.g., 40 → 30)
- Add `extreme` scenario
- Increase `PREDICTIVE_HORIZON_SEC` (e.g., 180 → 240)
- Increase `PREDICTIVE_MAX_USERS_PER_TICK`

### High CPU Usage

- Reduce `PREDICTIVE_MAX_USERS_PER_TICK`
- Increase evaluation interval (batch less frequently)
- Prioritize by debt size (evaluate high-value positions first)

## Best Practices

1. **Start Conservative**: Use higher buffer and fewer scenarios initially
2. **Monitor Accuracy**: Track confirmed vs false positive ratios
3. **Tune Gradually**: Adjust thresholds based on historical performance
4. **Prioritize High Value**: Evaluate larger positions more frequently
5. **Log Decisions**: Keep structured logs for post-mortem analysis
6. **Test Scenarios**: Run harness with historical price data
7. **Balance Resources**: Tune `MAX_USERS_PER_TICK` for your CPU capacity

## Future Enhancements

- Machine learning for price trajectory prediction
- Per-asset volatility-adjusted scenarios
- Adaptive horizon based on market conditions
- Cross-user contagion modeling
- Integration with MEV-aware execution strategies
