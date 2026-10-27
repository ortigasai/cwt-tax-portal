import { useState } from 'react';
import { Link } from 'react-router-dom';
import { etbTemplateUrl } from '../api/client';
import { useEtbJob } from '../etbJob';
import EtbProgress from '../components/EtbProgress';
import { formatDate } from '../utils/format';
import EtbResultsView from '../components/EtbResultsView';
import FileDropzone from '../components/FileDropzone';
import Icon from '../components/Icon';

export default function EtbCalculatorPage() {
  // The calculation runs in a shared job (see etbJob.tsx), so it keeps going and
  // keeps its result while you visit the ETB Dashboard and come back.
  const { job, start, dismiss } = useEtbJob();
  // YYYY-MM-DD from the date input; empty = every payment is treated as ETB.
  const [startDate, setStartDate] = useState(job.defaultStart);
  const busy = job.status === 'running';
  const file = job.file;
  const data = job.result;
  const error = job.error;

  const handleFile = (f: File) => start(f, startDate);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>New ETB calculation</h1>
          <p className="page-subtitle">
            Upload one Excel file listing your contracts with each one's ETB start date and every buyer is computed as ETB.
            The ledger, CTS notary date and SQM, zonal value and CWT remittances are the same data the CWT Portal uses.
            Every calculation is saved on the ETB Dashboard.
          </p>
        </div>
      </div>

      <div className="card">
        <h3>How it works</h3>
        <ol className="steps">
          <li>
            Fill an Excel file with two columns — <strong>Contract Number</strong> and <strong>Start Date of ETB</strong>{' '}
            (one row per contract; <a href={etbTemplateUrl()}>download the template</a>). Only payments dated{' '}
            <em>on or after</em> a contract's start date become per-collection ETB obligations (each payment's principal
            × 5%, due the 10th of the following month).
          </li>
          <li>
            A row with an empty date uses the optional <strong>default start date</strong> below; with neither, every
            payment of that contract is treated as ETB. A file with just a column of contract numbers still works.
          </li>
          <li>Drop the file below. Missing ledger / 1606 / CTS data is retrieved first.</li>
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
            <label htmlFor="etb-start">Default ETB start date (optional — for rows without a date)</label>
            <input id="etb-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
        </div>
        <FileDropzone
          accept=".xlsx,.xls"
          disabled={busy}
          title={busy ? 'Retrieving data and computing…' : 'Drop your contract list here'}
          hint={busy ? 'This can take up to a minute for contracts not loaded yet.' : '.xlsx or .xls — Contract Number and Start Date of ETB columns'}
          onFile={handleFile}
        />
        {job.status !== 'idle' && !busy && (
          <div className="btn-row" style={{ marginTop: 12 }}>
            <button className="btn btn-secondary" onClick={dismiss}>
              Start over
            </button>
            {file && (
              <button className="btn btn-secondary" onClick={() => start(file, startDate)}>
                <Icon name="refresh" /> Calculate “{file.name}” again with this default start date
              </button>
            )}
          </div>
        )}
        {busy && (
          <div className="callout callout-info" style={{ marginBottom: 0, marginTop: 12 }}>
            <div style={{ marginBottom: 6 }}>
              <span className="spinner" /> Working on “{job.fileName}”. You can open the ETB Dashboard meanwhile — it keeps
              running.
            </div>
            <EtbProgress job={job} />
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
                {data.perContractStarts
                  ? ` — start date per contract${data.startDate ? `, others from ${formatDate(data.startDate)}` : ''}`
                  : data.startDate
                    ? ` from ${formatDate(data.startDate)}`
                    : ' (all payments)'}
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
          <EtbResultsView startDate={data.startDate} runId={data.runId ?? null} results={data.results} errors={data.errors} />
        </div>
      )}
    </div>
  );
}
