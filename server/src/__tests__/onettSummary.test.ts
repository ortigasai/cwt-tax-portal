import ExcelJS from 'exceljs';
import {
  accountToRows,
  buildSummaryWorkbook,
  classLabel,
  issueLabel,
  propertyName,
  remarksLabel,
  reviewFlags,
  type OnettAccount,
} from '../services/onettSummary';
import { assembleAccounts, normalizeDocket, type PageReading } from '../services/onettExtractor';
import { extractPdfPageImages } from '../lib/pdfPages';

// The two sample accounts in "ONETT Summary template.xlsx".
const p33: OnettAccount = {
  docket: 'P33',
  buyers: ['CEDRIC KENZO O. YOUNG'],
  lines: [{ location: 'MAVEN AT CAPITOL COMMONS', class: 'RC', area: 25, zvPerSqm: 220000, zv: 5500000, fmv: 625000 }],
  zvTotal: 5500000,
  fmvTotal: 625000,
  sp: 3160000,
  rate: 0.05,
  taxBase: 5500000,
  ewtDue: 275000,
  ewtPaid: 275000,
  surcharge: 68750,
  interest: 99031.36,
  compromise: 65000,
  dstBase: 5500000,
  dstDue: 82500,
  dstPaid: 82500,
  dstShort: 0,
  dstPenalties: 0,
  irisPages: [3, 4],
};

const p37: OnettAccount = {
  docket: 'P37',
  buyers: ['DAN NOEL R. NATINDIM'],
  lines: [{ location: 'MAVEN AT CAPITOL COMMONS', class: 'PS', area: 50, zvPerSqm: 38000, zv: 1900000, fmv: 1250000 }],
  zvTotal: 1900000,
  fmvTotal: 1250000,
  sp: 6190000,
  rate: 0.05,
  taxBase: 6190000,
  ewtDue: 309500,
  ewtPaid: 309500,
  surcharge: 50695.61,
  interest: 127698.56,
  compromise: 116000,
  irisPages: [8, 9],
};

describe('ONETT summary rows', () => {
  it('maps a single-line sheet to the template row', () => {
    const [row, ...rest] = accountToRows(p33);
    expect(rest).toHaveLength(0);
    expect(row).toMatchObject({
      buyer: 'CEDRIC KENZO O. YOUNG',
      location: 'MAVEN AT CAPITOL COMMONS',
      class: 'RC',
      areaRc: 25,
      areaPs: null,
      zvPerSqmRc: 220000,
      zvPerSqmPs: null,
      zonalValue: 5500000,
      zonalIsFormula: true,
      fmv: 625000,
      sellingPrice: 3160000,
      issue: 'ENGAGED IN BUSINESS',
      taxType: 'EWT',
      taxBase: 5500000,
      taxDue: 275000,
      taxPaid: 275000,
      surcharge: 68750,
      interest: 99031.36,
      compromise: 65000,
      remarks: 'WITH IRIS',
    });
  });

  it('adds a DST row only when DST has a shortfall or penalty', () => {
    expect(accountToRows(p37)).toHaveLength(1);
    const rows = accountToRows({ ...p37, dstBase: 6190000, dstDue: 92850, dstPaid: 90000, dstShort: 2850 });
    expect(rows.map((r) => r.taxType)).toEqual(['EWT', 'DST']);
    expect(rows[1].taxDue).toBe(92850);
  });

  it('labels multi-property sheets, locations, issue and remarks', () => {
    expect(
      classLabel([
        { location: '', class: 'RC', area: 0, zvPerSqm: 0, zv: 0, fmv: 0 },
        { location: '', class: 'PS', area: 0, zvPerSqm: 0, zv: 0, fmv: 0 },
        { location: '', class: 'PS', area: 0, zvPerSqm: 0, zv: 0, fmv: 0 },
      ]),
    ).toBe('RC + PS');
    expect(propertyName('Maven at Capitol Commons, Oranbo, Pasig')).toBe('MAVEN AT CAPITOL COMMONS');
    expect(issueLabel(0.06)).toBe('NOT ENGAGED IN BUSINESS');
    expect(remarksLabel({ ...p33, irisPages: [] })).toBe('NO IRIS');
    expect(remarksLabel({ ...p33, remarksHandwritten: 'W/ IRIS' })).toBe('WITH IRIS');
  });

  it('flags arithmetic that does not tie out', () => {
    expect(reviewFlags(p33)).toEqual([]);
    const flags = reviewFlags({ ...p33, totalCgt: 232781.5 });
    expect(flags.some((f) => f.startsWith('Sheet total'))).toBe(true);
  });
});

