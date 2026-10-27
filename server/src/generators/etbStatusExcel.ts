import ExcelJS from 'exceljs';

// The ETB Calculator's results as a workbook: one row per contract with its ETB
// start date, status, analysis state and EVERY missing item, plus a Summary
// sheet of the counts — for easy reference outside the portal.

export interface EtbStatusRow {
  contractNumber: string;
  buyerName: string | null;
  tower: string | null;
  unit: string | null;
  startDate: string | null; // YYYY-MM-DD, null = every payment treated as ETB
  storedClassification: string | null;
  storedTagging: string | null;
  analysisState: 'DONE' | 'PROVISIONAL' | 'PENDING';
  missing: string[];
  status: string;
  ctsNotaryDate: string | null;
  netTCP: number | null;
  cwtTaxBase: number | null;
  taxBaseSource: string | null;
  cwtTaxDue: number | null;
  actualRemitted: number | null;
  variance: number | null;
  totalPenalties: number | null;
  primaryDeadline: string | null;
  paymentCount: number;
  paymentsBeforeStart: number;
}

const MONEY = '#,##0.00';
const DATE = 'mm/dd/yyyy';

const STATUS_LABEL: Record<string, string> = {
  COMPLIANT: 'Compliant',
  UNDER_REMITTED: 'Under-remitted',
  NON_COMPLIANT: 'Not compliant',
  MISSING_DATA: 'Missing data',
};
const ANALYSIS_LABEL: Record<string, string> = { DONE: 'Done', PROVISIONAL: 'Provisional', PENDING: 'Pending' };
const SOURCE_LABEL: Record<string, string> = {
  NET_TCP: 'Net TCP',
  FMV_PER_TAX_DECLARATION: 'FMV per Tax Declaration',
  ZONAL_VALUE: 'Zonal Value',
};
const FILL: Record<string, string> = {
  COMPLIANT: 'FFDDF3E4',
  UNDER_REMITTED: 'FFFBD5D5',
  NON_COMPLIANT: 'FFFBD5D5',
  MISSING_DATA: 'FFE8EBF0',
  DONE: 'FFDDF3E4',
  PROVISIONAL: 'FFFFF1CC',
  PENDING: 'FFE8EBF0',
};

const fill = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

// "YYYY-MM-DD" -> a real Excel date (midnight UTC), or null.
function day(iso: string | null): Date | null {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
}

