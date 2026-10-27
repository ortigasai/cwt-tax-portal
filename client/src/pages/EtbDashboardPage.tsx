import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { deleteEtbRun, fetchEtbRun, fetchEtbRuns, renameEtbRun } from '../api/client';
import { useEtbJob } from '../etbJob';
import EtbProgress from '../components/EtbProgress';
import type { EtbRunDetail, EtbRunSummary } from '../api/types';
import { formatDate } from '../utils/format';
import EtbResultsView from '../components/EtbResultsView';
import Icon from '../components/Icon';

function formatRunDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function EtbDashboardPage() {
  const [params, setParams] = useSearchParams();
  const { job, dismiss } = useEtbJob();
  const [runs, setRuns] = useState<EtbRunSummary[] | null>(null);
  const [detail, setDetail] = useState<EtbRunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  // Inline rename.
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const selectedParam = Number(params.get('run'));
  const selectedId = Number.isInteger(selectedParam) && selectedParam > 0 ? selectedParam : null;

  const loadRuns = () =>
    fetchEtbRuns()
      .then((r) => {
        setRuns(r);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));

  useEffect(() => {
    void loadRuns();
  }, []);

  // A calculation that finished while this page was open (or just before) is a new run.
  useEffect(() => {
    if (job.status === 'done') void loadRuns();
  }, [job.status]);

  // The run being looked at: the one in the URL, else the newest.
  const activeId = selectedId ?? runs?.[0]?.id ?? null;

  useEffect(() => {
    if (activeId == null) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoadingDetail(true);
    fetchEtbRun(activeId)
      .then((d) => {
        if (!cancelled) {
          setDetail(d);
          setError(null);
        }
      })
      .catch((e: Error) => {
        if (!cancelled) {
          setDetail(null);
          setError(e.message);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  const open = (id: number) => setParams({ run: String(id) });

  const saveRename = () => {
    if (editing == null) return;
    setSaving(true);
    renameEtbRun(editing, draft)
      .then(() => {
        setEditing(null);
        return loadRuns();
      })
      .then(() => (activeId != null ? fetchEtbRun(activeId).then(setDetail) : undefined))
      .catch((e: Error) => setError(e.message))
      .finally(() => setSaving(false));
  };

  const remove = (run: EtbRunSummary) => {
    if (!window.confirm(`Remove “${run.title}” from the ETB Dashboard? The contracts themselves are not deleted.`)) return;
    deleteEtbRun(run.id)
      .then(() => {
        if (activeId === run.id) setParams({});
        return loadRuns();
      })
      .catch((e: Error) => setError(e.message));
  };

  if (runs === null && !error) {
    return (
      <div className="loading">
        <span className="spinner" /> Loading ETB calculations…
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>ETB Dashboard</h1>
          <p className="page-subtitle">
            Every ETB calculation you have run, with its results recomputed from the latest data each time you open it.
          </p>
        </div>
      </div>

      {job.status === 'running' && (
        <div className="callout callout-info">
          <div style={{ marginBottom: 6 }}>
            <span className="spinner" /> Calculating “{job.fileName}” — it keeps running while you browse; the result
            appears here as a new calculation when it is done.{' '}
            <Link to="/etb/calculator">Watch it</Link>
          </div>
          <EtbProgress job={job} />
        </div>
      )}
      {job.status === 'done' && job.result && (
        <div className="callout callout-success">
          “{job.fileName}” finished — {job.result.totalFound} contract(s) computed.{' '}
          {job.result.runId != null && (
            <Link to={`/etb?run=${job.result.runId}`} onClick={dismiss}>
              Open the results
            </Link>
          )}{' '}
          <button className="btn btn-ghost btn-sm" onClick={dismiss}>
            Dismiss
          </button>
        </div>
      )}
      {job.status === 'error' && (
        <div className="callout callout-error">
          Calculation of “{job.fileName}” failed: {job.error}{' '}
          <button className="btn btn-ghost btn-sm" onClick={dismiss}>
            Dismiss
          </button>
        </div>
      )}

      {error && <div className="callout callout-error">{error}</div>}

      {runs && runs.length === 0 && (
        <div className="empty-state">
          <h3>No ETB calculations yet</h3>
          <p>Upload a list of contract numbers to compute them as ETB. Each calculation is saved here.</p>
          <Link className="btn" to="/etb/calculator">
            <Icon name="upload" /> Start a calculation
          </Link>
        </div>
      )}

      {runs && runs.length > 0 && (
        <div className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">Calculations</h3>
              <p className="card-subtitle">Pick one to see its results below. Rename it with the pencil.</p>
            </div>
          </div>
          <div className="batch-list">
            {runs.map((r) => (
              <div className={`batch-item${r.id === activeId ? ' row-selected' : ''}`} key={r.id}>
                {editing === r.id ? (
                  <div className="batch-edit">
                    <input
                      className="inline-input"
                      aria-label={`Title for calculation ${r.id}`}
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
                      <div className="batch-title" title={r.title}>
                        {r.title}
                      </div>
                      <div className="batch-meta">
                        {formatRunDate(r.createdAt)} · {r.contractCount} contract{r.contractCount === 1 ? '' : 's'} ·{' '}
                        {r.perContractStarts > 0
                          ? `${r.perContractStarts} with their own start date${r.startDate ? ` · others from ${formatDate(r.startDate)}` : ''}`
                          : r.startDate
                            ? `ETB from ${formatDate(r.startDate)}`
                            : 'all payments as ETB'}
                      </div>
                    </div>
                    <div className="batch-actions">
                      <button
                        className={`btn btn-sm ${r.id === activeId ? '' : 'btn-secondary'}`}
                        onClick={() => open(r.id)}
                        aria-pressed={r.id === activeId}
                      >
                        {r.id === activeId ? 'Showing' : 'Open'}
                      </button>
                      <button
                        className="btn btn-secondary btn-sm btn-icon"
                        onClick={() => {
                          setEditing(r.id);
                          setDraft(r.customTitle ?? '');
                        }}
                        title="Rename"
                        aria-label={`Rename calculation ${r.id}`}
                      >
                        <Icon name="edit" />
                      </button>
                      <button
                        className="btn btn-secondary btn-sm btn-icon"
                        onClick={() => remove(r)}
                        title="Remove from the dashboard"
                        aria-label={`Remove calculation ${r.id}`}
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

      {loadingDetail && !detail && (
        <div className="loading">
          <span className="spinner" /> Recomputing…
        </div>
      )}

      {detail && (
        <div className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">{detail.run.title}</h3>
              <p className="card-subtitle">
                {detail.run.perContractStarts > 0
                  ? `Start date per contract (${detail.run.perContractStarts} listed)${detail.startDate ? `, others from ${formatDate(detail.startDate)}` : ''}`
                  : detail.startDate
                    ? `ETB treatment from ${formatDate(detail.startDate)}`
                    : 'Every payment treated as ETB'}
                {' · '}
                {detail.results.length} contract{detail.results.length === 1 ? '' : 's'}
                {detail.missing.length > 0 ? ` · ${detail.missing.length} no longer in the portal` : ''}
              </p>
            </div>
          </div>
          {detail.missing.length > 0 && (
            <div className="callout callout-info">
              These contracts were part of this calculation but have since been deleted from the portal:{' '}
              {detail.missing.slice(0, 10).join(', ')}
              {detail.missing.length > 10 ? ', …' : ''}.
            </div>
          )}
          <EtbResultsView startDate={detail.startDate} runId={detail.run.id} results={detail.results} />
        </div>
      )}
    </div>
  );
}
