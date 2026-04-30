/**
 * Protocol Registry — maps slugs to their config + adapter.
 *
 * To add a new protocol:
 * 1. Create src/protocols/<slug>/config.ts
 * 2. Create src/protocols/<slug>/adapter.ts
 * 3. Import and register them below
 */

import type { ProtocolConfig, ProtocolEntry } from './types';
import naviConfig from './navi/config';
import naviAdapter from './navi/adapter';
import suilendConfig from './suilend/config';
import suilendAdapter from './suilend/adapter';
import scallopConfig from './scallop/config';
import scallopAdapter from './scallop/adapter';
import alphalendConfig from './alphalend/config';
import alphalendAdapter from './alphalend/adapter';
import bucketConfig from './bucket/config';
import bucketAdapter from './bucket/adapter';

// ─── Registry ───────────────────────────────────────────────────────────────

const PROTOCOLS: Record<string, ProtocolEntry> = {
  navi:      { config: naviConfig,      adapter: naviAdapter },
  suilend:   { config: suilendConfig,   adapter: suilendAdapter },
  scallop:   { config: scallopConfig,   adapter: scallopAdapter },
  alphalend: { config: alphalendConfig, adapter: alphalendAdapter },
  bucket:    { config: bucketConfig,    adapter: bucketAdapter },
};

export default PROTOCOLS;

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Get protocol entry by slug, or null if not found */
export function getProtocol(slug: string): ProtocolEntry | null {
  return PROTOCOLS[slug.toLowerCase()] ?? null;
}

/** Get just the config by slug */
export function getProtocolConfig(slug: string): ProtocolConfig | null {
  return PROTOCOLS[slug.toLowerCase()]?.config ?? null;
}

/** List all registered protocol configs (for landing page, switcher, etc.) */
export function listProtocols(): ProtocolConfig[] {
  return Object.values(PROTOCOLS).map((p) => p.config);
}

/** List all registered protocol slugs */
export function listProtocolSlugs(): string[] {
  return Object.keys(PROTOCOLS);
}

/** Check if a slug is a valid registered protocol */
export function isValidProtocol(slug: string): boolean {
  return slug.toLowerCase() in PROTOCOLS;
}
