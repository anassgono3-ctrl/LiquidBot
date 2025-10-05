# Aave V3 Base Subgraph Queries

## Overview

This document provides validated GraphQL queries for the Aave V3 Base subgraph. These queries are essential for monitoring positions, detecting liquidation risks, and gathering historical data for the LiquidBot protection service.

## Subgraph Endpoint

```
https://api.thegraph.com/subgraphs/name/aave/protocol-v3-base
```

### Alternative Endpoints

- **Mainnet**: `https://api.thegraph.com/subgraphs/name/aave/protocol-v3`
- **Arbitrum**: `https://api.thegraph.com/subgraphs/name/aave/protocol-v3-arbitrum`
- **Optimism**: `https://api.thegraph.com/subgraphs/name/aave/protocol-v3-optimism`

---

## Schema Corrections Applied

The queries in this document have been corrected to align with the actual Aave V3 subgraph schema:

### Field Name Corrections
- ✅ `collateralAsset` → `collateralReserve`
- ✅ `principalAsset` → `principalReserve`
- ✅ `liquidationThreshold` → `reserveLiquidationThreshold`
- ✅ `liquidationBonus` → `reserveLiquidationBonus`

### Removed Unsupported Fields
- ❌ `blockNumber` (not available in liquidationCalls)
- ❌ `collateralReservesCount` (not in user entity)
- ❌ `totalDebt` (calculated field, not stored)

### Fixed Syntax
- ✅ Removed quoted integers in timestamp filters
- ✅ Corrected nested object access patterns

---

## Core Queries

### 1. Liquidation Events Query

Retrieves recent liquidation events for analysis and pattern detection.

```graphql
{
  liquidationCalls(
    first: 1000
    orderBy: timestamp
    orderDirection: desc
    where: { timestamp_gte: 1728043200 }
  ) {
    id
    timestamp
    user {
      id
    }
    collateralReserve {
      symbol
      decimals
    }
    collateralAmount
    principalReserve {
      symbol
      decimals
    }
    principalAmount
    liquidator
    txHash
  }
}
```

**Use Case**: Historical liquidation analysis, pattern detection, liquidator behavior

**Filters**:
- `timestamp_gte`: Unix timestamp (e.g., 1728043200 = October 4, 2024)
- `first`: Number of results (max 1000 per query)

**Returns**:
- Liquidation transaction details
- Collateral and debt amounts
- User and liquidator addresses
- Transaction hash for verification

---

### 2. Active Users with Debt

Retrieves users with active borrowing positions for monitoring.

```graphql
{
  users(
    first: 500
    where: { borrowedReservesCount_gt: 0 }
  ) {
    id
    borrowedReservesCount
    reserves {
      currentATokenBalance
      currentVariableDebt
      currentStableDebt
      reserve {
        symbol
        decimals
        reserveLiquidationThreshold
        reserveLiquidationBonus
        usageAsCollateralEnabled
        price {
          priceInEth
        }
      }
    }
  }
}
```

**Use Case**: Position monitoring, health factor calculation, risk detection

**Filters**:
- `borrowedReservesCount_gt: 0`: Only users with debt
- `first`: Number of results (max 1000 per query)

**Returns**:
- User address and position details
- Collateral balances (aTokens)
- Debt amounts (variable and stable)
- Reserve parameters for health factor calculation

**Pagination**: Use `skip` parameter for subsequent pages:
```graphql
{
  users(
    first: 500
    skip: 500
    where: { borrowedReservesCount_gt: 0 }
  ) {
    # ... same fields
  }
}
```

---

### 3. Reserve Information

Retrieves detailed information about available reserves (assets).

```graphql
{
  reserves(
    first: 50
    where: { usageAsCollateralEnabled: true }
  ) {
    id
    symbol
    name
    decimals
    reserveLiquidationThreshold
    reserveLiquidationBonus
    totalLiquidity
    availableLiquidity
    price {
      priceInEth
    }
    lastUpdateTimestamp
  }
}
```

**Use Case**: Collateral optimization, available liquidity checks, reserve parameters

**Filters**:
- `usageAsCollateralEnabled: true`: Only assets that can be used as collateral

**Returns**:
- Reserve metadata (symbol, name, decimals)
- Liquidation parameters
- Liquidity availability
- Current price in ETH

---

### 4. Historical Liquidation Analysis

Retrieves liquidation history for trend analysis.

