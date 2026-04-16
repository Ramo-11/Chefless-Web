import mongoose, { Schema, Document, Types } from "mongoose";

export const KITCHEN_INVITE_STATUSES = [
  "pending",
  "accepted",
  "declined",
] as const;

export type KitchenInviteStatus = (typeof KITCHEN_INVITE_STATUSES)[number];

export interface IKitchenInvite extends Document {
  _id: Types.ObjectId;
  kitchenId: Types.ObjectId;
  /** Denormalised kitchen name at send-time, so the recipient always sees a
   *  readable label even if the kitchen is later renamed or deleted. */
  kitchenName: string;
  senderId: Types.ObjectId;
  recipientId: Types.ObjectId;
  status: KitchenInviteStatus;
  createdAt: Date;
  updatedAt: Date;
}

const kitchenInviteSchema = new Schema<IKitchenInvite>(
  {
    kitchenId: {
      type: Schema.Types.ObjectId,
      ref: "Kitchen",
      required: true,
    },
    kitchenName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    senderId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    recipientId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    status: {
      type: String,
      enum: KITCHEN_INVITE_STATUSES,
      default: "pending",
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// Fast lookups for the recipient's inbox and the sender's outbox.
kitchenInviteSchema.index({ recipientId: 1, status: 1 });
kitchenInviteSchema.index({ senderId: 1, status: 1 });

// Prevent duplicate *pending* invites for the same recipient in the same
// kitchen. Accepted/declined rows are free to coexist so history is preserved.
kitchenInviteSchema.index(
  { kitchenId: 1, recipientId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "pending" },
  }
);

// TTL: auto-delete accepted/declined invites after 60 days so history is kept
// briefly for audit/debug, then cleaned up. Pending invites never expire —
// the partial filter ensures only resolved rows are touched.
kitchenInviteSchema.index(
  { updatedAt: 1 },
  {
    expireAfterSeconds: 60 * 24 * 60 * 60,
    partialFilterExpression: {
      status: { $in: ["accepted", "declined"] },
    },
  }
);

const KitchenInvite =
  (mongoose.models.KitchenInvite as mongoose.Model<IKitchenInvite>) ||
  mongoose.model<IKitchenInvite>("KitchenInvite", kitchenInviteSchema);

export default KitchenInvite;
