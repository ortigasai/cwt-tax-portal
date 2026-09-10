import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  fetchContract,
  ledgerDownloadUrl,
  searchRptTowers,
  updateContract,
  uploadCtsFile,
  uploadCustomerLedger,
  zonalLookup,
  zonalSearch,
} from '../api/client';
import type { ContractDetail, RptTowerRecord, ZonalLookupResult } from '../api/types';
import { formatCurrency, formatDate } from '../utils/format';
import StatusBadge from '../components/StatusBadge';

export default function ContractDetailPage() {
  const { contractNumber } = useParams<{ contractNumber: string }>();
  const [contract, setContract] = useState<ContractDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = () => {
    if (!contractNumber) return;
    fetchContract(contractNumber)
      .then(setContract)
      .catch((e: Error) => setError(e.message));
  };

  useEffect(reload, [contractNumber]);

  if (error) return <div className="callout callout-error">{error}</div>;
  if (!contract) return <p className="muted">Loading…</p>;

  const e = contract.exposure;

  return (
    <div>
      <p>
        <Link to="/">&larr; Back to dashboard</Link>
      </p>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h2>
              Contract {contract.contractNumber} <StatusBadge status={e.status} />
            </h2>
            <p className="muted">
              {contract.buyerName ?? 'Buyer name not on file'} · {contract.tower ?? '—'} {contract.unit ?? ''}
              {contract.estate ? ` · ${contract.estate}` : ''}
            </p>
          </div>
          <a className="btn" href={ledgerDownloadUrl(contract.contractNumber)}>
            Download Tax Payment Ledger (.xlsx)
          </a>
        </div>

        <div className="stat-grid" style={{ marginTop: 16 }}>
          <div className="stat-box">
            <div className="label">CWT Tax Base</div>
            <div className="value">{formatCurrency(e.cwtTaxBase)}</div>
          </div>
          <div className="stat-box">
            <div className="label">CWT Tax Due</div>
            <div className="value">{formatCurrency(e.cwtTaxDue)}</div>
          </div>
          <div className="stat-box">
            <div className="label">Actual Remitted</div>
            <div className="value">{formatCurrency(e.actualRemitted)}</div>
          </div>
          <div className="stat-box">
            <div className="label">Variance / Exposure</div>
            <div className="value">{formatCurrency(e.variance)}</div>
          </div>
        </div>

        {e.penalties && (
          <div className="stat-grid">
            <div className="stat-box">
              <div className="label">Surcharge</div>
              <div className="value">{formatCurrency(e.penalties.surcharge)}</div>
            </div>
            <div className="stat-box">
              <div className="label">Compromise Penalty</div>
              <div className="value">{formatCurrency(e.penalties.compromisePenalty)}</div>
            </div>
            <div className="stat-box">
              <div className="label">
                Interest ({(e.penalties.interestRate * 100).toFixed(0)}%, {e.penalties.daysLate}d late)
              </div>
              <div className="value">{formatCurrency(e.penalties.interest)}</div>
            </div>
            <div className="stat-box">
              <div className="label">Total Penalties</div>
              <div className="value">{formatCurrency(e.penalties.totalPenalties)}</div>
            </div>
          </div>
        )}

        <p className="muted">
          <strong>Deadline rule:</strong> {e.deadline.note}
        </p>
        {e.deadline.entries.length > 0 && (
          <details open={e.deadline.entries.length <= 5}>
            <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
              All applicable CWT deadlines ({e.deadline.entries.length})
            </summary>
            <table style={{ marginTop: 8 }}>
              <thead>
                <tr>
                  <th>Deadline</th>
                  <th>Basis Amount</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {e.deadline.entries.map((entry, i) => (
                  <tr key={i}>
                    <td>{formatDate(entry.date)}</td>
                    <td>{formatCurrency(entry.basisAmount)}</td>
                    <td>{entry.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        )}
      </div>

      {notice && <div className="callout" style={{ background: '#dcfce7', color: '#166534' }}>{notice}</div>}

      <SourceDataCard contract={contract} onChange={reload} onNotice={setNotice} />
      <ManualEntryCard contract={contract} onChange={reload} onNotice={setNotice} />
      <PerPaymentExposureCard contract={contract} />
      <CollectionEventsCard contract={contract} />
    </div>
  );
}

function SourceDataCard({
  contract,
  onChange,
  onNotice,
}: {
  contract: ContractDetail;
  onChange: () => void;
  onNotice: (msg: string) => void;
}) {
  const [busyLedger, setBusyLedger] = useState(false);
  const [busyCts, setBusyCts] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLedger(file: File) {
    setBusyLedger(true);
    setError(null);
    try {
      const res = await uploadCustomerLedger(contract.contractNumber, file);
      onNotice(`Imported ${res.paymentRecordsImported} payment record(s) from the Customer Ledger.`);
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyLedger(false);
    }
  }

  async function handleCts(file: File) {
    setBusyCts(true);
    setError(null);
    try {
      await uploadCtsFile(contract.contractNumber, file);
      onNotice('CTS file attached. Enter the notary date and SQM below after reading it (CTS PDFs are scanned images and cannot be auto-parsed).');
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyCts(false);
    }
  }

  return (
    <div className="card">
      <h3>Source Documents</h3>
      {error && <div className="callout callout-error">{error}</div>}
      <div className="form-grid">
        <div className="field">
          <label>Customer Ledger Excel</label>
          <input type="file" accept=".xlsx,.xls" disabled={busyLedger} onChange={(ev) => {
            const file = ev.target.files?.[0];
            if (file) handleLedger(file);
          }} />
          {contract.customerLedgerFileName && <p className="muted">On file: {contract.customerLedgerFileName}</p>}
        </div>
        <div className="field">
          <label>CTS PDF (reference only — not auto-parsed)</label>
          <input type="file" accept="application/pdf" disabled={busyCts} onChange={(ev) => {
            const file = ev.target.files?.[0];
            if (file) handleCts(file);
          }} />
          {contract.ctsFileName && <p className="muted">On file: {contract.ctsFileName}</p>}
        </div>
      </div>
    </div>
  );
}

function ManualEntryCard({
  contract,
  onChange,
  onNotice,
}: {
  contract: ContractDetail;
  onChange: () => void;
  onNotice: (msg: string) => void;
}) {
  const [ctsNotaryDate, setCtsNotaryDate] = useState(contract.ctsNotaryDate?.slice(0, 10) ?? '');
  const [sqmUnit, setSqmUnit] = useState(contract.sqmUnit?.toString() ?? '');
  const [sqmParking, setSqmParking] = useState(contract.sqmParking?.toString() ?? '');
  const [sqmStorage, setSqmStorage] = useState(contract.sqmStorage?.toString() ?? '');
  const [zonalValuePerSqmUnit, setZonalValuePerSqmUnit] = useState(contract.zonalValuePerSqmUnit?.toString() ?? '');
  const [zonalValuePerSqmParking, setZonalValuePerSqmParking] = useState(
    contract.zonalValuePerSqmParking?.toString() ?? '',
  );
  const [fmvQuery, setFmvQuery] = useState('');
  const [fmvResults, setFmvResults] = useState<RptTowerRecord[]>([]);
  const [fmvParkingQuery, setFmvParkingQuery] = useState('');
  const [fmvParkingResults, setFmvParkingResults] = useState<RptTowerRecord[]>([]);
  const [fmvStorageQuery, setFmvStorageQuery] = useState('');
  const [fmvStorageResults, setFmvStorageResults] = useState<RptTowerRecord[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zonal, setZonal] = useState<ZonalLookupResult | null>(null);
  const [zonalLoading, setZonalLoading] = useState(false);
  const [compQuery, setCompQuery] = useState('');

  async function runZonalLookup() {
    setZonalLoading(true);
    setError(null);
    try {
      setZonal(await zonalLookup(contract.contractNumber));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setZonalLoading(false);
    }
  }

  async function runCompSearch(q: string) {
    setCompQuery(q);
    if (q.trim().length < 2) return;
    setZonalLoading(true);
    try {
      setZonal(await zonalSearch(contract.tower, ctsNotaryDate || contract.ctsNotaryDate, q));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setZonalLoading(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await updateContract(contract.contractNumber, {
        ctsNotaryDate: ctsNotaryDate || null,
        sqmUnit: sqmUnit === '' ? null : Number(sqmUnit),
        sqmParking: sqmParking === '' ? null : Number(sqmParking),
        sqmStorage: sqmStorage === '' ? null : Number(sqmStorage),
        zonalValuePerSqmUnit: zonalValuePerSqmUnit === '' ? null : Number(zonalValuePerSqmUnit),
        zonalValuePerSqmParking: zonalValuePerSqmParking === '' ? null : Number(zonalValuePerSqmParking),
      });
      onNotice('Saved.');
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleFmvSearch(q: string) {
    setFmvQuery(q);
    if (q.trim().length < 1) {
      setFmvResults([]);
      return;
    }
    setFmvResults(await searchRptTowers(q));
  }

  async function selectFmv(record: RptTowerRecord) {
    await updateContract(contract.contractNumber, { matchedRptRecordId: record.id });
    onNotice(`Matched to ${record.tower} / Unit ${record.unit} — FMV ${formatCurrency(record.fairMarketValue)}.`);
    onChange();
  }

  async function handleFmvParkingSearch(q: string) {
    setFmvParkingQuery(q);
    if (q.trim().length < 1) {
      setFmvParkingResults([]);
      return;
    }
    setFmvParkingResults(await searchRptTowers(q));
  }

  async function selectParkingFmv(record: RptTowerRecord) {
    await updateContract(contract.contractNumber, { matchedParkingRptRecordId: record.id });
    onNotice(`Parking matched to ${record.tower} / Unit ${record.unit} — FMV ${formatCurrency(record.fairMarketValue)}.`);
    onChange();
  }

  async function handleFmvStorageSearch(q: string) {
    setFmvStorageQuery(q);
    if (q.trim().length < 1) {
      setFmvStorageResults([]);
      return;
    }
    setFmvStorageResults(await searchRptTowers(q));
  }

  async function selectStorageFmv(record: RptTowerRecord) {
    await updateContract(contract.contractNumber, { matchedStorageRptRecordId: record.id });
    onNotice(`Storage matched to ${record.tower} / Unit ${record.unit} — FMV ${formatCurrency(record.fairMarketValue)}.`);
    onChange();
  }

  return (
    <div className="card">
      <h3>Manual Entry</h3>
      <p className="muted">
        CTS notary date, SQM, and zonal value have no automated source (see Reference Data page) — enter them here
        after reviewing the source documents. The CTS notary date is on the page before the signatories' signatures —
        the one with the blue stamp.
      </p>
      {error && <div className="callout callout-error">{error}</div>}
      <div className="form-grid">
        <div className="field">
          <label>CTS Notary Date</label>
          <input type="date" value={ctsNotaryDate} onChange={(e) => setCtsNotaryDate(e.target.value)} />
        </div>
        <div className="field">
          <label>SQM — Unit</label>
          <input type="number" step="0.01" value={sqmUnit} onChange={(e) => setSqmUnit(e.target.value)} />
        </div>
        <div className="field">
          <label>SQM — Parking</label>
          <input type="number" step="0.01" value={sqmParking} onChange={(e) => setSqmParking(e.target.value)} />
        </div>
        <div className="field">
          <label>SQM — Storage</label>
          <input type="number" step="0.01" value={sqmStorage} onChange={(e) => setSqmStorage(e.target.value)} />
        </div>
        <div className="field">
          <label>Unit Zonal Value per SQM (PHP)</label>
          <input
            type="number"
            step="0.01"
            value={zonalValuePerSqmUnit}
            onChange={(e) => setZonalValuePerSqmUnit(e.target.value)}
          />
          <p className="muted" style={{ marginTop: 4, fontSize: '0.8em' }}>
            Storage always uses this same rate — BIR has no separate schedule row for it.
          </p>
        </div>
        <div className="field">
          <label>Parking Zonal Value per SQM (PHP)</label>
          <input
            type="number"
            step="0.01"
            value={zonalValuePerSqmParking}
            onChange={(e) => setZonalValuePerSqmParking(e.target.value)}
          />
        </div>
        <div className="field">
          <label>RDO</label>
          {contract.rdo ? (
            <p style={{ margin: 0 }}>
              <strong>{contract.rdo}</strong>
              <br />
              <span className="muted" style={{ fontSize: '0.85em' }}>
                check its schedule on{' '}
                <a href="https://www.bir.gov.ph/zonal-values" target="_blank" rel="noreferrer">
                  bir.gov.ph/zonal-values
                </a>
              </span>
            </p>
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              No RDO mapping for this tower yet — see the Reference Data page for the known list.
            </p>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 14, background: 'var(--neutral-bg)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <strong>BIR Zonal Value Lookup</strong>
            <p className="muted" style={{ margin: '2px 0 0' }}>
              Finds the zonal value rate in effect as of the CTS notary date from the tax team's Zonal Value reference sheet.
            </p>
          </div>
          <button className="btn btn-secondary" onClick={runZonalLookup} disabled={zonalLoading}>
            {zonalLoading ? 'Looking up…' : '🔎 Look up by notary date'}
          </button>
        </div>

        {zonal && (
          <div style={{ marginTop: 10 }}>
            <p className="muted" style={{ margin: 0 }}>
              {zonal.rdo ?? '—'} · {zonal.file ?? 'no file'}
              {zonal.applicableDo ? (
                <>
                  {' '}· <strong>DO {zonal.applicableDo.doNo}</strong> (eff.{' '}
                  {zonal.applicableDo.from ? formatDate(zonal.applicableDo.from) : '?'} →{' '}
                  {zonal.applicableDo.to ? formatDate(zonal.applicableDo.to) : 'Present'})
                </>
              ) : null}
              {' '}· classified <strong>{zonal.towerNature === 'COMMERCIAL' ? 'Commercial' : 'Residential'}</strong> — expects{' '}
              <strong>{zonal.expectedUnitClassification}</strong> (unit/storage) / <strong>PS</strong> (parking)
            </p>
            <p style={{ margin: '4px 0 8px' }}>{zonal.message}</p>

            {zonal.namedMatches.length > 0 && (
              <table>
                <thead>
                  <tr>
                    <th>Property</th>
                    <th>Vicinity</th>
                    <th>Class</th>
                    <th>ZV / sqm</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {[...zonal.namedMatches]
                    .sort((a, b) => Number(b.recommended) - Number(a.recommended))
                    .map((m, i) => (
                      <tr key={i} className={m.recommended ? 'row-selected' : undefined}>
                        <td>
                          {m.name}
                          {m.recommended && (
                            <span className="muted" style={{ marginLeft: 6, fontSize: '0.8em' }}>
                              ★ recommended
                            </span>
                          )}
                        </td>
                        <td className="muted">{m.vicinity || '—'}</td>
                        <td>{m.classification}</td>
                        <td>{formatCurrency(m.value)}</td>
                        <td style={{ display: 'flex', gap: 6 }}>
                          <button className="btn btn-secondary" onClick={() => setZonalValuePerSqmUnit(String(m.value))}>
                            Use → Unit/Storage
                          </button>
                          <button
                            className="btn btn-secondary"
                            onClick={() => setZonalValuePerSqmParking(String(m.value))}
                          >
                            Use → Parking
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}

            <div className="field" style={{ maxWidth: 360, marginTop: 10 }}>
              <label>Search comparables in this Department Order</label>
              <input
                value={compQuery}
                onChange={(e) => runCompSearch(e.target.value)}
                placeholder="e.g. Grove, E Rodriguez, all other condominium"
              />
              <p className="muted" style={{ marginTop: 4, fontSize: '0.8em' }}>
                Use when the property isn't listed by name — pick the applicable street/condominium + classification.
              </p>
            </div>
          </div>
        )}
      </div>

      <button className="btn" style={{ marginTop: 14 }} onClick={handleSave} disabled={saving}>
        {saving ? 'Saving…' : 'Save'}
      </button>

      <hr className="section-divider" />

      <h3>Unit/Storage FMV Match (RPT_ALL TOWERS)</h3>
      {contract.matchedRptRecord ? (
        <p>
          Matched: <strong>{contract.matchedRptRecord.tower}</strong> / Unit {contract.matchedRptRecord.unit} — FMV{' '}
          {formatCurrency(contract.matchedRptRecord.fairMarketValue)}
        </p>
      ) : (
        <p className="muted">No FMV match yet.</p>
      )}
      <div className="field" style={{ maxWidth: 320 }}>
        <label>Search by tower or unit</label>
        <input value={fmvQuery} onChange={(e) => handleFmvSearch(e.target.value)} placeholder="e.g. Viridian, L5R106" />
      </div>
      {fmvResults.length > 0 && (
        <table style={{ marginTop: 10 }}>
          <thead>
            <tr>
              <th>Tower</th>
              <th>Unit</th>
              <th>Type</th>
              <th>FMV</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {fmvResults.map((r) => (
              <tr key={r.id}>
                <td>{r.tower}</td>
                <td>{r.unit}</td>
                <td>{r.type ?? '—'}</td>
                <td>{formatCurrency(r.fairMarketValue)}</td>
                <td>
                  <button className="btn btn-secondary" onClick={() => selectFmv(r)}>
                    Select
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <hr className="section-divider" />

      <h3>Parking FMV Match (RPT_ALL TOWERS)</h3>
      {contract.matchedParkingRptRecord ? (
        <p>
          Matched: <strong>{contract.matchedParkingRptRecord.tower}</strong> / Unit{' '}
          {contract.matchedParkingRptRecord.unit} — FMV {formatCurrency(contract.matchedParkingRptRecord.fairMarketValue)}
        </p>
      ) : (
        <p className="muted">No parking FMV match yet.</p>
      )}
      <div className="field" style={{ maxWidth: 320 }}>
        <label>Search by tower or unit</label>
        <input
          value={fmvParkingQuery}
          onChange={(e) => handleFmvParkingSearch(e.target.value)}
          placeholder="e.g. Viridian, L5R106"
        />
      </div>
      {fmvParkingResults.length > 0 && (
        <table style={{ marginTop: 10 }}>
          <thead>
            <tr>
              <th>Tower</th>
              <th>Unit</th>
              <th>Type</th>
              <th>FMV</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {fmvParkingResults.map((r) => (
              <tr key={r.id}>
                <td>{r.tower}</td>
                <td>{r.unit}</td>
                <td>{r.type ?? '—'}</td>
                <td>{formatCurrency(r.fairMarketValue)}</td>
                <td>
                  <button className="btn btn-secondary" onClick={() => selectParkingFmv(r)}>
                    Select
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <hr className="section-divider" />

      <h3>Storage FMV Match (RPT_ALL TOWERS)</h3>
      {contract.matchedStorageRptRecord ? (
        <p>
          Matched: <strong>{contract.matchedStorageRptRecord.tower}</strong> / Unit{' '}
          {contract.matchedStorageRptRecord.unit} — FMV {formatCurrency(contract.matchedStorageRptRecord.fairMarketValue)}
        </p>
      ) : (
        <p className="muted">No storage FMV match yet.</p>
      )}
      <div className="field" style={{ maxWidth: 320 }}>
        <label>Search by tower or unit</label>
        <input
          value={fmvStorageQuery}
          onChange={(e) => handleFmvStorageSearch(e.target.value)}
          placeholder="e.g. Viridian, L5R106"
        />
      </div>
      {fmvStorageResults.length > 0 && (
        <table style={{ marginTop: 10 }}>
          <thead>
            <tr>
              <th>Tower</th>
              <th>Unit</th>
              <th>Type</th>
              <th>FMV</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {fmvStorageResults.map((r) => (
              <tr key={r.id}>
                <td>{r.tower}</td>
                <td>{r.unit}</td>
                <td>{r.type ?? '—'}</td>
                <td>{formatCurrency(r.fairMarketValue)}</td>
                <td>
                  <button className="btn btn-secondary" onClick={() => selectStorageFmv(r)}>
                    Select
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function formatDateList(dates: string[]): string {
  if (dates.length === 0) return '—';
  return dates.map((d) => formatDate(d)).join(', ');
}

function PerPaymentExposureCard({ contract }: { contract: ContractDetail }) {
  const lines = contract.exposure.perPaymentLines;
  if (lines.length === 0) return null;

  const shouldBeDueTotal = lines.reduce((s, l) => s + (l.shouldBeCwtDue ?? 0), 0);
  const cwtFileTaxDueTotal = lines.reduce((s, l) => s + (l.cwtFileTaxDue ?? 0), 0);
  const totalPenaltiesSum = lines.reduce((s, l) => s + (l.penalties?.totalPenalties ?? 0), 0);
  const totalDueSum = lines.reduce((s, l) => s + (l.totalDue ?? 0), 0);
  const tiesOut = Math.abs(cwtFileTaxDueTotal - contract.exposure.actualRemitted) < 0.01;

  return (
    <div className="card">
      <h3>Payment Schedule — Should-Be CWT Exposure per Payment</h3>
      <p className="muted">
        Side-by-side with the Customer Ledger payment schedule: the applicable CWT deadline and should-be due for
        each payment (net of VAT), plus the actual CWT file (OCLP 1606 Summary) line items matched by payment
        month/year — matches the "Duplicate" sheet in the downloaded ledger. Overall compliance is judged at the
        contract level above, not per line.
      </p>
      <table>
        <thead>
          <tr>
            <th>Payment Date</th>
            <th>OR No.</th>
            <th>Total Collection</th>
            <th>Payment Principal</th>
            <th>Payment VAT</th>
            <th>Applicable Deadline</th>
            <th>Should-Be CWT Due</th>
            <th>CWT File Transaction Date</th>
            <th>CWT File Date Paid</th>
            <th>CWT File Tax Base</th>
            <th>CWT File Tax Due</th>
            <th>Remitted in Deadline Month?</th>
            <th>Difference</th>
            <th>Surcharge</th>
            <th>Compromise Penalty</th>
            <th>Interest</th>
            <th>Days</th>
            <th>Total Penalties</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, i) => (
            <tr key={i}>
              <td>{formatDate(line.paymentDate)}</td>
              <td>{line.orNumber ?? '—'}</td>
              <td>{formatCurrency(line.totalCollection)}</td>
              <td>{formatCurrency(line.paymentPrincipal)}</td>
              <td>{formatCurrency(line.paymentVat)}</td>
              <td>{line.applicableDeadline ? formatDate(line.applicableDeadline) : '—'}</td>
              <td>{line.shouldBeCwtDue !== null ? formatCurrency(line.shouldBeCwtDue) : '—'}</td>
              <td>{formatDateList(line.cwtFileTransactionDates)}</td>
              <td>{formatDateList(line.cwtFileDatesPaid)}</td>
              <td>{line.cwtFileTaxBase !== null ? formatCurrency(line.cwtFileTaxBase) : '—'}</td>
              <td>{line.cwtFileTaxDue !== null ? formatCurrency(line.cwtFileTaxDue) : '—'}</td>
              <td>{line.remittedInDeadlineMonth === null ? '—' : line.remittedInDeadlineMonth ? 'Yes' : 'No'}</td>
              <td>{line.difference !== null ? formatCurrency(line.difference) : '—'}</td>
              <td>{line.penalties ? formatCurrency(line.penalties.surcharge) : '—'}</td>
              <td>{line.penalties ? formatCurrency(line.penalties.compromisePenalty) : '—'}</td>
              <td>{line.penalties ? formatCurrency(line.penalties.interest) : '—'}</td>
              <td>{line.penalties ? line.penalties.daysLate : '—'}</td>
              <td>{line.penalties ? formatCurrency(line.penalties.totalPenalties) : '—'}</td>
              <td style={{ fontWeight: line.totalDue !== null ? 600 : undefined }}>
                {line.totalDue !== null ? formatCurrency(line.totalDue) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={6} style={{ textAlign: 'right', fontWeight: 600 }}>
              TOTAL
            </td>
            <td style={{ fontWeight: 600 }}>{formatCurrency(shouldBeDueTotal)}</td>
            <td colSpan={2}></td>
            <td></td>
            <td style={{ fontWeight: 600 }}>{formatCurrency(cwtFileTaxDueTotal)}</td>
            <td></td>
            <td style={{ fontWeight: 600 }}>{formatCurrency(shouldBeDueTotal - cwtFileTaxDueTotal)}</td>
            <td colSpan={3}></td>
            <td></td>
            <td style={{ fontWeight: 600 }}>{formatCurrency(totalPenaltiesSum)}</td>
            <td style={{ fontWeight: 600 }}>{formatCurrency(totalDueSum)}</td>
          </tr>
        </tfoot>
      </table>
      <p className="muted" style={{ marginTop: 8 }}>
        CWT File Tax Due total {tiesOut ? 'ties out to' : 'does NOT tie out to'} the CWT file's actual remitted total
        ({formatCurrency(contract.exposure.actualRemitted)}).
      </p>
    </div>
  );
}

function CollectionEventsCard({ contract }: { contract: ContractDetail }) {
  if (contract.collectionEvents.length === 0) return null;
  return (
    <div className="card">
      <h3>Actual CWT Remittances (OCLP 1606 Summary)</h3>
      <table>
        <thead>
          <tr>
            <th>Transaction Date</th>
            <th>Date Paid</th>
            <th>Source Tax Base</th>
            <th>Actual CWT Remitted</th>
          </tr>
        </thead>
        <tbody>
          {contract.collectionEvents.map((c) => (
            <tr key={c.id}>
              <td>{formatDate(c.transactionDate)}</td>
              <td>{formatDate(c.datePaid)}</td>
              <td>{formatCurrency(c.sourceTaxBase)}</td>
              <td>{formatCurrency(c.actualTaxDue)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
