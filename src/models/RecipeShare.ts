import mongoose, { Schema, Document, Types } from "mongoose";

export interface IRecipeShare extends Document {
  _id: Types.ObjectId;
  senderId: Types.ObjectId;
  recipientId: Types.ObjectId;
  recipeId: Types.ObjectId;
  message?: string;
  createdAt: Date;
}

const recipeShareSchema = new Schema<IRecipeShare>(
  {
    senderId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    recipientId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    recipeId: {
      type: Schema.Types.ObjectId,
      ref: "Recipe",
      required: true,
    },
    message: {
      type: String,
      maxlength: 500,
      trim: true,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

// For checking duplicate shares
recipeShareSchema.index({ senderId: 1, recipientId: 1, recipeId: 1 });

const RecipeShare =
  (mongoose.models.RecipeShare as mongoose.Model<IRecipeShare>) ||
  mongoose.model<IRecipeShare>("RecipeShare", recipeShareSchema);

export default RecipeShare;
