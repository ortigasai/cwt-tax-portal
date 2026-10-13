import { useEffect, useRef, useState } from 'react';
import { computeDstTransferTax, dstTransferTaxTemplateUrl } from '../api/client';
import FileDropzone from '../components/FileDropzone';
import Icon from '../components/Icon';

const OUTPUT_FILENAME = 'DST and Transfer Tax Computation.xlsx';

export default function DstTransferTaxPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The object URL backing the "Download Computed File" link below — kept
  // around (not revoked right after use) so there's always a real, directly
  // clickable link the user can click themselves. An auto-triggered
  // synthetic click can silently get blocked by some browsers once it's
  // outside the original file-input click's gesture chain (this happens
  // after an async fetch resolves), so a persistent link is the only way to
  // *guarantee* the file is actually downloadable, not just attempted.
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const resultUrlRef = useRef<string | null>(null);

  useEffect(() => {
    resultUrlRef.current = resultUrl;
  }, [resultUrl]);

  // Revoke whichever object URL is current when the page unmounts.
  useEffect(() => () => {
    if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
  }, []);

  async function handleFile(file: File) {
    setBusy(true);
    setError(null);
    if (resultUrl) {
      URL.revokeObjectURL(resultUrl);
      setResultUrl(null);
    }
    try {
      const blob = await computeDstTransferTax(file);
      const url = URL.createObjectURL(blob);
      setResultUrl(url);
      // Best-effort auto-download for the common case where the browser
      // allows it — the persistent link below is the fallback that always
      // works even when this doesn't.
      const a = document.createElement('a');
      a.href = url;
      a.download = OUTPUT_FILENAME;
      document.body.appendChild(a);
      a.click();
      a.remove();
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
          <h1>DST &amp; Transfer Tax Review</h1>
          <p className="page-subtitle">Fill in the template, upload it, and download the computed workbook.</p>
        </div>
      </div>

      <div className="card">
        <div className="card-header" style={{ marginBottom: 0 }}>
          <div>
            <h3 className="card-title">Step 1 — Download the template</h3>
            <p className="card-subtitle">
              Fill in Contract Number, Tower, Unit/Storage Area, Parking Area, CTS Notary Date, TCP (net of VAT), and FMV
              per Tax Declaration.
            </p>
          </div>
          <a className="btn" href={dstTransferTaxTemplateUrl()}>
            <Icon name="download" /> Download template
          </a>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div>
            <h3 className="card-title">Step 2 — Upload the filled-in file</h3>
            <p className="card-subtitle">
              RDO, Tagging, and Unit/Storage &amp; Parking ZV/sqm are traced from the tax team's Zonal Value reference as of
              each row's CTS Notary Date (the same lookup used on a contract's detail page). Total ZV Unit/Storage, Total ZV
              Parking, and Total ZV are real Excel formulas, so you can audit the math directly in the downloaded workbook.
            </p>
          </div>
        </div>

        <FileDropzone
          accept=".xlsx,.xls"
          disabled={busy}
          title={busy ? 'Computing…' : 'Drop the filled-in template here'}
          hint=".xlsx or .xls"
          onFile={handleFile}
        />

        {busy && (
          <div className="loading" style={{ padding: '4px 0 0' }}>
            <span className="spinner" /> Computing…
          </div>
        )}
        {error && (
          <div className="callout callout-error" style={{ marginBottom: 0 }}>
            {error}
          </div>
        )}
        {resultUrl && (
          <div className="callout callout-success" style={{ marginBottom: 0 }}>
            <p>
              <strong>Done.</strong> Rows with "Zonal Match Notes" filled in had no matching Zonal Value entry (unknown
              tower, or no rate window covers the notary date) — check those manually.
            </p>
            <a className="btn" href={resultUrl} download={OUTPUT_FILENAME}>
              <Icon name="download" /> Download computed file
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
