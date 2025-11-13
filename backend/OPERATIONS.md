# LiquidBot Operations Guide

## Startup Verification

When starting the LiquidBot backend with feature modules enabled, you should see startup banners confirming each module is active.

### Expected Startup Banners

#### Hotlist Module
When `HOTLIST_ENABLED=true` (or `HOT_SET_ENABLED=true`):
```
[hotlist] enabled hf=[0.99,1.03] topN=2000 minDebt=5 revisitSec=5
```

**Parameters shown:**
- `hf=[min,max]`: Health factor range for hotlist inclusion
- `topN`: Maximum number of users in hotlist
- `minDebt`: Minimum debt in USD for hotlist inclusion
- `revisitSec`: Refresh interval in seconds

**Configuration:**
```bash
HOTLIST_ENABLED=true
HOTLIST_MIN_HF=0.99
HOTLIST_MAX_HF=1.03
HOTLIST_MIN_DEBT_USD=5
HOTLIST_MAX=2000
HOTLIST_REVISIT_SEC=5
```

#### Precompute Module
When `PRECOMPUTE_ENABLED=true`:
```
[precompute] enabled topK=500 receiveAToken=false
```

**Parameters shown:**
- `topK`: Number of top hotlist entries to precompute
- `receiveAToken`: Whether liquidation calldata receives aToken instead of underlying

**Configuration:**
```bash
PRECOMPUTE_ENABLED=true
PRECOMPUTE_TOP_K=500
PRECOMPUTE_RECEIVE_A_TOKEN=false
```

#### Aave Oracle
When `PRICES_USE_AAVE_ORACLE=true`:
```
[oracle] using Aave PriceOracle=0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156 BASE_CURRENCY_UNIT=1e8
```

**Parameters shown:**
- `PriceOracle`: Resolved Aave oracle address from AddressesProvider
- `BASE_CURRENCY_UNIT`: Price denomination (1e8 = 8 decimals)

**Configuration:**
```bash
PRICES_USE_AAVE_ORACLE=true
# Optional: AAVE_ORACLE=0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156
# If not set, oracle address will be resolved from AAVE_ADDRESSES_PROVIDER
```

Later during initialization:
```
[oracle] AaveOracleHelper initialized for audit (address=0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156)
```

#### Audit Classifier
When `LIQUIDATION_AUDIT_ENABLED=true` and `AUDIT_CLASSIFIER_ENABLED=true`:
```
[audit] classifier enabled (decision-trace on)
```

**Configuration:**
```bash
LIQUIDATION_AUDIT_ENABLED=true
# These default to true when LIQUIDATION_AUDIT_ENABLED=true:
# DECISION_TRACE_ENABLED=true
# AUDIT_CLASSIFIER_ENABLED=true
```

### Runtime Logs

#### Hot-Set Tracker
The hot-set tracker is initialized during service startup:
```
[hot-set] Initialized: hot ≤ 1.03, warm ≤ 1.10, maxHot=1000, maxWarm=5000
```

Periodic status logs (to be implemented):
```
[hotlist] size=156 hf=[0.985,1.028] ready_precompute=142
```

#### Precompute Service
Precompute initialization:
```
[precompute] Initialized: topK=500, closeFactor=50%
```

When precompute completes (to be implemented):
```
[precompute] ready=312/500 within 85ms
```

#### Low HF Tracker
When `LOW_HF_TRACKER_ENABLED=true`:
```
[lowhf-tracker] Enabled: mode=all max=1000 dumpOnShutdown=true
```

#### Decision Trace
When `DECISION_TRACE_ENABLED=true`:
```
[decision-trace] Store initialized
```

### Feature Verification Checklist

To verify all features are properly enabled:

1. **Check startup banners** - All four should appear:
   - [ ] `[hotlist] enabled ...`
   - [ ] `[precompute] enabled ...`
   - [ ] `[oracle] using Aave PriceOracle=...`
   - [ ] `[audit] classifier enabled ...`

