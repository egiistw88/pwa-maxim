export type GeoJsonPolygon = { type: "Polygon"; coordinates: number[][][] };

export type GeoJsonFeature<P = Record<string, unknown>> = {
  type: "Feature";
  geometry: GeoJsonPolygon;
  properties: P;
};

export type GeoJsonFeatureCollection<P = Record<string, unknown>> = {
  type: "FeatureCollection";
  features: Array<GeoJsonFeature<P>>;
};
