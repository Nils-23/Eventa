/**
 * venueProfiles
 *
 * Central attendance model for the simulation engine. Each profile describes how a
 * class of venue behaves in the real world: how many people it can hold, how busy
 * it is relative to its capacity (popularityPrior), and how attendance is shaped
 * across the day (hours) and the week (weekdays).
 *
 * Scalability: profiles are resolved at runtime for ANY venue, existing or future.
 * Resolution order:
 *   1. `venue.venueProfile` — explicit key stored on the Firestore doc (admin-editable,
 *      auto-persisted by the engine after first inference)
 *   2. Keyword inference from the venue name + description (deterministic, so every
 *      client resolves the same profile without coordination)
 *   3. The generic profile for the venue's coarse type (Club / Bar / Activity / Event)
 *   4. `generic_unknown` — deliberately PESSIMISTIC (low counts, dead at night) so bad
 *      or missing data can never produce a packed venue at 4am.
 */

export type CoarseVenueType = 'Club' | 'Bar' | 'Activity' | 'Event';

export interface VenueProfile {
  key: string;
  /** Coarse type this profile belongs to (used as fallback grouping) */
  baseType: CoarseVenueType;
  /** Default capacity when the venue doc has no maxCapacity */
  capacity: number;
  /** Median occupancy fraction for a typical venue of this profile (0..1).
   *  Individual venues get a stable log-normal spread around this. */
  popularityPrior: number;
  /** Attendance shape by hour 0-23, each 0..1 (1 = the profile's peak) */
  hours: number[];
  /** Attendance shape by weekday, each 0..1 */
  weekdays: Record<'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun', number>;
}

// ─── Curve-authoring helpers ─────────────────────────────────────────────────
// hoursCurve({22: 1, 23: 1, ...}, base) → 24-slot array with `base` everywhere else
function hoursCurve(peaks: Record<number, number>, base = 0.02): number[] {
  const arr = new Array(24).fill(base);
  for (const h in peaks) arr[parseInt(h, 10)] = peaks[h];
  return arr;
}

const ALL_WEEK = { Mon: 1, Tue: 1, Wed: 1, Thu: 1, Fri: 1, Sat: 1, Sun: 1 };
const WEEKEND_HEAVY = { Mon: 0.5, Tue: 0.5, Wed: 0.6, Thu: 0.7, Fri: 1, Sat: 1, Sun: 0.9 };
const NIGHTLIFE_WEEK = { Mon: 0.07, Tue: 0.07, Wed: 0.12, Thu: 0.6, Fri: 1, Sat: 1, Sun: 0.7 };
const WEEKDAY_HEAVY = { Mon: 1, Tue: 1, Wed: 1, Thu: 1, Fri: 0.9, Sat: 0.3, Sun: 0.2 };

