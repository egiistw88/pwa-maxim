"use client";

import { useEffect, useMemo, useState } from "react";
import { addWalletTx, createId, getWalletTx, type WalletTx } from "../lib/data";

export function WalletClient() {
  const [transactions, setTransactions] = useState<WalletTx[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    void loadTransactions();
  }, []);

  async function loadTransactions() {
    const data = await getWalletTx();
    setTransactions(data);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const type = String(formData.get("type") ?? "income");
    const amount = Number(formData.get("amount"));
    const category = String(formData.get("category") ?? "");
    const note = String(formData.get("note") ?? "");
    const createdAt = String(formData.get("createdAt") ?? "");

    if (!type || !category || !createdAt) {
      setStatus("Lengkapi data transaksi.");
      return;
    }
    if (Number.isNaN(amount)) {
      setStatus("Jumlah transaksi tidak valid.");
      return;
    }

    const tx: WalletTx = {
      id: createId(),
      createdAt: new Date(createdAt).toISOString(),
      type: type === "expense" ? "expense" : "income",
      amount,
      category,
      note: note || undefined
    };

    await addWalletTx(tx);
    event.currentTarget.reset();
    await loadTransactions();
    setStatus("Transaksi tersimpan.");
  }

  const summary = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    const startOfWeek = new Date(now);
    startOfWeek.setDate(startOfWeek.getDate() - 6);
    startOfWeek.setHours(0, 0, 0, 0);

    const todayTotals = sumTransactions(transactions, startOfToday);
    const weekTotals = sumTransactions(transactions, startOfWeek);

    return {
      today: todayTotals,
      week: weekTotals
    };
  }, [transactions]);

  return (
    <div className="grid" style={{ gap: 24 }}>
      <div className="card">
        <h2>Dompet Harian</h2>
        <p className="helper-text">
          Catat pemasukan dan pengeluaran. Data tersimpan offline di perangkat.
        </p>
      </div>

      <div className="card">
        <h3>Tambah Transaksi</h3>
        <form className="grid" onSubmit={handleSubmit}>
          <div className="form-row">
            <div>
              <label>Jenis</label>
              <select name="type" defaultValue="income" required>
                <option value="income">Pemasukan</option>
                <option value="expense">Pengeluaran</option>
              </select>
            </div>
            <div>
              <label>Jumlah (Rp)</label>
              <input type="number" name="amount" min="0" step="1000" required />
            </div>
            <div>
              <label>Kategori</label>
              <input type="text" name="category" placeholder="BBM, Makan, Servis" required />
            </div>
            <div>
              <label>Tanggal</label>
              <input
                type="date"
                name="createdAt"
                defaultValue={new Date().toISOString().slice(0, 10)}
                required
              />
            </div>
          </div>
          <div>
            <label>Catatan</label>
            <textarea name="note" rows={2} placeholder="Opsional" />
          </div>
          <div>
            <button type="submit">Simpan Transaksi</button>
          </div>
          {status && <div className="helper-text">{status}</div>}
        </form>
      </div>

      <div className="card grid three">
        <div>
          <h4>Hari Ini</h4>
          <p className="helper-text">Income: Rp {summary.today.income.toLocaleString("id-ID")}</p>
          <p className="helper-text">Expense: Rp {summary.today.expense.toLocaleString("id-ID")}</p>
          <p>
            <strong>Net: Rp {summary.today.net.toLocaleString("id-ID")}</strong>
          </p>
        </div>
        <div>
          <h4>7 Hari Terakhir</h4>
          <p className="helper-text">Income: Rp {summary.week.income.toLocaleString("id-ID")}</p>
          <p className="helper-text">Expense: Rp {summary.week.expense.toLocaleString("id-ID")}</p>
          <p>
            <strong>Net: Rp {summary.week.net.toLocaleString("id-ID")}</strong>
          </p>
        </div>
        <div>
          <h4>Transaksi Tersimpan</h4>
          <p className="helper-text">{transactions.length} item</p>
        </div>
      </div>

      <div className="card">
        <h3>Transaksi Terbaru</h3>
        <div className="list">
          {transactions.slice(0, 8).map((tx) => (
            <div key={tx.id} className="list-item">
              <div>
                <strong>
                  {tx.type === "income" ? "+" : "-"} Rp {tx.amount.toLocaleString("id-ID")}
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

function sumTransactions(transactions: WalletTx[], startDate: Date) {
  const totals = transactions.reduce(
    (acc, tx) => {
      const createdAt = new Date(tx.createdAt);
      if (createdAt < startDate) {
        return acc;
      }
      if (tx.type === "income") {
        acc.income += tx.amount;
      } else {
        acc.expense += tx.amount;
      }
      return acc;
    },
    { income: 0, expense: 0 }
  );

  return {
    ...totals,
    net: totals.income - totals.expense
  };
}
