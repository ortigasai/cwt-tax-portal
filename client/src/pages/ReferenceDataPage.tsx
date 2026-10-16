import { useEffect, useState } from 'react';
import { fetchRdoLocations, fetchReferenceConfig, fetchZonalValueRegions } from '../api/client';

export default function ReferenceDataPage() {
  const [config, setConfig] = useState<Awaited<ReturnType<typeof fetchReferenceConfig>> | null>(null);
  const [regions, setRegions] = useState<{ region: string }[] | null>(null);
  const [regionsError, setRegionsError] = useState<string | null>(null);
  const [sourceUrl, setSourceUrl] = useState('https://www.bir.gov.ph/zonal-values');
  const [rdoLocations, setRdoLocations] = useState<{ rdo: string; towers: string[] }[] | null>(null);

  useEffect(() => {
    fetchReferenceConfig()
      .then(setConfig)
      .catch(() => undefined);
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
      <div className="page-header">
        <div>
          <h1>Reference data</h1>
          <p className="page-subtitle">
            Shared lookup files the computations rely on. They are kept current by the folder sync and the SharePoint
            update on the Dashboard — they are read-only in the app.
          </p>
        </div>
      </div>

      <div className="card">
        <h3 className="card-title">Source files — read-only</h3>
        <p className="card-subtitle" style={{ marginBottom: 14 }}>
          {config?.locked === false
            ? 'Reference data edits are currently enabled on this server (ALLOW_REFERENCE_EDITS).'
            : 'The OCLP 1606 Summary, the RPT_ALL TOWERS FMV table and the zonal values cannot be uploaded or edited from the web app.'}{' '}
          They are loaded only from the configured source folders, so the tax team's files stay the single source of truth.
        </p>
        <table>
          <thead>
            <tr>
              <th>Reference data</th>
              <th>Loaded from</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>OCLP 1606 Summary (buyer classification, tax tagging, CWT remitted)</td>
              <td>
                Folder <strong>{config?.dataSyncFolder ?? '…'}</strong> — picked up by <em>Sync from folder</em> /{' '}
                <em>Update from SharePoint</em> on the Dashboard
              </td>
            </tr>
            <tr>
              <td>RPT_ALL TOWERS (Fair Market Value)</td>
              <td>
                Folder <strong>{config?.dataSyncFolder ?? '…'}</strong> (same sync)
              </td>
            </tr>
            <tr>
              <td>Zonal values (ZV RATE workbook)</td>
              <td>
                Folder <strong>{config?.zonalValuesFolder ?? '…'}</strong>; per-contract values also fill from DOAS
              </td>
            </tr>
          </tbody>
        </table>
        <p className="muted" style={{ marginTop: 10, marginBottom: 0 }}>
          To change any of them, replace the file in its source folder and run a sync.
        </p>
      </div>

      <div className="card">
        <h3 className="card-title">Zonal Value Locations — Tower to RDO Mapping</h3>
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
        <h3 className="card-title">BIR Zonal Values — Revenue Regions</h3>
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
