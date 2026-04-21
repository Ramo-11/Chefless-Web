import mongoose, { Schema, Document, Types } from "mongoose";

export interface IKitchen extends Document {
  _id: Types.ObjectId;
  name: string;
  leadId: Types.ObjectId;
  inviteCode: string;
  /**
   * When the current `inviteCode` stops being accepted by `joinKitchen`.
   * Undefined for kitchens created before the expiry feature shipped
   * (grandfathered — treated as non-expiring). New kitchens and regenerated
   * codes always get a concrete expiry.
   */
  inviteCodeExpiresAt?: Date;
  photo?: string;
  isPublic: boolean;
  membersWithScheduleEdit: Types.ObjectId[];
  membersWithApprovalPower: Types.ObjectId[];
  memberCount: number;
  /** Custom meal slot names added by the kitchen lead (e.g. "Pre-Workout", "Late Night"). */
  customMealSlots: string[];
  /**
   * Controls who can add schedule entries directly.
   * - `"lead_only"`: only the lead and members in `membersWithScheduleEdit` add directly;
   *   everyone else's additions become suggestions awaiting approval.
   * - `"all"`: any kitchen member adds entries directly (confirmed).
   */
  scheduleAddPolicy: "lead_only" | "all";
  /**
   * Controls visibility of member ratings on recipes cooked through this kitchen.
   * - `"public"`: ratings feed the recipe's global `avgRating` and are visible to anyone.
   * - `"kitchen_only"`: ratings only power the kitchen's internal aggregate; the public stays at zero.
   * - `"off"`: rating prompts are disabled entirely for this kitchen.
   */
  ratingsVisibility: "public" | "kitchen_only" | "off";
  createdAt: Date;
  updatedAt: Date;
}

const kitchenSchema = new Schema<IKitchen>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    leadId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    inviteCode: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    inviteCodeExpiresAt: {
      type: Date,
    },
    photo: { type: String },
    isPublic: {
      type: Boolean,
      default: false,
      index: true,
    },
    membersWithScheduleEdit: [
      {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    membersWithApprovalPower: [
      {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    memberCount: {
      type: Number,
      default: 1,
      min: 0,
    },
    customMealSlots: {
      type: [String],
      default: [],
      validate: {
        validator: (v: string[]) => v.length <= 20,
        message: "Maximum 20 custom meal slots allowed",
      },
    },
    scheduleAddPolicy: {
      type: String,
      enum: ["lead_only", "all"],
      default: "lead_only",
    },
    ratingsVisibility: {
      type: String,
      enum: ["public", "kitchen_only", "off"],
      default: "kitchen_only",
    },
  },
  {
    timestamps: true,
  }
);

const Kitchen =
  (mongoose.models.Kitchen as mongoose.Model<IKitchen>) ||
  mongoose.model<IKitchen>("Kitchen", kitchenSchema);

export default Kitchen;
