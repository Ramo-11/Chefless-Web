import { Request, Response } from "express";
import AdminUser from "../models/AdminUser";
import { generateCsrfToken, rotateCsrfToken } from "../middleware/csrf";
import { logger } from "../lib/logger";

export async function loginPage(req: Request, res: Response): Promise<void> {
  if (req.session.adminId) {
    res.redirect("/admin");
    return;
  }
  res.render("login", { error: null, csrfToken: generateCsrfToken(req) });
}

export async function loginPost(req: Request, res: Response): Promise<void> {
  const { email, password } = req.body;

  if (!email || !password) {
    res.render("login", {
      error: "Email and password are required",
      csrfToken: generateCsrfToken(req),
    });
    return;
  }

  const admin = await AdminUser.findOne({
    email: email.toLowerCase(),
    isActive: true,
  });

  if (!admin || !(await admin.comparePassword(password))) {
    logger.warn(
      { email: String(email).toLowerCase(), ip: req.ip },
      "Admin login failed"
    );
    res.render("login", {
      error: "Invalid email or password",
      csrfToken: generateCsrfToken(req),
    });
    return;
  }

  // Update last login before session rotation so the write is attributed to
  // the current (pre-rotation) session's cookie context.
  admin.lastLoginAt = new Date();
  await admin.save();

  // Prevent session fixation: start a fresh session ID on successful auth so
  // any pre-login session cookie the attacker may have planted is invalidated.
  // After regenerate(), the old CSRF token is also gone — mint a new one.
  req.session.regenerate((regenErr) => {
    if (regenErr) {
      logger.error(
        { err: regenErr, adminId: admin._id.toString() },
        "Admin session regenerate failed"
      );
      res.status(500).render("login", {
        error: "Login failed. Please try again.",
        csrfToken: generateCsrfToken(req),
      });
      return;
    }

    req.session.adminId = admin._id.toString();
    req.session.adminEmail = admin.email;
    req.session.adminName = admin.name;
    req.session.adminRole = admin.role;
    rotateCsrfToken(req);

    req.session.save((saveErr) => {
      if (saveErr) {
        logger.error(
          { err: saveErr, adminId: admin._id.toString() },
          "Admin session save failed"
        );
        res.status(500).render("login", {
          error: "Login failed. Please try again.",
          csrfToken: generateCsrfToken(req),
        });
        return;
      }
      logger.info(
        { adminId: admin._id.toString(), email: admin.email },
        "Admin login success"
      );
      res.redirect("/admin");
    });
  });
}

export function logout(req: Request, res: Response): void {
  req.session.destroy((err) => {
    if (err) {
      logger.warn({ err }, "Admin session destroy failed");
    }
    res.redirect("/admin/login");
  });
}
