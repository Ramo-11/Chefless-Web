import mongoose, { Schema, Document, Types } from "mongoose";

export interface IKitchen extends Document {
  _id: Types.ObjectId;
  name: string;
  leadId: Types.ObjectId;
  inviteCode: string;
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
  },
  {
    timestamps: true,
  }
);

const Kitchen =
  (mongoose.models.Kitchen as mongoose.Model<IKitchen>) ||
  mongoose.model<IKitchen>("Kitchen", kitchenSchema);

export default Kitchen;
