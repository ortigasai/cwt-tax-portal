// Philippine non-business days, used to move a CWT deadline that lands on a
// Saturday, Sunday or holiday to the next business day (e.g. May 10 on a Sunday
// -> May 11). Holidays are the regular (legal) holidays and the special
// non-working days — banks and the BIR are closed on both. Special WORKING days
// (e.g. EDSA anniversary since 2024, All Souls' Day / Christmas Eve in some
// years) are business days and are deliberately NOT listed.
//
// The list for each year follows the Palace proclamation(s) for that year
// (OFFICIAL below, checked against the texts on lawphil.net / the Official
// Gazette), including the Eid'l Fitr / Eid'l Adha proclamations and one-off
// national declarations (election days, bridge days). Nationwide days only —
// proclamations for a single city or province do not apply to the BIR deadline.
// A year not in OFFICIAL (before 2017, or 2028 onwards until its proclamation is
// issued and added) uses a PROJECTED calendar built from the standing laws and
// the usual practice — see projectedHolidays() — and isProjectedYear() lets the
// computation say so next to any deadline that depends on it. The Palace
// publishes each next year's list around August-October, so each autumn: find
// "Declaring the Regular Holidays and Special (Non-Working) Days for the Year
// <next year>" on lawphil.net / officialgazette.gov.ph and copy its regular +
// special (non-working) days into OFFICIAL as MM-DD, with the Eid proclamations
// when they are issued (NCMF recommends the dates close to each Eid).

type Day = [string, string]; // [MM-DD, name]

