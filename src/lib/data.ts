import { idbDelete, idbGet, idbGetAll, idbPut } from "./idb";

export type Trip = {
  id: string;
  startedAt: string;
  endedAt: string;
  startLat: number;
  startLon: number;
  endLat: number;
  endLon: number;
  earnings: number;
  note?: string;
  source: "manual";
};

export type WalletTx = {
  id: string;
  createdAt: string;
  type: "income" | "expense";
  amount: number;
  category: string;
  note?: string;
};

export type SignalCache = {
  key: string;
  fetchedAt: string;
  ttlSeconds: number;
  payload: unknown;
};

export type Setting = {
  id: string;
  value: unknown;
};

export function createId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function addTrip(trip: Trip) {
  await idbPut("trips", trip);
}

export async function getTrips() {
  const trips = await idbGetAll<Trip>("trips");
  return trips.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export async function addWalletTx(tx: WalletTx) {
  await idbPut("wallet_tx", tx);
}

export async function getWalletTx() {
  const txs = await idbGetAll<WalletTx>("wallet_tx");
  return txs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function setSetting(setting: Setting) {
  await idbPut("settings", setting);
}

export async function getSetting<T>(id: string) {
  return idbGet<Setting>("settings", id).then((value) => value?.value as T | undefined);
}

export async function getCachedSignal<T>(key: string) {
  const record = await idbGet<SignalCache>("signal_cache", key);
  if (!record) {
    return null;
  }
  const fetchedAt = new Date(record.fetchedAt).getTime();
  if (Date.now() - fetchedAt > record.ttlSeconds * 1000) {
    await idbDelete("signal_cache", key);
    return null;
  }
  return record.payload as T;
}

export async function setCachedSignal<T>(
  key: string,
  payload: T,
  ttlSeconds: number
) {
  const record: SignalCache = {
    key,
    fetchedAt: new Date().toISOString(),
    ttlSeconds,
    payload
  };
  await idbPut("signal_cache", record);
}
