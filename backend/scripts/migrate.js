#!/usr/bin/env node
/**
 * Database Migration Script
 * Applies Prisma migrations to the database
 */

import { execSync } from 'child_process';

console.log('🔄 Running database migrations...');

try {
  // Run Prisma migrate deploy in production, migrate dev in development
  const command = process.env.NODE_ENV === 'production' 
    ? 'npx prisma migrate deploy'
    : 'npx prisma migrate dev';
  
  execSync(command, { stdio: 'inherit' });
  
  console.log('✅ Migrations completed successfully');
  process.exit(0);
} catch (error) {
  console.error('❌ Migration failed:', error.message);
  process.exit(1);
}
