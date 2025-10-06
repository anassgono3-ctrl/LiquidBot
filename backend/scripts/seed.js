#!/usr/bin/env node
/**
 * Database Seeding Script
 * Inserts sample user, subscription, and protection log data
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Create sample users
  const user1 = await prisma.user.upsert({
    where: { address: '0x1234567890123456789012345678901234567890' },
    update: {},
    create: {
      address: '0x1234567890123456789012345678901234567890',
    },
  });

  const user2 = await prisma.user.upsert({
    where: { address: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd' },
    update: {},
    create: {
      address: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
    },
  });

  console.log('✅ Created users:', user1.address, user2.address);

  // Create sample subscriptions
  const sub1 = await prisma.subscription.upsert({
    where: { userId: user1.id },
    update: { tier: 'PREMIUM', active: true },
    create: {
      userId: user1.id,
      tier: 'PREMIUM',
      active: true,
    },
  });

  const sub2 = await prisma.subscription.upsert({
    where: { userId: user2.id },
    update: { tier: 'BASIC', active: true },
    create: {
      userId: user2.id,
      tier: 'BASIC',
      active: true,
    },
  });

  console.log('✅ Created subscriptions:', sub1.tier, sub2.tier);

  // Create sample protection logs
  const log1 = await prisma.protectionLog.create({
    data: {
      userId: user1.id,
      type: 'REFINANCE',
      feeBps: 15, // 0.15%
      txHash: '0xabc123def456abc123def456abc123def456abc123def456abc123def456abc123',
    },
  });

  const log2 = await prisma.protectionLog.create({
    data: {
      userId: user2.id,
      type: 'EMERGENCY',
      feeBps: 50, // 0.5%
      txHash: '0xdef789abc012def789abc012def789abc012def789abc012def789abc012def789',
    },
  });

  console.log('✅ Created protection logs:', log1.id, log2.id);

  console.log('🎉 Database seeding completed successfully!');
}

main()
  .catch((error) => {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
