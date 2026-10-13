import ExcelJS from 'exceljs';
import { parseCustomerLedger } from '../parsers/customerLedgerParser';

// Builds an in-memory workbook laid out like LedgerFit's current
// "Assessment-Ready Payment Ledger" (e.g. ledgerfit_2000000001503_dates-per-SI.xlsx):
// label/value header block, a "Payment Ledger" section, the payment table
// (dates as ISO text), a "◄ …" note appended inside an OR Number cell, and a
// closing TOTAL row.
async function ledgerFitWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Extracted');
  ws.addRow(['LEDGERFIT — Assessment-Ready Payment Ledger']);
  ws.addRow([]);
  ws.addRow(['Estate', 'GREENHILLS SHOPPING CENTER']);
  ws.addRow(['Project', 'CONNOR AT GREENHILLS (GSC TOWER 2)']);
  ws.addRow(['Unit', '3005,R09-3005']);
  ws.addRow(['Customer No.', '2000006585']);
  ws.addRow(["Buyer's Name", 'ISABELITA PEREZ']);
  ws.addRow(['Contract No.', '2000000001503']);
  ws.addRow(['Total Contract Price (incl. VAT)', 9721000]);
  ws.addRow(['Net TCP', 8679464.29]);
  ws.addRow([]);
  ws.addRow(['Payment Ledger']);
  ws.addRow(['Payment Date', 'Clearing Document', 'OR Number', 'Payment Principal', 'Payment VAT', 'TOTAL', 'Cum. % Paid']);
  ws.addRow(['2017-08-16', '1400030768', '3032617', 50000, 6000, 56000, 0.00576]);
  ws.addRow(['2017-12-26', '1400040302', '3038254   ◄ 2.10% @ end of sale year (< 25%)', 34304.46, 4116.54, 38421, 0.02095]);
  ws.addRow(['TOTAL', '', '', 84304.46, 10116.54, 94421, 1]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('parseCustomerLedger — LedgerFit layout', () => {
  it('reads the header block, including the "Unit" and "Total Contract Price (incl. VAT)" labels', async () => {
    const r = await parseCustomerLedger(await ledgerFitWorkbook());
    expect(r.contractNumber).toBe('2000000001503');
    expect(r.buyerName).toBe('ISABELITA PEREZ');
    expect(r.estate).toBe('GREENHILLS SHOPPING CENTER');
    expect(r.tower).toBe('CONNOR AT GREENHILLS (GSC TOWER 2)');
    expect(r.unit).toBe('3005,R09-3005');
    expect(r.totalTCP).toBe(9721000);
    expect(r.netTCP).toBe(8679464.29);
  });

  it('reads ISO-text dates and the TOTAL column as the collection amount', async () => {
    const r = await parseCustomerLedger(await ledgerFitWorkbook());
    const payments = r.paymentRecords.filter((p) => !p.isSubtotal);
    expect(payments).toHaveLength(2);
    expect(payments[0].paymentDate?.toISOString().slice(0, 10)).toBe('2017-08-16');
    expect(payments[0].paymentPrincipal).toBe(50000);
    expect(payments[0].paymentVat).toBe(6000);
    expect(payments[0].totalCollection).toBe(56000);
    expect(payments[0].clearingDocument).toBe('1400030768');
  });

  it('strips the "◄ …" review note out of the OR number', async () => {
    const r = await parseCustomerLedger(await ledgerFitWorkbook());
    const payments = r.paymentRecords.filter((p) => !p.isSubtotal);
    expect(payments[0].orNumber).toBe('3032617');
    expect(payments[1].orNumber).toBe('3038254');
  });

  it('treats the closing TOTAL row as a subtotal, never as a payment', async () => {
    const r = await parseCustomerLedger(await ledgerFitWorkbook());
    const subtotals = r.paymentRecords.filter((p) => p.isSubtotal);
    expect(subtotals).toHaveLength(1);
    expect(subtotals[0].paymentDate).toBeNull();
    expect(subtotals[0].totalCollection).toBe(94421);
    expect(r.paymentRecords.filter((p) => !p.isSubtotal && !p.paymentDate)).toHaveLength(0);
  });
});
