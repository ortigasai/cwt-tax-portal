import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  deleteOnettSummaries,
  deleteOnettSummary,
  extractOnettSummary,
  fetchOnettStatus,
  fetchOnettSummaries,
  fetchOnettSummary,
  importOnettAccounts,
  onettExportUrl,
  onettPageUrl,
  removeOnettAccounts,
  renameOnettSummary,
} from '../api/client';
import type { OnettAccountView, OnettDetail, OnettSummaryInfo } from '../api/types';
import { formatCurrency } from '../utils/format';
import Icon from '../components/Icon';

type Filter = 'ALL' | 'FLAGGED' | 'NO_IRIS' | 'WITH_IRIS';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'FLAGGED', label: 'Needs review' },
  { value: 'WITH_IRIS', label: 'With IRIS' },
  { value: 'NO_IRIS', label: 'No IRIS' },
];

const STATUS_LABELS: Record<OnettSummaryInfo['status'], string> = {
  PROCESSING: 'Reading pages…',
  AWAITING_EXTRACTION: 'Awaiting data',
  READY: 'Ready',
  FAILED: 'Failed',
};

function formatRunDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
}

function statusBadgeClass(status: OnettSummaryInfo['status']): string {
  if (status === 'READY') return 'badge badge-compliant';
  if (status === 'FAILED') return 'badge badge-under-remitted';
  return 'badge badge-missing-data';
}