```graphql
{
  liquidationCallHistories: liquidationCalls(
    first: 100
    orderBy: timestamp
    orderDirection: desc
    where: { timestamp_gte: 1725379200 }
  ) {
    timestamp
    principalAmount
    collateralAmount
    user {
      id
    }
  }
}
```

**Use Case**: Liquidation frequency analysis, high-risk period identification

**Time Windows**:
- Last 7 days: `timestamp_gte: <current_timestamp - 604800>`
- Last 30 days: `timestamp_gte: <current_timestamp - 2592000>`
- Last 90 days: `timestamp_gte: <current_timestamp - 7776000>`

---

## Advanced Queries

### 5. User Position Detail

Retrieves comprehensive position details for a specific user.

```graphql
{
  user(id: "0x1234567890abcdef1234567890abcdef12345678") {
    id
    borrowedReservesCount
    reserves {
      currentATokenBalance
      currentVariableDebt
      currentStableDebt
      reserve {
        symbol
        decimals
        reserveLiquidationThreshold
        reserveLiquidationBonus
        price {
          priceInEth
        }
      }
    }
  }
}
```

**Use Case**: Individual position monitoring, user-specific alerts

**Parameters**:
- `id`: User wallet address (lowercase, checksummed address)

---

### 6. Reserve Utilization

Retrieves reserve utilization and liquidity data.

```graphql
{
  reserves(first: 50) {
    id
    symbol
    totalLiquidity
    availableLiquidity
    totalVariableDebt
    totalStableDebt
    utilizationRate
    liquidityRate
    variableBorrowRate
    stableBorrowRate
  }
}
```

**Use Case**: Flash loan availability, market conditions assessment

**Calculated Fields**:
- `utilizationRate`: Percentage of reserve borrowed
- `liquidityRate`: Supply APY
- `variableBorrowRate`: Variable borrow APY
- `stableBorrowRate`: Stable borrow APY

---

### 7. Recent Protocol Activity

Retrieves recent user actions (deposits, borrows, repays, withdrawals).

```graphql
{
  deposits: deposits(first: 100, orderBy: timestamp, orderDirection: desc) {
    id
    timestamp
    user {
      id
    }
    reserve {
      symbol
    }
    amount
  }
  
  borrows: borrows(first: 100, orderBy: timestamp, orderDirection: desc) {
    id
    timestamp
    user {
      id
    }
    reserve {
      symbol
    }
    amount
  }
  
  repays: repays(first: 100, orderBy: timestamp, orderDirection: desc) {
    id
    timestamp
    user {
      id
    }
    reserve {
      symbol
    }
    amount
  }
}
```

**Use Case**: Activity monitoring, user behavior analysis

---

## Batch Queries

### 8. Complete Position Monitoring Dataset

Combines multiple queries for comprehensive monitoring.

```graphql
{
  # Active users with debt
  users(
    first: 500
    where: { borrowedReservesCount_gt: 0 }
  ) {
    id
    borrowedReservesCount
    reserves {
      currentATokenBalance
      currentVariableDebt
      currentStableDebt
      reserve {
        symbol
        decimals
        reserveLiquidationThreshold
        reserveLiquidationBonus
        usageAsCollateralEnabled
        price {
          priceInEth
        }
      }
    }
  }
  
  # Reserve information
  reserves(
    first: 50
    where: { usageAsCollateralEnabled: true }
  ) {
    id
    symbol
    name
    decimals
    reserveLiquidationThreshold
    reserveLiquidationBonus
    totalLiquidity
    availableLiquidity
    price {
      priceInEth
    }
    lastUpdateTimestamp
  }
  
  # Recent liquidations
  liquidationCalls(
    first: 100
    orderBy: timestamp
    orderDirection: desc
    where: { timestamp_gte: 1725379200 }
  ) {
    id
    timestamp
    user {
      id
    }
    collateralReserve {
      symbol
    }
    collateralAmount
    principalReserve {
      symbol
    }
    principalAmount
    liquidator
    txHash
  }
}
```

**Use Case**: Single query for monitoring dashboard, reduces API calls

**Performance Considerations**:
- Combine related queries to minimize HTTP requests
- Use pagination for large datasets
- Cache results when appropriate

---

## Smoke Test Queries

Use these minimal queries to verify subgraph connectivity and health.

### Test 1: Reserves List

```graphql
{
  reserves(first: 5) {
    id
    symbol
    name
  }
}
```

**Expected Result**: List of 5 reserves with symbols (e.g., WETH, USDC, DAI)

### Test 2: Recent Liquidations

