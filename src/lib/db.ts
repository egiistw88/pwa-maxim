import Dexie, { type Table } from "dexie";
import { defaultWeights } from "./engine/scoring";

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
  source: "manual" | "assistant";
  sessionId?: string;
};

export type WalletTx = {
  id: string;
  createdAt: string;
  type: "income" | "expense";
  amount: number;
  category: string;
  note?: string;
  sessionId?: string;
};

export type Settings = {
  id: "default";
  dailyTargetNet: number;
  dailyTargetGross: number | null;
  costPerKmEstimate: number | null;
  costPerKmEstimateMethod: "fuel-only" | "all-expense" | "manual";
  fuelCategoryName: string;
  distanceMode: "trip-only" | "trip+deadhead";
  manualCostPerKm: number | null;
  costPerKm: number;
  avgSpeedKmh: number;
  explorationRate: number;
  preferredH3Res: number;
  weights: Record<string, number>;
  autoAttachToActiveSession: boolean;
  defaultBreakMinutes: number;
  baseAreaKey: string;
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
  avgSpeedKmh: 22,
  explorationRate: 0.08,
  preferredH3Res: 10,
  weights: defaultWeights(),
  autoAttachToActiveSession: true,
  defaultBreakMinutes: 30,
  baseAreaKey: "timur"
};

export type SignalCache = {
  key: string;
  fetchedAt: string;
  ttlSeconds: number;
  payload: unknown;
  lastErrorAt?: string | null;
};

export function normalizeSettings(settings?: Partial<Settings>): Settings {
  const merged: Settings = {
    ...defaultSettings,
    ...settings,
    id: "default",
    weights: {
      ...defaultSettings.weights,
      ...(settings?.weights ?? {})
    }
  };

  const costPerKm = merged.costPerKmEstimate ?? merged.manualCostPerKm ?? 250;

  return {
    ...merged,
    costPerKm
  };
}

export type RecommendationEvent = {
  id: string;
  createdAt: string;
  userLat: number;
  userLon: number;
  areaKey: string;
  recommended: Array<{
    cell: string;
    score: number;
    reasons: string[];
  }>;
  chosenH3?: string | null;
  followed?: boolean | null;
};

export type SessionPause = {
  startAt: string;
  endAt: string | null;
};

export type Session = {
  id: string;
  startedAt: string;
  endedAt: string | null;
  status: "active" | "paused" | "ended";
  pauses: SessionPause[];
  note?: string | null;
  baseAreaKey?: string | null;
  startLat?: number | null;
  startLon?: number | null;
  endLat?: number | null;
  endLon?: number | null;
  totalsSnapshot?: {
    gross: number;
    expense: number;
    net: number;
    tripsCount: number;
    distanceKm: number;
  };
};

class AppDB extends Dexie {
  trips!: Table<Trip, string>;
  wallet_tx!: Table<WalletTx, string>;
  signal_cache!: Table<SignalCache, string>;
  settings!: Table<Settings, string>;
  rec_events!: Table<RecommendationEvent, string>;
  sessions!: Table<Session, string>;

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
        const normalized = normalizeSettings(existing ?? undefined);
        if (!existing || JSON.stringify(existing) !== JSON.stringify(normalized)) {
          await table.put(normalized);
        }
      });
    this.version(3)
      .stores({
        trips: "id, startedAt, endedAt",
        wallet_tx: "id, createdAt, type",
        signal_cache: "key, fetchedAt",
        settings: "id",
        rec_events: "id, createdAt, areaKey"
      })
      .upgrade(async (tx) => {
        const table = tx.table<Settings, string>("settings");
        const existing = await table.get("default");
        const normalized = normalizeSettings(existing ?? undefined);
        if (!existing || JSON.stringify(existing) !== JSON.stringify(normalized)) {
          await table.put(normalized);
        }
      });
    this.version(4)
      .stores({
        trips: "id, startedAt, endedAt",
        wallet_tx: "id, createdAt, type",
        signal_cache: "key, fetchedAt",
        settings: "id",
        rec_events: "id, createdAt, areaKey",
        sessions: "id, startedAt, endedAt, status"
      })
      .upgrade(async (tx) => {
        const table = tx.table<Settings, string>("settings");
        const existing = await table.get("default");
        const normalized = normalizeSettings(existing ?? undefined);
        if (!existing || JSON.stringify(existing) !== JSON.stringify(normalized)) {
          await table.put(normalized);
        }
      });
  }
}

export const db = new AppDB();
