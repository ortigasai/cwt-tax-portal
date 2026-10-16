import { referenceDataLocked } from '../lib/referenceLock';

describe('referenceDataLocked', () => {
  const original = process.env.ALLOW_REFERENCE_EDITS;
  afterEach(() => {
    if (original === undefined) delete process.env.ALLOW_REFERENCE_EDITS;
    else process.env.ALLOW_REFERENCE_EDITS = original;
  });

  it('is locked by default', () => {
    delete process.env.ALLOW_REFERENCE_EDITS;
    expect(referenceDataLocked()).toBe(true);
  });

  it('stays locked for anything but an explicit "true"', () => {
    process.env.ALLOW_REFERENCE_EDITS = 'yes';
    expect(referenceDataLocked()).toBe(true);
    process.env.ALLOW_REFERENCE_EDITS = '';
    expect(referenceDataLocked()).toBe(true);
  });

  it('can be lifted from the server environment only', () => {
    process.env.ALLOW_REFERENCE_EDITS = 'TRUE';
    expect(referenceDataLocked()).toBe(false);
  });
});
