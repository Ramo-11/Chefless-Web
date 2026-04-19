import mongoose, { Schema, Document, Types } from "mongoose";

/**
 * Idempotency ledger for inbound webhook events.
 *
 * When a provider retries a webhook (network blip, timeout, etc.) we must not
 * re-apply the same mutation. Every webhook handler tries to `create` a row
 * here first; a duplicate-key error on `eventId` means the event has already
 * been processed and the handler should short-circuit with 200 OK.
 *
 * Rows TTL after 90 days — long enough to cover provider replay windows, short
 * enough to keep the collection bounded.
 */
export interface IWebhookEvent extends Document {
  _id: Types.ObjectId;
  eventId: string;
  provider: string;
  receivedAt: Date;
  payload: unknown;
}

const webhookEventSchema = new Schema<IWebhookEvent>(
  {
    eventId: { type: String, required: true, unique: true, index: true },
    provider: { type: String, required: true, index: true },
    receivedAt: { type: Date, default: Date.now },
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
