import Dexie, { type Table } from "dexie";

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
  lastErrorAt?: string | null;
};

class AppDB extends Dexie {
  trips!: Table<Trip, string>;
  wallet_tx!: Table<WalletTx, string>;
  signal_cache!: Table<SignalCache, string>;

  constructor() {
    super("pwa_maxim_db");
    this.version(1).stores({
      trips: "id, startedAt, endedAt",
      wallet_tx: "id, createdAt, type",
      signal_cache: "key, fetchedAt"
    });
  }
}

export const db = new AppDB();
