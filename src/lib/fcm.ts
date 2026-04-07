import admin from "firebase-admin";
import User from "../models/User";

interface PushData {
  [key: string]: string;
}

/**
 * Send a push notification via the FCM HTTP v1 API.
 *
 * Bypasses the firebase-admin messaging module (which has a credential-
 * attachment bug in v13) and calls the REST endpoint directly using the
 * OAuth2 access token from the service account credential.
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
  console.log(
    `[FCM-DEBUG] sendPushNotification called. title="${title}", ` +
      `tokenPrefix="${fcmToken.slice(0, 12)}...", hasData=${!!data}`
  );

  if (!process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    console.error(
      "[FCM-DEBUG] ABORTING: FIREBASE_SERVICE_ACCOUNT_KEY is NOT SET. No push will be sent."
    );
    return;
  }

  try {
    // Get a fresh OAuth2 access token from the service account credential.
    const credential = admin.app().options.credential;
    if (!credential) {
      console.error("[FCM-DEBUG] ABORTING: No credential attached to Firebase Admin app.");
      return;
    }

    const { access_token } = await credential.getAccessToken();

    // Build the FCM v1 message payload.
    const payload = {
      message: {
        token: fcmToken,
        notification: {
          title,
          body,
        },
        data,
        android: {
          priority: "high" as const,
          notification: {
            sound: "default",
          },
        },
        apns: {
          headers: {
            "apns-priority": "10",
          },
          payload: {
            aps: {
              alert: {
                title,
                body,
              },
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

    const url = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;

    console.log(
      `[FCM-DEBUG] Sending via direct HTTP POST to ${url}`
    );

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const responseBody = await response.text();

    if (response.ok) {
      const result = JSON.parse(responseBody) as { name: string };
      console.log(
        `[FCM-DEBUG] SUCCESS — message sent. messageId="${result.name}", ` +
          `tokenPrefix="${fcmToken.slice(0, 12)}..."`
      );
    } else {
      console.error(
        `[FCM-DEBUG] SEND FAILED — HTTP ${response.status}: ${responseBody}`
      );

      // Handle invalid/unregistered tokens
      if (
        responseBody.includes("UNREGISTERED") ||
        responseBody.includes("INVALID_ARGUMENT")
      ) {
        console.info(
          `[FCM-DEBUG] Token invalid — clearing from user (token prefix: ${fcmToken.slice(0, 12)}...)`
        );
        User.findOneAndUpdate(
          { fcmToken },
          { $unset: { fcmToken: "" } }
        ).catch((cleanupErr: unknown) => {
          console.error(
            `[FCM-DEBUG] Failed to clear stale FCM token: ${cleanupErr instanceof Error ? cleanupErr.message : cleanupErr}`
          );
        });
      }
    }
  } catch (err: unknown) {
    const errorMessage =
      err instanceof Error ? err.message : "Unknown FCM error";
    console.error(`[FCM-DEBUG] EXCEPTION: ${errorMessage}`);
    if (err instanceof Error && err.stack) {
      console.error(`[FCM-DEBUG] Stack: ${err.stack}`);
    }
  }
}
