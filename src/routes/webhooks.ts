import crypto from "crypto";
import { Router, Request, Response } from "express";
import { z } from "zod";
import User from "../models/User";
import WebhookEvent from "../models/WebhookEvent";
import Transaction, { buildTransactionInput } from "../models/Transaction";
import { env } from "../lib/env";
import { logger } from "../lib/logger";

const router = Router();

/**
 * RevenueCat webhook event schema.
 *
 * `id` is documented in RevenueCat's spec as a unique event identifier and is
 * what we use for idempotency. In the wild, retries of the *same delivery*
 * carry the same id; replays of an in-flight event carry a new one. That
 * matches what we want — reject dupes, accept legit retries.
 *
 * Only `type` is strictly required. `app_user_id` is optional: most event
 * types carry it, but some (e.g. TRANSFER) may omit it, and rejecting those
 * with a 400 would make RevenueCat retry indefinitely. Instead we accept the
 * payload and the handler skips events that lack a user id. `.passthrough()`
 * keeps any extra keys RevenueCat sends so legitimate provider payloads are
 * never rejected. When `app_user_id` IS present, this guarantees it is a plain
 * string before it reaches a Mongo filter, so a JSON object (e.g. an injected
 * query operator) cannot reach a query.
 */
const revenueCatEventSchema = z
  .object({
    id: z.string().min(1).optional(),
    type: z.string().min(1),
    app_user_id: z.string().min(1).optional(),
    product_id: z.string().optional(),
    expiration_at_ms: z.number().optional(),
    // Financial fields recorded to the Transaction ledger. All optional and
    // nullable because RevenueCat sends `null` for unknown values (and omits
    // them on non-money events), and rejecting those would make RevenueCat
    // retry the webhook forever. `.passthrough()` already carries them; these
    // just document and type-check what the ledger consumes.
    price: z.number().nullish(),
    price_in_purchased_currency: z.number().nullish(),
    currency: z.string().nullish(),
    takehome_percentage: z.number().nullish(),
    commission_percentage: z.number().nullish(),
    tax_percentage: z.number().nullish(),
    store: z.string().nullish(),
    environment: z.string().nullish(),
    purchased_at_ms: z.number().nullish(),
    event_timestamp_ms: z.number().nullish(),
    period_type: z.string().nullish(),
    renewal_number: z.number().nullish(),
    cancel_reason: z.string().nullish(),
  })
  .passthrough();

const revenueCatWebhookSchema = z
  .object({
    event: revenueCatEventSchema,
  })
  .passthrough();

type RevenueCatWebhookPayload = z.infer<typeof revenueCatWebhookSchema>;

function getPlanFromProductId(
  productId: string | undefined
): "monthly" | "annual" | undefined {
  if (!productId) return undefined;
  if (productId.includes("annual") || productId.includes("yearly"))
    return "annual";
  if (productId.includes("monthly")) return "monthly";
  return "monthly";
}

/** True if the error is a Mongo duplicate-key error (code 11000). */
function isDuplicateKeyError(err: unknown): boolean {
  return (
    err !== null &&
    typeof err === "object" &&
    "code" in err &&
    (err as { code?: number }).code === 11000
  );
}

/**
 * Records a financial ledger row for a money-moving event.
 *
 * This is analytics bookkeeping and must never interfere with entitlement
 * processing, so it swallows every error and never throws. The insert is
 * idempotent: a duplicate eventId (backfill already wrote it, or a rare
 * post-dedupe race) is ignored.
 */
async function recordTransaction(
  eventId: string,
  event: unknown
): Promise<void> {
  const input = buildTransactionInput(eventId, event);
  if (!input) return;
  try {
    await Transaction.create(input);
  } catch (err) {
    if (isDuplicateKeyError(err)) return;
    logger.error({ err, eventId }, "Failed to record revenue transaction");
  }
}

