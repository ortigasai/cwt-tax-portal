// Whether a tower is residential or commercial in nature, per the tax team's
// own classification — this determines which BIR zonal-value schedule row
// applies to its unit/storage: RC (Residential Condominium) for residential
// towers, CC (Commercial Condominium) for commercial ones. Parking is always
// PS (Parking Slot) regardless of the tower's nature.
export type TowerNature = 'RESIDENTIAL' | 'COMMERCIAL';

// Substring-matched (case-insensitive) against the contract's Tower field,
// same convention as rdoLocations.ts. Deliberately specific — "Galleon
// Offices" must not match "Galleon Residential".
const COMMERCIAL_TOWERS = ['Glaston', 'Galleon Offices'];

export function classifyTowerNature(tower: string | null | undefined): TowerNature {
  if (!tower) return 'RESIDENTIAL';
  const normalized = tower.toLowerCase();
  return COMMERCIAL_TOWERS.some((t) => normalized.includes(t.toLowerCase())) ? 'COMMERCIAL' : 'RESIDENTIAL';
}

// The BIR schedule classification code that applies to a unit/storage room
// (never parking) for a tower of the given nature.
export function expectedUnitClassification(nature: TowerNature): 'RC' | 'CC' {
  return nature === 'COMMERCIAL' ? 'CC' : 'RC';
}
