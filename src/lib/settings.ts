import { db, defaultSettings, normalizeSettings, type Settings } from "./db";

export async function getSettings() {
  const existing = await db.settings.get("default");
  if (existing) {
    const normalized = normalizeSettings(existing);
    if (JSON.stringify(existing) !== JSON.stringify(normalized)) {
      await db.settings.put(normalized);
    }
    return normalized;
  }
  const normalized = normalizeSettings(defaultSettings);
  await db.settings.put(normalized);
  return normalized;
}

export async function updateSettings(partial: Partial<Settings>) {
  const current = await getSettings();
  const next = normalizeSettings({
    ...current,
    ...partial,
    weights: {
      ...current.weights,
      ...(partial.weights ?? {})
    }
  });
  await db.settings.put(next);
  return next;
}
