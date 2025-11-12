# Expected Startup Logs Example

This document shows what startup logs should look like with all features enabled.

## Before This PR

```
LiquidBot backend listening on port 3000
WebSocket server available at ws://localhost:3000/ws
Build info: commit=abc123 node=v20.0.0 started=2025-01-15T10:30:00Z
[config] NOTIFY_ONLY_WHEN_ACTIONABLE=true
[config] ALWAYS_INCLUDE_HF_BELOW=1.1
[config] PROFIT_MIN_USD=10
[config] EXECUTION_HF_THRESHOLD_BPS=9800
Subgraph: DISABLED (USE_SUBGRAPH=false) - using on-chain discovery only
[realtime-hf] Service started successfully
```

**Missing:**
- ❌ No [hotlist] banner
- ❌ No [precompute] banner
- ❌ No [oracle] banner
- ❌ No [audit] classifier banner
- ❌ No service initialization logs

---

## After This PR (All Features Enabled)

### Configuration (.env)
```bash
# Feature flags
HOTLIST_ENABLED=true
HOTLIST_MIN_HF=0.99
HOTLIST_MAX_HF=1.03
HOTLIST_MIN_DEBT_USD=5
HOTLIST_MAX=2000
HOTLIST_REVISIT_SEC=5

PRECOMPUTE_ENABLED=true
PRECOMPUTE_TOP_K=500
PRECOMPUTE_RECEIVE_A_TOKEN=false

PRICES_USE_AAVE_ORACLE=true
AAVE_ORACLE=0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156

LIQUIDATION_AUDIT_ENABLED=true
LIQUIDATION_AUDIT_NOTIFY=true
# DECISION_TRACE_ENABLED=true (auto-defaults when audit enabled)
# AUDIT_CLASSIFIER_ENABLED=true (auto-defaults when audit enabled)

# Existing config
USE_REALTIME_HF=true
WS_RPC_URL=wss://mainnet.base.org
LOW_HF_TRACKER_ENABLED=true
```

### Expected Startup Log Output

```log
LiquidBot backend listening on port 3000
WebSocket server available at ws://localhost:3000/ws
Build info: commit=9dafa04 node=v20.0.0 started=2025-11-12T17:30:00Z

✅ [hotlist] enabled hf=[0.99,1.03] topN=2000 minDebt=5 revisitSec=5
✅ [precompute] enabled topK=500 receiveAToken=false
✅ [oracle] using Aave PriceOracle=0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156 BASE_CURRENCY_UNIT=1e8
✅ [audit] classifier enabled (decision-trace on)

[config] NOTIFY_ONLY_WHEN_ACTIONABLE=true
[config] ALWAYS_INCLUDE_HF_BELOW=1.1
[config] PROFIT_MIN_USD=10
[config] EXECUTION_HF_THRESHOLD_BPS=9800
Subgraph: DISABLED (USE_SUBGRAPH=false) - using on-chain discovery only

✅ [hot-set] Initialized: hot ≤ 1.03, warm ≤ 1.10, maxHot=1000, maxWarm=5000
✅ [precompute] Initialized: topK=500, closeFactor=50%
✅ [decision-trace] Store initialized
✅ [lowhf-tracker] Enabled: mode=all max=1000 dumpOnShutdown=true

[config] LIQUIDATION_AUDIT_ENABLED=true LIQUIDATION_AUDIT_NOTIFY=true LIQUIDATION_AUDIT_PRICE_MODE=aave_oracle LIQUIDATION_AUDIT_SAMPLE_LIMIT=0

✅ [aave-oracle] Initialized with oracle address: 0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156
✅ [oracle] AaveOracleHelper initialized for audit (address=0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156)

✅ [realtime-hf] Service started successfully
```

### Key Indicators (✅ All Present)

1. **Feature Banners (4 total):**
   - ✅ `[hotlist] enabled ...` with HF range and limits
   - ✅ `[precompute] enabled ...` with topK
   - ✅ `[oracle] using Aave PriceOracle=...`
   - ✅ `[audit] classifier enabled ...`

2. **Service Initialization (5 total):**
   - ✅ `[hot-set] Initialized: ...` with thresholds
   - ✅ `[precompute] Initialized: ...` with topK
   - ✅ `[decision-trace] Store initialized`
   - ✅ `[lowhf-tracker] Enabled: ...`
   - ✅ `[aave-oracle] Initialized with oracle address: ...`

3. **Oracle Resolution:**
   - ✅ `[oracle] AaveOracleHelper initialized for audit ...`

4. **Real-time Service:**
   - ✅ `[realtime-hf] Service started successfully`

---

## Partial Configuration Examples

### Example 1: Only Hotlist Enabled

**.env:**
```bash
HOTLIST_ENABLED=true
PRECOMPUTE_ENABLED=false
PRICES_USE_AAVE_ORACLE=false
LIQUIDATION_AUDIT_ENABLED=false
```

**Logs:**
```log
✅ [hotlist] enabled hf=[0.99,1.03] topN=2000 minDebt=5 revisitSec=5
✅ [hot-set] Initialized: hot ≤ 1.03, warm ≤ 1.10, maxHot=1000, maxWarm=5000
```

**Missing (as expected):**
- ❌ [precompute] banner (disabled)
- ❌ [oracle] banner (disabled)
- ❌ [audit] banner (disabled)

---

### Example 2: Only Audit + Oracle Enabled

