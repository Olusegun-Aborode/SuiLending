/**
 * Database client.
 *
 * Uses Prisma when DATABASE_URL is set. Otherwise returns null
 * so the app can build and render without a database (API routes
 * return empty arrays until a DB is connected).
 *
 * Run `npx prisma generate && npx prisma db push` after setting DATABASE_URL.
 */

let prisma: any = null;

export function getDb() {
  if (prisma) return prisma;
  if (!process.env.DATABASE_URL) return null;

  try {
    // Dynamic import so build succeeds without generated client
    const { PrismaClient } = require('@prisma/client');
    const globalForPrisma = globalThis as unknown as { __prisma: any };
    if (!globalForPrisma.__prisma) {
      globalForPrisma.__prisma = new PrismaClient({
        log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
      });
    }
    prisma = globalForPrisma.__prisma;
    return prisma;
  } catch {
    return null;
  }
}

// ─── Type definitions matching the Prisma schema ────────────────────────────

export interface PoolSnapshotRow {
  id: number;
  symbol: string;
  timestamp: Date;
  totalSupply: number;
  totalSupplyUsd: number;
  totalBorrows: number;
  totalBorrowsUsd: number;
  availableLiquidity: number;
  availableLiquidityUsd: number;
  supplyApy: number;
  borrowApy: number;
  utilization: number;
  price: number;
}

export interface PoolDailyRow {
  id: number;
  symbol: string;
  date: Date;
  avgSupplyApy: number;
  avgBorrowApy: number;
  avgUtilization: number;
  closeTotalSupplyUsd: number;
  closeTotalBorrowsUsd: number;
  closeLiquidityUsd: number;
  closePrice: number;
}

export interface LiquidationEventRow {
  id: string;
  txDigest: string;
  timestamp: Date;
  liquidator: string;
  borrower: string;
  collateralAsset: string;
  collateralAmount: number;
  collateralPrice: number;
  collateralUsd: number;
  debtAsset: string;
  debtAmount: number;
  debtPrice: number;
  debtUsd: number;
  treasuryAmount: number;
}

export interface WalletPositionRow {
  id: number;
  address: string;
  collateralUsd: number;
  borrowUsd: number;
  healthFactor: number;
  collateralAssets: string;
  borrowAssets: string;
  refreshPriority: number;
  lastUpdated: Date;
}

export interface CollateralBorrowPairRow {
  id: number;
  collateralAsset: string;
  borrowAsset: string;
  count: number;
  totalCollateralUsd: number;
  totalBorrowUsd: number;
  updatedAt: Date;
}
