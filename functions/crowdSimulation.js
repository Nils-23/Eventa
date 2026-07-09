/**
 * crowdSimulation.js — server-side crowd simulation engine.
 *
 * Port of the client engine (hooks/useSimulationEngine.ts + utils/venueProfiles.ts)
 * to a scheduled Cloud Function, so simulated crowds exist 24/7 instead of only
 * while an admin device has the app open.
 *
 * Coordination with old app builds: every cycle writes simulation_status with a
 * FUTURE-dated lastHeartbeat ('server_engine', now + 15 min). Old clients treat
 * any lease younger than 30s as active-and-foreign, so they stand by permanently.
 * If this function ever stops for >15 min, an old admin build can still take
 * over as a fallback — the server reclaims authority on its next run.
 *
 * State that the client kept in memory (per-venue momentum) is persisted in
 * RTDB under `simulation_state` so it survives across stateless invocations.
 */

const MAX_RADIUS_METERS = 200; // sims roam within 200m of their venue
const ROAM_STEP_METERS = 30;   // per-cycle micro-movement (cycles are ~2 min)
const HOT_ROTATION_SLOT_MS = 3 * 60 * 60 * 1000;
const SERVER_SIMULATOR_ID = 'server_engine';
const LEASE_LOOKAHEAD_MS = 15 * 60 * 1000;

// ─── Venue profiles (port of utils/venueProfiles.ts — keep the two in sync) ──

function hoursCurve(peaks, base = 0.02) {
  const arr = new Array(24).fill(base);
  for (const h in peaks) arr[parseInt(h, 10)] = peaks[h];
  return arr;
}

const ALL_WEEK = { Mon: 1, Tue: 1, Wed: 1, Thu: 1, Fri: 1, Sat: 1, Sun: 1 };
const WEEKEND_HEAVY = { Mon: 0.5, Tue: 0.5, Wed: 0.6, Thu: 0.7, Fri: 1, Sat: 1, Sun: 0.9 };
const NIGHTLIFE_WEEK = { Mon: 0.07, Tue: 0.07, Wed: 0.12, Thu: 0.6, Fri: 1, Sat: 1, Sun: 0.7 };
const WEEKDAY_HEAVY = { Mon: 1, Tue: 1, Wed: 1, Thu: 1, Fri: 0.9, Sat: 0.3, Sun: 0.2 };

const PROFILES = {
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
  concert: {
    key: 'concert', baseType: 'Event', capacity: 150, popularityPrior: 0.45,
    hours: hoursCurve({ 17: 0.3, 18: 0.5, 19: 0.8, 20: 1, 21: 1, 22: 1, 23: 0.9, 0: 0.7, 1: 0.4, 2: 0.2 }, 0.05),
    weekdays: ALL_WEEK,
  },
  conference: {
    key: 'conference', baseType: 'Event', capacity: 120, popularityPrior: 0.4,
    hours: hoursCurve({ 8: 0.5, 9: 0.9, 10: 1, 11: 1, 12: 0.9, 13: 0.9, 14: 1, 15: 1, 16: 0.9, 17: 0.6, 18: 0.3 }, 0),
    weekdays: WEEKDAY_HEAVY,
  },
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
  generic_unknown: {
    key: 'generic_unknown', baseType: 'Activity', capacity: 40, popularityPrior: 0.15,
    hours: hoursCurve({ 10: 0.3, 11: 0.3, 12: 0.3, 13: 0.3, 14: 0.3, 15: 0.3, 16: 0.3, 17: 0.3, 18: 0.2 }, 0.02),
    weekdays: ALL_WEEK,
  },
};

const MATCHERS = [
  { pattern: /karaoke/, profile: 'karaoke' },
  { pattern: /sports?\s?(bar|pub|grill)|match\s?day/, profile: 'sports_bar' },
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
  { pattern: /\bclub\b/, profile: 'nightclub' },
];

const TYPE_DEFAULTS = {
  CLUB: 'generic_club',
  BAR: 'generic_bar',
  ACTIVITY: 'generic_activity',
  EVENT: 'generic_event',
};

