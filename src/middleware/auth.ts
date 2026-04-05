import { Request, Response, NextFunction } from "express";
import admin from "firebase-admin";
import User from "../models/User";

// Initialize Firebase Admin only once.
// Service account credentials are required for FCM push delivery.
// Auth token verification (verifyIdToken) works with just projectId,
// but admin.messaging().send() needs authenticated credentials.
if (!admin.apps.length) {
  const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!serviceAccountKey) {
    console.warn(
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
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
    };

    // Check if user is banned
    const user = await User.findOne({ firebaseUid: decodedToken.uid })
      .select("isBanned")
      .lean();

    if (user?.isBanned) {
      res.status(403).json({
        error: "Your account has been suspended. Contact support for assistance.",
      });
      return;
    }

    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}