2. **Check service initialization logs:**
   - [ ] `[hot-set] Initialized: ...`
   - [ ] `[precompute] Initialized: ...`
   - [ ] `[lowhf-tracker] Enabled: ...`
   - [ ] `[decision-trace] Store initialized`

3. **Check oracle resolution:**
   - [ ] `[aave-oracle] Initialized with oracle address: 0x...`
   - [ ] `[oracle] AaveOracleHelper initialized for audit (address=0x...)`

4. **Check real-time service:**
   - [ ] `[realtime-hf] Service started successfully`

### Common Issues

#### Feature modules not showing banners

**Symptom:** Startup doesn't show `[hotlist]`, `[precompute]`, `[oracle]`, or `[audit]` banners.

**Possible causes:**
1. Environment variables not set or set to `false`
2. `.env` file not loaded (check `NODE_ENV` and path)
3. Config cache issue (restart server after changing `.env`)

**Resolution:**
```bash
# Verify environment variables are set:
grep -E "HOTLIST_ENABLED|PRECOMPUTE_ENABLED|PRICES_USE_AAVE_ORACLE|LIQUIDATION_AUDIT_ENABLED" .env

# Expected output:
# HOTLIST_ENABLED=true
# PRECOMPUTE_ENABLED=true
# PRICES_USE_AAVE_ORACLE=true
# LIQUIDATION_AUDIT_ENABLED=true
```

#### Oracle not initializing

**Symptom:** Missing `[oracle] AaveOracleHelper initialized for audit` log.

**Possible causes:**
1. `PRICES_USE_AAVE_ORACLE=false`
2. No RPC provider configured for liquidation audit
3. `AAVE_ADDRESSES_PROVIDER` address incorrect

**Resolution:**
```bash
# Verify oracle config:
grep -E "PRICES_USE_AAVE_ORACLE|AAVE_ADDRESSES_PROVIDER|AAVE_ORACLE" .env

# For Base network, should be:
# AAVE_ADDRESSES_PROVIDER=0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D
# AAVE_ORACLE=0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156 (optional)
```

#### Hotlist not refreshing

**Symptom:** `[hotlist]` banner shows but no periodic status logs.

**Status:** Periodic hotlist logs not yet implemented in this phase. Coming in next iteration.

**Expected in future:**
```
[hotlist] size=156 hf=[0.985,1.028] ready_precompute=142
```

### Metrics and Monitoring

Use the `/health` endpoint to check service status:

```bash
curl http://localhost:3000/health | jq
```

Expected fields:
- `realtimeHF`: Real-time HF service metrics
- `liquidationTracker`: Liquidation tracking statistics
- `notifications.telegramEnabled`: Notification service status
- `onDemandHealthFactor`: On-demand HF resolution status

### Logs to Monitor

Key logs indicating proper operation:

1. **Price trigger events:**
```
Sharp price drop detected (poll): asset=AAVE ... emergency scan complete
```

2. **Head sweeps:**
```
[head] sweep complete (2.4k candidates)
```

3. **Event processing:**
```
[event] Borrow/Repay/Supply/Withdraw detected for user=0x...
```

4. **Liquidation detections:**
```
[realtime-hf] notify actionable user=0x... debtAsset=USDC collateral=WETH
```

5. **Audit classifications:**
```
[liquidation-audit] Missed liquidation: user=0x... reason=raced
```

### Notification Configuration

Audit notifications are controlled separately from actionable opportunity notifications:

```bash
# Control actionable opportunity notifications:
NOTIFY_ONLY_WHEN_ACTIONABLE=true  # Only notify when opportunity has resolved debt/collateral

# Control liquidation audit notifications:
LIQUIDATION_AUDIT_ENABLED=true    # Enable audit feature
LIQUIDATION_AUDIT_NOTIFY=true     # Send Telegram notifications for audited liquidations
```

### Support

For issues or questions:
1. Check logs for error messages
2. Verify `.env` configuration matches examples
3. Ensure all required RPC endpoints are accessible
4. Review [CONTRIBUTING.md](../CONTRIBUTING.md) for development guidelines
