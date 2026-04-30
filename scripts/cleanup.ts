import { PrismaClient } from '@prisma/client';

async function main() {
  const db = new PrismaClient();
  const res = await db.liquidationEvent.deleteMany({
    where: {
      protocol: 'navi',
      OR: [
        { collateralAsset: { in: ['NAVX', 'haSUI', 'UNKNOWN'] } },
        { debtAsset:       { in: ['NAVX', 'haSUI', 'UNKNOWN'] } },
      ],
    },
  });
  console.log(`Deleted ${res.count} rows.`);
  await db.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
