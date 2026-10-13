import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  fetchContracts,
  fetchSyncStatus,
  triggerSync,
  updateFromSharePoint,
  deleteContracts,
  allLedgersDownloadUrl,
  ledgerDownloadUrl,
  selectedLedgersDownloadUrl,
  renameBatch,
  retrieveCtsData,
} from '../api/client';
import type { ContractSummary, CtsDataResult, ExposureStatus, SharePointUpdateSummary, SyncStatus } from '../api/types';
import { formatCurrency, formatDate } from '../utils/format';
import StatusBadge from '../components/StatusBadge';
import Icon from '../components/Icon';

const POLL_INTERVAL_MS = 15_000;

function formatBatchDate(value: string | null): string {
  return value ? formatDate(value) : '';
}

interface BatchGroup {
  batchNumber: number;
  batchTitle: string | null;
  batchDate: string | null;
  count: number;
}

function groupByBatch(contracts: ContractSummary[]): BatchGroup[] {
  const map = new Map<number, BatchGroup>();
  for (const c of contracts) {
    if (c.batchNumber == null) continue;
    const existing = map.get(c.batchNumber);
    if (existing) existing.count += 1;
    else
      map.set(c.batchNumber, {
        batchNumber: c.batchNumber,
        batchTitle: c.batchTitle,
        batchDate: c.batchDate,
        count: 1,
      });
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

// ---- Table columns: label, how to sort by it, and whether it's numeric ----

type SortKey =
  | 'contractNumber'
  | 'batch'
  | 'buyerName'
  | 'tower'
  | 'unit'
  | 'buyerClassification'
  | 'taxTagging'
  | 'cwtTaxBase'
  | 'cwtTaxDue'
  | 'variance'
  | 'totalPenalties'
  | 'status'
  | 'analysis';

interface Column {
  key: SortKey;
  label: string;
  numeric?: boolean;
}

const COLUMNS: Column[] = [
  { key: 'contractNumber', label: 'Contract No.' },
  { key: 'batch', label: 'Batch' },
  { key: 'buyerName', label: "Buyer's Name" },
  { key: 'tower', label: 'Tower' },
  { key: 'unit', label: 'Unit' },
  { key: 'buyerClassification', label: 'Buyer Classification' },
  { key: 'taxTagging', label: 'Tax Tagging' },
  { key: 'cwtTaxBase', label: 'CWT Tax Base', numeric: true },
  { key: 'cwtTaxDue', label: 'CWT Tax Due', numeric: true },
  { key: 'variance', label: 'Variance', numeric: true },
  { key: 'totalPenalties', label: 'Total Penalties', numeric: true },
  { key: 'status', label: 'Status' },
  { key: 'analysis', label: 'Analysis' },
];

// Problems first when sorting by status.
const STATUS_RANK: Record<ExposureStatus, number> = { UNDER_REMITTED: 0, NON_COMPLIANT: 1, MISSING_DATA: 2, COMPLIANT: 3 };

// Ready-to-download first when sorting by analysis.
const ANALYSIS_RANK = { DONE: 0, PROVISIONAL: 1, PENDING: 2 } as const;

function sortValue(c: ContractSummary, key: SortKey): string | number | null {
  switch (key) {
    case 'contractNumber':
      return c.contractNumber;
    case 'batch':
      return c.batchNumber;
    case 'status':
      return STATUS_RANK[c.status];
    case 'analysis':
      return ANALYSIS_RANK[c.analysis?.state ?? 'PENDING'];
    default:
      return c[key];
  }
}

function compareValues(a: string | number | null, b: string | number | null): number {
  // Blanks always sink to the bottom, regardless of direction (handled by the caller).
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

function searchText(c: ContractSummary): string {
  return [
    c.contractNumber,
    c.buyerName,
    c.tower,
    c.unit,
    c.buyerClassification,
    c.taxTagging,
    c.batchNumber != null ? `batch ${c.batchNumber}` : null,
    c.batchTitle,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

type StatusFilter = 'ALL' | ExposureStatus;

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'UNDER_REMITTED', label: 'Under-remitted' },
  { value: 'NON_COMPLIANT', label: 'Not compliant' },
  { value: 'MISSING_DATA', label: 'Missing data' },
  { value: 'COMPLIANT', label: 'Compliant' },
];

export default function Dashboard() {
  const [contracts, setContracts] = useState<ContractSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [sharePointUpdating, setSharePointUpdating] = useState(false);
  const [sharePointResult, setSharePointResult] = useState<SharePointUpdateSummary | null>(null);
  const [sharePointError, setSharePointError] = useState<string | null>(null);
  const [ctsFilling, setCtsFilling] = useState(false);
  const [ctsResult, setCtsResult] = useState<CtsDataResult | null>(null);
  const [ctsError, setCtsError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  // Inline batch rename: which batch is being edited, its draft title, and
  // any error from saving it.
  const [editingBatch, setEditingBatch] = useState<number | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  // Table view state: search text, status filter, and sort.
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' } | null>(null);

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

  const startRename = (b: BatchGroup) => {
    setEditingBatch(b.batchNumber);
    setDraftTitle(b.batchTitle ?? '');
    setRenameError(null);
  };

  const cancelRename = () => {
    setEditingBatch(null);
    setRenameError(null);
  };

  const saveRename = () => {
    if (editingBatch == null) return;
    setRenaming(true);
    setRenameError(null);
    renameBatch(editingBatch, draftTitle)
      .then(() => {
        setEditingBatch(null);
        load(true);
      })
      .catch((e: Error) => setRenameError(e.message))
      .finally(() => setRenaming(false));
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

  const fillCtsDataNow = () => {
    setCtsFilling(true);
    setCtsError(null);
    setCtsResult(null);
    retrieveCtsData()
      .then((res) => {
        setCtsResult(res);
        load(true);
      })
      .catch((e: Error) => setCtsError(e.message))
      .finally(() => setCtsFilling(false));
  };

  const toggleOne = (contractNumber: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(contractNumber)) next.delete(contractNumber);
      else next.add(contractNumber);
      return next;
    });
  };

  // Select-all acts on the rows currently shown, not on contracts hidden by a
  // filter.
  const toggleAll = (contractNumbers: string[], checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const n of contractNumbers) {
        if (checked) next.add(n);
        else next.delete(n);
      }
      return next;
    });
  };

  const toggleSort = (key: SortKey) => {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: 'asc' };
      if (prev.dir === 'asc') return { key, dir: 'desc' };
      return null; // third click returns to the original order
    });
  };

  // Changing what's visible clears the selection, so "Delete selected" can
  // never act on rows the user can no longer see.
  const changeQuery = (value: string) => {
    setQuery(value);
    setSelected(new Set());
  };
  const changeStatusFilter = (value: StatusFilter) => {
    setStatusFilter(value);
    setSelected(new Set());
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

  // Initial load, then poll so changes appear without a manual refresh.
  useEffect(() => {
    load(false);
    const id = setInterval(() => load(true), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = { ALL: 0, UNDER_REMITTED: 0, NON_COMPLIANT: 0, MISSING_DATA: 0, COMPLIANT: 0 };
    for (const row of contracts ?? []) {
      c.ALL += 1;
      c[row.status] += 1;
    }
    return c;
  }, [contracts]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = (contracts ?? []).filter(
      (c) => (statusFilter === 'ALL' || c.status === statusFilter) && (!q || searchText(c).includes(q)),
    );
    if (!sort) return rows;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = sortValue(a, sort.key);
      const bv = sortValue(b, sort.key);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return compareValues(av, bv) * dir;
    });
  }, [contracts, query, statusFilter, sort]);

  if (error && !contracts) {
    return (
      <div className="callout callout-error">
        <p>{error}</p>
        <button className="btn btn-secondary btn-sm" onClick={() => load(false)}>
          <Icon name="refresh" /> Try again
        </button>
      </div>
    );
  }
  if (!contracts) {
    return (
      <div className="loading">
        <span className="spinner" /> Loading contracts…
      </div>
    );
  }

  if (contracts.length === 0) {
    return (
      <div className="card">
        <div className="empty-state">
          <Icon name="inbox" size={40} />
          <h2>No contracts yet</h2>
          <p>
            Upload an Excel list of contract numbers and the portal will pull each contract's ledger, 1606 remittances
            and CTS, then compute its CWT exposure.
          </p>
          <div className="btn-row">
            <Link className="btn" to="/upload">
              <Icon name="upload" /> Upload contract numbers
            </Link>
            <button className="btn btn-secondary" onClick={syncNow} disabled={syncing}>
              <Icon name="refresh" /> {syncing ? 'Syncing…' : 'Sync from data folder'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // "Not compliant" = any computed penalty: under-remitted in total, or a late
  // payment whose penalty was computed even though the totals tie out.
  const underRemitted = contracts.filter((c) => c.status === 'UNDER_REMITTED' || c.status === 'NON_COMPLIANT');
  const totalExposure = underRemitted.reduce((sum, c) => sum + Math.max(0, c.variance ?? 0), 0);
  const totalPenalties = underRemitted.reduce((sum, c) => sum + c.totalPenalties, 0);
  const analysisDone = contracts.filter((c) => c.analysis?.state === 'DONE').length;
  const analysisProvisional = contracts.filter((c) => c.analysis?.state === 'PROVISIONAL').length;
  const batches = groupByBatch(contracts);

  const readyVisible = visible.filter((c) => c.analysis && c.analysis.state !== 'PENDING').map((c) => c.contractNumber);
  const selectedReady = visible
    .filter((c) => selected.has(c.contractNumber) && c.analysis && c.analysis.state !== 'PENDING')
    .map((c) => c.contractNumber);
  const visibleNumbers = visible.map((c) => c.contractNumber);
  const selectedVisible = visibleNumbers.filter((n) => selected.has(n)).length;
  const allVisibleSelected = visibleNumbers.length > 0 && selectedVisible === visibleNumbers.length;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p className="page-subtitle">CWT exposure across {contracts.length} contract(s).</p>
        </div>
      </div>

      {error && <div className="callout callout-error">Couldn't refresh: {error}</div>}

      <div className="stat-grid">
        <div className="stat-box">
          <div className="label">Contracts</div>
          <div className="value">{contracts.length}</div>
          <div className="sub">
            {counts.COMPLIANT} compliant · {counts.MISSING_DATA} missing data
          </div>
        </div>
        <div className={`stat-box ${underRemitted.length > 0 ? 'stat-danger' : 'stat-success'}`}>
          <div className="label">Not compliant</div>
          <div className="value">{underRemitted.length}</div>
          <div className="sub">{underRemitted.length > 0 ? 'need follow-up' : 'nothing outstanding'}</div>
        </div>
        <div className={`stat-box ${analysisDone === contracts.length && contracts.length > 0 ? 'stat-success' : 'stat-neutral'}`}>
          <div className="label">Analysis done</div>
          <div className="value">
            {analysisDone} / {contracts.length}
          </div>
          <div className="sub">
            {analysisProvisional > 0 ? `${analysisProvisional} provisional · ` : ''}
            ledger ready to download
          </div>
        </div>
        <div className={`stat-box ${totalExposure > 0 ? 'stat-danger' : 'stat-neutral'}`}>
          <div className="label">Total Exposure</div>
          <div className="value">{formatCurrency(totalExposure)}</div>
          <div className="sub">unremitted CWT, before penalties</div>
        </div>
        <div className={`stat-box ${totalPenalties > 0 ? 'stat-danger' : 'stat-neutral'}`}>
          <div className="label">Total Penalties</div>
          <div className="value">{formatCurrency(totalPenalties)}</div>
          <div className="sub">surcharge, compromise, interest</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div>
            <h3 className="card-title">Data sources</h3>
            <p className="card-subtitle">
              Nothing syncs automatically. Last synced: {formatSyncTime(syncStatus?.last?.ranAt)}
              {syncStatus?.last && syncStatus.last.errors.length > 0 ? ` · ${syncStatus.last.errors.length} error(s)` : ''}
            </p>
          </div>
          <div className="btn-row">
            <button className="btn btn-secondary" onClick={syncNow} disabled={syncing}>
              <Icon name="folder" /> {syncing ? 'Syncing…' : 'Sync from data folder'}
            </button>
            <button className="btn btn-secondary" onClick={updateSharePointNow} disabled={sharePointUpdating}>
              <Icon name="cloud" /> {sharePointUpdating ? 'Updating…' : 'Update from SharePoint'}
            </button>
            <button className="btn btn-secondary" onClick={fillCtsDataNow} disabled={ctsFilling}>
              <Icon name="file" /> {ctsFilling ? 'Retrieving…' : 'Fill CTS data (DOAS batches)'}
            </button>
          </div>
        </div>
        <p className="hint">
          Uploading a contract list retrieves data for just those contracts; these buttons read the whole data folder
          {syncStatus?.dataDir ? ` (${syncStatus.dataDir})` : ''}, refresh the shared SharePoint files, or fill any
          missing CTS notary date / SQM / zonal value from the DOAS endorsement batches.
        </p>
        {ctsError && (
          <div className="callout callout-error" style={{ marginTop: 12, marginBottom: 0 }}>
            {ctsError}
          </div>
        )}
        {ctsResult && (
          <div
            className={`callout ${ctsResult.errors.length > 0 ? 'callout-error' : 'callout-success'}`}
            style={{ marginTop: 12, marginBottom: 0 }}
          >
            <strong>
              CTS data: {ctsResult.filled.length} contract(s) filled
              {ctsResult.notFound.length > 0 ? `, ${ctsResult.notFound.length} not in the DOAS batches` : ''}.
            </strong>
            {ctsResult.errors.map((e, i) => (
              <div key={i}>{e}</div>
            ))}
            {ctsResult.notFound.length > 0 && <div>Not found: {ctsResult.notFound.join(', ')}</div>}
          </div>
        )}
        {syncStatus?.last && syncStatus.last.errors.length > 0 && (
          <div className="callout callout-error" style={{ marginTop: 12, marginBottom: 0 }}>
            {syncStatus.last.errors.slice(0, 5).map((e, i) => (
              <div key={i}>{e}</div>
            ))}
          </div>
        )}
        {sharePointError && (
          <div className="callout callout-error" style={{ marginTop: 12, marginBottom: 0 }}>
            {sharePointError}
          </div>
        )}
        {sharePointResult && (
          <div className="callout callout-success" style={{ marginTop: 12, marginBottom: 0 }}>
            <strong>SharePoint update finished.</strong>
            <ul>
              <li>
                OCLP 1606: SharePoint copy last modified {formatSyncTime(sharePointResult.oclp.sharepointModifiedAt)} —
                Base Contract filled on {sharePointResult.oclp.baseContractMatched} row(s),{' '}
                {sharePointResult.oclp.baseContractSelfReferenced} blank.
              </li>
              <li>
                Zonal Value: {sharePointResult.zonalValue.skipped ? 'already up to date, not re-downloaded' : 'updated'}{' '}
                (SharePoint copy last modified {formatSyncTime(sharePointResult.zonalValue.sharepointModifiedAt)}).
              </li>
              <li>
                Customer Ledgers: {sharePointResult.ledgers.filesChecked} file(s) checked,{' '}
                {sharePointResult.ledgers.filesDownloaded.length} new or updated.
              </li>
            </ul>
          </div>
        )}
      </div>

      {batches.length > 0 && (
        <div className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">Upload batches</h3>
              <p className="card-subtitle">
                Each uploaded Excel file is a numbered batch, titled after the file. Rename a batch with the pencil.
              </p>
            </div>
            <a className="btn btn-secondary btn-sm" href={allLedgersDownloadUrl()}>
              <Icon name="download" /> All ledgers (ZIP)
            </a>
          </div>
          <div className="batch-list">
            {batches.map((b) => (
              <div className="batch-item" key={b.batchNumber}>
                {editingBatch === b.batchNumber ? (
                  <div className="batch-edit">
                    <input
                      type="text"
                      className="inline-input"
                      value={draftTitle}
                      autoFocus
                      maxLength={120}
                      placeholder="Batch title (blank = file name)"
                      aria-label={`Title for batch ${b.batchNumber}`}
                      onChange={(e) => setDraftTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveRename();
                        else if (e.key === 'Escape') cancelRename();
                      }}
                    />
                    <button className="btn btn-sm" onClick={saveRename} disabled={renaming}>
                      {renaming ? 'Saving…' : 'Save'}
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={cancelRename} disabled={renaming}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="batch-main">
                      <div className="batch-title" title={b.batchTitle ?? `Batch ${b.batchNumber}`}>
                        {b.batchTitle ?? `Batch ${b.batchNumber}`}
                      </div>
                      <div className="batch-meta">
                        Batch {b.batchNumber}
                        {b.batchDate ? ` · ${formatBatchDate(b.batchDate)}` : ''} · {b.count} contract
                        {b.count === 1 ? '' : 's'}
                      </div>
                    </div>
                    <div className="batch-actions">
                      <a
                        className="btn btn-secondary btn-sm"
                        href={allLedgersDownloadUrl(b.batchNumber)}
                        title={`Download the ${b.count} ledger(s) in Batch ${b.batchNumber}`}
                      >
                        <Icon name="download" /> Ledgers
                      </a>
                      <button
                        className="btn btn-secondary btn-sm btn-icon"
                        onClick={() => startRename(b)}
                        title={`Rename Batch ${b.batchNumber}`}
                        aria-label={`Rename batch ${b.batchNumber}`}
                      >
                        <Icon name="edit" />
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
          {renameError && (
            <div className="callout callout-error" style={{ marginTop: 12, marginBottom: 0 }}>
              {renameError}
            </div>
          )}
        </div>
      )}

      <div className="card">
        <div className="toolbar">
          <div className="search-wrap">
            <Icon name="search" />
            <input
              type="search"
              className="search-input"
              placeholder="Search contract, buyer, tower, unit, batch…"
              aria-label="Search contracts"
              value={query}
              onChange={(e) => changeQuery(e.target.value)}
            />
          </div>
          <div className="chips" role="group" aria-label="Filter by status">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                className={`chip${statusFilter === f.value ? ' active' : ''}`}
                aria-pressed={statusFilter === f.value}
                onClick={() => changeStatusFilter(f.value)}
              >
                {f.label} <span className="count">{counts[f.value]}</span>
              </button>
            ))}
          </div>
          <div className="btn-row toolbar-spacer">
            <a
              className={`btn btn-secondary btn-sm${readyVisible.length === 0 ? ' disabled' : ''}`}
              href={readyVisible.length === 0 ? undefined : selectedLedgersDownloadUrl(readyVisible)}
              aria-disabled={readyVisible.length === 0}
              title="One ZIP with the payment ledger of every contract shown here whose analysis is done"
            >
              <Icon name="download" /> Ready ledgers (ZIP){readyVisible.length > 0 ? ` · ${readyVisible.length}` : ''}
            </a>
            <a
              className={`btn btn-secondary btn-sm${selectedReady.length === 0 ? ' disabled' : ''}`}
              href={selectedReady.length === 0 ? undefined : selectedLedgersDownloadUrl(selectedReady)}
              aria-disabled={selectedReady.length === 0}
              title="Tick contracts, then download just those ledgers (those whose analysis is done)"
            >
              <Icon name="download" /> Selected (ZIP){selectedReady.length > 0 ? ` · ${selectedReady.length}` : ''}
            </a>
            <button className="btn btn-danger btn-sm" onClick={deleteSelected} disabled={deleting || selected.size === 0}>
              <Icon name="trash" /> {deleting ? 'Deleting…' : `Delete selected${selected.size > 0 ? ` (${selected.size})` : ''}`}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => load(true)} disabled={refreshing}>
              <Icon name="refresh" /> {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>

        <p className="result-count">
          Showing {visible.length} of {contracts.length} contract(s)
          {sort ? ` · sorted by ${COLUMNS.find((c) => c.key === sort.key)?.label} (${sort.dir === 'asc' ? 'A→Z / low→high' : 'Z→A / high→low'})` : ''}
        </p>

        {visible.length === 0 ? (
          <div className="empty-state" style={{ padding: '28px 20px' }}>
            <Icon name="search" size={30} />
            <h3>No contracts match</h3>
            <p>Try a different search, or clear the status filter.</p>
            <div className="btn-row">
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  changeQuery('');
                  changeStatusFilter('ALL');
                }}
              >
                Clear search &amp; filter
              </button>
            </div>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th style={{ width: 32, textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = selectedVisible > 0 && !allVisibleSelected;
                    }}
                    onChange={(e) => toggleAll(visibleNumbers, e.target.checked)}
                    aria-label="Select all shown contracts"
                  />
                </th>
                {COLUMNS.map((col) => {
                  const active = sort?.key === col.key;
                  return (
                    <th
                      key={col.key}
                      className={`sortable${col.numeric ? ' num' : ''}${active ? ' sorted' : ''}`}
                      onClick={() => toggleSort(col.key)}
                      aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                      title={`Sort by ${col.label}`}
                    >
                      {col.label}
                      <span className="sort-ind">
                        <Icon name={active ? (sort!.dir === 'asc' ? 'chevronUp' : 'chevronDown') : 'sort'} size={12} />
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {visible.map((c) => (
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
                    <Link className="cell-link" to={`/contracts/${encodeURIComponent(c.contractNumber)}`}>
                      {c.contractNumber}
                    </Link>
                    {(c.nonCurrentClearingDocs ?? 0) > 0 && (
                      <span
                        className="badge badge-missing-data"
                        style={{ marginLeft: 8 }}
                        title={`${c.nonCurrentClearingDocs} payment row(s) have a clearing document outside the 14 series — this is not LedgerFit's latest ledger.`}
                      >
                        Old ledger
                      </span>
                    )}
                  </td>
                  <td>
                    {c.batchNumber != null ? (
                      <span title={[c.batchTitle, c.batchDate ? formatBatchDate(c.batchDate) : ''].filter(Boolean).join(' · ')}>
                        Batch {c.batchNumber}
                        {c.batchTitle ? <span className="muted cell-ellipsis"> · {c.batchTitle}</span> : ''}
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
                  <td className="num">{formatCurrency(c.cwtTaxBase)}</td>
                  <td className="num">{formatCurrency(c.cwtTaxDue)}</td>
                  <td className={`num${c.variance != null && c.variance > 0 ? ' neg' : ''}`}>{formatCurrency(c.variance)}</td>
                  <td className="num">{formatCurrency(c.totalPenalties)}</td>
                  <td>
                    <StatusBadge status={c.status} />
                  </td>
                  <td>
                    {(() => {
                      const a = c.analysis;
                      if (!a) return '—';
                      const ready = a.state !== 'PENDING';
                      return (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span
                            className={`badge ${a.state === 'DONE' ? 'badge-compliant' : 'badge-missing-data'}`}
                            title={
                              a.state === 'DONE'
                                ? 'Analysis done — the payment ledger can be downloaded.'
                                : a.state === 'PROVISIONAL'
                                  ? 'All data is in, but the ledger is not in Reviewed & Accepted yet — treat as provisional.'
                                  : `Still needed: ${a.missing.join('; ')}`
                            }
                          >
                            {a.state === 'DONE' ? 'Done' : a.state === 'PROVISIONAL' ? 'Provisional' : 'Pending'}
                          </span>
                          {ready ? (
                            <a
                              className="btn btn-ghost btn-sm"
                              href={ledgerDownloadUrl(c.contractNumber)}
                              aria-label={`Download payment ledger for ${c.contractNumber}`}
                              title="Download the payment ledger (Excel)"
                            >
                              <Icon name="download" />
                            </a>
                          ) : (
                            <span className="hint cell-ellipsis" title={a.missing.join('; ')}>
                              {a.missing[0]}
                              {a.missing.length > 1 ? ` +${a.missing.length - 1}` : ''}
                            </span>
                          )}
                        </div>
                      );
                    })()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
