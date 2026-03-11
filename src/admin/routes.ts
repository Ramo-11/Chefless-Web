import { Router } from "express";
import { requireAdminSession } from "../middleware/adminSession";
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

// ── Auth (public) ───────────────────────────────────────────────────
router.get("/login", loginPage);
router.post("/login", loginPost);
router.post("/logout", logout);

// ── All routes below require admin session ──────────────────────────
router.use(requireAdminSession);

// Dashboard
router.get("/", dashboardPage);

// Users
router.get("/users", usersPage);
router.get("/api/users/:id", userDetail);
router.post("/api/users/:id/ban", banUser);
router.post("/api/users/:id/unban", unbanUser);

// Recipes
router.get("/recipes", recipesPage);
router.get("/api/recipes/:id", recipeDetail);
router.post("/api/recipes/:id/toggle-hide", toggleHideRecipe);
router.delete("/api/recipes/:id", deleteRecipe);

// Reports
router.get("/reports", reportsPage);
router.post("/api/reports/:id/review", reviewReport);
router.post("/api/reports/:id/dismiss", dismissReport);

// Labels
router.get("/labels", labelsPage);
router.post("/api/labels", createLabel);
router.put("/api/labels/:id", updateLabel);
router.delete("/api/labels/:id", deleteLabel);

// Seasonal
router.get("/seasonal", seasonalPage);
router.post("/api/seasonal/tags", createTag);
router.post("/api/seasonal/tags/:id/toggle", toggleTag);
router.delete("/api/seasonal/tags/:id", deleteTag);
router.post("/api/seasonal/tag-recipe", tagRecipe);
router.post("/api/seasonal/untag-recipe", untagRecipe);

export default router;
