import mongoose from "mongoose";
import { env } from "./env";
import { logger } from "./logger";

/**
 * Connect to MongoDB with production-sensible pool/timeout settings.
 *
 * - `serverSelectionTimeoutMS`: how long to wait finding a primary; keeps the
 *   boot from hanging indefinitely if Atlas is unreachable.
 * - `socketTimeoutMS`: caps any single operation so a frozen socket can't
 *   wedge a request handler forever.
 * - `maxPoolSize`: bounded concurrency to protect both the app and Atlas.
 */
export async function connectDatabase(): Promise<void> {
  try {
    await mongoose.connect(env.MONGODB_URI, {
      serverSelectionTimeoutMS: 10_000,
      socketTimeoutMS: 45_000,
      maxPoolSize: 20,
    });
    logger.info("Connected to MongoDB");
  } catch (error) {
    logger.error({ err: error }, "MongoDB initial connection failed");
    throw error;
  }

  // Runtime errors: log but never kill the process. The driver retries and
  // sub-requests that fail will surface through normal error handling.
  mongoose.connection.on("error", (error) => {
    logger.error({ err: error }, "MongoDB runtime error");
  });

  mongoose.connection.on("disconnected", () => {
    logger.warn("MongoDB disconnected");
  });

  mongoose.connection.on("reconnected", () => {
    logger.info("MongoDB reconnected");
  });
}
