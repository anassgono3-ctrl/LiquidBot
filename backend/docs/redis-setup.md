# Redis Setup Guide

This guide covers Redis installation, configuration, and best practices for the LiquidBot high-performance cache layer.

## Overview

Redis serves as the L2 cache and coordination layer for:
- Borrower state snapshots with read-through/write-behind patterns
- Borrower indices per reserve (sorted sets)
- Hotset and predictive candidate queues
- Dirty event streams and deduplication
- Calldata precompute cache
- Price/rate ring buffers
- Distributed locks and idempotency tracking

## Installation

### Docker (Recommended)

```bash
# Pull Redis image
docker pull redis:7-alpine

# Run Redis with persistence
docker run -d \
  --name liquidbot-redis \
  -p 6379:6379 \
  -v redis-data:/data \
  redis:7-alpine redis-server --appendonly yes

# Verify connection
docker exec -it liquidbot-redis redis-cli ping
# Expected: PONG
```

### Native Installation (Ubuntu/Debian)

```bash
# Install Redis
sudo apt update
sudo apt install redis-server

# Start Redis service
sudo systemctl start redis-server
sudo systemctl enable redis-server

# Verify
redis-cli ping
# Expected: PONG
```

### macOS

```bash
# Install via Homebrew
brew install redis

# Start Redis
brew services start redis

# Verify
redis-cli ping
```

## Configuration

### Environment Variables

Add to your `.env` file:

```env
# Redis connection URL
REDIS_URL=redis://127.0.0.1:6379

# Enable pipelining for batch operations (default: true)
REDIS_ENABLE_PIPELINING=true

# Maximum commands per pipeline batch (default: 500)
REDIS_MAX_PIPELINE=500

# Enable MessagePack compression for cache payloads (default: false)
RISK_CACHE_COMPRESS=false

# Borrowers Index Redis backend
BORROWERS_INDEX_MODE=redis
BORROWERS_INDEX_REDIS_URL=redis://127.0.0.1:6379
```

### Redis Server Configuration

For production use, tune Redis settings in `redis.conf`:

```conf
# Memory
maxmemory 2gb
maxmemory-policy allkeys-lru

# Persistence (balance durability vs performance)
save 900 1
save 300 10
save 60 10000
appendonly yes
appendfsync everysec

# Performance
tcp-backlog 511
timeout 300
tcp-keepalive 300
maxclients 10000
```

## Key Namespaces

The bot uses these Redis key patterns:

| Pattern | Type | TTL | Description |
|---------|------|-----|-------------|
| `borrower:state:{address}` | String (JSON) | 20s | User snapshot cache |
| `reserve:borrowers:zset:{reserve}` | Sorted Set | Persistent | Borrowers per reserve |
| `reserve:top:zset:{reserve}` | Sorted Set | Persistent | Top borrowers by debt |
| `hotset:zset` | Sorted Set | Persistent | Hot candidates by HF |
| `predictive:eta:zset` | Sorted Set | Persistent | Predictive candidates by ETA |
| `dirty:stream` | Stream | N/A | Event processing queue |
| `dirty:seen:{block}` | Set | 60s | Deduplication tracking |
| `liquidation:calldata:{address}` | String (RLP) | 20-60s | Precomputed calldata |
| `price:series:{symbol}` | List | Persistent | Price history (last 60) |
| `rate:index:{reserve}` | List | Persistent | Rate index history |
| `lock:compute:{address}` | String | 1.2s | Computation lock |
| `tx:sent:{user}:{block}` | String | 60s | Idempotency key |

## Memory Sizing

Estimate memory requirements:

```
Base overhead: 200 MB
+ (100K users × 1 KB/user) = 100 MB
+ (20 reserves × 10K borrowers × 100 bytes) = 20 MB
+ Price/rate series (100 assets × 60 points × 100 bytes) = 600 KB
+ Hotset/predictive (5K entries × 500 bytes) = 2.5 MB
+ Calldata cache (500 entries × 2 KB) = 1 MB
+ Overhead/fragmentation: 50 MB
≈ 400 MB baseline

Recommended: 1-2 GB for production with headroom
```

## Health Checks

### Basic Connectivity

```bash
# Ping Redis
redis-cli ping

# Check info
redis-cli info | grep connected_clients
redis-cli info | grep used_memory_human
```

### Key Inspection

```bash
# Count keys by pattern
redis-cli --scan --pattern "borrower:state:*" | wc -l
redis-cli --scan --pattern "hotset:*" | wc -l

# Inspect sorted set
redis-cli ZRANGE hotset:zset 0 10 WITHSCORES

# Check stream length
redis-cli XLEN dirty:stream

# Monitor real-time commands
redis-cli MONITOR
```

### Performance Monitoring

```bash
# Check slowlog
redis-cli SLOWLOG GET 10

# Monitor latency
redis-cli --latency

# Check hit rate
redis-cli INFO stats | grep keyspace
```

## Troubleshooting

### Connection Errors

```bash
# Test connectivity
redis-cli -h 127.0.0.1 -p 6379 ping

# Check if Redis is running
sudo systemctl status redis-server  # Linux
brew services info redis            # macOS
docker ps | grep redis              # Docker
```

### Memory Issues

```bash
# Check memory usage
redis-cli INFO memory

# Clear specific patterns (BE CAREFUL!)
redis-cli --scan --pattern "borrower:state:*" | xargs redis-cli DEL

# Flush all (DANGEROUS - use only in dev)
redis-cli FLUSHALL
```

### Performance Issues

```bash
# Check slow queries
redis-cli SLOWLOG GET 100

# Monitor commands
redis-cli MONITOR | head -100

# Check connected clients
redis-cli CLIENT LIST
```

## Best Practices

1. **Always use TTLs** for transient data to prevent memory bloat
2. **Monitor memory usage** and set `maxmemory` with appropriate eviction policy
3. **Use pipelining** for batch operations to reduce round trips
4. **Avoid large values** - keep individual values under 1 MB
5. **Use sorted sets** for ranking/priority queries instead of loading all data
6. **Enable persistence** (AOF + RDB) for production
7. **Regular backups** of RDB file for disaster recovery
8. **Secure Redis** - bind to localhost or use authentication if exposed

## CLI Quick Reference

```bash
# Connect
redis-cli

# Keys
GET key
SET key value EX 60
DEL key
EXISTS key
KEYS pattern
SCAN cursor MATCH pattern

# Sorted Sets
ZADD key score member
ZRANGE key start stop WITHSCORES
ZRANGEBYSCORE key min max
ZREM key member
ZCARD key

# Streams
XADD stream * field1 value1
XREAD COUNT 10 STREAMS stream 0
XLEN stream

# Lists
LPUSH key value
LRANGE key 0 -1
LTRIM key 0 59

# Sets
SADD key member
SMEMBERS key
SISMEMBER key member
```

## Production Checklist

- [ ] Redis server installed and running
- [ ] Persistence enabled (AOF + RDB snapshots)
- [ ] `maxmemory` configured with LRU eviction
- [ ] Network security (bind to localhost or firewall rules)
- [ ] Monitoring and alerting for memory/CPU/latency
- [ ] Backup strategy for RDB files
- [ ] Log rotation configured
- [ ] Connection pooling configured in application
- [ ] TTLs set for all transient keys
- [ ] Tested failover/recovery procedures
