"use client";

import { nanoid } from "nanoid";
import { useEffect, useMemo, useRef, useState } from "react";
import { cellToLatLng, latLngToCell } from "h3-js";
import { db, type Session, type Settings, type Trip } from "../lib/db";
import { type LatLon, type WeatherSummary } from "../lib/engine/features";
import { recommendTopCells, type Recommendation } from "../lib/engine/recommend";
import { updateWeightsFromOutcome, type Weights } from "../lib/engine/scoring";
import { haptic } from "../lib/haptics";
import { getSettings, updateSettings } from "../lib/settings";
import { attachToActiveSession, computeActiveMinutes, endSession, pauseSession, resumeSession, startSession } from "../lib/session";
import { getOrFetchSignal } from "../lib/signals";
import { useNetworkStatus } from "../lib/useNetworkStatus";
import { regions, type RegionKey } from "../lib/regions";
import { useLiveQueryState } from "../lib/useLiveQueryState";
import { Dialog } from "./ui/Dialog";
import { Sheet } from "./ui/Sheet";
import { Toast } from "./ui/Toast";

const HOLD_DURATION_MS = 600;
const CACHE_TTL = 6 * 60 * 60;

const AREA_OPTIONS = Object.keys(regions) as RegionKey[];
type ToastState = { message: string; variant?: "success" | "error" };

