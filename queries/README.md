# Aave V3 Base Subgraph Queries

This directory contains validated GraphQL queries for the Aave V3 Base subgraph.

## Subgraph Endpoint

```
https://api.thegraph.com/subgraphs/name/aave/protocol-v3-base
```

## Available Queries

### 1. liquidation-events.graphql
Retrieves recent liquidation events for analysis and pattern detection.

**Use Case**: Historical liquidation analysis, pattern detection, liquidator behavior

**Variables**:
- `first`: Number of results (default: 1000, max: 1000)
- `timestamp`: Unix timestamp for filtering (e.g., 1728043200 = October 4, 2024)

### 2. active-users-with-debt.graphql
Retrieves users with active borrowing positions for monitoring.

**Use Case**: Position monitoring, health factor calculation, risk detection

**Variables**:
- `first`: Number of results (default: 500, max: 1000)
- `skip`: Pagination offset (default: 0)

### 3. reserve-information.graphql
Retrieves detailed information about available reserves (assets).

**Use Case**: Collateral optimization, available liquidity checks, reserve parameters

**Variables**:
- `first`: Number of results (default: 50)

### 4. complete-monitoring-dataset.graphql
Combines multiple queries for comprehensive monitoring in a single request.

**Use Case**: Single query for monitoring dashboard, reduces API calls

**Variables**:
- `userFirst`: Number of users (default: 500)
- `reserveFirst`: Number of reserves (default: 50)
- `liquidationFirst`: Number of liquidations (default: 100)
- `timestamp`: Unix timestamp for liquidation filtering

## Usage Examples

### Using curl

```bash
# Basic query
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"query": "{ reserves(first: 5) { id symbol name } }"}' \
  https://api.thegraph.com/subgraphs/name/aave/protocol-v3-base
```

### Using Node.js

```javascript
const axios = require('axios');
const fs = require('fs');

const SUBGRAPH_URL = 'https://api.thegraph.com/subgraphs/name/aave/protocol-v3-base';

async function executeQuery(queryFile, variables = {}) {
  const query = fs.readFileSync(queryFile, 'utf8');
  
  const response = await axios.post(SUBGRAPH_URL, {
    query,
    variables
  });
  
  return response.data.data;
}

// Example usage
executeQuery('./active-users-with-debt.graphql', {
  first: 100,
  skip: 0
}).then(data => {
  console.log('Active users:', data.users.length);
});
```

### Using Python

```python
import requests
import json

SUBGRAPH_URL = 'https://api.thegraph.com/subgraphs/name/aave/protocol-v3-base'

def execute_query(query_file, variables=None):
    with open(query_file, 'r') as f:
        query = f.read()
    
    response = requests.post(
        SUBGRAPH_URL,
        json={'query': query, 'variables': variables or {}}
    )
    
    return response.json()['data']

# Example usage
data = execute_query('./reserve-information.graphql', {'first': 20})
print(f"Reserves found: {len(data['reserves'])}")
```

## Query Optimization Tips

1. **Use Pagination**: For large datasets, use `skip` and `first` parameters
2. **Filter Early**: Apply `where` clauses to reduce result sets
3. **Request Only Required Fields**: Don't fetch unnecessary data
4. **Batch Related Queries**: Use complete-monitoring-dataset.graphql when possible
5. **Cache Results**: Cache reserve and price data (5-10 minute TTL)

## Time Window Helpers

Common Unix timestamps for filtering:

```javascript
const now = Math.floor(Date.now() / 1000);

// Last 24 hours
const last24h = now - 86400;

// Last 7 days
const last7days = now - 604800;

// Last 30 days
const last30days = now - 2592000;

// Last 90 days
const last90days = now - 7776000;
```

## Testing Queries

Test queries in the GraphQL Playground:
```
https://thegraph.com/hosted-service/subgraph/aave/protocol-v3-base
```

## Rate Limits

- **Free Tier**: ~1000 queries per day
- **Paid Tier**: Custom limits based on plan

Implement caching and exponential backoff to stay within limits.

## Additional Documentation

For detailed documentation on query structure, health factor calculation, and best practices, see:
- [SUBGRAPH_QUERIES.md](../docs/SUBGRAPH_QUERIES.md) - Comprehensive query documentation
- [ARCHITECTURE.md](../docs/ARCHITECTURE.md) - System architecture and data flow

## Support

For questions or issues with these queries:
- Check [docs/SUBGRAPH_QUERIES.md](../docs/SUBGRAPH_QUERIES.md) for detailed examples
- Open an issue on GitHub
- Join our community discussions
