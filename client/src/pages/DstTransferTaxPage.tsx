import { useEffect, useRef, useState } from 'react';
import { computeDstTransferTax, dstTransferTaxTemplateUrl } from '../api/client';

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
    <div className="card">
      <h2>DST &amp; Transfer Tax Review</h2>
      <p className="muted">
        1. Download the template below and fill in Contract Number, Tower, Unit/Storage Area, Parking Area, CTS
        Notary Date, TCP (net of VAT), and FMV per Tax Declaration.
      </p>
      <p className="muted">
        2. Upload the filled-in file — RDO, Tagging, and Unit/Storage &amp; Parking ZV/sqm are traced from the tax
        team's Zonal Value reference as of each row's CTS Notary Date (the same lookup used on a contract's detail
        page), and Total ZV Unit/Storage, Total ZV Parking, and Total ZV are computed with real Excel formulas so
        you can audit the math directly in the downloaded workbook.
      </p>

      <a className="btn btn-primary" href={dstTransferTaxTemplateUrl()} style={{ marginBottom: 16, display: 'inline-block' }}>
        ⬇ Download Template
      </a>

      <div className="upload-box">
        <input
          type="file"
          accept=".xlsx,.xls"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = '';
          }}
        />
      </div>

      {busy && <p className="muted">Computing…</p>}
      {error && <div className="callout callout-error">{error}</div>}
      {resultUrl && (
        <div className="callout" style={{ background: '#dcfce7', color: '#166534' }}>
          <p style={{ margin: '0 0 8px' }}>
            Done. Rows with "Zonal Match Notes" filled in had no matching Zonal Value entry (unknown tower, or no
            rate window covers the notary date) — check those manually.
          </p>
          <a className="btn btn-primary" href={resultUrl} download={OUTPUT_FILENAME}>
            ⬇ Download Computed File
          </a>
        </div>
      )}
    </div>
  );
}