function formatDuration(seconds: number) {
  const totalMinutes = Math.floor(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const secs = seconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function getAreaKey(session: Session | null, settings: Settings | null): RegionKey {
  const key = session?.baseAreaKey ?? settings?.baseAreaKey ?? "timur";
  return (AREA_OPTIONS.includes(key as RegionKey) ? key : "timur") as RegionKey;
}

async function getCurrentPosition(): Promise<LatLon> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("GPS tidak tersedia"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      (error) => reject(error),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}

export function DriveClient() {
  const { isOnline } = useNetworkStatus();
  const [status, setStatus] = useState<ToastState | null>(null);
  const [gpsStatus, setGpsStatus] = useState<string>("Belum dicek");
  const [formAreaKey, setFormAreaKey] = useState<RegionKey>("timur");
  const [formNote, setFormNote] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [activeSeconds, setActiveSeconds] = useState(0);
  const [endDialogOpen, setEndDialogOpen] = useState(false);
  const [noteDialogOpen, setNoteDialogOpen] = useState(false);
  const [ngetemOpen, setNgetemOpen] = useState(false);
  const [orderNote, setOrderNote] = useState("");
  const [draftTripStart, setDraftTripStart] = useState<{
    startedAt: string;
    startLat: number;
    startLon: number;
    predictedScoreAtStart: number;
    sessionId?: string;
  } | null>(null);
  const [earningsInput, setEarningsInput] = useState("");
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);

  const holdTimerRef = useRef<number | null>(null);

  const activeSession = useLiveQueryState(async () => {
    const sessions = await db.sessions.where("status").anyOf("active", "paused").toArray();
    if (sessions.length === 0) {
      return null;
    }
    return sessions.sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    )[0];
  }, [], null as Session | null);

  const settings = useLiveQueryState(async () => {
    return getSettings();
  }, [], null as Settings | null);

  const trips = useLiveQueryState(async () => {
    return db.trips.orderBy("startedAt").reverse().toArray();
  }, [], [] as Trip[]);

  useEffect(() => {
    if (!activeSession) {
      setActiveSeconds(0);
      return;
    }
    const updateTimer = () => {
      const minutes = computeActiveMinutes(activeSession, new Date());
      setActiveSeconds(Math.max(Math.floor(minutes * 60), 0));
    };
    updateTimer();
    const interval = window.setInterval(updateTimer, 1000);
    return () => window.clearInterval(interval);
  }, [activeSession]);

  useEffect(() => {
    if (settings?.baseAreaKey) {
      setFormAreaKey(settings.baseAreaKey as RegionKey);
    }
  }, [settings]);

  const statusLabel = useMemo(() => {
    if (!activeSession) {
      return "Tidak ada sesi";
    }
    if (activeSession.status === "paused") {
      return "Istirahat";
    }
    return "Bekerja";
  }, [activeSession]);

  const areaKey = getAreaKey(activeSession, settings);
  const area = regions[areaKey];
  const hapticsEnabled = settings?.hapticsEnabled ?? true;

  function showStatus(message: string, variant?: ToastState["variant"]) {
    setStatus({ message, variant });
    if (!variant || !hapticsEnabled) {
      return;
    }
    haptic(variant === "success" ? "success" : "error");
  }

  function handleHoldStart(action: () => void) {
    if (holdTimerRef.current) {
      window.clearTimeout(holdTimerRef.current);
    }
    holdTimerRef.current = window.setTimeout(() => {
      action();
      if (hapticsEnabled) {
        haptic("tap");
      }
      holdTimerRef.current = null;
    }, HOLD_DURATION_MS);
  }

  function handleHoldCancel() {
    if (holdTimerRef.current) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }

  async function handleStartSession() {
    const created = await startSession({ areaKey: formAreaKey, note: formNote || null });
    showStatus("Sesi kerja dimulai.", "success");
    setIsModalOpen(false);
    setFormNote("");
    if (settings && formAreaKey !== settings.baseAreaKey) {
      await db.settings.put({ ...settings, baseAreaKey: formAreaKey });
    }
    setFormAreaKey(created.baseAreaKey as RegionKey);
  }

  async function handlePauseSession() {
    await pauseSession();
    showStatus("Sesi di-pause.");
  }

  async function handleResumeSession() {
    await resumeSession();
    showStatus("Sesi dilanjutkan.");
  }

  async function handleEndSession() {
    await endSession();
    showStatus("Sesi selesai. Hati-hati di jalan.", "success");
  }

  async function handleStartOrder() {
    try {
      showStatus("Mengambil lokasi mulai order...");
      const position = await getCurrentPosition();
      setGpsStatus("GPS siap");
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
      setGpsStatus("GPS gagal");
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
      setGpsStatus("GPS siap");
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
        note: orderNote || undefined,
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
        await updateSettings({ weights: updatedWeights });
      }
      setDraftTripStart(null);
      setEarningsInput("");
      setOrderNote("");
      setEndDialogOpen(false);
      showStatus("Order selesai & trip tersimpan.", "success");
    } catch (error) {
      setGpsStatus("GPS gagal");
      showStatus(
        error instanceof Error ? error.message : "Gagal menyimpan order selesai",
        "error"
      );
    }
  }

  function appendEarningsDigit(value: string) {
    setEarningsInput((prev) => {
      const next = prev === "0" ? value : `${prev}${value}`;
      return next.replace(/^0+(?=\\d)/, "");
    });
  }

  function handlePreset(amount: number) {
    setEarningsInput((prev) => {
      const current = Number(prev || 0);
      return String(current + amount);
    });
  }

  function handleBackspace() {
    setEarningsInput((prev) => (prev.length <= 1 ? "0" : prev.slice(0, -1)));
  }

  async function handleNgetemRequest() {
    await handleNgetemNow();
    setNgetemOpen(true);
  }

  function buildCandidateCells(settingsData: Settings, points: Array<{ lat: number; lon: number }>) {
    const [minLon, minLat, maxLon, maxLat] = area.bbox;
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
      .slice(0, 200);

    return {
      candidateCells: ranked.map((entry) => entry.cell),
      poiCounts
    };
  }

  async function handleNgetemNow() {
    try {
      showStatus("Mengambil rekomendasi ngetem...");
      const settingsData = settings ?? (await getSettings());
      const bbox = area.bbox.join(",");
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
        { allowNetwork: isOnline, allowStale: true }
      );

      const [lon, lat] = [
        (area.bbox[0] + area.bbox[2]) / 2,
        (area.bbox[1] + area.bbox[3]) / 2
      ];
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
        { allowNetwork: isOnline, allowStale: true }
      );

      const { candidateCells, poiCounts } = buildCandidateCells(settingsData, poiResult.payload.points);
      if (candidateCells.length === 0) {
        showStatus("Belum ada kandidat. Tambah trip atau tunggu POI.", "error");
        return;
      }
      const recommended = recommendTopCells({
        userLatLon: { lat, lon },
        areaKey,
        candidateCells,
        trips,
        poiCells: poiCounts,
        weather: weatherResult.payload,
        settings: settingsData
      });
      setRecommendations(recommended);
      showStatus("Rekomendasi siap.", "success");
    } catch (error) {
      showStatus(error instanceof Error ? error.message : "Gagal memuat rekomendasi", "error");
    }
  }

  return (
    <div className="grid" style={{ gap: 12 }}>
      <div className="card">
        <div className="status-row">
          <div>Session: {statusLabel}</div>
          <div>Order: {draftTripStart ? "Aktif" : "Tidak aktif"}</div>
          <div>GPS: {gpsStatus}</div>
        </div>
        <div className="form-row" style={{ marginTop: 10 }}>
          <button type="button" className="btn ghost" onClick={() => setIsModalOpen(true)}>
            Kelola Sesi
          </button>
          <button type="button" className="btn ghost" onClick={() => setNgetemOpen(true)}>
            Lihat Ngetem
          </button>
        </div>
      </div>

      <div className="card drive-actions">
        <button
          type="button"
          className="btn primary"
          onPointerDown={() => handleHoldStart(() => void handleStartOrder())}
          onPointerUp={handleHoldCancel}
          onPointerLeave={handleHoldCancel}
          onPointerCancel={handleHoldCancel}
        >
          START ORDER
        </button>
        <div className="hold-hint">Tap & tahan 0,6 detik untuk mulai.</div>

        <button type="button" className="btn warning" onClick={() => void handleNgetemRequest()}>
          NGETEM NOW
        </button>
        <div className="hold-hint">Hasil tampil di sheet.</div>

        <button
          type="button"
          className="btn danger"
          onPointerDown={() => handleHoldStart(() => setEndDialogOpen(true))}
          onPointerUp={handleHoldCancel}
          onPointerLeave={handleHoldCancel}
          onPointerCancel={handleHoldCancel}
        >
          END ORDER
        </button>
        <div className="hold-hint">Tap & tahan 0,6 detik untuk lanjut input.</div>
      </div>

      <Dialog open={isModalOpen} onClose={() => setIsModalOpen(false)} title="Sesi">
        <div className="grid">
          <div>
            <label>Wilayah</label>
            <select
              value={formAreaKey}
              onChange={(event) => setFormAreaKey(event.target.value as RegionKey)}
            >
              {AREA_OPTIONS.map((key) => (
                <option key={key} value={key}>
                  {regions[key].label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Catatan</label>
            <input
              type="text"
              placeholder="Opsional"
              value={formNote}
              onChange={(event) => setFormNote(event.target.value)}
            />
          </div>
          <div className="form-row">
            {!activeSession && (
              <button type="button" className="btn primary" onClick={() => void handleStartSession()}>
                Mulai Kerja
              </button>
            )}
            {activeSession && activeSession.status === "active" && (
              <button type="button" className="btn secondary" onClick={() => void handlePauseSession()}>
                Istirahat
              </button>
            )}
            {activeSession && activeSession.status === "paused" && (
              <button type="button" className="btn secondary" onClick={() => void handleResumeSession()}>
                Lanjutkan
              </button>
            )}
            {activeSession && (
              <button type="button" className="btn danger" onClick={() => void handleEndSession()}>
                Akhiri
              </button>
            )}
          </div>
        </div>
      </Dialog>

      <Dialog open={endDialogOpen} onClose={() => setEndDialogOpen(false)} title="Selesai Order">
        <div className="grid">
          <input
            type="number"
            min="0"
            step="1000"
            placeholder="Pendapatan (Rp)"
            value={earningsInput}
            onChange={(event) => setEarningsInput(event.target.value)}
          />
          <div className="form-row">
            {[5000, 10000, 20000].map((value) => (
              <button key={value} type="button" className="btn secondary" onClick={() => handlePreset(value)}>
                +{value.toLocaleString("id-ID")}
              </button>
            ))}
          </div>
          <div className="numpad">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
              <button
                key={digit}
                type="button"
                className="btn secondary"
                onClick={() => appendEarningsDigit(digit)}
              >
                {digit}
              </button>
            ))}
            <button type="button" className="btn secondary" onClick={() => appendEarningsDigit("0")}>
              0
            </button>
            <button type="button" className="btn secondary" onClick={handleBackspace}>
              ⌫
            </button>
            <button type="button" className="btn secondary" onClick={() => setEarningsInput("0")}>
              C
            </button>
          </div>
          <div className="form-row">
            <button type="button" className="btn ghost" onClick={() => setNoteDialogOpen(true)}>
              Catatan
            </button>
            <button type="button" className="btn primary" onClick={() => void handleFinishOrder()}>
              Simpan
            </button>
          </div>
        </div>
      </Dialog>

      <Dialog open={noteDialogOpen} onClose={() => setNoteDialogOpen(false)} title="Catatan">
        <div className="grid">
          <textarea
            rows={3}
            placeholder="Opsional"
            value={orderNote}
            onChange={(event) => setOrderNote(event.target.value)}
          />
          <div className="form-row">
            <button type="button" className="btn secondary">
              🎤 Mic
            </button>
            <button type="button" className="btn primary" onClick={() => setNoteDialogOpen(false)}>
              Simpan
            </button>
          </div>
        </div>
      </Dialog>

      <Sheet open={ngetemOpen} onClose={() => setNgetemOpen(false)} title="Hasil Ngetem">
        <div className="grid">
          {recommendations.length === 0 && (
            <div className="helper-text">Belum ada rekomendasi.</div>
          )}
          {recommendations.slice(0, 3).map((rec, index) => {
            const [lat, lon] = cellToLatLng(rec.cell);
            const dest = `${lat},${lon}`;
            return (
              <div key={rec.cell} className="kpi-card">
                <strong>Spot #{index + 1}</strong>
                <div className="helper-text">{rec.reasons.slice(0, 2).join(" • ")}</div>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() =>
                    window.open(
                      `https://www.google.com/maps/dir/?api=1&destination=${dest}`,
                      "_blank"
                    )
                  }
                >
                  Navigasi
                </button>
              </div>
            );
          })}
        </div>
      </Sheet>

      <Toast
        open={Boolean(status)}
        message={status?.message ?? ""}
        variant={status?.variant}
        onClose={() => setStatus(null)}
      />
    </div>
  );
}
