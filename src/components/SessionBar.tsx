"use client";

import { useEffect, useMemo, useState } from "react";
import { db, type Session, type Settings } from "../lib/db";
import {
  computeActiveMinutes,
  endSession,
  ensureSingleActiveSession,
  pauseSession,
  resumeSession,
  startSession
} from "../lib/session";
import { getSettings } from "../lib/settings";

const AREA_OPTIONS = ["timur", "tengah", "utara", "selatan", "barat"] as const;

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

async function loadOpenSession(): Promise<Session | null> {
  const sessions = await db.sessions.where("status").anyOf("active", "paused").toArray();
  if (sessions.length === 0) {
    return null;
  }
  return sessions.sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  )[0];
}

export function SessionBar() {
  const [session, setSession] = useState<Session | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [activeSeconds, setActiveSeconds] = useState<number>(0);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formAreaKey, setFormAreaKey] = useState<string>("timur");
  const [formNote, setFormNote] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      await ensureSingleActiveSession();
      const [sessionData, settingsData] = await Promise.all([
        loadOpenSession(),
        getSettings()
      ]);
      setSession(sessionData);
      setSettings(settingsData);
      setFormAreaKey(settingsData.baseAreaKey ?? "timur");
    })();
  }, []);

  useEffect(() => {
    if (!session) {
      setActiveSeconds(0);
      return;
    }
    const updateTimer = () => {
      const minutes = computeActiveMinutes(session, new Date());
      setActiveSeconds(Math.max(Math.floor(minutes * 60), 0));
    };
    updateTimer();
    const interval = window.setInterval(updateTimer, 1000);
    return () => window.clearInterval(interval);
  }, [session]);

  const statusLabel = useMemo(() => {
    if (!session) {
      return "Tidak ada sesi";
    }
    if (session.status === "paused") {
      return "Istirahat";
    }
    if (session.status === "active") {
      return "Bekerja";
    }
    return "Tidak ada sesi";
  }, [session]);

  async function refreshSession() {
    const updated = await loadOpenSession();
    setSession(updated);
  }

  async function handleStart() {
    const existing = await loadOpenSession();
    if (existing) {
      setSession(existing);
      setStatusMessage("Sesi sudah berjalan. Lanjutkan yang ada.");
      setIsModalOpen(false);
      return;
    }
    const created = await startSession({ areaKey: formAreaKey, note: formNote || null });
    setSession(created);
    setStatusMessage("Sesi kerja dimulai.");
    setIsModalOpen(false);
    setFormNote("");
    if (settings && formAreaKey !== settings.baseAreaKey) {
      await db.settings.put({ ...settings, baseAreaKey: formAreaKey });
      setSettings({ ...settings, baseAreaKey: formAreaKey });
    }
  }

  async function handlePause() {
    await pauseSession();
    await refreshSession();
  }

  async function handleResume() {
    await resumeSession();
    await refreshSession();
  }

  async function handleEnd() {
    await endSession();
    await refreshSession();
  }

  return (
    <div className="card" style={{ margin: "16px auto", maxWidth: 980 }}>
      <div className="form-row" style={{ justifyContent: "space-between" }}>
        <div>
          <strong>Mode Sesi</strong>
          <div className="helper-text">
            Status: {statusLabel} • Waktu aktif:{" "}
            {session ? formatDuration(activeSeconds) : "00:00"}
          </div>
        </div>
        <div className="form-row">
          {!session && (
            <button type="button" onClick={() => setIsModalOpen(true)}>
              Mulai Kerja
            </button>
          )}
          {session?.status === "active" && (
            <>
              <button type="button" className="secondary" onClick={() => void handlePause()}>
                Istirahat
              </button>
              <button type="button" className="ghost" onClick={() => void handleEnd()}>
                Pulang
              </button>
            </>
          )}
          {session?.status === "paused" && (
            <>
              <button type="button" onClick={() => void handleResume()}>
                Lanjut
              </button>
              <button type="button" className="ghost" onClick={() => void handleEnd()}>
                Pulang
              </button>
            </>
          )}
        </div>
      </div>
      {statusMessage && <div className="helper-text">{statusMessage}</div>}
      {isModalOpen && (
        <div className="card" style={{ marginTop: 12, padding: 16 }}>
          <div className="form-row">
            <div>
              <label>Base area</label>
              <select
                value={formAreaKey}
                onChange={(event) => setFormAreaKey(event.target.value)}
              >
                {AREA_OPTIONS.map((area) => (
                  <option key={area} value={area}>
                    {area}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label>Catatan</label>
              <input
                type="text"
                placeholder="Opsional"
                value={formNote}
                onChange={(event) => setFormNote(event.target.value)}
              />
            </div>
          </div>
          <div className="form-row" style={{ marginTop: 12 }}>
            <button type="button" onClick={() => void handleStart()}>
              Mulai Kerja
            </button>
            <button type="button" className="ghost" onClick={() => setIsModalOpen(false)}>
              Batal
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
