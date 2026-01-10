import { db, type SignalCache } from "./db";

export type SignalMeta = {
  fetchedAt: string | null;
  isFresh: boolean;
  isStale: boolean;
  ageSeconds: number | null;
  ttlSeconds: number;
  fromCache: boolean;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
};

export type SignalResult<T> = {
  payload: T;
  meta: SignalMeta;
};

type SignalOptions = {
  forceRefresh?: boolean;
  allowNetwork?: boolean;
  allowStale?: boolean;
};

const COOLDOWN_SECONDS = 5 * 60;

export async function getOrFetchSignal<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>,
  options?: SignalOptions
): Promise<SignalResult<T>> {
  const allowNetwork = options?.allowNetwork ?? true;
  const allowStale = options?.allowStale ?? false;
  const forceRefresh = options?.forceRefresh ?? false;
  const cached = await db.signal_cache.get(key);

  if (!forceRefresh && cached && (isCacheValid(cached) || allowStale)) {
    return buildResult<T>(cached, true);
  }

  if (cached && isInCooldown(cached)) {
    return buildResult<T>(cached, true);
  }

  if (!allowNetwork) {
    if (cached) {
      return buildResult<T>(cached, true);
    }
    throw new Error("Offline dan cache belum tersedia.");
  }

  try {
    const payload = await fetcher();
    const record: SignalCache = {
      key,
      fetchedAt: new Date().toISOString(),
      ttlSeconds,
      payload,
      lastErrorAt: null,
      lastErrorMessage: null
    };
    await db.signal_cache.put(record);
    return buildResult<T>(record, false);
  } catch (error) {
    if (cached) {
      const updated: SignalCache = {
        ...cached,
        lastErrorAt: new Date().toISOString(),
        lastErrorMessage: error instanceof Error ? error.message : "Gagal mengambil sinyal"
      };
      await db.signal_cache.put(updated);
      return buildResult<T>(updated, true);
    }
    throw error;
  }
}

function isCacheValid(cache: SignalCache) {
  const fetchedAt = new Date(cache.fetchedAt).getTime();
  const now = Date.now();
  return now - fetchedAt < cache.ttlSeconds * 1000;
}

function isInCooldown(cache: SignalCache) {
  if (!cache.lastErrorAt) {
    return false;
  }
  const lastErrorAt = new Date(cache.lastErrorAt).getTime();
  return Date.now() - lastErrorAt < COOLDOWN_SECONDS * 1000;
}

function buildResult<T>(cache: SignalCache, fromCache: boolean): SignalResult<T> {
  const ageSeconds = getAgeSeconds(cache.fetchedAt);
  const isFresh = ageSeconds !== null ? ageSeconds < cache.ttlSeconds : false;
  const isStale = !isFresh;
  return {
    payload: cache.payload as T,
    meta: {
      fetchedAt: cache.fetchedAt ?? null,
      isFresh,
      isStale,
      ageSeconds,
      ttlSeconds: cache.ttlSeconds,
      fromCache,
      lastErrorAt: cache.lastErrorAt ?? null,
      lastErrorMessage: cache.lastErrorMessage ?? null
    }
  };
}

function getAgeSeconds(fetchedAt: string | null | undefined) {
  if (!fetchedAt) {
    return null;
  }
  const ageMs = Date.now() - new Date(fetchedAt).getTime();
  return Math.max(0, Math.floor(ageMs / 1000));
}
