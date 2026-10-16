import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { createOnettSummary, fetchOnettStatus, fetchOnettSummary, onettExportUrl } from '../api/client';
import type { OnettSummaryInfo } from '../api/types';
import { formatCurrency } from '../utils/format';
import Icon from '../components/Icon';

export default function OnettUploadPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [title, setTitle] = useState('');
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<{ autoExtraction: boolean; note: string } | null>(null);
  // The summary just created: shown below with its progress and, once Ready, the download.
  const [created, setCreated] = useState<OnettSummaryInfo | null>(null);

  useEffect(() => {
    fetchOnettStatus()
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  // While the pages are being read, follow the summary until it settles.
  const createdId = created?.id ?? null;
  const processing = created?.status === 'PROCESSING';
  useEffect(() => {
    if (createdId == null || !processing) return;
    const timer = window.setInterval(() => {
      fetchOnettSummary(createdId)
        .then((d) => setCreated(d.summary))
        .catch(() => undefined);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [createdId, processing]);

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const pdfs = [...list].filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
    if (pdfs.length === 0) {
      setError('Only PDF files can be uploaded.');
      return;
    }
    setError(null);
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => `${f.name}:${f.size}`));
      return [...prev, ...pdfs.filter((f) => !seen.has(`${f.name}:${f.size}`))];
    });
    if (inputRef.current) inputRef.current.value = '';
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      setCreated(await createOnettSummary(files, title));
      setFiles([]);
      setTitle('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const totalMb = files.reduce((s, f) => s + f.size, 0) / (1024 * 1024);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>New ONETT summary</h1>
          <p className="page-subtitle">
            Upload scanned ONETT computation sheets — one PDF with many ONETTs (each followed by its payment schedule
            and IRIS screenshots), or several PDFs at once. Handwritten computations and notes are read too.
          </p>
        </div>
      </div>

      {status && (
        <div className={`callout ${status.autoExtraction ? 'callout-success' : 'callout-info'}`}>
          {status.autoExtraction ? (
            <>
              <strong>Automatic reading is on.</strong> After you upload, every page is read — handwriting included — and
              the summary fills in by itself. Large packets take several minutes; watch the progress on the dashboard.
            </>
          ) : (
            <>
              <strong>Automatic reading is off.</strong> {status.note} Uploads are saved and wait as “Awaiting data”.
            </>
          )}
        </div>
      )}
      {error && <div className="callout callout-error">{error}</div>}

      {created && (
        <div className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">{created.title}</h3>
              <p className="card-subtitle">
                {created.pageCount} page{created.pageCount === 1 ? '' : 's'} saved
                {created.status === 'READY' ? ` · ${created.stats.accounts} ONETT${created.stats.accounts === 1 ? '' : 's'} read` : ''}
              </p>
            </div>
            {created.status === 'READY' && created.stats.accounts > 0 && (
              <a className="btn" href={onettExportUrl(created.id)}>
                <Icon name="download" /> Download ONETT Summary (Excel)
              </a>
            )}
          </div>

          {created.status === 'PROCESSING' && (
            <div className="callout callout-info">
              <span className="spinner" /> {created.statusNote ?? 'Reading pages…'} This page updates by itself; you can
              also leave and find it on the ONETT Dashboard.
            </div>
          )}
          {created.status === 'AWAITING_EXTRACTION' && (
            <div className="callout callout-info">{created.statusNote}</div>
          )}
          {created.status === 'FAILED' && <div className="callout callout-error">{created.statusNote}</div>}

          {created.status === 'READY' && created.stats.accounts > 0 && (
            <div className="stat-grid">
              <div className="stat-box">
                <div className="label">ONETTs</div>
                <div className="value">{created.stats.accounts}</div>
                <div className="sub">
                  {created.stats.withIris} with IRIS · {created.stats.noIris} no IRIS
                </div>
              </div>
              <div className="stat-box stat-danger">
                <div className="label">Total due</div>
                <div className="value">{formatCurrency(created.stats.total)}</div>
              </div>
              <div className={`stat-box ${created.stats.flagged > 0 ? 'stat-danger' : 'stat-success'}`}>
                <div className="label">Needs review</div>
                <div className="value">{created.stats.flagged}</div>
                <div className="sub">see the flags sheet in the Excel</div>
              </div>
            </div>
          )}

          <div className="btn-row">
            <Link className="btn btn-secondary btn-sm" to={`/onett?summary=${created.id}`}>
              Open on the ONETT Dashboard
            </Link>
            <button className="btn btn-secondary btn-sm" onClick={() => setCreated(null)}>
              Upload another
            </button>
          </div>
        </div>
      )}

      <div className="card">
        <div
          className={`dropzone${dragging ? ' dragging' : ''}${busy ? ' disabled' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            if (!busy) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (!busy) addFiles(e.dataTransfer.files);
          }}
        >
          <Icon name="upload" size={28} />
          <div className="dropzone-title">Drop ONETT PDFs here</div>
          <div className="muted">One PDF with many ONETTs, or many PDFs at once (e.g. 100)</div>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => inputRef.current?.click()}>
            Choose files
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            hidden
            disabled={busy}
            onChange={(e) => addFiles(e.target.files)}
          />
        </div>

        {files.length > 0 && (
          <>
            <div className="batch-list" style={{ marginTop: 16 }}>
              {files.map((f, i) => (
                <div className="batch-item" key={`${f.name}-${f.size}`}>
                  <div className="batch-main">
                    <div className="batch-title">{f.name}</div>
                    <div className="batch-meta">{(f.size / (1024 * 1024)).toFixed(1)} MB</div>
                  </div>
                  <div className="batch-actions">
                    <button
                      className="btn btn-secondary btn-sm btn-icon"
                      disabled={busy}
                      onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                      aria-label={`Remove ${f.name}`}
                    >
                      <Icon name="trash" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="btn-row" style={{ marginTop: 16, alignItems: 'center' }}>
              <input
                className="inline-input"
                placeholder="Summary name (optional)"
                aria-label="Summary name"
                value={title}
                maxLength={120}
                disabled={busy}
                onChange={(e) => setTitle(e.target.value)}
              />
              <button className="btn" onClick={submit} disabled={busy}>
                {busy ? (
                  <>
                    <span className="spinner" /> Uploading {totalMb.toFixed(0)} MB…
                  </>
                ) : (
                  <>
                    <Icon name="upload" /> Create summary ({files.length} file{files.length === 1 ? '' : 's'})
                  </>
                )}
              </button>
              <Link className="btn btn-secondary" to="/onett">
                Cancel
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
