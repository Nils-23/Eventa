/**
 * scripts/harness.js
 * Tier 1 Batch Test Harness
 * Usage: ANTHROPIC_API_KEY=your_key node scripts/harness.js
 */

const { generateMessage } = require('../functions/generator');
const { report } = require('../persona_metrics');
const fixtures = require('./fixtures');

// --- Configuration Constants ---
const MODEL = 'claude-haiku-4-5';
const TEMPERATURE = 1.0;
const SAMPLE_SIZE = process.env.SAMPLE_SIZE ? parseInt(process.env.SAMPLE_SIZE, 10) : 150;
const RNG_SEED = 12345;

// --- Seeded RNG Helper for reproducibility ---
function seedRandom(seed) {
  return function() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

if (RNG_SEED !== null && RNG_SEED !== undefined) {
  console.log(`[Harness] Seeding Math.random with: ${RNG_SEED}`);
  Math.random = seedRandom(RNG_SEED);
}

async function runHarness() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('Error: ANTHROPIC_API_KEY environment variable is required.');
    process.exit(1);
  }

  console.log('\n=================== STARTING BATCH HARNESS ===================');
  console.log(`Model:        ${MODEL}`);
  console.log(`Temperature:  ${TEMPERATURE}`);
  console.log(`Sample Size:  ${SAMPLE_SIZE}`);
  console.log(`Daypart override: ${fixtures.overrideDaypart || 'None (rotating)'}`);
  console.log('==============================================================\n');

  const generatedMessages = [];
  const variants = ['ambient', 'dm', 'reaction'];

  for (let i = 0; i < SAMPLE_SIZE; i++) {
    const variant = variants[i % variants.length];
    const persona = fixtures.personas[i % fixtures.personas.length];
    const venue = fixtures.venues[i % fixtures.venues.length];
    const historyObj = fixtures.histories[i % fixtures.histories.length];
    const daypart = fixtures.overrideDaypart || fixtures.dayparts[i % fixtures.dayparts.length];

    const context = {
      variant,
      persona,
      venueName: venue.name,
      history: historyObj.text,
      daypart,
      model: MODEL,
      temperature: TEMPERATURE,
      apiKey,
      
      // Additional synthetic context properties for dm and reaction variants
      senderName: 'VibeGoer',
      senderMessage: 'Yo, is this place packed tonight?',
      reactingName: 'VibeGoer',
      reactionEmoji: '🔥',
      originalMessage: 'Vibes here are crazy!'
    };

    const label = `[${i + 1}/${SAMPLE_SIZE}] @${persona.username} at ${venue.name} (${daypart}, ${variant})`;
    console.log(`${label}...`);

    try {
      const messageText = await generateMessage(context);
      console.log(`  -> "${messageText}"\n`);
      generatedMessages.push(messageText);
    } catch (err) {
      console.error(`  -> Failed: ${err.message}\n`);
    }
  }

  console.log('Batch run complete. Running metrics report...');
  report(generatedMessages);
}

runHarness().catch((err) => {
  console.error('Fatal harness error:', err);
  process.exit(1);
});
