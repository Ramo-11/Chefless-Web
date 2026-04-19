import { Request, Response, NextFunction } from "express";
import { randomBytes } from "crypto";

const CSRF_HEADER = "x-csrf-token";
const CSRF_SESSION_KEY = "csrfToken";

/**
 * Generates a CSRF token and stores it in the session.
 * Call this when rendering forms.
 */
export function generateCsrfToken(req: Request): string {
  if (!req.session[CSRF_SESSION_KEY]) {
    req.session[CSRF_SESSION_KEY] = randomBytes(32).toString("hex");
  }
  return req.session[CSRF_SESSION_KEY] as string;
}

/**
 * Rotates the CSRF token, discarding any previous value. Use this on
 * privilege transitions (e.g. right after successful login) so a token that
 * may have been observed pre-auth can never be reused against the new
 * authenticated session.
 */
export function rotateCsrfToken(req: Request): string {
  const fresh = randomBytes(32).toString("hex");
  req.session[CSRF_SESSION_KEY] = fresh;
  return fresh;
}

/**
 * Middleware that validates the CSRF token on state-changing requests.
 * Token can be submitted via form field `_csrf` or the `x-csrf-token` header.
 */
export function csrfProtection(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const sessionToken = req.session[CSRF_SESSION_KEY] as string | undefined;
  if (!sessionToken) {
    res.status(403).send("CSRF token missing from session.");
    return;
  }

  const submittedToken =
    (req.body?._csrf as string | undefined) ||
    (req.headers[CSRF_HEADER] as string | undefined);

  if (!submittedToken || submittedToken !== sessionToken) {
    res.status(403).send("Invalid CSRF token.");
    return;
  }

  next();
}
