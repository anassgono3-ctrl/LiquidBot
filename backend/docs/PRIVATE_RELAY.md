# Private Relay Integration Guide

## Overview

LiquidBot integrates with Flashbots Protect-style private relays to submit liquidation transactions privately, reducing exposure to public mempool front-running and improving execution success rates on Base network.

## Benefits

- **Reduced MEV Exposure**: Transactions bypass the public mempool, reducing front-running risk
- **Better Success Rates**: Private submission reduces transaction races with other liquidators
- **Automatic Fallback**: If private submission fails, transactions automatically fall back to public broadcast
- **Configurable Retry Logic**: Built-in retry mechanism with exponential backoff
- **Metrics & Observability**: Full Prometheus metrics for monitoring performance

## Configuration

### Environment Variables

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `PRIVATE_TX_RPC_URL` | string | - | Private relay endpoint (e.g., `https://protect.flashbots.net/v1/rpc`) |
| `PRIVATE_TX_MODE` | enum | `disabled` | Transaction mode: `disabled`, `protect`, or `bundle` |
| `PRIVATE_TX_SIGNATURE_RANDOM` | boolean | `false` | Randomize signature suffix for privacy |
| `PRIVATE_TX_MAX_RETRIES` | integer | `2` | Maximum retry attempts before fallback |
| `PRIVATE_TX_FALLBACK_MODE` | enum | `race` | Fallback strategy: `race` or `direct` |
| `WRITE_RPCS` | string | - | Comma-separated public RPC URLs for race mode fallback |

### Modes

#### Disabled Mode (`PRIVATE_TX_MODE=disabled`)
- Default mode
- All transactions submitted to public mempool
- No private relay used

#### Protect Mode (`PRIVATE_TX_MODE=protect`)
- Uses `eth_sendPrivateTransaction` RPC method
- Compatible with Flashbots Protect on Base
- Includes signature header for authentication
- Recommended for production use

#### Bundle Mode (`PRIVATE_TX_MODE=bundle`)
- Reserved for future multi-transaction bundle support
- Will use `eth_sendBundle` for atomic multi-step operations
- Not yet implemented

### Example Configuration

```bash
# Enable Flashbots Protect-style private relay
PRIVATE_TX_RPC_URL=https://protect.flashbots.net/v1/rpc
PRIVATE_TX_MODE=protect
PRIVATE_TX_SIGNATURE_RANDOM=true
PRIVATE_TX_MAX_RETRIES=2
PRIVATE_TX_FALLBACK_MODE=race

# Public RPC endpoints for fallback (race mode)
WRITE_RPCS=https://mainnet.base.org,https://base.llamarpc.com,https://base-mainnet.g.alchemy.com/v2/YOUR_KEY
```

## Decision Flow

```
Transaction Ready
       │
       ├─► Private Relay Enabled? ──No──► Public Broadcast
       │                                       │
      Yes                                      └─► Done
       │
       ├─► Attempt 1: eth_sendPrivateTransaction
       │                │
       │                ├─► Success ──► Done
       │                └─► Failure
       │
       ├─► Attempt 2-N: Retry with Backoff
       │                │
       │                ├─► Success ──► Done
       │                └─► Max Retries
       │
       └─► Fallback Mode
              │
              ├─► Race Mode: Broadcast to all WRITE_RPCS in parallel
              │                │
              │                └─► First Success ──► Done
              │
              └─► Direct Mode: Broadcast to primary RPC
                                 │
                                 └─► Done
```

## Logging

### Initialization
```
[private-relay] Configuration: { mode: 'protect', rpcUrlHost: 'protect.flashbots.net', signatureRandom: true, maxRetries: 2, fallbackMode: 'race' }
```

### Submission Attempt
```
[private-relay] submit { user: '0x123...', mode: 'protect', triggerType: 'watched_fastpath', size: 1234 }
```

### Success
```
[private-relay] result { user: '0x123...', hash: '0xabc...', latency: '120ms', attempt: 1 }
```

### Fallback
```
[private-relay] fallback { user: '0x123...', reason: 'RPC_TIMEOUT', mode: 'race', error: 'Request timeout' }
```

## Metrics

Private relay operations are tracked with Prometheus metrics exposed at `/metrics`:

### Counters

