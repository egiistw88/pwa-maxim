"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import maplibregl, { type Map as MapLibreMap, type StyleSpecification } from "maplibre-gl";
import { nanoid } from "nanoid";
import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { cellToLatLng, latLngToCell } from "h3-js";
import { db, type Settings, type Session, type Trip } from "../lib/db";
import { type LatLon, type WeatherSummary } from "../lib/engine/features";
import { recommendTopCells, type Recommendation } from "../lib/engine/recommend";
import { updateWeightsFromOutcome, type Weights } from "../lib/engine/scoring";
import { binPointsToH3, h3CellsToGeoJSON } from "../lib/h3";
import { getSettings, updateSettings } from "../lib/settings";
import { attachToActiveSession, computeActiveMinutes } from "../lib/session";
import type { GeoJsonFeatureCollection } from "../lib/geojsonTypes";
import { getOrFetchSignal, type SignalMeta } from "../lib/signals";
import { useNetworkStatus } from "../lib/useNetworkStatus";
import { regions, type RegionKey } from "../lib/regions";
import { useLiveQueryState } from "../lib/useLiveQueryState";

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
  const [poiPoints, setPoiPoints] = useState<Array<{ lat: number; lon: number }>>([]);
  const [poiMeta, setPoiMeta] = useState<SignalMeta | null>(null);
  const [weatherMeta, setWeatherMeta] = useState<SignalMeta | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(true);
  const [myPos, setMyPos] = useState<LatLon | null>(null);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [sessionActiveMinutes, setSessionActiveMinutes] = useState<number | null>(null);
  const [draftTripStart, setDraftTripStart] = useState<{
    startedAt: string;
    startLat: number;
    startLon: number;
    predictedScoreAtStart: number;
    sessionId?: string;
  } | null>(null);
  const [earningsInput, setEarningsInput] = useState<string>("");

  const { isOnline } = useNetworkStatus();

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const timerRef = useRef<number | null>(null);

  const region = regions[regionKey];
  const center = useMemo(() => {
    const [minLon, minLat, maxLon, maxLat] = region.bbox;
    return [(minLon + maxLon) / 2, (minLat + maxLat) / 2] as [number, number];
  }, [region]);

  const liveTrips = useLiveQueryState(async () => {
    return db.trips.orderBy("startedAt").reverse().toArray();
  }, [], [] as Trip[]);

  const liveSettings = useLiveQueryState(async () => getSettings(), [], null as Settings | null);

  const liveSession = useLiveQueryState(async () => {
    const openSessions = await db.sessions.where("status").anyOf("active", "paused").toArray();
    if (openSessions.length === 0) {
      return null;
    }
    return openSessions.sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    )[0];
  }, [], null as Session | null);

  useEffect(() => {
    setTrips(liveTrips);
  }, [liveTrips]);

  useEffect(() => {
    setSettings(liveSettings);
  }, [liveSettings]);

  useEffect(() => {
    setActiveSession(liveSession);
  }, [liveSession]);

  useEffect(() => {
    if (!activeSession) {
      setSessionActiveMinutes(null);
      return;
    }
    const updateActiveMinutes = () => {
      setSessionActiveMinutes(computeActiveMinutes(activeSession, new Date()));
    };
    updateActiveMinutes();
    const interval = window.setInterval(updateActiveMinutes, 1000);
    return () => window.clearInterval(interval);
  }, [activeSession]);

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
    if (!settings) {
      void loadSettings();
    }
  }, [settings]);

  useEffect(() => {
    if (!internalEnabled) {
      return;
    }
    const points = trips
      .filter((trip) => trip.startLat !== null && trip.startLon !== null)
      .map((trip) => ({
        lat: trip.startLat as number,
        lon: trip.startLon as number,
        value: Math.max(trip.earnings, 1)
      }));
    const cells = binPointsToH3(points, H3_RESOLUTION);
    setInternalGeoJson(h3CellsToGeoJSON(cells));
  }, [trips, internalEnabled]);

  useEffect(() => {
    if (countdown === null) {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }
    if (countdown <= 0) {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }
    if (timerRef.current) {
      return;
    }
    timerRef.current = window.setInterval(() => {
      setCountdown((prev) => (prev && prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [countdown]);

  useEffect(() => {
    void loadSignals(false);
  }, [regionKey]);

  useEffect(() => {
    if (rainEnabled && !weather) {
      void loadSignals(false);
    }
  }, [rainEnabled, weather, regionKey]);

  async function loadSettings() {
    const loaded = await getSettings();
    setSettings(loaded);
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
      setPoiPoints(poiResult.payload.points);

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

    const tripWithSession = await attachToActiveSession(trip);
    await db.trips.add(tripWithSession);
    event.currentTarget.reset();
    setStatus("Trip tersimpan.");
  }

  function buildCandidateCells(
    points: Array<{ lat: number; lon: number }>,
    settingsData: Settings
  ) {
    const [minLon, minLat, maxLon, maxLat] = region.bbox;
    const inBbox = (lat: number, lon: number) =>
      lat >= minLat && lat <= maxLat && lon >= minLon && lon <= maxLon;

    const internalCounts = new Map<string, number>();
    trips.forEach((trip) => {
      if (
        trip.startLat === null ||
        trip.startLon === null ||
        !inBbox(trip.startLat, trip.startLon)
      ) {
        return;
      }
      const cell = latLngToCell(trip.startLat, trip.startLon, settingsData.preferredH3Res);
      internalCounts.set(cell, (internalCounts.get(cell) ?? 0) + 1);
    });

    const poiCounts = new Map<string, number>();
    points.forEach((point) => {
      if (!inBbox(point.lat, point.lon)) {
        return;
      }
      const cell = latLngToCell(point.lat, point.lon, settingsData.preferredH3Res);
      poiCounts.set(cell, (poiCounts.get(cell) ?? 0) + 1);
    });

    const combined = new Map<string, { internalCount: number; poiCount: number }>();
    internalCounts.forEach((count, cell) => {
      combined.set(cell, { internalCount: count, poiCount: poiCounts.get(cell) ?? 0 });
    });
    poiCounts.forEach((count, cell) => {
      if (!combined.has(cell)) {
        combined.set(cell, { internalCount: 0, poiCount: count });
      }
    });

    const ranked = Array.from(combined.entries())
      .map(([cell, counts]) => ({ cell, ...counts }))
      .sort((a, b) => b.internalCount - a.internalCount || b.poiCount - a.poiCount)
      .slice(0, 300);

    return {
      candidateCells: ranked.map((entry) => entry.cell),
      poiCounts
    };
  }

  async function getCurrentPosition() {
    return new Promise<LatLon>((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("Geolocation tidak didukung"));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        },
        (error) => {
          reject(error);
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    });
  }

  function getRainRiskNext3hValue(value: WeatherSummary | null) {
    if (!value) {
      return 0;
    }
    const nowMs = Date.now();
    const horizonMs = nowMs + 3 * 60 * 60 * 1000;
    const inWindow = value.hourly.filter((entry) => {
      const entryTime = new Date(entry.time).getTime();
      return entryTime >= nowMs && entryTime <= horizonMs;
    });
    if (inWindow.length === 0) {
      return 0;
    }
    const maxRisk = Math.max(
      ...inWindow.map((entry) => entry.precipitationProbability)
    );
    return Math.min(Math.max(maxRisk / 100, 0), 1);
  }

  async function handleStartNgetem() {
    try {
      setStatus("Mengambil lokasi...");
      const position = await getCurrentPosition();
      setMyPos(position);
      const settingsData = settings ?? (await getSettings());
      setSettings(settingsData);
      const { candidateCells, poiCounts } = buildCandidateCells(poiPoints, settingsData);
      if (candidateCells.length === 0) {
        setStatus("Belum ada kandidat. Tambah trip atau POI dulu.");
        return;
      }
      const top = recommendTopCells({
        userLatLon: position,
        areaKey: regionKey,
        candidateCells,
        trips,
        poiCells: poiCounts,
        weather,
        settings: settingsData
      });
      setRecommendations(top);
      const rainRiskValue = getRainRiskNext3hValue(weather);
      const defaultBreakMinutes = settingsData.defaultBreakMinutes ?? 30;
      const fatigueReduction = sessionActiveMinutes
        ? Math.min(Math.floor(sessionActiveMinutes / 60) * 2, 10)
        : 0;
      let recommendedMinutes = Math.max(defaultBreakMinutes - fatigueReduction, 10);
      if (rainRiskValue >= 0.6) {
        recommendedMinutes = Math.min(recommendedMinutes, 10);
      }
      setCountdown(recommendedMinutes * 60);
      await db.rec_events.add({
        id: nanoid(),
        createdAt: new Date().toISOString(),
        userLat: position.lat,
        userLon: position.lon,
        areaKey: regionKey,
        recommended: top.map((item) => ({
          cell: item.cell,
          score: item.score,
          reasons: item.reasons
        }))
      });
      setStatus("Rekomendasi siap.");
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "Gagal mengambil lokasi untuk rekomendasi"
      );
    }
  }

  async function handleStartOrder() {
    try {
      setStatus("Mengambil lokasi mulai order...");
      const position = await getCurrentPosition();
      const predictedScoreAtStart = recommendations[0]?.score ?? 0;
      const activeSessionId = activeSession?.id;
      setDraftTripStart({
        startedAt: new Date().toISOString(),
        startLat: position.lat,
        startLon: position.lon,
        predictedScoreAtStart,
        sessionId: activeSessionId
      });
      setStatus("Order dimulai.");
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Gagal mengambil lokasi mulai order"
      );
    }
  }

  async function handleFinishOrder() {
    if (!draftTripStart) {
      setStatus("Mulai order dulu.");
      return;
    }
    const earningsValue = Number(earningsInput);
    if (!Number.isFinite(earningsValue) || earningsValue <= 0) {
      setStatus("Isi pendapatan minimal.");
      return;
    }
    try {
      setStatus("Mengambil lokasi selesai order...");
      const position = await getCurrentPosition();
      const endedAt = new Date().toISOString();
      const trip: Trip = {
        id: nanoid(),
        startedAt: draftTripStart.startedAt,
        endedAt,
        startLat: draftTripStart.startLat,
        startLon: draftTripStart.startLon,
        endLat: position.lat,
        endLon: position.lon,
        earnings: earningsValue,
        source: "assistant",
        sessionId: draftTripStart.sessionId
      };
      const tripWithSession = await attachToActiveSession(trip);
      await db.trips.add(tripWithSession);
      const durationHours = Math.max(
        (new Date(endedAt).getTime() - new Date(draftTripStart.startedAt).getTime()) /
          3_600_000,
        0.1
      );
      const actualEph = earningsValue / durationHours;
      if (settings) {
        const updatedWeights = updateWeightsFromOutcome({
          predictedScoreAtStart: draftTripStart.predictedScoreAtStart,
          actualEph,
          weights: settings.weights as Weights
        });
        const updated = await updateSettings({ weights: updatedWeights });
        setSettings(updated);
      }
      setDraftTripStart(null);
      setEarningsInput("");
      setStatus("Order selesai & trip tersimpan.");
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Gagal menyimpan order selesai"
      );
    }
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
  const rainRiskValue = useMemo(() => getRainRiskNext3hValue(weather), [weather]);
  const sessionTripEarnings = useMemo(() => {
    if (!activeSession) {
      return 0;
    }
    return trips
      .filter((trip) => trip.sessionId === activeSession.id)
      .reduce((sum, trip) => sum + trip.earnings, 0);
  }, [activeSession, trips]);
  const sessionActiveHours = sessionActiveMinutes ? sessionActiveMinutes / 60 : null;
  const sessionPace =
    sessionActiveHours && sessionActiveHours > 0
      ? sessionTripEarnings / sessionActiveHours
      : null;

  return (
    <div className="grid" style={{ gap: 24 }}>
      <div className="card">
        <h2 className="page-title">Heatmap Bandung</h2>
        <p className="helper-text">
          Peta heatmap local-first dari trip internal, POI, dan cuaca. Data tetap tersedia offline.
        </p>
        <div className="stacked" style={{ marginTop: 12 }}>
          <div>
            <strong>Wilayah</strong>
            <div className="segment-group" style={{ marginTop: 8 }}>
              {Object.entries(regions).map(([key, value]) => (
                <button
                  key={key}
                  type="button"
                  className={`segment-button ${regionKey === key ? "active" : ""}`}
                  onClick={() => setRegionKey(key as RegionKey)}
                >
                  {value.label.replace("Bandung ", "")}
                </button>
              ))}
            </div>
          </div>
          <div>
            <strong>Layer</strong>
            <div className="toggle-row" style={{ marginTop: 8 }}>
              <button
                type="button"
                className={internalEnabled ? "segment-button active" : "segment-button"}
                onClick={() => setInternalEnabled((prev) => !prev)}
              >
                Internal
              </button>
              <button
                type="button"
                className={poiEnabled ? "segment-button active" : "segment-button"}
                onClick={() => setPoiEnabled((prev) => !prev)}
              >
                POI
              </button>
              <button
                type="button"
                className={rainEnabled ? "segment-button active" : "segment-button"}
                onClick={() => setRainEnabled((prev) => !prev)}
              >
                Cuaca
              </button>
            </div>
          </div>
          <div className="status-panel">
            <div className="form-row">
              <span className={`badge ${isOnline ? "success" : "danger"}`}>
                {isOnline ? "Online" : "Offline"}
              </span>
              <span className="badge">{poiCacheLabel}</span>
              <span className="badge">{weatherCacheLabel}</span>
              {rainRisk && (
                <span
                  className={`badge ${rainRisk.variant === "danger" ? "danger" : "success"}`}
                >
                  {rainRisk.label}
                </span>
              )}
            </div>
            <div className="form-row">
              <button type="button" className="ghost" onClick={() => void loadSignals(true)}>
                Refresh Sinyal
              </button>
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
                Fit Area
              </button>
            </div>
            {status && <div className="helper-text">{status}</div>}
          </div>
        </div>
      </div>

      <div className="map-wrapper" ref={mapContainerRef} />

      <div className="card">
        <div className="form-row" style={{ justifyContent: "space-between" }}>
          <h3>Asisten Ngetem</h3>
          <button
            type="button"
            className="ghost"
            onClick={() => setAssistantOpen((prev) => !prev)}
          >
            {assistantOpen ? "Tutup" : "Buka"}
          </button>
        </div>
        {assistantOpen && (
          <div className="grid" style={{ gap: 16 }}>
            <div className="helper-text">
              Top rekomendasi spot ngetem, alasan singkat, dan timer adaptif cuaca.
            </div>
            {activeSession && (
              <div className="helper-text">
                Jam aktif sesi: {sessionActiveHours ? sessionActiveHours.toFixed(2) : "0.00"} jam
                • Pace sesi: {sessionPace ? `Rp ${sessionPace.toLocaleString("id-ID")}/jam` : "N/A"}
              </div>
            )}
            <div className="form-row">
              <button type="button" onClick={() => void handleStartNgetem()}>
                Ngetem Now
              </button>
              {countdown !== null && countdown > 0 && (
                <span className="badge">
                  Sisa waktu: {Math.floor(countdown / 60)}:
                  {String(countdown % 60).padStart(2, "0")}
                </span>
              )}
              {countdown !== null && countdown <= 0 && (
                <button type="button" className="ghost" onClick={() => void handleStartNgetem()}>
                  Hitung ulang rekomendasi
                </button>
              )}
            </div>
            {myPos && (
              <div className="helper-text">
                Posisi: {myPos.lat.toFixed(5)}, {myPos.lon.toFixed(5)}
              </div>
            )}
            <div className="grid" style={{ gap: 12 }}>
              {recommendations.length === 0 && (
                <div className="helper-text">Belum ada rekomendasi.</div>
              )}
              {recommendations.map((rec, index) => {
                const [lat, lon] = cellToLatLng(rec.cell);
                const dest = `${lat},${lon}`;
                return (
                  <div key={rec.cell} className="card" style={{ padding: 16 }}>
                    <div className="form-row" style={{ justifyContent: "space-between" }}>
                      <strong>Spot #{index + 1}</strong>
                      <span className="badge">Score {rec.score.toFixed(2)}</span>
                    </div>
                    <div className="helper-text">
                      {rec.reasons.map((reason) => (
                        <div key={reason}>• {reason}</div>
                      ))}
                    </div>
                    <div className="form-row">
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => {
                          window.open(
                            `https://www.google.com/maps/dir/?api=1&destination=${dest}`,
                            "_blank"
                          );
                        }}
                      >
                        Navigasi
                      </button>
                      <span className="helper-text">
                        {lat.toFixed(5)}, {lon.toFixed(5)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="card" style={{ padding: 16 }}>
              <h4>Input Trip Cepat</h4>
              <div className="form-row">
                <button type="button" onClick={() => void handleStartOrder()}>
                  Mulai order
                </button>
                {draftTripStart && (
                  <span className="badge">
                    Mulai{" "}
                    {new Date(draftTripStart.startedAt).toLocaleTimeString("id-ID")}
                  </span>
                )}
              </div>
              <div className="form-row">
                <input
                  type="number"
                  min="0"
                  step="1000"
                  placeholder="Pendapatan (Rp)"
                  value={earningsInput}
                  onChange={(event) => setEarningsInput(event.target.value)}
                />
                <button type="button" onClick={() => void handleFinishOrder()}>
                  Selesai order
                </button>
              </div>
              <div className="helper-text">
                Learning ringan aktif. Bobot akan disesuaikan setelah order selesai.
              </div>
            </div>
            <div className="helper-text">
              Rain risk 3 jam ke depan: {(rainRiskValue * 100).toFixed(0)}%
            </div>
          </div>
        )}
      </div>

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
  const hours = (meta.ageSeconds / 3600).toFixed(1);
  if (meta.lastErrorAt && meta.lastErrorMessage) {
    return `${label}: cached (${hours} jam) • gagal: ${meta.lastErrorMessage}`;
  }
  if (meta.isFresh && !meta.fromCache) {
    return `${label}: fresh`;
  }
  if (meta.isStale) {
    return `${label}: cached (stale ${hours} jam)`;
  }
  return `${label}: cached ${hours} jam`;
}
