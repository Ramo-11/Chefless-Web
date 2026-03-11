import mongoose, { Schema, Document, Types } from "mongoose";

export interface ShippingAddress {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
}

export interface IUser extends Document {
  _id: Types.ObjectId;
  firebaseUid: string;
  email: string;
  fullName: string;
  phone?: string;
  profilePicture?: string;
  signature?: string;
  bio?: string;
  isPublic: boolean;
  followersCount: number;
  followingCount: number;
  recipesCount: number;
  kitchenId?: Types.ObjectId;
  isPremium: boolean;
  premiumPlan?: "monthly" | "annual";
  premiumExpiresAt?: Date;
  chefHatShipped?: boolean;
  shippingAddress?: ShippingAddress;
  dietaryPreferences?: string[];
  cuisinePreferences?: string[];
  onboardingComplete: boolean;
  fcmToken?: string;
  isAdmin: boolean;
  isBanned: boolean;
  banReason?: string;
  bannedAt?: Date;
  lastActiveAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const shippingAddressSchema = new Schema<ShippingAddress>(
  {
    line1: { type: String, required: true },
    line2: { type: String },
    city: { type: String, required: true },
    state: { type: String, required: true },
    zip: { type: String, required: true },
    country: { type: String, required: true },
  },
  { _id: false }
);

const userSchema = new Schema<IUser>(
  {
    firebaseUid: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    fullName: {
      type: String,
      required: true,
      trim: true,
    },
    phone: { type: String },
    profilePicture: { type: String },
    signature: { type: String },
    bio: {
      type: String,
      maxlength: 150,
    },
    isPublic: {
      type: Boolean,
      default: true,
      index: true,
    },
    followersCount: {
      type: Number,
      default: 0,
    },
    followingCount: {
      type: Number,
      default: 0,
    },
    recipesCount: {
      type: Number,
      default: 0,
    },
    kitchenId: {
      type: Schema.Types.ObjectId,
      ref: "Kitchen",
      index: true,
    },
    isPremium: {
      type: Boolean,
      default: false,
    },
    premiumPlan: {
      type: String,
      enum: ["monthly", "annual"],
    },
    premiumExpiresAt: { type: Date },
    chefHatShipped: { type: Boolean },
    shippingAddress: { type: shippingAddressSchema },
    dietaryPreferences: [{ type: String }],
    cuisinePreferences: [{ type: String }],
    onboardingComplete: {
      type: Boolean,
      default: false,
    },
    fcmToken: { type: String },
    isAdmin: {
      type: Boolean,
      default: false,
    },
    isBanned: {
      type: Boolean,
      default: false,
    },
    banReason: { type: String },
    bannedAt: { type: Date },
    lastActiveAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Text index for search by name
userSchema.index({ fullName: "text" });

const User = (mongoose.models.User as mongoose.Model<IUser>) ||
  mongoose.model<IUser>("User", userSchema);

export default User;
