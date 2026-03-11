import { Request, Response, NextFunction } from "express";
import admin from "firebase-admin";
import User from "../models/User";

// Initialize Firebase Admin only once
if (!admin.apps.length) {
  admin.initializeApp({
    projectId: process.env.FIREBASE_PROJECT_ID,
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
