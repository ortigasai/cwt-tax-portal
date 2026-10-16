import zlib from 'zlib';

// Scanned ONETT packets are PDFs whose pages are one full-page JPEG each
// (DCTDecode, usually wrapped in FlateDecode). That is all this reads — it
// pulls the page images out in file order without any PDF/imaging library.
// Anything else (vector text, JBIG2/CCITT scans) is reported as unsupported.

export interface PdfPageImage {
  page: number;
  jpeg: Buffer;
}

export interface PdfPagesResult {
  pages: PdfPageImage[];
  unsupportedImages: number;
}

function filtersOf(dict: string): string[] {
  const m = /\/Filter\s*(\[[^\]]*\]|\/\w+)/.exec(dict);
  if (!m) return [];
  return [...m[1].matchAll(/\/(\w+)/g)].map((x) => x[1]);
}

function isJpeg(buf: Buffer): boolean {
  return buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8;
}

export function extractPdfPageImages(pdf: Buffer): PdfPagesResult {
  const text = pdf.toString('latin1');
  const pages: PdfPageImage[] = [];
  let unsupported = 0;
  const objRe = /(\d+)\s+(\d+)\s+obj\b/g;
  let m: RegExpExecArray | null;
  while ((m = objRe.exec(text))) {
    const bodyStart = m.index + m[0].length;
    const streamAt = text.indexOf('stream', bodyStart);
    if (streamAt < 0) break;
    const dict = text.slice(bodyStart, streamAt);
    // The dictionary must be this object's own (no "endobj" before "stream").
    if (dict.includes('endobj') || !/\/Subtype\s*\/Image/.test(dict)) continue;

    let dataStart = streamAt + 'stream'.length;
    if (text[dataStart] === '\r') dataStart++;
    if (text[dataStart] === '\n') dataStart++;
    const endAt = text.indexOf('endstream', dataStart);
    if (endAt < 0) break;
    // Prefer the declared /Length (binary data may legitimately end in an EOL
    // byte); fall back to the bytes before "endstream" minus one EOL.
    let data = pdf.subarray(dataStart, endAt);
    const declared = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict);
    const length = declared ? Number(declared[1]) : -1;
    if (length > 0 && dataStart + length <= endAt && /^\s*$/.test(text.slice(dataStart + length, endAt))) {
      data = pdf.subarray(dataStart, dataStart + length);
    } else {
      if (data[data.length - 1] === 0x0a) data = data.subarray(0, data.length - 1);
      if (data[data.length - 1] === 0x0d) data = data.subarray(0, data.length - 1);
    }

    const filters = filtersOf(dict);
    try {
      if (filters.length === 1 && filters[0] === 'DCTDecode') {
        if (isJpeg(data)) pages.push({ page: pages.length + 1, jpeg: Buffer.from(data) });
        else unsupported++;
      } else if (filters.length === 2 && filters[0] === 'FlateDecode' && filters[1] === 'DCTDecode') {
        const inflated = zlib.inflateSync(data);
        if (isJpeg(inflated)) pages.push({ page: pages.length + 1, jpeg: inflated });
        else unsupported++;
      } else {
        unsupported++;
      }
    } catch {
      unsupported++;
    }
    objRe.lastIndex = endAt;
  }
  return { pages, unsupportedImages: unsupported };
}
