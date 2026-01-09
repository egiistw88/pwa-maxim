import { db, type SignalCache } from "./db";

export async function getOrFetchSignal<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>,
  options?: { forceRefresh?: boolean }
): Promise<T> {
  if (!options?.forceRefresh) {
    const cached = await db.signal_cache.get(key);
    if (cached && isCacheValid(cached)) {
      return cached.payload as T;
    }
  }

  const payload = await fetcher();
  const record: SignalCache = {
    key,
    fetchedAt: new Date().toISOString(),
    ttlSeconds,
    payload
  };
  await db.signal_cache.put(record);
  return payload;
}

function isCacheValid(cache: SignalCache) {
  const fetchedAt = new Date(cache.fetchedAt).getTime();
  const now = Date.now();
  return now - fetchedAt < cache.ttlSeconds * 1000;
}
