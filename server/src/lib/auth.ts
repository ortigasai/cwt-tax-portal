import crypto from 'crypto';

// Stateless signed session token: base64url(JSON payload) + "." + HMAC-SHA256
// signature, keyed by SESSION_SECRET. No DB/session store needed since this
// is a single shared login for the whole tax team, not per-user accounts.
export const SESSION_COOKIE = 'cwt_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — internal tool, low friction

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error('SESSION_SECRET is not set');
  return s;
}

function base64url(input: Buffer): string {
  return input.toString('base64url');
}

export function signSession(username: string): string {
  const payload = JSON.stringify({ u: username, exp: Date.now() + SESSION_TTL_MS });
  const body = base64url(Buffer.from(payload, 'utf8'));
  const sig = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifySession(token: string | undefined | null): { username: string } | null {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expectedSig = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  // Constant-time comparison to avoid timing attacks on the signature check.
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { u: string; exp: number };
    if (typeof payload.exp !== 'number' || Date.now() > payload.exp) return null;
    return { username: payload.u };
  } catch {
    return null;
  }
}

export const SESSION_MAX_AGE_MS = SESSION_TTL_MS;
