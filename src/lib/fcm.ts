import admin from "firebase-admin";
import User from "../models/User";

interface PushData {
  [key: string]: string;
}

/**
 * Send a push notification via Firebase Cloud Messaging.
 *
 * If the token is invalid or unregistered (user uninstalled, revoked
 * permissions, etc.), the stale token is automatically removed from the
 * user document so we don't waste future attempts.
 *
 * Errors are logged but never thrown — push failures must not break the caller.
 */
export async function sendPushNotification(
  fcmToken: string,
  title: string,
  body: string,
  data?: PushData
): Promise<void> {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    console.error(
      "Skipping FCM push send because FIREBASE_SERVICE_ACCOUNT_KEY is not configured."
    );
    return;
  }

  try {
    const message: admin.messaging.Message = {
      token: fcmToken,
      notification: {
        title,
        body,
      },
      data,
      android: {
        priority: "high",
        notification: {
          sound: "default",
        },
      },
      apns: {
        payload: {
          aps: {
            sound: "default",
            badge: 1,
          },
        },
      },
    };

    await admin.messaging().send(message);
  } catch (err: unknown) {
    const errorMessage =
      err instanceof Error ? err.message : "Unknown FCM error";

    // Invalid or unregistered tokens are expected when users uninstall
    // the app or revoke notification permissions. Clean them up so we
    // don't keep trying to deliver to a dead token.
    if (
      errorMessage.includes("registration-token-not-registered") ||
      errorMessage.includes("invalid-registration-token")
    ) {
      console.info(
        `FCM token invalid — clearing from user (token prefix: ${fcmToken.slice(0, 8)}...)`
      );
      // Fire-and-forget: remove the stale token from the user document.
      User.findOneAndUpdate(
        { fcmToken },
        { $unset: { fcmToken: "" } }
      ).catch((cleanupErr: unknown) => {
        console.error(
          `Failed to clear stale FCM token: ${cleanupErr instanceof Error ? cleanupErr.message : cleanupErr}`
        );
      });
    } else {
      console.error(`FCM send failed: ${errorMessage}`);
    }
  }
}
