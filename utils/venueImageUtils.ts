// ─── Image sources ───────────────────────────────────────────────────────────
// Every URL in this file was HEAD-checked against images.unsplash.com and every
// pool entry was reviewed by eye — a fallback that 404s or shows the wrong kind
// of scene is worse than no fallback at all. Re-verify before adding entries.

const unsplash = (photoId: string) =>
  `https://images.unsplash.com/${photoId}?auto=format&fit=crop&q=80&w=600`;

// Predefined mapping of known Nairobi venues to high-quality Unsplash images
const NAIROBI_VENUE_IMAGES: Record<string, string> = {
  'venue_001': unsplash('photo-1514933651103-005eec06c04b'), // Alchemist Bar
  'venue_002': unsplash('photo-1516450360452-9312f5e86fc7'), // B-Club
  'venue_003': unsplash('photo-1514362545857-3bc16c4c7d1b'), // Havana Bar
  'venue_004': unsplash('photo-1574096079513-d8259312b785'), // The Kiza Lounge
  'venue_005': unsplash('photo-1543007630-9710e4a00a20'), // Brew Bistro & Lounge
  'venue_006': unsplash('photo-1506157786151-b8491531f063'), // Club Hypnotica
  'venue_007': unsplash('photo-1533777857889-4be7c70b33f7'), // Sky Lounge Radisson Blu
  'venue_008': unsplash('photo-1528605248644-14dd04022da1'), // Galileo Lounge
  'venue_009': unsplash('photo-1560624052-449f5ddf0c31'), // X-Lounge
  'venue_010': unsplash('photo-1485686531765-ba63b07845a7'), // 1824 Bar & Grill
  'venue_011': unsplash('photo-1545128485-c400e7702796'), // AL CAPONE LOUNGE
  'venue_012': unsplash('photo-1572116469696-31de0f17cc34'), // HABANOS LOUNGE
  'venue_013': unsplash('photo-1575444758702-4a6b9222336e'), // Bar Next Door
  'venue_014': unsplash('photo-1508215885820-4585e56135c8'), // Zeytoon Lounge
  'venue_015': unsplash('photo-1555396273-367ea4eb4db5'), // Paris Lounge and Grill
  'venue_016': unsplash('photo-1536935338788-846bb9981813'), // QUIVER KILIMANI
};

// Fallback high-quality Unsplash image mappings based on venue type
const TYPE_FALLBACK_IMAGES: Record<string, string> = {
  'Club': unsplash('photo-1516450360452-9312f5e86fc7'),
  'Bar': unsplash('photo-1514933651103-005eec06c04b'),
  'Activity': unsplash('photo-1470225620780-dba8ba36b745'),
  'Event': unsplash('photo-1492684223066-81342ee5ff30'),
  'Food': unsplash('photo-1517248135467-4c7edcad34c4'),
  'Default': unsplash('photo-1514933651103-005eec06c04b'),
};

// ─── Event fallback pools ────────────────────────────────────────────────────
// An event without a poster used to get one image per category, baked into its
// venue doc at approval time — so every "Club" event in the Explore feed was
// literally the same photograph. These pools replace that single image, and the
// picker below hands out distinct entries so no two events in one feed collide.
//
// Pools are keyed by the event's *curator category*, not by venue type (all
// events store type 'Event'), so a food festival draws food imagery and a club
// night draws a dancefloor. Keep every pool at 4+ entries; the generic 'Event'
// pool is the widest because it absorbs anything uncategorised.

const NIGHTLIFE_SCENES = [
  unsplash('photo-1493225457124-a3eb161ffa5f'), // raised hand in stage smoke
  unsplash('photo-1459749411175-04bf5292ceea'), // crowd under warm stage wash
  unsplash('photo-1501281668745-f7f57925c3b4'), // phone filming a lit stage
  unsplash('photo-1429962714451-bb934ecdc4ec'), // heart hands at a gig
  unsplash('photo-1524368535928-5b5e00ddc76b'), // silhouetted crowd, amber
  unsplash('photo-1540039155733-5bb30b53aa14'), // crowd under stage pyro
  unsplash('photo-1533174072545-7a4b6ad7a6c3'), // confetti over a night show
  unsplash('photo-1514525253161-7a46d19cd819'), // colour-drenched festival crowd
  unsplash('photo-1478147427282-58a87a120781'), // hands raised in gold light
  unsplash('photo-1496337589254-7e19d01cec44'), // DJ booth in smoke
];

