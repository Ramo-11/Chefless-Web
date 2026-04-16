import mongoose, { Schema, Document, Types } from "mongoose";

export interface IIngredient {
  name: string;
  quantity: number;
  unit: string;
  group?: string;
}

export interface IStep {
  order: number;
  instruction: string;
  photo?: string;
}

export interface IForkedFrom {
  recipeId: Types.ObjectId;
  authorId: Types.ObjectId;
  authorName: string;
}

export interface IRecipe extends Document {
  _id: Types.ObjectId;
  authorId: Types.ObjectId;
  title: string;
  description?: string;
  story?: string;
  photos: string[];
  showSignature: boolean;
  labels: string[];
  dietaryTags: string[];
  cuisineTags: string[];
  tags: string[];
  difficulty?: "easy" | "medium" | "hard";
  ingredients: IIngredient[];
  steps: IStep[];
  prepTime?: number;
  cookTime?: number;
  totalTime?: number;
  servings?: number;
  calories?: number;
  costEstimate?: "budget" | "moderate" | "expensive";
  baseServings: number;
  forkedFrom?: IForkedFrom;
  isModifiedFork: boolean;
  isPrivate: boolean;
  isHidden: boolean;
  reportsCount: number;
  seasonalTags: string[];
  likesCount: number;
  forksCount: number;
  isFeatured: boolean;
  featuredAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ingredientSchema = new Schema<IIngredient>(
  {
    name: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true },
    unit: { type: String, required: true, trim: true },
    group: { type: String, trim: true },
  },
  { _id: false }
);

const stepSchema = new Schema<IStep>(
  {
    order: { type: Number, required: true },
    instruction: { type: String, required: true },
    photo: { type: String },
  },
  { _id: false }
);

const forkedFromSchema = new Schema<IForkedFrom>(
  {
    recipeId: {
      type: Schema.Types.ObjectId,
      ref: "Recipe",
      required: true,
    },
    authorId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    authorName: { type: String, required: true },
  },
  { _id: false }
);

const recipeSchema = new Schema<IRecipe>(
  {
    authorId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 2000,
    },
    story: {
      type: String,
      trim: true,
      maxlength: 5000,
    },
    photos: {
      type: [String],
      default: [],
      validate: {
        validator: (val: string[]) => val.length <= 5,
        message: "Maximum 5 photos allowed",
      },
    },
    showSignature: {
      type: Boolean,
      default: false,
    },
    labels: {
      type: [String],
      default: [],
      index: true,
    },
    dietaryTags: {
      type: [String],
      default: [],
      index: true,
    },
    cuisineTags: {
      type: [String],
      default: [],
      index: true,
    },
    tags: {
      type: [String],
      default: [],
      index: true,
    },
    difficulty: {
      type: String,
      enum: ["easy", "medium", "hard"],
    },
    ingredients: {
      type: [ingredientSchema],
      default: [],
    },
    steps: {
      type: [stepSchema],
      default: [],
    },
    prepTime: { type: Number, min: 0 },
    cookTime: { type: Number, min: 0 },
    totalTime: { type: Number, min: 0 },
    servings: { type: Number, min: 1 },
    calories: { type: Number, min: 0 },
    costEstimate: {
      type: String,
      enum: ["budget", "moderate", "expensive"],
    },
    baseServings: {
      type: Number,
      required: true,
      default: 1,
      min: 1,
    },
    forkedFrom: {
      type: forkedFromSchema,
    },
    isModifiedFork: {
      type: Boolean,
      default: false,
    },
    isPrivate: {
      type: Boolean,
      default: false,
    },
    isHidden: {
      type: Boolean,
      default: false,
    },
    reportsCount: {
      type: Number,
      default: 0,
    },
    seasonalTags: {
      type: [String],
      default: [],
    },
    likesCount: {
      type: Number,
      default: 0,
    },
    forksCount: {
      type: Number,
      default: 0,
    },
    isFeatured: {
      type: Boolean,
      default: false,
      index: true,
    },
    featuredAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for filtering author's recipes by privacy
recipeSchema.index({ authorId: 1, isPrivate: 1 });

// For querying forks of a recipe
recipeSchema.index({ "forkedFrom.recipeId": 1 });

// For sorting by popularity
recipeSchema.index({ likesCount: -1 });

// For sorting by recency
recipeSchema.index({ createdAt: -1 });

// Text index for search
recipeSchema.index({ title: "text", "ingredients.name": "text" });

// Partial index for fast lookup of the currently featured recipe
recipeSchema.index(
  { isFeatured: 1 },
  { partialFilterExpression: { isFeatured: true } }
);

const Recipe =
  (mongoose.models.Recipe as mongoose.Model<IRecipe>) ||
  mongoose.model<IRecipe>("Recipe", recipeSchema);

export default Recipe;
