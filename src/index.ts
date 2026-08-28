import path from "path";
import crypto from "crypto";
import express from "express";
import cors, { CorsOptions } from "cors";
import helmet from "helmet";
import session from "express-session";
import MongoStore from "connect-mongo";
import { env } from "./lib/env";
import { connectDatabase } from "./lib/db";
import { logger } from "./lib/logger";
import {
  apiReadLimiter,
  apiWriteLimiter,
  strictLimiter,
  authLimiter,
  webhookLimiter,
} from "./middleware/rateLimit";
import { errorHandler } from "./middleware/errorHandler";
import healthRouter from "./routes/health";
import authRouter from "./routes/auth";
import usersRouter from "./routes/users";
import recipesRouter from "./routes/recipes";
import cookbooksRouter from "./routes/cookbooks";
import kitchensRouter from "./routes/kitchens";
import scheduleRouter from "./routes/schedules";
import shoppingListsRouter from "./routes/shopping-lists";
import searchRouter from "./routes/search";
import feedRouter from "./routes/feed";
import notificationsRouter from "./routes/notifications";
import webhooksRouter from "./routes/webhooks";
import labelsRouter from "./routes/labels";
import reportsRouter from "./routes/reports";
import feedbackRouter from "./routes/feedback";
import errorsRouter from "./routes/errors";
import aiRouter from "./routes/ai";
import adminRouter from "./admin/routes";
import pagesRouter from "./routes/pages";
import blocksRouter from "./routes/blocks";
import cookPromptsRouter from "./routes/cook-prompts";
import cookedPostsRouter from "./routes/cooked-posts";
import passportRouter from "./routes/passport";
import remixTreeRouter from "./routes/remix-tree";
import wrappedRouter from "./routes/wrapped";
import appConfigRouter from "./routes/app-config";
import publicRouter from "./routes/public";

const app = express();

// ── Trust proxy (Render runs behind a reverse proxy) ────────────────
// Assumes EXACTLY ONE trusted proxy (Render's load balancer) sits in front.
// If this service is ever exposed without that single proxy, req.ip becomes
// spoofable via the X-Forwarded-For header, which would let an attacker bypass
// every IP-keyed rate limiter. Keep the count at 1 unless the topology changes.
app.set("trust proxy", 1);

// ── View engine (EJS for admin panel) ───────────────────────────────
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// ── Static files ────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, "public")));

// ── Security headers ───────────────────────────────────────────────
// helmet's own CSP is disabled here because the JSON API serves no HTML and
// needs no CSP. A real, admin-scoped CSP IS applied below (see adminCsp) to
// the EJS admin panel mounted at /admin — that is the only HTML surface.
app.use(helmet({
  contentSecurityPolicy: false,
}));

// ── Content-Security-Policy for the admin panel ─────────────────────
// Scoped to /admin only (the JSON API renders no HTML and must not receive
// this header). The admin EJS views rely on inline <script> blocks and a few
// inline handlers, so 'unsafe-inline' stays in script-src/style-src — a strict
// nonce-based policy is out of scope and would break the panel. The allow-list
// below is derived from the external origins actually referenced across
// src/views/*: Chart.js from jsDelivr, and recipe/profile image URLs stored in
// the database. Everything else is locked to 'self' so that even an injection
// that survives output escaping cannot exfiltrate data to an attacker-
// controlled origin. (The panel is icon-free and no longer loads Font Awesome,
// so cdnjs is gone from font-src/style-src.)
//
// img-src has to accept any https origin: recipe photos are not all on
// Cloudinary. Imported and seeded recipes keep the source image URL
// (themealdb.com, images.pexels.com, and whatever a future importer pulls
// from), so pinning the list to res.cloudinary.com silently broke every one
// of those thumbnails in the moderation tables. Images cannot execute, and
// script-src/connect-src stay locked down, so this is the narrow relaxation.
const adminCsp =
  "default-src 'self'; " +
  "base-uri 'self'; " +
  "object-src 'none'; " +
  "frame-ancestors 'self'; " +
  "form-action 'self'; " +
  "connect-src 'self'; " +
  "img-src 'self' https: data:; " +
  "font-src 'self'; " +
  "style-src 'self' 'unsafe-inline'; " +
  "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net";

const adminCspMiddleware: express.RequestHandler = (_req, res, next) => {
  res.setHeader("Content-Security-Policy", adminCsp);
  next();
};

// ── CORS ────────────────────────────────────────────────────────────
// In production, require an explicit allowlist. If ALLOWED_ORIGINS is empty,
// refuse all browser origins (passing `origin: false` to cors). Server-to-
// server and mobile clients don't send an Origin header and remain unaffected.
// In development, allow any origin for local tooling.
const isProd = env.NODE_ENV === "production";
const corsOriginOption: CorsOptions["origin"] = isProd
  ? env.ALLOWED_ORIGINS.length > 0
    ? env.ALLOWED_ORIGINS
    : false
  : true;

const publicRouteOrigins = ["https://chefless.org", "https://www.chefless.org"];

app.use(cors((req, callback) => {
  if (req.path.startsWith("/api/public/")) {
    callback(null, {
      origin: isProd ? publicRouteOrigins : true,
      methods: ["GET"],
      credentials: false,
    });
    return;
  }

  callback(null, {
    origin: corsOriginOption,
    methods: ["GET", "POST", "PATCH", "DELETE"],
    allowedHeaders: [
      "Authorization",
      "Content-Type",
      "X-CSRF-Token",
      "X-Client-Platform",
      "X-Idempotency-Key",
    ],
    credentials: true,
  });
}));

