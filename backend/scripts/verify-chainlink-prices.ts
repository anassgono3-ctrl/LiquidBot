import 'dotenv/config';
import { ethers } from 'ethers';

import { normalizeChainlinkPrice } from '../src/utils/chainlinkMath.js';

interface FeedInfo { symbol: string; address: string; }

async function main() {
  const rpc = process.env.CHAINLINK_RPC_URL || process.env.RPC_URL;
  const feedsEnv = process.env.CHAINLINK_FEEDS;
  if (!rpc || !feedsEnv) {
    console.error('Missing CHAINLINK_RPC_URL or CHAINLINK_FEEDS.');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(rpc);
  const aggregatorAbi = [
    'function decimals() view returns (uint8)',
    'function latestRoundData() view returns (uint80 roundId,int256 answer,uint256 startedAt,uint256 updatedAt,uint80 answeredInRound)'
  ];

  const feeds: FeedInfo[] = feedsEnv.split(',').map(pair => {
    const [symbol, address] = pair.split(':').map(s => s.trim());
    return { symbol: symbol.toUpperCase(), address };
  });

  console.log('verify-chainlink-prices: Starting verification...');
  console.log(`RPC: ${rpc}`);
  console.log(`Feeds: ${feeds.map(f => f.symbol).join(', ')}\n`);

  let failures = 0;

  for (const feed of feeds) {
    try {
      const contract = new ethers.Contract(feed.address, aggregatorAbi, provider);
      const decimals: number = await contract.decimals();
      const roundData = await contract.latestRoundData();
      
      const roundId = roundData.roundId as bigint;
      const rawAnswer = roundData.answer as bigint;
      const updatedAt = roundData.updatedAt as bigint;
      const answeredInRound = roundData.answeredInRound as bigint;
      
      // Check for invalid non-positive answer
      if (rawAnswer <= 0n) {
        console.log(`❌ ${feed.symbol}: invalid non-positive answer`);
        failures++;
        continue;
      }
      
      // Check for stale data
      if (answeredInRound < roundId) {
        console.log(`⚠️  ${feed.symbol}: STALE DATA - answeredInRound=${answeredInRound} < roundId=${roundId}`);
      }
      
      // Check freshness - flag stale when > 15 minutes (900s)
      const now = BigInt(Math.floor(Date.now() / 1000));
      const age = Number(now - updatedAt);
      const isStale = age > 900; // 15 minutes
      const ageWarning = isStale ? ` (⚠️  STALE: ${age}s old, threshold: 900s)` : ` (${age}s old)`;
      
      // Safe normalization using high-precision helper with explicit Number conversion
      const normalized = normalizeChainlinkPrice(rawAnswer, decimals);
      
      // Enhanced diagnostics output
      console.log(
        `${isStale ? '⚠️ ' : '✅'} ${feed.symbol}: ` +
        `price=${normalized.toFixed(8)} ` +
        `rawAnswer=${rawAnswer.toString()} ` +
        `decimals=${decimals} ` +
        `roundId=${roundId.toString()} ` +
        `updatedAt=${updatedAt.toString()} ` +
        `updatedAgo=${age}s${isStale ? ' (STALE)' : ''}`
      );
    } catch (err) {
      console.log(`❌ ${feed.symbol}: ${(err as Error).message}`);
      failures++;
    }
  }

  console.log('\nVerification complete.');
  if (failures > 0) {
    console.log(`Failures: ${failures}`);
    process.exit(1);
  } else {
    console.log('All feeds verified successfully.');
  }
}

main().catch(err => { console.error(err); process.exit(1); });
