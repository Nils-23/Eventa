const fs = require('fs');
const path = require('path');
const { generateMessage } = require('../functions/generator');
const { SCENARIOS, getCoreStanceForScenario, getSecondaryStanceForScenario, STRANGER_OK_SCENARIOS } = require('../functions/scenarios');
const fixtures = require('./fixtures');

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

// Seeded shuffling and random matching functions/index.js
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

function JaccardOverlap(chatA, chatB) {
  const stopWords = new Set([
    'the', 'to', 'is', 'a', 'and', 'in', 'on', 'at', 'for', 'of', 'this', 'that', 'it', 
    'ni', 'na', 'n', 'ya', 'wa', 'kwa', 'i', 'you', 'we', 'they', 'me', 'my', 'your', 'our', 
    'he', 'she', 'him', 'her', 'was', 'were', 'are', 'am', 'be', 'have', 'has', 'had', 
    'do', 'does', 'did', 'go', 'went', 'gone', 'but', 'so', 'if', 'or', 'as', 'an', 'with'
  ]);

  const getCleanWords = (messages) => {
    const wordsSet = new Set();
    messages.forEach(msg => {
      const words = msg.text.toLowerCase()
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
  if (setA.size === 0 && setB.size === 0) return 0;

  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);

  return (intersection.size / union.size) * 100;
}

function checkSelfMentions(allMessages) {
  let count = 0;
  allMessages.forEach(msg => {
    const handle = `@${msg.username.toLowerCase()}`;
    if (msg.text.toLowerCase().includes(handle)) {
      console.error(`  [FAIL] self-mention found: @${msg.username} said "${msg.text}"`);
      count++;
    }
  });
  return count;
}

function checkDanglingEndings(allMessages) {
  const connectors = new Set(['n', 'na', 'ni', 'tho', 'lakini', 'ama', 'like', 'and', 'or', 'for', 'kwa', 'ya', 'wa', 'the', 'to', 'in', 'at', 'a', 'of', 'with', 'on', 'up']);
  let count = 0;
  allMessages.forEach(msg => {
    const trimmed = msg.text.trim();
    if (trimmed.endsWith(',')) {
      console.error(`  [FAIL] dangling comma found: @${msg.username} said "${msg.text}"`);
      count++;
      return;
    }
    const words = trimmed.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()!?]/g, "").trim().split(/\s+/);
    if (words.length > 0) {
      const lastWord = words[words.length - 1].toLowerCase();
      if (connectors.has(lastWord)) {
        console.error(`  [FAIL] dangling connector "${lastWord}" found: @${msg.username} said "${msg.text}"`);
        count++;
      }
    }
  });
  return count;
}

