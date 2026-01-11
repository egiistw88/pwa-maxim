"use client";

import { nanoid } from "nanoid";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { db, defaultSettings, normalizeSettings, type Settings, type WalletTx } from "../lib/db";
import { haptic } from "../lib/haptics";
import { attachToActiveSession } from "../lib/session";
import { dailySummary } from "../lib/walletAnalytics";
import { getSettings } from "../lib/settings";
import { useLiveQueryState } from "../lib/useLiveQueryState";
import { Dialog } from "./ui/Dialog";
import { Sheet } from "./ui/Sheet";
import { Toast } from "./ui/Toast";

const walletSchema = z.object({
  type: z.enum(["income", "expense"]),
  amount: z.coerce.number().min(0),
  category: z.string().min(1),
  note: z.string().optional(),
  createdAt: z.string().min(1)
});

const formatCurrency = (value: number) => `Rp ${value.toLocaleString("id-ID")}`;
type ToastState = { message: string; variant?: "success" | "error" };

export function WalletClient() {
  const [transactions, setTransactions] = useState<WalletTx[]>([]);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [status, setStatus] = useState<ToastState | null>(null);
  const [txDialogOpen, setTxDialogOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [txType, setTxType] = useState<"income" | "expense">("income");
  const [txAmount, setTxAmount] = useState("0");
  const [txCategory, setTxCategory] = useState("Order");
  const [txNote, setTxNote] = useState("");
  const [historyType, setHistoryType] = useState<"all" | "income" | "expense">("all");
  const [historyCategory, setHistoryCategory] = useState("all");

  const liveTransactions = useLiveQueryState(async () => {
    return db.wallet_tx.orderBy("createdAt").reverse().toArray();
  }, [], [] as WalletTx[]);

  const liveSettings = useLiveQueryState(async () => getSettings(), [], defaultSettings);

  useEffect(() => {
    setTransactions(liveTransactions);
  }, [liveTransactions]);

  useEffect(() => {
    setSettings(normalizeSettings(liveSettings));
  }, [liveSettings]);

  const hapticsEnabled = settings.hapticsEnabled ?? true;

  function showStatus(message: string, variant?: ToastState["variant"]) {
    setStatus({ message, variant });
    if (!variant || !hapticsEnabled) {
      return;
    }
    haptic(variant === "success" ? "success" : "error");
  }

  useEffect(() => {
    const defaultCategory = txType === "income" ? "Order" : "BBM";
    setTxCategory(defaultCategory);
  }, [txType]);

  function handleOpenIncome() {
    setTxType("income");
    setTxCategory("Order");
    setTxAmount("0");
    setTxNote("");
    setTxDialogOpen(true);
  }

  function handleOpenExpense(category: string) {
    setTxType("expense");
    setTxCategory(category);
    setTxAmount("0");
    setTxNote("");
    setTxDialogOpen(true);
  }

  async function handleSaveTransaction() {
    const parsed = walletSchema.safeParse({
      type: txType,
      amount: txAmount,
      category: txCategory,
      note: txNote || undefined,
      createdAt: new Date().toISOString()
    });

    if (!parsed.success) {
      showStatus(parsed.error.flatten().formErrors.join(", "), "error");
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
    setTxAmount("0");
    setTxNote("");
    setTxType("income");
    setTxCategory("Order");
    setTxDialogOpen(false);
    showStatus("Transaksi tersimpan.", "success");
  }

  function appendTxDigit(value: string) {
    setTxAmount((prev) => {
      const next = prev === "0" ? value : `${prev}${value}`;
      return next.replace(/^0+(?=\d)/, "");
    });
  }

  function handleTxPreset(value: number) {
    setTxAmount((prev) => {
      const current = Number(prev || 0);
      return String(current + value);
    });
  }

  function handleTxBackspace() {
    setTxAmount((prev) => (prev.length <= 1 ? "0" : prev.slice(0, -1)));
  }

  const todaySummary = useMemo(() => dailySummary(transactions, new Date()), [transactions]);
  const netToday = todaySummary.net;
  const targetNet = settings.dailyTargetNet;
  const progress = Math.min(netToday / Math.max(targetNet, 1), 1);
  const remainingTarget = Math.max(targetNet - netToday, 0);
  const costPerKmValue = settings.costPerKmEstimate ?? settings.manualCostPerKm;
  const costPerKmLabel = costPerKmValue ? formatCurrency(costPerKmValue) : "butuh trip GPS";
  const historyCategories = useMemo(() => {
    const set = new Set(transactions.map((tx) => tx.category));
    return ["all", ...Array.from(set)];
  }, [transactions]);
  const filteredTransactions = useMemo(() => {
    return transactions.filter((tx) => {
      if (historyType !== "all" && tx.type !== historyType) {
        return false;
      }
      if (historyCategory !== "all" && tx.category !== historyCategory) {
        return false;
      }
      return true;
    });
  }, [transactions, historyType, historyCategory]);

  return (
    <div className="grid" style={{ gap: 12 }}>
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="helper-text">Net Hari Ini</div>
          <div className="kpi-value">{formatCurrency(netToday)}</div>
        </div>
        <div className="kpi-card">
          <div className="helper-text">Target Progress</div>
          <div className="progress-bar" style={{ marginTop: 6 }}>
            <span style={{ width: `${Math.min(progress * 100, 100)}%` }} />
          </div>
          <div className="helper-text" style={{ marginTop: 6 }}>
            {Math.round(progress * 100)}% • sisa {formatCurrency(remainingTarget)}
          </div>
        </div>
        <div className="kpi-card">
          <div className="helper-text">Biaya/km</div>
          <div className="kpi-value">{costPerKmLabel}</div>
        </div>
      </div>

      <div className="card">
        <div className="form-row">
          <button type="button" className="btn primary" onClick={handleOpenIncome}>
            + Order
          </button>
          <button type="button" className="btn secondary" onClick={() => handleOpenExpense("BBM")}>
            BBM
          </button>
          <button type="button" className="btn secondary" onClick={() => handleOpenExpense("Makan")}>
            Makan
          </button>
          <button type="button" className="btn secondary" onClick={() => handleOpenExpense("Parkir")}>
            Parkir
          </button>
          <button type="button" className="btn secondary" onClick={() => handleOpenExpense("Servis")}>
            Servis
          </button>
        </div>
      </div>

      <div className="card">
        <button type="button" className="btn secondary" onClick={() => setHistoryOpen(true)}>
          Riwayat
        </button>
      </div>

      <Dialog
        open={txDialogOpen}
        onClose={() => setTxDialogOpen(false)}
        title={txType === "income" ? "Tambah Income" : "Tambah Expense"}
      >
        <div className="grid">
          <div className="helper-text">Kategori: {txCategory}</div>
          <input
            type="number"
            min="0"
            step="1000"
            placeholder="Nominal (Rp)"
            value={txAmount}
            onChange={(event) => setTxAmount(event.target.value)}
          />
          <div className="form-row">
            {[5000, 10000, 20000, 50000].map((value) => (
              <button key={value} type="button" className="btn secondary" onClick={() => handleTxPreset(value)}>
                {value.toLocaleString("id-ID")}
              </button>
            ))}
          </div>
          <div className="numpad">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
              <button
                key={digit}
                type="button"
                className="btn secondary"
                onClick={() => appendTxDigit(digit)}
              >
                {digit}
              </button>
            ))}
            <button type="button" className="btn secondary" onClick={() => appendTxDigit("0")}>
              0
            </button>
            <button type="button" className="btn secondary" onClick={handleTxBackspace}>
              ⌫
            </button>
            <button type="button" className="btn secondary" onClick={() => setTxAmount("0")}>
              C
            </button>
          </div>
          <div className="form-row">
            <button type="button" className="btn ghost" onClick={() => setTxNote("")}>
              Hapus catatan
            </button>
            <button type="button" className="btn primary" onClick={() => void handleSaveTransaction()}>
              Simpan
            </button>
          </div>
        </div>
      </Dialog>

      <Sheet open={historyOpen} onClose={() => setHistoryOpen(false)} title="Riwayat">
        <div className="grid">
          <div className="form-row">
            {(["all", "income", "expense"] as const).map((type) => (
              <button
                key={type}
                type="button"
                className={`btn chip ${historyType === type ? "active" : ""}`}
                onClick={() => setHistoryType(type)}
              >
                {type === "all" ? "Semua" : type === "income" ? "Income" : "Expense"}
              </button>
            ))}
          </div>
          <div className="form-row">
            {historyCategories.map((category) => (
              <button
                key={category}
                type="button"
                className={`btn chip ${historyCategory === category ? "active" : ""}`}
                onClick={() => setHistoryCategory(category)}
              >
                {category === "all" ? "Semua" : category}
              </button>
            ))}
          </div>
          <div className="list">
            {filteredTransactions.length === 0 && (
              <div className="helper-text">Belum ada transaksi.</div>
            )}
            {filteredTransactions.slice(0, 30).map((tx) => (
              <div key={tx.id} className="list-item">
                <div className="form-row" style={{ justifyContent: "space-between" }}>
                  <strong>{tx.category}</strong>
                  <span>{formatCurrency(tx.amount)}</span>
                </div>
                <div className="helper-text">
                  {new Date(tx.createdAt).toLocaleDateString("id-ID")} • {tx.type}
                </div>
              </div>
            ))}
          </div>
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
