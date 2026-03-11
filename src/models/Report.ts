import mongoose, { Schema, Document, Types } from "mongoose";

export type ReportTargetType = "recipe" | "user";
export type ReportReason =
  | "spam"
  | "inappropriate"
  | "copyright"
  | "harassment"
  | "other";
export type ReportStatus =
  | "pending"
  | "reviewed"
  | "dismissed"
  | "action_taken";

export interface IReport extends Document {
  _id: Types.ObjectId;
  reporterId: Types.ObjectId;
  targetType: ReportTargetType;
  targetId: Types.ObjectId;
  reason: ReportReason;
  description?: string;
  status: ReportStatus;
  reviewedBy?: Types.ObjectId;
  reviewNote?: string;
  createdAt: Date;
  updatedAt: Date;
}

const reportSchema = new Schema<IReport>(
  {
    reporterId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    targetType: {
      type: String,
      enum: ["recipe", "user"],
      required: true,
    },
    targetId: {
      type: Schema.Types.ObjectId,
      required: true,
    },
    reason: {
      type: String,
      enum: ["spam", "inappropriate", "copyright", "harassment", "other"],
      required: true,
    },
    description: {
      type: String,
      maxlength: 500,
      trim: true,
    },
    status: {
      type: String,
      enum: ["pending", "reviewed", "dismissed", "action_taken"],
      default: "pending",
    },
    reviewedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    reviewNote: {
      type: String,
      maxlength: 1000,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

// Prevent duplicate reports from same user on same target
reportSchema.index(
  { reporterId: 1, targetType: 1, targetId: 1 },
  { unique: true }
);

// For querying reports by status and recency
reportSchema.index({ status: 1, createdAt: -1 });

// For looking up all reports on a specific target
reportSchema.index({ targetType: 1, targetId: 1 });

const Report =
  (mongoose.models.Report as mongoose.Model<IReport>) ||
  mongoose.model<IReport>("Report", reportSchema);

export default Report;
