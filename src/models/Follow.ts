import mongoose, { Schema, Document, Types } from "mongoose";

export interface IFollow extends Document {
  _id: Types.ObjectId;
  followerId: Types.ObjectId;
  followingId: Types.ObjectId;
  status: "active" | "pending";
  createdAt: Date;
}

const followSchema = new Schema<IFollow>(
  {
    followerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    followingId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    status: {
      type: String,
      enum: ["active", "pending"],
      required: true,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

// Unique compound index: a user can only follow another user once
followSchema.index({ followerId: 1, followingId: 1 }, { unique: true });

// For looking up followers of a user filtered by status
followSchema.index({ followingId: 1, status: 1 });

// For looking up who a user is following
followSchema.index({ followerId: 1 });

const Follow =
  (mongoose.models.Follow as mongoose.Model<IFollow>) ||
  mongoose.model<IFollow>("Follow", followSchema);

export default Follow;
