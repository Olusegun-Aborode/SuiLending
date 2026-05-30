// Probe the actual Aftermath afSUI/SUI LP pool and Bucket vault to find
// why our adapter is reporting $1.46B for this single CDP.
async function getObject(id: string) {
  const rpc = process.env.ALCHEMY_SUI_RPC || 'https://fullnode.mainnet.sui.io:443';
  const r = await fetch(rpc, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'sui_getObject',
      params: [id, { showContent: true, showType: true }],
    }),
  });
  const j = await r.json();
  return j.result;
}

const POOL = '0x97aae7a80abb29c9feabbe7075028550230401ffe7fb745757d3c28a30437408';
const BUCKET = '0x1e88892e746708ec69784a56c6aba301a97e87e5b77aaef0eec16c3e472e8653';

async function main() {
  const [pool, bucket] = await Promise.all([getObject(POOL), getObject(BUCKET)]);
  console.log('=== POOL fields ===');
  const pf = (pool?.data?.content?.fields) ?? {};
  console.log(JSON.stringify(pf, null, 2).slice(0, 3500));
  console.log('\n=== BUCKET fields ===');
  const bf = (bucket?.data?.content?.fields) ?? {};
  console.log(JSON.stringify(bf, null, 2).slice(0, 3500));

  // Reproduce the adapter math.
  const lpSupply = Number(pf?.lp_supply?.fields?.value ?? pf?.lp_supply?.value ?? 0);
  const balances: any[] = Array.isArray(pf?.normalized_balances) ? pf.normalized_balances : [];
  const tokenNames: any[] = Array.isArray(pf?.type_names) ? pf.type_names : [];
  const stakedInBucket = Number(bf?.collateral_vault ?? 0);
  console.log('\n=== Computed inputs ===');
  console.log(`  lp_supply           = ${lpSupply.toExponential(4)}`);
  console.log(`  stakedInBucket      = ${stakedInBucket.toExponential(4)}`);
  console.log(`  ratio (staked/lp)   = ${(stakedInBucket / lpSupply).toExponential(6)}`);
  console.log(`  normalized_balances = ${balances.map(b => Number(b).toExponential(4)).join(', ')}`);
  console.log(`  type_names          = ${tokenNames.join(', ')}`);

  // Adapter math: tokenAmt = (balance / 1e18) * (staked/lp)
  for (let i = 0; i < balances.length && i < tokenNames.length; i++) {
    const balance = Number(balances[i]);
    const amt = (balance / 1e18) * (stakedInBucket / lpSupply);
    console.log(`  → token[${i}]=${tokenNames[i]}  tokenAmt = ${amt.toExponential(4)}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
