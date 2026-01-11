import type { WalletTx } from "./db";

function toEpoch(value: string | number | Date) {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === "number") {
    return value;
  }
  return new Date(value).getTime();
}

export type CategorySummary = {
  category: string;
  amount: number;
};

export type SummaryTotals = {
  income: number;
  expense: number;
  net: number;
};

export type DailySummary = SummaryTotals & {
  topExpenseCategory: CategorySummary | null;
  byCategory: CategorySummary[];
};

export type RangeSummary = SummaryTotals & {
  byCategory: CategorySummary[];
  from: Date;
  to: Date;
};

export function sumByCategory(
  txs: WalletTx[],
  {
    type,
    from,
    to
  }: {
    type: "income" | "expense";
    from: Date;
    to: Date;
  }
): CategorySummary[] {
  const totals: Record<string, number> = {};
  for (const tx of txs) {
    if (tx.type !== type) {
      continue;
    }
    const createdAtMs = toEpoch(tx.createdAt);
    if (createdAtMs < from.getTime() || createdAtMs > to.getTime()) {
      continue;
    }
    totals[tx.category] = (totals[tx.category] ?? 0) + tx.amount;
  }

  return Object.entries(totals)
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);
}

export function dailySummary(txs: WalletTx[], date: Date): DailySummary {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);

  const totals = summarizeTotals(txs, start, end);
  const byCategory = sumByCategory(txs, { type: "expense", from: start, to: end });

  return {
    ...totals,
    byCategory,
    topExpenseCategory: byCategory[0] ?? null
  };
}

export function rangeSummary(txs: WalletTx[], days: number): RangeSummary {
  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - Math.max(days - 1, 0));
  from.setHours(0, 0, 0, 0);

  const totals = summarizeTotals(txs, from, now);
  const byCategory = sumByCategory(txs, { type: "expense", from, to: now });

  return {
    ...totals,
    byCategory,
    from,
    to: now
  };
}

function summarizeTotals(txs: WalletTx[], from: Date, to: Date): SummaryTotals {
  const totals = txs.reduce(
    (acc, tx) => {
      const createdAtMs = toEpoch(tx.createdAt);
      if (createdAtMs < from.getTime() || createdAtMs > to.getTime()) {
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
