import { Router } from 'express';
import { RDO_LOCATIONS, findRdoForTower } from '../lib/rdoLocations';
import { fetchZonalValueRegions } from '../services/birZonalValues';
import { lookupZonalValue } from '../services/zonalValueLookup';
import { prisma } from '../lib/prisma';

export const zonalValuesRouter = Router();

// GET /api/zonal-values/lookup/:contractNumber — the automated lookup: from the
// contract's tower (→ RDO) and CTS notary date, find the Department Order in
// effect and any rows matching the tower name in that schedule.
zonalValuesRouter.get('/lookup/:contractNumber', async (req, res) => {
  const contract = await prisma.contract.findUnique({ where: { contractNumber: req.params.contractNumber } });
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  const result = lookupZonalValue({
    tower: contract.tower,
    notaryDate: contract.ctsNotaryDate,
    searchTerm: (req.query.q as string) || contract.tower,
  });
  res.json(result);
});

// GET /api/zonal-values/search?tower=&date=&q= — free-text search within the
// applicable Department Order, for picking a comparable when a property isn't
// listed by name.
zonalValuesRouter.get('/search', (req, res) => {
  const tower = (req.query.tower as string) || null;
  const rdo = (req.query.rdo as string) || findRdoForTower(tower);
  const date = (req.query.date as string) || null;
  const q = (req.query.q as string) || '';
  const result = lookupZonalValue({ tower, rdo, notaryDate: date, searchTerm: q });
  res.json(result);
});

// GET /api/zonal-values/regions — live list of BIR revenue regions, fetched
// on demand (not cached; this is a low-volume internal tool). See
// birZonalValues.ts for why this doesn't attempt to fetch actual documents.
zonalValuesRouter.get('/regions', async (_req, res) => {
  try {
    const regions = await fetchZonalValueRegions();
    res.json({ regions, sourceUrl: 'https://www.bir.gov.ph/zonal-values' });
  } catch (err) {
    res.status(502).json({ error: `Could not reach BIR zonal values page: ${(err as Error).message}` });
  }
});

// GET /api/zonal-values/rdo-locations — the tax team's own tower-to-RDO
// mapping, used to point users at the right zonal value schedule to check.
zonalValuesRouter.get('/rdo-locations', (_req, res) => {
  res.json({ locations: RDO_LOCATIONS });
});
