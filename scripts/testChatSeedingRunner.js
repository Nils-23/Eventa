const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');
const fetch = require('node-fetch');

// Initialize Firebase Admin
if (admin.apps.length === 0) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`
  });
}

const db = admin.firestore();
const rtdb = admin.database();

const STALE_MS = 2 * 60 * 60 * 1000;
const VENUE_RADIUS_METERS = 200;

function getDistanceInMeters(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

async function callAnthropicAPI(apiKey, systemPrompt, prompt) {
  const url = 'https://api.anthropic.com/v1/messages';
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 1500,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  if (data && data.content && data.content[0] && data.content[0].text) {
    return data.content[0].text;
  }
  throw new Error(`Unexpected Anthropic API response: ${JSON.stringify(data)}`);
}

function extractJSON(text) {
  try {
    return JSON.parse(text.trim());
  } catch (e) {
    const match = text.match(/```json\s*([\s\S]*?)\s*```/);
    if (match && match[1]) {
      try {
        return JSON.parse(match[1].trim());
      } catch (innerError) {
        // ignore
      }
    }
    const matchGeneric = text.match(/```\s*([\s\S]*?)\s*```/);
    if (matchGeneric && matchGeneric[1]) {
      try {
        return JSON.parse(matchGeneric[1].trim());
      } catch (innerError) {
        // ignore
      }
    }
    throw new Error(`Failed to parse JSON: ${text}`);
  }
}

async function runLocalSeedingTest() {
  console.log("Starting Local Seeding Logic Test...");
  try {
    // 1. Fetch simulation settings
    const simSettingsDoc = await db.collection('settings').doc('simulation').get();
    let apiKey = null;
    if (simSettingsDoc.exists) {
      apiKey = simSettingsDoc.data().anthropicApiKey;
      console.log("Settings found. Simulation enabled:", simSettingsDoc.data().enabled);
    }

    if (!apiKey) {
      console.log("❌ Anthropic API key is not configured in settings/simulation. Please write it in Firestore.");
      process.exit(1);
    }
    console.log("✓ Anthropic API key retrieved successfully.");

    // 2. Fetch venues
    const venuesSnap = await db.collection('venues').get();
    if (venuesSnap.empty) {
      console.log("❌ No venues found.");
      process.exit(1);
    }
    const venues = venuesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    console.log(`✓ Loaded ${venues.length} venues.`);

    // 3. Fetch active locations
    const realLocsSnap = await rtdb.ref('locations').once('value');
    const realLocs = realLocsSnap.exists() ? realLocsSnap.val() : {};

    const simLocsSnap = await rtdb.ref('simulated_locations').once('value');
    const simLocs = simLocsSnap.exists() ? simLocsSnap.val() : {};

    const nowMs = Date.now();
    const activeRealLocs = Object.values(realLocs).filter(
      (loc) => loc.latitude && loc.longitude && (nowMs - loc.timestamp < STALE_MS)
    );
    const activeSimLocs = Object.values(simLocs).filter(
      (loc) => loc.latitude && loc.longitude && (nowMs - loc.timestamp < STALE_MS)
    );
    const activeLocations = [...activeRealLocs, ...activeSimLocs];
    console.log(`✓ Loaded ${activeLocations.length} active locations (Real: ${activeRealLocs.length}, Sim: ${activeSimLocs.length}).`);

    // 4. Calculate attendance
    const venueAttendance = [];
    venues.forEach(venue => {
      if (venue.hidden === true) return;
      if (venue.expirationDate && venue.expirationDate < nowMs) return;
      if (venue.startDate && venue.startDate > nowMs) return;

      const attendees = activeLocations.filter(loc => {
        if (loc.venueId) return loc.venueId === venue.id;
        return getDistanceInMeters(venue.latitude, venue.longitude, loc.latitude, loc.longitude) <= VENUE_RADIUS_METERS;
      });

      venueAttendance.push({ venue, count: attendees.length });
    });

    const activeVenues = venueAttendance.filter(item => item.count > 0);
    if (activeVenues.length === 0) {
      console.log("❌ No venues currently have active users (real or simulated). Please run the simulation script first to populate simulated locations.");
      process.exit(1);
    }

    activeVenues.sort((a, b) => b.count - a.count);
    const top10PercentCount = Math.max(1, Math.ceil(activeVenues.length * 0.10));
    const topVenues = activeVenues.slice(0, top10PercentCount).map(item => item.venue);

    console.log(`✓ Top 10% active venues:`);
    topVenues.forEach((v, idx) => {
      const att = activeVenues.find(item => item.venue.id === v.id).count;
      console.log(`  [${idx + 1}] ${v.name} (${v.type}) - Attendees: ${att}`);
    });

    // 5. Test Anthropic call on the top venue
    const testVenue = topVenues[0];
    const testCount = activeVenues.find(item => item.venue.id === testVenue.id).count;

    const weekday = 'Fri';
    const hour = 21;
    const formattedDayAndTime = `${weekday} at ${hour > 12 ? hour - 12 : hour} ${hour >= 12 ? 'PM' : 'AM'}`;
    const systemPrompt = `You are seeding a venue group chat for Eventas, a Nairobi nightlife app. Generate exactly 4 short chat messages for the ${testVenue.name} venue chat. It is ${formattedDayAndTime}. Venue type: ${testVenue.type}. Rules: write in natural Nairobi English mixed with Sheng/Swahili (use words like: sawa, buda, fiti, mtu, vibes, ama, noma, waah, leo usiku). Messages must be short (1-2 sentences), casual and punchy.`;

    const prompt = `Generate the messages. For each message, return:
1. username: a realistic Kenyan Gen Z style username (e.g. brian_ke, shaz.m, mwangi_jr)
2. text: the message content
3. delayMinutes: progressive delay in minutes from now (e.g. 2, 5, 8, 12) for when this message should be posted. Delays must be between 1 and 20 minutes and strictly ascending.

Return the result strictly as a JSON object of this format (no other text, markdown, or explanation):
{
  "messages": [
    {
      "username": "...",
      "text": "...",
      "delayMinutes": 2
    },
    ...
  ]
}`;

    console.log(`\nCalling Anthropic API for venue: ${testVenue.name}...`);
    const rawRes = await callAnthropicAPI(apiKey, systemPrompt, prompt);
    console.log("Raw Anthropic Response Received.");
    console.log("-----------------------------------------");
    console.log(rawRes);
    console.log("-----------------------------------------");

    const parsed = extractJSON(rawRes);
    console.log("✓ Successfully parsed response JSON!");
    console.log(JSON.stringify(parsed, null, 2));

  } catch (error) {
    console.error("❌ Test failed:", error);
  }
  process.exit(0);
}

runLocalSeedingTest();