const LIVE_MUSIC_SCENES = [
  unsplash('photo-1516280440614-37939bbacd81'), // mic on a dark stage
  unsplash('photo-1511671782779-c97d3d27a1d4'), // retro mic against bokeh
  unsplash('photo-1483393458019-411bc6bd104e'), // street band mid-set
  unsplash('photo-1531482615713-2afd69097998'), // piano keys, monochrome
];

const SOCIAL_SCENES = [
  unsplash('photo-1519671482749-fd09be7ccebf'), // glasses raised in a toast
  unsplash('photo-1470019693664-1d202d2c0907'), // sparklers at dusk
];

const FOOD_SCENES = [
  unsplash('photo-1414235077428-338989a2e8c0'), // plated course, low light
  unsplash('photo-1424847651672-bf20a4b0982b'), // shared brunch table overhead
  unsplash('photo-1555939594-58d7cb561ad1'), // grilled platter, board service
  unsplash('photo-1552566626-52f8b828add9'), // dining room, evening
];

const DAYTIME_SCENES = [
  unsplash('photo-1531058020387-3be344556be6'), // hall crowd at a daytime event
  unsplash('photo-1467810563316-b5476525c0f9'), // talk in a seated room
  unsplash('photo-1523580494863-6f3031224c94'), // hands-on workshop session
  unsplash('photo-1551632436-cbf8dd35adfa'), // café interior, daylight
];

const EVENT_FALLBACK_POOLS: Record<string, string[]> = {
  Club: NIGHTLIFE_SCENES,
  Bar: [...SOCIAL_SCENES, ...LIVE_MUSIC_SCENES, ...NIGHTLIFE_SCENES.slice(0, 3)],
  Food: [...FOOD_SCENES, ...SOCIAL_SCENES],
  Activity: [...DAYTIME_SCENES, ...SOCIAL_SCENES],
  // Widest pool: generic events span concerts, festivals, expos and launches.
  Event: [
    ...NIGHTLIFE_SCENES,
    ...LIVE_MUSIC_SCENES,
    ...SOCIAL_SCENES,
    ...DAYTIME_SCENES.slice(0, 2),
  ],
};

// ─── Place fallback pools ────────────────────────────────────────────────────
// Real places (type Food/Bar/Club/Activity) used to share ONE image per type via
// TYPE_FALLBACK_IMAGES, so a Google photo URL going dead across a set of venues
// rendered as the same thumbnail repeated down the whole feed — which is exactly
// what happened to the seeded food venues when their photo_references expired.
//
// A place pool is deliberately shot-type-specific: a restaurant wants interiors
// and plated food, a bar wants the counter and the glass, a club wants the room
// at night. These are separate from the event pools above because an event's
// imagery is about the *occasion* and a place's is about the *room*.

const FOOD_PLACE_SCENES = [
  unsplash('photo-1590846406792-0adc7f938f1d'), // dining room under warm pendants
  unsplash('photo-1559339352-11d035aa65de'), // terrace restaurant, golden hour
  unsplash('photo-1466978913421-dad2ebd01d17'), // shared table overhead, burgers
  unsplash('photo-1600891964092-4316c288032e'), // steak and fries plated
  unsplash('photo-1504674900247-0877df9cc836'), // spread of plates, overhead
  unsplash('photo-1476224203421-9ac39bcb3327'), // grilled platter with sides
  unsplash('photo-1481931098730-318b6f776db0'), // pasta plates and red wine
  unsplash('photo-1533777324565-a040eb52facd'), // restaurant spread on marble
  unsplash('photo-1559925393-8be0ec4767c8'), // street-side café terrace
  unsplash('photo-1517701550927-30cf4ba1dba5'), // iced coffee, café table
];

