import ExcelJS from 'exceljs';
import { cellText, normalizeContractNumber, parseDate, parseNumber } from './parseUtils';
import { round2 } from '../services/computation';

export interface CustomerLedgerPaymentRow {
  baselineDate: Date | null;
  paymentDate: Date | null;
  totalCollection: number | null;
  clearingDocument: string | null;
  orNumber: string | null;
  paymentPrincipal: number | null;
  paymentVat: number | null;
  isSubtotal: boolean;
}

export interface CustomerLedgerParseResult {
  contractNumber: string | null;
  buyerName: string | null;
  estate: string | null;
  tower: string | null;
  unit: string | null;
  totalTCP: number | null;
  netTCP: number | null;
  paymentRecords: CustomerLedgerPaymentRow[];
}

// The Customer Ledger export is a semi-structured "form" layout (label/value
// pairs) followed by a payment-schedule table. We scan every cell for known
// labels rather than assuming fixed row/column positions, since row offsets
// vary slightly between exports (extra blank rows, etc).
//
// Two layouts are supported: the original Customer Ledger export, and
// LedgerFit's current "Assessment-Ready Payment Ledger" (label "Unit"
// instead of "Units", "Total Contract Price (incl. VAT)", a "TOTAL" column,
// a closing TOTAL row, and "◄ …" review notes appended inside OR Number
// cells).
const LABELS: Record<string, keyof Pick<CustomerLedgerParseResult, 'estate' | 'tower' | 'unit' | 'buyerName'>> = {
  estate: 'estate',
  project: 'tower',
  units: 'unit',
  unit: 'unit',
  "buyer's name": 'buyerName',
};

// LedgerFit appends review notes to the OR Number cell, e.g.
// "3038254   ◄ 2.10% @ end of sale year (< 25%)". Only the OR number itself
// belongs in the record.
function cleanOrNumber(raw: string | null): string | null {
  if (!raw) return raw;
  const cleaned = raw.split(/[◄◀]/)[0].trim();
  return cleaned || null;
}

export async function parseCustomerLedger(buffer: Buffer): Promise<CustomerLedgerParseResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0];

  const result: CustomerLedgerParseResult = {
    contractNumber: null,
    buyerName: null,
    estate: null,
    tower: null,
    unit: null,
    totalTCP: null,
    netTCP: null,
    paymentRecords: [],
  };
  if (!sheet) return result;

  let tableHeaderRow = -1;
  let columnIndex: Record<string, number> = {};

  for (let r = 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    for (let c = 1; c <= row.cellCount; c++) {
      const label = cellText(row.getCell(c).value)?.toLowerCase().replace(/\.$/, '');
      if (!label) continue;

      if (label === 'contract no') {
        result.contractNumber = normalizeContractNumber(row.getCell(c + 1).value);
      } else if (label.startsWith('total contract price')) {
        result.totalTCP = parseNumber(row.getCell(c + 1).value);
      } else if (label === 'net tcp') {
        result.netTCP = parseNumber(row.getCell(c + 1).value);
      } else if (label in LABELS) {
        const key = LABELS[label];
        result[key] = cellText(row.getCell(c + 1).value);
      } else if (label === 'payment date') {
        // Found the payment-schedule header row; map its columns by label.
        tableHeaderRow = r;
        for (let hc = 1; hc <= row.cellCount; hc++) {
          const headerLabel = cellText(row.getCell(hc).value)?.toLowerCase();
          if (headerLabel) columnIndex[headerLabel] = hc;
        }
      }
    }
    if (tableHeaderRow > 0) break;
  }

  if (tableHeaderRow > 0) {
    for (let r = tableHeaderRow + 1; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const get = (label: string) => (columnIndex[label] ? row.getCell(columnIndex[label]).value : undefined);
      const paymentDate = parseDate(get('payment date'));
      const paymentPrincipal = parseNumber(get('payment principal'));
      const paymentVat = parseNumber(get('payment vat'));
      // Total Collection is occasionally blank in the source ledger even
      // when Payment Principal/VAT are populated (seen in real data on a
      // multi-million-peso row) — fall back to their sum rather than
      // silently dropping the payment from CWT computation.
      const totalCollection =
        parseNumber(get('total collection')) ??
        parseNumber(get('total')) ??
        (paymentPrincipal !== null || paymentVat !== null ? round2((paymentPrincipal ?? 0) + (paymentVat ?? 0)) : null);
      if (totalCollection === null && paymentDate === null) continue;
      // LedgerFit closes the table with a "TOTAL" row in the Payment Date
      // column — a subtotal, never a payment.
      const isTotalRow = /^total$/i.test(cellText(get('payment date')) ?? '');
      result.paymentRecords.push({
        baselineDate: parseDate(get('baseline date')),
        paymentDate,
        totalCollection,
        clearingDocument: cellText(get('clearing document')),
        orNumber: cleanOrNumber(cellText(get('or number'))),
        paymentPrincipal,
        paymentVat,
        isSubtotal: isTotalRow || parseNumber(get('issubtotal')) === 1,
      });
    }
  }

  return result;
}
