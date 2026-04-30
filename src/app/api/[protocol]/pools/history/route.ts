import { NextResponse } from 'next/server';
import { isValidProtocol } from '@/protocols/registry';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/[protocol]/pools/history?days=30&symbol=SUI
 *
 * Returns the last N days OF DATA (not calendar days). This differs from
 * the naive "now - N days" filter: if there are gaps in snapshot coverage
 * (e.g. a cron outage), `days=7` should still show the 7 most recent dates
 * that have rows, not an empty window. The chart x-axis is the actual
 * coverage — users never land on a blank "no data in range" state when
 * there IS historical data, it's just older than N calendar days.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ protocol: string }> }
) {
  const { protocol: slug } = await params;

  if (!isValidProtocol(slug)) {
    return NextResponse.json({ error: `Unknown protocol: ${slug}` }, { status: 404 });
  }

  const { searchParams } = new URL(req.url);
  const days = Math.min(Math.max(Number(searchParams.get('days') ?? 30), 1), 365);
  const symbol = searchParams.get('symbol');

  const db = getDb();
  if (!db) {
    return NextResponse.json({ history: [], message: 'No database configured' });
  }

  try {
    const baseWhere: Record<string, unknown> = { protocol: slug };
    if (symbol) baseWhere.symbol = symbol;

    // Pick the N most recent distinct dates that actually have rows.
    const distinctDates = await db.poolDaily.findMany({
      where: baseWhere,
      distinct: ['date'],
      orderBy: { date: 'desc' },
      take: days,
      select: { date: true },
    });

    if (distinctDates.length === 0) {
      return NextResponse.json({ history: [] });
    }

    const oldestDate = distinctDates[distinctDates.length - 1].date;

    const history = await db.poolDaily.findMany({
      where: { ...baseWhere, date: { gte: oldestDate } },
      orderBy: { date: 'asc' },
    });

    return NextResponse.json({
      history,
      coverageDays: distinctDates.length,
      from: oldestDate,
      to: distinctDates[0].date,
    });
  } catch (error) {
    console.error(`/api/${slug}/pools/history error:`, error);
    return NextResponse.json({ history: [], error: 'Query failed' }, { status: 500 });
  }
}