const BAR_PLACE_SCENES = [
  unsplash('photo-1497644083578-611b798c60f3'), // bar counter and stools
  unsplash('photo-1470337458703-46ad1756a187'), // cocktail poured over ice
  unsplash('photo-1551024709-8f23befc6f87'), // three cocktails on the bar
  unsplash('photo-1584225064785-c62a8b43d148'), // beer flight on a wood bar
  unsplash('photo-1436076863939-06870fe779c2'), // bottles clinked at sunset
  unsplash('photo-1470158499416-75be9aa0c4db'), // wine poured, sun behind
];

const CLUB_PLACE_SCENES = [
  unsplash('photo-1566737236500-c8ac43014a67'), // neon corridor into a club room
  ...NIGHTLIFE_SCENES.slice(0, 6),
];

const ACTIVITY_PLACE_SCENES = [
  unsplash('photo-1517649763962-0c623066013b'), // cycling peloton
  unsplash('photo-1461896836934-ffe607ba8211'), // sprinter on the blocks
  unsplash('photo-1552674605-db6ffd4facb5'), // runners at dusk
  unsplash('photo-1546484475-7f7bd55792da'), // beach loungers at sunset
  unsplash('photo-1571019613454-1cb2f99b2d8b'), // gym floor session
  ...DAYTIME_SCENES,
];

const PLACE_FALLBACK_POOLS: Record<string, string[]> = {
  Food: FOOD_PLACE_SCENES,
  Bar: BAR_PLACE_SCENES,
  Club: CLUB_PLACE_SCENES,
  Activity: ACTIVITY_PLACE_SCENES,
  // A typeless venue could be anything; lean on the widest neutral mix.
  Default: [...BAR_PLACE_SCENES, ...FOOD_PLACE_SCENES.slice(0, 4)],
};

/** Every URL this module can hand out as a stand-in rather than a real photo. */
const ALL_FALLBACK_URLS = new Set<string>([
  ...Object.values(TYPE_FALLBACK_IMAGES),
  ...Object.values(EVENT_FALLBACK_POOLS).flat(),
  ...Object.values(PLACE_FALLBACK_POOLS).flat(),
]);

/**
 * True when `url` is one of our stand-in images rather than a photo of the
 * actual place.
 *
 * This matters because the curator approval flow used to *persist* a category
 * placeholder into the venue doc's `imageUrl`. Those docs are indistinguishable
 * from real ones by shape — a non-empty https URL — so without this check the
 * client renders a permanent stock photo and never reaches the host-venue or
 * pooled fallback below it. Treating them as absent lets already-approved
 * events heal without a migration.
 */
export function isPlaceholderImage(url?: string | null): boolean {
  if (!url) return false;
  // Stored URLs may carry different sizing params than the ones we generate.
  const base = url.split('?')[0];
  for (const known of ALL_FALLBACK_URLS) {
    if (known.split('?')[0] === base) return true;
  }
  return false;
}

/** Non-empty only when the URL is a real photo of the place. */
export function realImageOrNull(url?: string | null): string | null {
  if (!url || isPlaceholderImage(url)) return null;
  return url;
}

// ─── Deterministic pool selection ────────────────────────────────────────────
// The pick must be stable for a given event: re-deriving it per render (or at
// random) would make the card's photo change while the user scrolls past it.

function hash32(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  return h >>> 0;
}

/**
 * Rewrites an image URL to ask for roughly the pixels we are actually going to
 * draw.
 *
 * Both sources we use size on the server: Google Places photos take `maxwidth`
 * (stored at 800 by functions/venueImages.js) and Unsplash takes `w` (600 from
 * the `unsplash()` helper above). A story-tray avatar renders about 56pt wide,
 * so it was pulling an 800px photo — most of a slow thumbnail's cost is bytes
 * nobody ever sees.
 *
 * Unknown hosts are returned untouched: guessing at another CDN's parameters
 * risks a 400, and a working oversized image beats a broken right-sized one.
 */
export function resizeImageUrl(url: string, targetWidth: number): string {
  if (!url) return url;
  const w = Math.max(1, Math.round(targetWidth));

  if (url.includes('maps.googleapis.com/maps/api/place/photo')) {
    return /[?&]maxwidth=\d+/.test(url)
      ? url.replace(/([?&]maxwidth=)\d+/, `$1${w}`)
      : `${url}${url.includes('?') ? '&' : '?'}maxwidth=${w}`;
  }

  if (url.includes('images.unsplash.com')) {
    return /[?&]w=\d+/.test(url)
      ? url.replace(/([?&]w=)\d+/, `$1${w}`)
      : `${url}${url.includes('?') ? '&' : '?'}w=${w}`;
  }

  return url;
}

