import { Fragment, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { etbLedgerDownloadUrl, etbLedgersZipUrl } from '../api/client';
import type { EtbContractResult, ExposureStatus } from '../api/types';
import { formatCurrency, formatDate } from '../utils/format';
import StatusBadge from './StatusBadge';
import Icon from './Icon';

// The results of one ETB calculation — summary tiles, search/filter, bulk
// ledger download and the per-contract table with expandable payment rows.
// Shared by the ETB Calculator (right after a run) and the ETB Dashboard (any
// saved run), so both always look and behave the same.

const SOURCE_LABELS: Record<string, string> = {
  NET_TCP: 'Net TCP',
  FMV_PER_TAX_DECLARATION: 'FMV per Tax Declaration',
  ZONAL_VALUE: 'Zonal Value',
};

type StatusFilter = 'ALL' | ExposureStatus;

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'UNDER_REMITTED', label: 'Under-remitted' },
  { value: 'NON_COMPLIANT', label: 'Not compliant' },
  { value: 'MISSING_DATA', label: 'Missing data' },
  { value: 'COMPLIANT', label: 'Compliant' },
];

interface Props {
  startDate: string | null;
  results: EtbContractResult[];
  errors?: string[];
}

export default function EtbResultsView({ startDate, results, errors = [] }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');

  const isReady = (r: EtbContractResult) => r.analysis.state !== 'PENDING';

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return results.filter((r) => {
      if (statusFilter !== 'ALL' && r.status !== statusFilter) return false;
      if (!q) return true;
      return [r.contractNumber, r.buyerName, r.tower, r.unit, r.storedClassification, r.taxTagging]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [results, query, statusFilter]);

  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = { ALL: 0, UNDER_REMITTED: 0, NON_COMPLIANT: 0, MISSING_DATA: 0, COMPLIANT: 0 };
    for (const r of results) {
      c.ALL += 1;
      c[r.status] += 1;
    }
    return c;
  }, [results]);

  const readyNumbers = visible.filter(isReady).map((r) => r.contractNumber);
  const pickedReady = visible.filter((r) => picked.has(r.contractNumber) && isReady(r)).map((r) => r.contractNumber);
  const doneCount = results.filter((r) => r.analysis.state === 'DONE').length;
  const readyAll = results.filter(isReady).length;
  const notCompliant = counts.UNDER_REMITTED + counts.NON_COMPLIANT;
  const totalVariance = results.reduce((s, r) => s + (r.variance !== null && r.variance > 0 ? r.variance : 0), 0);
  const totalPenalties = results.reduce((s, r) => s + (r.totalPenalties ?? 0), 0);

  const flip = (set: Set<string>, n: string) => {
    const next = new Set(set);
    if (next.has(n)) next.delete(n);
    else next.add(n);
    return next;
  };

  return (
    <div>
      <div className="stat-grid">
        <div className="stat-box stat-neutral">
          <div className="label">Contracts</div>
          <div className="value">{results.length}</div>
          <div className="sub">
            {counts.COMPLIANT} compliant · {counts.MISSING_DATA} missing data
          </div>
        </div>
        <div className={`stat-box ${notCompliant > 0 ? 'stat-danger' : 'stat-success'}`}>
          <div className="label">Not compliant</div>
          <div className="value">{notCompliant}</div>
          <div className="sub">{notCompliant > 0 ? 'need follow-up' : 'nothing outstanding'}</div>
        </div>
        <div className={`stat-box ${totalVariance > 0 ? 'stat-danger' : 'stat-success'}`}>
          <div className="label">Total exposure</div>
          <div className="value">{formatCurrency(totalVariance)}</div>
          <div className="sub">unremitted CWT, before penalties</div>
        </div>
        <div className={`stat-box ${doneCount === results.length && results.length > 0 ? 'stat-success' : 'stat-neutral'}`}>
          <div className="label">Analysis done</div>
          <div className="value">
            {readyAll} / {results.length}
          </div>
          <div className="sub">
            {readyAll - doneCount > 0 ? `${readyAll - doneCount} provisional · ` : ''}
            ledger ready to download
          </div>
        </div>
        <div className="stat-box stat-neutral">
          <div className="label">Total penalties</div>
          <div className="value">{formatCurrency(totalPenalties)}</div>
          <div className="sub">surcharge, compromise, interest</div>
        </div>
      </div>

      {errors.length > 0 && (
        <div className="callout callout-error">
          {errors.map((e, i) => (
            <div key={i}>{e}</div>
          ))}
        </div>
      )}

      <div className="toolbar">
        <div className="search-wrap">
          <Icon name="search" />
          <input
            type="search"
            className="search-input"
            placeholder="Search contract, buyer, tower, unit…"
            aria-label="Search contracts"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="chips" role="group" aria-label="Filter by status">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              className={`chip${statusFilter === f.value ? ' active' : ''}`}
              aria-pressed={statusFilter === f.value}
              onClick={() => setStatusFilter(f.value)}
            >
              {f.label} <span className="count">{counts[f.value]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="btn-row" style={{ margin: '12px 0' }}>
        <a
          className={`btn btn-secondary btn-sm${readyNumbers.length === 0 ? ' disabled' : ''}`}
          href={readyNumbers.length === 0 ? undefined : etbLedgersZipUrl(readyNumbers, startDate ?? '')}
          aria-disabled={readyNumbers.length === 0}
          title="One ZIP with the ETB payment ledger of every contract shown whose analysis is done"
        >
          <Icon name="download" /> Download all ready ledgers (ZIP) · {readyNumbers.length}
        </a>
        <a
          className={`btn btn-secondary btn-sm${pickedReady.length === 0 ? ' disabled' : ''}`}
          href={pickedReady.length === 0 ? undefined : etbLedgersZipUrl(pickedReady, startDate ?? '')}
          aria-disabled={pickedReady.length === 0}
          title="Tick contracts below, then download just those"
        >
          <Icon name="download" /> Download selected (ZIP){pickedReady.length > 0 ? ` · ${pickedReady.length}` : ''}
        </a>
        {results.length - readyAll > 0 && (
          <span className="hint">
            {results.length - readyAll} contract(s) still pending — hover their Analysis badge to see what is missing.
          </span>
        )}
      </div>

      {visible.length === 0 ? (
        <div className="empty-state">
          <h3>No contracts match</h3>
          <p>Clear the search or pick another status filter.</p>
        </div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  aria-label="Select all ready contracts"
                  checked={readyNumbers.length > 0 && pickedReady.length === readyNumbers.length}
                  onChange={(e) => setPicked(e.target.checked ? new Set(readyNumbers) : new Set())}
                />
              </th>
              <th />
              <th>Contract No.</th>
              <th>Buyer's Name</th>
              <th>Stored as</th>
              <th>CTS notary</th>
              <th className="num">Tax base</th>
              <th className="num">CWT due</th>
              <th className="num">Remitted</th>
              <th className="num">Variance</th>
              <th className="num">Penalties</th>
              <th>Status</th>
              <th>Analysis</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const open = expanded.has(r.contractNumber);
              return (
                <Fragment key={r.contractNumber}>
                  <tr>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Select contract ${r.contractNumber}`}
                        disabled={!isReady(r)}
                        checked={picked.has(r.contractNumber)}
                        onChange={() => setPicked((p) => flip(p, r.contractNumber))}
                      />
                    </td>
                    <td>
                      <button
                        className="btn btn-ghost btn-sm"
                        aria-label={`${open ? 'Hide' : 'Show'} payments for ${r.contractNumber}`}
                        aria-expanded={open}
                        onClick={() => setExpanded((p) => flip(p, r.contractNumber))}
                      >
                        <Icon name={open ? 'chevronUp' : 'chevronDown'} />
                      </button>
                    </td>
                    <td>
                      <Link className="cell-link" to={`/contracts/${encodeURIComponent(r.contractNumber)}`}>
                        {r.contractNumber}
                      </Link>
                    </td>
                    <td>{r.buyerName ?? '—'}</td>
                    <td>
                      {r.storedClassification ?? '—'}
                      {r.taxTagging ? ` · ${r.taxTagging}` : ''}
                    </td>
                    <td>{formatDate(r.ctsNotaryDate)}</td>
                    <td className="num">
                      {formatCurrency(r.cwtTaxBase)}
                      {r.taxBaseSource && <div className="hint">{SOURCE_LABELS[r.taxBaseSource] ?? r.taxBaseSource}</div>}
                    </td>
                    <td className="num">{formatCurrency(r.cwtTaxDue)}</td>
                    <td className="num">{formatCurrency(r.actualRemitted)}</td>
                    <td className={`num${r.variance !== null && r.variance > 0 ? ' neg' : ''}`}>
                      {formatCurrency(r.variance)}
                    </td>
                    <td className="num">{formatCurrency(r.totalPenalties)}</td>
                    <td>
                      <StatusBadge status={r.status} />
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span
                          className={`badge ${r.analysis.state === 'DONE' ? 'badge-compliant' : 'badge-missing-data'}`}
                          title={
                            r.analysis.state === 'DONE'
                              ? 'Analysis done — the ledger can be downloaded.'
                              : r.analysis.state === 'PROVISIONAL'
                                ? 'All data is in, but the ledger is not in Reviewed & Accepted yet — provisional.'
                                : `Still needed: ${r.analysis.missing.join('; ')}`
                          }
                        >
                          {r.analysis.state === 'DONE'
                            ? 'Done'
                            : r.analysis.state === 'PROVISIONAL'
                              ? 'Provisional'
                              : 'Pending'}
                        </span>
                        {isReady(r) ? (
                          <a
                            className="btn btn-ghost btn-sm"
                            href={etbLedgerDownloadUrl(r.contractNumber, startDate ?? '')}
                            aria-label={`Download ETB payment ledger for ${r.contractNumber}`}
                            title="Download this contract's ETB payment ledger (Excel)"
                          >
                            <Icon name="download" />
                          </a>
                        ) : (
                          <span className="hint cell-ellipsis" title={r.analysis.missing.join('; ')}>
                            {r.analysis.missing[0]}
                            {r.analysis.missing.length > 1 ? ` +${r.analysis.missing.length - 1}` : ''}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                  {open && (
                    <tr>
                      <td />
                      <td />
                      <td colSpan={11}>
                        <p className="hint" style={{ marginTop: 0 }}>
                          {r.deadlineNote}
                          {startDate && r.paymentsBeforeStart > 0
                            ? ` ${r.paymentsBeforeStart} of ${r.paymentCount} payment(s) fall before the start date and carry no ETB obligation.`
                            : ''}
                          {r.taxTagging !== 'INSTALLMENT'
                            ? ` Stored as ${r.taxTagging ?? 'untagged'} — computed here as ETB + Installment.`
                            : ''}
                        </p>
                        <table>
                          <thead>
                            <tr>
                              <th>Payment date</th>
                              <th className="num">Principal</th>
                              <th>ETB deadline</th>
                              <th className="num">Should-be CWT</th>
                              <th className="num">CWT remitted (1606)</th>
                              <th className="num">Difference</th>
                            </tr>
                          </thead>
                          <tbody>
                            {r.lines.map((l, i) => (
                              <tr key={i} style={l.beforeEtbStart ? { opacity: 0.55 } : undefined}>
                                <td>
                                  {formatDate(l.paymentDate)}
                                  {l.beforeEtbStart ? ' · before ETB start' : ''}
                                </td>
                                <td className="num">{formatCurrency(l.principal)}</td>
                                <td>
                                  {l.coveredByBulkRemittance ? (
                                    <span className="hint">Covered by AR Sale bulk remittance</span>
                                  ) : (
                                    formatDate(l.applicableDeadline)
                                  )}
                                </td>
                                <td className="num">{formatCurrency(l.shouldBeCwtDue)}</td>
                                <td className="num">{formatCurrency(l.cwtFileTaxDue)}</td>
                                <td className={`num${l.difference !== null && l.difference > 1 ? ' neg' : ''}`}>
                                  {formatCurrency(l.difference)}
                                  {l.paidInAdvance && <div className="hint">Paid in advance</div>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {(() => {
                          const short = r.lines.filter((l) => l.difference !== null && l.difference > 1);
                          if (short.length === 0) return null;
                          const shortfall = short.reduce((s, l) => s + (l.difference ?? 0), 0);
                          const penalties = r.lines.reduce((s, l) => s + (l.totalDue ?? 0), 0);
                          return (
                            <p className="hint">
                              Per-collection view: {short.length} of {r.lines.length} payment row(s) have an unpaid amount
                              ({formatCurrency(shortfall)} in total; {formatCurrency(penalties)} amount due incl. penalties).
                            </p>
                          );
                        })()}
                        <div className="btn-row" style={{ marginTop: 10 }}>
                          <a className="btn btn-secondary btn-sm" href={etbLedgerDownloadUrl(r.contractNumber, startDate ?? '')}>
                            <Icon name="download" /> Download ETB ledger (Excel)
                          </a>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
