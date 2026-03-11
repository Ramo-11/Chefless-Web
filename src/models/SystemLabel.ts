import mongoose, { Schema, Document, Types } from "mongoose";

export interface ISystemLabel extends Document {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  icon?: string;
  order: number;
}

const systemLabelSchema = new Schema<ISystemLabel>(
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
    icon: { type: String },
    order: {
      type: Number,
      required: true,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

const SystemLabel =
  (mongoose.models.SystemLabel as mongoose.Model<ISystemLabel>) ||
  mongoose.model<ISystemLabel>("SystemLabel", systemLabelSchema);

export default SystemLabel;
