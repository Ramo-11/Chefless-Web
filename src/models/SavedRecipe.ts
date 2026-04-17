import mongoose, { Schema, Document, Types } from "mongoose";

export interface ISavedRecipe extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  recipeId: Types.ObjectId;
  createdAt: Date;
}

const savedRecipeSchema = new Schema<ISavedRecipe>(
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

savedRecipeSchema.index({ userId: 1, recipeId: 1 }, { unique: true });
savedRecipeSchema.index({ recipeId: 1 });
savedRecipeSchema.index({ userId: 1, createdAt: -1 });

const SavedRecipe =
  (mongoose.models.SavedRecipe as mongoose.Model<ISavedRecipe>) ||
  mongoose.model<ISavedRecipe>("SavedRecipe", savedRecipeSchema);

export default SavedRecipe;
