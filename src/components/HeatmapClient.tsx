"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LeafletMap, type LeafletMapHandle } from "./LeafletMap";
import {
  addTrip,
  createId,
  getCachedSignal,
  getTrips,
  setCachedSignal,
  type Trip
} from "../lib/data";
import { binPointsToCells, binTripsToCells, cellsToFeatureCollection } from "../lib/grid";
import { type GeoJsonFeatureCollection } from "../lib/types";

type WeatherSummary = {
  hourly: Array<{ time: string; precipitationProbability: number }>;
};

const regions = {
  timur: {
    label: "Bandung Timur",
    bbox: [107.64, -6.96, 107.74, -6.86]
  },
  tengah: {
    label: "Bandung Tengah",
    bbox: [107.58, -6.95, 107.64, -6.88]
  },
  utara: {
    label: "Bandung Utara",
    bbox: [107.57, -6.88, 107.69, -6.8]
  },
  selatan: {
    label: "Bandung Selatan",
    bbox: [107.57, -7.02, 107.69, -6.95]
  },
  barat: {
    label: "Bandung Barat",
    bbox: [107.5, -6.96, 107.58, -6.86]
  }
};

type RegionKey = keyof typeof regions;

const CACHE_TTL = 6 * 60 * 60;
const CELL_SIZE_METERS = 250;