// Dark, low-saturation blocks that sit comfortably under the map's palette. A
// placeholder is meant to read as "a photo is arriving here", so these stay
// muted — anything vivid competes with the real image that replaces it.
const PLACEHOLDER_COLORS = [
  '#1E1B2E', '#1B242E', '#241B2E', '#2E1B22',
  '#1B2E27', '#2A2418', '#1F1F2B', '#2B1F26',
];

/**
 * A deterministic colour to paint immediately, before any pixel has been
 * fetched. The point is that a card is NEVER blank and never shows a spinner:
 * the block appears on the first frame and the photo fades in over it.
 *
 * Local by necessity — the fallback images are themselves remote Unsplash URLs,
 * so they can't stand in for "instant". Seeded per venue so a feed reads as a
 * set of distinct cards while it fills in, rather than one grey wall.
 */
export function getPlaceholderColor(seed?: string): string {
  if (!seed) return PLACEHOLDER_COLORS[0];
  return PLACEHOLDER_COLORS[hash32(seed) % PLACEHOLDER_COLORS.length];
}

// The curator writes a free-form category, not our pool keys. Live data carries
// Other (the plurality), Event, Club, Activity, Bar, Food & Drink, Festival,
// Music, Conference, Arts & Culture and Entertainment, and the admin screen
// defaults a missing one to 'General'. Unmapped labels used to land silently in
// the generic pool, so a "Food & Drink" event drew a dancefloor. Order matters:
// the first alias contained in the label wins, so specific ones come first.
const CATEGORY_ALIASES: Array<[string, string]> = [
  ['food & drink', 'Food'],
  ['food and drink', 'Food'],
  ['arts & culture', 'Activity'],
  ['arts and culture', 'Activity'],
  ['nightlife', 'Club'],
  ['party', 'Club'],
  ['club', 'Club'],
  ['rave', 'Club'],
  ['lounge', 'Bar'],
  ['bar', 'Bar'],
  ['pub', 'Bar'],
  ['drink', 'Bar'],
  ['food', 'Food'],
  ['dining', 'Food'],
  ['restaurant', 'Food'],
  ['culinary', 'Food'],
  ['brunch', 'Food'],
  ['wine', 'Food'],
  ['conference', 'Activity'],
  ['summit', 'Activity'],
  ['workshop', 'Activity'],
  ['expo', 'Activity'],
  ['business', 'Activity'],
  ['sport', 'Activity'],
  ['outdoor', 'Activity'],
  ['wellness', 'Activity'],
  ['activity', 'Activity'],
  ['arts', 'Activity'],
  ['culture', 'Activity'],
  ['concert', 'Event'],
  ['festival', 'Event'],
  ['music', 'Event'],
  ['entertainment', 'Event'],
];

/** Maps a curator category onto a fallback pool key. Never throws. */
export function normalizeEventCategory(raw?: string): string {
  if (!raw) return 'Event';
  const key = raw.trim().toLowerCase();
  if (!key) return 'Event';
  for (const [alias, pool] of CATEGORY_ALIASES) {
    if (key.includes(alias)) return pool;
  }
  // 'Other', 'General', 'Event' and anything new the curator invents.
  return 'Event';
}

function poolFor(category?: string): string[] {
  return EVENT_FALLBACK_POOLS[normalizeEventCategory(category)] || EVENT_FALLBACK_POOLS.Event;
}

function placePoolFor(type?: string): string[] {
  return (type && PLACE_FALLBACK_POOLS[type]) || PLACE_FALLBACK_POOLS.Default;
}

/**
 * One entry to assign a fallback to. `kind` picks which family of pools applies:
 * an event draws on occasion imagery keyed by its curator category, a place
 * draws on room imagery keyed by its venue type.
 */
export interface FallbackSubject {
  id: string;
  kind: 'event' | 'place';
  /** Curator category — events only. */
  category?: string;
  /** Venue type (Food/Bar/Club/Activity) — places only. */
  type?: string;
}

