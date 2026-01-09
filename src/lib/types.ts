export type GeoJsonPolygon = {
  type: "Polygon";
  coordinates: number[][][];
};

export type GeoJsonFeature = {
  type: "Feature";
  geometry: GeoJsonPolygon;
  properties: {
    value: number;
    intensity: number;
  };
};

export type GeoJsonFeatureCollection = {
  type: "FeatureCollection";
  features: GeoJsonFeature[];
};
