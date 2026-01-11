"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import maplibregl, { type Map as MapLibreMap, type StyleSpecification } from "maplibre-gl";
import { nanoid } from "nanoid";
import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { cellToLatLng, latLngToCell } from "h3-js";
import { db, type Settings, type Session, type Trip, type WalletTx } from "../lib/db";
import { timeBucket, type LatLon, type WeatherSummary } from "../lib/engine/features";
import { recommendTopCells, type Recommendation } from "../lib/engine/recommend";
import { updateWeightsFromOutcome, type Weights } from "../lib/engine/scoring";
import { haptic } from "../lib/haptics";
import { binPointsToH3, h3CellsToPointGeoJSON } from "../lib/h3";
import { getSettings, updateSettings } from "../lib/settings";
import { attachToActiveSession, computeActiveMinutes } from "../lib/session";
import type { GeoJsonFeatureCollection } from "../lib/geojsonTypes";
import { getOrFetchSignal, type SignalMeta } from "../lib/signals";
import { useNetworkStatus } from "../lib/useNetworkStatus";
import { regions, type RegionKey } from "../lib/regions";
import { useLiveQueryState } from "../lib/useLiveQueryState";
import { Sheet } from "./ui/Sheet";
import { Toast } from "./ui/Toast";

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
type ToastState = {
  message: string;
  variant?: "success" | "error";
  actionLabel?: string;
  onAction?: () => void;
};

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
  const [status, setStatus] = useState<ToastState | null>(null);
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
  const [layersOpen, setLayersOpen] = useState(false);
  const [regionOpen, setRegionOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [mapInitKey, setMapInitKey] = useState(0);

  const { isOnline } = useNetworkStatus();

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const timerRef = useRef<number | null>(null);
  const mapErrorRef = useRef(false);

  const region = regions[regionKey];
  const hapticsEnabled = settings?.hapticsEnabled ?? true;

  function handleMapRetry() {
    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
    }
    mapErrorRef.current = false;
    setMapInitKey((prev) => prev + 1);
  }

  function showStatus(
    message: string,
    variant?: ToastState["variant"],
    action?: Pick<ToastState, "actionLabel" | "onAction">
  ) {
    setStatus({ message, variant, ...action });
    if (!variant || !hapticsEnabled) {
      return;
    }
    haptic(variant === "success" ? "success" : "error");
  }
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

    try {
      const map = new maplibregl.Map({
        container: mapContainerRef.current,
        style: mapStyle,
        center,
        zoom: 12
      });

      map.addControl(new maplibregl.NavigationControl(), "top-right");

      map.on("error", (event) => {
        if (mapErrorRef.current) {
          return;
        }
        mapErrorRef.current = true;
        console.error("Map error", event.error);
        showStatus("Map gagal dimuat.", "error", {
          actionLabel: "Coba lagi",
          onAction: () => handleMapRetry()
        });
      });

      map.on("load", () => {
        mapErrorRef.current = false;
        map.addSource("internal", {
          type: "geojson",
          data: internalGeoJson
        });
        map.addSource("poi", {
          type: "geojson",
          data: poiGeoJson
        });

        map.addLayer({
          id: "internal-heat",
          type: "heatmap",
          source: "internal",
          paint: {
            "heatmap-weight": ["get", "intensity"],
            "heatmap-radius": 32,
            "heatmap-intensity": 1,
            "heatmap-color": [
              "interpolate",
              ["linear"],
              ["heatmap-density"],
              0,
              "rgba(191, 219, 254, 0)",
              0.4,
              "#93c5fd",
              0.7,
              "#3b82f6",
              1,
              "#1d4ed8"
            ]
          }
        });

        map.addLayer({
          id: "poi-heat",
          type: "heatmap",
          source: "poi",
          paint: {
            "heatmap-weight": ["get", "intensity"],
            "heatmap-radius": 26,
            "heatmap-intensity": 0.8,
            "heatmap-color": [
              "interpolate",
              ["linear"],
              ["heatmap-density"],
              0,
              "rgba(187, 247, 208, 0)",
              0.5,
              "#86efac",
              0.8,
              "#22c55e",
              1,
              "#16a34a"
            ]
          }
        });

        console.log("map loaded", map.getStyle()?.sources);
      });

      mapRef.current = map;

      return () => {
        map.remove();
        mapRef.current = null;
      };
    } catch (error) {
      console.error("Map init error", error);
      showStatus("Map gagal dimuat.", "error", {
        actionLabel: "Coba lagi",
        onAction: () => handleMapRetry()
      });
      mapRef.current = null;
    }
  }, [center, mapInitKey]);

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

    if (map.getLayer("internal-heat")) {
      map.setLayoutProperty(
        "internal-heat",
        "visibility",
        internalEnabled ? "visible" : "none"
      );
    }
    if (map.getLayer("poi-heat")) {
      map.setLayoutProperty("poi-heat", "visibility", poiEnabled ? "visible" : "none");
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
    const targetBucket = timeBucket(new Date());
    const points = trips
      .filter((trip) => {
        if (trip.startLat === null || trip.startLon === null) {
          return false;
        }
        return timeBucket(new Date(trip.startedAt)) === targetBucket;
      })
      .map((trip) => ({
        lat: trip.startLat as number,
        lon: trip.startLon as number,
        value: Math.max(trip.earnings, 1)
      }));
    const cells = binPointsToH3(points, H3_RESOLUTION);
    setInternalGeoJson(h3CellsToPointGeoJSON(cells));
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

  async function loadPoiSignal(forceRefresh: boolean) {
    if (!isOnline) {
      showStatus(
        forceRefresh
          ? "Offline. Menampilkan cache terakhir (tanpa fetch)."
          : "Offline. Menggunakan cache terakhir.",
        forceRefresh ? "error" : undefined
      );
    } else {
      showStatus("Memuat sinyal POI...");
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
      setPoiGeoJson(h3CellsToPointGeoJSON(poiCells));
      return poiResult.meta;
    } catch (error) {
      showStatus(error instanceof Error ? error.message : "Gagal mengambil sinyal POI", "error");
      return null;
    }
  }

  async function loadWeatherSignal(forceRefresh: boolean) {
    if (!rainEnabled) {
      setWeather(null);
      setWeatherMeta(null);
      return null;
    }
    if (!isOnline) {
      showStatus(
        forceRefresh
          ? "Offline. Menampilkan cache terakhir (tanpa fetch)."
          : "Offline. Menggunakan cache terakhir.",
        forceRefresh ? "error" : undefined
      );
    } else {
      showStatus("Memuat sinyal cuaca...");
    }
    try {
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
      return weatherResult.meta;
    } catch (error) {
      showStatus(error instanceof Error ? error.message : "Gagal mengambil sinyal cuaca", "error");
      return null;
    }
  }

  async function loadSignals(forceRefresh: boolean) {
    try {
      if (forceRefresh) {
        setIsRefreshing(true);
      }
      await loadPoiSignal(forceRefresh);
      await loadWeatherSignal(forceRefresh);
      showStatus("Sinyal diperbarui.", "success");
    } catch (error) {
      showStatus(
        error instanceof Error ? error.message : "Terjadi kesalahan saat memuat sinyal",
        "error"
      );
    } finally {
      setIsRefreshing(false);
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
      showStatus(parsed.error.flatten().formErrors.join(", "), "error");
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
    showStatus("Trip tersimpan.", "success");
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
      showStatus("Mengambil lokasi...");
      const position = await getCurrentPosition();
      setMyPos(position);
      const settingsData = settings ?? (await getSettings());
      setSettings(settingsData);
      const { candidateCells, poiCounts } = buildCandidateCells(poiPoints, settingsData);
      if (candidateCells.length === 0) {
        showStatus("Belum ada kandidat. Tambah trip atau POI dulu.", "error");
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
      showStatus("Rekomendasi siap.", "success");
    } catch (error) {
      showStatus(
        error instanceof Error
          ? error.message
          : "Gagal mengambil lokasi untuk rekomendasi",
        "error"
      );
    }
  }

  async function handleStartOrder() {
    try {
      showStatus("Mengambil lokasi mulai order...");
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
      showStatus("Order dimulai.", "success");
    } catch (error) {
      showStatus(
        error instanceof Error ? error.message : "Gagal mengambil lokasi mulai order",
        "error"
      );
    }
  }

  async function handleFinishOrder() {
    if (!draftTripStart) {
      showStatus("Mulai order dulu.", "error");
      return;
    }
    const earningsValue = Number(earningsInput);
    if (!Number.isFinite(earningsValue) || earningsValue <= 0) {
      showStatus("Isi pendapatan minimal.", "error");
      return;
    }
    try {
      showStatus("Mengambil lokasi selesai order...");
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
      await db.transaction("rw", db.trips, db.wallet_tx, async () => {
        await db.trips.add(tripWithSession);
        if (settings?.autoAddIncomeFromTrips ?? true) {
          const walletTx: WalletTx = {
            id: nanoid(),
            createdAt: endedAt,
            type: "income",
            amount: earningsValue,
            category: "Order",
            note: "Order (Heatmap)",
            sessionId: tripWithSession.sessionId
          };
          const txWithSession = await attachToActiveSession(walletTx);
          await db.wallet_tx.add(txWithSession);
        }
      });
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
      showStatus("Order selesai & trip tersimpan.", "success");
    } catch (error) {
      showStatus(
        error instanceof Error ? error.message : "Gagal menyimpan order selesai",
        "error"
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
    <div className="heatmap-screen">
      <div className="heatmap-map" ref={mapContainerRef} />
      <div className="heatmap-overlay">
        <div className="heatmap-top">
          <button type="button" className="btn chip" onClick={() => setRegionOpen(true)}>
            Wilayah · {region.label.replace("Bandung ", "")}
          </button>
        </div>
        <div className="heatmap-fabs">
          <button type="button" className="btn fab secondary" onClick={() => setLayersOpen(true)}>
            ☰
          </button>
          <button type="button" className="btn fab primary" onClick={() => void loadSignals(true)}>
            {isRefreshing ? <span className="spinner" aria-label="Memuat" /> : "↻"}
          </button>
        </div>
      </div>
      <Sheet open={layersOpen} onClose={() => setLayersOpen(false)} title="Layers & Sinyal">
        <div className="grid">
          <div className="form-row">
            <button
              type="button"
              className={`btn chip ${internalEnabled ? "active" : ""}`}
              onClick={() => setInternalEnabled((prev) => !prev)}
            >
              Internal
            </button>
            <button
              type="button"
              className={`btn chip ${poiEnabled ? "active" : ""}`}
              onClick={() => setPoiEnabled((prev) => !prev)}
            >
              POI
            </button>
            <button
              type="button"
              className={`btn chip ${rainEnabled ? "active" : ""}`}
              onClick={() => setRainEnabled((prev) => !prev)}
            >
              Cuaca
            </button>
          </div>
          <div className="grid">
            <div className="helper-text">
              Internal: {getCacheStatusLabel(null)}
            </div>
            <div className="helper-text">
              POI: {getCacheStatusLabel(poiMeta)}
            </div>
            <div className="helper-text">
              Cuaca: {getCacheStatusLabel(weatherMeta)}
            </div>
          </div>
          <div className="form-row">
            <button type="button" className="btn secondary" onClick={() => void loadPoiSignal(true)}>
              Refresh POI
            </button>
            <button
              type="button"
              className="btn secondary"
              onClick={() => void loadWeatherSignal(true)}
            >
              Refresh Cuaca
            </button>
          </div>
          {poiMeta?.lastErrorMessage && (
            <div className="helper-text">
              POI gagal: {poiMeta.lastErrorMessage}
              <div style={{ marginTop: 8 }}>
                <button type="button" className="btn ghost" onClick={() => void loadPoiSignal(true)}>
                  Coba lagi
                </button>
              </div>
            </div>
          )}
        </div>
      </Sheet>
      <Sheet open={regionOpen} onClose={() => setRegionOpen(false)} title="Wilayah">
        <div className="segment-group">
          {Object.entries(regions).map(([key, value]) => (
            <button
              key={key}
              type="button"
              className={`btn segment-button ${regionKey === key ? "active" : ""}`}
              onClick={() => {
                setRegionKey(key as RegionKey);
                setRegionOpen(false);
              }}
            >
              {value.label.replace("Bandung ", "")}
            </button>
          ))}
        </div>
      </Sheet>
      <Toast
        open={Boolean(status)}
        message={status?.message ?? ""}
        variant={status?.variant}
        actionLabel={status?.actionLabel}
        onAction={status?.onAction}
        onClose={() => setStatus(null)}
      />
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

function getCacheStatusLabel(meta: SignalMeta | null) {
  if (!meta || meta.ageSeconds === null) {
    return "Cached";
  }
  if (meta.lastErrorMessage) {
    return "Failed";
  }
  if (meta.isFresh && !meta.fromCache) {
    return "Fresh";
  }
  if (meta.isStale) {
    return "Stale";
  }
  return "Cached";
}