function poolForSubject(subject: FallbackSubject): string[] {
  return subject.kind === 'event' ? poolFor(subject.category) : placePoolFor(subject.type);
}

/**
 * Stable pooled fallback for a single event. Prefer `assignFallbackImages` when
 * resolving a whole feed — this one can hand the same photo to two events.
 */
export function getEventFallbackImage(eventId: string, category?: string): string {
  const pool = poolFor(category);
  return pool[hash32(eventId) % pool.length];
}

/**
 * Stable pooled fallback for a single place. Same caveat as the event version:
 * it is the per-render safety net, not the feed-wide assignment.
 */
export function getPlaceFallbackImage(venueId: string, type?: string): string {
  const pool = placePoolFor(type);
  return pool[hash32(venueId) % pool.length];
}

/**
 * Collision-free pooled fallbacks for a set of events and places.
 *
 * Hashing alone gives a 1-in-poolSize chance that two entries sitting next to
 * each other in the feed draw the same photo, which is exactly the artefact
 * these pools exist to remove. So the hash only picks a *starting* slot and
 * taken images are linearly probed past until a free one is found.
 *
 * Claiming is tracked by URL across every pool, not per pool: the pools overlap
 * on purpose (a bar event and a generic event can both suit a nightlife shot,
 * and a club place shares the nightlife scenes outright), so per-pool
 * bookkeeping still let two categories hand out the same photo in one feed.
 * Once a pool's images are all on screen its round resets, which is the
 * earliest point a repeat is unavoidable.
 *
 * Events and places are assigned in ONE pass over a shared `used` set so an
 * event and the venue hosting it can't land on the same stock photo.
 *
 * Assignment is sorted by id so the result depends only on the set of subjects,
 * not on the order Firestore happened to return them.
 */
export function assignFallbackImages(subjects: FallbackSubject[]): Record<string, string> {
  const out: Record<string, string> = {};
  const used = new Set<string>();

  for (const subject of [...subjects].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  )) {
    const pool = poolForSubject(subject);

    // Every image in this pool is already on screen — start a fresh round.
    if (pool.every((url) => used.has(url))) {
      for (const url of pool) used.delete(url);
    }

    const start = hash32(subject.id) % pool.length;
    let chosen = pool[start];
    for (let i = 0; i < pool.length; i++) {
      const candidate = pool[(start + i) % pool.length];
      if (!used.has(candidate)) {
        chosen = candidate;
        break;
      }
    }

    used.add(chosen);
    out[subject.id] = chosen;
  }

  return out;
}

/**
 * Searches Wikipedia for an image thumbnail.
 */
async function searchWikipedia(query: string): Promise<string | null> {
  try {
    const url = `https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrlimit=1&prop=pageimages&piprop=thumbnail&pithumbsize=600`;
    const response = await fetch(url);
    const data = await response.json();
    const pages = data?.query?.pages;
    if (pages) {
      const pageId = Object.keys(pages)[0];
      if (pageId && pages[pageId]?.thumbnail?.source) {
        return pages[pageId].thumbnail.source;
      }
    }
  } catch (error) {
    console.warn(`[IMAGE-SEARCH] Wikipedia search failed for query: "${query}":`, error);
  }
  return null;
}

/**
 * Searches Wikimedia Commons for an image thumbnail.
 */
async function searchWikimedia(query: string): Promise<string | null> {
  try {
    const url = `https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrlimit=1&prop=pageimages&piprop=thumbnail&pithumbsize=600`;
    const response = await fetch(url);
    const data = await response.json();
    const pages = data?.query?.pages;
    if (pages) {
      const pageId = Object.keys(pages)[0];
      if (pageId && pages[pageId]?.thumbnail?.source) {
        return pages[pageId].thumbnail.source;
      }
    }
  } catch (error) {
    console.warn(`[IMAGE-SEARCH] Wikimedia search failed for query: "${query}":`, error);
  }
  return null;
}

// Session cache for internet lookups, negatives included.
//
// This search sat behind an unreachable branch for a long time and now actually
// runs. resolveVenueImages is called on every venues snapshot, and a Maps key
// rotation drops googleImageUrl from every venue at once — without a cache that
// is ~100 venues x 4 sequential requests, repeated on each snapshot. One attempt
// per venue per session is plenty; the real repair path is refreshVenueImages.
const internetLookupCache = new Map<string, string | null>();

