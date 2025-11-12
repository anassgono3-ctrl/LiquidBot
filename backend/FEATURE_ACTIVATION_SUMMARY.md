# Feature Activation Summary

This document summarizes the changes made to wire hotlist, precompute, audit classifier, and Aave oracle modules to the runtime.

## Problem Statement

Previously, even with `HOTLIST_ENABLED=true`, `PRECOMPUTE_ENABLED=true`, and `PRICES_USE_AAVE_ORACLE=true` in `.env`, the runtime logs showed no evidence that these features were active:
- No `[hotlist]`, `[precompute]`, `[oracle]`, or `[audit classifier]` banners
- Large head sweeps (2.4k+ paged) continued
- No precompute integration logs
- Audit messages showed no classifier-based reason codes
- Price oracle wasn't used for USD valuations

## Root Cause

1. **Config Mapping**: New env vars (HOTLIST_*, PRECOMPUTE_RECEIVE_A_TOKEN, PRICES_USE_AAVE_ORACLE, DECISION_TRACE_ENABLED, AUDIT_CLASSIFIER_ENABLED) were not mapped to the typed config
2. **Service Wiring**: HotSetTracker, PrecomputeService, and DecisionTraceStore existed but were not instantiated in RealTimeHFService
3. **Default Values**: DECISION_TRACE_ENABLED and AUDIT_CLASSIFIER_ENABLED had no defaults and weren't enabled when LIQUIDATION_AUDIT_ENABLED=true
4. **Observable Logs**: No startup banners or status logs to verify feature activation
5. **Oracle Integration**: liquidationAudit didn't check PRICES_USE_AAVE_ORACLE flag

## Solution Implemented

### A. Config and Environment Variables

**New Environment Variables Added:**

```bash
# Hotlist Configuration
HOTLIST_ENABLED=true                  # Master switch (alias for HOT_SET_ENABLED)
HOTLIST_MIN_HF=0.99                  # Minimum HF for hotlist inclusion
HOTLIST_MAX_HF=1.03                  # Maximum HF for hotlist inclusion
HOTLIST_MIN_DEBT_USD=5               # Minimum debt USD for inclusion
HOTLIST_MAX=2000                     # Maximum hotlist size
HOTLIST_REVISIT_SEC=5                # Refresh interval in seconds

# Precompute Configuration
PRECOMPUTE_ENABLED=true              # Enable precomputation
PRECOMPUTE_TOP_K=500                 # Number of top entries to precompute
PRECOMPUTE_RECEIVE_A_TOKEN=false     # Receive aToken vs underlying

# Oracle Configuration
PRICES_USE_AAVE_ORACLE=true          # Use Aave PriceOracle for USD pricing

# Audit Configuration (auto-defaults when LIQUIDATION_AUDIT_ENABLED=true)
DECISION_TRACE_ENABLED=true          # Record decision traces
AUDIT_CLASSIFIER_ENABLED=true        # Enable classifier for reason codes
```

**Files Changed:**
- `backend/src/config/envSchema.ts`: Added new env vars to schema and parsed config
- `backend/src/config/index.ts`: Added getters for new config fields

### B. Service Initialization

**RealTimeHFService Changes (`backend/src/services/RealTimeHFService.ts`):**

Added three new service instances:
```typescript
private hotSetTracker?: HotSetTracker;
private precomputeService?: PrecomputeService;
private decisionTraceStore?: DecisionTraceStore;
```

Initialization in constructor:
```typescript
// Initialize hot-set tracker if enabled
if (config.hotSetEnabled) {
  this.hotSetTracker = new HotSetTracker({
    hotSetHfMax: config.hotSetHfMax,
    warmSetHfMax: config.warmSetHfMax,
    maxHotSize: config.maxHotSize,
    maxWarmSize: config.maxWarmSize
  });
}

// Initialize precompute service if enabled
if (config.precomputeEnabled) {
  this.precomputeService = new PrecomputeService({
    topK: config.precomputeTopK,
    enabled: config.precomputeEnabled,
    closeFactorPct: config.precomputeCloseFactorPct
  });
}

// Initialize decision trace store if enabled
if (config.decisionTraceEnabled) {
  this.decisionTraceStore = new DecisionTraceStore();
  console.log('[decision-trace] Store initialized');
}
```

