export type PointInput = {
  lat: number;
  lon: number;
  value?: number;
};

export type CellAggregate = {
  key: string;
  value: number;
};

export type TripInput = {
  startLat: number;
  startLon: number;
  earnings: number;
};

export function latLonToCellKey(lat: number, lon: number, cellSizeMeters: number) {
  const degLat = cellSizeMeters / 111_320;
  const degLon = cellSizeMeters / (111_320 * Math.cos((lat * Math.PI) / 180));
  const i = Math.floor(lat / degLat);
  const j = Math.floor(lon / degLon);
  return `${i}:${j}`;
}

export function cellKeyToPolygon(
  key: string,
  cellSizeMeters: number,
  referenceLat: number
) {
  const [iStr, jStr] = key.split(":");
  const i = Number(iStr);
  const j = Number(jStr);
  const degLat = cellSizeMeters / 111_320;
  const degLon = cellSizeMeters / (111_320 * Math.cos((referenceLat * Math.PI) / 180));
  const minLat = i * degLat;
  const minLon = j * degLon;
  const maxLat = minLat + degLat;
  const maxLon = minLon + degLon;

  return {
    type: "Polygon",
    coordinates: [
      [
        [minLon, minLat],
        [maxLon, minLat],
        [maxLon, maxLat],
        [minLon, maxLat],
        [minLon, minLat]
      ]
    ]
  };
}

export function binPointsToCells(points: PointInput[], cellSizeMeters: number) {
  const bins = new Map<string, number>();
  points.forEach((point) => {
    const key = latLonToCellKey(point.lat, point.lon, cellSizeMeters);
    const value = point.value ?? 1;
    bins.set(key, (bins.get(key) ?? 0) + value);
  });
  return Array.from(bins.entries()).map(([key, value]) => ({ key, value }));
}

export function binTripsToCells(trips: TripInput[], cellSizeMeters: number) {
  const bins = new Map<string, number>();
  trips.forEach((trip) => {
    const key = latLonToCellKey(trip.startLat, trip.startLon, cellSizeMeters);
    bins.set(key, (bins.get(key) ?? 0) + Math.max(trip.earnings, 1));
  });
  return Array.from(bins.entries()).map(([key, value]) => ({ key, value }));
}

export function cellsToFeatureCollection(
  cells: CellAggregate[],
  cellSizeMeters: number,
  referenceLat: number
) {
  const maxValue = cells.reduce((acc, cell) => Math.max(acc, cell.value), 0);
  return {
    type: "FeatureCollection",
    features: cells.map((cell) => ({
      type: "Feature",
      geometry: cellKeyToPolygon(cell.key, cellSizeMeters, referenceLat),
      properties: {
        value: cell.value,
        intensity: maxValue > 0 ? cell.value / maxValue : 0
      }
    }))
  };
}
