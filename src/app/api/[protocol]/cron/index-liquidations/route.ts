/**
 * Generic liquidation indexer cron.
 *
 * Routes any /api/<slug>/cron/index-liquidations call to the protocol's
 * adapter.fetchLiquidations() method. Adapters handle their own event
 * parsing, pagination, and asset resolution — this route is a thin shell
 * that handles auth, "where to start" (latest indexed event id), and the
 * batched DB write.
 *
 * Each protocol's events have different field shapes (NAVI uses pool ids;
 * Suilend uses obligation ids; Scallop has its own event types) so
 * normalization happens inside each adapter, not here.
 */

import { NextResponse } from 'next/server';
import { CRON_SECRET } from '@/lib/constants';
import { getProtocol } from '@/protocols/registry';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ protocol: string }> }
) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { protocol: slug } = await params;
  const entry = getProtocol(slug);
  if (!entry) {
    return NextResponse.json({ error: `Unknown protocol: ${slug}` }, { status: 404 });
  }
  if (!entry.adapter.fetchLiquidations) {
    return NextResponse.json({
      message: `Liquidation indexing not implemented for ${slug}`,
    });
  }

  const db = getDb();
  if (!db) {
    return NextResponse.json({ error: 'No database configured' }, { status: 503 });
  }

  try {
    // Find the latest already-indexed event so the adapter can stop early.
    const latest = await db.liquidationEvent.findFirst({
      where: { protocol: slug },
      orderBy: { timestamp: 'desc' },
      select: { id: true },
    });

    const events = await entry.adapter.fetchLiquidations({
      untilEventId: latest?.id,
      maxPages: 4,
    });

    if (events.length === 0) {
      return NextResponse.json({
        success: true,
        protocol: slug,
        indexed: 0,
        message: 'No new events',
        timestamp: new Date().toISOString(),
      });
    }

    // Map to DB rows — extra defensive on numeric coercion since some
    // adapters parse strings out of GraphQL responses that may carry
    // unexpected types.
    const num = (v: unknown) => {
      const n = typeof v === 'number' ? v : Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    const rows = events.map((e) => ({
      id: e.id,
      protocol: slug,
      txDigest: e.txDigest,
      timestamp: e.timestamp,
      liquidator: e.liquidator.slice(0, 66),
      borrower: e.borrower.slice(0, 66),
      collateralAsset: e.collateralAsset.slice(0, 24),
      collateralAmount: num(e.collateralAmount),
      collateralPrice: num(e.collateralPrice),
      collateralUsd: num(e.collateralUsd),
      debtAsset: e.debtAsset.slice(0, 24),
      debtAmount: num(e.debtAmount),
      debtPrice: num(e.debtPrice),
      debtUsd: num(e.debtUsd),
      treasuryAmount: num(e.treasuryAmount),
      gasUsedMist: e.gasUsedMist ?? null,
      gasUsd: e.gasUsd ?? null,
    }));

    const result = await db.liquidationEvent.createMany({
      data: rows,
      skipDuplicates: true,
    });

    return NextResponse.json({
      success: true,
      protocol: slug,
      indexed: result.count,
      attempted: rows.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error(`index-liquidations[${slug}] error:`, error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
