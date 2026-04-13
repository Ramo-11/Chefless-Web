import mongoose, { Schema, Document, Types } from "mongoose";

export interface IPromoCode extends Document {
  _id: Types.ObjectId;
  code: string;
  description: string;
  durationDays: number;
  maxRedemptions: number;
  redemptionCount: number;
  isActive: boolean;
  validFrom: Date;
  validUntil: Date;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface IPromoRedemption extends Document {
  _id: Types.ObjectId;
  promoCodeId: Types.ObjectId;
  userId: Types.ObjectId;
  redeemedAt: Date;
  premiumGrantedUntil: Date;
}

const promoCodeSchema = new Schema<IPromoCode>(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    durationDays: {
      type: Number,
      required: true,
      min: 1,
    },
    maxRedemptions: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    redemptionCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    validFrom: {
      type: Date,
      required: true,
    },
    validUntil: {
      type: Date,
      required: true,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "AdminUser",
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

const promoRedemptionSchema = new Schema<IPromoRedemption>(
  {
    promoCodeId: {
      type: Schema.Types.ObjectId,
      ref: "PromoCode",
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    redeemedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    premiumGrantedUntil: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: false,
  }
);

// Prevent double-redemption: one user can only redeem a specific code once
promoRedemptionSchema.index({ promoCodeId: 1, userId: 1 }, { unique: true });

export const PromoCode =
  (mongoose.models.PromoCode as mongoose.Model<IPromoCode>) ||
  mongoose.model<IPromoCode>("PromoCode", promoCodeSchema);

export const PromoRedemption =
  (mongoose.models.PromoRedemption as mongoose.Model<IPromoRedemption>) ||
  mongoose.model<IPromoRedemption>("PromoRedemption", promoRedemptionSchema);
