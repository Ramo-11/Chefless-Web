import { Request, Response, NextFunction } from "express";
import admin from "firebase-admin";
import User from "../models/User";
import { logger } from "../lib/logger";

// Initialize Firebase Admin only once.
// Service account credentials are required for FCM push delivery.
// Auth token verification (verifyIdToken) works with just projectId,
// but messaging requires authenticated credentials.
if (!admin.apps.length) {
  const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!serviceAccountKey) {
    logger.warn(
      "Firebase Admin initialized without FIREBASE_SERVICE_ACCOUNT_KEY. " +
        "Auth verification may still work, but FCM push notifications are disabled."
    );
  }
  admin.initializeApp({
    projectId: process.env.FIREBASE_PROJECT_ID,
    ...(serviceAccountKey && {
      credential: admin.credential.cert(
        JSON.parse(serviceAccountKey) as admin.ServiceAccount
      ),
    }),
  });
}

type ClientPlatform = "ios" | "android" | "web";

/**
 * Reads the `X-Client-Platform` header the mobile client attaches to every
 * request. Platform used to be captured only when an FCM token was registered,
 * which meant anyone who declined push notifications never reported a device
 * at all and the admin Users table showed nothing for them.
 */
function readClientPlatform(req: Request): ClientPlatform | null {
  const raw = req.headers["x-client-platform"];
  const value = (Array.isArray(raw) ? raw[0] : raw)?.toLowerCase();
  return value === "ios" || value === "android" || value === "web"
    ? value
    : null;
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid authorization header" });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const decodedToken = await admin.auth().verifyIdToken(token);

    // One lookup serves the ban check, the Mongo user id that downstream
    // handlers need, and the stored platform, so each request hits the users
    // collection once instead of three times.
    const user = await User.findOne({ firebaseUid: decodedToken.uid })
      .select("isBanned lastKnownPlatform")
      .lean();

    if (user?.isBanned) {
      res.status(403).json({
        error: "Your account has been suspended. Contact support for assistance.",
      });
      return;
    }

    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      userId: user?._id?.toString(),
    };

    // Persist the reporting device, but only when it actually changed, so the
    // common case stays a pure read. Fire-and-forget: a failed write must never
    // fail the request it piggybacks on.
    const platform = readClientPlatform(req);
    if (user && platform && user.lastKnownPlatform !== platform) {
      User.updateOne(
        { _id: user._id },
        { $set: { lastKnownPlatform: platform } }
      )
        .exec()
        .catch((err: unknown) => {
          logger.warn({ err }, "Failed to record lastKnownPlatform");
        });
    }

    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}
