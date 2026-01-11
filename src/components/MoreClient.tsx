"use client";

import { useMemo, useState } from "react";
import { db, normalizeSettings, type Settings, type Trip, type WalletTx } from "../lib/db";
import { hasTripCoords, haversineKm, isFiniteNumber } from "../lib/geo";
import { getSettings, updateSettings } from "../lib/settings";
import { useLiveQueryState } from "../lib/useLiveQueryState";
import { ImportClient } from "./ImportClient";
import { SessionReportClient } from "./SessionReportClient";
import { Sheet } from "./ui/Sheet";

const TARGET_PRESETS = [100_000, 150_000, 200_000, 250_000];

const formatCurrency = (value: number) => `Rp ${value.toLocaleString("id-ID")}`;

export function MoreClient() {
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const settings = useLiveQueryState(async () => getSettings(), [], null as Settings | null);
  const trips = useLiveQueryState(async () => db.trips.orderBy("startedAt").reverse().toArray(), [], [] as Trip[]);
  const transactions = useLiveQueryState(
    async () => db.wallet_tx.orderBy("createdAt").reverse().toArray(),
    [],
    [] as WalletTx[]
  );

  const normalizedSettings = useMemo(() => normalizeSettings(settings ?? undefined), [settings]);

  const estimateStats = useMemo(() => {
    const now = new Date();
    const from = new Date(now);
    from.setDate(from.getDate() - 6);
    from.setHours(0, 0, 0, 0);

    const rangeTrips = trips
      .filter((trip) => {
        const startedAt = new Date(trip.startedAt);
        return startedAt >= from && startedAt <= now;
      })
      .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());

    let distanceKm = 0;
    let lastTripForDeadhead: Trip | null = null;

    for (const trip of rangeTrips) {
      if (hasTripCoords(trip)) {
        distanceKm += haversineKm(trip.startLat, trip.startLon, trip.endLat, trip.endLon);
      }

      if (normalizedSettings.distanceMode === "trip+deadhead") {
        if (
          lastTripForDeadhead &&
          isFiniteNumber(trip.startLat) &&
          isFiniteNumber(trip.startLon) &&
          isFiniteNumber(lastTripForDeadhead.endLat) &&
          isFiniteNumber(lastTripForDeadhead.endLon)
        ) {
          const { startLat, startLon } = trip;
          const { endLat, endLon } = lastTripForDeadhead;
          distanceKm += haversineKm(endLat, endLon, startLat, startLon);
        }
        if (isFiniteNumber(trip.endLat) && isFiniteNumber(trip.endLon)) {
          lastTripForDeadhead = trip;
        }
      }
    }

    const fuelExpense = transactions
      .filter((tx) => tx.type === "expense")
      .filter((tx) => tx.category === normalizedSettings.fuelCategoryName)
      .filter((tx) => {
        const createdAt = new Date(tx.createdAt);
        return createdAt >= from && createdAt <= now;
      })
      .reduce((sum, tx) => sum + tx.amount, 0);

    return { distanceKm, fuelExpense };
  }, [normalizedSettings.distanceMode, normalizedSettings.fuelCategoryName, transactions, trips]);

  const estimateValue =
    estimateStats.distanceKm >= 5 && estimateStats.fuelExpense > 0
      ? estimateStats.fuelExpense / Math.max(estimateStats.distanceKm, 1)
      : null;

  return (
    <div className="grid" style={{ gap: 12 }}>
      <div className="card">
        <div className="list">
          <button type="button" className="btn list-item" onClick={() => setImportOpen(true)}>
            Import CSV
          </button>
          <button type="button" className="btn list-item" onClick={() => setExportOpen(true)}>
            Ekspor CSV
          </button>
          <button type="button" className="btn list-item" onClick={() => setSettingsOpen(true)}>
            Settings
          </button>
        </div>
      </div>

      <Sheet open={importOpen} onClose={() => setImportOpen(false)} title="Import CSV">
        <ImportClient />
      </Sheet>

      <Sheet open={exportOpen} onClose={() => setExportOpen(false)} title="Ekspor CSV">
        <SessionReportClient />
      </Sheet>

      <Sheet open={settingsOpen} onClose={() => setSettingsOpen(false)} title="Settings">
        <div className="grid">
          <div>
            <div className="helper-text">Target harian</div>
            <input
              type="range"
              min={50_000}
              max={400_000}
              step={10_000}
              value={normalizedSettings.dailyTargetNet}
              onChange={(event) =>
                updateSettings({ dailyTargetNet: Number(event.target.value) })
              }
            />
            <div className="form-row">
              {TARGET_PRESETS.map((value) => (
                <button
                  key={value}
                  type="button"
                  className="btn secondary"
                  onClick={() => updateSettings({ dailyTargetNet: value })}
                >
                  {formatCurrency(value)}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="helper-text">Cost/km</div>
            <div className="kpi-value" style={{ marginBottom: 6 }}>
              {normalizedSettings.costPerKmEstimate || normalizedSettings.manualCostPerKm
                ? formatCurrency(
                    normalizedSettings.costPerKmEstimate ?? normalizedSettings.manualCostPerKm ?? 0
                  )
                : "butuh trip GPS"}
            </div>
            <div className="form-row">
              <button
                type="button"
                className="btn secondary"
                disabled={estimateValue === null}
                onClick={() =>
                  updateSettings({
                    costPerKmEstimate: estimateValue ?? null,
                    costPerKmEstimateMethod: "fuel-only",
                    manualCostPerKm: null
                  })
                }
              >
                Hitung dari BBM (7 hari)
              </button>
              <button
                type="button"
                className="btn secondary"
                onClick={() => updateSettings({ costPerKmEstimateMethod: "manual" })}
              >
                Manual
              </button>
            </div>
            {normalizedSettings.costPerKmEstimateMethod === "manual" && (
              <input
                type="number"
                min="0"
                step="100"
                placeholder="Masukkan nilai"
                value={normalizedSettings.manualCostPerKm ?? ""}
                onChange={(event) =>
                  updateSettings({
                    manualCostPerKm: event.target.value ? Number(event.target.value) : null
                  })
                }
              />
            )}
          </div>

          <div>
            <div className="helper-text">Mode jarak</div>
            <div className="form-row">
              <button
                type="button"
                className={`btn chip ${normalizedSettings.distanceMode === "trip-only" ? "active" : ""}`}
                onClick={() => updateSettings({ distanceMode: "trip-only" })}
              >
                Trip
              </button>
              <button
                type="button"
                className={`btn chip ${normalizedSettings.distanceMode === "trip+deadhead" ? "active" : ""}`}
                onClick={() => updateSettings({ distanceMode: "trip+deadhead" })}
              >
                Trip + Deadhead
              </button>
            </div>
          </div>

          <div>
            <div className="helper-text">Haptic feedback</div>
            <div className="form-row">
              <button
                type="button"
                className={`btn chip ${normalizedSettings.hapticsEnabled ? "active" : ""}`}
                onClick={() => updateSettings({ hapticsEnabled: true })}
              >
                Aktif
              </button>
              <button
                type="button"
                className={`btn chip ${!normalizedSettings.hapticsEnabled ? "active" : ""}`}
                onClick={() => updateSettings({ hapticsEnabled: false })}
              >
                Mati
              </button>
            </div>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