const OFFICIAL: Record<number, Day[]> = {
  // Proc. 50 (Aug 16, 2016); Proc. 117 (Jan 2); Eid'l Fitr Proc. 235; Eid'l Adha Proc. 297; Oct 31 additional day.
  2017: [
    ['01-01', "New Year's Day"], ['01-02', 'Special non-working day'], ['01-28', 'Chinese New Year'],
    ['02-25', 'EDSA People Power Revolution Anniversary'], ['04-09', 'Araw ng Kagitingan'], ['04-13', 'Maundy Thursday'],
    ['04-14', 'Good Friday'], ['04-15', 'Black Saturday'], ['05-01', 'Labor Day'], ['06-12', 'Independence Day'],
    ['06-26', "Eid'l Fitr"], ['08-21', 'Ninoy Aquino Day'], ['08-28', 'National Heroes Day'], ['09-01', "Eid'l Adha"],
    ['10-31', 'Special non-working day'], ['11-01', "All Saints' Day"], ['11-30', 'Bonifacio Day'], ['12-25', 'Christmas Day'],
    ['12-30', 'Rizal Day'], ['12-31', "New Year's Eve"],
  ],
  // Proc. 269 (Jul 17, 2017); Proc. 479 (May 14 BSKE); Eid'l Fitr Proc. 514; Eid'l Adha Proc. 556; RA 10966 (Dec 8).
  2018: [
    ['01-01', "New Year's Day"], ['02-16', 'Chinese New Year'], ['02-25', 'EDSA People Power Revolution Anniversary'],
    ['03-29', 'Maundy Thursday'], ['03-30', 'Good Friday'], ['03-31', 'Black Saturday'], ['04-09', 'Araw ng Kagitingan'],
    ['05-01', 'Labor Day'], ['05-14', 'Barangay and SK Elections'], ['06-12', 'Independence Day'], ['06-15', "Eid'l Fitr"],
    ['08-21', "Ninoy Aquino Day / Eid'l Adha"], ['08-27', 'National Heroes Day'], ['11-01', "All Saints' Day"],
    ['11-02', "All Souls' Day"], ['11-30', 'Bonifacio Day'], ['12-08', 'Feast of the Immaculate Conception'],
    ['12-24', 'Christmas Eve'], ['12-25', 'Christmas Day'], ['12-30', 'Rizal Day'], ['12-31', "New Year's Eve"],
  ],
  // Proc. 555 (Aug 15, 2018) — its text misprints Good Friday as Apr 10; it is Apr 19. Proc. 719 (May 13 elections);
  // Eid'l Fitr Proc. 729; Eid'l Adha Aug 12.
  2019: [
    ['01-01', "New Year's Day"], ['02-05', 'Chinese New Year'], ['02-25', 'EDSA People Power Revolution Anniversary'],
    ['04-09', 'Araw ng Kagitingan'], ['04-18', 'Maundy Thursday'], ['04-19', 'Good Friday'], ['04-20', 'Black Saturday'],
    ['05-01', 'Labor Day'], ['05-13', 'National and Local Elections'], ['06-05', "Eid'l Fitr"], ['06-12', 'Independence Day'],
    ['08-12', "Eid'l Adha"], ['08-21', 'Ninoy Aquino Day'], ['08-26', 'National Heroes Day'], ['11-01', "All Saints' Day"],
    ['11-02', "All Souls' Day"], ['11-30', 'Bonifacio Day'], ['12-08', 'Feast of the Immaculate Conception'],
    ['12-24', 'Christmas Eve'], ['12-25', 'Christmas Day'], ['12-30', 'Rizal Day'], ['12-31', "New Year's Eve"],
  ],
  // Proc. 845 (Nov 15, 2019); Eid'l Fitr Proc. 944; Eid'l Adha Proc. 985.
  2020: [
    ['01-01', "New Year's Day"], ['01-25', 'Chinese New Year'], ['02-25', 'EDSA People Power Revolution Anniversary'],
    ['04-09', "Araw ng Kagitingan / Maundy Thursday"], ['04-10', 'Good Friday'], ['04-11', 'Black Saturday'],
    ['05-01', 'Labor Day'], ['05-25', "Eid'l Fitr"], ['06-12', 'Independence Day'], ['07-31', "Eid'l Adha"],
    ['08-21', 'Ninoy Aquino Day'], ['08-31', 'National Heroes Day'], ['11-01', "All Saints' Day"], ['11-02', "All Souls' Day"],
    ['11-30', 'Bonifacio Day'], ['12-08', 'Feast of the Immaculate Conception'], ['12-24', 'Christmas Eve'],
    ['12-25', 'Christmas Day'], ['12-30', 'Rizal Day'], ['12-31', "New Year's Eve"],
  ],
  // Proc. 986 (Jul 30, 2020) as amended by Proc. 1107 (Feb 26, 2021): Nov 2, Dec 24 and Dec 31 became special WORKING days.
  // Eid'l Fitr Proc. 1142; Eid'l Adha Proc. 1189.
  2021: [
    ['01-01', "New Year's Day"], ['02-12', 'Chinese New Year'], ['02-25', 'EDSA People Power Revolution Anniversary'],
    ['04-01', 'Maundy Thursday'], ['04-02', 'Good Friday'], ['04-03', 'Black Saturday'], ['04-09', 'Araw ng Kagitingan'],
    ['05-01', 'Labor Day'], ['05-13', "Eid'l Fitr"], ['06-12', 'Independence Day'], ['07-20', "Eid'l Adha"],
    ['08-21', 'Ninoy Aquino Day'], ['08-30', 'National Heroes Day'], ['11-01', "All Saints' Day"], ['11-30', 'Bonifacio Day'],
    ['12-08', 'Feast of the Immaculate Conception'], ['12-25', 'Christmas Day'], ['12-30', 'Rizal Day'],
  ],
  // Proc. 1236 (Oct 29, 2021): Nov 2, Dec 24 and Dec 31 are special WORKING days. Eid'l Fitr Proc. 1356; Proc. 1357
  // (May 9 elections); Eid'l Adha Proc. 2 (s. 2022); Proc. 79 (Oct 31).
  2022: [
    ['01-01', "New Year's Day"], ['02-01', 'Chinese New Year'], ['02-25', 'EDSA People Power Revolution Anniversary'],
    ['04-09', 'Araw ng Kagitingan'], ['04-14', 'Maundy Thursday'], ['04-15', 'Good Friday'], ['04-16', 'Black Saturday'],
    ['05-01', 'Labor Day'], ['05-03', "Eid'l Fitr"], ['05-09', 'National and Local Elections'], ['06-12', 'Independence Day'],
    ['07-09', "Eid'l Adha"], ['08-21', 'Ninoy Aquino Day'], ['08-29', 'National Heroes Day'], ['10-31', 'Special non-working day'],
    ['11-01', "All Saints' Day"], ['11-30', 'Bonifacio Day'], ['12-08', 'Feast of the Immaculate Conception'],
    ['12-25', 'Christmas Day'], ['12-30', 'Rizal Day'],
  ],
  // Proc. 42 (Aug 22, 2022) as amended by Proc. 90 (Nov 11, 2022): Jan 2 added, Araw ng Kagitingan on Mon Apr 10,
  // Bonifacio Day moved to Mon Nov 27 (Thu Nov 30 is a working day). Eid'l Fitr Apr 21; Eid'l Adha Proc. 258;
  // Proc. 359 (Oct 30 BSKE).
  2023: [
    ['01-01', "New Year's Day"], ['01-02', 'Special non-working day'], ['02-25', 'EDSA People Power Revolution Anniversary'],
    ['04-06', 'Maundy Thursday'], ['04-07', 'Good Friday'], ['04-08', 'Black Saturday'], ['04-10', 'Araw ng Kagitingan'],
    ['04-21', "Eid'l Fitr"], ['05-01', 'Labor Day'], ['06-12', 'Independence Day'], ['06-28', "Eid'l Adha"],
    ['08-21', 'Ninoy Aquino Day'], ['08-28', 'National Heroes Day'], ['10-30', 'Barangay and SK Elections'],
    ['11-01', "All Saints' Day"], ['11-02', "All Souls' Day"], ['11-27', 'Bonifacio Day'],
    ['12-08', 'Feast of the Immaculate Conception'], ['12-25', 'Christmas Day'], ['12-30', 'Rizal Day'],
    ['12-31', "New Year's Eve"],
  ],
  // Proc. 368 (Oct 11, 2023); Eid'l Fitr Proc. 514; Eid'l Adha Proc. 579.
  2024: [
    ['01-01', "New Year's Day"], ['02-10', 'Chinese New Year'], ['03-28', 'Maundy Thursday'], ['03-29', 'Good Friday'],
    ['03-30', 'Black Saturday'], ['04-09', 'Araw ng Kagitingan'], ['04-10', "Eid'l Fitr"], ['05-01', 'Labor Day'],
    ['06-12', 'Independence Day'], ['06-17', "Eid'l Adha"], ['08-21', 'Ninoy Aquino Day'], ['08-26', 'National Heroes Day'],
    ['11-01', "All Saints' Day"], ['11-02', "All Souls' Day"], ['11-30', 'Bonifacio Day'],
    ['12-08', 'Feast of the Immaculate Conception'], ['12-24', 'Christmas Eve'], ['12-25', 'Christmas Day'],
    ['12-30', 'Rizal Day'], ['12-31', "New Year's Eve"],
  ],
  // Proc. 727 (Oct 30, 2024); Eid'l Fitr Proc. 839 (Apr 1); Proc. 878 (May 12 elections); Eid'l Adha Proc. 911.
  2025: [
    ['01-01', "New Year's Day"], ['01-29', 'Chinese New Year'], ['04-01', "Eid'l Fitr"], ['04-09', 'Araw ng Kagitingan'],
    ['04-17', 'Maundy Thursday'], ['04-18', 'Good Friday'], ['04-19', 'Black Saturday'], ['05-01', 'Labor Day'],
    ['05-12', 'National and Local Elections'], ['06-06', "Eid'l Adha"], ['06-12', 'Independence Day'],
    ['08-21', 'Ninoy Aquino Day'], ['08-25', 'National Heroes Day'], ['10-31', "All Saints' Day Eve"],
    ['11-01', "All Saints' Day"], ['11-30', 'Bonifacio Day'], ['12-08', 'Feast of the Immaculate Conception'],
    ['12-24', 'Christmas Eve'], ['12-25', 'Christmas Day'], ['12-30', 'Rizal Day'], ['12-31', "New Year's Eve"],
  ],
  // Proc. 1006 (Sep 3, 2025); Eid'l Fitr Proc. 1189; Eid'l Adha Proc. 1264.
  2026: [
    ['01-01', "New Year's Day"], ['02-17', 'Chinese New Year'], ['03-20', "Eid'l Fitr"], ['04-02', 'Maundy Thursday'],
    ['04-03', 'Good Friday'], ['04-04', 'Black Saturday'], ['04-09', 'Araw ng Kagitingan'], ['05-01', 'Labor Day'],
    ['05-27', "Eid'l Adha"], ['06-12', 'Independence Day'], ['08-21', 'Ninoy Aquino Day'], ['08-31', 'National Heroes Day'],
    ['11-01', "All Saints' Day"], ['11-02', "All Souls' Day"], ['11-30', 'Bonifacio Day'],
    ['12-08', 'Feast of the Immaculate Conception'], ['12-24', 'Christmas Eve'], ['12-25', 'Christmas Day'],
    ['12-30', 'Rizal Day'], ['12-31', "New Year's Eve"],
  ],
  // Proc. 1427 (Sep 8, 2026). Its Section 1 lists Chinese New Year (Feb 6), Black Saturday (Mar 27), All Souls' Day
  // (Nov 2) and Christmas Eve (Dec 24) as special WORKING days (the recitals call them non-working) — treated as
  // working days here, as in Section 1. Eid'l Fitr / Eid'l Adha not yet proclaimed: add them when they are.
  2027: [
    ['01-01', "New Year's Day"], ['03-25', 'Maundy Thursday'], ['03-26', 'Good Friday'], ['04-09', 'Araw ng Kagitingan'],
    ['05-01', 'Labor Day'], ['06-12', 'Independence Day'], ['08-21', 'Ninoy Aquino Day'], ['08-30', 'National Heroes Day'],
    ['11-01', "All Saints' Day"], ['11-30', 'Bonifacio Day'], ['12-08', 'Feast of the Immaculate Conception'],
    ['12-25', 'Christmas Day'], ['12-30', 'Rizal Day'], ['12-31', "New Year's Eve"],
  ],
};