describe('RC / PS column split', () => {
  const mixed: OnettAccount = {
    ...p33,
    docket: 'P54',
    lines: [
      { location: 'THE IMPERIUM AT CAPITOL COMMONS', class: 'RC', area: 204, zvPerSqm: 38000, zv: 7752000, fmv: 5100000 },
      { location: 'CAPITOL COMMONS', class: 'PS', area: 12.5, zvPerSqm: 24000, zv: 300000, fmv: 200000 },
      { location: 'PASIG CITY', class: 'PS', area: 12.5, zvPerSqm: 24000, zv: 300000, fmv: 200000 },
      // The continuation rows on a sheet carry no area and are ignored.
      { location: 'PASIG CITY', class: 'RC', area: 0, zvPerSqm: 0, zv: 0, fmv: 0 },
    ],
    zvTotal: 8352000,
    fmvTotal: 5500000,
  };

  it('sums RC/CC/storage and PS separately and keeps the zonal formula', () => {
    const [row] = accountToRows(mixed);
    expect(row).toMatchObject({
      areaRc: 204,
      areaPs: 25,
      zvPerSqmRc: 38000,
      zvPerSqmPs: 24000,
      zonalValue: 8352000,
      zonalIsFormula: true,
      class: 'RC + PS',
    });
  });

  it('leaves the rate blank (and the zonal value hard-coded) when rates differ in a group', () => {
    const [row] = accountToRows({
      ...mixed,
      lines: [
        { location: 'X', class: 'PS', area: 52, zvPerSqm: 150000, zv: 7800000, fmv: 1300000 },
        { location: 'X', class: 'RC', area: 12.5, zvPerSqm: 120000, zv: 1500000, fmv: 200000 },
        { location: 'X', class: 'PS', area: 12.5, zvPerSqm: 120000, zv: 1500000, fmv: 200000 },
      ],
      zvTotal: 10800000,
    });
    expect(row).toMatchObject({ areaRc: 12.5, areaPs: 64.5, zvPerSqmRc: 120000, zvPerSqmPs: null, zonalIsFormula: false });
  });

  it('treats CC and storage like RC', () => {
    const [row] = accountToRows({
      ...p33,
      lines: [
        { location: 'X', class: 'CC', area: 30, zvPerSqm: 100000, zv: 3000000, fmv: 1 },
        { location: 'X', class: 'ST', area: 5, zvPerSqm: 100000, zv: 500000, fmv: 1 },
      ],
      zvTotal: 3500000,
    });
    expect(row).toMatchObject({ areaRc: 35, areaPs: null, zvPerSqmRc: 100000 });
  });
});

describe('ONETT summary workbook', () => {
  it('writes the template layout with formulas', async () => {
    const buf = await buildSummaryWorkbook([p37, p33]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
    const ws = wb.getWorksheet('Template')!;
    expect(ws.getRow(1).values).toEqual(expect.arrayContaining(['NAME ON BUYER 1', 'SHORT CWT/DST', 'REMARKS']));
    // Sorted by docket: P33 first.
    expect(ws.getCell('A2').value).toBe('CEDRIC KENZO O. YOUNG');
    expect(ws.getCell('D1').value).toBe('AREA SQM (RC)');
    expect(ws.getCell('E1').value).toBe('AREA SQM (PS)');
    expect((ws.getCell('H2').value as ExcelJS.CellFormulaValue).formula).toBe('D2*F2+E2*G2');
    expect((ws.getCell('P2').value as ExcelJS.CellFormulaValue).formula).toBe('N2-O2');
    expect((ws.getCell('T3').value as ExcelJS.CellFormulaValue).result).toBeCloseTo(294394.17, 2);
    // P37's only line is classed PS, so its area and rate land in the PS columns.
    expect(ws.getCell('D3').value).toBeNull();
    expect(ws.getCell('E3').value).toBe(50);
    expect(ws.getCell('G3').value).toBe(38000);
    expect(wb.getWorksheet('Review flags')).toBeDefined();
  });
});

describe('ONETT extractor helpers', () => {
  it('normalises docket labels', () => {
    expect(normalizeDocket('P 37')).toBe('P37');
    expect(normalizeDocket('PC 8')).toBe('PC8');
    expect(normalizeDocket('p-b16')).toBe('PB16');
    expect(normalizeDocket(null)).toBeNull();
  });

  it('groups schedule and IRIS pages under the preceding computation sheet', () => {
    const readings: PageReading[] = [
      {
        page: 1,
        pageType: 'computation_sheet',
        docket: 'P 33',
        buyers: [{ name: 'CEDRIC KENZO O. YOUNG', tin: '754-889-302' }],
        lines: [{ location: 'MAVEN AT CAPITOL COMMONS', class: 'RC', area: 25, zvPerSqm: 220000, zv: 5500000, fmv: 625000 }],
        sellingPrice: 3160000,
        totalZv: 5500000,
        totalFmv: 625000,
        taxBase: 5500000,
        cgt: { rate: 0.05, perAudit: 275000, taxPaid: 275000, surcharge: 68750, interest: 99031.36, compromise: 65000, total: 232781.36 },
        dst: { base: 5500000, perAudit: 82500, paid: 82500 },
        typedNote: 'ENGAGED IN BUSINESS',
        handwrittenNotes: [],
      },
      { page: 2, pageType: 'schedule', docket: null, totals: { ewtDue: 275000 } },
      { page: 3, pageType: 'iris', docket: 'P33', taxpayerName: 'CEDRIC YOUNG', businesses: [{ name: 'CKY', status: 'ACTIVE' }] },
      { page: 4, pageType: 'computation_sheet', docket: 'P37', buyers: [{ name: 'X' }], lines: [], cgt: {}, dst: {} },
    ];
    const accounts = assembleAccounts(readings);
    expect(accounts.map((a) => a.docket)).toEqual(['P33', 'P37']);
    expect(accounts[0]).toMatchObject({ schedulePages: [2], irisPages: [3], ewtDue: 275000, totalCgt: 232781.36 });
    expect(accounts[0].irisFinding).toContain('CKY');
  });
});

describe('PDF page image extraction', () => {
  it('pulls a DCT page image out of a minimal PDF', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);
    const pdf = Buffer.concat([
      Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /Filter /DCTDecode /Length 12 >>\nstream\n', 'latin1'),
      jpeg,
      Buffer.from('\nendstream\nendobj\n%%EOF', 'latin1'),
    ]);
    const { pages, unsupportedImages } = extractPdfPageImages(pdf);
    expect(unsupportedImages).toBe(0);
    expect(pages).toHaveLength(1);
    expect(pages[0].jpeg.equals(jpeg)).toBe(true);
  });
});