**.env:**
```bash
HOTLIST_ENABLED=false
PRECOMPUTE_ENABLED=false
PRICES_USE_AAVE_ORACLE=true
LIQUIDATION_AUDIT_ENABLED=true
```

**Logs:**
```log
✅ [oracle] using Aave PriceOracle=0x2Cc0... BASE_CURRENCY_UNIT=1e8
✅ [audit] classifier enabled (decision-trace on)
✅ [decision-trace] Store initialized
✅ [aave-oracle] Initialized with oracle address: 0x2Cc0...
✅ [oracle] AaveOracleHelper initialized for audit (address=0x2Cc0...)
```

**Missing (as expected):**
- ❌ [hotlist] banner (disabled)
- ❌ [precompute] banner (disabled)
- ❌ [hot-set] initialization (hotlist disabled)

---

### Example 3: Everything Disabled

**.env:**
```bash
HOTLIST_ENABLED=false
PRECOMPUTE_ENABLED=false
PRICES_USE_AAVE_ORACLE=false
LIQUIDATION_AUDIT_ENABLED=false
```

**Logs:**
```log
LiquidBot backend listening on port 3000
[config] NOTIFY_ONLY_WHEN_ACTIONABLE=true
[config] ALWAYS_INCLUDE_HF_BELOW=1.1
[realtime-hf] Service started successfully
```

**Missing (as expected):**
- ❌ All four feature banners
- ❌ All service initialization logs

---

## Runtime Logs (During Operation)

### Existing Logs (Continue to Work)

```log
[realtime-hf] newHead block=12345678
[event] Supply detected for user=0xabc... reserve=USDC
Sharp price drop detected (poll): asset=AAVE -2.5% → emergency scan complete (5 candidates)
[realtime-hf] notify actionable user=0xdef... debtAsset=USDC collateral=WETH debtToCover=$150.00 bonusBps=500
```

### New Audit Logs (With Classifier)

**Before this PR:**
```json
{
  "type": "liquidation_missed",
  "user": "0xabc...",
  "reason": "raced",
  "debtUsd": 0,
  "collateralUsd": 0
}
```

**After this PR:**
```json
{
  "type": "liquidation_missed",
  "user": "0xabc...",
  "reasonCode": "filtered.min_debt",
  "decisionAction": "skip",
  "skipReason": "min_debt",
  "hfAtDecision": 0.987,
  "estDebtUsd": 8.50,
  "estProfitUsd": 0.42,
  "debtUsd": 150.00,
  "collateralUsd": 165.00,
  "priceSource": "aave_oracle",
  "notes": ["Filtered: debt below threshold (est=8.50 < min=10)"]
}
```

**Key improvements:**
- ✅ Correct USD values from Aave oracle
- ✅ Detailed classifier reason codes
- ✅ Decision metadata with HF and estimates
- ✅ Human-readable notes explaining classification

---

## Troubleshooting

### Issue: No Feature Banners Appear

**Check 1: Environment variables are set**
```bash
grep -E "HOTLIST_ENABLED|PRECOMPUTE_ENABLED|PRICES_USE_AAVE_ORACLE|LIQUIDATION_AUDIT_ENABLED" backend/.env
```

Expected output:
```
HOTLIST_ENABLED=true
PRECOMPUTE_ENABLED=true
PRICES_USE_AAVE_ORACLE=true
LIQUIDATION_AUDIT_ENABLED=true
```

**Check 2: .env file is loaded**
```bash
# Make sure you're starting with:
npm run dev
# or
node -r dotenv/config dist/src/index.js
```

**Check 3: Restart after .env changes**
Configuration is read once at startup. Restart the server after changing .env.

---

### Issue: Oracle Shows "(will resolve from AddressesProvider)"

This is expected if `AAVE_ORACLE` is not explicitly set in `.env`. The oracle address will be resolved automatically at runtime:

```log
[oracle] using Aave PriceOracle=(will resolve from AddressesProvider) BASE_CURRENCY_UNIT=1e8
[aave-oracle] Initialized with oracle address: 0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156
```

To show the address immediately in the banner, add to `.env`:
```bash
AAVE_ORACLE=0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156
```

---

### Issue: [audit] Banner Shows "decision-trace off"

This means `DECISION_TRACE_ENABLED=false` was explicitly set. Remove it to use the auto-default:

```bash
# Remove this line:
# DECISION_TRACE_ENABLED=false

# Or explicitly enable:
DECISION_TRACE_ENABLED=true
```

Expected banner:
```
[audit] classifier enabled (decision-trace on)
```

---

## Health Check Endpoint

Query the `/health` endpoint to verify services are initialized:

```bash
curl http://localhost:3000/health | jq
```

**Expected response fields:**
```json
{
  "status": "ok",
  "app": {
    "uptimeSeconds": 120,
    "version": "0.1.0"
  },
  "realtimeHF": {
    "candidateCount": 156,
    "minHF": 0.985
  },
  "notifications": {
    "telegramEnabled": true
  },
  "onDemandHealthFactor": true
}
```

---

## Summary

This PR ensures that:

1. ✅ **All four feature banners appear** when enabled
2. ✅ **Service initialization logs confirm** features are active
3. ✅ **Oracle address is resolved and logged**
4. ✅ **Audit output includes classifier reason codes**
5. ✅ **USD values from Aave oracle are accurate**

For complete verification steps, see [OPERATIONS.md](./OPERATIONS.md).

For detailed change documentation, see [FEATURE_ACTIVATION_SUMMARY.md](./FEATURE_ACTIVATION_SUMMARY.md).
