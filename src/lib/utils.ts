import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { POOL_CONFIGS } from './constants';

/**
 * Get a chart color for an asset symbol.
 *
 * Prefers the configured color in POOL_CONFIGS; otherwise returns a stable
 * HSL color derived from the symbol string so newly-added pools always
 * render distinct and consistent across reloads.
 */
export function getAssetColor(symbol: string): string {
  const configured = POOL_CONFIGS[symbol]?.color;
  if (configured) return configured;
  let h = 0;
  for (let i = 0; i < symbol.length; i++) {
    h = (h * 31 + symbol.charCodeAt(i)) >>> 0;
  }
  return `hsl(${h % 360}, 62%, 58%)`;
}

/** Merge Tailwind classes safely */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// External APIs (NAVI open API, chain RPCs) routinely return numeric fields
// as strings. Coerce before arithmetic/formatting so callers don't crash with
// "value.toFixed is not a function" when upstream shape drifts.
function toNum(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Format to USD string: $1,234.56 */
export function formatUsd(value: number | string, compact = false): string {
  const n = toNum(value);
  if (compact) {
    if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000) return `$${(n / 1_000).toFixed(2)}K`;
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

/** Format a number with commas: 1,234,567.89 */
export function formatNumber(value: number | string, decimals = 2): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(toNum(value));
}

/** Format percentage: 12.34% */
export function formatPercent(value: number | string, decimals = 2): string {
  return `${toNum(value).toFixed(decimals)}%`;
}

/** Format date to short string: Jan 15 */
export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Format date to full: Jan 15, 2026 */
export function formatDateFull(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** Truncate wallet address: 0x1234...abcd */
export function truncateAddress(address: string, chars = 6): string {
  if (address.length <= chars * 2 + 3) return address;
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}
