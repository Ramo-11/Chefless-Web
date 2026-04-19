import mongoose, { Schema, Document, Types } from "mongoose";

export interface IBlock extends Document {
  _id: Types.ObjectId;
  blockerId: Types.ObjectId;
  blockedId: Types.ObjectId;
  createdAt: Date;
}

const blockSchema = new Schema<IBlock>(
  {
    blockerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    blockedId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

// Prevent duplicate block rows
blockSchema.index({ blockerId: 1, blockedId: 1 }, { unique: true });
// Separate indexes for filter lookups in either direction
blockSchema.index({ blockerId: 1 });
blockSchema.index({ blockedId: 1 });

const Block =
  (mongoose.models.Block as mongoose.Model<IBlock>) ||
  mongoose.model<IBlock>("Block", blockSchema);

export default Block;