const key = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

// Gregorian Easter Sunday (anonymous algorithm) -> [month0, day].
function easter(year: number): [number, number] {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return [month, day];
}

const cache = new Map<number, Map<string, string>>();

// Eid'l Fitr (1 Shawwal) and Eid'l Adha (10 Dhu al-Hijjah) from the tabular
// Islamic calendar. The real date is set by moon sighting and proclaimed
// shortly before, so this can be a day off — it is only a projection.
function islamicToJulianDay(y: number, m: number, d: number): number {
  return d + Math.ceil(29.5 * (m - 1)) + (y - 1) * 354 + Math.floor((3 + 11 * y) / 30) + 1948439.5 - 1;
}

function julianDayToUtc(jd: number): Date {
  return new Date(Date.UTC(1970, 0, 1) + (Math.floor(jd + 0.5) - 2440588) * 86400000);
}

function islamicHolidaysIn(year: number): Day[] {
  const out: Day[] = [];
  const hijriNow = Math.floor((year - 622) * (33 / 32));
  for (let h = hijriNow - 1; h <= hijriNow + 2; h++) {
    for (const [month, day, name] of [[10, 1, "Eid'l Fitr"], [12, 10, "Eid'l Adha"]] as [number, number, string][]) {
      const dt = julianDayToUtc(islamicToJulianDay(h, month, day));
      if (dt.getUTCFullYear() === year) out.push([key(year, dt.getUTCMonth(), dt.getUTCDate()).slice(5), name]);
    }
  }
  return out;
}

