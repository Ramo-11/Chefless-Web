import mongoose, { Schema, Document, Types } from "mongoose";

/**
 * A user's proof-of-cook post for a recipe: a photo of what they actually made,
 * an optional caption, and the recipe's cuisine tags captured at post-time.
 *
 * Cuisine tags are snapshotted here (rather than resolved through Recipe at
 * read time) so the passport stamp map remains stable even if the recipe is
 * later edited or deleted. Tags align with Taste-the-World markers by cuisine
 * adjective (e.g. "Lebanese", "Italian").
 */
export interface ICookedPost extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  recipeId: Types.ObjectId | null;
  /** Recipe title at post time — preserved when the recipe is deleted. */
  recipeTitle: string;
  /** Recipe author at post time — preserved when the recipe is deleted. */
  recipeAuthorId: Types.ObjectId | null;
  photoUrl: string;
  caption?: string;
  /**
   * Snapshot of the recipe's cuisine tags at post time. Drives passport stamps
   * and regional-completion progress. Empty array if the recipe had no cuisines.
   */
  cuisineTags: string[];
  createdAt: Date;
  updatedAt: Date;
}

const cookedPostSchema = new Schema<ICookedPost>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    recipeId: {
      type: Schema.Types.ObjectId,
      ref: "Recipe",
      default: null,
      index: true,
    },
    recipeTitle: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    recipeAuthorId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    photoUrl: {
      type: String,
      required: true,
      trim: true,
    },
    caption: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    cuisineTags: {
      type: [String],
      default: [],
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Gallery feed per recipe: newest first.
cookedPostSchema.index({ recipeId: 1, createdAt: -1 });

// User's own "I Cooked It" feed on profile + Wrapped aggregation.
cookedPostSchema.index({ userId: 1, createdAt: -1 });

const CookedPost =
  (mongoose.models.CookedPost as mongoose.Model<ICookedPost>) ||
  mongoose.model<ICookedPost>("CookedPost", cookedPostSchema);

export default CookedPost;
