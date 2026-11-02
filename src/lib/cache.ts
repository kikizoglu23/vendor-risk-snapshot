/**
 * Tiny in-memory cache with expiry, so repeated scans of the same vendor
 * don't hit rate-limited free APIs again. Concurrent callers asking for the
 * same key share one request. Failures are not cached.
 */
const store = new Map<string, { at: number; value: Promise<unknown> }>();
const MAX_ENTRIES = 1000;

export function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as Promise<T>;
  const value = load();
  if (store.size >= MAX_ENTRIES) store.delete(store.keys().next().value!);
  store.set(key, { at: Date.now(), value });
  value.catch(() => store.delete(key));
  return value;
}