app.use(express.urlencoded({ extended: true }));

// ── Request ID for tracing ─────────────────────────────────────────
app.use((req, _res, next) => {
  req.requestId = (req.headers["x-request-id"] as string) || crypto.randomUUID();
  next();
});

// JSON body parsers — applied per-route so upload routes can have a higher limit.
// Must NOT use a global express.json() or its limit would block larger uploads
// before the route-specific parser runs.
const jsonDefault = express.json({ limit: "1mb" });
// 15mb accommodates base64 image uploads from installed clients (one app path
// forwards the original, unresized photo). The image schema in
// lib/image-validation.ts enforces a tighter decoded-byte ceiling per upload.
const jsonUpload = express.json({ limit: "15mb" });

// ── Session middleware (admin panel only, but applied globally) ──────
app.use(
  session({
    secret: env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: env.MONGODB_URI,
      collectionName: "admin_sessions",
      ttl: 7 * 24 * 60 * 60, // 7 days — must match cookie maxAge
    }),
    cookie: {
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days for admin sessions
      httpOnly: true,
      secure: isProd,
      sameSite: "lax",
    },
  })
);

// ── Public pages (privacy, terms) ───────────────────────────────────
app.use("/", pagesRouter);

// ── Admin panel (served at /admin) ──────────────────────────────────
// Admin router needs JSON parsing for adminFetch() POST/PUT calls from the
// EJS views. urlencoded is already applied globally above for form posts.
app.use("/admin", adminCspMiddleware, jsonDefault, adminRouter);

// ── Webhook routes (no auth — they verify their own secrets) ────────
// RevenueCat webhooks are authorized by a shared Bearer token (see
// routes/webhooks.ts) and carry JSON bodies. We verify the *token*, not a
// signature over the raw body, so parsing JSON here is safe. If the provider
// is ever swapped for one that signs raw bytes, this mount must move to
// express.raw and the verifier will need access to the raw buffer.
app.use(
  "/api/webhooks",
  webhookLimiter,
  express.json({ limit: "1mb" }),
  webhooksRouter
);

// ── API routes ──────────────────────────────────────────────────────
// Rate limit strategy:
//   - apiReadLimiter:  per-user, generous (only counts GET/HEAD)
//   - apiWriteLimiter: per-user, moderate (only counts POST/PATCH/DELETE)
//   - Both applied to authed API routes; together they form one cohesive limit
//     without one method type starving the other.
const apiLimiters = [apiReadLimiter, apiWriteLimiter];

app.use("/api/health", jsonDefault, healthRouter);
app.use("/api/auth", jsonDefault, authLimiter, authRouter);
// Upload routes need a higher body limit for base64 image data
app.use("/api/users", jsonUpload, ...apiLimiters, usersRouter);
app.use("/api/recipes", jsonUpload, ...apiLimiters, recipesRouter);
app.use("/api/cookbooks", jsonUpload, ...apiLimiters, cookbooksRouter);
// Kitchens routes accept base64 photo uploads on /me/photo — needs larger
// JSON limit than the default 1MB to handle the base64 overhead on a 1600px
// JPEG at ~88% quality.
app.use("/api/kitchens", jsonUpload, ...apiLimiters, kitchensRouter);
app.use("/api/schedule", jsonDefault, ...apiLimiters, scheduleRouter);
app.use("/api/shopping-lists", jsonDefault, ...apiLimiters, shoppingListsRouter);
app.use("/api/search", jsonDefault, ...apiLimiters, searchRouter);
app.use("/api/feed", jsonDefault, ...apiLimiters, feedRouter);
app.use("/api/notifications", jsonDefault, ...apiLimiters, notificationsRouter);
app.use("/api/labels", jsonDefault, ...apiLimiters, labelsRouter);
app.use("/api/reports", jsonDefault, strictLimiter, reportsRouter);
app.use("/api/feedback", jsonDefault, strictLimiter, feedbackRouter);
// Errors route uses its own per-IP limiter because crashes can fire pre-auth.
app.use("/api/errors", jsonDefault, errorsRouter);
app.use("/api/ai", jsonDefault, strictLimiter, aiRouter);
app.use("/api/blocks", jsonDefault, ...apiLimiters, blocksRouter);
app.use("/api/cook-prompts", jsonDefault, ...apiLimiters, cookPromptsRouter);
// Cooked-posts endpoints accept base64 photos, so use the larger body limit.
app.use("/api/cooked-posts", jsonUpload, ...apiLimiters, cookedPostsRouter);
app.use("/api/passport", jsonDefault, ...apiLimiters, passportRouter);
app.use("/api/remix-tree", jsonDefault, ...apiLimiters, remixTreeRouter);
app.use("/api/wrapped", jsonDefault, ...apiLimiters, wrappedRouter);
app.use("/api/app-config", jsonDefault, ...apiLimiters, appConfigRouter);
app.use("/api/public", jsonDefault, apiReadLimiter, publicRouter);

// ── Error handler (must be last) ────────────────────────────────────
app.use(errorHandler);

app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, "Chefless API listening");
  connectDatabase().catch((error) => {
    logger.error({ err: error }, "MongoDB connection failed");
  });
});

export default app;