```graphql
{
  liquidationCalls(first: 10) {
    id
    timestamp
    liquidator
    principalAmount
  }
}
```

**Expected Result**: List of up to 10 recent liquidation events

### Test 3: User Count

```graphql
{
  users(first: 1) {
    id
    borrowedReservesCount
  }
}
```

**Expected Result**: At least one user with position data

---

## Health Factor Calculation

The health factor is not directly available in the subgraph. Calculate it client-side using:

### Formula

```
Health Factor = (Total Collateral in ETH × Average Liquidation Threshold) / Total Debt in ETH
```

### Calculation Steps

1. **Get User Position Data**:
```graphql
{
  user(id: "0x...") {
    reserves {
      currentATokenBalance
      currentVariableDebt
      currentStableDebt
      reserve {
        symbol
        decimals
        reserveLiquidationThreshold
        price {
          priceInEth
        }
      }
    }
  }
}
```

2. **Calculate Total Collateral in ETH**:
```javascript
const totalCollateralETH = user.reserves.reduce((sum, reserve) => {
  if (reserve.reserve.usageAsCollateralEnabled) {
    const balanceETH = (reserve.currentATokenBalance / 10**reserve.reserve.decimals) 
                       * reserve.reserve.price.priceInEth;
    return sum + balanceETH;
  }
  return sum;
}, 0);
```

3. **Calculate Weighted Average Liquidation Threshold**:
```javascript
const weightedLiquidationThreshold = user.reserves.reduce((sum, reserve) => {
  if (reserve.reserve.usageAsCollateralEnabled) {
    const balanceETH = (reserve.currentATokenBalance / 10**reserve.reserve.decimals) 
                       * reserve.reserve.price.priceInEth;
    const threshold = reserve.reserve.reserveLiquidationThreshold / 10000; // Convert basis points
    return sum + (balanceETH * threshold);
  }
  return sum;
}, 0) / totalCollateralETH;
```

4. **Calculate Total Debt in ETH**:
```javascript
const totalDebtETH = user.reserves.reduce((sum, reserve) => {
  const debt = reserve.currentVariableDebt + reserve.currentStableDebt;
  const debtETH = (debt / 10**reserve.reserve.decimals) * reserve.reserve.price.priceInEth;
  return sum + debtETH;
}, 0);
```

5. **Calculate Health Factor**:
```javascript
const healthFactor = (totalCollateralETH * weightedLiquidationThreshold) / totalDebtETH;
```

### Interpretation

- **Health Factor > 1.5**: Healthy position
- **Health Factor 1.1 - 1.5**: Moderate risk (monitoring threshold)
- **Health Factor 1.05 - 1.1**: High risk (alert threshold)
- **Health Factor < 1.05**: Critical risk (intervention threshold)
- **Health Factor < 1.0**: Liquidation eligible

---

## Query Optimization Tips

### 1. Use Pagination
```graphql
{
  users(
    first: 500
    skip: 0  # Increment by 500 for next page
    where: { borrowedReservesCount_gt: 0 }
  ) {
    # ... fields
  }
}
```

### 2. Filter Early
Apply `where` clauses to reduce result set:
```graphql
{
  users(
    first: 500
    where: {
      borrowedReservesCount_gt: 0
      # Additional filters reduce results
    }
  ) {
    # ... fields
  }
}
```

### 3. Request Only Required Fields
Avoid fetching unnecessary data:
```graphql
# ✅ Good - minimal fields
{
  users(first: 500) {
    id
    borrowedReservesCount
  }
}

# ❌ Bad - fetching everything
{
  users(first: 500) {
    id
    borrowedReservesCount
    reserves {
      # ... all fields including nested objects
    }
  }
}
```

### 4. Use Time-Based Filters
Reduce historical data queries:
```graphql
{
  liquidationCalls(
    first: 100
    where: {
      timestamp_gte: 1728043200  # Only recent data
    }
  ) {
    # ... fields
  }
}
```

### 5. Batch Related Queries
Combine queries to reduce HTTP overhead:
```graphql
{
  query1: users(first: 100) { id }
  query2: reserves(first: 50) { symbol }
}
```

---

## Rate Limits & Best Practices

### The Graph Rate Limits
- **Free Tier**: ~1000 queries per day
- **Paid Tier**: Custom limits based on plan

### Best Practices

1. **Cache Results**: Cache reserve data and price feeds (update every 5-10 minutes)
2. **Incremental Updates**: Only query changed data using timestamp filters
3. **Batch Processing**: Process positions in batches of 500-1000
4. **Error Handling**: Implement exponential backoff on failures
5. **Monitoring**: Track query performance and response times

