"use client";

import { useEffect, useMemo, useState } from "react";
import { db, type Session, type Trip, type WalletTx } from "../lib/db";
import { haversineKm } from "../lib/geo";
import { computeActiveMinutes } from "../lib/session";

const formatCurrency = (value: number) => `Rp ${value.toLocaleString("id-ID")}`;

function isValidCoord(value: number | null | undefined) {
  return Number.isFinite(value ?? NaN);
}

function downloadCsv(filename: string, header: string[], rows: Array<Array<string | number>>) {
  const escapeValue = (value: string | number) => {
    const text = String(value ?? "");
    if (/[",\n]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  };

  const lines = [
    header.map(escapeValue).join(","),
    ...rows.map((row) => row.map(escapeValue).join(","))
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function SessionReportClient() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [transactions, setTransactions] = useState<WalletTx[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const [sessionRows, tripRows, txRows] = await Promise.all([
        db.sessions.orderBy("startedAt").reverse().toArray(),
        db.trips.toArray(),
        db.wallet_tx.toArray()
      ]);
      const windowStart = new Date();
      windowStart.setDate(windowStart.getDate() - 6);
      windowStart.setHours(0, 0, 0, 0);
      const recent = sessionRows.filter(
        (session) => new Date(session.startedAt) >= windowStart
      );
      setSessions(recent);
      setTrips(tripRows);
      setTransactions(txRows);
      if (recent.length > 0) {
        setSelectedSessionId(recent[0].id);
      }
    })();
  }, []);

  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) ?? null,
    [sessions, selectedSessionId]
  );

  const sessionTrips = useMemo(
    () => trips.filter((trip) => trip.sessionId === selectedSession?.id),
    [trips, selectedSession?.id]
  );

  const sessionTransactions = useMemo(
    () => transactions.filter((tx) => tx.sessionId === selectedSession?.id),
    [transactions, selectedSession?.id]
  );

  const summary = useMemo(() => {
    if (!selectedSession) {
      return null;
    }
    const incomeTotal = sessionTransactions
      .filter((tx) => tx.type === "income")
      .reduce((sum, tx) => sum + tx.amount, 0);
    const tripGross = sessionTrips.reduce((sum, trip) => sum + trip.earnings, 0);
    const gross = incomeTotal > 0 ? incomeTotal : tripGross;
    const expense = sessionTransactions
      .filter((tx) => tx.type === "expense")
      .reduce((sum, tx) => sum + tx.amount, 0);
    const net = gross - expense;
    let distanceKm = 0;
    for (const trip of sessionTrips) {
      if (
        isValidCoord(trip.startLat) &&
        isValidCoord(trip.startLon) &&
        isValidCoord(trip.endLat) &&
        isValidCoord(trip.endLon)
      ) {
        distanceKm += haversineKm(trip.startLat, trip.startLon, trip.endLat, trip.endLon);
      }
    }
    const activeHours = computeActiveMinutes(selectedSession) / 60;
    const expenseBreakdown = sessionTransactions
      .filter((tx) => tx.type === "expense")
      .reduce<Record<string, number>>((acc, tx) => {
        acc[tx.category] = (acc[tx.category] ?? 0) + tx.amount;
        return acc;
      }, {});
    return {
      gross,
      expense,
      net,
      activeHours,
      distanceKm,
      tripsCount: sessionTrips.length,
      expenseBreakdown
    };
  }, [selectedSession, sessionTransactions, sessionTrips]);

  function handleExportCsv() {
    if (!selectedSession) {
      return;
    }
    const header = [
      "kind",
      "timestamp",
      "amount",
      "category",
      "note",
      "startLat",
      "startLon",
      "endLat",
      "endLon",
      "distanceKm",
      "sessionId"
    ];
    const rows: Array<Array<string | number>> = [];
    sessionTrips.forEach((trip) => {
      const distanceKm =
        isValidCoord(trip.startLat) &&
        isValidCoord(trip.startLon) &&
        isValidCoord(trip.endLat) &&
        isValidCoord(trip.endLon)
          ? haversineKm(trip.startLat, trip.startLon, trip.endLat, trip.endLon)
          : 0;
      rows.push([
        "trip",
        trip.startedAt,
        trip.earnings,
        "trip",
        trip.note ?? "",
        trip.startLat,
        trip.startLon,
        trip.endLat,
        trip.endLon,
        distanceKm.toFixed(2),
        trip.sessionId ?? ""
      ]);
    });
    sessionTransactions.forEach((tx) => {
      rows.push([
        tx.type,
        tx.createdAt,
        tx.amount,
        tx.category,
        tx.note ?? "",
        "",
        "",
        "",
        "",
        "",
        tx.sessionId ?? ""
      ]);
    });
    downloadCsv(`session-${selectedSession.id}.csv`, header, rows);
  }

  return (
    <div className="grid" style={{ gap: 24 }}>
      <div className="card">
        <h2>Laporan Sesi</h2>
        <p className="helper-text">Ringkasan sesi dalam 7 hari terakhir.</p>
      </div>

      <div className="grid two">
        <div className="card">
          <h3>Daftar Sesi</h3>
          <div className="list">
            {sessions.length === 0 && (
              <div className="helper-text">Belum ada sesi dalam 7 hari terakhir.</div>
            )}
            {sessions.map((session) => (
              <button
                key={session.id}
                type="button"
                className={`list-item ${session.id === selectedSessionId ? "active" : ""}`}
                style={{ textAlign: "left" }}
                onClick={() => setSelectedSessionId(session.id)}
              >
                <strong>
                  {new Date(session.startedAt).toLocaleDateString("id-ID")}
                </strong>
                <div className="helper-text">
                  {session.baseAreaKey ?? "tanpa area"} •{" "}
                  {session.status === "ended" ? "Selesai" : "Berjalan"}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="card">
          <h3>Ringkasan Sesi</h3>
          {!selectedSession || !summary ? (
            <p className="helper-text">Pilih sesi untuk melihat ringkasan.</p>
          ) : (
            <div className="grid" style={{ gap: 12 }}>
              <div className="helper-text">
                {new Date(selectedSession.startedAt).toLocaleString("id-ID")} •{" "}
                {selectedSession.status === "ended" ? "Selesai" : "Berjalan"}
              </div>
              <div className="grid two">
                <div>
                  <p className="helper-text">Gross: {formatCurrency(summary.gross)}</p>
                  <p className="helper-text">Expense: {formatCurrency(summary.expense)}</p>
                  <p>
                    <strong>Net: {formatCurrency(summary.net)}</strong>
                  </p>
                </div>
                <div>
                  <p className="helper-text">
                    Jam aktif: {summary.activeHours.toFixed(2)} jam
                  </p>
                  <p className="helper-text">
                    Trip: {summary.tripsCount} • Jarak: {summary.distanceKm.toFixed(1)} km
                  </p>
                </div>
              </div>
              <div>
                <h4>Breakdown Expense</h4>
                {Object.keys(summary.expenseBreakdown).length === 0 ? (
                  <p className="helper-text">Belum ada expense.</p>
                ) : (
                  <div className="list">
                    {Object.entries(summary.expenseBreakdown).map(([category, amount]) => (
                      <div key={category} className="list-item">
                        <strong>{category}</strong>
                        <div className="helper-text">{formatCurrency(amount)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <button type="button" className="secondary" onClick={handleExportCsv}>
                Export CSV Sesi
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