async function simulateNight(seedStr) {
  console.log(`\n==============================================================`);
  console.log(`SIMULATING NIGHT WITH SEED: ${seedStr}`);
  console.log(`==============================================================`);

  // We determine selected venues for the night using peak night logic (Fri/Sat cap 4)
  const totalSimCap = 4;
  const selectedVenuesForNight = seededShuffle(fixtures.venues, seedStr).slice(0, totalSimCap);
  
  // Force two deep venues for test purposes so we can check distinctness
  const numDeep = Math.min(2, selectedVenuesForNight.length);
  const deepVenues = selectedVenuesForNight.slice(0, numDeep);

  console.log(`Deep Venues for this night: ${deepVenues.map(v => v.name).join(', ')}`);

  // Assign unique scenarios (respect override if set)
  const assignedScenarios = {};
  const usedScenarioIndexes = new Set();
  deepVenues.forEach((venue) => {
    if (venue.scenarioOverride) {
      const selected = SCENARIOS.find(s => s.type === venue.scenarioOverride);
      if (selected) {
        assignedScenarios[venue.id] = selected;
        const idx = SCENARIOS.indexOf(selected);
        if (idx !== -1) usedScenarioIndexes.add(idx);
        return;
      }
    }

    const hasPairRand = seededRandom(seedStr + '_' + venue.id + '_acquaintance', 0);
    const hasPreExistingPair = hasPairRand < 0.25;

    let attempt = 0;
    let selectedScenario = null;
    while (attempt < 100) {
      const randVal = seededRandom(seedStr + '_' + venue.id, attempt);
      const scenarioIndex = Math.floor(randVal * SCENARIOS.length);
      const candidate = SCENARIOS[scenarioIndex];
      const isAllowed = STRANGER_OK_SCENARIOS.includes(candidate.type) || hasPreExistingPair;
      
      if (isAllowed && !usedScenarioIndexes.has(scenarioIndex)) {
        selectedScenario = candidate;
        usedScenarioIndexes.add(scenarioIndex);
        break;
      }
      attempt++;
    }
    if (!selectedScenario) {
      for (let i = 0; i < SCENARIOS.length; i++) {
        const candidate = SCENARIOS[i];
        const isAllowed = STRANGER_OK_SCENARIOS.includes(candidate.type) || hasPreExistingPair;
        if (isAllowed && !usedScenarioIndexes.has(i)) {
          selectedScenario = candidate;
          usedScenarioIndexes.add(i);
          break;
        }
      }
    }
    assignedScenarios[venue.id] = selectedScenario;
  });

  const deepChats = {};
  const allGeneratedMessages = [];

  for (const venue of deepVenues) {
    const scenario = assignedScenarios[venue.id];
    console.log(`\nVenue: ${venue.name}`);
    console.log(`Assigned Scenario: ${scenario.title} (${scenario.type})`);
    
    // Stably resolve role mappings
    const roleAssignments = assignPersonaRolesForScenario(fixtures.personas, scenario, seedStr, venue.id);
    
    // Print role -> persona map
    console.log("Role Map:");
    fixtures.personas.forEach(p => {
      const assignment = roleAssignments[p.id] || { role: 'default', stance: '' };
      console.log(`  - @${p.username} (${p.name}) -> Role: "${assignment.role}"`);
    });
    console.log("Thread:");

    const chatMessages = [];
    let chatHistory = '';

    // Generate 3 messages per thread sequentially
    for (let step = 0; step < 3; step++) {
      const persona = fixtures.personas[step % fixtures.personas.length];
      const assignment = roleAssignments[persona.id] || { role: 'default', stance: '', location: 'at_venue' };
      let location = 'at_venue';
      if (scenario.type === 'from_home' && assignment.role === 'homebody') location = 'at_home';
      else if (scenario.type === 'always_late' && assignment.role === 'latecomer') location = 'en_route';

      let isStranger = true;
      let friendUsername = '';
      const hasPairRand = seededRandom(seedStr + '_' + venue.id + '_acquaintance', 0);
      const hasPreExistingPair = hasPairRand < 0.25;
      if (hasPreExistingPair) {
        const shuffled = seededShuffle(fixtures.personas, seedStr + '_' + venue.id);
        const pair = [shuffled[0].username, shuffled[1].username];
        if (pair.includes(persona.username)) {
          isStranger = false;
          friendUsername = pair[0] === persona.username ? pair[1] : pair[0];
        }
      }

      const context = {
        variant: step === 0 ? 'ambient' : 'dm',
        persona,
        venueName: venue.name,
        history: chatHistory || 'No recent messages.',
        daypart: 'Sat at 11PM',
        tier: 'deep',
        role: assignment.role,
        stance: assignment.stance,
        location,
        scenarioKeywords: scenario.keywords,
        apiKey,
        senderName: step === 0 ? 'VibeGoer' : fixtures.personas[(step - 1) % fixtures.personas.length].username,
        senderMessage: step === 0 ? 'Anyone here tonight?' : chatMessages[chatMessages.length - 1].text,
        isStranger,
        friendUsername
      };

      try {
        const text = await generateMessage(context);
        console.log(`  [Step ${step + 1}] @${persona.username}: "${text}"`);
        const msgObj = { username: persona.username, text };
        chatMessages.push(msgObj);
        allGeneratedMessages.push(msgObj);
        chatHistory += `${persona.username}: ${text}\n`;
      } catch (err) {
        console.error(`  [Step ${step + 1}] @${persona.username} failed:`, err.message);
      }
    }
    deepChats[venue.id] = chatMessages;
  }

  // Run validation metrics
  console.log(`\nMetrics for Night ${seedStr}:`);
  let overlapPct = 0;
  if (deepVenues.length >= 2) {
    const chatA = deepChats[deepVenues[0].id] || [];
    const chatB = deepChats[deepVenues[1].id] || [];
    overlapPct = JaccardOverlap(chatA, chatB);
    console.log(`  chatDistinctness(deepChatA, deepChatB).overlapPct: ${overlapPct.toFixed(2)}% (Target: < 25%)`);
  } else {
    console.log(`  chatDistinctness: skipped (less than 2 deep venues)`);
  }

  const selfMentionsCount = checkSelfMentions(allGeneratedMessages);
  console.log(`  selfMentions(allMessages): ${selfMentionsCount} (Target: 0)`);

  const danglingEndingsCount = checkDanglingEndings(allGeneratedMessages);
  console.log(`  danglingEndings(allMessages): ${danglingEndingsCount} (Target: 0)`);

  return {
    deepVenues,
    assignedScenarios,
    overlapPct,
    selfMentionsCount,
    danglingEndingsCount
  };
}

