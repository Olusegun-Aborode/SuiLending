/**
 * Shared helpers for protocol-aware routes and pages.
 */

import { getProtocol, getProtocolConfig } from './registry';
import type { ProtocolConfig, ProtocolAdapter } from './types';

/**
 * Resolve protocol slug from route params.
 * Returns { config, adapter } or null if invalid.
 */
export function resolveProtocol(slug: string): {
  config: ProtocolConfig;
  adapter: ProtocolAdapter;
} | null {
  const entry = getProtocol(slug);
  if (!entry) return null;
  return { config: entry.config, adapter: entry.adapter };
}

/**
 * Get asset symbols for a protocol (used by charts, aggregation, etc.)
 */
export function getProtocolSymbols(slug: string): string[] {
  const config = getProtocolConfig(slug);
  if (!config) return [];
  return config.assets.map((a) => a.symbol);
}

/**
 * Get asset color map for a protocol (used by charts).
 *
 * Returns a Proxy: configured colors come from the protocol config, and any
 * symbol not found in the config gets a deterministic fallback derived from
 * its name. This way new pools added on-chain always render with a stable,
 * distinct color without requiring a config update.
 */
export function getProtocolAssetColors(slug: string): Record<string, string> {
  const config = getProtocolConfig(slug);
  const configured: Record<string, string> = config
    ? Object.fromEntries(config.assets.map((a) => [a.symbol, a.color]))
    : {};

  return new Proxy(configured, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      return colorForSymbol(prop);
    },
    has(target, prop: string) {
      return typeof prop === 'string';
    },
  });
}

/**
 * Deterministic HSL color derived from a symbol — stable across reloads and
 * visually distinct from neighbours. Saturation/lightness tuned for a dark
 * theme so every asset is legible against the zinc-900 background.
 */
function colorForSymbol(symbol: string): string {
  let h = 0;
  for (let i = 0; i < symbol.length; i++) {
    h = (h * 31 + symbol.charCodeAt(i)) >>> 0;
  }
  const hue = h % 360;
  return `hsl(${hue}, 62%, 58%)`;
}
