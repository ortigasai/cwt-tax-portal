// Maps a project/tower to the BIR Revenue District Office whose zonal value
// schedule applies to it, per the tax team's own reference list (BIR's own
// site publishes no queryable data — see birZonalValues.ts). Matching is a
// case-insensitive substring check against the contract's Tower field,
// since that field holds values like "CONNOR AT GREENHILLS (GSC TOWER 2)"
// rather than an exact project name.
export interface RdoLocationGroup {
  rdo: string;
  towers: string[];
}

export const RDO_LOCATIONS: RdoLocationGroup[] = [
  {
    rdo: 'RDO 43 – Pasig City',
    towers: [
      'Maven Tower',
      'Royalton Tower',
      'Imperium Tower',
      'Empress Tower',
      'Glaston',
      'Maple Tower',
      'Galleon Offices',
      'Galleon Residential',
    ],
  },
  {
    rdo: 'RDO 40 – Quezon City',
    towers: ['Majorca', 'Seville', 'Lleida', 'Ibiza', 'Avila', 'Garden Homes'],
  },
  {
    rdo: 'RDO 58 – Batangas City',
    towers: ['Costa Calatagan'],
  },
  {
    rdo: 'RDO 42 – San Juan City',
    towers: ['Connor', 'Viridian'],
  },
];

export function findRdoForTower(tower: string | null | undefined): string | null {
  if (!tower) return null;
  const normalized = tower.toLowerCase();
  for (const group of RDO_LOCATIONS) {
    if (group.towers.some((t) => normalized.includes(t.toLowerCase()))) {
      return group.rdo;
    }
  }
  return null;
}
