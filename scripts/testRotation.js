const assert = require('assert');

// 1. Mock hash helper
function getVenueHash(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
}

// 2. Mock list of 5 venues in the "Club" category with static views/scores
const mockVenues = [
  { id: 'club_neon', name: 'Neon Club', type: 'Club', venueViews: 500, favorites: 25 },
  { id: 'club_basement', name: 'Basement Lounge', type: 'Club', venueViews: 400, favorites: 20 },
  { id: 'club_rooftop', name: 'Rooftop Vibes', type: 'Club', venueViews: 300, favorites: 15 },
  { id: 'club_eclipse', name: 'Eclipse Club', type: 'Club', venueViews: 200, favorites: 10 },
  { id: 'club_mirage', name: 'Mirage Lounge', type: 'Club', venueViews: 100, favorites: 5 },
];

// 3. Score calculation logic (extracted from useSimulationEngine.ts)
function getSortedVenuesAtTime(nowMs) {
  // calculate raw scores
  const scores = mockVenues.map(v => {
    const sc = (v.venueViews || 0) * 0.2 + 
               (v.favorites || 0) * 2; // simplified score for mock
    return { id: v.id, rawScore: sc };
  });

  const rawScoresList = scores.map(s => s.rawScore);
  const minHP = Math.min(...rawScoresList);
  const maxHP = Math.max(...rawScoresList);

  const computed = mockVenues.map(v => {
    const rawObj = scores.find(s => s.id === v.id);
    const rawScore = rawObj ? rawObj.rawScore : 0;
    
    const historicalPopularity = maxHP > minHP 
      ? 1 + 99 * (rawScore - minHP) / (maxHP - minHP) 
      : 50;

    // 8-hour cycle for popularity rotation
    const cycleTime = (nowMs / (8 * 60 * 60 * 1000)) * 2 * Math.PI;
    const rotation = Math.sin(cycleTime + getVenueHash(v.id)) * 30; // Shift range: -30 to +30

    const popularityBase = Math.max(1, historicalPopularity + rotation);
    const trendFactor = 1.0; // keep trend factor static for deterministic test output
    const resultingPopularity = popularityBase * trendFactor;

    return {
      ...v,
      resultingPopularity
    };
  });

  // Sort descending to find top-ranking venues
  return computed.sort((a, b) => b.resultingPopularity - a.resultingPopularity);
}

function runRotationSimulation() {
  console.log("=== Running Popularity Rotation Simulation (24-Hour Cycle) ===");
  
  const hourMs = 60 * 60 * 1000;
  const startMs = Date.now();
  
  const topVenueSeen = new Set();
  
  for (let hr = 0; hr < 24; hr += 2) {
    const timeMs = startMs + hr * hourMs;
    const sorted = getSortedVenuesAtTime(timeMs);
    const topVenue = sorted[0];
    
    topVenueSeen.add(topVenue.id);
    
    console.log(`Hour +${hr.toString().padStart(2, '0')}: Top Venue is "${topVenue.name}" (score: ${topVenue.resultingPopularity.toFixed(1)})`);
    console.log(`          Rank order: ${sorted.map(v => `${v.name} (${v.resultingPopularity.toFixed(1)})`).join(" > ")}`);
  }
  
  console.log("\nSummary of top venues seen over 24 hours:", Array.from(topVenueSeen).map(id => mockVenues.find(v => v.id === id).name));
  
  // Verify that the top venue has rotated at least once (more than 1 unique top venue seen)
  assert.ok(topVenueSeen.size > 1, "Popularity did not rotate! The same venue stayed at the top.");
  
  console.log("=== POPULARITY ROTATION TESTS PASSED! ===");
}

runRotationSimulation();