// A text-matched profile may not contradict the venue's declared type: a Bar
// whose description says "live music" must stay a Bar (cap 50, quiet Tuesdays),
// not become a concert venue (cap 150, packed all week).
function profileMatchesType(profileKey, venueType) {
  const t = (venueType || '').toUpperCase();
  if (!TYPE_DEFAULTS[t]) return true; // no/unknown declared type — trust the text
  return PROFILES[profileKey].baseType.toUpperCase() === t;
}

function inferProfileKey(venue) {
  if (venue.venueProfile && PROFILES[venue.venueProfile] &&
      profileMatchesType(venue.venueProfile, venue.type)) {
    return venue.venueProfile;
  }
  const text = `${venue.name || ''} ${venue.description || ''}`.toLowerCase();
  for (const { pattern, profile } of MATCHERS) {
    if (pattern.test(text) && profileMatchesType(profile, venue.type)) return profile;
  }
  const typeDefault = TYPE_DEFAULTS[(venue.type || '').toUpperCase()];
  return typeDefault || 'generic_unknown';
}

function getProfile(venue) {
  return PROFILES[inferProfileKey(venue)];
}

function getProfileCapacity(venue, profile) {
  return venue.maxCapacity !== undefined ? venue.maxCapacity : profile.capacity;
}

function getAttendanceShape(profile, weekday, hour) {
  const w = profile.weekdays[weekday] !== undefined ? profile.weekdays[weekday] : 0.5;
  const h = profile.hours[Math.max(0, Math.min(23, hour))] || 0.02;
  return Math.max(0, Math.min(1, w * h));
}

function getEventEnvelope(nowMs, startMs, endMs) {
  if (!startMs || !endMs) return 0.3;
  const RAMP_MS = 2 * 3600 * 1000;
  if (nowMs < startMs - RAMP_MS) return 0;
  if (nowMs < startMs) return 0.1 + 0.9 * ((nowMs - (startMs - RAMP_MS)) / RAMP_MS);
  if (nowMs <= endMs) return 1;
  return Math.max(0, 1 - (nowMs - endMs) / RAMP_MS);
}

function hash32(str, seed) {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 2654435761);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h ^= h >>> 13;
  return h >>> 0;
}

function stableUnit(id, salt) {
  return (hash32(id, salt) + 0.5) / 4294967296;
}

function getStableBaseFactor(venueId, prior) {
  const u1 = stableUnit(venueId, 0x9e3779b9);
  const u2 = stableUnit(venueId, 0x85ebca6b);
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2); // Box-Muller
  const factor = prior * Math.exp(0.7 * z);
  return Math.max(0.02, Math.min(0.95, factor));
}

function samplePoisson(lambda) {
  if (lambda <= 0) return 0;
  if (lambda > 30) {
    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1 || 1e-12)) * Math.cos(2 * Math.PI * u2);
    return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * z));
  }
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= Math.random();
  } while (p > L);
  return k - 1;
}

// ─── Engine helpers (port of hooks/useSimulationEngine.ts) ───────────────────

function seededUnitRandom(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function getDistanceInMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function offsetLocation(lat, lon, maxDistanceMeters) {
  const radiusInDegrees = maxDistanceMeters / 111111;
  const u = Math.random();
  const v = Math.random();
  const w = radiusInDegrees * Math.sqrt(u);
  const t = 2 * Math.PI * v;
  const x = w * Math.cos(t);
  const y = w * Math.sin(t);
  return { latitude: lat + x, longitude: lon + y / Math.cos(lat * Math.PI / 180) };
}

function moveLocation(currentLat, currentLon, centerLat, centerLon, stepMeters) {
  const { latitude, longitude } = offsetLocation(currentLat, currentLon, stepMeters);
  const distance = getDistanceInMeters(latitude, longitude, centerLat, centerLon);
  if (distance > MAX_RADIUS_METERS) {
    return {
      latitude: (latitude + centerLat) / 2,
      longitude: (longitude + centerLon) / 2,
    };
  }
  return { latitude, longitude };
}

function getEventStrengthMultiplier(venue) {
  if (venue.type !== 'Event') return 1.0;
  const savedCount = venue.savedCount !== undefined ? venue.savedCount : null;
  const views = venue.views !== undefined ? venue.views : null;
  const shares = venue.shares !== undefined ? venue.shares : null;
  const comments = venue.comments !== undefined ? venue.comments : null;
  if (savedCount === null && views === null && shares === null && comments === null) {
    return 1.5;
  }
  const score = ((savedCount || 0) * 2) + ((views || 0) * 0.1) + ((shares || 0) * 5) + ((comments || 0) * 3);
  if (score <= 50) return 1.0;
  if (score <= 150) return 1.5;
  if (score <= 400) return 2.5;
  return 4.0;
}

function getNairobiTimeParts(now) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Nairobi',
    weekday: 'short',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(now);
  let weekday = 'Mon';
  let hour = 12;
  parts.forEach((p) => {
    if (p.type === 'weekday') weekday = p.value;
    if (p.type === 'hour') hour = parseInt(p.value, 10);
  });
  const dateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(now);
  return { weekday, hour, dateStr };
}