// Chinese New Year (the Palace has declared it a special non-working day most
// years); the date follows the lunar calendar, so it is listed.
const CHINESE_NEW_YEAR: Record<number, string> = {
  2028: '01-26', 2029: '02-13', 2030: '02-03', 2031: '01-23', 2032: '02-11', 2033: '01-31',
  2034: '02-19', 2035: '02-08', 2036: '01-28', 2037: '02-15', 2038: '02-04', 2039: '01-24', 2040: '02-12',
};

// The calendar for a year whose proclamation is not in OFFICIAL yet: the regular
// holidays and special non-working days fixed by law (RA 9492, RA 9256, RA 10966),
// Holy Week, the additional days the Palace has declared in most recent years
// (Chinese New Year, All Souls' Day, Christmas Eve), the Eid holidays (estimated),
// and the national election day (2nd Monday of May every third year from 2025).
// It leans towards treating a doubtful day as a holiday; a deadline that depends
// on it is flagged until the real proclamation is added.
export function projectedHolidays(year: number): Map<string, string> {
  const map = new Map<string, string>();
  const add = (m: number, d: number, name: string) => map.set(key(year, m, d), name);

  add(0, 1, "New Year's Day");
  add(3, 9, 'Araw ng Kagitingan');
  add(4, 1, 'Labor Day');
  add(5, 12, 'Independence Day');
  add(10, 30, 'Bonifacio Day');
  add(11, 25, 'Christmas Day');
  add(11, 30, 'Rizal Day');
  // National Heroes Day: last Monday of August
  const aug31 = new Date(Date.UTC(year, 7, 31)).getUTCDay();
  add(7, 31 - ((aug31 + 6) % 7), 'National Heroes Day');
  // Holy Thursday / Good Friday / Black Saturday
  const [em, ed] = easter(year);
  const easterDate = Date.UTC(year, em, ed);
  for (const [offset, name] of [
    [-3, 'Maundy Thursday'],
    [-2, 'Good Friday'],
    [-1, 'Black Saturday'],
  ] as [number, string][]) {
    const dt = new Date(easterDate + offset * 86400000);
    add(dt.getUTCMonth(), dt.getUTCDate(), name);
  }
  // Special non-working days fixed by law
  add(7, 21, 'Ninoy Aquino Day');
  add(10, 1, "All Saints' Day");
  add(11, 8, 'Feast of the Immaculate Conception');
  add(11, 31, "New Year's Eve");
  // Additional days the Palace usually declares
  if (year >= 2018) {
    add(10, 2, "All Souls' Day");
    add(11, 24, 'Christmas Eve');
  }
  const cny = CHINESE_NEW_YEAR[year];
  if (cny) map.set(`${year}-${cny}`, 'Chinese New Year');
  // Eid'l Fitr / Eid'l Adha (estimated) — and, before 2017, the two proclaimed in 2016
  if (year >= 2017) for (const [md, name] of islamicHolidaysIn(year)) map.set(`${year}-${md}`, name);
  if (year === 2016) {
    map.set('2016-07-06', "Eid'l Fitr");
    map.set('2016-09-12', "Eid'l Adha");
  }
  // National elections: second Monday of May, every third year from 2025 (2028, 2031, ...)
  if (year >= 2028 && (year - 2025) % 3 === 0) {
    const may1 = new Date(Date.UTC(year, 4, 1)).getUTCDay();
    add(4, 1 + ((8 - may1) % 7) + 7, 'National and Local Elections');
  }
  return map;
}

// True when the year has no proclamation on file (before 2017, or not added yet),
// so its holidays are a projection rather than the Palace's list.
export function isProjectedYear(year: number): boolean {
  return OFFICIAL[year] === undefined;
}

function holidaysOf(year: number): Map<string, string> {
  const hit = cache.get(year);
  if (hit) return hit;
  const official = OFFICIAL[year];
  const map = official ? new Map(official.map(([md, name]) => [`${year}-${md}`, name] as [string, string])) : projectedHolidays(year);
  cache.set(year, map);
  return map;
}

export function holidayName(date: Date): string | null {
  return holidaysOf(date.getUTCFullYear()).get(key(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())) ?? null;
}

export function isBusinessDay(date: Date): boolean {
  const dow = date.getUTCDay();
  return dow !== 0 && dow !== 6 && holidayName(date) === null;
}

// The date itself when it is a business day, otherwise the next business day.
export function nextBusinessDay(date: Date): Date {
  let d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  while (!isBusinessDay(d)) d = new Date(d.getTime() + 86400000);
  return d;
}
