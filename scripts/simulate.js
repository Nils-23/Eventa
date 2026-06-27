/**
 * scripts/simulate.js
 * Tier 2 single-thread simulator
 * Usage: ANTHROPIC_API_KEY=your_key node scripts/simulate.js
 */

const { generateMessage } = require('../functions/generator');
const fixtures = require('./fixtures');

const CONVERSATION_LENGTH = 20;
const VENUE = fixtures.venues[0]; // Default to first venue (e.g., Alchemist Bar)

async function runSimulation() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('Error: ANTHROPIC_API_KEY environment variable is required.');
    process.exit(1);
  }

  console.log('\n=================== STARTING THREAD SIMULATION ===================');
  console.log(`Venue:            ${VENUE.name}`);
  console.log(`Thread Length:    ${CONVERSATION_LENGTH} messages`);
  console.log(`Daypart override: ${fixtures.overrideDaypart || 'night (default)'}`);
  console.log('==================================================================\n');

  const conversation = [];
  let lastPersonaId = null;

  for (let t = 0; t < CONVERSATION_LENGTH; t++) {
    // 1. Select persona (avoid selecting the same persona twice in a row)
    let personaPool = fixtures.personas;
    if (lastPersonaId !== null) {
      personaPool = fixtures.personas.filter(p => p.id !== lastPersonaId);
    }
    const persona = personaPool[Math.floor(Math.random() * personaPool.length)];
    lastPersonaId = persona.id;

    // 2. Format last 5 messages as context (matching fetchLast5ChatMessages formatting)
    const historyText = conversation.slice(-5)
      .map(msg => `${msg.username}: ${msg.text}`)
      .join('\n') || 'No recent messages.';

    // 3. Resolve daypart
    const daypart = fixtures.overrideDaypart || 'night';

    const context = {
      variant: 'ambient',
      persona,
      venueName: VENUE.name,
      history: historyText,
      daypart,
      apiKey
    };

    try {
      const messageText = await generateMessage(context);
      
      // Print message in order immediately
      console.log(`[${t + 1}/${CONVERSATION_LENGTH}] @${persona.username} (${persona.name} - ${persona.type}):`);
      console.log(`  -> "${messageText}"\n`);
      
      conversation.push({
        username: persona.username,
        text: messageText
      });
    } catch (err) {
      console.error(`[${t + 1}/${CONVERSATION_LENGTH}] @${persona.username} failed: ${err.message}\n`);
    }

    // Add a small delay between calls to simulate reading time and avoid burst rate limit issues
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  console.log('=================== SIMULATED CONVERSATION ===================');
  conversation.forEach((msg, idx) => {
    console.log(`${String(idx + 1).padStart(2, '0')}. @${msg.username}: ${msg.text}`);
  });
  console.log('==============================================================\n');
}

runSimulation().catch((err) => {
  console.error('Simulation crashed:', err);
  process.exit(1);
});
