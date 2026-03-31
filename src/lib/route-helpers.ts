import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";

/**
 * Wraps an async route handler and forwards any thrown errors to Express's
 * next() for centralized error handling.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}

/**
 * Returns true if the given string is a valid MongoDB ObjectId.
 */
export function isValidObjectId(id: string): boolean {
  return mongoose.Types.ObjectId.isValid(id);
}
