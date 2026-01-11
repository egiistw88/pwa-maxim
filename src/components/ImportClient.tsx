"use client";

import { nanoid } from "nanoid";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { db, type Settings, type Trip, type WalletTx } from "../lib/db";
import { haptic } from "../lib/haptics";
import { getSettings, updateSettings } from "../lib/settings";
import { useLiveQueryState } from "../lib/useLiveQueryState";

const EXPECTED_HEADERS = [
  "status",
  "started_at",
  "completed_at",
  "duration_min",
  "earnings_idr",
  "service",
  "pickup_name",
  "dropoff_name",
  "note"
];

type ImportRow = {
  status: string;
  started_at: string;
  completed_at: string;
  duration_min: string;
  earnings_idr: string;
  service: string;
  pickup_name: string;
  dropoff_name: string;
  note: string;
};

function parseCsvLine(line: string) {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current);
  return result;
}

function parseCsv(text: string) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }
  const headers = parseCsvLine(lines[0]).map((header) => header.trim());
  const rows = lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = values[index]?.trim() ?? "";
    });
    return row as ImportRow;
  });
  return { headers, rows };
}

function buildTripNote(row: ImportRow) {
  const base = `${row.pickup_name} → ${row.dropoff_name} (${row.service})`;
  if (row.note) {
    return `${base} • ${row.note}`;
  }
  return base;
}

export function ImportClient() {
  const router = useRouter();
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  const settings = useLiveQueryState(async () => {
    return getSettings();
  }, [], null as Settings | null);
  const hapticsEnabled = settings?.hapticsEnabled ?? true;

  function reportStatus(message: string) {
    setStatus(message);
    if (hapticsEnabled) {
      haptic("success");
    }
  }

  function reportError(message: string) {
    setError(message);
    if (hapticsEnabled) {
      haptic("error");
    }
  }

  const summary = useMemo(() => {
    const completed = rows.filter((row) => row.status.toLowerCase() === "completed");
    const cancelled = rows.filter((row) => row.status.toLowerCase() === "cancelled");
    const totalEarnings = completed.reduce((sum, row) => {
      const value = Number(row.earnings_idr);
      return sum + (Number.isFinite(value) ? value : 0);
    }, 0);
    return {
      totalRows: rows.length,
      completedCount: completed.length,
      cancelledCount: cancelled.length,
      totalEarnings
    };
  }, [rows]);

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    setStatus(null);
    setError(null);
    setFileName(file.name);
    const text = await file.text();
    const parsed = parseCsv(text);
    const normalizedHeaders = parsed.headers.map((header) => header.toLowerCase());
    const headerMatch =
      normalizedHeaders.length === EXPECTED_HEADERS.length &&
      EXPECTED_HEADERS.every((header, index) => header === normalizedHeaders[index]);
    if (!headerMatch) {
      reportError(`Header CSV tidak sesuai. Harus: ${EXPECTED_HEADERS.join(", ")}`);
      setRows([]);
      return;
    }
    setRows(parsed.rows);
  }

  async function handleImport() {
    if (rows.length === 0) {
      reportError("Tidak ada data untuk diimport.");
      return;
    }
    setIsImporting(true);
    setError(null);
    setStatus(null);
    try {
      const openSessions = await db.sessions.where("status").anyOf("active", "paused").toArray();
      const latestSession = openSessions.sort(
        (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
      )[0];

      const tripsToAdd: Trip[] = [];
      const txToAdd: WalletTx[] = [];
      rows.forEach((row) => {
        const startedAt = new Date(row.started_at);
        const completedAt = new Date(row.completed_at);
        if (!Number.isFinite(startedAt.getTime()) || !Number.isFinite(completedAt.getTime())) {
          return;
        }
        const earnings = Number(row.earnings_idr);
        const normalizedStatus = row.status.toLowerCase();
        const isCompleted = normalizedStatus === "completed";
        const finalEarnings = isCompleted && Number.isFinite(earnings) ? earnings : 0;
        const trip: Trip = {
          id: nanoid(),
          startedAt: startedAt.toISOString(),
          endedAt: completedAt.toISOString(),
          startLat: null,
          startLon: null,
          endLat: null,
          endLon: null,
          earnings: finalEarnings,
          note: buildTripNote(row),
          source: "import:maxim",
          sessionId: latestSession?.id
        };
        tripsToAdd.push(trip);

        if (isCompleted && finalEarnings > 0 && settings?.autoAddIncomeFromTrips) {
          txToAdd.push({
            id: nanoid(),
            createdAt: completedAt.toISOString(),
            type: "income",
            amount: finalEarnings,
            category: "Order",
            note: buildTripNote(row),
            sessionId: latestSession?.id
          });
        }
      });

      await db.transaction("rw", db.trips, db.wallet_tx, async () => {
        if (tripsToAdd.length > 0) {
          await db.trips.bulkAdd(tripsToAdd);
        }
        if (txToAdd.length > 0) {
          await db.wallet_tx.bulkAdd(txToAdd);
        }
      });
      reportStatus(`Import sukses: ${tripsToAdd.length} trip disimpan.`);
      setTimeout(() => {
        router.push("/wallet");
      }, 800);
    } catch (importError) {
      reportError(
        importError instanceof Error ? importError.message : "Gagal import CSV."
      );
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="card">
        <h2 className="page-title">Import Order Maxim (CSV)</h2>
        <p className="helper-text">
          Upload CSV resmi Maxim. Data akan masuk ke trips & dompet secara otomatis.
        </p>
      </div>

      <div className="card">
        <label>File CSV</label>
        <input type="file" accept=".csv" onChange={handleFileChange} />
        {fileName && <div className="helper-text">File: {fileName}</div>}
        {error && <div className="helper-text">{error}</div>}
      </div>

      <div className="card">
        <h3>Pengaturan Import</h3>
        <label>
          <input
            type="checkbox"
            checked={settings?.autoAddIncomeFromTrips ?? true}
            onChange={(event) =>
              updateSettings({ autoAddIncomeFromTrips: event.target.checked })
            }
          />{" "}
          Otomatis tambah income ke dompet dari order selesai
        </label>
      </div>

      <div className="card">
        <h3>Ringkasan</h3>
        <div className="helper-text">Total baris: {summary.totalRows}</div>
        <div className="helper-text">Completed: {summary.completedCount}</div>
        <div className="helper-text">Cancelled: {summary.cancelledCount}</div>
        <div className="helper-text">
          Total earnings (completed): Rp {summary.totalEarnings.toLocaleString("id-ID")}
        </div>
        <button
          type="button"
          className="btn primary"
          onClick={() => void handleImport()}
          disabled={isImporting}
        >
          {isImporting ? "Mengimpor..." : "Import Sekarang"}
        </button>
        {status && <div className="helper-text">{status}</div>}
      </div>

      <div className="card">
        <h3>Preview</h3>
        {rows.length === 0 ? (
          <div className="helper-text">Belum ada data untuk preview.</div>
        ) : (
          <div className="list">
            {rows.slice(0, 5).map((row, index) => (
              <div key={`${row.started_at}-${index}`} className="list-item">
                <strong>{row.status}</strong>
                <div className="helper-text">
                  {row.started_at} → {row.completed_at}
                </div>
                <div className="helper-text">
                  {row.pickup_name} → {row.dropoff_name}
                </div>
                <div className="helper-text">Rp {row.earnings_idr}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