// ─── Profile catalog ─────────────────────────────────────────────────────────
// The `matchers` list maps keyword patterns → profile keys. First match wins, so
// keep more specific patterns above generic ones. Patterns run over name+description
// lowercased. Add new profiles here and every venue (current or future) can use them.
const PROFILES: Record<string, VenueProfile> = {
  // ── Nightlife ──
  nightclub: {
    key: 'nightclub', baseType: 'Club', capacity: 100, popularityPrior: 0.4,
    hours: hoursCurve({ 20: 0.2, 21: 0.5, 22: 1, 23: 1, 0: 1, 1: 1, 2: 1, 3: 0.6, 4: 0.3, 5: 0.1 }),
    weekdays: NIGHTLIFE_WEEK,
  },
  bar: {
    key: 'bar', baseType: 'Bar', capacity: 50, popularityPrior: 0.4,
    hours: hoursCurve({ 16: 0.2, 17: 0.5, 18: 0.8, 19: 1, 20: 1, 21: 1, 22: 1, 23: 1, 0: 0.6, 1: 0.3, 2: 0.1 }),
    weekdays: { Mon: 0.2, Tue: 0.2, Wed: 0.3, Thu: 0.5, Fri: 1, Sat: 1, Sun: 0.8 },
  },
  lounge_rooftop: {
    key: 'lounge_rooftop', baseType: 'Bar', capacity: 60, popularityPrior: 0.35,
    hours: hoursCurve({ 15: 0.2, 16: 0.4, 17: 0.7, 18: 0.9, 19: 1, 20: 1, 21: 1, 22: 0.9, 23: 0.7, 0: 0.4, 1: 0.15 }),
    weekdays: { Mon: 0.25, Tue: 0.25, Wed: 0.4, Thu: 0.6, Fri: 1, Sat: 1, Sun: 0.9 },
  },
  karaoke: {
    key: 'karaoke', baseType: 'Bar', capacity: 40, popularityPrior: 0.3,
    hours: hoursCurve({ 18: 0.3, 19: 0.7, 20: 1, 21: 1, 22: 1, 23: 0.9, 0: 0.6, 1: 0.2 }),
    weekdays: { Mon: 0.2, Tue: 0.3, Wed: 0.45, Thu: 0.6, Fri: 1, Sat: 1, Sun: 0.6 },
  },
  sports_bar: {
    key: 'sports_bar', baseType: 'Bar', capacity: 60, popularityPrior: 0.4,
    hours: hoursCurve({ 12: 0.3, 13: 0.35, 14: 0.4, 15: 0.5, 16: 0.6, 17: 0.7, 18: 0.85, 19: 1, 20: 1, 21: 1, 22: 0.9, 23: 0.6, 0: 0.3 }),
    weekdays: { Mon: 0.3, Tue: 0.3, Wed: 0.45, Thu: 0.5, Fri: 0.9, Sat: 1, Sun: 1 },
  },

  // ── Daytime / culture ──
  art_gallery: {
    key: 'art_gallery', baseType: 'Activity', capacity: 25, popularityPrior: 0.15,
    hours: hoursCurve({ 9: 0.2, 10: 0.5, 11: 0.8, 12: 1, 13: 1, 14: 1, 15: 0.9, 16: 0.8, 17: 0.5, 18: 0.2 }, 0),
    weekdays: { Mon: 0.4, Tue: 0.5, Wed: 0.55, Thu: 0.6, Fri: 0.7, Sat: 1, Sun: 0.9 },
  },
  museum: {
    key: 'museum', baseType: 'Activity', capacity: 45, popularityPrior: 0.2,
    hours: hoursCurve({ 9: 0.4, 10: 0.8, 11: 1, 12: 1, 13: 1, 14: 1, 15: 0.9, 16: 0.7, 17: 0.3 }, 0),
    weekdays: WEEKEND_HEAVY,
  },
  cinema: {
    key: 'cinema', baseType: 'Activity', capacity: 80, popularityPrior: 0.3,
    hours: hoursCurve({ 11: 0.2, 12: 0.3, 13: 0.4, 14: 0.5, 15: 0.5, 16: 0.55, 17: 0.65, 18: 0.8, 19: 1, 20: 1, 21: 0.9, 22: 0.5, 23: 0.2 }, 0),
    weekdays: WEEKEND_HEAVY,
  },

  // ── Daytime / active ──
  arcade_games: {
    key: 'arcade_games', baseType: 'Activity', capacity: 60, popularityPrior: 0.3,
    hours: hoursCurve({ 11: 0.4, 12: 0.6, 13: 0.7, 14: 0.8, 15: 0.9, 16: 1, 17: 1, 18: 1, 19: 0.9, 20: 0.8, 21: 0.6, 22: 0.3 }, 0.02),
    weekdays: WEEKEND_HEAVY,
  },
  adventure: {
    key: 'adventure', baseType: 'Activity', capacity: 50, popularityPrior: 0.3,
    hours: hoursCurve({ 8: 0.3, 9: 0.6, 10: 0.9, 11: 1, 12: 1, 13: 1, 14: 1, 15: 1, 16: 0.9, 17: 0.7, 18: 0.4 }, 0),
    weekdays: WEEKEND_HEAVY,
  },
  wellness: {
    key: 'wellness', baseType: 'Activity', capacity: 20, popularityPrior: 0.2,
    hours: hoursCurve({ 8: 0.4, 9: 0.7, 10: 1, 11: 1, 12: 0.8, 13: 0.7, 14: 0.8, 15: 0.9, 16: 1, 17: 0.9, 18: 0.6, 19: 0.3 }, 0),
    weekdays: ALL_WEEK,
  },
  outdoor: {
    key: 'outdoor', baseType: 'Activity', capacity: 120, popularityPrior: 0.25,
    hours: hoursCurve({ 7: 0.3, 8: 0.5, 9: 0.7, 10: 0.9, 11: 1, 12: 1, 13: 1, 14: 1, 15: 1, 16: 0.9, 17: 0.7, 18: 0.4 }, 0),
    weekdays: { Mon: 0.3, Tue: 0.3, Wed: 0.35, Thu: 0.4, Fri: 0.5, Sat: 1, Sun: 1 },
  },
  market: {
    key: 'market', baseType: 'Activity', capacity: 150, popularityPrior: 0.35,
    hours: hoursCurve({ 8: 0.3, 9: 0.6, 10: 0.9, 11: 1, 12: 1, 13: 1, 14: 1, 15: 0.9, 16: 0.7, 17: 0.4 }, 0),
    weekdays: { Mon: 0.2, Tue: 0.2, Wed: 0.25, Thu: 0.3, Fri: 0.5, Sat: 1, Sun: 1 },
  },

  // ── Events ──
  concert: {
    key: 'concert', baseType: 'Event', capacity: 150, popularityPrior: 0.45,
    hours: hoursCurve({ 17: 0.3, 18: 0.5, 19: 0.8, 20: 1, 21: 1, 22: 1, 23: 0.9, 0: 0.7, 1: 0.4, 2: 0.2 }, 0.05),
    weekdays: ALL_WEEK, // the event envelope (start/end dates) is the real gate
  },
  conference: {
    key: 'conference', baseType: 'Event', capacity: 120, popularityPrior: 0.4,
    hours: hoursCurve({ 8: 0.5, 9: 0.9, 10: 1, 11: 1, 12: 0.9, 13: 0.9, 14: 1, 15: 1, 16: 0.9, 17: 0.6, 18: 0.3 }, 0),
    weekdays: WEEKDAY_HEAVY,
  },

  // ── Generic fallbacks per coarse type ──
  generic_club: {
    key: 'generic_club', baseType: 'Club', capacity: 100, popularityPrior: 0.35,
    hours: hoursCurve({ 20: 0.2, 21: 0.5, 22: 1, 23: 1, 0: 1, 1: 1, 2: 1, 3: 0.6, 4: 0.3, 5: 0.1 }),
    weekdays: NIGHTLIFE_WEEK,
  },
  generic_bar: {
    key: 'generic_bar', baseType: 'Bar', capacity: 50, popularityPrior: 0.35,
    hours: hoursCurve({ 16: 0.2, 17: 0.5, 18: 0.8, 19: 1, 20: 1, 21: 1, 22: 1, 23: 1, 0: 0.6, 1: 0.3, 2: 0.1 }),
    weekdays: { Mon: 0.2, Tue: 0.2, Wed: 0.3, Thu: 0.5, Fri: 1, Sat: 1, Sun: 0.8 },
  },
  generic_activity: {
    key: 'generic_activity', baseType: 'Activity', capacity: 75, popularityPrior: 0.25,
    hours: hoursCurve({ 8: 0.3, 9: 0.6, 10: 0.8, 11: 1, 12: 1, 13: 1, 14: 1, 15: 1, 16: 1, 17: 0.8, 18: 0.5, 19: 0.2 }, 0.02),
    weekdays: { Mon: 0.8, Tue: 0.8, Wed: 0.9, Thu: 0.9, Fri: 1, Sat: 1, Sun: 1 },
  },
  generic_event: {
    key: 'generic_event', baseType: 'Event', capacity: 150, popularityPrior: 0.35,
    hours: hoursCurve({ 9: 0.6, 10: 0.8, 11: 0.9, 12: 1, 13: 1, 14: 1, 15: 1, 16: 1, 17: 0.9, 18: 0.9, 19: 0.9, 20: 0.9, 21: 0.8, 22: 0.4, 23: 0.2 }, 0.05),
    weekdays: ALL_WEEK,
  },
  // Pessimistic catch-all: missing/unknown type must never look busy, least of all at night
  generic_unknown: {
    key: 'generic_unknown', baseType: 'Activity', capacity: 40, popularityPrior: 0.15,
    hours: hoursCurve({ 10: 0.3, 11: 0.3, 12: 0.3, 13: 0.3, 14: 0.3, 15: 0.3, 16: 0.3, 17: 0.3, 18: 0.2 }, 0.02),
    weekdays: ALL_WEEK,
  },
};

