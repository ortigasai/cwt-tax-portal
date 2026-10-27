import fs from 'fs';
import path from 'path';
import { UPLOADS_DIR } from '../lib/fileStorage';

// The DOAS Notary Endorsement System (payment ledgers from Reviewed & Accepted,
// CTS date / SQM batches, LedgerFit sessions) now answers every /api request
// with 401 "Please sign in." until the caller holds a DOAS session. The portal
// has no DOAS login of its own, so it sends a session that someone with DOAS
// access supplies: either a Cookie header value (copied from a signed-in DOAS
// browser tab) or a service token, entered under Dashboard -> Data sources ->
// "DOAS connection", or set as DOAS_API_SESSION. It is only ever sent to
// DOAS_API_URL, only on GET requests, and is kept in a file outside the repo's
// tracked files (server/doas-session.json, git-ignored), never in the database.

export const DOAS_API_URL = (process.env.DOAS_API_URL ?? 'http://192.168.16.239:4100').replace(/\/+$/, '');
const SESSION_FILE = path.join(UPLOADS_DIR, '..', 'doas-session.json');

export class DoasSignInRequiredError extends Error {
  constructor() {
    super(
      'DOAS asks for a sign-in (HTTP 401). In the portal go to Dashboard → Data sources → DOAS connection and enter a DOAS session, or ask the DOAS team for a service token.',
    );
    this.name = 'DoasSignInRequiredError';
  }
}

function loadStored(): string | null {
  try {
    const j = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8')) as { session?: string };
    return j.session?.trim() || null;
  } catch {
    return null;
  }
}

let session: string | null = loadStored() ?? (process.env.DOAS_API_SESSION?.trim() || null);

// "name=value; name2=value2" is a Cookie header; anything else is a bearer token.
export function doasAuthHeaders(value: string | null = session): Record<string, string> {
  if (!value) return {};
  return value.includes('=') ? { Cookie: value } : { Authorization: `Bearer ${value}` };
}

export function setDoasSession(value: string): void {
  session = value.trim() || null;
  fs.writeFileSync(SESSION_FILE, JSON.stringify({ session }), { mode: 0o600 });
}

export function clearDoasSession(): void {
  session = null;
  try {
    fs.rmSync(SESSION_FILE);
  } catch {
    // nothing stored
  }
}

// GET against DOAS with the configured session. A 401 becomes a clear error.
export async function doasFetch(apiPath: string, timeoutMs: number): Promise<Response> {
  const res = await fetch(`${DOAS_API_URL}${apiPath}`, {
    headers: doasAuthHeaders(),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 401) throw new DoasSignInRequiredError();
  return res;
}

export type DoasConnectionState = 'connected' | 'signin_required' | 'unreachable';

export async function doasConnectionStatus(): Promise<{
  state: DoasConnectionState;
  sessionSet: boolean;
  detail: string | null;
}> {
  const sessionSet = session !== null;
  try {
    const res = await doasFetch('/api/batches', 15_000);
    return res.ok
      ? { state: 'connected', sessionSet, detail: null }
      : { state: 'unreachable', sessionSet, detail: `DOAS answered HTTP ${res.status}` };
  } catch (e) {
    if (e instanceof DoasSignInRequiredError) {
      return {
        state: 'signin_required',
        sessionSet,
        detail: sessionSet ? 'DOAS rejected the saved session — it has probably expired.' : 'No DOAS session is set.',
      };
    }
    return { state: 'unreachable', sessionSet, detail: (e as Error).message };
  }
}
