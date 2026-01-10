"use client";

import { nanoid } from "nanoid";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import {
  db,
  defaultSettings,
  normalizeSettings,
  type Session,
  type Settings,
  type Trip,
  type WalletTx
} from "../lib/db";
import { haversineKm } from "../lib/geo";
import { attachToActiveSession, computeActiveMinutes } from "../lib/session";
import { dailySummary, rangeSummary, sumByCategory } from "../lib/walletAnalytics";
import { getSettings } from "../lib/settings";
import { useLiveQueryState } from "../lib/useLiveQueryState";

const walletSchema = z.object({
  type: z.enum(["income", "expense"]),
  amount: z.coerce.number().min(0),
  category: z.string().min(1),
  note: z.string().optional(),
  createdAt: z.string().min(1)
});

const CATEGORY_PRESETS = ["BBM", "Makan", "Servis", "Pulsa", "Parkir", "Cuci", "Lainnya"];
const QUICK_EXPENSES = ["BBM", "Makan", "Parkir", "Servis"];

const formatCurrency = (value: number) => `Rp ${value.toLocaleString("id-ID")}`;

export function WalletClient() {
  const [transactions, setTransactions] = useState<WalletTx[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [status, setStatus] = useState<string | null>(null);
  const [estimateDays, setEstimateDays] = useState(7);
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [sessionActiveMinutes, setSessionActiveMinutes] = useState<number | null>(null);
  const [summaryMode, setSummaryMode] = useState<"today" | "session">("today");

  const [formType, setFormType] = useState<"income" | "expense">("income");
  const [formAmount, setFormAmount] = useState("0");
  const [formCategory, setFormCategory] = useState("Order");
  const [formNote, setFormNote] = useState("");
  const [formDate, setFormDate] = useState(new Date().toISOString().slice(0, 10));

  const liveTransactions = useLiveQueryState(async () => {
    return db.wallet_tx.orderBy("createdAt").reverse().toArray();
  }, [], [] as WalletTx[]);

  const liveTrips = useLiveQueryState(async () => {
    return db.trips.orderBy("startedAt").reverse().toArray();
  }, [], [] as Trip[]);

  const liveSettings = useLiveQueryState(async () => getSettings(), [], defaultSettings);

  const liveSession = useLiveQueryState(async () => {
    const sessions = await db.sessions.where("status").anyOf("active", "paused").toArray();
    if (sessions.length === 0) {
      return null;
    }
    return sessions.sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    )[0];
  }, [], null as Session | null);

  useEffect(() => {
    setTransactions(liveTransactions);
  }, [liveTransactions]);

  useEffect(() => {
    setTrips(liveTrips);
  }, [liveTrips]);

  useEffect(() => {
    setSettings(normalizeSettings(liveSettings));
  }, [liveSettings]);

  useEffect(() => {
    setActiveSession(liveSession);
  }, [liveSession]);

  useEffect(() => {
    if (!activeSession) {
      setSessionActiveMinutes(null);
      return;
    }
    const updateMinutes = () => {
      setSessionActiveMinutes(computeActiveMinutes(activeSession, new Date()));
    };
    updateMinutes();
    const interval = window.setInterval(updateMinutes, 1000);
    return () => window.clearInterval(interval);
  }, [activeSession]);

  useEffect(() => {
    const defaultCategory = formType === "income" ? "Order" : "BBM";
    setFormCategory(defaultCategory);
  }, [formType]);

  useEffect(() => {
    if (!activeSession) {
      setSummaryMode("today");
    }
  }, [activeSession]);

  function handleQuickExpense(category: string) {
    setFormType("expense");
    setFormCategory(category);
    setFormAmount("0");
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = walletSchema.safeParse({
      type: formType,
      amount: formAmount,
      category: formCategory,
      note: formNote || undefined,
      createdAt: formDate
    });

    if (!parsed.success) {
      setStatus(parsed.error.flatten().formErrors.join(", "));
      return;
    }

    const createdAt = new Date(parsed.data.createdAt).toISOString();

    const tx: WalletTx = {
      id: nanoid(),
      createdAt,
      type: parsed.data.type,
      amount: parsed.data.amount,
      category: parsed.data.category,
      note: parsed.data.note
    };

    const txWithSession = await attachToActiveSession(tx);
    await db.wallet_tx.add(txWithSession);
    setFormAmount("0");
    setFormNote("");
    setFormType("income");
    setFormCategory("Order");
    setFormDate(new Date().toISOString().slice(0, 10));
    setStatus("Transaksi tersimpan.");
  }

  async function updateSettings(patch: Partial<Settings>) {
    const next = normalizeSettings({ ...settings, ...patch, id: "default" });
    await db.settings.put(next);
    setSettings(next);
  }

  const todaySummary = useMemo(() => dailySummary(transactions, new Date()), [transactions]);
  const sessionTransactions = useMemo(
    () => (activeSession ? transactions.filter((tx) => tx.sessionId === activeSession.id) : []),
    [activeSession, transactions]
  );
  const sessionSummary = useMemo(() => {
    if (!activeSession) {
      return null;
    }
    const income = sessionTransactions
      .filter((tx) => tx.type === "income")
      .reduce((sum, tx) => sum + tx.amount, 0);
    const expense = sessionTransactions
      .filter((tx) => tx.type === "expense")
      .reduce((sum, tx) => sum + tx.amount, 0);
    const byCategory = sessionTransactions
      .filter((tx) => tx.type === "expense")
      .reduce<Record<string, number>>((acc, tx) => {
        acc[tx.category] = (acc[tx.category] ?? 0) + tx.amount;
        return acc;
      }, {});
    const categoryList = Object.entries(byCategory)
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount);
    return {
      income,
      expense,
      net: income - expense,
      byCategory: categoryList,
      topExpenseCategory: categoryList[0] ?? null
    };
  }, [activeSession, sessionTransactions]);
  const weekSummary = useMemo(() => rangeSummary(transactions, 7), [transactions]);
  const monthSummary = useMemo(() => rangeSummary(transactions, 30), [transactions]);

  const estimateRange = useMemo(() => {
    const now = new Date();
    const from = new Date(now);
    from.setDate(from.getDate() - Math.max(estimateDays - 1, 0));
    from.setHours(0, 0, 0, 0);
    return { from, to: now };
  }, [estimateDays]);

  const estimateStats = useMemo(() => {
    const rangeTrips = trips
      .filter((trip) => {
        const startedAt = new Date(trip.startedAt);
        return startedAt >= estimateRange.from && startedAt <= estimateRange.to;
      })
      .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());

    const isValidCoord = (value: number | null): value is number =>
      Number.isFinite(value ?? NaN);

    let distanceKm = 0;
    let lastTripForDeadhead: Trip | null = null;

    for (const trip of rangeTrips) {
      const hasTripCoords =
        isValidCoord(trip.startLat) &&
        isValidCoord(trip.startLon) &&
        isValidCoord(trip.endLat) &&
        isValidCoord(trip.endLon);

      if (hasTripCoords) {
        distanceKm += haversineKm(trip.startLat, trip.startLon, trip.endLat, trip.endLon);
      }

      if (settings.distanceMode === "trip+deadhead") {
        const hasStartCoords = isValidCoord(trip.startLat) && isValidCoord(trip.startLon);
        if (lastTripForDeadhead && hasStartCoords) {
          distanceKm += haversineKm(
            lastTripForDeadhead.endLat,
            lastTripForDeadhead.endLon,
            trip.startLat,
            trip.startLon
          );
        }
        if (isValidCoord(trip.endLat) && isValidCoord(trip.endLon)) {
          lastTripForDeadhead = trip;
        }
      }
    }

    const expenseTotals = sumByCategory(transactions, {
      type: "expense",
      from: estimateRange.from,
      to: estimateRange.to
    });

    const totalExpense = expenseTotals.reduce((sum, item) => sum + item.amount, 0);
    const fuelExpense =
      expenseTotals.find((item) => item.category === settings.fuelCategoryName)?.amount ?? 0;

    return {
      distanceKm,
      totalExpense,
      fuelExpense
    };
  }, [trips, transactions, estimateRange, settings.distanceMode, settings.fuelCategoryName]);

  const estimateMethod = settings.costPerKmEstimateMethod;
  const estimateSpend = estimateMethod === "all-expense" ? estimateStats.totalExpense : estimateStats.fuelExpense;
  const estimateBasisLabel =
    estimateMethod === "all-expense" ? "semua expense" : settings.fuelCategoryName;
  const estimateKmLabel =
    settings.distanceMode === "trip+deadhead" ? "trip + deadhead" : "trip";
  const estimateReady = estimateStats.distanceKm >= 5 && estimateSpend > 0;
  const estimateValue = estimateReady ? estimateSpend / Math.max(estimateStats.distanceKm, 1) : null;

  const engineCostPerKm =
    settings.costPerKmEstimate ?? settings.manualCostPerKm ?? defaultSettings.costPerKm ?? 250;

  const grossToday = todaySummary.income;
  const expenseToday = todaySummary.expense;
  const netToday = todaySummary.net;
  const targetNet = settings.dailyTargetNet;
  const targetGross = settings.dailyTargetGross ?? null;

  const netForTarget = activeSession && sessionSummary ? sessionSummary.net : netToday;
  const grossForTarget = activeSession && sessionSummary ? sessionSummary.income : grossToday;
  const progress = Math.min(netForTarget / Math.max(targetNet, 1), 1);
  const remainingTarget = Math.max(targetNet - netForTarget, 0);

  const fallbackActiveHours = useMemo(() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const todayTrips = trips.filter((trip) => {
      const startedAt = new Date(trip.startedAt);
      return startedAt >= startOfToday && startedAt <= endOfToday;
    });

    let durationHours = 0;
    for (const trip of todayTrips) {
      const start = new Date(trip.startedAt).getTime();
      const end = new Date(trip.endedAt).getTime();
      if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
        durationHours += (end - start) / 3_600_000;
      }
    }

    if (durationHours > 0) {
      return durationHours;
    }

    const todayTx = transactions
      .filter((tx) => {
        const createdAt = new Date(tx.createdAt);
        return createdAt >= startOfToday && createdAt <= endOfToday;
      })
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    if (todayTx.length === 0) {
      return null;
    }

    const firstTxTime = new Date(todayTx[0].createdAt).getTime();
    const nowTime = Date.now();
    if (nowTime <= firstTxTime) {
      return null;
    }

    return (nowTime - firstTxTime) / 3_600_000;
  }, [trips, transactions]);

  const activeHours = activeSession && sessionActiveMinutes !== null
    ? sessionActiveMinutes / 60
    : fallbackActiveHours;
  const netPerActiveHour = activeHours ? netForTarget / Math.max(activeHours, 1) : null;
  const remainingHoursToTarget =
    netPerActiveHour && netPerActiveHour > 0
      ? remainingTarget / Math.max(netPerActiveHour, 1)
      : null;
  const now = new Date();

  const fuelExpenseToday = todaySummary.byCategory.find(
    (item) => item.category === settings.fuelCategoryName
  )?.amount;
  const fuelExpenseShare = grossToday > 0 && fuelExpenseToday
    ? Math.round((fuelExpenseToday / grossToday) * 100)
    : null;

  const behindTarget = netForTarget < targetNet * 0.5 && now.getHours() >= 14;

  const categoryBreakdownWeek = weekSummary.byCategory;
  const categoryBreakdownMonth = monthSummary.byCategory;

  return (
    <div className="grid" style={{ gap: 24 }}>
      <div className="card">
        <h2 className="page-title">Dompet Harian</h2>
        <p className="helper-text">
          Catat pemasukan dan pengeluaran. Data tersimpan offline di perangkat.
        </p>
      </div>

      <div className="card">
        <h3>Tambah Transaksi</h3>
        <div className="helper-text" style={{ marginBottom: 8 }}>
          Quick expense:
        </div>
        <div className="form-row">
          {QUICK_EXPENSES.map((item) => (
            <button
              key={item}
              type="button"
              className="secondary"
              onClick={() => handleQuickExpense(item)}
            >
              {item}
            </button>
          ))}
        </div>
        <form className="grid" onSubmit={handleSubmit}>
          <div className="form-row">
            <div>
              <label>Jenis</label>
              <select
                name="type"
                value={formType}
                onChange={(event) => setFormType(event.target.value as "income" | "expense")}
                required
              >
                <option value="income">Pemasukan</option>
                <option value="expense">Pengeluaran</option>
              </select>
            </div>
            <div>
              <label>Jumlah (Rp)</label>
              <input
                type="number"
                name="amount"
                min="0"
                step="1000"
                value={formAmount}
                onChange={(event) => setFormAmount(event.target.value)}
                required
              />
            </div>
            <div>
              <label>Kategori</label>
              <input
                type="text"
                name="category"
                placeholder="BBM, Makan, Servis"
                value={formCategory}
                onChange={(event) => setFormCategory(event.target.value)}
                required
              />
              <div className="helper-text" style={{ marginTop: 6 }}>
                {CATEGORY_PRESETS.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={item === formCategory ? "secondary" : "ghost"}
                    style={{ marginRight: 6, marginBottom: 6 }}
                    onClick={() => setFormCategory(item)}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label>Tanggal</label>
              <input
                type="date"
                name="createdAt"
                value={formDate}
                onChange={(event) => setFormDate(event.target.value)}
                required
              />
            </div>
          </div>
          <div>
            <label>Catatan</label>
            <textarea
              name="note"
              rows={2}
              placeholder="Opsional"
              value={formNote}
              onChange={(event) => setFormNote(event.target.value)}
            />
          </div>
          <div>
            <button type="submit">Simpan Transaksi</button>
          </div>
          {status && <div className="helper-text">{status}</div>}
        </form>
      </div>

      <div className="card grid three">
        <div>
          <div className="form-row" style={{ justifyContent: "space-between" }}>
            <h4>Hari Ini</h4>
            <div className="form-row">
              <button
                type="button"
                className={summaryMode === "today" ? "secondary" : "ghost"}
                onClick={() => setSummaryMode("today")}
              >
                Semua hari ini
              </button>
              <button
                type="button"
                className={summaryMode === "session" ? "secondary" : "ghost"}
                onClick={() => setSummaryMode("session")}
                disabled={!activeSession}
              >
                Sesi aktif
              </button>
            </div>
          </div>
          <p className="helper-text">
            Income:{" "}
            {formatCurrency(summaryMode === "session" && sessionSummary
              ? sessionSummary.income
              : todaySummary.income)}
          </p>
          <p className="helper-text">
            Expense:{" "}
            {formatCurrency(summaryMode === "session" && sessionSummary
              ? sessionSummary.expense
              : todaySummary.expense)}
          </p>
          <p>
            <strong>
              Net:{" "}
              {formatCurrency(summaryMode === "session" && sessionSummary
                ? sessionSummary.net
                : todaySummary.net)}
            </strong>
          </p>
          <p className="helper-text">
            Pace per jam aktif: {netPerActiveHour ? formatCurrency(netPerActiveHour) : "N/A"}
          </p>
          {(summaryMode === "session" ? sessionSummary?.topExpenseCategory : todaySummary.topExpenseCategory) && (
            <p className="helper-text">
              Top expense:{" "}
              {(summaryMode === "session" ? sessionSummary?.topExpenseCategory : todaySummary.topExpenseCategory)?.category}{" "}
              ({formatCurrency((summaryMode === "session" ? sessionSummary?.topExpenseCategory : todaySummary.topExpenseCategory)?.amount ?? 0)})
            </p>
          )}
        </div>
        <div>
          <h4>7 Hari Terakhir</h4>
          <p className="helper-text">Income: {formatCurrency(weekSummary.income)}</p>
          <p className="helper-text">Expense: {formatCurrency(weekSummary.expense)}</p>
          <p>
            <strong>Net: {formatCurrency(weekSummary.net)}</strong>
          </p>
        </div>
        <div>
          <h4>Transaksi Tersimpan</h4>
          <p className="helper-text">{transactions.length} item</p>
        </div>
      </div>

      <div className="card">
        <h3>Ringkasan per kategori</h3>
        <div className="grid two">
          <div>
            <h4>Hari Ini</h4>
            {todaySummary.topExpenseCategory ? (
              <p className="helper-text">
                {todaySummary.topExpenseCategory.category}: {" "}
                {formatCurrency(todaySummary.topExpenseCategory.amount)}
              </p>
            ) : (
              <p className="helper-text">Belum ada pengeluaran hari ini.</p>
            )}
          </div>
          <div>
            <h4>7 Hari Terakhir</h4>
            {categoryBreakdownWeek.length > 0 ? (
              <div className="list">
                {categoryBreakdownWeek.map((item) => (
                  <div key={item.category} className="list-item">
                    <strong>{item.category}</strong>
                    <div className="helper-text">{formatCurrency(item.amount)}</div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="helper-text">Belum ada data pengeluaran.</p>
            )}
          </div>
        </div>
        <div style={{ marginTop: 16 }}>
          <h4>30 Hari Terakhir</h4>
          {categoryBreakdownMonth.length > 0 ? (
            <div className="list">
              {categoryBreakdownMonth.map((item) => (
                <div key={item.category} className="list-item">
                  <strong>{item.category}</strong>
                  <div className="helper-text">{formatCurrency(item.amount)}</div>
                </div>
              ))}
            </div>
          ) : (
            <p className="helper-text">Belum ada data pengeluaran.</p>
          )}
        </div>
      </div>

      <div className="card">
        <h3>Target Hari Ini</h3>
        <div className="grid two">
          <div>
            <p className="helper-text">Target bersih: {formatCurrency(targetNet)}</p>
            <div
              style={{
                height: 14,
                background: "#1a2430",
                borderRadius: 999,
                overflow: "hidden",
                margin: "8px 0"
              }}
            >
              <div
                style={{
                  width: `${Math.min(progress * 100, 100)}%`,
                  height: "100%",
                  background: "var(--primary)"
                }}
              />
            </div>
            <p className="helper-text">
              Net {activeSession ? "sesi" : "hari ini"}: {formatCurrency(netForTarget)}
            </p>
            <p>
              <strong>Sisa target: {formatCurrency(remainingTarget)}</strong>
            </p>
            {targetGross ? (
              <p className="helper-text">
                Target kotor: {formatCurrency(targetGross)} • Gross saat ini:{" "}
                {formatCurrency(grossForTarget)}
              </p>
            ) : null}
          </div>
          <div>
            <p className="helper-text">
              Jam aktif {activeSession ? "sesi" : "hari ini"}:{" "}
              {activeHours ? activeHours.toFixed(1) : "N/A"}
            </p>
            <p className="helper-text">
              Net per jam aktif: {netPerActiveHour ? formatCurrency(netPerActiveHour) : "N/A"}
            </p>
            {activeHours && remainingHoursToTarget !== null ? (
              <p className="helper-text">
                Estimasi sisa jam hingga target: {remainingHoursToTarget.toFixed(1)} jam
                (informasi, bukan jaminan).
              </p>
            ) : (
              <p className="helper-text">Belum ada durasi trip yang bisa dihitung.</p>
            )}
            {fuelExpenseShare !== null && (
              <p className="helper-text">
                BBM hari ini {fuelExpenseShare}% dari income.
              </p>
            )}
            {behindTarget && (
              <p className="helper-text">
                Saat ini tertinggal, prioritaskan area POI padat dan kurangi pindah jauh (hemat
                BBM).
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <h3>Biaya per km (estimasi)</h3>
        <div className="grid two">
          <div>
            <label>Metode</label>
            <select
              value={settings.costPerKmEstimateMethod}
              onChange={(event) =>
                updateSettings({
                  costPerKmEstimateMethod: event.target.value as Settings["costPerKmEstimateMethod"]
                })
              }
            >
              <option value="fuel-only">BBM saja</option>
              <option value="all-expense">Semua expense</option>
              <option value="manual">Manual</option>
            </select>
          </div>
          <div>
            <label>Periode estimasi</label>
            <select value={estimateDays} onChange={(event) => setEstimateDays(Number(event.target.value))}>
              <option value={7}>7 hari</option>
              <option value={14}>14 hari</option>
              <option value={30}>30 hari</option>
            </select>
          </div>
        </div>
        <div className="grid two" style={{ marginTop: 12 }}>
          <div>
            <p className="helper-text">
              Basis: {estimateBasisLabel} {estimateDays} hari / jarak {estimateDays} hari ({estimateKmLabel})
            </p>
            {estimateMethod === "manual" ? (
              <p>
                <strong>{settings.manualCostPerKm ? formatCurrency(settings.manualCostPerKm) : "Masukkan nilai manual"}</strong>
              </p>
            ) : estimateReady && estimateValue !== null ? (
              <p>
                <strong>{formatCurrency(estimateValue)}</strong>
              </p>
            ) : (
              <p className="helper-text">Data belum cukup untuk estimasi.</p>
            )}
            <p className="helper-text">Jarak tercatat: {estimateStats.distanceKm.toFixed(1)} km</p>
            <p className="helper-text">
              Spend estimasi: {formatCurrency(estimateSpend)}
            </p>
          </div>
          <div>
            {estimateMethod === "manual" && (
              <div>
                <label>Manual cost/km</label>
                <input
                  type="number"
                  min="0"
                  step="100"
                  value={settings.manualCostPerKm ?? ""}
                  onChange={(event) =>
                    updateSettings({
                      manualCostPerKm: event.target.value ? Number(event.target.value) : null
                    })
                  }
                  placeholder="Masukkan nilai"
                />
              </div>
            )}
            <div style={{ marginTop: 12 }}>
              <button
                type="button"
                disabled={!estimateReady || estimateValue === null}
                onClick={() =>
                  updateSettings({
                    costPerKmEstimate: estimateValue ?? null,
                    costPerKmEstimateMethod: "fuel-only",
                    costPerKm: estimateValue ?? undefined
                  })
                }
              >
                Terapkan ke Asisten
              </button>
              <p className="helper-text" style={{ marginTop: 8 }}>
                Cost/km untuk engine: {formatCurrency(engineCostPerKm)}
              </p>
            </div>
          </div>
        </div>
        <div className="grid two" style={{ marginTop: 12 }}>
          <div>
            <label>Nama kategori BBM</label>
            <input
              type="text"
              value={settings.fuelCategoryName}
              onChange={(event) => updateSettings({ fuelCategoryName: event.target.value })}
            />
          </div>
          <div>
            <label>Mode jarak</label>
            <select
              value={settings.distanceMode}
              onChange={(event) =>
                updateSettings({ distanceMode: event.target.value as Settings["distanceMode"] })
              }
            >
              <option value="trip-only">Trip saja</option>
              <option value="trip+deadhead">Trip + deadhead</option>
            </select>
          </div>
        </div>
      </div>

      <div className="card">
        <h3>Pengaturan Target Harian</h3>
        <div className="form-row">
          <div>
            <label>Target bersih harian (Rp)</label>
            <input
              type="number"
              min="0"
              step="10000"
              value={settings.dailyTargetNet}
              onChange={(event) => updateSettings({ dailyTargetNet: Number(event.target.value) })}
            />
          </div>
          <div>
            <label>Target kotor harian (opsional)</label>
            <input
              type="number"
              min="0"
              step="10000"
              value={settings.dailyTargetGross ?? ""}
              onChange={(event) =>
                updateSettings({
                  dailyTargetGross: event.target.value ? Number(event.target.value) : null
                })
              }
              placeholder="Opsional"
            />
          </div>
        </div>
      </div>

      <div className="card">
        <h3>Export CSV</h3>
        <div className="grid two">
          <button
            type="button"
            onClick={() => downloadWalletCsv(transactions)}
            className="secondary"
          >
            Export Wallet CSV
          </button>
          <button
            type="button"
            onClick={() => downloadTripsCsv(trips)}
            className="secondary"
          >
            Export Trips CSV
          </button>
        </div>
      </div>

      <div className="card">
        <h3>Transaksi Terbaru</h3>
        <div className="list">
          {transactions.slice(0, 8).map((tx) => (
            <div key={tx.id} className="list-item">
              <div>
                <strong>
                  {tx.type === "income" ? "+" : "-"} {formatCurrency(tx.amount)}
                </strong>
              </div>
              <div className="helper-text">
                {tx.category} • {new Date(tx.createdAt).toLocaleDateString("id-ID")} •{" "}
                {tx.note ?? "Tanpa catatan"}
              </div>
            </div>
          ))}
          {transactions.length === 0 && (
            <div className="helper-text">Belum ada transaksi.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function downloadWalletCsv(transactions: WalletTx[]) {
  const header = ["createdAt", "type", "amount", "category", "note", "sessionId"];
  const rows = transactions.map((tx) => [
    tx.createdAt,
    tx.type,
    tx.amount,
    tx.category,
    tx.note ?? "",
    tx.sessionId ?? ""
  ]);
  downloadCsv("wallet.csv", header, rows);
}

function downloadTripsCsv(trips: Trip[]) {
  const header = [
    "startedAt",
    "endedAt",
    "startLat",
    "startLon",
    "endLat",
    "endLon",
    "earnings",
    "note",
    "sessionId",
    "source"
  ];
  const rows = trips.map((trip) => [
    trip.startedAt,
    trip.endedAt,
    trip.startLat ?? "",
    trip.startLon ?? "",
    trip.endLat ?? "",
    trip.endLon ?? "",
    trip.earnings,
    trip.note ?? "",
    trip.sessionId ?? "",
    trip.source
  ]);
  downloadCsv("trips.csv", header, rows);
}

function downloadCsv(filename: string, header: Array<string | number>, rows: Array<Array<string | number>>) {
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