DecisionTraceStore is now passed to LiquidationAuditService:
```typescript
this.liquidationAuditService = new LiquidationAuditService(
  priceService,
  notificationService,
  this.provider,
  this.decisionTraceStore  // ← New parameter
);
```

### C. Startup Banners

**Main Entry Point (`backend/src/index.ts`):**

Added four startup banners that display when features are enabled:

```typescript
// Hotlist banner
if (config.hotlistEnabled) {
  logger.info(
    `[hotlist] enabled hf=[${config.hotlistMinHf},${config.hotlistMaxHf}] ` +
    `topN=${config.hotlistMax} minDebt=${config.hotlistMinDebtUsd} ` +
    `revisitSec=${config.hotlistRevisitSec}`
  );
}

// Precompute banner
if (config.precomputeEnabled) {
  logger.info(
    `[precompute] enabled topK=${config.precomputeTopK} ` +
    `receiveAToken=${config.precomputeReceiveAToken}`
  );
}

// Oracle banner
if (config.pricesUseAaveOracle) {
  const oracleAddr = config.aaveOracle || '(will resolve from AddressesProvider)';
  logger.info(
    `[oracle] using Aave PriceOracle=${oracleAddr} BASE_CURRENCY_UNIT=1e8`
  );
}

// Audit classifier banner
if (config.liquidationAuditEnabled && config.auditClassifierEnabled) {
  logger.info(
    `[audit] classifier enabled (decision-trace ${config.decisionTraceEnabled ? 'on' : 'off'})`
  );
}
```

### D. Oracle Integration

**AaveOracleHelper (`backend/src/services/AaveOracleHelper.ts`):**

Added method to retrieve resolved oracle address:
```typescript
getOracleAddress(): string | null {
  return this.oracleAddress;
}
```

**LiquidationAuditService (`backend/src/services/liquidationAudit.ts`):**

Updated to respect PRICES_USE_AAVE_ORACLE flag:
```typescript
// Use pricesUseAaveOracle flag or fallback to liquidationAuditPriceMode
this.useAaveOracle = config.pricesUseAaveOracle || config.liquidationAuditPriceMode === 'aave_oracle';

if (this.provider && this.useAaveOracle) {
  this.aaveOracleHelper = new AaveOracleHelper(this.provider);
  this.aaveOracleHelper.initialize().then(() => {
    console.log(`[oracle] AaveOracleHelper initialized for audit (address=${this.aaveOracleHelper?.getOracleAddress() || 'unknown'})`);
  });
}
```

### E. Documentation

**Created:**
1. `backend/OPERATIONS.md`: Comprehensive operations guide with:
   - Expected startup banners and their meanings
   - Configuration options for each feature
   - Verification checklist
   - Troubleshooting common issues
   - Metrics and monitoring endpoints

2. `backend/FEATURE_ACTIVATION_SUMMARY.md`: This document

**Updated:**
1. `backend/.env.example`: Added all new configuration options with explanations
2. `backend/README.md`: Updated feature list and added reference to OPERATIONS.md

## Expected Runtime Behavior

### On Startup (with all features enabled)

```
[hotlist] enabled hf=[0.99,1.03] topN=2000 minDebt=5 revisitSec=5
[precompute] enabled topK=500 receiveAToken=false
[oracle] using Aave PriceOracle=0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156 BASE_CURRENCY_UNIT=1e8
[audit] classifier enabled (decision-trace on)
[hot-set] Initialized: hot ≤ 1.03, warm ≤ 1.10, maxHot=1000, maxWarm=5000
[precompute] Initialized: topK=500, closeFactor=50%
[decision-trace] Store initialized
[lowhf-tracker] Enabled: mode=all max=1000 dumpOnShutdown=true
[aave-oracle] Initialized with oracle address: 0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156
[oracle] AaveOracleHelper initialized for audit (address=0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156)
[realtime-hf] Service started successfully
```

### During Runtime

**Existing logs that should continue:**
- `Sharp price drop detected (poll): asset=AAVE ... emergency scan complete`
- `[realtime-hf] notify actionable user=0x... debtAsset=USDC collateral=WETH`
- Head sweeps and event processing logs

