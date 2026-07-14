import { getDistanceInMeters } from './locationUtils';

export interface NairobiArea {
  name: string;
  latitude: number;
  longitude: number;
}

// Approximate centers of Nairobi's main venue / nightlife areas. Venues carry no
// neighborhood field, so we bucket each venue into the nearest of these to derive a
// human-readable "peak area" for the City Pulse popup. Add/adjust entries as coverage grows.
export const NAIROBI_AREAS: NairobiArea[] = [
  { name: 'Westlands', latitude: -1.2685, longitude: 36.8108 },
  { name: 'Parklands', latitude: -1.2610, longitude: 36.8180 },
  { name: 'Kilimani', latitude: -1.2900, longitude: 36.7850 },
  { name: 'Kileleshwa', latitude: -1.2790, longitude: 36.7810 },
  { name: 'Lavington', latitude: -1.2790, longitude: 36.7660 },
  { name: 'Hurlingham', latitude: -1.2960, longitude: 36.7880 },
  { name: 'Upper Hill', latitude: -1.2970, longitude: 36.8120 },
  { name: 'CBD', latitude: -1.2841, longitude: 36.8233 },
  { name: 'Ngong Road', latitude: -1.3010, longitude: 36.7620 },
  { name: 'Karen', latitude: -1.3190, longitude: 36.7120 },
  { name: 'Langata', latitude: -1.3560, longitude: 36.7560 },
  { name: 'Gigiri', latitude: -1.2330, longitude: 36.8080 },
  { name: 'Runda', latitude: -1.2170, longitude: 36.8100 },
  { name: 'South B', latitude: -1.3080, longitude: 36.8340 },
  { name: 'Kasarani', latitude: -1.2200, longitude: 36.8960 },
];

// Beyond this a venue isn't attributed to any listed area (keeps far-flung outliers from
// being force-fit into, say, "Karen" just because it's the least-distant center).
const MAX_AREA_DISTANCE_M = 4000;

export function nearestArea(latitude: number, longitude: number): string | null {
  let best: string | null = null;
  let bestDist = MAX_AREA_DISTANCE_M;
  for (const a of NAIROBI_AREAS) {
    const d = getDistanceInMeters(latitude, longitude, a.latitude, a.longitude);
    if (d < bestDist) {
      bestDist = d;
      best = a.name;
    }
  }
  return best;
}
