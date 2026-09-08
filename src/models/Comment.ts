import mongoose, { Schema, Document, Types } from "mongoose";

export type CommentTargetType = "recipe" | "cooked_post";

export interface IComment extends Document {
  _id: Types.ObjectId;
  targetType: CommentTargetType;
  targetId: Types.ObjectId;
  authorId: Types.ObjectId;
  parentId: Types.ObjectId | null;
  text: string;
  repliesCount: number;
  isDeleted: boolean;
  deletedAt: Date | null;
  reportsCount: number;
  isHidden: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const commentSchema = new Schema<IComment>(
  {
    targetType: {
      type: String,
      enum: ["recipe", "cooked_post"],
      required: true,
    },
    targetId: {
      type: Schema.Types.ObjectId,
      required: true,
    },
    authorId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    parentId: {
      type: Schema.Types.ObjectId,
      ref: "Comment",
      default: null,
    },
    text: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 1000,
    },
    repliesCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
    reportsCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    isHidden: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

commentSchema.index({ targetType: 1, targetId: 1, parentId: 1, _id: -1 });
commentSchema.index({ parentId: 1, _id: 1 });
commentSchema.index({ authorId: 1 });

const Comment =
  (mongoose.models.Comment as mongoose.Model<IComment>) ||
  mongoose.model<IComment>("Comment", commentSchema);

export default Comment;
