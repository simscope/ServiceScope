import { MetaConnectionError } from './contracts.js';

const limits = Object.freeze({ status: 60, start: 10, complete: 10, select_asset: 20, check_health: 12, disconnect: 8 });

export function createMetaRateLimiter({ windowMs = 60_000, now = () => Date.now() } = {}) {
  const buckets = new Map();
  return {
    assert({ actorId, companyId, action }) {
      const key = `${actorId}:${companyId}:${action}`;
      const timestamp = now();
      const current = buckets.get(key);
      const bucket = !current || timestamp - current.startedAt >= windowMs
        ? { startedAt: timestamp, count: 0 }
        : current;
      bucket.count += 1;
      buckets.set(key, bucket);
      if (bucket.count > (limits[action] ?? 5)) throw new MetaConnectionError('META_RATE_LIMITED');
    },
    clear() {
      buckets.clear();
    },
  };
}
