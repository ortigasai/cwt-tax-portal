import { useState } from 'react';
import { Link } from 'react-router-dom';
import { uploadContractList } from '../api/client';
import type { ContractSummary, UploadIntakeSummary } from '../api/types';
import { formatCurrency } from '../utils/format';
import StatusBadge from '../components/StatusBadge';
import FileDropzone from '../components/FileDropzone';
import Icon from '../components/Icon';

interface UploadResult {
  totalFound: number;
  created: number;
  alreadyExisted: number;
  batchNumber: number;
  batchTitle: string;
  intake: UploadIntakeSummary;
  results: ContractSummary[];
}

export default function UploadPage() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
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
    <div>
      <div className="page-header">
        <div>
          <h1>Upload contracts</h1>
          <p className="page-subtitle">
            Upload an Excel list of contract numbers. The data is retrieved and the CWT exposure computed right away.
          </p>
        </div>
      </div>

      <div className="card">
        <h3>What happens when you upload</h3>
        <ol className="steps">
          <li>
            The file becomes a numbered <strong>batch</strong>, titled after the file (rename it anytime from the
            Dashboard).
          </li>
          <li>
            For just the contracts in the file, the portal retrieves each <strong>Customer Ledger</strong>, the{' '}
            <strong>OCLP 1606 Summary</strong> (FINAL tab) and the <strong>CTS</strong> from SharePoint.
          </li>
          <li>
            The <strong>CTS notary date</strong>, <strong>unit / parking SQM</strong> and the matching{' '}
            <strong>zonal value</strong> are filled in from the DOAS endorsement batches (empty fields only — anything
            you typed in stays).
          </li>
          <li>
            The <strong>CWT exposure</strong> is computed straight away — nothing else is synced, and SharePoint is only
            ever read, never changed.
          </li>
        </ol>
        <p className="hint">
          Use a column of contract numbers (a header containing “Contract” is detected automatically; otherwise column A
          is used).
        </p>
      </div>

      <div className="card">
        <FileDropzone
          accept=".xlsx,.xls"
          disabled={busy}
          title={busy ? 'Uploading and retrieving data…' : 'Drop your Excel file here'}
          hint={busy ? 'This can take up to a minute the first time.' : '.xlsx or .xls — one column of contract numbers'}
          onFile={handleFile}
        />
        {busy && (
          <div className="loading" style={{ padding: '4px 0 0' }}>
            <span className="spinner" /> Retrieving ledgers, 1606 remittances and CTS files…
          </div>
        )}
        {error && (
          <div className="callout callout-error" style={{ marginBottom: 0 }}>
            {error}
          </div>
        )}
      </div>

      {result && (
        <div className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">
                <Icon name="check" /> Saved as Batch {result.batchNumber} — “{result.batchTitle}”
              </h3>
              <p className="card-subtitle">
                {result.totalFound} contract number(s) found · {result.created} new · {result.alreadyExisted} already existed
              </p>
            </div>
            <Link className="btn btn-secondary btn-sm" to="/">
              Go to dashboard
            </Link>
          </div>

          <div className="stat-grid">
            <div className="stat-box stat-success">
              <div className="label">Ledgers loaded</div>
              <div className="value">
                {result.intake.ledgersLoaded.length} / {result.totalFound}
              </div>
              <div className="sub">
                {result.intake.ledgersNotFound.length > 0
                  ? `none found for ${result.intake.ledgersNotFound.length}`
                  : 'all found'}
                {(result.intake.ledgersFromReviewed?.length ?? 0) > 0
                  ? ` · ${result.intake.ledgersFromReviewed!.length} from Reviewed & Accepted`
                  : ''}
              </div>
            </div>
            <div className="stat-box stat-success">
              <div className="label">CTS on file</div>
              <div className="value">
                {result.intake.ctsOnFile.length} / {result.totalFound}
              </div>
              <div className="sub">
                {result.intake.ctsFetched.length > 0 ? `${result.intake.ctsFetched.length} fetched just now` : 'nothing new fetched'}
              </div>
            </div>
            <div className="stat-box stat-success">
              <div className="label">Notary date &amp; SQM</div>
              <div className="value">
                {result.intake.ctsDataComplete.length} / {result.totalFound}
              </div>
              <div className="sub">
                {result.intake.ctsDataFilled.length > 0
                  ? `${result.intake.ctsDataFilled.length} filled from DOAS batches`
                  : 'nothing new to fill'}
              </div>
            </div>
            <div className="stat-box">
              <div className="label">OCLP 1606</div>
              <div className="value" style={{ fontSize: 17 }}>
                {result.intake.oclp.refreshedFromSharePoint ? 'Refreshed' : 'Already current'}
              </div>
              <div className="sub">
                {result.intake.oclp.matchedRows != null ? `${result.intake.oclp.matchedRows} remittance row(s) linked` : '—'}
              </div>
            </div>
          </div>

          {(result.intake.ledgersNotReviewed?.length ?? 0) > 0 && (
            <div className="callout callout-info">
              <strong>
                {result.intake.ledgersNotReviewed!.length} ledger(s) are not in Reviewed &amp; Accepted yet
              </strong>{' '}
              — loaded from a SharePoint/local file instead, so treat their figures as provisional:{' '}
              {result.intake.ledgersNotReviewed!.slice(0, 10).join(', ')}
              {result.intake.ledgersNotReviewed!.length > 10 ? ', …' : ''}.
            </div>
          )}

          {(result.intake.ledgersNotFoundAdvice?.length ?? 0) > 0 && (
            <div className="callout callout-info">
              <strong>No ledger found for {result.intake.ledgersNotFoundAdvice!.length} contract(s):</strong>
              {result.intake.ledgersNotFoundAdvice!.slice(0, 10).map((l) => (
                <div key={l.contractNumber}>
                  {l.contractNumber} — {l.advice}
                </div>
              ))}
              {result.intake.ledgersNotFoundAdvice!.length > 10 && (
                <div>…and {result.intake.ledgersNotFoundAdvice!.length - 10} more.</div>
              )}
            </div>
          )}

          {(result.intake.ledgersNotLatest?.length ?? 0) > 0 && (
            <div className="callout callout-error">
              <strong>
                {result.intake.ledgersNotLatest!.length} ledger(s) are not LedgerFit's latest — clearing documents
                outside the 14 series.
              </strong>
              {result.intake.ledgersNotLatest!.map((l) => (
                <div key={l.contractNumber}>
                  {l.contractNumber} · {l.fileName} · {l.nonCurrentDocs} row(s) e.g. {l.sample.join(', ')} — {l.advice}
                </div>
              ))}
            </div>
          )}

          {result.intake.errors.length > 0 && (
            <div className="callout callout-error">
              {result.intake.errors.map((e, i) => (
                <div key={i}>{e}</div>
              ))}
            </div>
          )}

          {result.results.length > 0 && (
            <>
              <table>
                <thead>
                  <tr>
                    <th>Contract No.</th>
                    <th>Buyer's Name</th>
                    <th>Ledger</th>
                    <th>CTS</th>
                    <th className="num">CWT Tax Base</th>
                    <th className="num">CWT Tax Due</th>
                    <th className="num">Variance</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {result.results.map((c) => (
                    <tr key={c.contractNumber}>
                      <td>
                        <Link className="cell-link" to={`/contracts/${encodeURIComponent(c.contractNumber)}`}>
                          {c.contractNumber}
                        </Link>
                      </td>
                      <td>{c.buyerName ?? '—'}</td>
                      <td>{result.intake.ledgersLoaded.includes(c.contractNumber) ? '✓' : '—'}</td>
                      <td>{result.intake.ctsOnFile.includes(c.contractNumber) ? '✓' : '—'}</td>
                      <td className="num">{formatCurrency(c.cwtTaxBase)}</td>
                      <td className="num">{formatCurrency(c.cwtTaxDue)}</td>
                      <td className={`num${c.variance != null && c.variance > 0 ? ' neg' : ''}`}>{formatCurrency(c.variance)}</td>
                      <td>
                        <StatusBadge status={c.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {result.results.some((c) => c.status === 'MISSING_DATA') && (
                <div className="callout callout-info" style={{ marginTop: 14, marginBottom: 0 }}>
                  “Missing data” means a figure the computation needs isn't on file yet — typically a CTS notary date or
                  SQM that isn't in the DOAS batches either, or no ledger was found for that contract. Open the contract
                  to see which.
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