// Keyword → profile inference. First match wins; specific before generic.
const MATCHERS: Array<{ pattern: RegExp; profile: string }> = [
  { pattern: /karaoke/, profile: 'karaoke' },
  { pattern: /sports?\s?(bar|pub|grill)|match\s?day/, profile: 'sports_bar' },
  // Explicit "nightclub"/"disco" outranks lounge wording (many clubs are named "X Lounge")
  { pattern: /night\s?club|\bdisco\b|\brave\b/, profile: 'nightclub' },
  { pattern: /rooftop|lounge|terrace|wine\s?bar|cocktail/, profile: 'lounge_rooftop' },
  { pattern: /art\s?(gallery|space|studio)|\bgallery\b|exhibit/, profile: 'art_gallery' },
  { pattern: /museum|heritage|archive/, profile: 'museum' },
  { pattern: /cinema|movie|imax|film\s?screening/, profile: 'cinema' },
  { pattern: /arcade|gaming|\bvr\b|bowling|pool\s?hall|billiard|esport/, profile: 'arcade_games' },
  { pattern: /kart|paintball|zipline|climb|quad\s?bik|\batv\b|archery|trampoline|skat(e|ing)|horse\s?rid/, profile: 'adventure' },
  { pattern: /\bspa\b|yoga|wellness|massage|sauna|pilates/, profile: 'wellness' },
  { pattern: /\bpark\b|garden|hik(e|ing)|nature|picnic|forest|waterfall|safari/, profile: 'outdoor' },
  { pattern: /market|bazaar|pop.?up|flea|thrift|farmers/, profile: 'market' },
  { pattern: /concert|live\s?(music|band)|\bgig\b|festival|\bdj\b|performance/, profile: 'concert' },
  { pattern: /conference|expo|summit|workshop|seminar|meetup|hackathon/, profile: 'conference' },
  { pattern: /\bbar\b|\bpub\b|brewery|taproom/, profile: 'bar' },
  // Weak signal last: a bare "club" mention with no other match defaults to nightclub
  { pattern: /\bclub\b/, profile: 'nightclub' },
];

