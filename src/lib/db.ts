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

export type Settings = {
  id: "default";
  dailyTargetNet: number;
  dailyTargetGross?: number | null;
  costPerKmEstimate?: number | null;
  costPerKmEstimateMethod: "fuel-only" | "all-expense" | "manual";
  fuelCategoryName: string;
  distanceMode: "trip-only" | "trip+deadhead";
  manualCostPerKm?: number | null;
  costPerKm?: number;
  preferredH3Res?: number | null;
};

export const defaultSettings: Settings = {
  id: "default",
  dailyTargetNet: 200_000,
  dailyTargetGross: null,
  costPerKmEstimate: null,
  costPerKmEstimateMethod: "fuel-only",
  fuelCategoryName: "BBM",
  distanceMode: "trip-only",
  manualCostPerKm: null,
  costPerKm: 250,
  preferredH3Res: null
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
  settings!: Table<Settings, string>;

  constructor() {
    super("pwa_maxim_db");
    this.version(1).stores({
      trips: "id, startedAt, endedAt",
      wallet_tx: "id, createdAt, type",
      signal_cache: "key, fetchedAt"
    });
    this.version(2)
      .stores({
        trips: "id, startedAt, endedAt",
        wallet_tx: "id, createdAt, type",
        signal_cache: "key, fetchedAt",
        settings: "id"
      })
      .upgrade(async (tx) => {
        const table = tx.table<Settings, string>("settings");
        const existing = await table.get("default");
        if (!existing) {
          await table.put(defaultSettings);
        }
      });
  }
}

export const db = new AppDB();
