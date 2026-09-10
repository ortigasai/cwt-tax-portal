// Best-effort fetcher for the BIR Zonal Values page (bir.gov.ph/zonal-values).
//
// The page has no public API, no queryable date/location parameters, and —
// as verified at the time this was built — every one of its 19 revenue-region
// tabs contains only CMS placeholder ("Lorem ipsum...") content with no real
// zonal value schedules or documents published. Its content is also embedded
// as an escaped JSON "flight" payload inside <script> tags (Next.js RSC),
// not a clean DOM, which makes precise per-region content extraction brittle.
//
// Given there is no real data to index yet, we only extract the region name
// list (stable, genuinely useful as a reference/dropdown) rather than
// attempting to detect "real vs. placeholder" content or find document
// links — that heuristic proved unreliable against this page's structure
// and would risk giving false confidence. The per-contract zonal value
// must be entered manually after checking bir.gov.ph/zonal-values directly.
export interface ZonalValueRegionInfo {
  region: string;
}

const BIR_ZONAL_VALUES_URL = 'https://www.bir.gov.ph/zonal-values';

export async function fetchZonalValueRegions(): Promise<ZonalValueRegionInfo[]> {
  const res = await fetch(BIR_ZONAL_VALUES_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CWTTaxExposurePortal/1.0)' },
  });
  if (!res.ok) {
    throw new Error(`BIR site returned HTTP ${res.status}`);
  }
  const html = await res.text();
  return extractRegions(html);
}

export function extractRegions(html: string): ZonalValueRegionInfo[] {
  const labelPattern = /"label\\?":\\?"(Revenue Region[^"\\]*)/g;
  const seen = new Set<string>();
  const regions: ZonalValueRegionInfo[] = [];
  for (const match of html.matchAll(labelPattern)) {
    const region = match[1];
    if (seen.has(region)) continue;
    seen.add(region);
    regions.push({ region });
  }
  return regions;
}
