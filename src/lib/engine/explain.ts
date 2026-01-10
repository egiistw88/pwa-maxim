import type { CellFeatures } from "./features";
import type { Weights } from "./scoring";

function normalizeLog(value: number) {
  return Math.log1p(Math.max(value, 0));
}

export function explain(features: CellFeatures, weights: Weights) {
  const internalNorm = normalizeLog(features.internalEph);
  const poiNorm = normalizeLog(features.poiCount);
  const travelNorm = normalizeLog(features.travelCost);
  const rainRisk = Math.min(Math.max(features.rainRiskNext3h, 0), 1);
  const rainHeavy = rainRisk >= 0.6;
  const wPoiAdj = rainHeavy ? weights.wPoi * 1.2 : weights.wPoi;
  const wTravelAdj = rainHeavy ? weights.wTravel * 1.3 : weights.wTravel;

  const contributions = [
    {
      key: "internal",
      value: weights.wInternal * internalNorm,
      reason: "Riwayat jam ini bagus"
    },
    {
      key: "recency",
      value: weights.wRecency * features.recencyScore,
      reason: "Aktivitas terbaru mendukung"
    },
    {
      key: "poi",
      value: wPoiAdj * poiNorm,
      reason: "POI padat di sekitar"
    },
    {
      key: "travel",
      value: wTravelAdj * travelNorm,
      reason: features.travelKm <= 2 ? "Dekat dari posisi sekarang" : "Biaya pindah lumayan"
    },
    {
      key: "rain",
      value: weights.wRain * rainRisk,
      reason: rainHeavy
        ? "Risiko hujan tinggi (lebih baik indoor)"
        : "Cuaca relatif aman"
    }
  ];

  return contributions
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, 3)
    .map((item) => item.reason);
}
