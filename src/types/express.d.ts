declare namespace Express {
  interface Request {
    user?: {
      uid: string;
      email?: string;
      /**
       * Mongo `_id` of the authenticated user's document, resolved once by
       * `requireAuth`. Undefined when no user doc exists yet (first sign-in
       * before profile creation). Handlers should use this instead of
       * re-querying `User.findOne({ firebaseUid })` for the id.
       */
      userId?: string;
    };
    adminUserId?: string;
    requestId?: string;
  }
}
