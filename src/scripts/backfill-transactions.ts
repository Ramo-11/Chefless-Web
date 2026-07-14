/**
 * Rebuild the Transaction ledger from recorded RevenueCat webhook events.
 *
 * The webhook now writes a Transaction row for every money-moving event, but
 * events received before that code shipped were only stored in WebhookEvent.
 * This script replays those payloads through the exact same extractor the
 * webhook uses (`buildTransactionInput`) and upserts the resulting rows.
 *
 * Idempotent and safe to re-run: rows are upserted by `eventId` with
 * `$setOnInsert`, so an existing ledger row is never touched or duplicated.
 * Note WebhookEvent rows TTL after 90 days, so this only recovers events still
 * inside that window.
 *
 * Usage (from chefless-api/):
 *   npm run backfill:transactions
 */
import "dotenv/config";
import mongoose from "mongoose";
import WebhookEvent from "../models/WebhookEvent";
import Transaction, { buildTransactionInput } from "../models/Transaction";
import { env } from "../lib/env";

async function main(): Promise<void> {
  await mongoose.connect(env.MONGODB_URI);
  console.log("Connected to MongoDB");

  const events = await WebhookEvent.find({ provider: "revenuecat" })
    .select("eventId payload")
    .lean();
  console.log(`Found ${events.length} RevenueCat webhook events to scan.`);

  let created = 0;
  let duplicates = 0;
  let skipped = 0;

  for (const doc of events) {
    const payload = doc.payload as { event?: unknown } | null | undefined;
    const input = buildTransactionInput(doc.eventId, payload?.event);
    if (!input) {
      // No money moved (zero-price cancellation, expiration, etc.).
      skipped += 1;
      continue;
    }

    const result = await Transaction.updateOne(
      { eventId: input.eventId },
      { $setOnInsert: input },
      { upsert: true }
    );

    if (result.upsertedCount > 0) created += 1;
    else duplicates += 1;
  }

  console.log("Backfill complete.");
  console.log(`  Events scanned:        ${events.length}`);
  console.log(`  Transactions created:  ${created}`);
  console.log(`  Skipped (no price):    ${skipped}`);
  console.log(`  Duplicates (existing): ${duplicates}`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
