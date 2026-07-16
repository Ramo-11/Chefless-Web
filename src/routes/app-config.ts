import { Router, Request, Response, NextFunction } from "express";
import { requireAuth } from "../middleware/auth";
import { getAppConfig, toAppConfigPayload } from "../lib/app-config";

const router = Router();

function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}

// GET /api/app-config — runtime feature flags the app needs to honor.
// `wrappedEnabled` is computed per-request: true when the global flag is on
// OR when the caller is in the per-user test list.
router.get(
  "/",
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user?.userId;
    const config = await getAppConfig();
    if (!userId) {
      // Unknown user (signed up with Firebase but hasn't completed registration
      // yet) — treat as not in the test list. Global flag still applies.
      res.status(200).json({
        wrappedEnabled: config.wrappedEnabled,
        wrappedYear: config.wrappedYear ?? new Date().getUTCFullYear(),
        wrappedRevision: config.wrappedRevision,
      });
      return;
    }
    res.status(200).json(toAppConfigPayload(config, userId));
  })
);

export default router;
