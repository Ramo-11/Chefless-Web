import mongoose, { Schema, Document, Types } from "mongoose";

export interface ICookbook extends Document {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  name: string;
  description?: string;
  coverPhoto?: string;
  recipeIds: Types.ObjectId[];
  isPrivate: boolean;
  recipesCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const cookbookSchema = new Schema<ICookbook>(
  {
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    coverPhoto: {
      type: String,
      trim: true,
    },
    recipeIds: {
      type: [{ type: Schema.Types.ObjectId, ref: "Recipe" }],
      default: [],
    },
    isPrivate: {
      type: Boolean,
      default: false,
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

cookbookSchema.index({ ownerId: 1, isPrivate: 1, createdAt: -1 });
cookbookSchema.index({ recipeIds: 1 });

const Cookbook =
  (mongoose.models.Cookbook as mongoose.Model<ICookbook>) ||
  mongoose.model<ICookbook>("Cookbook", cookbookSchema);

export default Cookbook;
