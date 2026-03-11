import { Request, Response, NextFunction } from "express";

/**
 * Protects admin panel pages. Checks for a valid admin session.
 * Redirects to /admin/login if not authenticated.
 */
export function requireAdminSession(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!req.session.adminId || !req.session.adminEmail) {
    res.redirect("/admin/login");
    return;
  }

  // Make admin info available to all admin views
  res.locals.adminName = req.session.adminName;
  res.locals.adminEmail = req.session.adminEmail;
  res.locals.adminRole = req.session.adminRole;

  next();
}
