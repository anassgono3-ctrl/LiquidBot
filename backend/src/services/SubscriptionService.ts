// SubscriptionService: Manage user subscriptions and protection logs
import { PrismaClient } from '@prisma/client';

// Import types from our schema
type SubscriptionTier = 'BASIC' | 'PREMIUM' | 'ENTERPRISE';
type ProtectionType = 'REFINANCE' | 'EMERGENCY';

/**
 * Subscription management service using Prisma
 */
export class SubscriptionService {
  private prisma: PrismaClient;

  constructor(prisma?: PrismaClient) {
    this.prisma = prisma || new PrismaClient();
  }

  /**
   * Subscribe a user
   * @param address User's wallet address
   * @param tier Subscription tier
   * @returns Created subscription
   */
  async subscribe(address: string, tier: SubscriptionTier) {
    // Create user if doesn't exist, then create subscription
    const user = await this.prisma.user.upsert({
      where: { address },
      update: {},
      create: { address },
    });

    const subscription = await this.prisma.subscription.create({
      data: {
        userId: user.id,
        tier,
        active: true,
      },
      include: { user: true },
    });

    return subscription;
  }

  /**
   * Unsubscribe a user
   * @param address User's wallet address
   */
  async unsubscribe(address: string) {
    const user = await this.prisma.user.findUnique({
      where: { address },
      include: { subscription: true },
    });

    if (!user || !user.subscription) {
      throw new Error('No active subscription found');
    }

    await this.prisma.subscription.update({
      where: { id: user.subscription.id },
      data: { active: false },
    });
  }

  /**
   * Get user's subscription
   * @param address User's wallet address
   * @returns Subscription if exists
   */
  async getSubscription(address: string) {
    const user = await this.prisma.user.findUnique({
      where: { address },
      include: { subscription: true },
    });

    return user?.subscription || null;
  }

  /**
   * Log a protection event
   * @param address User's wallet address
   * @param type Protection type (REFINANCE or EMERGENCY)
   * @param feeBps Fee in basis points
   * @param txHash Optional transaction hash
   */
  async logProtection(
    address: string,
    type: ProtectionType,
    feeBps: number,
    txHash?: string
  ) {
    const user = await this.prisma.user.findUnique({
      where: { address },
    });

    if (!user) {
      throw new Error('User not found');
    }

    const log = await this.prisma.protectionLog.create({
      data: {
        userId: user.id,
        type,
        feeBps,
        txHash,
      },
    });

    return log;
  }

  /**
   * Get protection logs for a user
   * @param address User's wallet address
   * @param limit Maximum number of logs to return
   * @returns Array of protection logs
   */
  async getProtectionLogs(address: string, limit = 100) {
    const user = await this.prisma.user.findUnique({
      where: { address },
    });

    if (!user) {
      return [];
    }

    return this.prisma.protectionLog.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /**
   * Close Prisma connection
   */
  async disconnect() {
    await this.prisma.$disconnect();
  }
}
