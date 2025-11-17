/**
 * OCR Feed Evaluator
 * Script to evaluate and monitor Chainlink OCR price feeds on Base
 */

import { JsonRpcProvider, getAddress, Contract } from 'ethers';

// Environment configuration
const RPC_URL = process.env.RPC_URL || 'https://mainnet.base.org';
const AGGREGATOR_ADDRESSES = [
  '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70', // USDC/USD
  '0x591e79239a7d679378eC8c847e5038150364C78F', // ETH/USD
];

interface FeedData {
  address: string;
  answer: bigint;
  startedAt: bigint;
  updatedAt: bigint;
  answeredInRound: bigint;
}

interface EvaluationResult {
  aggregator: string;
  latestRound: FeedData;
  isHealthy: boolean;
  lastUpdateAge: number;
}

// Aggregator V3 Interface ABI (simplified)
const AGGREGATOR_ABI = [
  'function decimals() view returns (uint8)',
  'function description() view returns (string)',
  'function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
  'function getRoundData(uint80 _roundId) view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
];

/**
 * Normalize an address to checksum format
 */
function normalizeAddress(address: string): string {
  try {
    return getAddress(address);
  } catch (error) {
    throw new Error(`Invalid address: ${address}`);
  }
}

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options: {
    aggregators?: string[];
    minUpdateInterval?: number;
    verbose?: boolean;
  } = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--aggregator' || arg === '-a') {
      const addresses = args[++i]?.split(',') || [];
      options.aggregators = addresses;
    } else if (arg === '--min-interval' || arg === '-i') {
      options.minUpdateInterval = parseInt(args[++i] || '300', 10);
    } else if (arg === '--verbose' || arg === '-v') {
      options.verbose = true;
    }
  }

  return options;
}

/**
 * Create provider instance
 */
function createProvider(): JsonRpcProvider {
  return new JsonRpcProvider(RPC_URL);
}

/**
 * Fetch latest round data from an aggregator
 */
async function fetchLatestRoundData(
  provider: JsonRpcProvider,
  aggregatorAddress: string
): Promise<FeedData> {
  const contract = new Contract(aggregatorAddress, AGGREGATOR_ABI, provider);

  const [roundId, answer, startedAt, updatedAt, answeredInRound] = 
    await contract.latestRoundData();

  return {
    address: aggregatorAddress,
    answer: BigInt(answer.toString()),
    startedAt: BigInt(startedAt.toString()),
    updatedAt: BigInt(updatedAt.toString()),
    answeredInRound: BigInt(answeredInRound.toString()),
  };
}

/**
 * Evaluate feed health
 */
function evaluateFeedHealth(
  feedData: FeedData,
  minUpdateInterval: number = 300
): boolean {
  const now = Math.floor(Date.now() / 1000);
  const lastUpdateAge = now - Number(feedData.updatedAt);

  // Feed is healthy if updated within the minimum interval
  return lastUpdateAge <= minUpdateInterval && feedData.answer > 0n;
}

/**
 * Evaluate a single aggregator
 */
async function evaluateAggregator(
  provider: JsonRpcProvider,
  aggregatorAddress: string,
  minUpdateInterval: number,
  verbose: boolean
): Promise<EvaluationResult> {
  const feedData = await fetchLatestRoundData(provider, aggregatorAddress);
  const isHealthy = evaluateFeedHealth(feedData, minUpdateInterval);
  const now = Math.floor(Date.now() / 1000);
  const lastUpdateAge = now - Number(feedData.updatedAt);

  if (verbose) {
    console.log(`\nAggregator: ${aggregatorAddress}`);
    console.log(`  Answer: ${feedData.answer}`);
    console.log(`  Updated At: ${new Date(Number(feedData.updatedAt) * 1000).toISOString()}`);
    console.log(`  Age: ${lastUpdateAge}s`);
    console.log(`  Healthy: ${isHealthy ? '✓' : '✗'}`);
  }

  return {
    aggregator: aggregatorAddress,
    latestRound: feedData,
    isHealthy,
    lastUpdateAge,
  };
}

/**
 * Normalize addresses with checksums
 */
function normalizeAddresses(addresses: string[]): string[] {
  return addresses.map(addr => getAddress(addr));
}

/**
 * Main evaluation function
 */
async function main() {
  const options = parseArgs();
  const aggregators = options.aggregators?.length 
    ? normalizeAddresses(options.aggregators)
    : AGGREGATOR_ADDRESSES.map(addr => getAddress(addr));
  
  const minUpdateInterval = options.minUpdateInterval || 300;
  const verbose = options.verbose || false;

  console.log('OCR Feed Evaluator');
  console.log('==================');
  console.log(`RPC URL: ${RPC_URL}`);
  console.log(`Evaluating ${aggregators.length} aggregator(s)...`);

  const provider = createProvider();

  // Setup block listener for real-time monitoring
  console.log('\nMonitoring for new blocks...');
  provider.on('block', async (blockNumber: number) => {
    if (verbose) {
      console.log(`\n[Block ${blockNumber}] Checking feeds...`);
    }

    const results: EvaluationResult[] = [];
    for (const aggregatorAddress of aggregators) {
      try {
        const result = await evaluateAggregator(
          provider,
          aggregatorAddress,
          minUpdateInterval,
          verbose
        );
        results.push(result);
      } catch (error) {
        console.error(`Error evaluating ${aggregatorAddress}:`, error);
      }
    }

    const unhealthyFeeds = results.filter(r => !r.isHealthy);
    if (unhealthyFeeds.length > 0) {
      console.log(`\n⚠️  ${unhealthyFeeds.length} unhealthy feed(s) detected at block ${blockNumber}`);
      unhealthyFeeds.forEach(feed => {
        console.log(`  - ${feed.aggregator}: Last update ${feed.lastUpdateAge}s ago`);
      });
    }
  });

  // Initial evaluation
  console.log('\nInitial Evaluation:');
  console.log('-------------------');
  
  const results: EvaluationResult[] = [];
  for (const aggregatorAddress of aggregators) {
    try {
      const result = await evaluateAggregator(
        provider,
        aggregatorAddress,
        minUpdateInterval,
        verbose
      );
      results.push(result);
    } catch (error) {
      console.error(`Error evaluating ${aggregatorAddress}:`, error);
    }
  }

  const healthyCount = results.filter(r => r.isHealthy).length;
  const unhealthyCount = results.filter(r => !r.isHealthy).length;

  console.log(`\n✓ Healthy: ${healthyCount}`);
  console.log(`✗ Unhealthy: ${unhealthyCount}`);

  if (unhealthyCount > 0) {
    console.log('\nUnhealthy Feeds:');
    results
      .filter(r => !r.isHealthy)
      .forEach(feed => {
        console.log(`  - ${feed.aggregator}: Last update ${feed.lastUpdateAge}s ago`);
      });
  }

  // Keep process alive for monitoring
  console.log('\nPress Ctrl+C to exit...');
}

// Run the evaluator
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
