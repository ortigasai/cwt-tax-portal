import { useEffect, useState } from 'react';
import { fetchRdoLocations, fetchZonalValueRegions, uploadOclp1606, uploadRptTowers } from '../api/client';

function useUpload<T>(fn: (file: File) => Promise<T>) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(file: File) {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await fn(file));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return { busy, result, error, run };
}

export default function ReferenceDataPage() {
  const oclp = useUpload(uploadOclp1606);
  const rpt = useUpload(uploadRptTowers);
  const [regions, setRegions] = useState<{ region: string }[] | null>(null);
  const [regionsError, setRegionsError] = useState<string | null>(null);
  const [sourceUrl, setSourceUrl] = useState('https://www.bir.gov.ph/zonal-values');
  const [rdoLocations, setRdoLocations] = useState<{ rdo: string; towers: string[] }[] | null>(null);

  useEffect(() => {
    fetchZonalValueRegions()
      .then((r) => {
        setRegions(r.regions);
        setSourceUrl(r.sourceUrl);
      })
      .catch((e: Error) => setRegionsError(e.message));
    fetchRdoLocations().then((r) => setRdoLocations(r.locations));
  }, []);

  return (
    <div>
      <div className="card">
        <h2>OCLP 1606 Summary</h2>
        <p className="muted">
          Bulk-uploads the FINAL tab: buyer classification, tax tagging, transaction/paid dates, and actual CWT
          remitted per collection. This can take up to a minute for large files (70k+ rows). Re-uploading replaces
          collection events for any contract touched by the file.
        </p>
        <div className="upload-box">
          <input
            type="file"
            accept=".xlsx,.xls"
            disabled={oclp.busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) oclp.run(file);
            }}
          />
        </div>
        {oclp.busy && <p className="muted">Parsing and importing — this may take a minute…</p>}
        {oclp.error && <div className="callout callout-error">{oclp.error}</div>}
        {oclp.result && (
          <div className="callout" style={{ background: '#dcfce7', color: '#166534' }}>
            Parsed {oclp.result.totalRows} rows — matched {oclp.result.matchedRows} to {oclp.result.contractsUpdated}{' '}
            existing contract(s); {oclp.result.unmatchedRows} rows had no matching contract on file (expected if the
            summary covers contracts you haven't uploaded yet).
          </div>
        )}
      </div>

      <div className="card">
        <h2>RPT_ALL TOWERS.xlsx</h2>
        <p className="muted">
          Replaces the Fair Market Value reference table wholesale (the "ALL" sheet: Tower, Unit, Fair Market Value).
          Use the contract detail page to search and match a contract to its FMV record.
        </p>
        <div className="upload-box">
          <input
            type="file"
            accept=".xlsx,.xls"
            disabled={rpt.busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) rpt.run(file);
            }}
          />
        </div>
        {rpt.busy && <p className="muted">Uploading…</p>}
        {rpt.error && <div className="callout callout-error">{rpt.error}</div>}
        {rpt.result && (
          <div className="callout" style={{ background: '#dcfce7', color: '#166534' }}>
            Imported {rpt.result.rowsImported} FMV records.
          </div>
        )}
      </div>

      <div className="card">
        <h2>Zonal Value Locations — Tower to RDO Mapping</h2>
        <p className="muted">
          Use this to identify which Revenue District Office's zonal value schedule applies to a contract's tower,
          then check that RDO's schedule on{' '}
          <a href="https://www.bir.gov.ph/zonal-values" target="_blank" rel="noreferrer">
            bir.gov.ph/zonal-values
          </a>{' '}
          directly (see note below — the live site currently has no published schedules).
        </p>
        {!rdoLocations && <p className="muted">Loading…</p>}
        {rdoLocations && (
          <table>
            <thead>
              <tr>
                <th>RDO</th>
                <th>Towers / Projects</th>
              </tr>
            </thead>
            <tbody>
              {rdoLocations.map((loc) => (
                <tr key={loc.rdo}>
                  <td>{loc.rdo}</td>
                  <td>{loc.towers.join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>BIR Zonal Values — Revenue Regions</h2>
        <p className="muted">
          BIR's zonal value schedules have no public API, are organized as PDFs per revenue district office, and — as
          of this build — every region on the live site still shows unpublished placeholder content. Zonal value must
          be entered manually per contract after checking{' '}
          <a href={sourceUrl} target="_blank" rel="noreferrer">
            {sourceUrl}
          </a>{' '}
          directly. This list is fetched live from BIR purely as a reference of region names.
        </p>
        {regionsError && <div className="callout callout-error">{regionsError}</div>}
        {!regionsError && !regions && <p className="muted">Loading regions…</p>}
        {regions && (
          <ul style={{ columns: 2, margin: 0, paddingLeft: 20 }}>
            {regions.map((r) => (
              <li key={r.region}>{r.region}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
