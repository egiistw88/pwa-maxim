"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import maplibregl, { type Map as MapLibreMap, type StyleSpecification } from "maplibre-gl";
import { nanoid } from "nanoid";
import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { db, type Trip } from "../lib/db";
import { binPointsToH3, h3CellsToGeoJSON } from "../lib/h3";
import type { GeoJsonFeatureCollection } from "../lib/geojsonTypes";
import { getOrFetchSignal, type SignalMeta } from "../lib/signals";
import { useNetworkStatus } from "../lib/useNetworkStatus";

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

type WeatherSummary = {
  hourly: Array<{ time: string; precipitationProbability: number }>;
};

const tripSchema = z.object({
  startedAt: z.string().min(1, "Mulai wajib"),
  endedAt: z.string().min(1, "Selesai wajib"),
  startLat: z.coerce.number(),
  startLon: z.coerce.number(),
  endLat: z.coerce.number(),
  endLon: z.coerce.number(),
  earnings: z.coerce.number().min(0),
  note: z.string().optional()
});

const H3_RESOLUTION = 9;
const CACHE_TTL = 6 * 60 * 60;

const mapStyle: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors"
    }
  },
  layers: [
    {
      id: "osm",
      type: "raster",
      source: "osm"
    }
  ]
};

export function HeatmapClient() {
  const [regionKey, setRegionKey] = useState<RegionKey>("timur");
  const [internalGeoJson, setInternalGeoJson] = useState<GeoJsonFeatureCollection>({
    type: "FeatureCollection" as const,
    features: []
  });
  const [poiGeoJson, setPoiGeoJson] = useState<GeoJsonFeatureCollection>({
    type: "FeatureCollection" as const,
    features: []
  });
  const [weather, setWeather] = useState<WeatherSummary | null>(null);
  const [internalEnabled, setInternalEnabled] = useState(true);
  const [poiEnabled, setPoiEnabled] = useState(true);
  const [rainEnabled, setRainEnabled] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [poiMeta, setPoiMeta] = useState<SignalMeta | null>(null);
  const [weatherMeta, setWeatherMeta] = useState<SignalMeta | null>(null);

  const { isOnline } = useNetworkStatus();

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);

  const region = regions[regionKey];
  const center = useMemo(() => {
    const [minLon, minLat, maxLon, maxLat] = region.bbox;
    return [(minLon + maxLon) / 2, (minLat + maxLat) / 2] as [number, number];
  }, [region]);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) {
      return;
    }

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: mapStyle,
      center,
      zoom: 12
    });

    map.addControl(new maplibregl.NavigationControl(), "top-right");

    map.on("load", () => {
      map.addSource("internal", {
        type: "geojson",
        data: internalGeoJson
      });
      map.addSource("poi", {
        type: "geojson",
        data: poiGeoJson
      });

      map.addLayer({
        id: "internal-fill",
        type: "fill",
        source: "internal",
        paint: {
          "fill-color": [
            "interpolate",
            ["linear"],
            ["get", "intensity"],
            0,
            "#bfdbfe",
            1,
            "#1d4ed8"
          ],
          "fill-opacity": 0.55
        }
      });

      map.addLayer({
        id: "poi-fill",
        type: "fill",
        source: "poi",
        paint: {
          "fill-color": [
            "interpolate",
            ["linear"],
            ["get", "intensity"],
            0,
            "#bbf7d0",
            1,
            "#16a34a"
          ],
          "fill-opacity": 0.45
        }
      });
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [center]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    const source = map.getSource("internal") as maplibregl.GeoJSONSource | undefined;
    if (source) {
      source.setData(internalGeoJson);
    }
  }, [internalGeoJson]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    const source = map.getSource("poi") as maplibregl.GeoJSONSource | undefined;
    if (source) {
      source.setData(poiGeoJson);
    }
  }, [poiGeoJson]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    if (map.getLayer("internal-fill")) {
      map.setLayoutProperty(
        "internal-fill",
        "visibility",
        internalEnabled ? "visible" : "none"
      );
    }
    if (map.getLayer("poi-fill")) {
      map.setLayoutProperty("poi-fill", "visibility", poiEnabled ? "visible" : "none");
    }
  }, [internalEnabled, poiEnabled]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }
    map.setCenter(center);
  }, [center]);

  useEffect(() => {
    void loadTrips();
  }, []);

  useEffect(() => {
    if (!internalEnabled) {
      return;
    }
    const points = trips.map((trip) => ({
      lat: trip.startLat,
      lon: trip.startLon,
      value: Math.max(trip.earnings, 1)
    }));
    const cells = binPointsToH3(points, H3_RESOLUTION);
    setInternalGeoJson(h3CellsToGeoJSON(cells));
  }, [trips, internalEnabled]);

  useEffect(() => {
    void loadSignals(false);
  }, [regionKey]);

  useEffect(() => {
    if (rainEnabled && !weather) {
      void loadSignals(false);
    }
  }, [rainEnabled, weather, regionKey]);

  async function loadTrips() {
    const data = await db.trips.orderBy("startedAt").reverse().toArray();
    setTrips(data);
  }

  async function loadSignals(forceRefresh: boolean) {
    if (!isOnline) {
      setStatus(
        forceRefresh
          ? "Offline. Menampilkan cache terakhir (tanpa fetch)."
          : "Offline. Menggunakan cache terakhir."
      );
    } else {
      setStatus("Memuat sinyal POI & cuaca...");
    }
    try {
      const bbox = region.bbox.join(",");
      const poiKey = `poi:${bbox}`;
      const poiResult = await getOrFetchSignal(
        poiKey,
        CACHE_TTL,
        async () => {
          const response = await fetch(`/api/signals/poi?bbox=${bbox}`);
          if (!response.ok) {
            throw new Error("Gagal mengambil POI");
          }
          return (await response.json()) as {
            points: Array<{ lat: number; lon: number }>;
          };
        },
        {
          forceRefresh: forceRefresh && isOnline,
          allowNetwork: isOnline,
          allowStale: true
        }
      );
      setPoiMeta(poiResult.meta);

      const poiCells = binPointsToH3(
        poiResult.payload.points.map((point) => ({ lat: point.lat, lon: point.lon })),
        H3_RESOLUTION
      );
      setPoiGeoJson(h3CellsToGeoJSON(poiCells));

      if (rainEnabled) {
        const [lon, lat] = center;
        const weatherKey = `weather:${lat.toFixed(3)},${lon.toFixed(3)}`;
        const weatherResult = await getOrFetchSignal(
          weatherKey,
          CACHE_TTL,
          async () => {
            const response = await fetch(`/api/signals/weather?lat=${lat}&lon=${lon}`);
            if (!response.ok) {
              throw new Error("Gagal mengambil cuaca");
            }
            return (await response.json()) as WeatherSummary;
          },
          {
            forceRefresh: forceRefresh && isOnline,
            allowNetwork: isOnline,
            allowStale: true
          }
        );
        setWeather(weatherResult.payload);
        setWeatherMeta(weatherResult.meta);
      } else {
        setWeather(null);
        setWeatherMeta(null);
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
    const parsed = tripSchema.safeParse({
      startedAt: formData.get("startedAt"),
      endedAt: formData.get("endedAt"),
      startLat: formData.get("startLat"),
      startLon: formData.get("startLon"),
      endLat: formData.get("endLat"),
      endLon: formData.get("endLon"),
      earnings: formData.get("earnings"),
      note: formData.get("note")
    });

    if (!parsed.success) {
      setStatus(parsed.error.flatten().formErrors.join(", "));
      return;
    }

    const trip: Trip = {
      id: nanoid(),
      startedAt: new Date(parsed.data.startedAt).toISOString(),
      endedAt: new Date(parsed.data.endedAt).toISOString(),
      startLat: parsed.data.startLat,
      startLon: parsed.data.startLon,
      endLat: parsed.data.endLat,
      endLon: parsed.data.endLon,
      earnings: parsed.data.earnings,
      note: parsed.data.note,
      source: "manual"
    };

    await db.trips.add(trip);
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

  const poiCacheLabel = formatCacheLabel("Sinyal POI", poiMeta);
  const weatherCacheLabel = formatCacheLabel("Cuaca", weatherMeta);

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
                    const map = mapRef.current;
                    if (!map) {
                      return;
                    }
                    const [minLon, minLat, maxLon, maxLat] = region.bbox;
                    map.fitBounds(
                      [
                        [minLon, minLat],
                        [maxLon, maxLat]
                      ],
                      { padding: 20 }
                    );
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
              <span className={`badge ${isOnline ? "success" : "danger"}`}>
                {isOnline ? "Online" : "Offline"}
              </span>
            </div>
            <div className="helper-text">{poiCacheLabel}</div>
            <div className="helper-text">{weatherCacheLabel}</div>
            {status && <div className="helper-text">{status}</div>}
          </div>
        </div>
      </div>

      <div className="map-wrapper" ref={mapContainerRef} />

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

function formatCacheLabel(label: string, meta: SignalMeta | null) {
  if (!meta || meta.ageSeconds === null) {
    return `${label}: belum ada cache`;
  }
  if (meta.isFresh && !meta.fromCache) {
    return `${label}: fresh`;
  }
  const hours = (meta.ageSeconds / 3600).toFixed(1);
  return `${label}: cached ${hours} jam`;
}
