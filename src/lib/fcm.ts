import admin from "firebase-admin";

interface PushData {
  [key: string]: string;
}

/**
 * Send a push notification via Firebase Cloud Messaging.
 * Errors are logged but never thrown — push failures must not break the caller.
 */
export async function sendPushNotification(
  fcmToken: string,
  title: string,
  body: string,
  data?: PushData
): Promise<void> {
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

    // Log invalid token errors at info level — they're expected when users
    // uninstall the app or revoke notification permissions.
    if (
      errorMessage.includes("registration-token-not-registered") ||
      errorMessage.includes("invalid-registration-token")
    ) {
      console.info(
        `FCM token invalid for delivery (token prefix: ${fcmToken.slice(0, 8)}...): ${errorMessage}`
      );
    } else {
      console.error(`FCM send failed: ${errorMessage}`);
    }
  }
}
