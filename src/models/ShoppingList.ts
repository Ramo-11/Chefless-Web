import mongoose, { Schema, Document, Types } from "mongoose";

export interface IShoppingListItem {
  _id: Types.ObjectId;
  name: string;
  quantity?: number;
  unit?: string;
  recipeId?: Types.ObjectId;
  isChecked: boolean;
  addedBy?: Types.ObjectId;
  category?: string;
  notes?: string;
  imageUrl?: string;
}

export interface IShoppingList extends Document {
  _id: Types.ObjectId;
  kitchenId?: Types.ObjectId;
  userId?: Types.ObjectId;
  name?: string;
  items: IShoppingListItem[];
  generatedFromSchedule: boolean;
  scheduleStartDate?: Date;
  scheduleEndDate?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const shoppingListItemSchema = new Schema<IShoppingListItem>({
  name: { type: String, required: true, trim: true },
  quantity: { type: Number, min: 0 },
  unit: { type: String, trim: true },
  recipeId: { type: Schema.Types.ObjectId, ref: "Recipe" },
  isChecked: { type: Boolean, default: false },
  addedBy: { type: Schema.Types.ObjectId, ref: "User" },
  category: { type: String, trim: true },
  notes: { type: String, trim: true, maxlength: 500 },
  imageUrl: { type: String },
});

const shoppingListSchema = new Schema<IShoppingList>(
  {
    kitchenId: {
      type: Schema.Types.ObjectId,
      ref: "Kitchen",
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },
    name: {
      type: String,
      trim: true,
      maxlength: 200,
    },
    items: {
      type: [shoppingListItemSchema],
      default: [],
    },
    generatedFromSchedule: {
      type: Boolean,
      default: false,
    },
    scheduleStartDate: { type: Date },
    scheduleEndDate: { type: Date },
  },
  {
    timestamps: true,
  }
);

// Compound indexes for efficient lookups sorted by last update
shoppingListSchema.index({ kitchenId: 1, updatedAt: -1 });
shoppingListSchema.index({ userId: 1, updatedAt: -1 });

const ShoppingList =
  (mongoose.models.ShoppingList as mongoose.Model<IShoppingList>) ||
  mongoose.model<IShoppingList>("ShoppingList", shoppingListSchema);

export default ShoppingList;
