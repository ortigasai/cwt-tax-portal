import { useEffect, useState } from 'react';
import { clearDoasSession, fetchDoasStatus, saveDoasSession, type DoasConnection as Status } from '../api/client';

// DOAS (payment ledgers from Reviewed & Accepted, CTS date / SQM) answers
// "Please sign in" unless the portal sends a DOAS session. This shows whether
// it currently accepts the portal and lets someone with DOAS access paste one.
export default function DoasConnection() {
  const [status, setStatus] = useState<Status | null>(null);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDoasStatus()
      .then(setStatus)
      .catch(() => undefined);
  }, []);

  const save = () => {
    setBusy(true);
    setError(null);
    saveDoasSession(value)
      .then((s) => {
        setStatus(s);
        if (s.state === 'connected') {
          setValue('');
          setOpen(false);
        } else {
          setError(s.detail ?? 'DOAS did not accept it.');
        }
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };

  const forget = () => {
    setBusy(true);
    clearDoasSession()
      .then(setStatus)
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };

  const label =
    status === null
      ? 'checking…'
      : status.state === 'connected'
        ? 'connected'
        : status.state === 'signin_required'
          ? 'sign-in required'
          : 'not reachable';
  const tone = status?.state === 'connected' ? 'badge-compliant' : status ? 'badge-missing-data' : '';

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <strong>DOAS connection</strong>
        <span className={`badge ${tone}`}>{label}</span>
        <span className="hint" style={{ margin: 0 }}>
          Payment ledgers (Reviewed &amp; Accepted) and CTS date / SQM come from DOAS.
          {status?.state !== 'connected' && status?.detail ? ` ${status.detail}` : ''}
        </span>
        <button className="btn btn-secondary btn-sm" onClick={() => setOpen((o) => !o)}>
          {open ? 'Close' : status?.sessionSet ? 'Change DOAS sign-in' : 'Set DOAS sign-in'}
        </button>
        {status?.sessionSet && (
          <button className="btn btn-secondary btn-sm" onClick={forget} disabled={busy}>
            Forget it
          </button>
        )}
      </div>
      {open && (
        <div style={{ marginTop: 8 }}>
          <textarea
            className="inline-input"
            rows={3}
            style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }}
            placeholder="Paste the DOAS session here — the Cookie value, or a service token"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-label="DOAS session"
          />
          <p className="hint">
            Easiest way: sign in to DOAS in your browser, press F12 → Network, click any <code>/api/…</code> request and
            copy the <code>Cookie</code> request header value (or ask the DOAS team for a service token). It is saved on
            the portal server only, sent only to DOAS, and it expires when the DOAS session does — if the status turns to
            “sign-in required” again, paste a fresh one.
          </p>
          <button className="btn btn-sm" onClick={save} disabled={busy || value.trim() === ''}>
            {busy ? 'Testing…' : 'Save and test'}
          </button>
        </div>
      )}
      {error && (
        <div className="callout callout-error" style={{ marginTop: 8, marginBottom: 0 }}>
          {error}
        </div>
      )}
    </div>
  );
}
