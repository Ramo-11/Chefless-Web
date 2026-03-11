import mongoose, { Schema, Document, Types } from "mongoose";

export interface ILike extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  recipeId: Types.ObjectId;
  createdAt: Date;
}

const likeSchema = new Schema<ILike>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    recipeId: {
      type: Schema.Types.ObjectId,
      ref: "Recipe",
      required: true,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

// Unique compound: a user can only like a recipe once
likeSchema.index({ userId: 1, recipeId: 1 }, { unique: true });

// For querying all likes on a recipe
likeSchema.index({ recipeId: 1 });

const Like =
  (mongoose.models.Like as mongoose.Model<ILike>) ||
  mongoose.model<ILike>("Like", likeSchema);

export default Like;