const TYPE_DEFAULTS: Record<string, string> = {
  CLUB: 'generic_club',
  BAR: 'generic_bar',
  ACTIVITY: 'generic_activity',
  EVENT: 'generic_event',
};

export interface ProfilableVenue {
  id: string;
  name?: string;
  description?: string;
  type?: string;
  venueProfile?: string;
  maxCapacity?: number;
  startDate?: number;
  expirationDate?: number;
}

/** Infer the profile key for a venue from stored field → keywords → coarse type. */
export function inferProfileKey(venue: ProfilableVenue): string {
  if (venue.venueProfile && PROFILES[venue.venueProfile]) {
    return venue.venueProfile;
  }
  const text = `${venue.name || ''} ${venue.description || ''}`.toLowerCase();
  for (const { pattern, profile } of MATCHERS) {
    if (pattern.test(text)) return profile;
  }
  const typeDefault = TYPE_DEFAULTS[(venue.type || '').toUpperCase()];
  return typeDefault || 'generic_unknown';
}

export function getProfile(venue: ProfilableVenue): VenueProfile {
  return PROFILES[inferProfileKey(venue)];
}

export function getProfileCapacity(venue: ProfilableVenue, profile: VenueProfile): number {
  return venue.maxCapacity !== undefined ? venue.maxCapacity : profile.capacity;
}