export default function OnettDashboardPage() {
  const [params, setParams] = useSearchParams();
  const [summaries, setSummaries] = useState<OnettSummaryInfo[] | null>(null);
  const [detail, setDetail] = useState<OnettDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [auto, setAuto] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('ALL');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [importText, setImportText] = useState('');
  const [importing, setImporting] = useState(false);
  // Ticked summaries (list) and ticked ONETT records (table), for bulk delete.
  const [pickedSummaries, setPickedSummaries] = useState<Set<number>>(new Set());
  const [pickedDockets, setPickedDockets] = useState<Set<string>>(new Set());

  const selectedParam = Number(params.get('summary'));
  const selectedId = Number.isInteger(selectedParam) && selectedParam > 0 ? selectedParam : null;
  const activeId = selectedId ?? summaries?.[0]?.id ?? null;
  const active = summaries?.find((s) => s.id === activeId) ?? null;

  const loadSummaries = () =>
    fetchOnettSummaries()
      .then((r) => {
        setSummaries(r);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));

  useEffect(() => {
    void loadSummaries();
    fetchOnettStatus()
      .then((s) => setAuto(s.autoExtraction))
      .catch(() => undefined);
  }, []);

  const loadDetail = (id: number) =>
    fetchOnettSummary(id)
      .then((d) => {
        setDetail(d);
        setError(null);
      })
      .catch((e: Error) => {
        setDetail(null);
        setError(e.message);
      });

  useEffect(() => {
    if (activeId == null) {
      setDetail(null);
      return;
    }
    setExpanded(new Set());
    setPickedDockets(new Set());
    void loadDetail(activeId);
  }, [activeId]);

  // While pages are being read, poll until the summary settles.
  const processing = active?.status === 'PROCESSING';
  useEffect(() => {
    if (!processing || activeId == null) return;
    const timer = window.setInterval(() => {
      void loadSummaries();
      void loadDetail(activeId);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [processing, activeId]);

  const open = (id: number) => setParams({ summary: String(id) });

  const saveRename = () => {
    if (editing == null) return;
    setSaving(true);
    renameOnettSummary(editing, draft)
      .then(() => {
        setEditing(null);
        return loadSummaries();
      })
      .then(() => (activeId != null ? loadDetail(activeId) : undefined))
      .catch((e: Error) => setError(e.message))
      .finally(() => setSaving(false));
  };

  const remove = (s: OnettSummaryInfo) => {
    if (!window.confirm(`Delete “${s.title}” and its saved scans from the ONETT Dashboard?`)) return;
    deleteOnettSummary(s.id)
      .then(() => {
        if (activeId === s.id) setParams({});
        return loadSummaries();
      })
      .catch((e: Error) => setError(e.message));
  };

  const removeSelectedSummaries = () => {
    const ids = [...pickedSummaries];
    if (ids.length === 0) return;
    const noun = ids.length === 1 ? 'summary' : 'summaries';
    if (!window.confirm(`Delete ${ids.length} ${noun} and their saved scans? This cannot be undone.`)) return;
    deleteOnettSummaries(ids)
      .then(() => {
        setPickedSummaries(new Set());
        if (activeId != null && ids.includes(activeId)) setParams({});
        return loadSummaries();
      })
      .catch((e: Error) => setError(e.message));
  };

  const removeSelectedAccounts = () => {
    if (activeId == null || pickedDockets.size === 0) return;
    const dockets = [...pickedDockets];
    if (!window.confirm(`Remove ${dockets.length} ONETT record(s) from this summary? This cannot be undone.`)) return;
    removeOnettAccounts(activeId, dockets)
      .then((d) => {
        setDetail(d);
        setPickedDockets(new Set());
        return loadSummaries();
      })
      .catch((e: Error) => setError(e.message));
  };

  const rerun = (s: OnettSummaryInfo) => {
    extractOnettSummary(s.id)
      .then(() => loadSummaries())
      .catch((e: Error) => setError(e.message));
  };

  const runImport = () => {
    if (activeId == null) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(importText);
    } catch {
      setError('That is not valid JSON.');
      return;
    }
    const accounts = Array.isArray(parsed) ? parsed : (parsed as { accounts?: unknown })?.accounts;
    setImporting(true);
    importOnettAccounts({ summaryId: activeId, accounts })
      .then((d) => {
        setDetail(d);
        setImportText('');
        return loadSummaries();
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setImporting(false));
  };

  const accounts = detail?.accounts ?? [];
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { ALL: accounts.length, FLAGGED: 0, WITH_IRIS: 0, NO_IRIS: 0 };
    for (const a of accounts) {
      if (a.reviewFlags.length > 0) c.FLAGGED++;
      if (a.rows[0]?.remarks.includes('NO IRIS')) c.NO_IRIS++;
      else c.WITH_IRIS++;
    }
    return c;
  }, [accounts]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return accounts.filter((a) => {
      if (filter === 'FLAGGED' && a.reviewFlags.length === 0) return false;
      const noIris = a.rows[0]?.remarks.includes('NO IRIS');
      if (filter === 'NO_IRIS' && !noIris) return false;
      if (filter === 'WITH_IRIS' && noIris) return false;
      if (!q) return true;
      return [a.docket, ...a.buyers, a.rows[0]?.location, a.rows[0]?.class, a.rows[0]?.remarks]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [accounts, query, filter]);

  const toggle = (docket: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(docket)) next.delete(docket);
      else next.add(docket);
      return next;
    });

  if (summaries === null && !error) {
    return (
      <div className="loading">
        <span className="spinner" /> Loading ONETT summaries…
      </div>
    );
  }

  const stats = active?.stats;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>ONETT Dashboard</h1>
          <p className="page-subtitle">
            Every batch of scanned ONETT computation sheets you have uploaded, summarised in the ONETT Summary
            format.
          </p>
        </div>
      </div>

      {error && <div className="callout callout-error">{error}</div>}

      {summaries && summaries.length === 0 && (
        <div className="empty-state">
          <h3>No ONETT summaries yet</h3>
          <p>Upload one PDF with many scanned ONETTs, or several PDFs at once. Each summary is saved here.</p>
          <Link className="btn" to="/onett/upload">
            <Icon name="upload" /> Upload ONETTs
          </Link>
        </div>
      )}

      {summaries && summaries.length > 0 && (
        <div className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">Summaries</h3>
              <p className="card-subtitle">Pick one to see its rows below. Rename it with the pencil.</p>
            </div>
          </div>
          <div className="btn-row" style={{ margin: '0 0 8px', alignItems: 'center' }}>
            <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              <input
                type="checkbox"
                aria-label="Select all summaries"
                checked={summaries.length > 0 && pickedSummaries.size === summaries.length}
                onChange={(e) => setPickedSummaries(e.target.checked ? new Set(summaries.map((x) => x.id)) : new Set())}
              />
              Select all
            </label>
            <button className="btn btn-secondary btn-sm" onClick={removeSelectedSummaries} disabled={pickedSummaries.size === 0}>
              <Icon name="trash" /> Delete selected{pickedSummaries.size > 0 ? ` · ${pickedSummaries.size}` : ''}
            </button>
          </div>
          <div className="batch-list">
            {summaries.map((s) => (
              <div className={`batch-item${s.id === activeId ? ' row-selected' : ''}`} key={s.id}>
                <input
                  type="checkbox"
                  aria-label={`Select summary ${s.id}`}
                  checked={pickedSummaries.has(s.id)}
                  onChange={() =>
                    setPickedSummaries((prev) => {
                      const next = new Set(prev);
                      if (next.has(s.id)) next.delete(s.id);
                      else next.add(s.id);
                      return next;
                    })
                  }
                />
                {editing === s.id ? (
                  <div className="batch-edit">
                    <input
                      className="inline-input"
                      aria-label={`Title for summary ${s.id}`}
                      value={draft}
                      autoFocus
                      maxLength={120}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveRename();
                        else if (e.key === 'Escape') setEditing(null);
                      }}
                    />
                    <button className="btn btn-sm" onClick={saveRename} disabled={saving}>
                      {saving ? 'Saving…' : 'Save'}
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={() => setEditing(null)} disabled={saving}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="batch-main">
                      <div className="batch-title" title={s.title}>
                        {s.title}
                      </div>
                      <div className="batch-meta">
                        {formatRunDate(s.createdAt)} · {s.stats.accounts} ONETT{s.stats.accounts === 1 ? '' : 's'}
                        {s.pageCount > 0 ? ` · ${s.pageCount} page${s.pageCount === 1 ? '' : 's'}` : ''} ·{' '}
                        <span className={statusBadgeClass(s.status)}>{STATUS_LABELS[s.status]}</span>
                      </div>
                    </div>
                    <div className="batch-actions">
                      <button
                        className={`btn btn-sm ${s.id === activeId ? '' : 'btn-secondary'}`}
                        onClick={() => open(s.id)}
                        aria-pressed={s.id === activeId}
                      >
                        {s.id === activeId ? 'Showing' : 'Open'}
                      </button>
                      <a
                        className={`btn btn-secondary btn-sm${s.stats.accounts === 0 ? ' disabled' : ''}`}
                        href={s.stats.accounts === 0 ? undefined : onettExportUrl(s.id)}
                        aria-disabled={s.stats.accounts === 0}
                        title="Download the ONETT Summary workbook"
                      >
                        <Icon name="download" /> Excel
                      </a>
                      <button
                        className="btn btn-secondary btn-sm btn-icon"
                        onClick={() => {
                          setEditing(s.id);
                          setDraft(s.customTitle ?? '');
                        }}
                        title="Rename"
                        aria-label={`Rename summary ${s.id}`}
                      >
                        <Icon name="edit" />
                      </button>
                      <button
                        className="btn btn-secondary btn-sm btn-icon"
                        onClick={() => remove(s)}
                        title="Delete"
                        aria-label={`Delete summary ${s.id}`}
                      >
                        <Icon name="trash" />
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {active && (
        <div className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">{active.title}</h3>
              <p className="card-subtitle">
                {active.files.map((f) => `${f.name} (${f.pages} p.)`).join(' · ') || 'Imported data'}
              </p>
            </div>
            <div className="btn-row">
              {auto && active.pageCount > 0 && active.status !== 'PROCESSING' && (
                <button className="btn btn-secondary btn-sm" onClick={() => rerun(active)}>
                  <Icon name="refresh" /> Re-read pages
                </button>
              )}
              <a
                className={`btn btn-sm${accounts.length === 0 ? ' disabled' : ''}`}
                href={accounts.length === 0 ? undefined : onettExportUrl(active.id)}
                aria-disabled={accounts.length === 0}
              >
                <Icon name="download" /> Download ONETT Summary (Excel)
              </a>
            </div>
          </div>

          {active.statusNote && (
            <div className={`callout ${active.status === 'FAILED' ? 'callout-error' : 'callout-info'}`}>
              {active.status === 'PROCESSING' && <span className="spinner" />} {active.statusNote}
            </div>
          )}

          {active.status === 'AWAITING_EXTRACTION' && (
            <div className="card" style={{ marginTop: 12 }}>
              <h3 className="card-title">Import extracted ONETT data</h3>
              <p className="card-subtitle">
                Paste the JSON of extracted ONETT records (an array of accounts, or {'{ "accounts": [...] }'}) to
                complete this summary. The scanned pages stay attached to it.
              </p>
              <textarea
                className="inline-input"
                style={{ width: '100%', minHeight: 120, fontFamily: 'monospace' }}
                aria-label="Extracted ONETT JSON"
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
              />
              <div className="btn-row" style={{ marginTop: 8 }}>
                <button className="btn btn-sm" onClick={runImport} disabled={importing || !importText.trim()}>
                  {importing ? 'Importing…' : 'Import'}
                </button>
              </div>
            </div>
          )}

          {stats && stats.accounts > 0 && (
            <div className="stat-grid" style={{ marginTop: 12 }}>
              <div className="stat-box">
                <div className="label">ONETTs</div>
                <div className="value">{stats.accounts}</div>
                <div className="sub">
                  {stats.withIris} with IRIS · {stats.noIris} no IRIS
                </div>
              </div>
              <div className="stat-box stat-neutral">
                <div className="label">Tax base</div>
                <div className="value">{formatCurrency(stats.taxBase)}</div>
              </div>
              <div className="stat-box stat-danger">
                <div className="label">Surcharge + interest + compromise</div>
                <div className="value">{formatCurrency(stats.surcharge + stats.interest + stats.compromise)}</div>
                <div className="sub">
                  {formatCurrency(stats.surcharge)} · {formatCurrency(stats.interest)} · {formatCurrency(stats.compromise)}
                </div>
              </div>
              <div className="stat-box stat-danger">
                <div className="label">Total due</div>
                <div className="value">{formatCurrency(stats.total)}</div>
                <div className="sub">incl. {formatCurrency(stats.shortDue)} short CWT/DST</div>
              </div>
              <div className={`stat-box ${stats.flagged > 0 ? 'stat-danger' : 'stat-success'}`}>
                <div className="label">Needs review</div>
                <div className="value">{stats.flagged}</div>
                <div className="sub">accounts with flags</div>
              </div>
            </div>
          )}

          {accounts.length > 0 && (
            <>
              <div className="toolbar">
                <div className="search-wrap">
                  <Icon name="search" />
                  <input
                    type="search"
                    className="search-input"
                    placeholder="Search docket, buyer, location…"
                    aria-label="Search ONETTs"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
                <div className="chips" role="group" aria-label="Filter">
                  {FILTERS.map((f) => (
                    <button
                      key={f.value}
                      className={`chip${filter === f.value ? ' active' : ''}`}
                      aria-pressed={filter === f.value}
                      onClick={() => setFilter(f.value)}
                    >
                      {f.label} <span className="count">{counts[f.value]}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="btn-row" style={{ margin: '12px 0', alignItems: 'center' }}>
                <button className="btn btn-secondary btn-sm" onClick={removeSelectedAccounts} disabled={pickedDockets.size === 0}>
                  <Icon name="trash" /> Delete selected ONETTs{pickedDockets.size > 0 ? ` · ${pickedDockets.size}` : ''}
                </button>
              </div>

              {visible.length === 0 ? (
                <div className="empty-state">
                  <h3>No ONETTs match</h3>
                  <p>Clear the search or pick another filter.</p>
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table>
                    <thead>
                      <tr>
                        <th>
                          <input
                            type="checkbox"
                            aria-label="Select all shown ONETTs"
                            checked={visible.length > 0 && visible.every((a) => pickedDockets.has(a.docket))}
                            onChange={(e) =>
                              setPickedDockets(e.target.checked ? new Set(visible.map((a) => a.docket)) : new Set())
                            }
                          />
                        </th>
                        <th />
                        <th>Docket</th>
                        <th>Buyer 1</th>
                        <th>Location</th>
                        <th>Class</th>
                        <th className="num">Area (RC)</th>
                        <th className="num">Area (PS)</th>
                        <th className="num">ZV/sqm (RC)</th>
                        <th className="num">ZV/sqm (PS)</th>
                        <th className="num">Zonal value</th>
                        <th className="num">FMV</th>
                        <th className="num">Selling price</th>
                        <th>Issue</th>
                        <th>Tax</th>
                        <th className="num">Tax base</th>
                        <th className="num">Tax due</th>
                        <th className="num">Tax paid</th>
                        <th className="num">Short</th>
                        <th className="num">Surcharge</th>
                        <th className="num">Interest</th>
                        <th className="num">Compromise</th>
                        <th className="num">Total</th>
                        <th>Remarks</th>
                        <th>Flags</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((a: OnettAccountView) => {
                        const isOpen = expanded.has(a.docket);
                        return (
                          <Fragment key={a.docket}>
                            {a.rows.map((r, i) => {
                              const short = r.taxDue - r.taxPaid;
                              const total = short + r.surcharge + r.interest + r.compromise;
                              return (
                                <tr key={`${a.docket}-${r.taxType}`}>
                                  <td>
                                    {i === 0 && (
                                      <input
                                        type="checkbox"
                                        aria-label={`Select ${a.docket}`}
                                        checked={pickedDockets.has(a.docket)}
                                        onChange={() =>
                                          setPickedDockets((prev) => {
                                            const next = new Set(prev);
                                            if (next.has(a.docket)) next.delete(a.docket);
                                            else next.add(a.docket);
                                            return next;
                                          })
                                        }
                                      />
                                    )}
                                  </td>
                                  <td>
                                    {i === 0 && (
                                      <button
                                        className="btn btn-secondary btn-sm btn-icon"
                                        onClick={() => toggle(a.docket)}
                                        aria-expanded={isOpen}
                                        aria-label={`Details for ${a.docket}`}
                                      >
                                        {isOpen ? '−' : '+'}
                                      </button>
                                    )}
                                  </td>
                                  <td>{r.docket}</td>
                                  <td>{r.buyer}</td>
                                  <td>{r.location}</td>
                                  <td>{r.class}</td>
                                  <td className="num">{r.areaRc ?? ''}</td>
                                  <td className="num">{r.areaPs ?? ''}</td>
                                  <td className="num">{r.zvPerSqmRc === null ? '' : formatCurrency(r.zvPerSqmRc)}</td>
                                  <td className="num">{r.zvPerSqmPs === null ? '' : formatCurrency(r.zvPerSqmPs)}</td>
                                  <td className="num">{formatCurrency(r.zonalValue)}</td>
                                  <td className="num">{formatCurrency(r.fmv)}</td>
                                  <td className="num">{formatCurrency(r.sellingPrice)}</td>
                                  <td>{r.issue}</td>
                                  <td>{r.taxType}</td>
                                  <td className="num">{formatCurrency(r.taxBase)}</td>
                                  <td className="num">{formatCurrency(r.taxDue)}</td>
                                  <td className="num">{formatCurrency(r.taxPaid)}</td>
                                  <td className="num">{formatCurrency(short)}</td>
                                  <td className="num">{formatCurrency(r.surcharge)}</td>
                                  <td className="num">{formatCurrency(r.interest)}</td>
                                  <td className="num">{formatCurrency(r.compromise)}</td>
                                  <td className="num">
                                    <strong>{formatCurrency(total)}</strong>
                                  </td>
                                  <td>{r.remarks}</td>
                                  <td>
                                    {i === 0 && a.reviewFlags.length > 0 && (
                                      <span className="badge badge-under-remitted">{a.reviewFlags.length}</span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                            {isOpen && (
                              <tr>
                                <td colSpan={25}>
                                  <div style={{ padding: '8px 4px' }}>
                                    {a.reviewFlags.length > 0 && (
                                      <ul style={{ margin: '0 0 8px 18px' }}>
                                        {a.reviewFlags.map((f, i) => (
                                          <li key={i}>{f}</li>
                                        ))}
                                      </ul>
                                    )}
                                    <div className="muted">
                                      {a.buyers.join(' · ')}
                                      {a.tins && a.tins.length > 0 ? ` — TIN ${a.tins.join(', ')}` : ''}
                                      {a.cts ? ` · CTS ${a.cts}` : ''}
                                      {a.terms ? ` · ${a.terms}` : ''}
                                    </div>
                                    {a.irisFinding && <div className="muted">IRIS: {a.irisFinding}</div>}
                                    {a.handwritten && a.handwritten.length > 0 && (
                                      <div className="muted">Handwritten: {a.handwritten.join('; ')}</div>
                                    )}
                                    {active.pageCount > 0 && (
                                      <div className="btn-row" style={{ marginTop: 6 }}>
                                        {a.sheetPage && (
                                          <a
                                            className="btn btn-secondary btn-sm"
                                            href={onettPageUrl(active.id, a.sheetPage)}
                                            target="_blank"
                                            rel="noreferrer"
                                          >
                                            Sheet (p. {a.sheetPage})
                                          </a>
                                        )}
                                        {a.schedulePages?.map((p) => (
                                          <a
                                            key={`s${p}`}
                                            className="btn btn-secondary btn-sm"
                                            href={onettPageUrl(active.id, p)}
                                            target="_blank"
                                            rel="noreferrer"
                                          >
                                            Schedule (p. {p})
                                          </a>
                                        ))}
                                        {a.irisPages?.map((p) => (
                                          <a
                                            key={`i${p}`}
                                            className="btn btn-secondary btn-sm"
                                            href={onettPageUrl(active.id, p)}
                                            target="_blank"
                                            rel="noreferrer"
                                          >
                                            IRIS (p. {p})
                                          </a>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
