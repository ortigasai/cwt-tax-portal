import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchContracts, fetchSyncStatus, triggerSync, updateFromSharePoint, deleteContracts, allLedgersDownloadUrl } from '../api/client';
import type { ContractSummary, SharePointUpdateSummary, SyncStatus } from '../api/types';
import { formatCurrency, formatDate } from '../utils/format';
import StatusBadge from '../components/StatusBadge';

const POLL_INTERVAL_MS = 15_000;

function formatBatchDate(value: string | null): string {
  return value ? formatDate(value) : '';
}

interface BatchGroup {
  batchNumber: number;
  batchDate: string | null;
  count: number;
}

function groupByBatch(contracts: ContractSummary[]): BatchGroup[] {
  const map = new Map<number, BatchGroup>();
  for (const c of contracts) {
    if (c.batchNumber == null) continue;
    const existing = map.get(c.batchNumber);
    if (existing) existing.count += 1;
    else map.set(c.batchNumber, { batchNumber: c.batchNumber, batchDate: c.batchDate, count: 1 });
  }
  return [...map.values()].sort((a, b) => a.batchNumber - b.batchNumber);
}

// A real instant (not a pure calendar date), so the date portion is shown in
// the viewer's local time — zero-padded mm/dd/yyyy, then the local clock time.
function formatSyncTime(value: string | null | undefined): string {
  if (!value) return 'never';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'never';
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${mm}/${dd}/${yyyy} ${d.toLocaleTimeString('en-US')}`;
}

export default function Dashboard() {
  const [contracts, setContracts] = useState<ContractSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [sharePointUpdating, setSharePointUpdating] = useState(false);
  const [sharePointResult, setSharePointResult] = useState<SharePointUpdateSummary | null>(null);
  const [sharePointError, setSharePointError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  const load = (background: boolean) => {
    if (background) setRefreshing(true);
    fetchContracts()
      .then((data) => {
        setContracts(data);
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setRefreshing(false));
    fetchSyncStatus()
      .then(setSyncStatus)
      .catch(() => undefined);
  };

  const syncNow = () => {
    setSyncing(true);
    triggerSync(false)
      .then(() => load(true))
      .catch((e: Error) => setError(e.message))
      .finally(() => setSyncing(false));
  };

  const updateSharePointNow = () => {
    setSharePointUpdating(true);
    setSharePointError(null);
    setSharePointResult(null);
    updateFromSharePoint()
      .then((res) => {
        setSharePointResult(res);
        load(true);
      })
      .catch((e: Error) => setSharePointError(e.message))
      .finally(() => setSharePointUpdating(false));
  };

  const toggleOne = (contractNumber: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(contractNumber)) next.delete(contractNumber);
      else next.add(contractNumber);
      return next;
    });
  };

  const toggleAll = (contractNumbers: string[], checked: boolean) => {
    setSelected(checked ? new Set(contractNumbers) : new Set());
  };

  const deleteSelected = () => {
    const numbers = [...selected];
    if (numbers.length === 0) return;
    const msg =
      `Delete ${numbers.length} contract(s) from the system?\n\n${numbers.join(', ')}\n\n` +
      `This removes their ledger, remittance, and CTS data from the system now. Your source ` +
      `files are NOT touched. If a contract's file is still in the watched folder, the next ` +
      `sync will re-add it — remove the file from the folder to keep it out permanently.`;
    if (!window.confirm(msg)) return;
    setDeleting(true);
    deleteContracts(numbers)
      .then(() => {
        setSelected(new Set());
        load(true);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setDeleting(false));
  };

  // Initial load, then poll so files changed in the watched folder appear
  // automatically without a manual refresh.
  useEffect(() => {
    load(false);
    const id = setInterval(() => load(true), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  if (error) return <div className="callout callout-error">{error}</div>;
  if (!contracts) return <p className="muted">Loading…</p>;

  if (contracts.length === 0) {
    return (
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <h2>No contracts yet</h2>
          <button className="btn btn-secondary" onClick={syncNow} disabled={syncing}>
            {syncing ? 'Syncing…' : '🔄 Sync from folder now'}
          </button>
        </div>
        <p className="muted">
          Drop files in the data folder, then click "Sync from folder now" above, or{' '}
          <Link to="/upload">upload a list of contract numbers</Link> (which syncs the folder automatically as
          part of the upload).
        </p>
      </div>
    );
  }

  const underRemitted = contracts.filter((c) => c.status === 'UNDER_REMITTED');
  const totalExposure = underRemitted.reduce((sum, c) => sum + (c.variance ?? 0), 0);
  const totalPenalties = underRemitted.reduce((sum, c) => sum + c.totalPenalties, 0);
  const batches = groupByBatch(contracts);

  return (
    <div>
      <div className="stat-grid">
        <div className="stat-box">
          <div className="label">Contracts</div>
          <div className="value">{contracts.length}</div>
        </div>
        <div className="stat-box">
          <div className="label">Under-remitted</div>
          <div className="value">{underRemitted.length}</div>
        </div>
        <div className="stat-box">
          <div className="label">Total Exposure</div>
          <div className="value">{formatCurrency(totalExposure)}</div>
        </div>
        <div className="stat-box">
          <div className="label">Total Penalties</div>
          <div className="value">{formatCurrency(totalPenalties)}</div>
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <h3 style={{ margin: 0 }}>Folder Sync</h3>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              No automatic background sync — this reads the data folder only when you click below, or when you
              upload a contract number list. Last synced: {formatSyncTime(syncStatus?.last?.ranAt)}
              {syncStatus?.last && syncStatus.last.errors.length > 0 ? ` · ${syncStatus.last.errors.length} error(s)` : ''}
            </p>
            {syncStatus?.dataDir && (
              <p className="muted" style={{ margin: '2px 0 0', fontSize: '0.8em', wordBreak: 'break-all' }}>
                {syncStatus.dataDir}
              </p>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" onClick={syncNow} disabled={syncing}>
              {syncing ? 'Syncing…' : '🔄 Sync from folder now'}
            </button>
            <button className="btn btn-secondary" onClick={updateSharePointNow} disabled={sharePointUpdating}>
              {sharePointUpdating ? 'Updating…' : '☁️ Update from SharePoint'}
            </button>
          </div>
        </div>
        {syncStatus?.last && syncStatus.last.errors.length > 0 && (
          <div className="callout callout-error" style={{ marginTop: 8 }}>
            {syncStatus.last.errors.slice(0, 5).map((e, i) => (
              <div key={i}>{e}</div>
            ))}
          </div>
        )}
        {sharePointError && (
          <div className="callout callout-error" style={{ marginTop: 8 }}>
            {sharePointError}
          </div>
        )}
        {sharePointResult && (
          <div className="callout" style={{ marginTop: 8, background: '#dcfce7', color: '#166534' }}>
            <p style={{ margin: 0 }}>
              OCLP 1606: SharePoint copy last modified {formatSyncTime(sharePointResult.oclp.sharepointModifiedAt)} —{' '}
              {sharePointResult.oclp.baseContractMatched} contract(s) carried their existing Base Contract,{' '}
              {sharePointResult.oclp.baseContractSelfReferenced} new.
            </p>
            <p style={{ margin: '4px 0 0' }}>
              Zonal Value: {sharePointResult.zonalValue.skipped ? 'already up to date, not re-downloaded' : 'updated'}{' '}
              (SharePoint copy last modified {formatSyncTime(sharePointResult.zonalValue.sharepointModifiedAt)}).
            </p>
          </div>
        )}
      </div>

      {batches.length > 0 && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <h3 style={{ margin: 0 }}>Upload Batches</h3>
            <a className="btn btn-primary" href={allLedgersDownloadUrl()}>
              ⬇ Download All Ledgers (ZIP)
            </a>
          </div>
          <p className="muted" style={{ marginTop: 8 }}>
            Each contract-number upload is a numbered batch. Download all ledgers for a batch below.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
            {batches.map((b) => (
              <a
                key={b.batchNumber}
                className="btn btn-secondary"
                href={allLedgersDownloadUrl(b.batchNumber)}
                title={`Download the ${b.count} ledger(s) uploaded in Batch ${b.batchNumber}`}
              >
                ⬇ Batch {b.batchNumber}
                {b.batchDate ? ` · ${formatBatchDate(b.batchDate)}` : ''} ({b.count})
              </a>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8 }}>
          <button className="btn btn-danger" onClick={deleteSelected} disabled={deleting || selected.size === 0}>
            {deleting ? 'Deleting…' : `🗑 Delete selected${selected.size > 0 ? ` (${selected.size})` : ''}`}
          </button>
          <button className="btn btn-secondary" onClick={() => load(true)} disabled={refreshing}>
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        <table>
          <thead>
            <tr>
              <th style={{ width: 32, textAlign: 'center' }}>
                <input
                  type="checkbox"
                  checked={selected.size > 0 && selected.size === contracts.length}
                  ref={(el) => {
                    if (el) el.indeterminate = selected.size > 0 && selected.size < contracts.length;
                  }}
                  onChange={(e) => toggleAll(contracts.map((c) => c.contractNumber), e.target.checked)}
                  aria-label="Select all contracts"
                />
              </th>
              <th>Contract No.</th>
              <th>Batch</th>
              <th>Buyer's Name</th>
              <th>Tower</th>
              <th>Unit</th>
              <th>Buyer Classification</th>
              <th>Tax Tagging</th>
              <th>CWT Tax Base</th>
              <th>CWT Tax Due</th>
              <th>Total Penalties</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {contracts.map((c) => (
              <tr key={c.contractNumber} className={selected.has(c.contractNumber) ? 'row-selected' : undefined}>
                <td style={{ textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={selected.has(c.contractNumber)}
                    onChange={() => toggleOne(c.contractNumber)}
                    aria-label={`Select contract ${c.contractNumber}`}
                  />
                </td>
                <td>
                  <Link to={`/contracts/${encodeURIComponent(c.contractNumber)}`}>{c.contractNumber}</Link>
                </td>
                <td>
                  {c.batchNumber != null ? (
                    <span title={c.batchDate ? formatBatchDate(c.batchDate) : ''}>
                      Batch {c.batchNumber}
                      {c.batchDate ? <span className="muted"> · {formatBatchDate(c.batchDate)}</span> : ''}
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
                <td>{c.buyerName ?? '—'}</td>
                <td>{c.tower ?? '—'}</td>
                <td>{c.unit ?? '—'}</td>
                <td>{c.buyerClassification ?? '—'}</td>
                <td>{c.taxTagging ?? '—'}</td>
                <td>{formatCurrency(c.cwtTaxBase)}</td>
                <td>{formatCurrency(c.cwtTaxDue)}</td>
                <td>{formatCurrency(c.totalPenalties)}</td>
                <td>
                  <StatusBadge status={c.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
