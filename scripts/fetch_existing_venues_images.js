const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
if (!apiKey) {
  console.error('Missing GOOGLE_MAPS_API_KEY env var. Set it before running, e.g. GOOGLE_MAPS_API_KEY=... node scripts/fetch_existing_venues_images.js');
  process.exit(1);
}

const queries = {
  venue_001: 'Alchemist Bar, Parklands Road, Nairobi',
  venue_002: 'B-Club, Galana Plaza, Nairobi',
  venue_003: 'Havana Bar & Restaurant, Woodvale Grove, Nairobi',
  venue_004: 'The Kiza Lounge, Galana Plaza, Nairobi',
  venue_005: 'Brew Bistro, ABC Place, Waiyaki Way, Nairobi',
  venue_006: 'Club Hypnotica, Krishna Center, Nairobi',
  venue_007: 'Sky Lounge, Radisson Blu, Upperhill, Nairobi',
  venue_008: 'Galileo Lounge, Waiyaki Way, Nairobi',
  venue_009: 'X-Lounge, Westlands, Nairobi',
  venue_010: '1824, Langata Road, Nairobi',
  venue_011: 'AL CAPONE LOUNGE, Thika Road, Nairobi',
  venue_012: 'HABANOS LOUNGE, Kiambu Road, Nairobi',
  venue_013: 'Bar Next Door, Othaya Road, Nairobi',
  venue_014: 'Zeytoon Lounge, USIU Road, Nairobi',
  venue_015: 'Paris Lounge and Grill, Mirema Drive, Nairobi',
  venue_016: 'QUIVER KILIMANI, Ngong Road, Nairobi'
};

async function fetchAndSaveImages() {
  console.log('Starting Google Maps image synchronization for existing venues...');
  
  for (const [id, query] of Object.entries(queries)) {
    try {
      console.log(`Looking up: ${query}...`);
      
      // Step 1: Text Search or Autocomplete to find place_id
      const searchUrl = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(query)}&location=-1.286389,36.817223&radius=50000&key=${apiKey}`;
      const searchRes = await fetch(searchUrl);
      const searchData = await searchRes.json();
      
      if (searchData.status === 'OK' && searchData.predictions.length > 0) {
        const placeId = searchData.predictions[0].place_id;
        
        // Step 2: Get Place Details (requesting photos field)
        const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=geometry,formatted_address,name,photos&key=${apiKey}`;
        const detailsRes = await fetch(detailsUrl);
        const detailsData = await detailsRes.json();
        
        if (detailsData.status === 'OK' && detailsData.result) {
          const result = detailsData.result;
          const photos = result.photos;
          
          if (photos && photos.length > 0) {
            const photoUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${photos[0].photo_reference}&key=${apiKey}`;
            
            // Step 3: Update Firestore Document
            const docRef = db.collection('venues').doc(id);
            await docRef.set({ imageUrl: photoUrl }, { merge: true });
            console.log(`✅ Success: Updated image for ${id} (${result.name})`);
          } else {
            console.log(`⚠️ Warning: No photos found on Google Maps for ${id} (${result.name})`);
          }
        } else {
          console.log(`❌ Error: Place details failed for ${id} (status: ${detailsData.status})`);
        }
      } else {
        console.log(`❌ Error: Autocomplete lookup failed for ${id} (status: ${searchData.status})`);
      }
    } catch (error) {
      console.error(`❌ Exception looking up ${id}:`, error.message);
    }
    
    // Add a tiny delay to be gentle to the API
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  
  console.log('Google Maps image synchronization finished!');
  process.exit(0);
}

fetchAndSaveImages().catch((err) => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
