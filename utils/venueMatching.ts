/**
 * Matching a curated event to the venue that hosts it.
 *
 * Curated events arrive with a free-text venue name ("The Alchemist", "Alchemist
 * Bar Westlands", "KICC") rather than a venue id, so the link has to be inferred
 * from the string. Getting it wrong is not cosmetic: the host venue supplies the
 * event's coordinates, address and — since events usually have no poster — the
 * photo on its Explore card. A loose match puts another business's storefront
 * under someone's event name.
 */

// Words that describe what a place *is* rather than which place it is. Stripped
// before comparison so "Alchemist" matches "The Alchemist Bar".
const GENERIC_TOKENS = new Set([
  'the', 'a', 'an', 'and', 'at',
  'bar', 'club', 'lounge', 'pub', 'restaurant', 'grill', 'bistro', 'cafe', 'kitchen',
  'hotel', 'rooftop', 'garden', 'gardens', 'terrace', 'house', 'place', 'spot',
  'nairobi', 'kenya', 'ke', 'westlands', 'kilimani', 'cbd',
]);

/** Lowercase, strip accents and punctuation, collapse whitespace. */
export function normalizeVenueName(name: string): string {
  return (name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function significantTokens(normalized: string): string[] {
  return normalized.split(' ').filter((t) => t.length > 1 && !GENERIC_TOKENS.has(t));
}

/**
 * 0–100 confidence that two venue names denote the same place.
 *
 * Substring containment is only trusted once the shorter side has enough
 * distinctive characters to be meaningful — the old matcher accepted any
 * containment, so a venue called "1824" matched every event string containing
 * "1824" and short names swallowed unrelated ones.
 */
export function venueNameScore(a: string, b: string): number {
  const na = normalizeVenueName(a);
  const nb = normalizeVenueName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 100;

  const ta = significantTokens(na);
  const tb = significantTokens(nb);
  if (ta.length === 0 || tb.length === 0) return 0;

  const ca = ta.join(' ');
  const cb = tb.join(' ');
  if (ca === cb) return 95;

  // Containment on the distinctive part of the name.
  const shorter = ca.length <= cb.length ? ca : cb;
  const longer = ca.length <= cb.length ? cb : ca;
  if (shorter.length >= 5 && longer.includes(shorter)) {
    // Ratio keeps "alchemist" ⊂ "alchemist bar" high while pushing a tiny
    // fragment inside a long unrelated name down below the accept threshold.
    return 60 + Math.round(35 * (shorter.length / longer.length));
  }

  // Token overlap for reorderings and partial names.
  const setB = new Set(tb);
  const shared = ta.filter((t) => setB.has(t)).length;
  if (shared === 0) return 0;
  const jaccard = shared / (ta.length + tb.length - shared);
  return Math.round(85 * jaccard);
}

// Below this, treat the event as having no known host venue rather than
// attaching a probably-wrong one.
export const HOST_MATCH_THRESHOLD = 70;

// A weaker bar for deciding only *where* an event is. The two differ on purpose:
// borrowing the wrong venue's photo puts another business's storefront under an
// event's name, but borrowing coordinates that are slightly off just moves a pin
// — and the alternative is the Nairobi CBD default, which drops every unmatched
// event on one point. So position tolerates a guess that the image must not.
export const LOCATION_MATCH_THRESHOLD = 40;

export interface MatchableVenue {
  id: string;
  name?: string;
  type?: string;
}

/**
 * Best host venue for an event's free-text venue name, or null when nothing
 * clears the confidence threshold. Only real places are considered — matching
 * an event to another event would chain one placeholder to another.
 */
export function findHostVenue<T extends MatchableVenue>(
  eventVenueName: string | undefined | null,
  venues: T[],
  minScore: number = HOST_MATCH_THRESHOLD
): T | null {
  if (!eventVenueName) return null;

  let best: T | null = null;
  let bestScore = 0;
  for (const venue of venues) {
    if (!venue.name || venue.type === 'Event') continue;
    const score = venueNameScore(eventVenueName, venue.name);
    if (score > bestScore) {
      bestScore = score;
      best = venue;
    }
  }
  return bestScore >= minScore ? best : null;
}