export function HeatmapClient() {
  const [regionKey, setRegionKey] = useState<RegionKey>("timur");
  const [internalGeoJson, setInternalGeoJson] = useState<GeoJsonFeatureCollection>({
    type: "FeatureCollection",
    features: []
  });
  const [poiGeoJson, setPoiGeoJson] = useState<GeoJsonFeatureCollection | null>(null);
  const [weather, setWeather] = useState<WeatherSummary | null>(null);
  const [internalEnabled, setInternalEnabled] = useState(true);
  const [poiEnabled, setPoiEnabled] = useState(true);
  const [rainEnabled, setRainEnabled] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [trips, setTrips] = useState<Trip[]>([]);

  const mapRef = useRef<LeafletMapHandle>(null);

  const region = regions[regionKey];
  const center = useMemo(() => {
    const [minLon, minLat, maxLon, maxLat] = region.bbox;
    return [(minLat + maxLat) / 2, (minLon + maxLon) / 2] as [number, number];
  }, [region]);

  useEffect(() => {
    void loadTrips();
  }, []);

  useEffect(() => {
    if (!internalEnabled) {
      return;
    }
    const cells = binTripsToCells(
      trips.map((trip) => ({
        startLat: trip.startLat,
        startLon: trip.startLon,
        earnings: trip.earnings
      })),
      CELL_SIZE_METERS
    );
    setInternalGeoJson(cellsToFeatureCollection(cells, CELL_SIZE_METERS, center[0]));
  }, [trips, internalEnabled, center]);

  useEffect(() => {
    void loadSignals(false);
  }, [regionKey]);

  useEffect(() => {
    if (rainEnabled && !weather) {
      void loadSignals(false);
    }
  }, [rainEnabled, weather, regionKey]);

  async function loadTrips() {
    const data = await getTrips();
    setTrips(data);
  }

  async function loadSignals(forceRefresh: boolean) {
    setStatus("Memuat sinyal POI & cuaca...");
    try {
      const bbox = region.bbox.join(",");
      const poiKey = `poi:${bbox}`;
      const cachedPoi = !forceRefresh ? await getCachedSignal<{ points: any[] }>(poiKey) : null;
      const poiData =
        cachedPoi ??
        (await fetch(`/api/signals/poi?bbox=${bbox}`).then(async (response) => {
          if (!response.ok) {
            throw new Error("Gagal mengambil POI");
          }
          const data = (await response.json()) as { points: Array<{ lat: number; lon: number }> };
          await setCachedSignal(poiKey, data, CACHE_TTL);
          return data;
        }));

      if (!poiEnabled) {
        setPoiGeoJson(null);
        return;
      }

      const points = poiData?.points ?? [];
      if (points.length === 0) {
        setPoiGeoJson(null);
        return;
      }

      const poiCells = binPointsToCells(
        points.map((point) => ({ lat: point.lat, lon: point.lon })),
        CELL_SIZE_METERS
      );
      setPoiGeoJson(cellsToFeatureCollection(poiCells, CELL_SIZE_METERS, center[0]));

      if (rainEnabled) {
        const [lat, lon] = center;
        const weatherKey = `weather:${lat.toFixed(3)},${lon.toFixed(3)}`;
        const cachedWeather = !forceRefresh
          ? await getCachedSignal<WeatherSummary>(weatherKey)
          : null;
        const weatherData =
          cachedWeather ??
          (await fetch(`/api/signals/weather?lat=${lat}&lon=${lon}`).then(async (response) => {
            if (!response.ok) {
              throw new Error("Gagal mengambil cuaca");
            }
            const data = (await response.json()) as WeatherSummary;
            await setCachedSignal(weatherKey, data, CACHE_TTL);
            return data;
          }));
        setWeather(weatherData);
      }
      setStatus("Sinyal diperbarui.");
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Terjadi kesalahan saat memuat sinyal"
      );
    }
  }

  async function handleAddTrip(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    const startedAt = String(formData.get("startedAt") ?? "");
    const endedAt = String(formData.get("endedAt") ?? "");
    const startLat = Number(formData.get("startLat"));
    const startLon = Number(formData.get("startLon"));
    const endLat = Number(formData.get("endLat"));
    const endLon = Number(formData.get("endLon"));
    const earnings = Number(formData.get("earnings"));
    const note = String(formData.get("note") ?? "");

    if (!startedAt || !endedAt || Number.isNaN(startLat) || Number.isNaN(startLon)) {
      setStatus("Lengkapi data trip.");
      return;
    }
    if (Number.isNaN(endLat) || Number.isNaN(endLon) || Number.isNaN(earnings)) {
      setStatus("Lengkapi koordinat dan pendapatan.");
      return;
    }

    const trip: Trip = {
      id: createId(),
      startedAt: new Date(startedAt).toISOString(),
      endedAt: new Date(endedAt).toISOString(),
      startLat,
      startLon,
      endLat,
      endLon,
      earnings,
      note: note || undefined,
      source: "manual"
    };

    await addTrip(trip);
    event.currentTarget.reset();
    await loadTrips();
    setStatus("Trip tersimpan.");
  }

  const rainRisk = useMemo(() => {
    if (!weather || !rainEnabled) {
      return null;
    }
    const risky = weather.hourly.filter((entry) => entry.precipitationProbability >= 60);
    if (risky.length === 0) {
      return { label: "Tidak ada risiko tinggi", variant: "success" } as const;
    }
    const start = risky[0]?.time.slice(11, 16);
    const end = risky[risky.length - 1]?.time.slice(11, 16);
    return {
      label: `Risiko hujan tinggi ${start}–${end}`,
      variant: "danger"
    } as const;
  }, [weather, rainEnabled]);

  const emptyCollection: GeoJsonFeatureCollection = {
    type: "FeatureCollection",
    features: []
  };

  const layers = useMemo(
    () => [
      {
        id: "internal",
        data: internalGeoJson,
        visible: internalEnabled,
        style: (feature: any) => ({
          color: "#1d4ed8",
          weight: 1,
          fillColor: "#2563eb",
          fillOpacity: Math.min(0.7, 0.2 + (feature?.properties?.intensity ?? 0) * 0.6)
        })
      },
      {
        id: "poi",
        data: poiGeoJson ?? emptyCollection,
        visible: poiEnabled && Boolean(poiGeoJson),
        style: (feature: any) => ({
          color: "#16a34a",
          weight: 1,
          fillColor: "#22c55e",
          fillOpacity: Math.min(0.6, 0.15 + (feature?.properties?.intensity ?? 0) * 0.5)
        })
      }
    ],
    [internalGeoJson, poiGeoJson, internalEnabled, poiEnabled]
  );

  return (
    <div className="grid" style={{ gap: 24 }}>
      <div className="card">
        <div className="grid two">
          <div>
            <h2>Heatmap Bandung</h2>
            <p className="helper-text">
              Peta heatmap local-first dari trip internal + POI + cuaca. Semua data
              disimpan offline.
            </p>
          </div>
          <div className="grid">
            <div className="form-row">
              <div>
                <label htmlFor="region">Wilayah</label>
                <select
                  id="region"
                  value={regionKey}
                  onChange={(event) => setRegionKey(event.target.value as RegionKey)}
                >
                  {Object.entries(regions).map(([key, value]) => (
                    <option key={key} value={key}>
                      {value.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label>&nbsp;</label>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    const [minLon, minLat, maxLon, maxLat] = region.bbox;
                    mapRef.current?.fitBounds([
                      [minLat, minLon],
                      [maxLat, maxLon]
                    ]);
                  }}
                >
                  Fit to area
                </button>
              </div>
            </div>
            <div className="form-row">
              <label>
                <input
                  type="checkbox"
                  checked={internalEnabled}
                  onChange={(event) => setInternalEnabled(event.target.checked)}
                />{" "}
                Heatmap internal
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={poiEnabled}
                  onChange={(event) => setPoiEnabled(event.target.checked)}
                />{" "}
                Heatmap POI
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={rainEnabled}
                  onChange={(event) => setRainEnabled(event.target.checked)}
                />{" "}
                Rain risk
              </label>
            </div>
            <div className="form-row">
              <button type="button" onClick={() => void loadSignals(true)}>
                Refresh Sinyal
              </button>
              {rainRisk && (
                <span className={`badge ${rainRisk.variant === "danger" ? "danger" : "success"}`}>
                  {rainRisk.label}
                </span>
              )}
            </div>
            {status && <div className="helper-text">{status}</div>}
          </div>
        </div>
      </div>

      <LeafletMap ref={mapRef} center={center} zoom={12} layers={layers} />

      <div className="card grid two">
        <div>
          <h3>Legend</h3>
          <div className="legend">
            <span>Low</span>
            <div className="legend-scale" />
            <span>High</span>
          </div>
          <p className="helper-text">
            Heatmap internal berbasis pendapatan trip. POI dihitung dari kepadatan titik.
          </p>
        </div>
        <div>
          <h3>Ringkas</h3>
          <p className="helper-text">
            Trip tersimpan: <strong>{trips.length}</strong>
          </p>
          <p className="helper-text">Wilayah aktif: {region.label}</p>
        </div>
      </div>

      <div className="card">
        <h3>Input Trip Manual</h3>
        <form className="grid" onSubmit={handleAddTrip}>
          <div className="form-row">
            <div>
              <label>Mulai</label>
              <input
                type="datetime-local"
                name="startedAt"
                defaultValue={new Date(Date.now() - 60 * 60 * 1000)
                  .toISOString()
                  .slice(0, 16)}
                required
              />
            </div>
            <div>
              <label>Selesai</label>
              <input
                type="datetime-local"
                name="endedAt"
                defaultValue={new Date().toISOString().slice(0, 16)}
                required
              />
            </div>
            <div>
              <label>Pendapatan (Rp)</label>
              <input type="number" name="earnings" min="0" step="1000" required />
            </div>
          </div>
          <div className="form-row">
            <div>
              <label>Start Lat</label>
              <input type="number" name="startLat" step="0.0001" required />
            </div>
            <div>
              <label>Start Lon</label>
              <input type="number" name="startLon" step="0.0001" required />
            </div>
            <div>
              <label>End Lat</label>
              <input type="number" name="endLat" step="0.0001" required />
            </div>
            <div>
              <label>End Lon</label>
              <input type="number" name="endLon" step="0.0001" required />
            </div>
          </div>
          <div>
            <label>Catatan</label>
            <textarea name="note" rows={2} />
          </div>
          <div>
            <button type="submit">Simpan Trip</button>
          </div>
        </form>
      </div>
    </div>
  );
}
