import path from 'path';
import Jimp from 'jimp';
import { createScheduler, createWorker, PSM, type Scheduler } from 'tesseract.js';

// Free, offline reading of scanned ONETT pages: the form's box lines are erased
// (they corrupt digits), the page is enlarged, and Tesseract returns every word
// with its position. The parsers in onettOcrParse.ts turn those words into
// ONETT records and cross-check them arithmetically.

export interface OcrWord {
  text: string;
  /** Position in the ORIGINAL page's pixel coordinates. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  conf: number;
}

export interface OcrPage {
  width: number;
  height: number;
  words: OcrWord[];
  /** Reading-order text lines rebuilt from the words. */
  lines: OcrLine[];
}

export interface OcrLine {
  text: string;
  y: number;
  x0: number;
  x1: number;
  words: OcrWord[];
}

const SCALE = 2;

// Erase long horizontal / vertical dark runs (box borders, rules) and binarise.
export function removeLines(img: Jimp, threshold = 170, minRun = 45): Jimp {
  const { width: w, height: h, data } = img.bitmap;
  const dark = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const g = data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114;
    dark[i] = g < threshold ? 1 : 0;
  }
  const kill = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let run = 0;
    for (let x = 0; x <= w; x++) {
      if (x < w && dark[y * w + x]) run++;
      else {
        if (run >= minRun) for (let k = x - run; k < x; k++) kill[y * w + k] = 1;
        run = 0;
      }
    }
  }
  for (let x = 0; x < w; x++) {
    let run = 0;
    for (let y = 0; y <= h; y++) {
      if (y < h && dark[y * w + x]) run++;
      else {
        if (run >= minRun) for (let k = y - run; k < y; k++) kill[k * w + x] = 1;
        run = 0;
      }
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const near =
        kill[i] ||
        (x > 0 && kill[i - 1]) ||
        (x < w - 1 && kill[i + 1]) ||
        (y > 0 && kill[i - w]) ||
        (y < h - 1 && kill[i + w]);
      const v = dark[i] && !near ? 0 : 255;
      data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v;
      data[i * 4 + 3] = 255;
    }
  }
  return img;
}

let schedulerPromise: Promise<Scheduler> | null = null;

// A shared pool of Tesseract workers using the bundled English model (no
// network access needed).
export function getScheduler(): Promise<Scheduler> {
  if (!schedulerPromise) {
    schedulerPromise = (async () => {
      const langPath = path.dirname(require.resolve('@tesseract.js-data/eng/package.json')) + '/4.0.0_best_int';
      const count = Math.max(1, Math.min(Number(process.env.ONETT_OCR_WORKERS) || 3, 6));
      const scheduler = createScheduler();
      for (let i = 0; i < count; i++) {
        const worker = await createWorker('eng', 1, { langPath, gzip: true, cacheMethod: 'none' });
        await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, preserve_interword_spaces: '1' });
        scheduler.addWorker(worker);
      }
      return scheduler;
    })();
  }
  return schedulerPromise;
}

export async function shutdownOcr(): Promise<void> {
  if (!schedulerPromise) return;
  const s = await schedulerPromise;
  schedulerPromise = null;
  await s.terminate();
}

function groupLines(words: OcrWord[]): OcrLine[] {
  const sorted = [...words].sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2);
  const lines: OcrLine[] = [];
  for (const w of sorted) {
    const cy = (w.y0 + w.y1) / 2;
    const h = w.y1 - w.y0;
    const line = lines.find((l) => Math.abs(l.y - cy) <= Math.max(6, h * 0.55));
    if (line) {
      line.words.push(w);
      line.y = (line.y * (line.words.length - 1) + cy) / line.words.length;
    } else {
      lines.push({ text: '', y: cy, x0: w.x0, x1: w.x1, words: [w] });
    }
  }
  for (const l of lines) {
    l.words.sort((a, b) => a.x0 - b.x0);
    l.x0 = l.words[0].x0;
    l.x1 = l.words[l.words.length - 1].x1;
    l.text = l.words.map((w) => w.text).join(' ');
  }
  return lines.sort((a, b) => a.y - b.y);
}

// Read a whole page: lines erased, 2x enlarged, words with original-pixel boxes.
export async function ocrPage(jpeg: Buffer): Promise<OcrPage> {
  const img = await Jimp.read(jpeg);
  const width = img.bitmap.width;
  const height = img.bitmap.height;
  removeLines(img);
  img.scale(SCALE, Jimp.RESIZE_BICUBIC);
  const png = await img.getBufferAsync(Jimp.MIME_PNG);
  const scheduler = await getScheduler();
  const { data } = await scheduler.addJob('recognize', png, {}, { blocks: true });
  const words: OcrWord[] = [];
  for (const block of data.blocks ?? []) {
    for (const para of block.paragraphs) {
      for (const line of para.lines) {
        for (const w of line.words) {
          const text = w.text.trim();
          if (!text) continue;
          words.push({
            text,
            x0: w.bbox.x0 / SCALE,
            y0: w.bbox.y0 / SCALE,
            x1: w.bbox.x1 / SCALE,
            y1: w.bbox.y1 / SCALE,
            conf: w.confidence,
          });
        }
      }
    }
  }
  return { width, height, words, lines: groupLines(words) };
}
