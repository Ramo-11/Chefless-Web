import admin from "firebase-admin";
import User from "../models/User";

interface PushData {
  [key: string]: string;
}

/**
 * Send a push notification via the FCM HTTP v1 API.
 *
 * Uses the REST endpoint directly with the OAuth2 access token from the
 * service account credential (the firebase-admin v13 messaging module has
 * a credential-attachment issue, so we bypass it).
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
      "FCM: FIREBASE_SERVICE_ACCOUNT_KEY is not set — push notifications disabled."
    );
    return;
  }

  try {
    const credential = admin.app().options.credential;
    if (!credential) {
      console.error("FCM: No credential attached to Firebase Admin app.");
      return;
    }

    const { access_token } = await credential.getAccessToken();

    const payload = {
      message: {
        token: fcmToken,
        notification: { title, body },
        data,
        android: {
          priority: "high" as const,
          notification: { sound: "default" },
        },
        apns: {
          headers: { "apns-priority": "10" },
          payload: {
            aps: {
              alert: { title, body },
              sound: "default",
              badge: 1,
              "mutable-content": 1,
            },
          },
        },
      },
    };

    const projectId =
      process.env.FIREBASE_PROJECT_ID ||
      (JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY) as { project_id: string }).project_id;

    const response = await fetch(
      `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      const responseBody = await response.text();

      // Invalid or unregistered tokens — clean up the stale token.
      if (
        responseBody.includes("UNREGISTERED") ||
        responseBody.includes("INVALID_ARGUMENT")
      ) {
        console.info(
          `FCM: Stale token detected — removing (prefix: ${fcmToken.slice(0, 8)}…)`
        );
        User.findOneAndUpdate(
          { fcmToken },
          { $unset: { fcmToken: "" } }
        ).catch((err: unknown) => {
          console.error(
            `FCM: Failed to clear stale token: ${err instanceof Error ? err.message : err}`
          );
        });
      } else {
        console.error(`FCM: Send failed (HTTP ${response.status}): ${responseBody}`);
      }
    }
  } catch (err: unknown) {
    console.error(
      `FCM: Exception — ${err instanceof Error ? err.message : "Unknown error"}`
    );
  }
}
