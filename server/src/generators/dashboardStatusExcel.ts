import ExcelJS from 'exceljs';

// The Pre-ONETT dashboard as a workbook: one row per contract with its status,
// analysis state and EVERY missing item, plus a Summary sheet of the counts —
// for easy reference outside the portal.

export interface DashboardStatusRow {
  contractNumber: string;
  buyerName: string | null;
  tower: string | null;
  unit: string | null;
  batchNumber: number | null;
  batchTitle: string | null;
  batchDate: Date | string | null;
  buyerClassification: string | null;
  taxTagging: string | null;
  taxTaggingNote: string | null;
  ctsNotaryDate: Date | null;
  netTCP: number | null;
  cwtTaxBase: number | null;
  cwtTaxDue: number | null;
  actualRemitted: number | null;
  variance: number | null;
  totalPenalties: number | null;
  status: string;
  analysisState: 'DONE' | 'PROVISIONAL' | 'PENDING';
  missing: string[];
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

const FILL: Record<string, string> = {
  COMPLIANT: 'FFDDF3E4',
  UNDER_REMITTED: 'FFFBD5D5',
  NON_COMPLIANT: 'FFFBD5D5',
  MISSING_DATA: 'FFE8EBF0',
  DONE: 'FFDDF3E4',
  PROVISIONAL: 'FFFFF1CC',
  PENDING: 'FFE8EBF0',
};

function fill(color: string): ExcelJS.Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
}

export async function generateDashboardStatusExcel(rows: DashboardStatusRow[], generatedAt: Date = new Date()): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Pre-ONETT';
  wb.created = generatedAt;

  // ---- Contracts sheet ----
  const ws = wb.addWorksheet('Dashboard status', { views: [{ state: 'frozen', xSplit: 2, ySplit: 1 }] });
  const columns: { header: string; key: string; width: number; fmt?: string }[] = [
    { header: 'Contract No.', key: 'contractNumber', width: 16 },
    { header: "Buyer's Name", key: 'buyerName', width: 34 },
    { header: 'Tower', key: 'tower', width: 18 },
    { header: 'Unit', key: 'unit', width: 20 },
    { header: 'Batch', key: 'batch', width: 30 },
    { header: 'Uploaded', key: 'batchDate', width: 12, fmt: DATE },
    { header: 'Buyer Classification', key: 'buyerClassification', width: 14 },
    { header: 'Tax Tagging', key: 'taxTagging', width: 16 },
    { header: 'Tagging Note', key: 'taxTaggingNote', width: 40 },
    { header: 'Analysis', key: 'analysis', width: 12 },
    { header: 'Still Needed (all items)', key: 'missing', width: 48 },
    { header: 'CWT Status', key: 'status', width: 16 },
    { header: 'CTS Notary Date', key: 'ctsNotaryDate', width: 14, fmt: DATE },
    { header: 'Net TCP', key: 'netTCP', width: 16, fmt: MONEY },
    { header: 'CWT Tax Base', key: 'cwtTaxBase', width: 16, fmt: MONEY },
    { header: 'CWT Tax Due', key: 'cwtTaxDue', width: 16, fmt: MONEY },
    { header: 'Actual CWT Remitted', key: 'actualRemitted', width: 18, fmt: MONEY },
    { header: 'Variance', key: 'variance', width: 16, fmt: MONEY },
    { header: 'Total Penalties', key: 'totalPenalties', width: 16, fmt: MONEY },
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

  for (const r of rows) {
    const batch =
      r.batchNumber != null ? `#${r.batchNumber}${r.batchTitle ? ` — ${r.batchTitle}` : ''}` : '';
    const added = ws.addRow({
      contractNumber: r.contractNumber,
      buyerName: r.buyerName ?? '',
      tower: r.tower ?? '',
      unit: r.unit ?? '',
      batch,
      batchDate: r.batchDate ? new Date(r.batchDate) : null,
      buyerClassification: r.buyerClassification ?? '',
      taxTagging: r.taxTagging ?? '',
      taxTaggingNote: r.taxTaggingNote ?? '',
      analysis: ANALYSIS_LABEL[r.analysisState] ?? r.analysisState,
      // Every missing item, one per line, so nothing is hidden behind "+N".
      missing: r.missing.join('\n'),
      status: STATUS_LABEL[r.status] ?? r.status,
      ctsNotaryDate: r.ctsNotaryDate,
      netTCP: r.netTCP,
      cwtTaxBase: r.cwtTaxBase,
      cwtTaxDue: r.cwtTaxDue,
      actualRemitted: r.actualRemitted,
      variance: r.variance,
      totalPenalties: r.totalPenalties,
    });
    added.alignment = { vertical: 'top', wrapText: true };
    columns.forEach((c, i) => {
      if (c.fmt) added.getCell(i + 1).numFmt = c.fmt;
    });
    const analysisCell = added.getCell(columns.findIndex((c) => c.key === 'analysis') + 1);
    analysisCell.fill = fill(FILL[r.analysisState] ?? FILL.PENDING);
    const statusCell = added.getCell(columns.findIndex((c) => c.key === 'status') + 1);
    statusCell.fill = fill(FILL[r.status] ?? FILL.MISSING_DATA);
    if (r.missing.length > 0) added.getCell(columns.findIndex((c) => c.key === 'missing') + 1).font = { color: { argb: 'FFB42318' } };
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };

  // ---- Summary sheet ----
  const sum = wb.addWorksheet('Summary');
  sum.columns = [{ width: 44 }, { width: 14 }];
  const title = sum.addRow(['Pre-ONETT — dashboard status']);
  title.font = { bold: true, size: 14 };
  sum.addRow([`Generated ${generatedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC · ${rows.length} contract(s)`]);
  sum.addRow([]);

  const section = (label: string, entries: [string, number][]) => {
    const h = sum.addRow([label, 'Contracts']);
    h.font = { bold: true };
    h.eachCell((c) => (c.fill = fill('FFE7ECF5')));
    for (const [k, v] of entries) sum.addRow([k, v]);
    sum.addRow([]);
  };
  const count = (pred: (r: DashboardStatusRow) => boolean) => rows.filter(pred).length;
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
  section('CWT status', [
    ['Compliant', count((r) => r.status === 'COMPLIANT')],
    ['Under-remitted', count((r) => r.status === 'UNDER_REMITTED')],
    ['Not compliant (late remittances / penalties)', count((r) => r.status === 'NON_COMPLIANT')],
    ['Missing data', count((r) => r.status === 'MISSING_DATA')],
  ]);

  const total = (pick: (r: DashboardStatusRow) => number | null) => rows.reduce((s, r) => s + (pick(r) ?? 0), 0);
  const money = sum.addRow(['Total CWT tax due', total((r) => r.cwtTaxDue)]);
  sum.addRow(['Total actual CWT remitted', total((r) => r.actualRemitted)]);
  sum.addRow(['Total variance (still unremitted)', total((r) => (r.variance !== null && r.variance > 0 ? r.variance : 0))]);
  const pen = sum.addRow(['Total penalties', total((r) => r.totalPenalties)]);
  for (let n = money.number; n <= pen.number; n++) sum.getCell(n, 2).numFmt = MONEY;

  return Buffer.from(await wb.xlsx.writeBuffer());
}
