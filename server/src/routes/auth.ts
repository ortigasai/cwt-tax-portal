import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { signSession, verifySession, SESSION_COOKIE, SESSION_MAX_AGE_MS } from '../lib/auth';

export const authRouter = Router();

// POST /api/auth/login — { username, password } -> sets a signed session
// cookie on success. Single shared credential for the whole tax team (see
// server/.env AUTH_USERNAME / AUTH_PASSWORD_HASH), not per-user accounts.
authRouter.post('/login', async (req, res) => {
  const { username, password } = req.body as { username?: unknown; password?: unknown };
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'username and password are required' });
  }

  const expectedUsername = process.env.AUTH_USERNAME ?? '';
  const expectedHash = process.env.AUTH_PASSWORD_HASH ?? '';
  const usernameOk = username === expectedUsername;
  const passwordOk = expectedHash ? await bcrypt.compare(password, expectedHash) : false;

  if (!usernameOk || !passwordOk) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const token = signSession(username);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE_MS,
  });
  res.json({ ok: true });
});

// POST /api/auth/logout — clears the session cookie.
authRouter.post('/logout', (_req, res) => {
  res.clearCookie(SESSION_COOKIE);
  res.json({ ok: true });
});

// GET /api/auth/me — whether the current request carries a valid session.
authRouter.get('/me', (req, res) => {
  const session = verifySession(req.cookies?.[SESSION_COOKIE]);
  res.json({ authenticated: session !== null });
});
