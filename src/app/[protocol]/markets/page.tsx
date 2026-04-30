'use client';

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import Panel from '@/components/ui/Panel';
import PageHeader from '@/components/ui/PageHeader';
import Loading from '@/components/ui/Loading';
import ErrorMsg from '@/components/ui/ErrorMsg';
import MarketsTable, { type MarketRow } from '@/components/tables/MarketsTable';

interface PoolsResponse {
  pools: MarketRow[];
  protocolName?: string;
}

export default function MarketsPage() {
  const { protocol } = useParams<{ protocol: string }>();

  const { data, isPending, isError, refetch } = useQuery<PoolsResponse>({
    queryKey: ['pools', protocol],
    queryFn: () => fetch(`/api/${protocol}/pools`).then((r) => r.json()),
  });

  if (isPending) return <Loading message="Loading markets" />;
  if (isError) return <ErrorMsg message="Failed to load markets." onRetry={() => refetch()} />;

  const markets = data.pools ?? [];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Markets"
        subtitle={
          <>
            {markets.length} pools · sortable · click a row for pool detail
          </>
        }
      />
      <Panel title="Markets" badge={`${markets.length} POOLS`} flush>
        <MarketsTable data={markets} protocolSlug={protocol} />
      </Panel>
    </div>
  );
}
