import { cellToLatLng, latLngToCell } from "h3-js";
import type { Settings, Trip } from "../db";

export type LatLon = { lat: number; lon: number };

export type WeatherSummary = {
  hourly: Array<{ time: string; precipitationProbability: number }>;
};

export type CellFeatures = {
  internalEph: number;
  internalCount: number;
  recencyScore: number;
  poiCount: number;
  rainRiskNext3h: number;
  travelKm: number;
  travelCost: number;
  hour: number;
  dow: number;
};

export function timeBucket(date: Date) {
  return date.getHours();
}

export function dow(date: Date) {
  return date.getDay();
}

export function haversineKm(a: LatLon, b: LatLon) {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

function computeRainRiskNext3h(weather: WeatherSummary | null, now: Date) {
  if (!weather) {
    return 0;
  }
  const nowMs = now.getTime();
  const horizonMs = nowMs + 3 * 60 * 60 * 1000;
  const inWindow = weather.hourly.filter((entry) => {
    const entryTime = new Date(entry.time).getTime();
    return entryTime >= nowMs && entryTime <= horizonMs;
  });
  if (inWindow.length === 0) {
    return 0;
  }
  const maxRisk = Math.max(
    ...inWindow.map((entry) => entry.precipitationProbability)
  );
  return Math.min(Math.max(maxRisk / 100, 0), 1);
}

export function buildCellFeatures({
  cellH3,
  userLatLon,
  trips,
  poiCells,
  weather,
  now,
  settings
}: {
  cellH3: string;
  userLatLon: LatLon;
  trips: Trip[];
  poiCells: Map<string, number> | null;
  weather: WeatherSummary | null;
  now: Date;
  settings: Settings;
}): CellFeatures {
  let internalCount = 0;
  let earningsSum = 0;
  let hoursSum = 0;
  let latestTripMs = 0;

  trips.forEach((trip) => {
    if (trip.startLat === null || trip.startLon === null) {
      return;
    }
    const tripCell = latLngToCell(trip.startLat, trip.startLon, settings.preferredH3Res);
    if (tripCell !== cellH3) {
      return;
    }
    internalCount += 1;
    earningsSum += trip.earnings;
    const startedAt = new Date(trip.startedAt).getTime();
    const endedAt = new Date(trip.endedAt).getTime();
    const hours = Math.max((endedAt - startedAt) / 3_600_000, 0.1);
    hoursSum += hours;
    latestTripMs = Math.max(latestTripMs, endedAt);
  });

  const internalEph = hoursSum > 0 ? earningsSum / hoursSum : 0;
  const daysSince = latestTripMs
    ? (now.getTime() - latestTripMs) / (24 * 60 * 60 * 1000)
    : Infinity;
  const recencyScore = Number.isFinite(daysSince) ? 1 / (1 + daysSince) : 0;

  const poiCount = poiCells?.get(cellH3) ?? 0;
  const rainRiskNext3h = computeRainRiskNext3h(weather, now);

  const [cellLat, cellLon] = cellToLatLng(cellH3);
  const travelKm = haversineKm(userLatLon, { lat: cellLat, lon: cellLon });
  const travelCost = travelKm * settings.costPerKm;

  return {
    internalEph,
    internalCount,
    recencyScore,
    poiCount,
    rainRiskNext3h,
    travelKm,
    travelCost,
    hour: timeBucket(now),
    dow: dow(now)
  };
}
