import mongoose, { Schema, Document, Types } from "mongoose";

/**
 * Idempotency ledger for inbound webhook events, claim-then-confirm.
 *
 * When a provider retries a webhook (network blip, timeout, etc.) we must not
 * re-apply the same mutation. Every webhook handler `create`s a row here
 * BEFORE processing (the claim) and stamps `processedAt` only AFTER the
 * mutation succeeds (the confirm). A duplicate-key error on `eventId` plus a
 * set `processedAt` means the event is fully done and the handler
 * short-circuits with 200 OK; a duplicate with no `processedAt` is a retry of
 * an attempt that failed mid-flight and must be reprocessed, so a transient
 * DB error can never permanently drop an entitlement change.
 *
 * Rows TTL after 90 days — long enough to cover provider replay windows, short
 * enough to keep the collection bounded.
 */
export interface IWebhookEvent extends Document {
  _id: Types.ObjectId;
  eventId: string;
  provider: string;
  receivedAt: Date;
  processedAt?: Date;
  payload: unknown;
}

const webhookEventSchema = new Schema<IWebhookEvent>(
  {
    eventId: { type: String, required: true, unique: true, index: true },
    provider: { type: String, required: true, index: true },
    receivedAt: { type: Date, default: Date.now },
    processedAt: { type: Date },
    payload: { type: Schema.Types.Mixed },
  },
  { versionKey: false }
);

// Auto-prune after 90 days — retries never happen this far out.
webhookEventSchema.index(
  { receivedAt: 1 },
  { expireAfterSeconds: 90 * 24 * 60 * 60 }
);

const WebhookEvent =
  (mongoose.models.WebhookEvent as mongoose.Model<IWebhookEvent>) ||
  mongoose.model<IWebhookEvent>("WebhookEvent", webhookEventSchema);

export default WebhookEvent;