- `liquidbot_private_tx_attempts_total{mode}` - Total private submission attempts
- `liquidbot_private_tx_success_total{mode}` - Successful private submissions
- `liquidbot_private_tx_fallback_total{reason}` - Fallback activations by reason

### Histogram

- `liquidbot_private_tx_latency_ms` - Submission latency distribution (buckets: 10, 25, 50, 100, 250, 500, 1000, 2000, 5000ms)

### Example Queries

**Success Rate**:
```promql
rate(liquidbot_private_tx_success_total[5m]) / rate(liquidbot_private_tx_attempts_total[5m])
```

**P95 Latency**:
```promql
histogram_quantile(0.95, rate(liquidbot_private_tx_latency_ms_bucket[5m]))
```

**Fallback Rate by Reason**:
```promql
rate(liquidbot_private_tx_fallback_total[5m])
```

## Troubleshooting

### Private Submission Always Fails

**Symptoms**: All private attempts fail, always using fallback

**Possible Causes**:
1. Invalid `PRIVATE_TX_RPC_URL`
2. Network connectivity issues
3. Relay endpoint down or rate-limited

**Solutions**:
- Verify RPC URL is correct and accessible
- Check network logs for connection errors
- Monitor relay endpoint status
- Increase `PRIVATE_TX_MAX_RETRIES` temporarily

### High Fallback Rate

**Symptoms**: Metrics show frequent fallback usage

**Possible Causes**:
1. Relay latency too high
2. Insufficient retry attempts
3. Network instability

**Solutions**:
- Review latency metrics
- Increase `PRIVATE_TX_MAX_RETRIES` from 2 to 3-4
- Consider switching to `direct` fallback mode for faster failover
- Verify relay endpoint performance

### Transactions Not Mined

**Symptoms**: Private submissions succeed but transactions don't appear on-chain

**Possible Causes**:
1. Relay not forwarding to builders
2. Transaction gas price too low
3. Bundle not included

**Solutions**:
- Wait longer - private transactions may take extra time
- Check relay documentation for submission requirements
- Verify gas price settings
- Enable `PRIVATE_TX_FALLBACK_MODE=direct` for guaranteed submission

### Configuration Not Applied

**Symptoms**: Logs show "Private relay disabled"

**Possible Causes**:
1. `PRIVATE_TX_MODE` not set or set to `disabled`
2. `PRIVATE_TX_RPC_URL` not set
3. Missing `EXECUTION_PRIVATE_KEY` or `RPC_URL`

**Solutions**:
- Verify environment variables are set correctly
- Check `.env` file is loaded
- Ensure execution service is properly initialized

## Performance Considerations

### Latency Impact

Private relay adds minimal latency:
- **Local Validation**: <1ms
- **RPC Call**: 50-200ms (typical)
- **Retry Overhead**: 100-400ms (on failure with backoff)

### Best Practices

1. **Monitor Metrics**: Track success rate and latency
2. **Tune Retries**: Balance between persistence and speed
3. **Use Race Mode**: For critical liquidations requiring high reliability
4. **Test Thoroughly**: Use `DRY_RUN_EXECUTION=true` during setup
5. **Signature Randomization**: Enable `PRIVATE_TX_SIGNATURE_RANDOM` for privacy

## Future Enhancements

### Bundle Support (Coming Soon)

Multi-transaction atomic bundles for complex liquidations:

```bash
PRIVATE_TX_MODE=bundle
```

**Use Cases**:
- Multi-step liquidation + collateral swap + repay
- Coordinated position unwinding
- Flash loan orchestration

### Adaptive Mode Switching

Automatic mode selection based on performance:

```bash
PRIVATE_TX_ADAPTIVE=true
PRIVATE_TX_SUCCESS_THRESHOLD=0.85  # Switch to public if success rate < 85%
```

### Multi-Key Rotation

Nonce partitioning for parallel private submissions:

```bash
PRIVATE_TX_KEYS=key1,key2,key3  # Round-robin or hash-based selection
```

## References

- [Flashbots Protect Documentation](https://docs.flashbots.net/flashbots-protect/overview)
- [Base Network Documentation](https://docs.base.org/)
- [ExecutionService Integration](../src/services/ExecutionService.ts)
- [PrivateRelayService Source](../src/relay/PrivateRelayService.ts)

## Support

For issues or questions:
1. Check logs for error details
2. Review metrics for patterns
3. Consult troubleshooting section
4. Open GitHub issue with logs and metrics
