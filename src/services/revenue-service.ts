import User from "../models/User";
import Transaction, { ITransaction } from "../models/Transaction";

/**
 * Financial analytics for the admin revenue dashboard.
 *
 * Every money figure is USD, derived from `Transaction.priceUsd` (negative for
 * refunds), and PRODUCTION only. Sandbox transactions are excluded from the
 * figures and reported separately as a raw count. The dataset is small, so we
 * pull the production ledger once and compute in memory for readability.
 *
 * `getRevenueAnalytics` always returns a fully formed object, zeroed out when
 * the ledger is empty, so the UI can render an empty state without special
 * casing.
 */

export interface RevenueAnalytics {
  totals: {
    grossRevenue: number;
    refunds: number;
    netRevenue: number;
    storeCut: number;
    estimatedProceeds: number;
    transactionCount: number;
    refundCount: number;
  };
  byStore: {
    store: string;
    grossRevenue: number;
    storeCut: number;
    proceeds: number;
    transactionCount: number;
  }[];
  recurring: {
    mrr: number;
    arr: number;
    payingSubscribers: number;
    monthlySubscribers: number;
    annualSubscribers: number;
    adminGrants: number;
    arpu: number;
  };
  monthlyTrend: {
    month: string;
    gross: number;
    proceeds: number;
    transactions: number;
  }[];
  recentTransactions: {
    date: string;
    type: string;
    store: string;
    productId: string;
    priceUsd: number;
    currency: string;
    userName: string | null;
    userEmail: string | null;
  }[];
  sandboxCount: number;
  dataSince: string | null;
}

type LeanTransaction = Pick<
  ITransaction,
  | "eventId"
  | "eventType"
  | "appUserId"
  | "productId"
  | "store"
  | "environment"
  | "priceUsd"
  | "currency"
  | "takehomePercentage"
  | "commissionPercentage"
  | "purchasedAt"
  | "cancelReason"
>;

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** Display-ready store name from the raw RevenueCat store code. */
function storeDisplayName(store: string): string {
  switch (store) {
    case "APP_STORE":
    case "MAC_APP_STORE":
      return "App Store";
    case "PLAY_STORE":
      return "Play Store";
    case "STRIPE":
      return "Stripe";
    case "AMAZON":
      return "Amazon";
    case "PROMOTIONAL":
      return "Promotional";
    default:
      return store;
  }
}

/** Plan a transaction's product belongs to. Mirrors the webhook mapping. */
function planFromProductId(productId: string): "monthly" | "annual" {
  const id = productId.toLowerCase();
  if (id.includes("annual") || id.includes("yearly")) return "annual";
  return "monthly";
}

/**
 * Store's cut of a single transaction's USD price. Naturally negative for
 * refunds because `priceUsd` is negative. Prefers `takehomePercentage`, falls
 * back to `commissionPercentage`, then assumes a 15 percent store cut.
 */
function storeCutForTransaction(t: LeanTransaction): number {
  const price = t.priceUsd ?? 0;
  if (typeof t.takehomePercentage === "number") {
    return price * (1 - t.takehomePercentage);
  }
  if (typeof t.commissionPercentage === "number") {
    return price * t.commissionPercentage;
  }
  return price * 0.15;
}

/** Median of a numeric list. Returns 0 for an empty list. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Type label for the recent-transactions feed. */
function transactionTypeLabel(t: LeanTransaction): string {
  if ((t.priceUsd ?? 0) < 0) return "Refund";
  switch (t.eventType) {
    case "INITIAL_PURCHASE":
      return "Purchase";
    case "RENEWAL":
      return "Renewal";
    case "NON_RENEWING_PURCHASE":
      return "One-time";
    default:
      return t.eventType
        .toLowerCase()
        .split("_")
        .filter((w) => w.length > 0)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
  }
}

