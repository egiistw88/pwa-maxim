import type { CellFeatures } from "./features";

export type Weights = {
  wInternal: number;
  wRecency: number;
  wPoi: number;
  wTravel: number;
  wRain: number;
};

export function defaultWeights(): Weights {
  return {
    wInternal: 1.0,
    wRecency: 0.5,
    wPoi: 0.25,
    wTravel: -0.6,
    wRain: -0.2
  };
}

function normalizeLog(value: number) {
  return Math.log1p(Math.max(value, 0));
}

export function score(features: CellFeatures, weights: Weights) {
  const internalNorm = normalizeLog(features.internalEph);
  const poiNorm = normalizeLog(features.poiCount);
  const travelNorm = normalizeLog(features.travelCost);
  const rainRisk = Math.min(Math.max(features.rainRiskNext3h, 0), 1);

  const rainHeavy = rainRisk >= 0.6;
  const wPoiAdj = rainHeavy ? weights.wPoi * 1.2 : weights.wPoi;
  const wTravelAdj = rainHeavy ? weights.wTravel * 1.3 : weights.wTravel;

  return (
    weights.wInternal * internalNorm +
    weights.wRecency * features.recencyScore +
    wPoiAdj * poiNorm +
    wTravelAdj * travelNorm +
    weights.wRain * rainRisk
  );
}

export function updateWeightsFromOutcome({
  predictedScoreAtStart,
  actualEph,
  weights
}: {
  predictedScoreAtStart: number;
  actualEph: number;
  weights: Weights;
}): Weights {
  const safePred = Math.max(predictedScoreAtStart, 1);
  const ratio = (actualEph - safePred) / safePred;
  const clipped = Math.max(Math.min(ratio, 0.2), -0.2);
  const lr = 0.05;
  const delta = clipped * lr;

  return {
    ...weights,
    wInternal: weights.wInternal + delta,
    wRecency: weights.wRecency + delta / 2,
    wPoi: weights.wPoi + delta / 3,
    wTravel: weights.wTravel - delta / 2,
    wRain: weights.wRain - delta / 3
  };
}
