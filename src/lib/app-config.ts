import { Types } from "mongoose";
import AppConfig, { IAppConfig } from "../models/AppConfig";

export interface AppConfigPayload {
  wrappedEnabled: boolean;
  wrappedYear: number;
  // Monotonically increasing — when this advances past what the device has
  // recorded, the app re-triggers the Wrapped auto-launch for that user.
  wrappedRevision: number;
}

/**
 * Fetch the singleton config document, creating it with defaults on first
 * access. Always returns a usable config — callers never need to handle
 * "not found" cases.
 */
export async function getAppConfig(): Promise<IAppConfig> {
  const existing = await AppConfig.findOne({ key: "global" });
  if (existing) return existing;
  return AppConfig.create({ key: "global" });
}

/**
 * Whether Wrapped should be available for a given user. True when the
 * global flag is on OR the user is in the explicit test list. The test
 * list lets admin verify the experience end-to-end on real accounts
 * before broadcasting to everyone.
 */
export function isWrappedAvailableFor(
  config: IAppConfig,
  userId: Types.ObjectId | string
): boolean {
  if (config.wrappedEnabled) return true;
  const target = userId.toString();
  return config.wrappedTestUserIds.some((id) => id.toString() === target);
}

/**
 * Public-facing payload — collapses the global flag and the per-user
 * override into a single boolean the client can read. The test-user list
 * itself is never exposed (privacy + would let any client probe it).
 * `wrappedYear` falls back to the current UTC year when null.
 */
export function toAppConfigPayload(
  config: IAppConfig,
  userId: Types.ObjectId | string
): AppConfigPayload {
  return {
    wrappedEnabled: isWrappedAvailableFor(config, userId),
    wrappedYear: config.wrappedYear ?? new Date().getUTCFullYear(),
    wrappedRevision: config.wrappedRevision,
  };
}
