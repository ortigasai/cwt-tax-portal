import fs from 'fs';
import { assembleFromOcr } from './services/onettOcrAssemble';
import { accountToRows } from './services/onettSummary';

const OUT = process.env.TEMP + '/ocrout/';
const truth = JSON.parse(fs.readFileSync(process.env.EXTRACT!, 'utf8')).accounts as any[];
const pages: { page: number; ocr: any }[] = [];
for (let p = 1; p <= 121; p++) {
  const f = OUT + `p${String(p).padStart(3, '0')}.json`;
  if (fs.existsSync(f)) pages.push({ page: p, ocr: JSON.parse(fs.readFileSync(f, 'utf8')) });
}
const got = assembleFromOcr(pages);
console.log('pages', pages.length, 'accounts found', got.length, 'truth', truth.length);

const cols = ['name', 'location', 'class', 'areaRc', 'areaPs', 'rateRc', 'ratePs', 'zonal', 'fmv', 'sp', 'base', 'due', 'paid', 'sur', 'int', 'comp', 'iris'];
const tally: Record<string, number> = {};
let fullOk = 0;
let compared = 0;
for (const g of got) {
  const t = truth.find((x) => x.sheetPage === g.sheetPage);
  if (!t) {
    console.log('no truth for page', g.sheetPage);
    continue;
  }
  compared++;
  const a = accountToRows(g as any)[0];
  const b = accountToRows(t)[0];
  const cmp: Record<string, [any, any]> = {
    name: [a.buyer, b.buyer],
    location: [a.location, b.location],
    class: [a.class, b.class],
    areaRc: [a.areaRc, b.areaRc],
    areaPs: [a.areaPs, b.areaPs],
    rateRc: [a.zvPerSqmRc, b.zvPerSqmRc],
    ratePs: [a.zvPerSqmPs, b.zvPerSqmPs],
    zonal: [a.zonalValue, b.zonalValue],
    fmv: [a.fmv, b.fmv],
    sp: [a.sellingPrice, b.sellingPrice],
    base: [a.taxBase, b.taxBase],
    due: [a.taxDue, b.taxDue],
    paid: [a.taxPaid, b.taxPaid],
    sur: [a.surcharge, b.surcharge],
    int: [a.interest, b.interest],
    comp: [a.compromise, b.compromise],
    iris: [(g.irisPages || []).length > 0, (t.irisPages || []).length > 0],
  };
  const bad: string[] = [];
  for (const c of cols) {
    const [x, y] = cmp[c];
    const same = typeof x === 'number' && typeof y === 'number' ? Math.abs(x - y) < 0.011 : (x ?? null) === (y ?? null);
    if (same) tally[c] = (tally[c] || 0) + 1;
    else bad.push(`${c}: got ${JSON.stringify(x)} want ${JSON.stringify(y)}`);
  }
  if (bad.length === 0) fullOk++;
  console.log(`${String(t.docket).padEnd(5)} ${bad.length === 0 ? 'ALL OK' : bad.join(' | ')}   [flags ${g.flags!.length}]`);
}
console.log('\nPer column exact (of ' + compared + '):', JSON.stringify(tally));
console.log('Fully exact accounts:', fullOk, '/', compared);
