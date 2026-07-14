import mongoose, { Schema, Document, Types } from "mongoose";

/**
 * Permanent financial ledger, one row per money-moving RevenueCat event.
 *
 * Unlike WebhookEvent (which TTLs after 90 days and exists only for
 * idempotency), this collection is never pruned: it is the source of truth for
 * revenue analytics. Rows are derived from the RevenueCat webhook payload and
 * are also rebuildable from the WebhookEvent history via
 * `scripts/backfill-transactions.ts`.
 *
 * `eventId` matches the WebhookEvent `eventId` (RevenueCat event id, or a
 * payload hash when RevenueCat omits one), so recording is idempotent and the
 * backfill never duplicates a row.
 *
 * `priceUsd` is the USD figure from RevenueCat and is negative for refunds.
 */
export interface ITransaction extends Document {
  _id: Types.ObjectId;
  eventId: string;
  eventType: string;
  appUserId: string;
  productId: string;
  store: string;
  environment: string;
  periodType?: string;
  renewalNumber?: number;
  priceUsd: number;
  priceInPurchasedCurrency?: number;
  currency?: string;
  takehomePercentage?: number;
  taxPercentage?: number;
  commissionPercentage?: number;
  purchasedAt: Date;
  cancelReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Fields written to a Transaction row, minus the Mongo/timestamp bookkeeping.
 * `buildTransactionInput` produces this and both the webhook and the backfill
 * script insert it, so the two paths can never drift.
 */
export type TransactionInput = Omit<
  ITransaction,
  "_id" | "createdAt" | "updatedAt" | keyof Document
>;

const transactionSchema = new Schema<ITransaction>(
  {
    eventId: { type: String, required: true, unique: true, index: true },
    eventType: { type: String, required: true },
    appUserId: { type: String, index: true },
    productId: { type: String },
    store: { type: String },
    environment: { type: String },
    periodType: { type: String },
    renewalNumber: { type: Number },
    priceUsd: { type: Number, required: true },
    priceInPurchasedCurrency: { type: Number },
    currency: { type: String },
    takehomePercentage: { type: Number },
    taxPercentage: { type: Number },
    commissionPercentage: { type: Number },
    purchasedAt: { type: Date, required: true, index: true },
    cancelReason: { type: String },
  },
  { timestamps: true }
);

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Maps a raw RevenueCat event object to a Transaction row, or returns null when
 * the event should not be recorded.
 *
 * We record an event when it moves money: any nonzero USD price, plus the two
 * refund-relevant shapes that can carry an absent/zero price (a CUSTOMER_SUPPORT
 * CANCELLATION, which is how RevenueCat represents a refund, and REFUND_REVERSED).
 * Zero-price voluntary cancellations (auto-renew turned off, cancel_reason
 * UNSUBSCRIBE) and EXPIRATION events carry no money and are skipped.
 *
 * `eventId` is passed in by the caller so it stays identical to the WebhookEvent
 * eventId used for idempotency.
 */
export function buildTransactionInput(
  eventId: string,
  rawEvent: unknown
): TransactionInput | null {
  const event =
    rawEvent && typeof rawEvent === "object"
      ? (rawEvent as Record<string, unknown>)
      : {};

  const eventType = asString(event.type) ?? "";
  const price = asNumber(event.price);
  const cancelReason = asString(event.cancel_reason);

  const hasNonzeroPrice = price !== undefined && price !== 0;
  const isRefundCancellation =
    eventType === "CANCELLATION" && cancelReason === "CUSTOMER_SUPPORT";
  const isRefundReversed = eventType === "REFUND_REVERSED";

  if (!hasNonzeroPrice && !isRefundCancellation && !isRefundReversed) {
    return null;
  }

  const purchasedAtMs =
    asNumber(event.purchased_at_ms) ?? asNumber(event.event_timestamp_ms);

  return {
    eventId,
    eventType,
    appUserId: asString(event.app_user_id) ?? "",
    productId: asString(event.product_id) ?? "",
    store: asString(event.store) ?? "",
    environment: asString(event.environment) ?? "",
    periodType: asString(event.period_type),
    renewalNumber: asNumber(event.renewal_number),
    priceUsd: price ?? 0,
    priceInPurchasedCurrency: asNumber(event.price_in_purchased_currency),
    currency: asString(event.currency),
    takehomePercentage: asNumber(event.takehome_percentage),
    taxPercentage: asNumber(event.tax_percentage),
    commissionPercentage: asNumber(event.commission_percentage),
    purchasedAt:
      purchasedAtMs !== undefined ? new Date(purchasedAtMs) : new Date(),
    cancelReason,
  };
}

const Transaction =
  (mongoose.models.Transaction as mongoose.Model<ITransaction>) ||
  mongoose.model<ITransaction>("Transaction", transactionSchema);

export default Transaction;