/** Combined day-of-week × hour-of-day shape, always in [0, 1]. */
export function getAttendanceShape(profile: VenueProfile, weekday: string, hour: number): number {
  const w = profile.weekdays[weekday as keyof VenueProfile['weekdays']] ?? 0.5;
  const h = profile.hours[Math.max(0, Math.min(23, hour))] ?? 0.02;
  return Math.max(0, Math.min(1, w * h));
}

/**
 * Event lifecycle envelope in [0, 1]: 0 before (start - 2h), ramps up over the 2h
 * before start, 1 while ongoing, linear fade-out over 2h after end.
 * Returns a PESSIMISTIC 0.3 when dates are missing — an Event without dates must
 * not simulate a full crowd around the clock.
 */
export function getEventEnvelope(nowMs: number, startMs?: number, endMs?: number): number {
  if (!startMs || !endMs) return 0.3;
  const RAMP_MS = 2 * 3600 * 1000;
  if (nowMs < startMs - RAMP_MS) return 0;
  if (nowMs < startMs) return 0.1 + 0.9 * ((nowMs - (startMs - RAMP_MS)) / RAMP_MS);
  if (nowMs <= endMs) return 1;
  return Math.max(0, 1 - (nowMs - endMs) / RAMP_MS);
}

// ─── Stable per-venue popularity (heavy-tailed) ──────────────────────────────
// Real attendance is log-normally distributed: a few standout venues, a long quiet
// tail. We derive each venue's multiplier deterministically from its id, so every
// client computes the same value for any venue — including ones created tomorrow —
// with no coordination or Firestore writes.

function hash32(str: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 2654435761);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h ^= h >>> 13;
  return h >>> 0;
}

/** Uniform in (0, 1), deterministic per (id, salt). */
function stableUnit(id: string, salt: number): number {
  return (hash32(id, salt) + 0.5) / 4294967296;
}

/**
 * Stable occupancy fraction for this venue: log-normal around the profile's prior.
 * sigma 0.7 → ~68% of venues within [prior/2, prior×2], standouts up to the 0.95 clamp.
 */
export function getStableBaseFactor(venueId: string, prior: number): number {
  const u1 = stableUnit(venueId, 0x9e3779b9);
  const u2 = stableUnit(venueId, 0x85ebca6b);
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2); // Box-Muller
  const factor = prior * Math.exp(0.7 * z);
  return Math.max(0.02, Math.min(0.95, factor));
}

// ─── Poisson sampling ────────────────────────────────────────────────────────
// Sampling the final count from Poisson(target) gives natural, scale-appropriate
// variance (small venues wobble by 1-3, big ones by 10+) and breaks the
// "10, 9, 7, ..." laddering that deterministic rounding produces.
export function samplePoisson(lambda: number): number {
  if (lambda <= 0) return 0;
  if (lambda > 30) {
    // Normal approximation for large lambda
    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1 || 1e-12)) * Math.cos(2 * Math.PI * u2);
    return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * z));
  }
  // Knuth's algorithm for small lambda
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= Math.random();
  } while (p > L);
  return k - 1;
}
