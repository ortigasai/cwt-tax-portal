import ExcelJS from 'exceljs';
import { cellText, normalizeContractNumber, parseDate, parseNumber } from './parseUtils';

export interface Oclp1606Row {
  contractNumberRaw: string;
  buyerClassification: string | null;
  taxTagging: string | null;
  sourceTaxBase: number | null;
  sourceRate: number | null;
  actualTaxDue: number | null;
  transactionDate: Date | null;
  datePaid: Date | null;
  remarks: string | null;
  // The stable contract number a remittance lineage is anchored to, even
  // when a unit's buyer (and contract number) changed mid-payment — see
  // "Base contract" note in dataImport.ts.
  baseContract: string | null;
}

// ExcelJS's stream WorksheetReader exposes `name` at runtime but its type
// declarations omit it.
type NamedWorksheetReader = ExcelJS.stream.xlsx.WorksheetReader & { name: string };

// Streams the OCLP 1606 Summary workbook (can be 15-20MB / 70k+ rows) and
// extracts every row from the "FINAL" tab. Column layout per FS Section 4:
//   A Unit | B Profit Center Name | C Contract Number | D Customer Number |
//   E Customer Name | F Individual/Corporate | G Tax Tagging | H TIN |
//   I CWT tax base | J Rate | K TAX Due | L TRANSACTION DATE | M DATE PAID | N REMARKS |
//   O Base contract
export async function parseOclp1606Summary(filePath: string): Promise<Oclp1606Row[]> {
  const workbookReader = new ExcelJS.stream.xlsx.WorkbookReader(filePath, {});
  const rows: Oclp1606Row[] = [];

  for await (const worksheetReader of workbookReader) {
    const isFinalSheet = (worksheetReader as NamedWorksheetReader).name === 'FINAL';
    let headerSeen = false;

    for await (const row of worksheetReader) {
      if (!isFinalSheet) continue;

      const values = row.values as ExcelJS.CellValue[]; // 1-indexed; values[0] is unused
      const colA = cellText(values[1]);

      if (!headerSeen) {
        if (colA?.toLowerCase() === 'unit') headerSeen = true;
        continue;
      }

      const contractNumberRaw = normalizeContractNumber(values[3]);
      if (!contractNumberRaw) continue;

      rows.push({
        contractNumberRaw,
        buyerClassification: cellText(values[6]),
        taxTagging: cellText(values[7]),
        sourceTaxBase: parseNumber(values[9]),
        sourceRate: parseNumber(values[10]),
        actualTaxDue: parseNumber(values[11]),
        transactionDate: parseDate(values[12]),
        datePaid: parseDate(values[13]),
        remarks: cellText(values[14]),
        baseContract: normalizeContractNumber(values[15]),
      });
    }
  }

  return rows;
}