async function writeServerLease(rtdb, nowMs) {
  // Future-dated heartbeat: old app builds see an active foreign lease and
  // permanently stand by (their check is `now - lastHeartbeat < 30s`).
  await rtdb.ref('simulation_status').set({
    activeSimulatorId: SERVER_SIMULATOR_ID,
    lastHeartbeat: nowMs + LEASE_LOOKAHEAD_MS,
  });
}

// ─── Main cycle ───────────────────────────────────────────────────────────────

async function runCrowdSimulationCycle(db, rtdb) {
  const nowMs = Date.now();
  const now = new Date(nowMs);
  const { weekday, hour, dateStr: nairobiDateStr } = getNairobiTimeParts(now);

  // ── 0. Settings gate ──────────────────────────────────────────────────────
  const settingsRef = db.collection('settings').doc('simulation');
  const settingsSnap = await settingsRef.get();
  const settings = settingsSnap.exists ? settingsSnap.data() : {};

  await writeServerLease(rtdb, nowMs);

  if (settings.enabled === false) {
    const simsSnap = await rtdb.ref('simulated_locations').get();
    if (simsSnap.exists()) {
      await rtdb.ref('simulated_locations').set(null);
      await rtdb.ref('simulation_state').set(null);
      console.log('[CrowdSim] Simulation disabled — cleared all simulated locations.');
    }
    return;
  }

  // ── 1. Load venues ────────────────────────────────────────────────────────
  const venuesSnap = await db.collection('venues').get();
  const allVenues = venuesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const rawVenues = allVenues.filter((venue) => {
    if (venue.hidden === true) return false;
    if (venue.expirationDate && venue.expirationDate < nowMs) return false;
    if (venue.startDate && venue.startDate > nowMs) return false;
    return true;
  });

  if (rawVenues.length === 0) {
    console.log('[CrowdSim] No active venues.');
    return;
  }

  // ── 2. Initialise missing metrics on venue docs (same defaults as client) ─
  try {
    const initBatch = db.batch();
    let initCount = 0;
    for (const v of rawVenues) {
      const updateObj = {};
      if (v.venueViews === undefined) {
        const type = (v.type || 'Club').toUpperCase();
        const defaultPop = type === 'CLUB' ? 60 : type === 'BAR' ? 50 : type === 'ACTIVITY' ? 45 : 50;
        Object.assign(updateObj, {
          venueViews: Math.floor(defaultPop * 3 + Math.random() * 100),
          favorites: Math.floor(defaultPop * 0.5 + Math.random() * 10),
          shares: Math.floor(defaultPop * 0.2 + Math.random() * 5),
          venueVisits: Math.floor(defaultPop * 0.8 + Math.random() * 20),
          checkIns: Math.floor(defaultPop * 0.3 + Math.random() * 10),
          popularityDrift: 1.0,
        });
        if (v.type === 'Event') {
          Object.assign(updateObj, {
            savedCount: Math.floor(10 + Math.random() * 40),
            views: Math.floor(100 + Math.random() * 200),
            comments: Math.floor(2 + Math.random() * 10),
            shares: Math.floor(5 + Math.random() * 15),
          });
        }
      }
      if (v.venueIdentityFactor === undefined) {
        updateObj.venueIdentityFactor = 0.90 + Math.random() * 0.20;
      }
      if (v.venueProfile === undefined) {
        updateObj.venueProfile = inferProfileKey(v);
      } else if (PROFILES[v.venueProfile] && !profileMatchesType(v.venueProfile, v.type)) {
        // Self-heal profiles persisted before the type-consistency guard
        updateObj.venueProfile = inferProfileKey(v);
        console.log(`[CrowdSim] Corrected ${v.name}: venueProfile ${v.venueProfile} → ${updateObj.venueProfile}`);
      }
      if (Object.keys(updateObj).length > 0) {
        initBatch.update(db.collection('venues').doc(v.id), updateObj);
        Object.assign(v, updateObj);
        initCount++;
      }
    }
    if (initCount > 0) {
      await initBatch.commit();
      console.log(`[CrowdSim] Initialised metrics for ${initCount} venue(s).`);
    }
  } catch (err) {
    console.error('[CrowdSim] Failed to initialise venue metrics:', err.message);
  }

  // ── 3. Weekly popularity drift ────────────────────────────────────────────
  try {
    const lastDriftTime = settings.lastDriftTime || 0;
    if (nowMs - lastDriftTime > 7 * 24 * 3600 * 1000) {
      const driftBatch = db.batch();
      for (const v of rawVenues) {
        const currentDrift = v.popularityDrift || 1.0;
        const magnitude = 0.05 + Math.random() * 0.05;
        const sign = Math.random() > 0.5 ? 1 : -1;
        const newDrift = Math.max(0.5, Math.min(2.0, currentDrift * (1 + sign * magnitude)));
        driftBatch.update(db.collection('venues').doc(v.id), { popularityDrift: newDrift });
        v.popularityDrift = newDrift;
      }
      driftBatch.update(settingsRef, { lastDriftTime: nowMs });
      await driftBatch.commit();
      console.log('[CrowdSim] Weekly popularity drift applied.');
    }
  } catch (err) {
    console.error('[CrowdSim] Weekly drift failed:', err.message);
  }

  // ── 4. Popularity factors (day-seeded base + 3h rotation, as on client) ──
  let activeStoryCounts = {};
  try {
    const dayAgo = new Date(nowMs - 24 * 3600 * 1000);
    const storiesSnap = await db.collection('stories').where('created_at', '>=', dayAgo).get();
    storiesSnap.forEach((d) => {
      const vid = d.data().venue_id;
      if (vid) activeStoryCounts[vid] = (activeStoryCounts[vid] || 0) + 1;
    });
  } catch (err) {
    console.warn('[CrowdSim] Story fetch failed (boost skipped):', err.message);
  }

  const venuesWithFactors = rawVenues.map((v) => {
    const profile = getProfile(v);

    // Day-seeded base: fresh standouts every night (see useSimulationEngine.ts
    // for full rationale — keep both implementations in sync).
    const baseFactor = getStableBaseFactor(`${v.id}|${nairobiDateStr}`, profile.popularityPrior);
    const dampedBase = profile.popularityPrior *
      Math.pow(baseFactor / profile.popularityPrior, 0.55);

    const rotationSlot = Math.floor(nowMs / HOT_ROTATION_SLOT_MS);
    const rotation = 0.3 + 1.6 * seededUnitRandom(`${v.id}|hot|${rotationSlot}`);

    const storyBoost = Math.min(1.3, 1 + (activeStoryCounts[v.id] || 0) * 0.05);
    const popularityDrift = Math.pow(v.popularityDrift || 1.0, 0.3);

    const popularityFactor = Math.max(0.02, Math.min(0.95,
      dampedBase * rotation * storyBoost * popularityDrift
    ));

    return { ...v, profile, popularityFactor };
  });

  // ── 5. Load presence (real users), current sims, and momentum state ──────
  let allPresence = {};
  try {
    const presenceSnap = await rtdb.ref('venue_presence').get();
    if (presenceSnap.exists()) allPresence = presenceSnap.val();
  } catch (err) {
    console.error('[CrowdSim] Presence fetch failed:', err.message);
  }

  let currentSims = [];
  try {
    const simsSnap = await rtdb.ref('simulated_locations').get();
    if (simsSnap.exists()) {
      currentSims = Object.values(simsSnap.val()).filter((s) => s && s.user_id && s.venueId);
    }
  } catch (err) {
    console.error('[CrowdSim] Failed to fetch existing sims:', err.message);
  }

  let momentumStates = {};
  try {
    const stateSnap = await rtdb.ref('simulation_state').get();
    if (stateSnap.exists()) momentumStates = stateSnap.val() || {};
  } catch (err) {
    console.warn('[CrowdSim] Momentum state fetch failed (defaults used):', err.message);
  }

  // ── 6. Pass 1: compute per-venue targets ─────────────────────────────────
  const proposedCounts = {};
  const venueContexts = {};

  venuesWithFactors.forEach((venue) => {
    let isOverride = venue.isOverride === true;
    if (isOverride && venue.overrideDate !== nairobiDateStr) {
      db.collection('venues').doc(venue.id).update({ isOverride: false })
        .catch((err) => console.error(`[CrowdSim] Override reset failed for ${venue.name}:`, err.message));
      isOverride = false;
    }
    const cap = getProfileCapacity(venue, venue.profile);

    const currentUsers = currentSims.filter((u) => u.venueId === venue.id);
    const currentCount = currentUsers.length;

    let momentum = (momentumStates[venue.id] && momentumStates[venue.id].momentumScore) || 1.0;

    let adjustedTargetAttendance = 0;
    if (isOverride) {
      adjustedTargetAttendance = Math.max(0, Math.min(cap,
        venue.simulatedUsersCount !== undefined ? venue.simulatedUsersCount : 20));
    } else {
      const identityFactor = venue.venueIdentityFactor !== undefined ? venue.venueIdentityFactor : 1.0;
      const eventStrengthMultiplier = getEventStrengthMultiplier(venue);
      const amplitude = Math.min(cap,
        cap * venue.popularityFactor * identityFactor * eventStrengthMultiplier);

      let shape = getAttendanceShape(venue.profile, weekday, hour);
      if (venue.type === 'Event') {
        shape *= getEventEnvelope(nowMs, venue.startDate, venue.expirationDate);
      }

      const targetFloat = amplitude * shape * momentum;
      adjustedTargetAttendance = Math.max(0, Math.min(cap, samplePoisson(targetFloat)));
    }

    // Momentum drift ±0.02 toward the target direction
    if (adjustedTargetAttendance > currentCount) {
      momentum = Math.min(1.2, momentum + 0.02);
    } else if (adjustedTargetAttendance < currentCount) {
      momentum = Math.max(0.8, momentum - 0.02);
    }
    momentumStates[venue.id] = { momentumScore: momentum };

    // Real users within last 15 minutes
    const presenceObj = allPresence[venue.id] || {};
    const fifteenMinAgo = nowMs - 15 * 60 * 1000;
    let realUserCount = 0;
    for (const uid in presenceObj) {
      if (!uid.startsWith('sim_') && presenceObj[uid] > fifteenMinAgo) {
        realUserCount++;
      }
    }

    const simulatedTarget = Math.max(0, adjustedTargetAttendance - realUserCount);

    // Smooth transitions — build gradually, empty out fast
    const diff = simulatedTarget - currentCount;
    const transitionFactor = diff < 0
      ? 0.25 + Math.random() * 0.20
      : 0.05 + Math.random() * 0.10;
    const rawStep = diff * transitionFactor;
    let step = 0;
    if (diff > 0 && rawStep < 1) {
      step = Math.random() < rawStep ? 1 : 0;
    } else if (diff < 0 && rawStep > -1) {
      step = Math.random() < Math.abs(rawStep) ? -1 : 0;
    } else {
      step = Math.round(rawStep);
    }
    let newCount = currentCount + step;

    // Spike protection
    let delta = newCount - currentCount;
    let maxDelta = 15;
    if (currentCount < 15) maxDelta = 3;
    else if (currentCount <= 50) maxDelta = 8;
    if (delta > maxDelta) delta = maxDelta;
    if (delta < -maxDelta * 2) delta = -maxDelta * 2;
    newCount = Math.max(0, Math.min(cap, currentCount + delta));

    proposedCounts[venue.id] = newCount;
    venueContexts[venue.id] = { cap, currentUsers };
  });

  // ── 7. Pass 2: spawn / despawn / roam, write to RTDB ─────────────────────
  const updates = {};
  let spawned = 0;
  let despawned = 0;

  // Prune sims for inactive/expired/deleted/hidden venues
  const activeVenueIds = new Set(rawVenues.map((v) => v.id));
  const prunedIds = new Set();
  for (const u of currentSims) {
    if (!activeVenueIds.has(u.venueId)) {
      updates[u.user_id] = null;
      prunedIds.add(u.user_id);
      despawned++;
    }
  }
  currentSims = currentSims.filter((u) => !prunedIds.has(u.user_id));

  venuesWithFactors.forEach((venue) => {
    const { cap } = venueContexts[venue.id];
    let venueUsers = currentSims.filter((u) => u.venueId === venue.id);

    // Force prune anything above capacity
    if (venueUsers.length > cap) {
      const excess = venueUsers.slice(0, venueUsers.length - cap);
      for (const u of excess) {
        updates[u.user_id] = null;
        despawned++;
      }
      const excessIds = new Set(excess.map((u) => u.user_id));
      venueUsers = venueUsers.filter((u) => !excessIds.has(u.user_id));
      currentSims = currentSims.filter((u) => !excessIds.has(u.user_id));
    }

    const newCount = proposedCounts[venue.id];
    const finalDiff = newCount - venueUsers.length;

    if (finalDiff > 0) {
      for (let i = 0; i < finalDiff; i++) {
        const loc = offsetLocation(venue.latitude, venue.longitude, MAX_RADIUS_METERS / 2);
        const newUser = {
          user_id: `sim_${venue.id}_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
          venueId: venue.id,
          centerLat: venue.latitude,
          centerLon: venue.longitude,
          latitude: loc.latitude,
          longitude: loc.longitude,
          timestamp: nowMs,
        };
        currentSims.push(newUser);
        updates[newUser.user_id] = newUser;
        spawned++;
      }
    } else if (finalDiff < 0) {
      const toRemove = venueUsers.slice(0, Math.abs(finalDiff));
      for (const u of toRemove) {
        updates[u.user_id] = null;
        despawned++;
      }
      const removeIds = new Set(toRemove.map((u) => u.user_id));
      currentSims = currentSims.filter((u) => !removeIds.has(u.user_id));
    }
  });

  // Roam every surviving sim a little and refresh its timestamp — replaces the
  // client's 15s micro-movement loop. Must run every cycle: clients evict sim
  // locations older than 10 minutes (SIM_STALE_MS in LiveVenuesContext).
  for (const u of currentSims) {
    if (updates[u.user_id] === null) continue;
    const next = moveLocation(u.latitude, u.longitude, u.centerLat || u.latitude, u.centerLon || u.longitude, ROAM_STEP_METERS);
    updates[u.user_id] = {
      user_id: u.user_id,
      venueId: u.venueId,
      centerLat: u.centerLat !== undefined ? u.centerLat : u.latitude,
      centerLon: u.centerLon !== undefined ? u.centerLon : u.longitude,
      latitude: next.latitude,
      longitude: next.longitude,
      timestamp: nowMs,
    };
  }

  if (Object.keys(updates).length > 0) {
    await rtdb.ref('simulated_locations').update(updates);
  }
  await rtdb.ref('simulation_state').set(momentumStates);

  console.log(`[CrowdSim] Cycle complete: ${currentSims.length} sims across ${rawVenues.length} venues (+${spawned}/-${despawned}).`);
}

module.exports = {
  runCrowdSimulationCycle,
  // Venue profile helpers — also used by the persona chat system (index.js)
  // to gate which venues are "alive" at the current hour and to give the
  // prompt generator context about what kind of place a venue is.
  getProfile,
  getAttendanceShape,
  inferProfileKey,
};