/**
 * Performs a sequential search on the internet (Wikipedia & Wikimedia Commons)
 * to find a relevant image for the venue.
 */
export async function findImageOnInternet(venueName: string): Promise<string | null> {
  if (internetLookupCache.has(venueName)) {
    return internetLookupCache.get(venueName) ?? null;
  }
  const found = await searchInternetUncached(venueName);
  internetLookupCache.set(venueName, found);
  return found;
}

async function searchInternetUncached(venueName: string): Promise<string | null> {
  // Try searching with the "Nairobi" contextualizer first
  const nairobiQuery = `${venueName} Nairobi`;

  let img = await searchWikimedia(nairobiQuery);
  if (img) return img;

  img = await searchWikipedia(nairobiQuery);
  if (img) return img;

  // Try raw venue name if Nairobi context yield nothing
  img = await searchWikimedia(venueName);
  if (img) return img;

  img = await searchWikipedia(venueName);
  if (img) return img;

  return null;
}

/**
 * Returns the fallback image URL based on the venue type.
 *
 * `seed` (pass the venue id) varies the result across the pool for that type, so
 * a run of fallbacks doesn't render as the same photo repeated. This used to
 * apply to events only — every other type fell through to a single image per
 * type, which is why a set of food venues whose stored photo URLs all died at
 * once rendered as the identical thumbnail down the entire feed.
 *
 * Without a seed the behaviour is the single legacy image per type, unchanged:
 * callers like the admin venue-type preview want a stable, representative shot
 * rather than a varying one.
 */
export function getFallbackImageByType(type?: string, seed?: string): string {
  if (seed) {
    return type === 'Event' ? getEventFallbackImage(seed) : getPlaceFallbackImage(seed, type);
  }
  if (!type) return TYPE_FALLBACK_IMAGES['Default'];
  return TYPE_FALLBACK_IMAGES[type] || TYPE_FALLBACK_IMAGES['Default'];
}

/**
 * Main resolution function that returns the resolved image URL for a venue.
 * Processes venues in batch and returns a map of venueId -> imageUrl.
 *
 * Only ever returns *real* photos. The category fallback used to sit at step 4
 * and, because it always returns a string, made the Nairobi mapping and the
 * Wikimedia/Wikipedia lookups below it unreachable. Callers now own the
 * fallback so those lookups can run and so the caller can pick a varied one.
 */
export async function resolveVenueImages(venues: any[]): Promise<Record<string, string>> {
  const result: Record<string, string> = {};

  // We process resolution sequentially to avoid overloading the API
  for (const venue of venues) {
    // 1. Admin custom thumbnail override (highest priority)
    if (venue.customImageUrl) {
      result[venue.id] = venue.customImageUrl;
      continue;
    }

    // 2. Event poster (events only) — a flyer beats any photo of the building.
    if (venue.type === 'Event' && venue.img) {
      result[venue.id] = venue.img;
      continue;
    }

    // 3. Google Maps fetch (middle priority)
    if (venue.googleImageUrl) {
      result[venue.id] = venue.googleImageUrl;
      continue;
    }

    // 4. Direct/Legacy imageUrl field, unless it is a stored placeholder.
    const legacy = realImageOrNull(venue.imageUrl);
    if (legacy) {
      result[venue.id] = legacy;
      continue;
    }

    // 5. Hardcoded Nairobi mapping
    if (NAIROBI_VENUE_IMAGES[venue.id]) {
      result[venue.id] = NAIROBI_VENUE_IMAGES[venue.id];
      continue;
    }

    // 6. Search the internet (Wikimedia / Wikipedia). Skipped for events: a name
    // lookup for "Detox Fridays" returns some unrelated page's photo, and events
    // have the host venue to fall back on instead.
    if (venue.type !== 'Event') {
      try {
        const internetUrl = await findImageOnInternet(venue.name);
        if (internetUrl) {
          result[venue.id] = internetUrl;
          continue;
        }
      } catch (e) {
        console.warn(`Error searching internet image for ${venue.name}:`, e);
      }
    }

    // No real photo found — the caller falls back (host venue, then pool).
  }

  return result;
}
