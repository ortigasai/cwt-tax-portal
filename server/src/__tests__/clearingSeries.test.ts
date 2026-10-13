import { nonCurrentClearingDocs } from '../lib/clearingSeries';

describe('nonCurrentClearingDocs', () => {
  it('accepts a ledger whose clearing documents are all in the 14 series', () => {
    expect(nonCurrentClearingDocs(['1400178058', '1400184166', ' 1400184167 '])).toEqual([]);
  });

  it('flags a clearing document that does not start with 14 (e.g. the 23-series lump)', () => {
    expect(nonCurrentClearingDocs(['2300002790', '1400293926', '2000000001'])).toEqual(['2300002790', '2000000001']);
  });

  it('ignores blank clearing documents (total / subtotal rows)', () => {
    expect(nonCurrentClearingDocs([null, undefined, '', '  ', '1400000001'])).toEqual([]);
  });
});
