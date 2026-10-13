import { useState } from 'react';
import { Link } from 'react-router-dom';
import { computeEtb } from '../api/client';
import type { EtbComputeResponse } from '../api/types';
import { formatDate } from '../utils/format';
import EtbResultsView from '../components/EtbResultsView';
import FileDropzone from '../components/FileDropzone';
import Icon from '../components/Icon';

export default function EtbCalculatorPage() {
  const [file, setFile] = useState<File | null>(null);
  // YYYY-MM-DD from the date input; empty = every payment is treated as ETB.
  const [startDate, setStartDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<EtbComputeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(f: File, start: string) {
    setBusy(true);
    setError(null);
    try {
      setData(await computeEtb(f, start));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const handleFile = (f: File) => {
    setFile(f);
    setData(null);
    void run(f, startDate);
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>New ETB calculation</h1>
          <p className="page-subtitle">
            Upload contract numbers and every buyer is computed as ETB. The ledger, CTS notary date and SQM, zonal value
            and CWT remittances are the same data the CWT Portal uses. Every calculation is saved on the ETB Dashboard.
          </p>
        </div>
      </div>

      <div className="card">
        <h3>How it works</h3>
        <ol className="steps">
          <li>
            Optionally set the <strong>ETB start date</strong>. Only payments dated <em>on or after</em> it become
            per-collection ETB obligations (each payment's principal × 5%, due the 10th of the following month). Leave it
            blank to treat every payment as ETB.
          </li>
          <li>Drop an Excel file with one column of contract numbers. Missing ledger / 1606 / CTS data is retrieved first.</li>
          <li>
            Every contract is treated as an <strong>ETB buyer on installment terms</strong>, whatever its stored
            classification (Individual, Corporation…) or tax tagging (Installment, Cash Deferred, AR Sale…). The
            contract's own stored values are <strong>not</strong> changed — this is a what-if view, and the "Stored as"
            column shows what each contract is recorded as.
          </li>
        </ol>
      </div>

      <div className="card">
        <div className="form-grid" style={{ marginBottom: 14 }}>
          <div className="field">
            <label htmlFor="etb-start">ETB start date (optional)</label>
            <input id="etb-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
        </div>
        <FileDropzone
          accept=".xlsx,.xls"
          disabled={busy}
          title={busy ? 'Retrieving data and computing…' : 'Drop your contract list here'}
          hint={busy ? 'This can take up to a minute for contracts not loaded yet.' : '.xlsx or .xls — one column of contract numbers'}
          onFile={handleFile}
        />
        {file && !busy && (
          <div className="btn-row" style={{ marginTop: 12 }}>
            <button className="btn btn-secondary" onClick={() => void run(file, startDate)}>
              <Icon name="refresh" /> Calculate “{file.name}” again with this start date
            </button>
          </div>
        )}
        {busy && (
          <div className="loading" style={{ padding: '4px 0 0' }}>
            <span className="spinner" /> Working…
          </div>
        )}
        {error && (
          <div className="callout callout-error" style={{ marginBottom: 0 }}>
            {error}
          </div>
        )}
      </div>

      {data && (
        <div className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">
                <Icon name="check" /> {data.runTitle ?? 'ETB calculation'} — {data.totalFound} contract(s) computed as ETB
                {data.startDate ? ` from ${formatDate(data.startDate)}` : ' (all payments)'}
              </h3>
              <p className="card-subtitle">
                {data.retrievedFor > 0 ? `Data retrieved for ${data.retrievedFor} contract(s). ` : 'All data was already on file. '}
                {data.ctsFilled > 0 ? `CTS notary date / SQM filled for ${data.ctsFilled}.` : ''}
                {data.runId != null ? ' Saved on the ETB Dashboard.' : ''}
              </p>
            </div>
            <Link className="btn btn-secondary btn-sm" to={data.runId != null ? `/etb?run=${data.runId}` : '/etb'}>
              Open on ETB Dashboard
            </Link>
          </div>
          <EtbResultsView startDate={data.startDate} results={data.results} errors={data.errors} />
        </div>
      )}
    </div>
  );
}
