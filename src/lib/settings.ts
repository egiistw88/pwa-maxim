import { db, type Settings } from "./db";
import { defaultWeights } from "./engine/scoring";

const DEFAULT_SETTINGS: Settings = {
  id: "default",
  costPerKm: 250,
  avgSpeedKmh: 22,
  explorationRate: 0.08,
  preferredH3Res: 10,
  weights: defaultWeights()
};

export async function getSettings() {
  const existing = await db.settings.get("default");
  if (existing) {
    return existing;
  }
  await db.settings.put(DEFAULT_SETTINGS);
  return DEFAULT_SETTINGS;
}

export async function updateSettings(partial: Partial<Settings>) {
  const current = await getSettings();
  const next: Settings = {
    ...current,
    ...partial,
    weights: {
      ...current.weights,
      ...(partial.weights ?? {})
    }
  };
  await db.settings.put(next);
  return next;
}
