/**
 * Demonstration script for BorrowersIndexService modes
 * Shows how the service behaves with different configurations
 */

import { parseBoolEnv, parseIntEnv } from '../src/config/parseEnv.js';

// eslint-disable-next-line no-console
console.log('=== BorrowersIndexService Mode Demonstration ===\n');

// Test boolean parsing
// eslint-disable-next-line no-console
console.log('1. Boolean Parsing Tests:');
// eslint-disable-next-line no-console
console.log('   parseBoolEnv("false") =>', parseBoolEnv('false'));
// eslint-disable-next-line no-console
console.log('   parseBoolEnv("0") =>', parseBoolEnv('0'));
// eslint-disable-next-line no-console
console.log('   parseBoolEnv("") =>', parseBoolEnv(''));
// eslint-disable-next-line no-console
console.log('   parseBoolEnv("true") =>', parseBoolEnv('true'));
// eslint-disable-next-line no-console
console.log('   parseBoolEnv("1") =>', parseBoolEnv('1'));
// eslint-disable-next-line no-console
console.log('   parseBoolEnv("yes") =>', parseBoolEnv('yes'));
// eslint-disable-next-line no-console
console.log('   parseBoolEnv(undefined, true) =>', parseBoolEnv(undefined, true));

// Test integer parsing
// eslint-disable-next-line no-console
console.log('\n2. Integer Parsing Tests:');
// eslint-disable-next-line no-console
console.log('   parseIntEnv("50000", 10000) =>', parseIntEnv('50000', 10000));
// eslint-disable-next-line no-console
console.log('   parseIntEnv("invalid", 10000) =>', parseIntEnv('invalid', 10000));
// eslint-disable-next-line no-console
console.log('   parseIntEnv(undefined, 10000) =>', parseIntEnv(undefined, 10000));

// Show mode scenarios
// eslint-disable-next-line no-console
console.log('\n3. BorrowersIndexService Mode Scenarios:');
// eslint-disable-next-line no-console
console.log('   Scenario A: BORROWERS_INDEX_ENABLED=false (or unset)');
// eslint-disable-next-line no-console
console.log('   → Service NOT instantiated');
// eslint-disable-next-line no-console
console.log('   → No Redis connection attempts');
// eslint-disable-next-line no-console
console.log('   → No logs emitted');

// eslint-disable-next-line no-console
console.log('\n   Scenario B: BORROWERS_INDEX_ENABLED=true, no Redis URL');
// eslint-disable-next-line no-console
console.log('   → Service runs in MEMORY mode');
// eslint-disable-next-line no-console
console.log('   → Log: [borrowers-index] memory mode (no Redis URL configured)');
// eslint-disable-next-line no-console
console.log('   → No Redis connection attempts');

// eslint-disable-next-line no-console
console.log('\n   Scenario C: BORROWERS_INDEX_ENABLED=true, Redis URL set & connects');
// eslint-disable-next-line no-console
console.log('   → Service runs in REDIS mode');
// eslint-disable-next-line no-console
console.log('   → Log: [borrowers-index] redis mode');
// eslint-disable-next-line no-console
console.log('   → Persistent storage via Redis');

// eslint-disable-next-line no-console
console.log('\n   Scenario D: BORROWERS_INDEX_ENABLED=true, Redis URL set but ECONNREFUSED');
// eslint-disable-next-line no-console
console.log('   → Service falls back to MEMORY mode');
// eslint-disable-next-line no-console
console.log('   → Log: [borrowers-index] Redis connection failed, switching to memory mode');
// eslint-disable-next-line no-console
console.log('   → SINGLE warning only (no spam)');
// eslint-disable-next-line no-console
console.log('   → No reconnection attempts');

// eslint-disable-next-line no-console
console.log('\n=== Demonstration Complete ===');