### Example Caching Strategy

```javascript
// Cache reserve data for 5 minutes
const CACHE_TTL = 300; // seconds
let reserveCache = null;
let cacheTimestamp = 0;

async function getReserves() {
  const now = Date.now() / 1000;
  
  if (reserveCache && (now - cacheTimestamp) < CACHE_TTL) {
    return reserveCache;
  }
  
  // Fetch fresh data
  const data = await querySubgraph(reservesQuery);
  reserveCache = data;
  cacheTimestamp = now;
  
  return data;
}
```

---

## Error Handling

### Common Errors

**1. Query Timeout**
```json
{
  "errors": [{
    "message": "query execution timeout"
  }]
}
```
**Solution**: Reduce `first` parameter or add more specific filters

**2. Invalid Field**
```json
{
  "errors": [{
    "message": "Cannot query field 'blockNumber' on type 'LiquidationCall'"
  }]
}
```
**Solution**: Use corrected queries from this document

**3. Rate Limit Exceeded**
```json
{
  "errors": [{
    "message": "rate limit exceeded"
  }]
}
```
**Solution**: Implement exponential backoff, cache results, upgrade to paid tier

### Retry Logic Example

```javascript
async function queryWithRetry(query, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(SUBGRAPH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query })
      });
      
      const data = await response.json();
      
      if (data.errors) {
        throw new Error(data.errors[0].message);
      }
      
      return data.data;
      
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      
      // Exponential backoff
      const delay = Math.pow(2, i) * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}
```

---

## Testing & Validation

### GraphQL Playground

Test queries interactively:
```
https://thegraph.com/hosted-service/subgraph/aave/protocol-v3-base
```

### CLI Testing (curl)

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"query": "{ reserves(first: 5) { id symbol name } }"}' \
  https://api.thegraph.com/subgraphs/name/aave/protocol-v3-base
```

### Validation Checklist

- [ ] Query syntax is valid (no syntax errors)
- [ ] All field names match schema (use corrected names)
- [ ] Filters use correct types (numbers not quoted)
- [ ] Pagination parameters are within limits (max 1000)
- [ ] Response time is acceptable (<5 seconds)
- [ ] Error handling is implemented

---

## Integration Examples

### Node.js + Axios

```javascript
const axios = require('axios');

const SUBGRAPH_URL = 'https://api.thegraph.com/subgraphs/name/aave/protocol-v3-base';

async function fetchActiveUsers() {
  const query = `
    {
      users(
        first: 500
        where: { borrowedReservesCount_gt: 0 }
      ) {
        id
        borrowedReservesCount
        reserves {
          currentATokenBalance
          currentVariableDebt
          currentStableDebt
          reserve {
            symbol
            decimals
            reserveLiquidationThreshold
            price { priceInEth }
          }
        }
      }
    }
  `;
  
  const response = await axios.post(SUBGRAPH_URL, { query });
  return response.data.data.users;
}
```

### Python + Requests

```python
import requests

SUBGRAPH_URL = 'https://api.thegraph.com/subgraphs/name/aave/protocol-v3-base'

def fetch_active_users():
    query = """
    {
      users(
        first: 500
        where: { borrowedReservesCount_gt: 0 }
      ) {
        id
        borrowedReservesCount
        reserves {
          currentATokenBalance
          currentVariableDebt
          currentStableDebt
          reserve {
            symbol
            decimals
            reserveLiquidationThreshold
            price { priceInEth }
          }
        }
      }
    }
    """
    
    response = requests.post(SUBGRAPH_URL, json={'query': query})
    return response.json()['data']['users']
```

---

## Changelog

### v1.0 (2024-01-15)
- Initial release with corrected schema
- Added comprehensive query examples
- Included health factor calculation
- Added optimization tips and best practices

---

## References

1. [Aave V3 Subgraph Repository](https://github.com/aave/aave-v3-subgraph)
2. [The Graph Documentation](https://thegraph.com/docs/)
3. [Aave V3 Technical Paper](https://github.com/aave/aave-v3-core/blob/master/techpaper/Aave_V3_Technical_Paper.pdf)
4. [GraphQL Best Practices](https://graphql.org/learn/best-practices/)

---

**Document Version**: 1.0  
**Last Updated**: 2024-01-15  
**Subgraph Version**: Aave V3 Base (latest)