export async function generateEtbStatusExcel(
  rows: EtbStatusRow[],
  meta: { title: string; defaultStart: string | null; ownStarts: number; missingFromPortal: string[] },
  generatedAt: Date = new Date(),
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Pre-ONETT';
  wb.created = generatedAt;

  const ws = wb.addWorksheet('ETB status', { views: [{ state: 'frozen', xSplit: 2, ySplit: 1 }] });
  const columns: { header: string; key: string; width: number; fmt?: string }[] = [
    { header: 'Contract No.', key: 'contractNumber', width: 16 },
    { header: "Buyer's Name", key: 'buyerName', width: 34 },
    { header: 'Tower', key: 'tower', width: 18 },
    { header: 'Unit', key: 'unit', width: 20 },
    { header: 'ETB Start Date', key: 'startDate', width: 14, fmt: DATE },
    { header: 'Stored As (1606)', key: 'storedAs', width: 26 },
    { header: 'Analysis', key: 'analysis', width: 12 },
    { header: 'Still Needed (all items)', key: 'missing', width: 48 },
    { header: 'CWT Status (as ETB)', key: 'status', width: 16 },
    { header: 'CTS Notary Date', key: 'ctsNotaryDate', width: 14, fmt: DATE },
    { header: 'Net TCP', key: 'netTCP', width: 16, fmt: MONEY },
    { header: 'CWT Tax Base', key: 'cwtTaxBase', width: 16, fmt: MONEY },
    { header: 'Tax Base Source', key: 'taxBaseSource', width: 22 },
    { header: 'CWT Tax Due', key: 'cwtTaxDue', width: 16, fmt: MONEY },
    { header: 'Actual CWT Remitted', key: 'actualRemitted', width: 18, fmt: MONEY },
    { header: 'Variance', key: 'variance', width: 16, fmt: MONEY },
    { header: 'Total Penalties', key: 'totalPenalties', width: 16, fmt: MONEY },
    { header: 'First Deadline', key: 'primaryDeadline', width: 14, fmt: DATE },
    { header: 'Payments', key: 'paymentCount', width: 10 },
    { header: 'Payments Before ETB Start', key: 'paymentsBeforeStart', width: 14 },
  ];
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  const head = ws.getRow(1);
  head.font = { bold: true };
  head.alignment = { vertical: 'middle', wrapText: true };
  head.height = 32;
  head.eachCell((c) => {
    c.fill = fill('FFE7ECF5');
    c.border = { bottom: { style: 'thin' } };
  });

  const colOf = (key: string) => columns.findIndex((c) => c.key === key) + 1;
  for (const r of rows) {
    const added = ws.addRow({
      contractNumber: r.contractNumber,
      buyerName: r.buyerName ?? '',
      tower: r.tower ?? '',
      unit: r.unit ?? '',
      // A contract with no start date is computed with every payment as ETB.
      startDate: day(r.startDate) ?? 'All payments',
      storedAs: [r.storedClassification, r.storedTagging].filter(Boolean).join(' · '),
      analysis: ANALYSIS_LABEL[r.analysisState] ?? r.analysisState,
      missing: r.missing.join('\n'),
      status: STATUS_LABEL[r.status] ?? r.status,
      ctsNotaryDate: day(r.ctsNotaryDate),
      netTCP: r.netTCP,
      cwtTaxBase: r.cwtTaxBase,
      taxBaseSource: r.taxBaseSource ? (SOURCE_LABEL[r.taxBaseSource] ?? r.taxBaseSource) : '',
      cwtTaxDue: r.cwtTaxDue,
      actualRemitted: r.actualRemitted,
      variance: r.variance,
      totalPenalties: r.totalPenalties,
      primaryDeadline: day(r.primaryDeadline),
      paymentCount: r.paymentCount,
      paymentsBeforeStart: r.startDate ? r.paymentsBeforeStart : '',
    });
    added.alignment = { vertical: 'top', wrapText: true };
    columns.forEach((c, i) => {
      if (c.fmt) added.getCell(i + 1).numFmt = c.fmt;
    });
    added.getCell(colOf('analysis')).fill = fill(FILL[r.analysisState] ?? FILL.PENDING);
    added.getCell(colOf('status')).fill = fill(FILL[r.status] ?? FILL.MISSING_DATA);
    if (r.missing.length > 0) added.getCell(colOf('missing')).font = { color: { argb: 'FFB42318' } };
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };

  // ---- Summary ----
  const sum = wb.addWorksheet('Summary');
  sum.columns = [{ width: 46 }, { width: 16 }];
  sum.addRow([`ETB calculation — ${meta.title}`]).font = { bold: true, size: 14 };
  const own = meta.ownStarts;
  sum.addRow([
    `Generated ${generatedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC · ${rows.length} contract(s) · ` +
      (own > 0
        ? `${own} with their own ETB start date${meta.defaultStart ? `, the rest from ${meta.defaultStart}` : ', the rest treated as all payments'}`
        : meta.defaultStart
          ? `all from ${meta.defaultStart}`
          : 'every payment treated as ETB'),
  ]);
  sum.addRow([]);

  const section = (label: string, entries: [string, number][]) => {
    const h = sum.addRow([label, 'Contracts']);
    h.font = { bold: true };
    h.eachCell((c) => (c.fill = fill('FFE7ECF5')));
    for (const [k, v] of entries) sum.addRow([k, v]);
    sum.addRow([]);
  };
  const count = (pred: (r: EtbStatusRow) => boolean) => rows.filter(pred).length;
  section('Analysis', [
    ['Done (ledger can be downloaded)', count((r) => r.analysisState === 'DONE')],
    ['Provisional (ledger not in Reviewed & Accepted yet)', count((r) => r.analysisState === 'PROVISIONAL')],
    ['Pending (something still missing)', count((r) => r.analysisState === 'PENDING')],
  ]);
  const missingCounts = new Map<string, number>();
  for (const r of rows) for (const m of r.missing) missingCounts.set(m, (missingCounts.get(m) ?? 0) + 1);
  section(
    'What is still missing (a contract can appear in several lines)',
    [...missingCounts.entries()].sort((a, b) => b[1] - a[1]),
  );
  section('CWT status (computed as ETB)', [
    ['Compliant', count((r) => r.status === 'COMPLIANT')],
    ['Under-remitted', count((r) => r.status === 'UNDER_REMITTED')],
    ['Not compliant (late remittances / penalties)', count((r) => r.status === 'NON_COMPLIANT')],
    ['Missing data', count((r) => r.status === 'MISSING_DATA')],
  ]);
  const total = (pick: (r: EtbStatusRow) => number | null) => rows.reduce((s, r) => s + (pick(r) ?? 0), 0);
  const first = sum.addRow(['Total CWT tax due (as ETB)', total((r) => r.cwtTaxDue)]);
  sum.addRow(['Total actual CWT remitted', total((r) => r.actualRemitted)]);
  sum.addRow(['Total variance (still unremitted)', total((r) => (r.variance !== null && r.variance > 0 ? r.variance : 0))]);
  const last = sum.addRow(['Total penalties', total((r) => r.totalPenalties)]);
  for (let n = first.number; n <= last.number; n++) sum.getCell(n, 2).numFmt = MONEY;
  if (meta.missingFromPortal.length > 0) {
    sum.addRow([]);
    sum.addRow([`Listed in the calculation but no longer in the portal: ${meta.missingFromPortal.join(', ')}`]);
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}
