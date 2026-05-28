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
        datasources: { db: { url: poolerSafeUrl(process.env.DATABASE_URL!) } },
        log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
      });
    }
    prisma = globalForPrisma.__prisma;
    return prisma;
  } catch {
    return null;
  }
}

/**
 * Append `pgbouncer=true` to the connection URL so Prisma disables prepared
 * statements on Neon's pooled (PgBouncer-in-transaction-mode) endpoint.
 *
 * Why this matters: our DATABASE_URL points at Neon's `-pooler` host. Without
 * `pgbouncer=true`, Prisma uses server-side prepared statements whose cached
 * query plans are pinned to the column types at prepare time. After any
 * `ALTER COLUMN` migration (e.g. widening symbol VarChar(24)→(64), or adding
 * the ltv/liquidationThreshold columns), the pooled connection keeps replaying
 * the stale plan and every `$queryRawUnsafe` fails with PG error 0A000:
 * "cached plan must not change result type" — which 500s the whole
 * /api/sui-lending endpoint until connections recycle (which, on a warm
 * pooler, can take a long time).
 *
 * Doing this in code (rather than editing the Vercel DATABASE_URL env var)
 * means we don't need to read the Sensitive secret value, it can't be
 * fat-fingered into breaking prod, and it's version-controlled. Idempotent —
 * leaves the URL alone if the caller already set pgbouncer.
 */
function poolerSafeUrl(url: string): string {
  if (!url || url.includes('pgbouncer=')) return url;
  return url + (url.includes('?') ? '&' : '?') + 'pgbouncer=true';
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
