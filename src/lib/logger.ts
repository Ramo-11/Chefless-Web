import pino from "pino";

/**
 * Centralized structured logger.
 *
 * - In development, uses human-readable pretty output if pino-pretty is
 *   installed; falls back to default JSON otherwise.
 * - In production, emits JSON (default) so log aggregators can parse it.
 * - Log level can be overridden via the LOG_LEVEL env var.
 */

const isProd = process.env.NODE_ENV === "production";
const level = process.env.LOG_LEVEL ?? (isProd ? "info" : "debug");

function buildLogger(): pino.Logger {
  if (!isProd) {
    try {
      // pino-pretty is optional; only use it when available.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require.resolve("pino-pretty");
      return pino({
        level,
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:HH:MM:ss.l",
            ignore: "pid,hostname",
          },
        },
      });
    } catch {
      // pino-pretty not installed — fall through to plain JSON logger.
    }
  }

  return pino({
    level,
    // Redact common sensitive fields by default.
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "password",
        "newPassword",
        "token",
        "idToken",
      ],
      censor: "[redacted]",
      remove: false,
    },
  });
}

export const logger = buildLogger();

export default logger;
