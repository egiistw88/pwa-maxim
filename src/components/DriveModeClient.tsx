"use client";

import { nanoid } from "nanoid";
import { useEffect, useMemo, useRef, useState } from "react";
import { cellToLatLng, latLngToCell } from "h3-js";
import { db, type DraftTrip, type Session, type Settings, type Trip } from "../lib/db";
import { type LatLon, type WeatherSummary } from "../lib/engine/features";
import { recommendTopCells, type Recommendation } from "../lib/engine/recommend";
import { updateWeightsFromOutcome, type Weights } from "../lib/engine/scoring";
import { getSettings, updateSettings } from "../lib/settings";
import { getOrFetchSignal } from "../lib/signals";
import { useNetworkStatus } from "../lib/useNetworkStatus";

type RegionKey = "timur" | "tengah" | "utara" | "selatan" | "barat";

type SpeechRecognition = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type SpeechRecognitionConstructor = new () => SpeechRecognition;

const regions: Record<RegionKey, { label: string; bbox: [number, number, number, number] }> = {
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

const HOLD_MS = 600;
const CACHE_TTL = 6 * 60 * 60;

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatDurationSince(iso: string, now: number) {
  const started = new Date(iso).getTime();
  const diffMs = Math.max(now - started, 0);
  const totalMinutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}j ${minutes.toString().padStart(2, "0")}m`;
}

function isValidCoord(value: number | null | undefined): value is number {
  return Number.isFinite(value);
}

function toNumberOrNaN(value: number | null | undefined) {
  return isValidCoord(value) ? value : Number.NaN;
}

export function DriveModeClient() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [draft, setDraft] = useState<DraftTrip | null>(null);
  const [gpsStatus, setGpsStatus] = useState("Mencari lokasi...");
  const [toast, setToast] = useState<string | null>(null);
  const [showSessionPrompt, setShowSessionPrompt] = useState(false);
  const [pendingStart, setPendingStart] = useState(false);
  const [showEarningsModal, setShowEarningsModal] = useState(false);
  const [earningsInput, setEarningsInput] = useState("");
  const [noteInput, setNoteInput] = useState("");
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [weather, setWeather] = useState<WeatherSummary | null>(null);
  const [endPosition, setEndPosition] = useState<LatLon | null>(null);
  const [nowTick, setNowTick] = useState(Date.now());

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const holdTimerRef = useRef<number | null>(null);

  const { isOnline } = useNetworkStatus();

  useEffect(() => {
    document.body.classList.add("drive-body");
    return () => {
      document.body.classList.remove("drive-body");
    };
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNowTick(Date.now());
    }, 60000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    void (async () => {
      const [loadedSettings, activeDraft, session, storedTrips] = await Promise.all([
        getSettings(),
        db.drafts.get("active"),
        db.sessions.filter((entry) => entry.endedAt === null).last(),
        db.trips.orderBy("startedAt").reverse().toArray()
      ]);
      setSettings(loadedSettings);
      setDraft(activeDraft ?? null);
      setActiveSession(session ?? null);
      setTrips(storedTrips);
    })();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const speechRecognition =
      (window as typeof window & { SpeechRecognition?: SpeechRecognitionConstructor })
        .SpeechRecognition ??
      (window as typeof window & { webkitSpeechRecognition?: SpeechRecognitionConstructor })
        .webkitSpeechRecognition;
    if (!speechRecognition) {
      setVoiceSupported(false);
      return;
    }
    setVoiceSupported(true);
    const recognition = new speechRecognition();
    recognition.lang = "id-ID";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript;
      if (transcript) {
        setNoteInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
      }
    };
    recognition.onend = () => {
      setListening(false);
    };
    recognition.onerror = () => {
      setListening(false);
    };
    recognitionRef.current = recognition;
  }, []);

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => {
      setToast((current) => (current === message ? null : current));
    }, 2000);
  }

  function vibrateSuccess() {
    if (navigator.vibrate) {
      navigator.vibrate(30);
    }
  }

  async function getCurrentPosition() {
    setGpsStatus("Mencari lokasi...");
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

  async function startSession() {
    const loadedSettings = settings ?? (await getSettings());
    if (!settings) {
      setSettings(loadedSettings);
    }
    const session: Session = {
      id: nanoid(),
      startedAt: new Date().toISOString(),
      endedAt: null,
      status: "working",
      baseAreaKey: loadedSettings.baseAreaKey ?? "timur"
    };
    await db.sessions.add(session);
    setActiveSession(session);
    return session;
  }

  function getAreaKey(session: Session | null, currentSettings: Settings | null): RegionKey {
    const key = session?.baseAreaKey ?? currentSettings?.baseAreaKey ?? "timur";
    return (key in regions ? key : "timur") as RegionKey;
  }

  async function handleStartOrder() {
    if (draft) {
      showToast("Order masih aktif.");
      return;
    }
    if (!activeSession) {
      setShowSessionPrompt(true);
      setPendingStart(true);
      return;
    }
    await startOrderFlow(activeSession);
  }

  async function startOrderFlow(session: Session | null) {
    const startedAt = new Date().toISOString();
    try {
      const position = await getCurrentPosition();
      setGpsStatus("Lokasi OK");
      const areaKey = getAreaKey(session, settings);
      const nextDraft: DraftTrip = {
        id: "active",
        startedAt,
        startLat: position.lat,
        startLon: position.lon,
        sessionId: session?.id ?? null,
        areaKey,
        predictedScoreAtStart: recommendations[0]?.score ?? null,
        locationUnavailable: false
      };
      await db.drafts.put(nextDraft);
      setDraft(nextDraft);
      showToast("Order dimulai");
      vibrateSuccess();
    } catch (error) {
      setGpsStatus("Lokasi gagal");
      const areaKey = getAreaKey(session, settings);
      const nextDraft: DraftTrip = {
        id: "active",
        startedAt,
        startLat: null,
        startLon: null,
        sessionId: session?.id ?? null,
        areaKey,
        predictedScoreAtStart: recommendations[0]?.score ?? null,
        locationUnavailable: true
      };
      await db.drafts.put(nextDraft);
      setDraft(nextDraft);
      showToast("Lokasi gagal");
    }
  }

  async function handleConfirmStartSession() {
    setShowSessionPrompt(false);
    const session = await startSession();
    if (pendingStart) {
      setPendingStart(false);
      await startOrderFlow(session);
    }
  }

  async function handleCancelStartSession() {
    setShowSessionPrompt(false);
    setPendingStart(false);
  }

  async function handleEndOrder() {
    if (!draft) {
      showToast("Mulai order dulu");
      return;
    }
    try {
      const position = await getCurrentPosition();
      setGpsStatus("Lokasi OK");
      setEndPosition(position);
    } catch (error) {
      setGpsStatus("Lokasi gagal");
      setEndPosition(null);
      showToast("Lokasi gagal");
    }
    setShowEarningsModal(true);
  }

  async function saveTrip() {
    if (!draft) {
      return;
    }
    const earningsValue = Number(earningsInput);
    if (!Number.isFinite(earningsValue) || earningsValue <= 0) {
      showToast("Isi pendapatan");
      return;
    }

    const endedAt = new Date().toISOString();
    const locationMissing = draft.locationUnavailable || !endPosition;
    const noteParts = [noteInput.trim()];
    if (locationMissing) {
      noteParts.push("Lokasi tidak tersedia");
    }
    const note = noteParts.filter(Boolean).join(". ");

    const trip: Trip = {
      id: nanoid(),
      startedAt: draft.startedAt,
      endedAt,
      startLat: toNumberOrNaN(draft.startLat),
      startLon: toNumberOrNaN(draft.startLon),
      endLat: toNumberOrNaN(endPosition?.lat),
      endLon: toNumberOrNaN(endPosition?.lon),
      earnings: earningsValue,
      note: note || undefined,
      source: "assistant"
    };

    await db.trips.add(trip);
    await db.drafts.delete("active");
    setDraft(null);
    setEarningsInput("");
    setNoteInput("");
    setEndPosition(null);
    setShowEarningsModal(false);
    setTrips((prev) => [trip, ...prev]);
    showToast("Order disimpan");
    vibrateSuccess();

    if (settings) {
      const durationHours = Math.max(
        (new Date(endedAt).getTime() - new Date(draft.startedAt).getTime()) / 3_600_000,
        0.1
      );
      const actualEph = earningsValue / durationHours;
      const predictedScoreAtStart = draft.predictedScoreAtStart ?? 0;
      window.setTimeout(() => {
        const updatedWeights = updateWeightsFromOutcome({
          predictedScoreAtStart,
          actualEph,
          weights: settings.weights as Weights
        });
        void updateSettings({ weights: updatedWeights }).then(setSettings);
      }, 0);
    }
  }

  function handleHoldStart() {
    if (holdTimerRef.current) {
      window.clearTimeout(holdTimerRef.current);
    }
    holdTimerRef.current = window.setTimeout(() => {
      void handleStartOrder();
    }, HOLD_MS);
  }

  function handleHoldEnd() {
    if (holdTimerRef.current) {
      window.clearTimeout(holdTimerRef.current);
    }
    holdTimerRef.current = window.setTimeout(() => {
      void handleEndOrder();
    }, HOLD_MS);
  }

  function clearHold() {
    if (holdTimerRef.current) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }

  async function handleNgetemNow() {
    try {
      const position = await getCurrentPosition();
      setGpsStatus("Lokasi OK");
      const loadedSettings = settings ?? (await getSettings());
      if (!settings) {
        setSettings(loadedSettings);
      }
      const areaKey = getAreaKey(activeSession, loadedSettings);
      const region = regions[areaKey] ?? regions.timur;
      const poiCounts = new Map<string, number>();
      let poiPoints: Array<{ lat: number; lon: number }> = [];
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
            allowNetwork: isOnline,
            allowStale: true
          }
        );
        poiPoints = poiResult.payload.points;
        poiPoints.forEach((point) => {
          if (!inBbox(point.lat, point.lon, region.bbox)) {
            return;
          }
          const cell = latLngToCell(point.lat, point.lon, loadedSettings.preferredH3Res);
          poiCounts.set(cell, (poiCounts.get(cell) ?? 0) + 1);
        });
      } catch (error) {
        poiPoints = [];
      }

      let weatherData: WeatherSummary | null = null;
      try {
        const weatherKey = `weather:${position.lat.toFixed(3)},${position.lon.toFixed(3)}`;
        const weatherResult = await getOrFetchSignal(
          weatherKey,
          CACHE_TTL,
          async () => {
            const response = await fetch(
              `/api/signals/weather?lat=${position.lat}&lon=${position.lon}`
            );
            if (!response.ok) {
              throw new Error("Gagal mengambil cuaca");
            }
            return (await response.json()) as WeatherSummary;
          },
          {
            allowNetwork: isOnline,
            allowStale: true
          }
        );
        weatherData = weatherResult.payload;
        setWeather(weatherResult.payload);
      } catch (error) {
        weatherData = null;
        setWeather(null);
      }

      const { candidateCells } = buildCandidateCells(
        trips,
        poiPoints,
        loadedSettings,
        region.bbox
      );

      if (candidateCells.length === 0) {
        showToast("Belum ada kandidat");
        setRecommendations([]);
        return;
      }

      const top = recommendTopCells({
        userLatLon: position,
        areaKey,
        candidateCells,
        trips,
        poiCells: poiCounts,
        weather: weatherData,
        settings: loadedSettings
      });
      setRecommendations(top);
      await db.rec_events.add({
        id: nanoid(),
        createdAt: new Date().toISOString(),
        userLat: position.lat,
        userLon: position.lon,
        areaKey,
        recommended: top.map((item) => ({
          cell: item.cell,
          score: item.score,
          reasons: item.reasons
        }))
      });
    } catch (error) {
      setGpsStatus("Lokasi gagal");
      showToast("Lokasi gagal");
    }
  }

  function buildCandidateCells(
    tripsData: Trip[],
    points: Array<{ lat: number; lon: number }>,
    currentSettings: Settings,
    bbox: [number, number, number, number]
  ) {
    const internalCounts = new Map<string, number>();
    tripsData.forEach((trip) => {
      if (!isValidCoord(trip.startLat) || !isValidCoord(trip.startLon)) {
        return;
      }
      if (!inBbox(trip.startLat, trip.startLon, bbox)) {
        return;
      }
      const cell = latLngToCell(trip.startLat, trip.startLon, currentSettings.preferredH3Res);
      internalCounts.set(cell, (internalCounts.get(cell) ?? 0) + 1);
    });

    const poiCounts = new Map<string, number>();
    points.forEach((point) => {
      if (!inBbox(point.lat, point.lon, bbox)) {
        return;
      }
      const cell = latLngToCell(point.lat, point.lon, currentSettings.preferredH3Res);
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

    const candidateCells = Array.from(combined.entries())
      .map(([cell, counts]) => ({ cell, ...counts }))
      .sort((a, b) => b.internalCount - a.internalCount || b.poiCount - a.poiCount)
      .slice(0, 300)
      .map((entry) => entry.cell);

    return { candidateCells };
  }

  function inBbox(lat: number, lon: number, bbox: [number, number, number, number]) {
    const [minLon, minLat, maxLon, maxLat] = bbox;
    return lat >= minLat && lat <= maxLat && lon >= minLon && lon <= maxLon;
  }

  function toggleListening() {
    if (!recognitionRef.current) {
      return;
    }
    if (listening) {
      recognitionRef.current.stop();
      setListening(false);
      return;
    }
    try {
      recognitionRef.current.start();
      setListening(true);
    } catch (error) {
      setListening(false);
    }
  }

  const sessionLabel = useMemo(() => {
    if (!activeSession) {
      return "Tidak ada sesi";
    }
    const statusLabel = activeSession.status === "rest" ? "Istirahat" : "Bekerja";
    const duration = formatDurationSince(activeSession.startedAt, nowTick);
    return `${statusLabel} • ${duration}`;
  }, [activeSession, nowTick]);

  const draftLabel = draft
    ? `Order aktif sejak ${formatTime(draft.startedAt)}`
    : "Belum ada order aktif";

  const areaKey = getAreaKey(activeSession, settings);

  return (
    <div className="drive-mode">
      <section className="drive-status">
        <div>
          <div className="drive-status-label">Sesi</div>
          <div className="drive-status-value">{sessionLabel}</div>
        </div>
        <div>
          <div className="drive-status-label">GPS</div>
          <div className="drive-status-value">{gpsStatus}</div>
        </div>
        <div>
          <div className="drive-status-label">Order</div>
          <div className="drive-status-value">{draftLabel}</div>
        </div>
      </section>

      <section className="drive-actions">
        <button
          type="button"
          className="drive-button start"
          onPointerDown={handleHoldStart}
          onPointerUp={clearHold}
          onPointerLeave={clearHold}
          onPointerCancel={clearHold}
        >
          START ORDER
        </button>
        <button
          type="button"
          className="drive-button end"
          onPointerDown={handleHoldEnd}
          onPointerUp={clearHold}
          onPointerLeave={clearHold}
          onPointerCancel={clearHold}
        >
          END ORDER
        </button>
        <button type="button" className="drive-button recommend" onClick={() => void handleNgetemNow()}>
          NGETEM NOW
        </button>
        <div className="drive-warning">Tap & hold to confirm • Gunakan hanya saat berhenti.</div>
      </section>

      <section className="drive-recommendations">
        <div className="drive-section-title">Rekomendasi Cepat ({areaKey})</div>
        {recommendations.length === 0 ? (
          <div className="drive-muted">Belum ada rekomendasi. Tekan NGETEM NOW.</div>
        ) : (
          <div className="drive-card-grid">
            {recommendations.map((item, index) => {
              const [lat, lon] = cellToLatLng(item.cell);
              const reasons = item.reasons.slice(0, 2);
              return (
                <div key={item.cell} className="drive-card">
                  <div className="drive-card-title">Spot #{index + 1}</div>
                  <div className="drive-score">Score {item.score.toFixed(2)}</div>
                  <ul>
                    {reasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                  <a
                    className="drive-button nav"
                    href={`https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    NAVIGASI
                  </a>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {showSessionPrompt && (
        <div className="drive-modal-backdrop">
          <div className="drive-modal">
            <h3>Mulai sesi kerja?</h3>
            <p className="drive-muted">Belum ada sesi aktif. Mulai sekarang?</p>
            <div className="drive-modal-actions">
              <button type="button" className="drive-button start" onClick={() => void handleConfirmStartSession()}>
                Ya mulai
              </button>
              <button type="button" className="drive-button ghost" onClick={() => void handleCancelStartSession()}>
                Tidak
              </button>
            </div>
          </div>
        </div>
      )}

      {showEarningsModal && (
        <div className="drive-modal-backdrop">
          <div className="drive-modal">
            <h3>Masukkan pendapatan</h3>
            <div className="drive-earnings">
              <div className="drive-earnings-display">Rp {earningsInput || "0"}</div>
              <div className="drive-numpad">
                {["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"].map((digit) => (
                  <button
                    key={digit}
                    type="button"
                    className="drive-numpad-btn"
                    onClick={() => setEarningsInput((prev) => `${prev}${digit}`)}
                  >
                    {digit}
                  </button>
                ))}
                <button
                  type="button"
                  className="drive-numpad-btn secondary"
                  onClick={() => setEarningsInput((prev) => prev.slice(0, -1))}
                >
                  ⌫
                </button>
                <button
                  type="button"
                  className="drive-numpad-btn secondary"
                  onClick={() => setEarningsInput("")}
                >
                  Clear
                </button>
              </div>
            </div>

            <div className="drive-voice">
              <label className="drive-toggle">
                <input
                  type="checkbox"
                  checked={voiceEnabled}
                  onChange={(event) => setVoiceEnabled(event.target.checked)}
                />
                Voice note
              </label>
              {voiceEnabled && voiceSupported ? (
                <div className="drive-voice-row">
                  <button type="button" className="drive-button ghost" onClick={toggleListening}>
                    {listening ? "Stop mic" : "Mulai mic"}
                  </button>
                  <textarea
                    rows={3}
                    placeholder="Catatan (opsional)"
                    value={noteInput}
                    onChange={(event) => setNoteInput(event.target.value)}
                  />
                </div>
              ) : (
                <textarea
                  rows={3}
                  placeholder="Catatan (opsional)"
                  value={noteInput}
                  onChange={(event) => setNoteInput(event.target.value)}
                />
              )}
            </div>

            <div className="drive-modal-actions">
              <button type="button" className="drive-button end" onClick={() => void saveTrip()}>
                Simpan
              </button>
              <button
                type="button"
                className="drive-button ghost"
                onClick={() => {
                  setShowEarningsModal(false);
                  setEarningsInput("");
                  setNoteInput("");
                }}
              >
                Batal
              </button>
            </div>
            <div className="drive-warning">Gunakan hanya saat berhenti.</div>
          </div>
        </div>
      )}

      {toast && <div className="drive-toast">{toast}</div>}
    </div>
  );
}
