import type { Settings, Trip } from "../db";
import { buildCellFeatures, type LatLon, type WeatherSummary } from "./features";
import { explain } from "./explain";
import { score, type Weights } from "./scoring";

export type Recommendation = {
  cell: string;
  score: number;
  reasons: string[];
  features: ReturnType<typeof buildCellFeatures>;
};

export function recommendTopCells({
  userLatLon,
  areaKey,
  candidateCells,
  trips,
  poiCells,
  weather,
  settings
}: {
  userLatLon: LatLon;
  areaKey: string;
  candidateCells: string[];
  trips: Trip[];
  poiCells: Map<string, number> | null;
  weather: WeatherSummary | null;
  settings: Settings;
}) {
  void areaKey;
  const now = new Date();
  const weights = settings.weights as Weights;
  const scored: Recommendation[] = candidateCells.map((cellH3) => {
    const features = buildCellFeatures({
      cellH3,
      userLatLon,
      trips,
      poiCells,
      weather,
      now,
      settings
    });
    let scoreValue = score(features, weights);
    if (
      features.internalCount <= 1 &&
      features.poiCount >= 6 &&
      Math.random() < settings.explorationRate
    ) {
      scoreValue += 0.25;
    }
    return {
      cell: cellH3,
      score: scoreValue,
      reasons: explain(features, weights),
      features
    };
  });

  return scored.sort((a, b) => b.score - a.score).slice(0, 3);
}