router.post("/revenuecat", async (req: Request, res: Response) => {
  // Verify webhook secret
  const authHeader = req.headers.authorization;
  if (!env.REVENUECAT_WEBHOOK_SECRET) {
    logger.error("REVENUECAT_WEBHOOK_SECRET is not configured");
    res.status(500).json({ error: "Webhook secret not configured" });
    return;
  }

  const expectedToken = `Bearer ${env.REVENUECAT_WEBHOOK_SECRET}`;
  if (
    !authHeader ||
    authHeader.length !== expectedToken.length ||
    !crypto.timingSafeEqual(Buffer.from(authHeader), Buffer.from(expectedToken))
  ) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = revenueCatWebhookSchema.safeParse(req.body);
  if (!parsed.success) {
    logger.warn(
      { issues: parsed.error.issues },
      "Invalid RevenueCat webhook payload"
    );
    res.status(400).json({ error: "Invalid webhook payload" });
    return;
  }

  const payload: RevenueCatWebhookPayload = parsed.data;
  const event = payload.event;

  const {
    id: eventId,
    type,
    app_user_id: appUserId,
    product_id: productId,
    expiration_at_ms: expirationAtMs,
  } = event;

  // Idempotency — record the event first. If RevenueCat missing an event id
  // (unexpected), synthesize a stable hash from the payload so retries of the
  // same body still dedupe.
  const idempotencyKey =
    eventId ??
    crypto
      .createHash("sha256")
      .update(JSON.stringify(payload))
      .digest("hex");

  try {
    await WebhookEvent.create({
      eventId: idempotencyKey,
      provider: "revenuecat",
      payload,
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      logger.info(
        { eventId: idempotencyKey, type },
        "Duplicate RevenueCat webhook, skipping"
      );
      res.status(200).json({ received: true, duplicate: true });
      return;
    }
    logger.error(
      { err, eventId: idempotencyKey },
      "Failed to record webhook event"
    );
    res.status(500).json({ error: "Internal server error" });
    return;
  }

  // Record the financial ledger row now that this event is confirmed new.
  // Never lets a bookkeeping failure block entitlement processing below.
  await recordTransaction(idempotencyKey, event);

  try {
    switch (type) {
      case "INITIAL_PURCHASE":
      case "RENEWAL": {
        if (!appUserId) {
          logger.warn({ type }, "RevenueCat event missing app_user_id; ignoring");
          break;
        }
        const plan = getPlanFromProductId(productId);
        const incomingExpiry = expirationAtMs
          ? new Date(expirationAtMs)
          : undefined;

        // Load existing premiumExpiresAt to guard against out-of-order delivery
        // rolling back a longer subscription window.
        const existing = await User.findOne({ firebaseUid: appUserId })
          .select("premiumExpiresAt")
          .lean();

        if (!existing) {
          logger.warn(
            { appUserId, type },
            "RevenueCat event for unknown user; ignoring"
          );
          break;
        }

        const set: Record<string, unknown> = { isPremium: true };
        if (plan) set.premiumPlan = plan;

        // Only advance premiumExpiresAt forward in time. A delayed RENEWAL
        // carrying an older expiry than what's already stored must not shrink
        // the user's window.
        if (incomingExpiry) {
          const currentExpiry = existing.premiumExpiresAt
            ? new Date(existing.premiumExpiresAt)
            : undefined;
          if (!currentExpiry || incomingExpiry.getTime() > currentExpiry.getTime()) {
            set.premiumExpiresAt = incomingExpiry;
          } else {
            logger.info(
              {
                appUserId,
                currentExpiry: currentExpiry.toISOString(),
                incomingExpiry: incomingExpiry.toISOString(),
              },
              "Ignoring stale RevenueCat expiry (would roll back)"
            );
          }
        }

        await User.updateOne(
          { firebaseUid: appUserId },
          {
            $set: set,
            $unset: { premiumGrantedBy: 1, premiumGrantedAt: 1 },
          }
        );
        break;
      }

      case "CANCELLATION":
      case "EXPIRATION": {
        if (!appUserId) {
          logger.warn({ type }, "RevenueCat event missing app_user_id; ignoring");
          break;
        }
        await User.updateOne(
          { firebaseUid: appUserId },
          {
            $set: { isPremium: false },
            $unset: {
              premiumPlan: 1,
              premiumExpiresAt: 1,
              premiumGrantedBy: 1,
              premiumGrantedAt: 1,
            },
          }
        );
        break;
      }

      default:
        // Acknowledge unknown event types without processing.
        logger.info({ type }, "Ignoring unhandled RevenueCat event type");
        break;
    }

    res.status(200).json({ received: true });
  } catch (err: unknown) {
    logger.error(
      { err, eventId: idempotencyKey, type },
      "Error processing RevenueCat event"
    );
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
