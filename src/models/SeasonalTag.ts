import mongoose, { Schema, Document, Types } from "mongoose";

export interface ISeasonalTag extends Document {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  startDate: Date;
  endDate: Date;
  isActive: boolean;
  recipesCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const seasonalTagSchema = new Schema<ISeasonalTag>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    startDate: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    recipesCount: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

seasonalTagSchema.index({ isActive: 1, startDate: 1, endDate: 1 });

const SeasonalTag =
  (mongoose.models.SeasonalTag as mongoose.Model<ISeasonalTag>) ||
  mongoose.model<ISeasonalTag>("SeasonalTag", seasonalTagSchema);

export default SeasonalTag;
