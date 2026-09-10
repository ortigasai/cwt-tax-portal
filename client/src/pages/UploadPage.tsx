import { useState } from 'react';
import { Link } from 'react-router-dom';
import { uploadContractList } from '../api/client';
import type { SyncSummary } from '../api/types';

export default function UploadPage() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    totalFound: number;
    created: number;
    alreadyExisted: number;
    syncSummary: SyncSummary;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await uploadContractList(file);
      setResult(res);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>Upload Contract Numbers</h2>
      <p className="muted">
        Upload an Excel file with a column of contract numbers (a header containing "Contract" is auto-detected;
        otherwise column A is used). Each contract number creates a record, and its Customer Ledger, CTS, and OCLP
        1606 data is pulled in immediately from the watched data folder — there's no separate step needed
        afterward (there's no automatic background sync anymore; this upload and the dashboard's "Sync from folder
        now" button are the only times that folder is read).
      </p>

      <div className="upload-box">
        <input
          type="file"
          accept=".xlsx,.xls"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
      </div>

      {busy && <p className="muted">Uploading…</p>}
      {error && <div className="callout callout-error">{error}</div>}
      {result && (
        <div className="callout" style={{ background: '#dcfce7', color: '#166534' }}>
          <p style={{ margin: '0 0 8px' }}>
            Found {result.totalFound} contract number(s) — {result.created} newly created, {result.alreadyExisted}{' '}
            already existed.
          </p>
          <p style={{ margin: 0 }}>
            From the data folder: {result.syncSummary.ledgersLoaded.length} customer ledger(s) loaded, OCLP 1606{' '}
            {result.syncSummary.oclpLoaded ? 'reloaded' : 'unchanged'}, {result.syncSummary.ctsAttached.length} CTS
            file(s) attached.
          </p>
          {result.syncSummary.errors.length > 0 && (
            <div className="callout callout-error" style={{ marginTop: 8 }}>
              {result.syncSummary.errors.map((e, i) => (
                <div key={i}>{e}</div>
              ))}
            </div>
          )}
          <p style={{ margin: '8px 0 0' }}>
            <Link to="/">Go to the dashboard</Link>.
          </p>
        </div>
      )}
    </div>
  );
}
