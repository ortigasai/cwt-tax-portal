import {
  buildComputationInput,
  computeContractExposure,
  ContractWithRelations,
  deriveDisplayFields,
  etbOverride,
} from '../services/contractExposureService';

const dec = (n: number) => ({ toNumber: () => n });

// A contract stored as an INDIVIDUAL on CASH DEFERRED terms — the opposite of
// ETB + Installment on both counts.
function storedContract(overrides: { taxTagging: string | null; buyerClassification: string | null }): ContractWithRelations {
  return {
    contractNumber: '2000000000001',
    tower: 'MAVEN TOWER',
    netTCP: dec(1_000_000),
    zonalValuePerSqmUnit: null,
    zonalValuePerSqmParking: null,
    sqmUnit: null,
    sqmParking: null,
    sqmStorage: null,
    matchedRptRecord: null,
    matchedParkingRptRecord: null,
    matchedStorageRptRecord: null,
    paymentRecords: [
      { paymentDate: new Date('2023-01-15'), totalCollection: dec(112000), isSubtotal: false, paymentPrincipal: dec(100000) },
      { paymentDate: new Date('2023-02-15'), totalCollection: dec(224000), isSubtotal: false, paymentPrincipal: dec(200000) },
    ],
    collectionEvents: [
      {
        buyerClassification: overrides.buyerClassification,
        taxTagging: overrides.taxTagging,
        actualTaxDue: dec(0),
        datePaid: null,
        transactionDate: null,
        sourceTaxBase: null,
        baseContract: null,
        contractNumberRaw: null,
      },
    ],
  } as unknown as ContractWithRelations;
}

describe('ETB Calculator override', () => {
  it.each([
    ['INDIVIDUAL', 'CASH DEFERRED'],
    ['INDIVIDUAL', 'INSTALLMENT'],
    ['CORPORATION', 'AR SALE'],
    [null, null],
  ])('treats %s / %s as ETB + Installment', (buyerClassification, taxTagging) => {
    const contract = storedContract({ buyerClassification, taxTagging });
    const input = buildComputationInput(contract, etbOverride(null));
    expect(input.buyerClassification).toBe('ETB');
    expect(input.taxTagging).toBe('INSTALLMENT');

    const exposure = computeContractExposure(contract, new Date('2023-06-01'), etbOverride(null));
    // One deadline per payment, each on its own principal x 5%.
    expect(exposure.deadline.entries.map((e) => e.basisAmount)).toEqual([5000, 10000]);
    expect(exposure.deadline.primaryDeadline?.toISOString().slice(0, 10)).toBe('2023-02-10');
  });

  it('leaves the normal computation untouched when no override is given', () => {
    const contract = storedContract({ buyerClassification: 'INDIVIDUAL', taxTagging: 'CASH DEFERRED' });
    const input = buildComputationInput(contract);
    expect(input.buyerClassification).toBe('INDIVIDUAL');
    expect(input.taxTagging).toBe('CASH_DEFERRED');
    expect(deriveDisplayFields(contract).taxTagging).toBe('CASH DEFERRED');
  });

  it('applies the ETB start date to the computation input', () => {
    const contract = storedContract({ buyerClassification: 'INDIVIDUAL', taxTagging: 'INSTALLMENT' });
    const start = new Date('2023-02-01');
    const exposure = computeContractExposure(contract, new Date('2023-06-01'), etbOverride(start));
    expect(exposure.deadline.entries).toHaveLength(1);
    expect(exposure.deadline.primaryDeadline?.toISOString().slice(0, 10)).toBe('2023-03-10');
  });
});
