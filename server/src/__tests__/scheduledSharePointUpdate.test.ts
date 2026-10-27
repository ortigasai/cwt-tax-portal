import { nextRunAfter } from '../services/scheduledSharePointUpdate';

// Local-time dates, since the schedule is "10:00 AM server time".
const at = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m - 1, d, h, min, 0, 0);

describe('nextRunAfter — the daily 10:00 AM update', () => {
  it('before 10 AM -> today at 10:00', () => {
    expect(nextRunAfter(at(2026, 10, 23, 8, 30), 10)).toEqual(at(2026, 10, 23, 10));
  });

  it('after 10 AM -> tomorrow at 10:00', () => {
    expect(nextRunAfter(at(2026, 10, 23, 10, 1), 10)).toEqual(at(2026, 10, 24, 10));
  });

  it('exactly 10:00 -> tomorrow (the run that just fired is not repeated)', () => {
    expect(nextRunAfter(at(2026, 10, 23, 10, 0), 10)).toEqual(at(2026, 10, 24, 10));
  });

  it('rolls over a month end', () => {
    expect(nextRunAfter(at(2026, 10, 31, 15), 10)).toEqual(at(2026, 11, 1, 10));
  });
});
