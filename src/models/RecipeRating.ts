import mongoose, { Schema, Document, Types } from "mongoose";

/**
 * A single user's rating of a recipe, produced after they mark a scheduled
 * meal as cooked. Ratings are 1–5 stars with an optional private note.
 *
 * A user has at most one rating per recipe (enforced by a unique compound
 * index); re-rating the same recipe updates the existing row instead of
 * inserting. `kitchenId` is recorded at the time of rating so aggregate
 * queries can scope to "ratings from members of this kitchen" even if a
 * rater later leaves the kitchen.
 */
export interface IRecipeRating extends Document {
  _id: Types.ObjectId;
  recipeId: Types.ObjectId;
  userId: Types.ObjectId;
  /** The kitchen the rater belonged to at rating time; null for solo cooks. */
  kitchenId?: Types.ObjectId | null;
  stars: number;
  note?: string;
  /** The schedule entry that triggered this rating (if any). */
  scheduleEntryId?: Types.ObjectId | null;
  cookedAt: Date;
  ratedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const recipeRatingSchema = new Schema<IRecipeRating>(
  {
    recipeId: {
      type: Schema.Types.ObjectId,
      ref: "Recipe",
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    kitchenId: {
      type: Schema.Types.ObjectId,
      ref: "Kitchen",
      default: null,
    },
    stars: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    note: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    scheduleEntryId: {
      type: Schema.Types.ObjectId,
      ref: "ScheduleEntry",
      default: null,
    },
    cookedAt: {
      type: Date,
      required: true,
      default: () => new Date(),
    },
    ratedAt: {
      type: Date,
      required: true,
      default: () => new Date(),
    },
  },
  { timestamps: true }
);

// One rating per user per recipe — enforced at the DB layer so a concurrent
// double-submit can't produce two rows.
recipeRatingSchema.index({ recipeId: 1, userId: 1 }, { unique: true });

// For kitchen-scoped aggregation (when visibility is "kitchen_only").
recipeRatingSchema.index({ recipeId: 1, kitchenId: 1 });

const RecipeRating =
  (mongoose.models.RecipeRating as mongoose.Model<IRecipeRating>) ||
  mongoose.model<IRecipeRating>("RecipeRating", recipeRatingSchema);

export default RecipeRating;
