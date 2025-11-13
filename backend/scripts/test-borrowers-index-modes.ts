#!/usr/bin/env tsx
/**
 * test-borrowers-index-modes.ts - Test script for Borrowers Index configuration
 * 
 * Demonstrates the use of parseBoolEnv and parseBoolEnvVar functions
 * for reading environment variables related to the Borrowers Index feature.
 */

import { parseBoolEnv, parseBoolEnvVar } from '../src/config/parseEnv.js';

console.log('=== Borrowers Index Configuration Test ===\n');

// Test parseBoolEnvVar - reads directly from process.env
console.log('1. Testing parseBoolEnvVar (reads from process.env):');
const enabled = parseBoolEnvVar('BORROWERS_INDEX_ENABLED', false);
console.log(`   BORROWERS_INDEX_ENABLED: ${enabled}`);

// Test parseBoolEnv with explicit values
console.log('\n2. Testing parseBoolEnv with explicit values:');
const testValues = ['true', 'false', '1', '0', 'yes', 'no', '', undefined];

for (const value of testValues) {
  const result = parseBoolEnv(value);
  console.log(`   parseBoolEnv(${JSON.stringify(value)}): ${result}`);
}

// Test with custom default
console.log('\n3. Testing parseBoolEnv with custom default (true):');
const undefinedWithDefault = parseBoolEnv(undefined, true);
const emptyWithDefault = parseBoolEnv('', true);
console.log(`   parseBoolEnv(undefined, true): ${undefinedWithDefault}`);
console.log(`   parseBoolEnv('', true): ${emptyWithDefault}`);

// Test reading Borrowers Index mode
console.log('\n4. Testing Borrowers Index Mode configuration:');
const mode = process.env.BORROWERS_INDEX_MODE || 'memory';
console.log(`   BORROWERS_INDEX_MODE: ${mode}`);

// Test all Borrowers Index related environment variables
console.log('\n5. All Borrowers Index environment variables:');
const borrowersConfig = {
  enabled: parseBoolEnvVar('BORROWERS_INDEX_ENABLED', false),
  mode: process.env.BORROWERS_INDEX_MODE || 'memory',
  redisUrl: process.env.BORROWERS_INDEX_REDIS_URL,
  maxUsersPerReserve: parseInt(process.env.BORROWERS_INDEX_MAX_USERS_PER_RESERVE || '3000', 10),
  backfillBlocks: parseInt(process.env.BORROWERS_INDEX_BACKFILL_BLOCKS || '50000', 10),
  chunkBlocks: parseInt(process.env.BORROWERS_INDEX_CHUNK_BLOCKS || '2000', 10)
};

console.log(JSON.stringify(borrowersConfig, null, 2));

console.log('\n=== Test Complete ===');
