import { NextResponse } from 'next/server';
import { isValidProtocol } from '@/protocols/registry';
import { fetchNaviUserState } from '@/protocols/navi/userState';

export const dynamic = 'force-dynamic';

/**
 * GET /api/[protocol]/wallets/[address]
 *
 * Live per-asset breakdown of a single wallet, pulled on-chain via NAVI's
 * devInspect path. We hit the chain at request time (rather than reading
 * from `WalletPosition`) because the table only stores aggregate totals +
 * symbol lists — the USD-per-asset numbers the UI wants to show are only
 * computed inside `fetchNaviUserState`.
 *
 * Returns:
 *   {
 *     address, healthFactor, collateralUsd, borrowUsd,
 *     perAsset: [{ symbol, supplyUsd, borrowUsd }]
 *   }
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ protocol: string; address: string }> },
) {
  const { protocol, address } = await params;

  if (!isValidProtocol(protocol)) {
    return NextResponse.json({ error: `Unknown protocol: ${protocol}` }, { status: 404 });
  }

  // Only NAVI has a userState adapter right now — other protocols would
  // need their own fetcher. Fail loudly rather than return empty data that
  // could be misread as a wallet with zero position.
  if (protocol !== 'navi') {
    return NextResponse.json(
      { error: `Per-wallet breakdown not implemented for ${protocol}` },
      { status: 501 },
    );
  }

  if (!address || !address.startsWith('0x') || address.length < 6) {
    return NextResponse.json({ error: 'Invalid address' }, { status: 400 });
  }

  try {
    const state = await fetchNaviUserState(address);
    return NextResponse.json(state);
  } catch (error) {
    console.error(`/api/${protocol}/wallets/${address} error:`, error);
    return NextResponse.json(
      { error: 'Failed to fetch wallet position' },
      { status: 500 },
    );
  }
}
