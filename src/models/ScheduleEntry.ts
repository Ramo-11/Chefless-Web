import mongoose, { Schema, Document, Types } from "mongoose";

export interface IScheduleEntry extends Document {
  _id: Types.ObjectId;
  kitchenId: Types.ObjectId;
  date: Date;
  mealSlot: string;
  recipeId?: Types.ObjectId;
  recipeTitle?: string;
  recipePhoto?: string;
  recipeAuthorId?: Types.ObjectId;
  recipeAuthorName?: string;
  freeformText?: string;
  status: "confirmed" | "suggested";
  suggestedBy?: Types.ObjectId;
  confirmedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const scheduleEntrySchema = new Schema<IScheduleEntry>(
  {
    kitchenId: {
      type: Schema.Types.ObjectId,
      ref: "Kitchen",
      required: true,
    },
    date: {
      type: Date,
      required: true,
    },
    mealSlot: {
      type: String,
      required: true,
      trim: true,
      maxlength: 50,
    },
    recipeId: {
      type: Schema.Types.ObjectId,
      ref: "Recipe",
    },
    recipeTitle: { type: String, trim: true },
    recipePhoto: { type: String },
    recipeAuthorId: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    recipeAuthorName: { type: String, trim: true },
    freeformText: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    status: {
      type: String,
      enum: ["confirmed", "suggested"],
      required: true,
      default: "suggested",
    },
    suggestedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    confirmedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for querying entries by kitchen and date range
scheduleEntrySchema.index({ kitchenId: 1, date: 1 });

// For querying pending suggestions by kitchen
scheduleEntrySchema.index({ kitchenId: 1, status: 1 });

// For querying suggestions by user
scheduleEntrySchema.index({ suggestedBy: 1 });

const ScheduleEntry =
  (mongoose.models.ScheduleEntry as mongoose.Model<IScheduleEntry>) ||
  mongoose.model<IScheduleEntry>("ScheduleEntry", scheduleEntrySchema);

export default ScheduleEntry;
