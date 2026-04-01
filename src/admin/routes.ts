import { Router } from "express";
import expressLayouts from "express-ejs-layouts";
import { requireAdminSession } from "../middleware/adminSession";
import { authLimiter } from "../middleware/rateLimit";
import { csrfProtection } from "../middleware/csrf";
import { loginPage, loginPost, logout } from "./auth";
import { dashboardPage } from "./controllers/dashboard";
import { usersPage, userDetail, banUser, unbanUser } from "./controllers/users";
import {
  recipesPage,
  toggleHideRecipe,
  deleteRecipe,
  recipeDetail,
} from "./controllers/recipes";
import {
  reportsPage,
  reviewReport,
  dismissReport,
} from "./controllers/reports";
import { labelsPage, createLabel, updateLabel, deleteLabel } from "./controllers/labels";
import {
  seasonalPage,
  createTag,
  toggleTag,
  deleteTag,
  tagRecipe,
  untagRecipe,
} from "./controllers/seasonal";

const router = Router();

// ── Auth (public, no layout) ───────────────────────────────────────
router.get("/login", loginPage);
router.post("/login", authLimiter, csrfProtection, loginPost);
router.post("/logout", csrfProtection, logout);

// ── All routes below require admin session ──────────────────────────
router.use(requireAdminSession);

// ── JSON API routes (no layout) ────────────────────────────────────
router.get("/api/users/:id", userDetail);
router.post("/api/users/:id/ban", csrfProtection, banUser);
router.post("/api/users/:id/unban", csrfProtection, unbanUser);
router.get("/api/recipes/:id", recipeDetail);
router.post("/api/recipes/:id/toggle-hide", csrfProtection, toggleHideRecipe);
router.delete("/api/recipes/:id", csrfProtection, deleteRecipe);
router.post("/api/reports/:id/review", csrfProtection, reviewReport);
router.post("/api/reports/:id/dismiss", csrfProtection, dismissReport);
router.post("/api/labels", csrfProtection, createLabel);
router.put("/api/labels/:id", csrfProtection, updateLabel);
router.delete("/api/labels/:id", csrfProtection, deleteLabel);
router.post("/api/seasonal/tags", csrfProtection, createTag);
router.post("/api/seasonal/tags/:id/toggle", csrfProtection, toggleTag);
router.delete("/api/seasonal/tags/:id", csrfProtection, deleteTag);
router.post("/api/seasonal/tag-recipe", csrfProtection, tagRecipe);
router.post("/api/seasonal/untag-recipe", csrfProtection, untagRecipe);

// ── Page routes (with layout) ──────────────────────────────────────
router.use(expressLayouts);
router.get("/", dashboardPage);
router.get("/users", usersPage);
router.get("/recipes", recipesPage);
router.get("/reports", reportsPage);
router.get("/labels", labelsPage);
router.get("/seasonal", seasonalPage);

export default router;
