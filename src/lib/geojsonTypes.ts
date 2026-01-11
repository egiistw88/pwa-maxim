export type GeoJsonPolygon = { type: "Polygon"; coordinates: number[][][] };
export type GeoJsonPoint = { type: "Point"; coordinates: number[] };
export type GeoJsonGeometry = GeoJsonPolygon | GeoJsonPoint;

export type GeoJsonFeature<P = Record<string, unknown>> = {
  type: "Feature";
  geometry: GeoJsonGeometry;
  properties: P;
};

export type GeoJsonFeatureCollection<P = Record<string, unknown>> = {
  type: "FeatureCollection";
  features: Array<GeoJsonFeature<P>>;
};
