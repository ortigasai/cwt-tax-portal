import fs from 'fs';
import os from 'os';
import path from 'path';
import { assembleAccounts, readPages, visionMode } from '../services/onettExtractor';

// The API-key reader, with the network call mocked: checks the request shape and
// that the model's JSON reply flows through to assembled ONETT accounts.
describe('ONETT API reader (mocked)', () => {
  const realFetch = global.fetch;
  const realKey = process.env.ANTHROPIC_API_KEY;
  let dir: string;

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'onett-'));
  });
  afterEach(() => {
    global.fetch = realFetch;
    if (realKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = realKey;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('uses the API when a key is set', () => {
    expect(visionMode()).toBe('api');
  });

  it('sends each page as an image and assembles the replies', async () => {
    const replies: Record<number, object> = {
      1: {
        pageType: 'computation_sheet',
        docket: 'P 33',
        buyers: [{ name: 'CEDRIC KENZO O. YOUNG', tin: '754-889-302' }],
        lines: [{ location: 'MAVEN AT CAPITOL COMMONS', class: 'RC', area: 25, zvPerSqm: 220000, zv: 5500000, fmv: 625000 }],
        sellingPrice: 3160000,
        totalZv: 5500000,
        totalFmv: 625000,
        taxBase: 5500000,
        cgt: { rate: 0.05, perAudit: 275000, taxPaid: 275000, surcharge: 68750, interest: 99031.36, compromise: 65000, total: 232781.36 },
        dst: { base: 5500000, perAudit: 82500, paid: 82500 },
        typedNote: 'engaged in business',
        handwrittenNotes: [],
      },
      2: { pageType: 'iris', docket: 'P33', taxpayerName: 'CEDRIC KENZO YOUNG', businesses: [{ name: 'CKY', status: 'ACTIVE' }] },
    };
    const seen: { url: string; body: { messages: { content: { type: string }[] }[] }; key: string }[] = [];
    let call = 0;
    global.fetch = (async (url: string, init: { headers: Record<string, string>; body: string }) => {
      const body = JSON.parse(init.body);
      seen.push({ url, body, key: init.headers['x-api-key'] });
      const page = ++call; // pages are read in order with concurrency 1
      return {
        ok: true,
        status: 200,
        json: async () => ({ content: [{ type: 'text', text: '```json\n' + JSON.stringify(replies[page]) + '\n```' }] }),
        text: async () => '',
      };
    }) as unknown as typeof fetch;

    const pages = [1, 2].map((page) => {
      const file = path.join(dir, `p${page}.jpg`);
      fs.writeFileSync(file, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
      return { page, jpeg: fs.readFileSync(file), file };
    });
    const progress: number[] = [];
    const { readings, failedPages } = await readPages(pages, (done) => progress.push(done), 1);

    expect(failedPages).toEqual([]);
    expect(progress).toEqual([1, 2]);
    expect(seen).toHaveLength(2);
    expect(seen[0].url).toBe('https://api.anthropic.com/v1/messages');
    expect(seen[0].key).toBe('test-key');
    expect(seen[0].body.messages[0].content.map((c) => c.type)).toEqual(['image', 'text']);

    const accounts = assembleAccounts(readings);
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ docket: 'P33', ewtDue: 275000, totalCgt: 232781.36, irisPages: [2] });
  });

  it('records a page as failed when the API keeps erroring', async () => {
    global.fetch = (async () => ({ ok: false, status: 401, text: async () => 'bad key', json: async () => ({}) })) as unknown as typeof fetch;
    const file = path.join(dir, 'p1.jpg');
    fs.writeFileSync(file, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const { failedPages } = await readPages([{ page: 1, jpeg: fs.readFileSync(file), file }], () => undefined, 1);
    expect(failedPages).toEqual([1]);
  });
});