**New logs (to be added in future integration):**
- Periodic hotlist status: `[hotlist] size=156 hf=[0.985,1.028] ready_precompute=142`
- Precompute completion: `[precompute] ready=312/500 within 85ms`
- Price-trigger hotlist refresh: `[price-trigger] AAVE drop detected → hotlist recompute complete`

### In Audit Messages

**Liquidation audit notifications will now show:**
1. USD values from Aave oracle (no more $0.00)
2. Classifier-based reason codes: `ours`, `raced`, `filtered.min_debt`, `filtered.min_profit`, `latency.head_lag`, etc.
3. MissRow JSON with complete metadata

## Verification Steps

1. **Check .env configuration:**
```bash
grep -E "HOTLIST_ENABLED|PRECOMPUTE_ENABLED|PRICES_USE_AAVE_ORACLE|LIQUIDATION_AUDIT_ENABLED" backend/.env
```

2. **Start the backend:**
```bash
cd backend
npm run dev
```

3. **Verify startup banners appear:**
   - [ ] `[hotlist] enabled ...`
   - [ ] `[precompute] enabled ...`
   - [ ] `[oracle] using Aave PriceOracle=...`
   - [ ] `[audit] classifier enabled ...`

4. **Verify service initialization:**
   - [ ] `[hot-set] Initialized: ...`
   - [ ] `[precompute] Initialized: ...`
   - [ ] `[decision-trace] Store initialized`
   - [ ] `[oracle] AaveOracleHelper initialized for audit ...`

5. **Check health endpoint:**
```bash
curl http://localhost:3000/health | jq
```

## Implementation Status

### Completed ✅
- [x] Config mapping for all new env vars
- [x] Startup banners for all four modules
- [x] HotSetTracker initialization in RealTimeHFService
- [x] PrecomputeService initialization in RealTimeHFService
- [x] DecisionTraceStore initialization and wiring to audit
- [x] AaveOracleHelper getOracleAddress() method
- [x] LiquidationAuditService respects PRICES_USE_AAVE_ORACLE
- [x] Auto-defaults for DECISION_TRACE_ENABLED and AUDIT_CLASSIFIER_ENABLED
- [x] OPERATIONS.md documentation
- [x] .env.example updates
- [x] README.md updates
- [x] Build passes
- [x] CodeQL security scan passes

### Future Work (Not in Scope)
- Periodic hotlist status logs (requires integration with head-check loop)
- Precompute refresh on hotlist updates (requires head-check integration)
- Price-trigger → hotlist refresh hookup (already has price trigger, needs hotlist update call)
- Hotlist size metrics emission

These runtime integrations are deferred because they require deeper changes to the head-check and event-processing loops, which are outside the minimal-change scope of this PR.

## Testing

**Build Test:**
```bash
cd backend
npm run build
# ✅ Success
```

**TypeScript Compilation:**
```bash
cd backend
npm run typecheck
# ✅ No errors
```

**Security Scan:**
```bash
# CodeQL analysis
# ✅ No alerts found
```

**Manual Runtime Test:**
Required: Start backend with posted .env configuration and verify all startup banners appear.

## Files Changed

1. `backend/src/config/envSchema.ts` - Added env var schema and parsing
2. `backend/src/config/index.ts` - Added config getters
3. `backend/src/index.ts` - Added startup banners
4. `backend/src/services/RealTimeHFService.ts` - Wired HotSetTracker, PrecomputeService, DecisionTraceStore
5. `backend/src/services/AaveOracleHelper.ts` - Added getOracleAddress() method
6. `backend/src/services/liquidationAudit.ts` - Respect pricesUseAaveOracle flag
7. `backend/.env.example` - Added new config options
8. `backend/README.md` - Updated feature list
9. `backend/OPERATIONS.md` - Created operations guide
10. `backend/FEATURE_ACTIVATION_SUMMARY.md` - This document

## Backward Compatibility

All changes are backward compatible:
- New env vars have sensible defaults
- Legacy HOT_SET_* vars still work (HOTLIST_* takes precedence)
- Services only initialize when explicitly enabled
- No breaking changes to existing APIs or behavior

## Security

- No new secrets or credentials required
- No changes to RPC providers or execution keys
- CodeQL scan found zero alerts
- All external inputs validated through Zod schema
- Oracle address resolved from trusted AddressesProvider contract