export async function getRevenueAnalytics(): Promise<RevenueAnalytics> {
  const [transactions, sandboxCount, payingSubscribers, adminGrants] =
    await Promise.all([
      Transaction.find({ environment: "PRODUCTION" })
        .sort({ purchasedAt: 1 })
        .lean<LeanTransaction[]>(),
      Transaction.countDocuments({ environment: "SANDBOX" }),
      User.find({
        isPremium: true,
        premiumPlan: { $in: ["monthly", "annual"] },
        $or: [
          { premiumExpiresAt: { $exists: false } },
          { premiumExpiresAt: null },
          { premiumExpiresAt: { $gt: new Date() } },
        ],
      })
        .select("firebaseUid premiumPlan")
        .lean<{ firebaseUid: string; premiumPlan: "monthly" | "annual" }[]>(),
      User.countDocuments({ isPremium: true, premiumPlan: "admin" }),
    ]);

  // Totals and per-store rollups in a single pass over the ledger.
  let grossRevenue = 0;
  let refunds = 0;
  let refundCount = 0;
  let totalStoreCut = 0;

  interface StoreAccumulator {
    grossRevenue: number;
    net: number;
    storeCut: number;
    transactionCount: number;
  }
  const storeAccumulators = new Map<string, StoreAccumulator>();

  for (const t of transactions) {
    const price = t.priceUsd ?? 0;
    const cut = storeCutForTransaction(t);

    if (price > 0) grossRevenue += price;
    else if (price < 0) {
      refunds += -price;
      refundCount += 1;
    }
    totalStoreCut += cut;

    const displayStore = storeDisplayName(t.store ?? "");
    const acc =
      storeAccumulators.get(displayStore) ??
      { grossRevenue: 0, net: 0, storeCut: 0, transactionCount: 0 };
    if (price > 0) acc.grossRevenue += price;
    acc.net += price;
    acc.storeCut += cut;
    acc.transactionCount += 1;
    storeAccumulators.set(displayStore, acc);
  }

  const netRevenue = grossRevenue - refunds;
  const estimatedProceeds = netRevenue - totalStoreCut;

  const byStore = [...storeAccumulators.entries()]
    .map(([store, acc]) => ({
      store,
      grossRevenue: acc.grossRevenue,
      storeCut: acc.storeCut,
      proceeds: acc.net - acc.storeCut,
      transactionCount: acc.transactionCount,
    }))
    .sort((a, b) => b.grossRevenue - a.grossRevenue);

  // Recurring revenue from the User collection, priced off the ledger.
  const latestPositivePriceByUser = new Map<string, number>();
  const positivePricesByPlan: { monthly: number[]; annual: number[] } = {
    monthly: [],
    annual: [],
  };
  for (const t of transactions) {
    const price = t.priceUsd ?? 0;
    if (price > 0) {
      // Ledger is sorted ascending, so later writes are the most recent.
      latestPositivePriceByUser.set(t.appUserId, price);
      positivePricesByPlan[planFromProductId(t.productId ?? "")].push(price);
    }
  }
  const medianPriceByPlan = {
    monthly: median(positivePricesByPlan.monthly),
    annual: median(positivePricesByPlan.annual),
  };

  let monthlySubscribers = 0;
  let annualSubscribers = 0;
  let mrr = 0;
  for (const sub of payingSubscribers) {
    if (sub.premiumPlan === "annual") annualSubscribers += 1;
    else monthlySubscribers += 1;

    const price =
      latestPositivePriceByUser.get(sub.firebaseUid) ??
      medianPriceByPlan[sub.premiumPlan];
    mrr += sub.premiumPlan === "annual" ? price / 12 : price;
  }
  const payingCount = payingSubscribers.length;
  const recurring = {
    mrr,
    arr: mrr * 12,
    payingSubscribers: payingCount,
    monthlySubscribers,
    annualSubscribers,
    adminGrants,
    arpu: payingCount > 0 ? mrr / payingCount : 0,
  };

  // Last 12 calendar months including the current one, oldest first.
  const now = new Date();
  interface MonthBucket {
    month: string;
    gross: number;
    net: number;
    storeCut: number;
    transactions: number;
  }
  const monthBuckets: MonthBucket[] = [];
  const monthIndexByKey = new Map<string, number>();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    monthIndexByKey.set(key, monthBuckets.length);
    monthBuckets.push({
      month: `${MONTH_LABELS[d.getMonth()]} ${d.getFullYear()}`,
      gross: 0,
      net: 0,
      storeCut: 0,
      transactions: 0,
    });
  }
  for (const t of transactions) {
    const d = new Date(t.purchasedAt);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    const idx = monthIndexByKey.get(key);
    if (idx === undefined) continue;
    const price = t.priceUsd ?? 0;
    if (price > 0) monthBuckets[idx].gross += price;
    monthBuckets[idx].net += price;
    monthBuckets[idx].storeCut += storeCutForTransaction(t);
    monthBuckets[idx].transactions += 1;
  }
  const monthlyTrend = monthBuckets.map((b) => ({
    month: b.month,
    gross: b.gross,
    proceeds: b.net - b.storeCut,
    transactions: b.transactions,
  }));

  // Newest 20 production transactions, with the purchaser joined in.
  const recent = [...transactions]
    .sort(
      (a, b) =>
        new Date(b.purchasedAt).getTime() - new Date(a.purchasedAt).getTime()
    )
    .slice(0, 20);
  const recentUserIds = [...new Set(recent.map((t) => t.appUserId))].filter(
    (id) => id.length > 0
  );
  const recentUsers = await User.find({ firebaseUid: { $in: recentUserIds } })
    .select("firebaseUid fullName email")
    .lean<{ firebaseUid: string; fullName?: string; email?: string }[]>();
  const userByUid = new Map(recentUsers.map((u) => [u.firebaseUid, u]));

  const recentTransactions = recent.map((t) => {
    const user = userByUid.get(t.appUserId);
    return {
      date: new Date(t.purchasedAt).toISOString(),
      type: transactionTypeLabel(t),
      store: storeDisplayName(t.store ?? ""),
      productId: t.productId ?? "",
      priceUsd: t.priceUsd ?? 0,
      currency: t.currency ?? "",
      userName: user?.fullName ?? null,
      userEmail: user?.email ?? null,
    };
  });

  const dataSince =
    transactions.length > 0
      ? new Date(transactions[0].purchasedAt).toISOString()
      : null;

  return {
    totals: {
      grossRevenue,
      refunds,
      netRevenue,
      storeCut: totalStoreCut,
      estimatedProceeds,
      transactionCount: transactions.length,
      refundCount,
    },
    byStore,
    recurring,
    monthlyTrend,
    recentTransactions,
    sandboxCount,
    dataSince,
  };
}
