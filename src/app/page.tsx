import { redirect } from 'next/navigation';

/**
 * Root route — sends visitors to the static Sui Lending dashboard at
 * `/Overview.html` (served from `public/`). The Next.js NAVI/etc.
 * per-protocol Next.js dashboard remains accessible at `/navi/overview`,
 * `/suilend/overview`, etc.
 */
export default function Home() {
  redirect('/Overview.html');
}
