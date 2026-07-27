export function createMemoryGuards({ now = () => Date.now(), ttlMs = 600_000, windowMs = 60_000, maxRequests = 12 } = {}) {
  const idempotency = new Map();
  const rates = new Map();
  return {
    get(key) {
      prune();
      const cached = idempotency.get(key);
      return cached && cached.expiresAt > now() ? cached.result : null;
    },
    set(key, result) {
      prune();
      idempotency.set(key, { expiresAt: now() + ttlMs, result });
    },
    allow(key) {
      prune();
      const current = rates.get(key);
      const stamp = now();
      if (!current || stamp - current.windowStart >= windowMs) {
        rates.set(key, { windowStart: stamp, count: 1 });
        return true;
      }
      if (current.count >= maxRequests) return false;
      current.count += 1;
      return true;
    },
  };

  function prune() {
    const stamp = now();
    for (const [key, entry] of idempotency) {
      if (entry.expiresAt <= stamp) idempotency.delete(key);
    }
    for (const [key, entry] of rates) {
      if (stamp - entry.windowStart >= windowMs) rates.delete(key);
    }
  }
}
