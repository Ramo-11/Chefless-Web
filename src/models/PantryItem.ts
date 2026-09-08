import mongoose, { Schema, Document, Types } from "mongoose";

export interface IPantryItem extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  name: string;
  normalizedName: string;
  quantity?: number;
  unit?: string;
  category: string;
  createdAt: Date;
  updatedAt: Date;
}

const pantryItemSchema = new Schema<IPantryItem>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 80,
    },
    normalizedName: {
      type: String,
      required: true,
      index: true,
    },
    quantity: {
      type: Number,
      min: 0,
    },
    unit: {
      type: String,
      trim: true,
      maxlength: 20,
    },
    category: {
      type: String,
      required: true,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

pantryItemSchema.index({ userId: 1, normalizedName: 1 }, { unique: true });
pantryItemSchema.index({ userId: 1, category: 1, name: 1 });

const PantryItem =
  (mongoose.models.PantryItem as mongoose.Model<IPantryItem>) ||
  mongoose.model<IPantryItem>("PantryItem", pantryItemSchema);

export default PantryItem;
