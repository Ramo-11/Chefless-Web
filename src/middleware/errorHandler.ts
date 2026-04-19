import { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import mongoose from "mongoose";
import { logger } from "../lib/logger";

interface AppError extends Error {
  statusCode?: number;
}

/**
 * Determine the HTTP status code for a given error. Returns a pair so we can
 * pick log level (warn for 4xx, error for 5xx) without recomputing.
 */
function deriveStatus(err: AppError): number {
  if (err instanceof ZodError) return 400;
  if (err instanceof mongoose.Error.ValidationError) return 400;
  if (err instanceof mongoose.Error.CastError) return 400;
  if (
    err !== null &&
    typeof err === "object" &&
    "code" in err &&
    (err as { code?: number }).code === 11000
  ) {
    return 409;
  }
  if (err.statusCode && err.statusCode >= 400 && err.statusCode < 600) {
    return err.statusCode;
  }
  return 500;
}

export function errorHandler(
  err: AppError,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const requestId = req.requestId ?? "unknown";
  const status = deriveStatus(err);

  const baseFields = {
    requestId,
    status,
    method: req.method,
    path: req.path,
    message: err.message,
  };

  if (status >= 500) {
    // Full error with stack for server-side bugs.
    logger.error({ ...baseFields, err }, "Request failed");
  } else {
    // Client errors — warn level, no stack (noise, not actionable).
    logger.warn(baseFields, "Client request error");
  }

  // Zod validation errors
  if (err instanceof ZodError) {
    res.status(400).json({
      error: "Validation failed",
      details: err.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
    return;
  }

  // Mongoose validation errors
  if (err instanceof mongoose.Error.ValidationError) {
    const details = Object.entries(err.errors).map(([field, error]) => ({
      path: field,
      message: error.message,
    }));
    res.status(400).json({ error: "Validation failed", details });
    return;
  }

  // Mongoose cast errors (invalid ObjectId, etc.)
  if (err instanceof mongoose.Error.CastError) {
    res.status(400).json({ error: `Invalid ${err.path}: ${err.value}` });
    return;
  }

  // Mongo duplicate-key errors — convert to a friendly 409. Individual
  // services should ideally catch these locally and surface a context-specific
  // message, but this guards against any that slip through.
  if (
    err !== null &&
    typeof err === "object" &&
    "code" in err &&
    (err as { code?: number }).code === 11000
  ) {
    res.status(409).json({ error: "This entry already exists." });
    return;
  }

  // Custom app errors with status code
  if (err.statusCode) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }

  // Default server error
  res.status(500).json({ error: "Internal server error" });
}
