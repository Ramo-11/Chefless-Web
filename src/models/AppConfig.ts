import mongoose, { Schema, Document, Types } from "mongoose";

/**
 * Global runtime config for the Chefless app. Singleton document keyed by
 * `key: "global"`. Add fields here when you need an admin-controlled toggle
 * that the mobile app should react to without shipping a new build.
 */
export interface IAppConfig extends Document {
  _id: Types.ObjectId;
  key: "global";
  wrappedEnabled: boolean;
  // Which calendar year users should see their Wrapped for when enabled.
  // Null falls back to the current UTC year on read.
  wrappedYear: number | null;
  // Monotonically increasing per-year. Admin bumps this to re-trigger the
  // auto-launch for users who've already seen the drop — typically used at
  // broadcast time so prior testers experience the launch alongside
  // everyone else. Default 0; first bump → 1, etc.
  wrappedRevision: number;
  // Per-user override. Users in this list get Wrapped (auto-launch + tile
  // + data endpoint) regardless of the global flag, so admin can verify
  // the experience end-to-end before flipping it on for everyone.
  wrappedTestUserIds: Types.ObjectId[];
  updatedAt: Date;
  createdAt: Date;
}

const appConfigSchema = new Schema<IAppConfig>(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      enum: ["global"],
    },
    wrappedEnabled: {
      type: Boolean,
      default: false,
    },
    wrappedYear: {
      type: Number,
      default: null,
    },
    wrappedRevision: {
      type: Number,
      default: 0,
    },
    wrappedTestUserIds: {
      type: [Schema.Types.ObjectId],
      ref: "User",
      default: [],
    },
  },
  { timestamps: true }
);

const AppConfig =
  (mongoose.models.AppConfig as mongoose.Model<IAppConfig>) ||
  mongoose.model<IAppConfig>("AppConfig", appConfigSchema);

export default AppConfig;
