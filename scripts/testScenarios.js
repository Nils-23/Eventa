const fs = require('fs');
const path = require('path');
const { generateMessage } = require('../functions/generator');
const { SCENARIOS, getCoreStanceForScenario, getSecondaryStanceForScenario } = require('../functions/scenarios');

// 1. Load env variables
try {
  const envContent = fs.readFileSync(path.join(__dirname, '../.env'), 'utf8');
  const lines = envContent.split('\n');
  for (const line of lines) {
    const match = line.match(/^\s*ANTHROPIC_API_KEY\s*=\s*(.*)/);
    if (match && match[1]) {
      process.env.ANTHROPIC_API_KEY = match[1].trim().replace(/['"]/g, '');
    }
  }
} catch (e) {
  console.error("Could not read .env file:", e.message);
}

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("Error: ANTHROPIC_API_KEY not found in .env");
  process.exit(1);
}

// Mock personas and venues
const personas = [
  { id: 'p1', username: 'MidnightRider8192', name: 'Ndegwa', type: 'hype' },
  { id: 'p2', username: 'NightOwl8324', name: 'Wanjiku', type: 'opinion' },
  { id: 'p3', username: 'BassDrop6820', name: 'Otieno', type: 'enthusiast' },
  { id: 'p4', username: 'BeatRider5920', name: 'Kamau', type: 'question' },
  { id: 'p5', username: 'VibeCheckMaster', name: 'Mwangi', type: 'hype' }
];

const venues = [
  { id: 'v1', name: 'Alchemist Bar' },
  { id: 'v2', name: 'B-Club' }
];

// Helper functions (identical to functions/index.js)
function seededShuffle(array, seedStr) {
  let seed = 0;
  for (let i = 0; i < seedStr.length; i++) {
    seed = (seed << 5) - seed + seedStr.charCodeAt(i);
    seed |= 0;
  }
  const random = () => {
    let x = Math.sin(seed++) * 10000;
    return x - Math.floor(x);
  };
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function seededRandom(seedStr, extraSeed = 0) {
  let seed = extraSeed;
  const combined = seedStr + String(extraSeed);
  for (let i = 0; i < combined.length; i++) {
    seed = (seed << 5) - seed + combined.charCodeAt(i);
    seed |= 0;
  }
  let x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function assignPersonaRolesForScenario(allPersonas, scenario, seedStr, venueId) {
  const seed = seedStr + '_' + venueId;
  const shuffled = seededShuffle(allPersonas, seed);
  const roleAssignments = {};
  
  if (['which_spot'].includes(scenario.type)) {
    shuffled.forEach((persona, index) => {
      const role = index % 2 === 0 ? scenario.roles[0] : scenario.roles[1];
      roleAssignments[persona.id] = {
        role: role,
        stance: role === scenario.roles[0] ? 'Prefers staying/coming to this spot.' : 'Wants to move to the other spot.'
      };
    });
  } else {
    shuffled.forEach((persona, index) => {
      if (index === 0) {
        roleAssignments[persona.id] = {
          role: scenario.roles[0],
          stance: getCoreStanceForScenario(scenario.type)
        };
      } else {
        roleAssignments[persona.id] = {
          role: scenario.roles[1],
          stance: getSecondaryStanceForScenario(scenario.type)
        };
      }
    });
  }
  return roleAssignments;
}

async function simulateDeepVenueChat(venue, scenario, seedStr) {
  console.log(`\n--------------------------------------------------------------`);
  console.log(`SIMULATING DEEP CHAT FOR: ${venue.name}`);
  console.log(`Assigned Scenario: ${scenario.title} (${scenario.type})`);
  console.log(`Description: ${scenario.description}`);
  console.log(`--------------------------------------------------------------`);

  const roleAssignments = assignPersonaRolesForScenario(personas, scenario, seedStr, venue.id);
  
  // Print role assignments
  personas.forEach(p => {
    const assignment = roleAssignments[p.id];
    let loc = 'at_venue';
    if (scenario.type === 'from_home' && assignment.role === 'homebody') loc = 'at_home';
    else if (scenario.type === 'always_late' && assignment.role === 'latecomer') loc = 'en_route';
    console.log(`- @${p.username}: Role="${assignment.role}", Location="${loc}", Stance="${assignment.stance}"`);
  });
  console.log();

  let chatHistory = '';
  const chatMessages = [];
  const messageLogs = [];

  // Generate 4 messages sequentially
  for (let step = 0; step < 4; step++) {
    // Pick the persona for this step (stably/sequentially to avoid same person twice in a row)
    const persona = personas[step % personas.length];
    const assignment = roleAssignments[persona.id];
    let location = 'at_venue';
    if (scenario.type === 'from_home' && assignment.role === 'homebody') location = 'at_home';
    else if (scenario.type === 'always_late' && assignment.role === 'latecomer') location = 'en_route';

    const needsHistory = ['always_late', 'which_spot'].includes(scenario.type);
    const hasPairRand = seededRandom(seedStr + '_' + venue.id + '_acquaintance', 0);
    const hasPreExistingPair = needsHistory || (hasPairRand < 0.25);
    let isStranger = true;
    let friendUsername = '';
    if (hasPreExistingPair) {
      const shuffled = seededShuffle(personas, seedStr + '_' + venue.id);
      const pair = [shuffled[0].username, shuffled[1].username];
      if (pair.includes(persona.username)) {
        isStranger = false;
        friendUsername = pair[0] === persona.username ? pair[1] : pair[0];
      }
    }

    const context = {
      variant: step === 0 ? 'ambient' : 'dm',
      persona: persona,
      venueName: venue.name,
      history: chatHistory || 'No recent messages.',
      daypart: 'Sat at 11PM',
      tier: 'deep',
      role: assignment.role,
      stance: assignment.stance,
      location: location,
      scenarioKeywords: scenario.keywords,
      apiKey: apiKey,
      senderName: step === 0 ? 'VibeGoer' : personas[(step - 1) % personas.length].username,
      senderMessage: step === 0 ? 'Anyone here tonight?' : chatMessages[chatMessages.length - 1],
      isStranger,
      friendUsername
    };

    console.log(`[Step ${step + 1}] @${persona.username} (${location}) generating...`);
    const messageText = await generateMessage(context);
    console.log(`  -> "${messageText}"`);

    chatMessages.push(messageText);
    chatHistory += `${persona.username}: ${messageText}\n`;
    messageLogs.push({ username: persona.username, text: messageText });
  }

  return { messages: chatMessages, logs: messageLogs };
}

function calculateJaccardOverlap(chatA, chatB) {
  const stopWords = new Set([
    'the', 'to', 'is', 'a', 'and', 'in', 'on', 'at', 'for', 'of', 'this', 'that', 'it', 
    'ni', 'na', 'n', 'ya', 'wa', 'kwa', 'i', 'you', 'we', 'they', 'me', 'my', 'your', 'our', 
    'he', 'she', 'him', 'her', 'was', 'were', 'are', 'am', 'be', 'have', 'has', 'had', 
    'do', 'does', 'did', 'go', 'went', 'gone', 'but', 'so', 'if', 'or', 'as', 'an', 'with'
  ]);

  const getCleanWords = (messages) => {
    const wordsSet = new Set();
    messages.forEach(msg => {
      const words = msg.toLowerCase()
        .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'!]/g, ' ')
        .split(/\s+/);
      words.forEach(w => {
        const clean = w.trim();
        if (clean.length > 2 && !stopWords.has(clean)) {
          wordsSet.add(clean);
        }
      });
    });
    return wordsSet;
  };

  const setA = getCleanWords(chatA);
  const setB = getCleanWords(chatB);

  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);

  const overlapPct = (intersection.size / union.size) * 100;
  console.log(`\nChat A distinct words (count ${setA.size}):`, Array.from(setA).slice(0, 10));
  console.log(`Chat B distinct words (count ${setB.size}):`, Array.from(setB).slice(0, 10));
  console.log(`Intersecting words (count ${intersection.size}):`, Array.from(intersection));
  
  return overlapPct;
}

async function runSimulation() {
  const seedStr = '2026-06-28'; // Fixed seed
  
  // Select 2 unique scenarios stably
  const assigned = [];
  const used = new Set();
  venues.forEach(v => {
    let attempt = 0;
    while (attempt < 100) {
      const r = seededRandom(seedStr + '_' + v.id, attempt);
      const idx = Math.floor(r * SCENARIOS.length);
      if (!used.has(idx)) {
        assigned.push(SCENARIOS[idx]);
        used.add(idx);
        break;
      }
      attempt++;
    }
  });

  const chatA = await simulateDeepVenueChat(venues[0], assigned[0], seedStr);
  const chatB = await simulateDeepVenueChat(venues[1], assigned[1], seedStr);

  console.log(`\n=================== VALIDATION REPORT ===================`);
  console.log(`Venue 1 Scenario: ${assigned[0].title}`);
  console.log(`Venue 2 Scenario: ${assigned[1].title}`);
  console.log(`Distinct Scenarios Assert: ${assigned[0].type !== assigned[1].type ? 'PASS' : 'FAIL'}`);

  // 1. Check self-mentions
  let selfMentions = 0;
  [...chatA.logs, ...chatB.logs].forEach(log => {
    const username = log.username;
    if (log.text.includes(`@${username}`)) {
      console.error(`  [FAIL] @${username} mentioned themselves: "${log.text}"`);
      selfMentions++;
    }
  });
  console.log(`Self Mentions Found: ${selfMentions} (Expected: 0)`);

  // 2. Overlap Pct
  const overlapPct = calculateJaccardOverlap(chatA.messages, chatB.messages);
  console.log(`Chat Overlap Percentage: ${overlapPct.toFixed(2)}% (Target: < 25%)`);

  if (assigned[0].type !== assigned[1].type && selfMentions === 0 && overlapPct < 25) {
    console.log(`\n[SUCCESS] All checks passed successfully!`);
    process.exit(0);
  } else {
    console.error(`\n[FAIL] One or more checks failed.`);
    process.exit(1);
  }
}

runSimulation().catch(err => {
  console.error("Simulation error:", err);
  process.exit(1);
});