async function runAll() {
  const seeds = ['2026-06-26', '2026-06-27', '2026-07-03'];
  const results = [];

  for (const seed of seeds) {
    const res = await simulateNight(seed);
    results.push({ seed, ...res });
  }

  console.log(`\n=================== OVERALL REPORT ===================`);
  // Confirm deep venues get different scenarios on each night
  let uniqueScenarioAssert = true;
  results.forEach(res => {
    if (res.deepVenues.length >= 2) {
      const v0 = res.deepVenues[0].id;
      const v1 = res.deepVenues[1].id;
      const s0 = res.assignedScenarios[v0].type;
      const s1 = res.assignedScenarios[v1].type;
      console.log(`Night ${res.seed}: ${res.deepVenues[0].name} (${s0}) vs ${res.deepVenues[1].name} (${s1})`);
      if (s0 === s1) {
        uniqueScenarioAssert = false;
        console.error(`  [FAIL] Both deep venues got the same scenario: ${s0}`);
      }
    }
  });

  // Verify that the same venue rotates scenarios night to night
  // We'll track the scenario assigned to 'venue_001' (Alchemist Bar) if it was deep
  const alchemistScenarios = [];
  results.forEach(res => {
    const sc = res.assignedScenarios['venue_001'];
    if (sc) {
      alchemistScenarios.push(sc.type);
      console.log(`Alchemist Bar scenario on ${res.seed}: ${sc.type}`);
    }
  });

  const uniqueAlchemistScenarios = new Set(alchemistScenarios);
  const alchemistRotates = uniqueAlchemistScenarios.size > 1 || alchemistScenarios.length <= 1;
  console.log(`Alchemist Bar scenarios count across nights: ${alchemistScenarios.length}, unique count: ${uniqueAlchemistScenarios.size}`);
  console.log(`Alchemist Scenario Rotates Assert: ${alchemistRotates ? 'PASS' : 'FAIL'}`);

  // Confirm distinctness, self-mentions, and dangling endings across all nights
  let metricsPass = true;
  results.forEach(res => {
    if (res.overlapPct >= 25) {
      metricsPass = false;
      console.error(`  [FAIL] Night ${res.seed} Jaccard overlap ${res.overlapPct.toFixed(2)}% was >= 25%`);
    }
    if (res.selfMentionsCount > 0) {
      metricsPass = false;
      console.error(`  [FAIL] Night ${res.seed} had ${res.selfMentionsCount} self-mentions`);
    }
    if (res.danglingEndingsCount > 0) {
      metricsPass = false;
      console.error(`  [FAIL] Night ${res.seed} had ${res.danglingEndingsCount} dangling endings`);
    }
  });

  if (uniqueScenarioAssert && alchemistRotates && metricsPass) {
    console.log(`\n[SUCCESS] Multi-night simulation completed and verified successfully!`);
    process.exit(0);
  } else {
    console.error(`\n[FAIL] Scenario distinctness or metrics validation failed.`);
    process.exit(1);
  }
}

runAll().catch(err => {
  console.error("Simulation suite error:", err);
  process.exit(1);
});
