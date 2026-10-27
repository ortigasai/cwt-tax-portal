import { buildRowLinker } from '../services/dataImport';

const row = (contractNumberRaw: string, baseContract: string | null = null) => ({ contractNumberRaw, baseContract });

describe('1606 rows are linked via FINAL first, then the "Contracts - look up" tab', () => {
  const ours = new Map([['Y', 'id-Y']]); // we track contract Y only

  it('a contract with a row in FINAL uses the base found there', () => {
    // Y has its own FINAL row (base B); X is a previous buyer's number on the same base.
    const rows = [row('Y', 'B'), row('X', 'B'), row('Z', 'OTHER')];
    const { resolveContractId } = buildRowLinker(rows, new Map(), ours);
    expect(resolveContractId(rows[0])).toBe('id-Y');
    expect(resolveContractId(rows[1])).toBe('id-Y');
    expect(resolveContractId(rows[2])).toBeNull();
  });

  it('a contract with NO row in FINAL gets its base from the look-up tab, then its remittances from FINAL', () => {
    // Y is not in FINAL at all; the look-up tab says Y -> B; FINAL has the previous buyer X filed on base B.
    const rows = [row('X', 'B'), row('X', 'B'), row('Z', 'OTHER')];
    const lookup = new Map([['Y', 'B']]);
    const { resolveContractId } = buildRowLinker(rows, lookup, ours);
    expect(resolveContractId(rows[0])).toBe('id-Y');
    expect(resolveContractId(rows[1])).toBe('id-Y');
    expect(resolveContractId(rows[2])).toBeNull();
  });

  it('FINAL wins over the look-up tab when both name a base', () => {
    const rows = [row('Y', 'B'), row('X', 'B'), row('W', 'C')];
    const lookup = new Map([['Y', 'C']]);
    const { resolveContractId } = buildRowLinker(rows, lookup, ours);
    expect(resolveContractId(rows[1])).toBe('id-Y'); // base B from FINAL
    expect(resolveContractId(rows[2])).toBeNull(); // look-up base C is not used while FINAL has one
  });

  it('a FINAL row with a blank Base Contract is placed by the look-up tab', () => {
    // The previous buyer's rows have no base in FINAL; the look-up tab maps X -> B and Y -> B.
    const rows = [row('X', null), row('X', null)];
    const lookup = new Map([['X', 'B'], ['Y', 'B']]);
    const { resolveContractId, rowBase } = buildRowLinker(rows, lookup, ours);
    expect(resolveContractId(rows[0])).toBe('id-Y');
    expect(rowBase(rows[0])).toBe('B'); // stored on the remittance so the ledger can show it
  });

  it('a contract found nowhere stays unlinked', () => {
    const rows = [row('X', 'B')];
    const { resolveContractId } = buildRowLinker(rows, new Map(), ours);
    expect(resolveContractId(rows[0])).toBeNull();
  });
});
