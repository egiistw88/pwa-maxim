import type { FeatureCollection, Polygon } from "geojson";
import { cellToBoundary, latLngToCell } from "h3-js";

export type PointInput = {
  lat: number;
  lon: number;
  value?: number;
};

export type H3CellAggregate = {
  cell: string;
  value: number;
};

export function binPointsToH3(points: PointInput[], resolution: number) {
  const bins = new Map<string, number>();
  points.forEach((point) => {
    const cell = latLngToCell(point.lat, point.lon, resolution);
    const current = bins.get(cell) ?? 0;
    const value = point.value ?? 1;
    bins.set(cell, current + value);
  });

  return Array.from(bins.entries()).map(([cell, value]) => ({
    cell,
    value
  }));
}

export function h3CellsToGeoJSON(cells: H3CellAggregate[]): FeatureCollection<Polygon> {
  const maxValue = cells.reduce((acc, cell) => Math.max(acc, cell.value), 0);

  return {
    type: "FeatureCollection",
    features: cells.map((cell) => {
      const boundary = cellToBoundary(cell.cell, true);
      const coordinates = [boundary.map(([lat, lon]) => [lon, lat])];
      const intensity = maxValue > 0 ? cell.value / maxValue : 0;
      return {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates
        },
        properties: {
          value: cell.value,
          intensity
        }
      };
    })
  };
}
