import { Request, Response, NextFunction } from 'express';
import { verifySession, SESSION_COOKIE } from '../lib/auth';

// Blocks any request without a valid session cookie. Mounted after the
// public auth routes and health check, before every other /api route.
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const session = verifySession(req.cookies?.[SESSION_COOKIE]);
  if (!session) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  next();
}
