// Predefined mapping of known Nairobi venues to high-quality Unsplash images
const NAIROBI_VENUE_IMAGES: Record<string, string> = {
  'venue_001': 'https://images.unsplash.com/photo-1514933651103-005eec06c04b?auto=format&fit=crop&q=80&w=600', // Alchemist Bar
  'venue_002': 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?auto=format&fit=crop&q=80&w=600', // B-Club
  'venue_003': 'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?auto=format&fit=crop&q=80&w=600', // Havana Bar
  'venue_004': 'https://images.unsplash.com/photo-1574096079513-d8259312b785?auto=format&fit=crop&q=80&w=600', // The Kiza Lounge
  'venue_005': 'https://images.unsplash.com/photo-1543007630-9710e4a00a20?auto=format&fit=crop&q=80&w=600', // Brew Bistro & Lounge
  'venue_006': 'https://images.unsplash.com/photo-1506157786151-b8491531f063?auto=format&fit=crop&q=80&w=600', // Club Hypnotica
  'venue_007': 'https://images.unsplash.com/photo-1533777857889-4be7c70b33f7?auto=format&fit=crop&q=80&w=600', // Sky Lounge Radisson Blu
  'venue_008': 'https://images.unsplash.com/photo-1528605248644-14dd04022da1?auto=format&fit=crop&q=80&w=600', // Galileo Lounge
  'venue_009': 'https://images.unsplash.com/photo-1560624052-449f5ddf0c31?auto=format&fit=crop&q=80&w=600', // X-Lounge
  'venue_010': 'https://images.unsplash.com/photo-1485686531765-ba63b07845a7?auto=format&fit=crop&q=80&w=600', // 1824 Bar & Grill
  'venue_011': 'https://images.unsplash.com/photo-1545128485-c400e7702796?auto=format&fit=crop&q=80&w=600', // AL CAPONE LOUNGE
  'venue_012': 'https://images.unsplash.com/photo-1572116469696-31de0f17cc34?auto=format&fit=crop&q=80&w=600', // HABANOS LOUNGE
  'venue_013': 'https://images.unsplash.com/photo-1575444758702-4a6b9222336e?auto=format&fit=crop&q=80&w=600', // Bar Next Door
  'venue_014': 'https://images.unsplash.com/photo-1508215885820-4585e56135c8?auto=format&fit=crop&q=80&w=600', // Zeytoon Lounge
  'venue_015': 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&q=80&w=600', // Paris Lounge and Grill
  'venue_016': 'https://images.unsplash.com/photo-1536935338788-846bb9981813?auto=format&fit=crop&q=80&w=600', // QUIVER KILIMANI
};

// Fallback high-quality Unsplash image mappings based on venue type
const TYPE_FALLBACK_IMAGES: Record<string, string> = {
  'Club': 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?auto=format&fit=crop&q=80&w=600',
  'Bar': 'https://images.unsplash.com/photo-1514933651103-005eec06c04b?auto=format&fit=crop&q=80&w=600',
  'Activity': 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&q=80&w=600',
  'Event': 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&q=80&w=600',
  'Food': 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&q=80&w=600',
  'Default': 'https://images.unsplash.com/photo-1514933651103-005eec06c04b?auto=format&fit=crop&q=80&w=600',
};

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

/**
 * Performs a sequential search on the internet (Wikipedia & Wikimedia Commons)
 * to find a relevant image for the venue.
 */
export async function findImageOnInternet(venueName: string): Promise<string | null> {
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
 */
export function getFallbackImageByType(type?: string): string {
  if (!type) return TYPE_FALLBACK_IMAGES['Default'];
  return TYPE_FALLBACK_IMAGES[type] || TYPE_FALLBACK_IMAGES['Default'];
}

/**
 * Main resolution function that returns the resolved image URL for a venue.
 * Processes venues in batch and returns a map of venueId -> imageUrl.
 */
export async function resolveVenueImages(venues: any[]): Promise<Record<string, string>> {
  const result: Record<string, string> = {};

  // We process resolution sequentially to avoid overloading the API
  for (const venue of venues) {
    // For event type, prioritize customImageUrl/img, then googleImageUrl, then imageUrl
    if (venue.type === 'Event') {
      if (venue.customImageUrl) {
        result[venue.id] = venue.customImageUrl;
        continue;
      }
      if (venue.img) {
        result[venue.id] = venue.img;
        continue;
      }
      if (venue.googleImageUrl) {
        result[venue.id] = venue.googleImageUrl;
        continue;
      }
      if (venue.imageUrl) {
        result[venue.id] = venue.imageUrl;
        continue;
      }
    } else {
      // 1. Admin custom thumbnail override (highest priority)
      if (venue.customImageUrl) {
        result[venue.id] = venue.customImageUrl;
        continue;
      }

      // 2. Google Maps fetch (middle priority)
      if (venue.googleImageUrl) {
        result[venue.id] = venue.googleImageUrl;
        continue;
      }

      // 3. Direct/Legacy imageUrl field
      if (venue.imageUrl) {
        result[venue.id] = venue.imageUrl;
        continue;
      }
    }

    // 4. Default category thumbnail
    const categoryImage = getFallbackImageByType(venue.type);
    if (categoryImage) {
      result[venue.id] = categoryImage;
      continue;
    }

    // 5. Hardcoded Nairobi mapping
    if (NAIROBI_VENUE_IMAGES[venue.id]) {
      result[venue.id] = NAIROBI_VENUE_IMAGES[venue.id];
      continue;
    }

    // 6. Search the internet (Wikimedia / Wikipedia)
    try {
      const internetUrl = await findImageOnInternet(venue.name);
      if (internetUrl) {
        result[venue.id] = internetUrl;
        continue;
      }
    } catch (e) {
      console.warn(`Error searching internet image for ${venue.name}:`, e);
    }

    // 7. Type Fallback Default
    result[venue.id] = getFallbackImageByType('Default');
  }

  return result;
}
