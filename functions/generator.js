const fetch = require('node-fetch');

// --- Persona Prompt Helpers ---
// --- Opener Tracking State ---
const recentOpenersByVenue = {};
const globalOpenersList = [];
const globalOpenerCounts = {};

// --- Emoji Tracking State ---
const globalEmojiCounts = {
  '😂': 0,
  '💀': 0,
  '😭': 0,
  '🥹': 0,
  '👀': 0
};

function getToneFromMessage(text) {
  const clean = text.toLowerCase();
  
  // 1. Curious / Shady (questions, sus, where, etc. - remove 'ati' to prevent 👀 overload)
  if (clean.includes('?') || clean.includes('sus') || clean.includes('shady') || clean.includes('who') || clean.includes('why') || clean.includes('where') || clean.includes('what') || clean.includes('how')) {
    return 'curious';
  }

  // 2. Savage / Extremely Funny (cooked, crash out, took the L, wild, savage, dead)
  if (clean.includes('cooked') || clean.includes('crash out') || clean.includes('took the l') || clean.includes('savage') || clean.includes('wild') || clean.includes('dead')) {
    return 'savage';
  }

  // 3. Wholesome / Emotional (woiye, woi, aki, love, cute, wholesome, sweet, pure, safe, happy)
  if (clean.includes('woiye') || clean.includes('woi') || clean.includes('aki') || clean.includes('love') || clean.includes('cute') || clean.includes('pure') || clean.includes('wholesome') || clean.includes('safe') || clean.includes('happy') || clean.includes('aww')) {
    return 'wholesome';
  }

  // 4. Overwhelmed (wueh, weuh, ate, slay, scream, surely, fire, mid, etc.)
  if (clean.includes('wueh') || clean.includes('weuh') || clean.includes('surely') || clean.includes('ate') || clean.includes('slay') || clean.includes('omg') || clean.includes('fire') || clean.includes('literally') || clean.includes('screaming') || clean.includes('mid') || clean.includes('no crumbs')) {
    return 'overwhelmed';
  }

  // 5. Funny / Banter (haha, funny, lol, lmao, joke, tease, bro, buda, fam, boss)
  if (clean.includes('haha') || clean.includes('funny') || clean.includes('lol') || clean.includes('lmao') || clean.includes('joke') || clean.includes('tease') || clean.includes('bro') || clean.includes('buda') || clean.includes('fam') || clean.includes('boss')) {
    return 'funny';
  }

  return null; // Return null to trigger balancing fallback
}

// --- Opener Verification Helper ---
function getCleanedFirstWord(text, username, personaName) {
  if (!text) return '';
  const emojiRegex = /[\uD800-\uDBFF][\uDC00-\uDFFF]|\p{Emoji_Presentation}|\p{Emoji_Modifier_Base}|\p{Emoji_Component}/gu;
  let cleaned = text.replace(emojiRegex, '').replace(/\s+/g, ' ').trim();
  
  if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  if (cleaned.startsWith("'") && cleaned.endsWith("'")) {
    cleaned = cleaned.slice(1, -1).trim();
  }

  const prefixes = [
    username + ':',
    '@' + username + ':',
    personaName + ':',
    '@' + personaName + ':',
    username + ' -',
    personaName + ' -'
  ];

  for (const prefix of prefixes) {
    if (cleaned.toLowerCase().startsWith(prefix.toLowerCase())) {
      cleaned = cleaned.substring(prefix.length).trim();
      break;
    }
  }

  const colonMatch = cleaned.match(/^@?[\w\.\-]{2,20}\s*:\s*/i);
  if (colonMatch) {
    cleaned = cleaned.substring(colonMatch[0].length).trim();
  }

  if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  if (cleaned.startsWith("'") && cleaned.endsWith("'")) {
    cleaned = cleaned.slice(1, -1).trim();
  }

  cleaned = cleaned.replace(/[\r\n]+/g, ' ').trim();
  
  const words = cleaned.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'!]/g, ' ').trim().split(/\s+/);
  return words[0] || '';
}

const GLOBAL_SLANG = ['fire', 'mid', 'ate', 'no cap', 'fr', 'lowkey', 'highkey', 'slay', 'cooked', 'sheesh', 'locked in', 'pull up', 'iykyk', 'sus', "it's giving", "that's so real", "not me", "the way"];
const KENYAN_MARKERS = ['wueh', 'ati', 'surely', 'woiye', 'aki', 'buda', 'boss', 'fam', 'bruv', 'kindly', 'imagine'];

function sampleFrom(arr, n) {
  const copy = [...arr];
  const out = [];
  while (out.length < n && copy.length > 0) {
    out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
  }
  return out;
}

// Most messages carry zero slang; the rest carry exactly one item.
// A slang budget, not a quota — stacked slang is what reads as botty.
function rollLanguageMode() {
  return Math.random() < 0.55 ? 'plain' : 'one_item';
}

function rollEmoji() {
  return Math.random() > 0.5;
}

const WEEKDAY_ENERGY = {
  Mon: `It is a Monday night — most people have work tomorrow. The mood is a quiet weeknight: relaxed drinks, catching up, winding down early. Nobody is raving. Do NOT talk like it is a big party night.`,
  Tue: `It is a Tuesday night — a slow weeknight. People are out for chill drinks and conversation, not a party. Keep the energy low-key and do NOT talk like it is a weekend.`,
  Wed: `It is a Wednesday — midweek. A few after-work drinks, easy conversation, nothing wild. Do NOT talk like it is a weekend night out.`,
  Thu: `It is a Thursday — the warm-up night. Decent energy, people easing into the weekend, but most are still holding back for Friday.`,
  Fri: `It is Friday night — the weekend has started and the energy is high.`,
  Sat: `It is Saturday night — the biggest night out of the week.`,
  Sun: `It is a Sunday — wind-down vibes. People are out for a chilled last drink, already thinking about Monday. Do NOT talk like it is a big party night.`
};

// Daytime variant for non-nightlife venues (parks, museums, karting, markets…):
// the energy is about the DAY, not the night out.
const DAYTIME_ENERGY = {
  Mon: `It is a Monday during the day — most people are at work. Being here feels like a stolen break: a walk, some air, an errand turned outing. Keep it calm and unhurried. Do NOT talk about partying or tonight.`,
  Tue: `It is a Tuesday during the day — a quiet weekday. You are taking a breather from the week: a walk, a visit, some time out. Low-key, wholesome energy. Do NOT talk about partying.`,
  Wed: `It is a Wednesday during the day — midweek escape energy. A quick outing to reset before the rest of the week. Calm and easy. Do NOT talk about nightlife.`,
  Thu: `It is a Thursday during the day — a relaxed weekday outing. Some people are already daydreaming about the weekend. Keep it light and unhurried.`,
  Fri: `It is Friday during the day — the weekend is close and moods are lifting. A relaxed outing before the weekend properly starts.`,
  Sat: `It is Saturday during the day — prime outing time. Families, groups of friends, dates. The place is at its liveliest. Good energy, but it is a DAY out, not a party.`,
  Sun: `It is Sunday during the day — easy, slow weekend energy. People are out with family or friends, stretching the weekend before Monday. Warm and unhurried.`
};

// Nightlife venues (bars, sports bars) are often alive during the day too —
// lunch, a match, afternoon drinks. The night framing must never leak there:
// nobody says "tonight is going crazy" at 2pm.
const NIGHTLIFE_DAY_ENERGY =
  `It is DAYTIME right now — an easy afternoon at the spot: food, a drink, a match on the screens, catching up. ` +
  `It is NOT a night out. NEVER say "tonight" as if the night is already happening, and do NOT talk about the DJ going off or the dance floor. ` +
  `If the night comes up at all, it is a plan for LATER.`;

// Parse the hour out of a "Fri at 2PM" style string. Returns 0-23 or null.
function parseHourFromDayAndTime(dayAndTime) {
  const m = (dayAndTime || '').match(/at\s+(\d{1,2})\s*(AM|PM)/i);
  if (!m) return null;
  let h = parseInt(m[1], 10) % 12;
  if (m[2].toUpperCase() === 'PM') h += 12;
  return h;
}

function isDaytimeHour(dayAndTime) {
  const h = parseHourFromDayAndTime(dayAndTime);
  return h !== null && h >= 6 && h < 18;
}

// Card venues that are open in the EVENING (restaurants at dinner) must not be
// told "it is during the day" — but they're still not a night out.
const CARD_EVENING_ENERGY =
  `It is the evening — dinner / winding-down energy at a calm spot. ` +
  `People are eating, talking, relaxing after the day. It is NOT a party and there is no nightlife here — keep it warm and low-key.`;

function getEnergyInstruction(dayAndTime, dayCard = null, isDay = false) {
  const wd = (dayAndTime || '').trim().slice(0, 3);
  if (dayCard) {
    if (!isDay) return `\nTHIS EVENING'S ENERGY: ${CARD_EVENING_ENERGY}\n`;
    const energy = DAYTIME_ENERGY[wd];
    return energy ? `\nTODAY'S ENERGY: ${energy}\n` : '';
  }
  if (isDay) {
    return `\nRIGHT NOW: ${NIGHTLIFE_DAY_ENERGY}\n`;
  }
  const energy = WEEKDAY_ENERGY[wd];
  return energy ? `\nTONIGHT'S ENERGY: ${energy}\n` : '';
}

// ─── Venue context cards ─────────────────────────────────────────────────────
// One card per non-nightlife venue profile (profiles are inferred per venue by
// crowdSimulation.js's inferProfileKey and persisted as venue.venueProfile).
// The card tells the prompt what this KIND of place is, what people naturally
// mention there, and — critically — what does NOT exist there, so nightlife
// slang never bleeds into a museum chat. Nightlife profiles have no card and
// fall through to the existing club/bar prompt framing.
const VENUE_CONTEXT_CARDS = {
  outdoor: {
    setting: 'an outdoor nature spot — park, forest, garden or trails',
    doing: 'walking, picnicking, taking photos, getting fresh air',
    topics: 'the weather, the walk or trail, monkeys/birds/animals around, photos, what food people carried, entrance fees, who they came with',
    avoid: 'There is NO DJ, NO music, NO dance floor, NO drinks specials, NO bouncer here. Never talk about partying, raving, or "tonight going crazy".',
  },
  adventure: {
    setting: 'an activity venue — karting, paintball, climbing, ziplining or similar',
    doing: 'doing the activity, waiting for your turn, recovering from a round',
    topics: 'how the activity went, lap times or scores, losing to a friend, whether it is worth the price, sore arms, queues for the next round',
    avoid: 'There is NO DJ, NO dance floor, NO bottle service here. This is a daytime activity, not a night out — never talk about partying.',
  },
  museum: {
    setting: 'a museum or heritage site',
    doing: 'walking through exhibits, reading placards, taking a few photos',
    topics: 'an exhibit that surprised you, how quiet it is, the entrance fee, a school group passing through, what to see next',
    avoid: 'There is NO music, NO DJ, NO drinks here. Keep the register calm and curious — never party talk.',
  },
  art_gallery: {
    setting: 'an art gallery or creative space',
    doing: 'looking at pieces, wandering slowly, maybe chatting to the artist',
    topics: 'a piece you liked or did not get, prices, the artist, the space itself, who else is around',
    avoid: 'There is NO DJ, NO dancing, NO drinks specials. Calm, curious, slightly artsy register — never nightlife talk.',
  },
  cinema: {
    setting: 'a cinema',
    doing: 'waiting for a movie, just out of a screening, getting popcorn',
    topics: 'the movie (no spoilers), trailers, popcorn prices, which screening people are catching, whether it is full',
    avoid: 'There is NO DJ and NO party here. Never describe it like a night out.',
  },
  arcade_games: {
    setting: 'a games venue — arcade, bowling, pool or VR',
    doing: 'playing, queueing for a lane or machine, watching friends play',
    topics: 'scores, winning or losing badly, which game is busy, rematch demands, snacks',
    avoid: 'There is NO DJ, NO dance floor. Competitive and playful, not party energy.',
  },
  wellness: {
    setting: 'a wellness spot — spa, yoga or similar',
    doing: 'a session, just finished a class, deeply relaxed',
    topics: 'how relaxed you feel, the class or treatment, sore muscles, needing this after the week',
    avoid: 'There is NO music event, NO drinks, NO party. Calm, restored, quiet register.',
  },
  market: {
    setting: 'a market or pop-up — stalls, thrifting, food vendors',
    doing: 'browsing stalls, bargaining, hunting for finds, eating street food',
    topics: 'what you found, prices and bargaining wins, a stall worth checking, the crowds, the food',
    avoid: 'There is NO DJ set and NO dance floor. It is a daytime browse, not a night out.',
  },
  generic_activity: {
    setting: 'a daytime activity venue',
    doing: 'doing the activity, hanging out, taking a break from the week',
    topics: 'the place itself, how the visit is going, prices, who came along, plans for the rest of the day',
    avoid: 'There is NO DJ, NO dance floor, NO drinks specials. This is a daytime outing — never talk like it is a night out.',
  },
  generic_event: {
    setting: 'a daytime event or festival',
    doing: 'attending the event, moving between spots, taking it in',
    topics: 'the event itself, the crowd, food and stalls, who is performing or showing, whether it was worth coming',
    avoid: 'Unless the event is clearly a night party, keep it daytime-event energy — never club talk.',
  },
  generic_unknown: {
    setting: 'a local spot',
    doing: 'hanging out, passing time',
    topics: 'the place, the day, who is around',
    avoid: 'Do NOT assume there is a DJ, dance floor, or party here. Keep it neutral and low-key.',
  },
  restaurant: {
    setting: 'a restaurant',
    doing: 'eating, waiting for food, deciding what to order',
    topics: 'what you ordered, what is worth ordering, portion sizes, prices, how long the food took, the service, who you came with',
    avoid: 'There is NO DJ, NO dance floor, NO bouncer here. It is a meal, not a night out — never party talk.',
  },
  cafe: {
    setting: 'a café or coffee spot',
    doing: 'having coffee or a pastry, working on a laptop, catching up with someone',
    topics: 'the coffee, the pastries or breakfast, the wifi, prices, how good it is for working, the noise level',
    avoid: 'There is NO DJ, NO drinks specials, NO party here. Calm café register — never nightlife talk.',
  },
  generic_food: {
    setting: 'a food spot',
    doing: 'eating or about to order',
    topics: 'the food, prices, what to order, the service, the space',
    avoid: 'There is NO DJ and NO party here. It is about the food — never nightlife talk.',
  },
};

function getVenueContextCard(profileKey) {
  if (!profileKey) return null;
  return VENUE_CONTEXT_CARDS[profileKey] || null;
}

function buildVenueContextInstruction(dayCard, venueName, venueDescription) {
  if (!dayCard) return '';
  const desc = venueDescription && venueDescription.trim()
    ? `About this specific place: "${venueDescription.trim().slice(0, 200)}"\n`
    : '';
  return (
    `\nVENUE CONTEXT — READ CAREFULLY:\n` +
    `${venueName} is ${dayCard.setting}. People here are ${dayCard.doing}.\n` +
    desc +
    `Natural things to mention: ${dayCard.topics}.\n` +
    `CRITICAL: ${dayCard.avoid}\n`
  );
}

// ─── Nightly verdicts ────────────────────────────────────────────────────────
// Every persona holds a seeded per-(persona, venue, night) OPINION of the
// place with a concrete reason. Deterministic, so the same persona defends the
// same view all night, and two cast members with clashing verdicts argue
// organically with zero coordination. This is what turns "people stating facts
// near each other" into a conversation with stakes.
// Reasons deliberately avoid crowd-size claims (the crowd instruction owns those).

function verdictUnit(str) {
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

const VERDICT_REASONS = {
  night: {
    enjoying: [
      'the music selection is genuinely good tonight',
      'the drinks are fairly priced for once',
      'the food here is lowkey excellent',
      'the sound system finally sounds right',
      'the playlist keeps landing songs you forgot you loved',
      'the outside/balcony section is the best seat in town',
    ],
    unimpressed: [
      'the DJ keeps switching genres with no flow',
      'the drinks are overpriced for what they are',
      'service is painfully slow tonight',
      'they keep playing the same songs as last time',
      'the music is too loud to even talk',
      'the food took forever and came out cold',
    ],
    undecided: [
      'the night could go either way, still early to judge',
      'something feels a bit off today but you cannot name it',
      'you keep comparing it to a better night you had elsewhere',
    ],
  },
  day: {
    enjoying: [
      'it is worth every shilling of the entrance fee',
      'the weather is cooperating perfectly',
      'it is peaceful in the best way',
      'the photos are coming out great',
      'the food/snack options are surprisingly decent',
    ],
    unimpressed: [
      'the entrance fee feels steep for what you get',
      'the queues are eating into the day',
      'the facilities could use some work',
      'it is smaller than the photos made it look',
    ],
    undecided: [
      'you have not decided if it was worth the trip yet',
      'it is nice but you expected a bit more',
    ],
  },
};

function getNightlyVerdict(personaId, venueId, nightSeed, isDaytime) {
  const roll = verdictUnit(`${nightSeed}|${venueId}|${personaId}|verdict`);
  let verdict;
  if (roll < 0.55) verdict = 'enjoying';
  else if (roll < 0.8) verdict = 'unimpressed';
  else verdict = 'undecided';
  const pool = VERDICT_REASONS[isDaytime ? 'day' : 'night'][verdict];
  const reason = pool[Math.floor(verdictUnit(`${nightSeed}|${venueId}|${personaId}|reason`) * pool.length)];
  return { verdict, reason };
}

function buildVerdictInstruction(verdict, venueName, isDay = false) {
  const when = isDay ? 'TODAY' : 'TONIGHT';
  const span = isDay ? 'all day' : 'all night';
  if (verdict.verdict === 'enjoying') {
    return `\nYOUR OPINION OF ${venueName} ${when}: you're enjoying it — ${verdict.reason}. ` +
      `Hold this view. If someone trashes the place, push back casually with your reason.\n`;
  }
  if (verdict.verdict === 'unimpressed') {
    return `\nYOUR OPINION OF ${venueName} ${when}: you're not impressed — ${verdict.reason}. ` +
      `Hold this view ${span}. Do NOT flip to agreement if others hype the place — push back lightly, tease, or bring up your gripe. Stay friendly, never hostile.\n`;
  }
  return `\nYOUR OPINION OF ${venueName} ${when}: undecided — ${verdict.reason}. ` +
    `You can be swayed, but ask or observe before committing to hype or complaints.\n`;
}

// ─── Concrete-detail anchoring ───────────────────────────────────────────────
// The #1 blandness driver is abstract register ("the vibe", "the energy").
// Every prompt gets 3 concrete hooks and an anchor rule. Hooks are SEEDED per
// (venue, night): each venue pushes its own 3 details all night instead of
// every venue in town sampling the same pool and converging on the same talk
// (the "queues at every venue" failure). Within a venue, the forbidden-words
// mechanism already stops any one hook from being repeated to death.
const NIGHTLIFE_DETAIL_POOL = [
  'a specific song or genre the DJ just played',
  'the fries / nyama / wings',
  'the queue at the bar counter',
  'the pool table',
  'what drinks cost here',
  'the balcony or outside section',
  'the football match on the screens',
  'the bathroom line',
  'parking or how you got here',
  'someone\'s outfit (kindly)',
  'the AC or the heat inside',
];

// Day version for bars/sports bars in the afternoon — no DJ, no bathroom line.
const NIGHTLIFE_DAY_DETAIL_POOL = [
  'the fries / nyama / wings',
  'what drinks cost here',
  'the football match on the screens',
  'the pool table',
  'the balcony or outside section',
  'how chill it is compared to nights',
  'parking or how you got here',
  'the music playing low in the background',
  'the lunch crowd around you',
];

function seededSampleFrom(arr, n, seedKey) {
  if (!seedKey) return sampleFrom(arr, n);
  const copy = [...arr];
  const out = [];
  let i = 0;
  while (out.length < n && copy.length > 0) {
    const idx = Math.floor(verdictUnit(`${seedKey}|${i++}`) * copy.length);
    out.push(copy.splice(idx, 1)[0]);
  }
  return out;
}

function buildDetailInstruction(dayCard, isDay = false, seedKey = null) {
  let hooks;
  if (dayCard) {
    // Sample 3 of the card's topics instead of pasting all of them — otherwise
    // every venue with this profile pushes the identical topic list every time.
    const topicParts = dayCard.topics.split(',').map((t) => t.trim()).filter(Boolean);
    hooks = seededSampleFrom(topicParts, Math.min(3, topicParts.length), seedKey).join(', ');
  } else {
    const pool = isDay ? NIGHTLIFE_DAY_DETAIL_POOL : NIGHTLIFE_DETAIL_POOL;
    hooks = seededSampleFrom(pool, 3, seedKey).join(', ');
  }
  return `\nSPECIFICS RULE: if you mention the place, anchor it in ONE concrete detail (e.g. ${hooks}) — never just "the vibe" or "the energy".\n`;
}

// ─── Life-topic range ────────────────────────────────────────────────────────
// Personas post RARELY (they're seasoning, not the app's content engine), so
// each post should feel like a person with a whole life outside this venue.
// Two "on your mind today" topics are seeded per (persona, day): stable for
// the persona through the day, different across personas — so the same night
// one person is on about the football and another about the rain, instead of
// everyone reviewing the venue.
const LIFE_TOPIC_POOL = [
  'the football this week (a match, a result that hurt, this weekend\'s fixtures)',
  'a new song or album everyone is playing right now',
  'a series or movie people are talking about (no spoilers)',
  'Nairobi traffic today',
  'the weather (rain out of nowhere, the cold season, the heat)',
  'work or campus stress this week',
  'payday feeling far / the price of things lately',
  'a side hustle you are trying to get going',
  'gym / trying to stay fit',
  'a funny matatu or boda moment from today',
  'plans for the weekend (or recovering from it)',
  'a family function you attended or are dodging',
  'phone battery / data bundle struggles',
  'food — a spot you tried recently or have been meaning to try',
  'sleep debt / how long this week is dragging',
];

function buildLifeTopicInstruction(seedKey) {
  const topics = seededSampleFrom(LIFE_TOPIC_POOL, 2, seedKey);
  return `\nON YOUR MIND TODAY (beyond this venue): ${topics.join('; ')}. ` +
    `When the intent calls for life talk or a tangent, draw on ONE of these or your own interests — not the venue again.\n`;
}

// ─── Message shape variance ──────────────────────────────────────────────────
// Real chats mix one-word reactions, statements, and questions. Without this,
// every message is the same 8-word appraisal sentence.
function rollMessageShape(isOpener) {
  const r = Math.random();
  if (!isOpener && r < 0.1) return 'one_word';
  if (r < 0.65) return 'short';
  if (r < 0.85) return 'two_thought';
  return 'question';
}

const SHAPE_INSTRUCTIONS = {
  one_word: `\nSHAPE: this message is a tiny reaction — 1 to 3 words max.\n`,
  short: '',
  two_thought: `\nSHAPE: this message can carry two short connected thoughts (still one line, up to ~16 words).\n`,
  question: `\nSHAPE: end this message by asking the group something related — pull people in.\n`,
};

function isWeeknightVibe(dayAndTime) {
  const wd = (dayAndTime || '').trim().slice(0, 3);
  return ['Mon', 'Tue', 'Wed', 'Sun'].includes(wd);
}

// Rotating example pool — Haiku imitates examples far more than rules, so the
// registers here must cover quiet nights, genuine questions, and fragments,
// not just party talk. 4 are sampled per prompt. Examples marked directed:true
// address people mid-conversation and are excluded when opening an empty chat.
const EXAMPLE_POOL = [
  { text: `"wueh the DJ ate"` },
  { text: `"me I'm not leaving the house for mid music"` },
  { text: `"ati entry is how much"` },
  { text: `"anyone else here or is it just me"` },
  { text: `"this week has been long, I needed this"` },
  { text: `"first time here, is it always like this?"`, directed: true },
  { text: `"the fries here are actually good"` },
  { text: `"lol same"`, directed: true },
  { text: `"who's watching the match tomorrow"` },
  { text: `"traffic on waiyaki way was mad, just got here"` },
  { text: `"it's quiet but the music is decent"` },
  { text: `"work tomorrow is going to hurt"` },
  { text: `"you guys from around here?"`, directed: true },
  { text: `"they played my song and I wasn't ready"` },
  { text: `"kinda dead rn but it might pick up"` },
  { text: `"arsenal stressed me the whole weekend"` },
  { text: `"this rain came out of nowhere"` },
  { text: `"that new episode was wild, no spoilers"` },
  { text: `"payday needs to hurry up"` }
];

// Daytime register examples for activity venues — same texting style, but the
// subject matter is a day out, not a night out.
const DAYTIME_EXAMPLE_POOL = [
  { text: `"the weather held up, we lucked out"` },
  { text: `"ati entry is how much"` },
  { text: `"needed this break honestly"` },
  { text: `"anyone know if the food stalls are open"` },
  { text: `"came for one hour, been here three"` },
  { text: `"first time here, worth it?"`, directed: true },
  { text: `"my legs are finished after that trail"` },
  { text: `"lol same"`, directed: true },
  { text: `"the queue moves fast dont worry"` },
  { text: `"traffic on waiyaki way was mad, just got here"` },
  { text: `"it's quiet today, kinda nice"` },
  { text: `"skipping work emails to be here, no regrets"` },
  { text: `"you guys came as a group?"`, directed: true },
  { text: `"photos are not doing this place justice"` },
];

// Register examples for a bar/sports-bar during the DAY — the texting style is
// identical, but the subject is lunch, a match, an easy afternoon. Reusing the
// night pool here is what produced "the DJ ate" texts at 2pm.
const NIGHTLIFE_DAY_EXAMPLE_POOL = [
  { text: `"the fries here are actually good"` },
  { text: `"ati a beer is how much"` },
  { text: `"quiet afternoon in here, kinda nice"` },
  { text: `"who's watching the match later"` },
  { text: `"needed to get out of the house honestly"` },
  { text: `"long lunch, don't tell my boss"` },
  { text: `"first time here, worth coming back at night?"`, directed: true },
  { text: `"lol same"`, directed: true },
  { text: `"traffic on waiyaki way was mad, just got here"` },
  { text: `"they have the game on, sorted"` },
];

const getBaseStyle = (venueName, isOpener = false, dayCard = null, isDay = false) => {
  const basePool = dayCard
    ? DAYTIME_EXAMPLE_POOL
    : (isDay ? NIGHTLIFE_DAY_EXAMPLE_POOL : EXAMPLE_POOL);
  const pool = isOpener ? basePool.filter(e => !e.directed) : basePool;
  return (
    ((dayCard || isDay)
      ? `You are a young Nairobi local texting in the ${venueName} group chat on a social outings app. `
      : `You are a young Nairobi socialite texting in the ${venueName} group chat on a nightlife app. `) +
    `You must write EXACTLY like young Kenyan Gen Z text online. ` +
    `Use natural English texting style (lowercase, brief, relaxed). ` +
    `\n\nSTYLE RULES:\n` +
    `- Most real texts have NO slang at all — just say the thing plainly. NEVER use more than one slang word or Kenyan marker in a message, and never stack two together.\n` +
    `- Do NOT use retired Sheng words (do NOT say: fiti, noma, poa, moto, maze, sawa).\n` +
    `- Do NOT sound like a generic American TikToker.\n` +
    `\nEXAMPLES OF THE REGISTER (match the feel, do NOT copy or reuse these):\n` +
    sampleFrom(pool, 4).map(e => `- GOOD: ${e.text}\n`).join('') +
    `- BAD (slang stacked, too American): "no cap that's bussin fr fr"\n` +
    `- BAD (old Sheng register): "hii place iko fiti sana maze"\n`
  );
};

const getRules = (isOpener = false) =>
  `\nRULES: ` +
  `(1) Write ONE short text message — a single line, usually under 10 words. Very short is fine (${isOpener ? '"so quiet rn", "finally out"' : '"lol same", "facts"'}). NEVER write a paragraph or multiple sentences. It must be a finished thought — never stop mid-sentence. ` +
  `(2) No hashtags. (3) No line breaks. ` +
  `(4) Be extremely casual, like texting a friend. ` +
  `(5) Do NOT start with 'yo', 'yoo', 'ayo', 'bro', or 'buda'. Most messages should open mid-thought, with no greeting/filler word at all — just say the thing. ` +
  `(6) Do NOT start with 'facts', 'fr', 'real', 'same', or 'honestly', and avoid the word 'actually' — bots overuse these; real texters vary their entrances.\n`;

// Persona voice card: the stable texting identity stored on the persona doc.
// Same card every night → the same persona texts the same way next weekend.
function buildVoiceCard(voice) {
  if (!voice) return '';
  const lines = [];
  if (Array.isArray(voice.slang) && voice.slang.length > 0) {
    lines.push(`- Your go-to slang (the ONLY slang you ever use): ${voice.slang.map(s => `"${s}"`).join(', ')}.`);
  }
  if (voice.quirk) {
    lines.push(`- Your texting quirk: ${voice.quirk}.`);
  }
  if (Array.isArray(voice.interests) && voice.interests.length > 0) {
    lines.push(`- About you: ${voice.interests.join('; ')}. Bring these up only when it fits the conversation naturally.`);
  }
  if (lines.length === 0) return '';
  return `\nYOUR TEXTING IDENTITY (this is how YOU always text — stay consistent with it):\n${lines.join('\n')}\n`;
}

function enforceCeiling(text, username, personaName, intentType = 'default', history = '', voice = null) {
  return cleanPersonaMessageText(text, username, personaName, intentType, history, voice);
}

const personaStyles = {
  hype: `You hype the crowd. Short energy bursts reacting to right now.`,
  question: `You ask before committing. One genuine question — crowd, music, entry.`,
  opinion: `You give honest takes. Can be mixed or critical, not just hype.`,
  enthusiast: `You know events. Name a specific song, DJ, or compare to last week.`
};

function getLastEmojisFromHistory(history) {
  if (!history) return [];
  const emojiRegex = /[\uD800-\uDBFF][\uDC00-\uDFFF]|\p{Emoji_Presentation}|\p{Emoji_Modifier_Base}|\p{Emoji_Component}/gu;
  const emojis = [];
  const lines = history.split('\n').reverse();
  for (const line of lines) {
    const matches = line.match(emojiRegex);
    if (matches) {
      for (let i = matches.length - 1; i >= 0; i--) {
        const emo = matches[i];
        if (!emojis.includes(emo)) {
          emojis.push(emo);
          if (emojis.length >= 2) return emojis;
        }
      }
    }
  }
  return emojis;
}

function cleanDanglingEndings(text) {
  const connectors = new Set(['n', 'na', 'ni', 'tho', 'lakini', 'ama', 'like', 'and', 'or', 'for', 'kwa', 'ya', 'wa', 'the', 'to', 'in', 'at', 'a', 'of', 'with', 'on', 'up']);
  let cleaned = text.trim();
  
  let changed = true;
  while (changed) {
    changed = false;
    
    // Strip trailing punctuation (like commas, dashes, colons, semicolons, and spaces)
    const punctMatch = cleaned.match(/[\s,;:\-\–\—\.\!\?]+$/);
    if (punctMatch) {
      cleaned = cleaned.substring(0, cleaned.length - punctMatch[0].length).trim();
      changed = true;
    }
    
    // Check if the last word is in the set of connectors
    const words = cleaned.split(/\s+/);
    if (words.length > 0) {
      const lastWord = words[words.length - 1].toLowerCase();
      if (connectors.has(lastWord)) {
        words.pop();
        cleaned = words.join(' ').trim();
        changed = true;
      }
    }
  }
  return cleaned;
}

function endsWithConnectorOrComma(text) {
  const connectors = new Set(['n', 'na', 'ni', 'tho', 'lakini', 'ama', 'like', 'and', 'or', 'for', 'kwa', 'ya', 'wa', 'the', 'to', 'in', 'at', 'a', 'of', 'with', 'on', 'up']);
  const trimmed = text.trim();
  
  if (trimmed.endsWith(',')) {
    return true;
  }
  
  const words = trimmed.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()!?]/g, "").trim().split(/\s+/);
  if (words.length > 0) {
    const lastWord = words[words.length - 1].toLowerCase();
    if (connectors.has(lastWord)) {
      return true;
    }
  }
  
  return false;
}

function cleanPersonaMessageText(text, username, personaName, intentType = 'default', history = '', voice = null) {
  if (!text) return '';

  // 1. Strip any emoji the model produced
  const emojiRegex = /[\uD800-\uDBFF][\uDC00-\uDFFF]|\p{Emoji_Presentation}|\p{Emoji_Modifier_Base}|\p{Emoji_Component}/gu;
  let cleaned = text.replace(emojiRegex, '').replace(/\s+/g, ' ').trim();
  
  // Remove surrounding quotes if they exist
  if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  if (cleaned.startsWith("'") && cleaned.endsWith("'")) {
    cleaned = cleaned.slice(1, -1).trim();
  }

  // Remove username prefixes
  const prefixes = [
    username + ':',
    '@' + username + ':',
    personaName + ':',
    '@' + personaName + ':',
    username + ' -',
    personaName + ' -'
  ];

  for (const prefix of prefixes) {
    if (cleaned.toLowerCase().startsWith(prefix.toLowerCase())) {
      cleaned = cleaned.substring(prefix.length).trim();
      break;
    }
  }

  // Double check if there is any generic "Name:" or "@Name:" pattern at the beginning (up to 20 chars)
  const colonMatch = cleaned.match(/^@?[\w\.\-]{2,20}\s*:\s*/i);
  if (colonMatch) {
    cleaned = cleaned.substring(colonMatch[0].length).trim();
  }

  // Strip quotes again in case they were inside the prefix
  if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  if (cleaned.startsWith("'") && cleaned.endsWith("'")) {
    cleaned = cleaned.slice(1, -1).trim();
  }

  // Remove any newlines or line breaks to keep it on a single line
  cleaned = cleaned.replace(/[\r\n]+/g, ' ').trim();

  // Safety filter to completely block/censor real user names
  const realNamePattern = /nilsakonkwa|nils/gi;
  cleaned = cleaned.replace(realNamePattern, 'buda');

  let body = cleaned;

  // Clean dangling endings (never cut mid-word or end on connector/comma).
  // No minimum length: short messages ("facts", "lol same") are the most
  // natural thing in a group chat — never pad them.
  body = cleanDanglingEndings(body);

  // 2. Append a reaction emoji according to the persona's own emoji habit,
  // so the same persona has the same emoji signature every night.
  if (voice && voice.emojiStyle) {
    body = appendVoiceEmoji(body, voice);
  } else {
    body = appendBalancedEmoji(body, history);
  }

  return body;
}

function appendVoiceEmoji(body, voice) {
  const style = voice.emojiStyle;
  if (style === 'none') return body;
  const freq = voice.emojiFreq !== undefined ? voice.emojiFreq : 0.25;
  if (Math.random() >= freq) return body;

  if ((style === 'signature' || style === 'stacked') && voice.signatureEmoji) {
    const emoji = style === 'stacked' ? voice.signatureEmoji + voice.signatureEmoji : voice.signatureEmoji;
    return `${body} ${emoji}`;
  }

  // 'rare' (or missing signature): tone-mapped pick
  const tone = getToneFromMessage(body);
  const toneEmojiMap = { funny: '😂', savage: '💀', overwhelmed: '😭', wholesome: '🥹', curious: '👀' };
  return `${body} ${tone ? toneEmojiMap[tone] : '😂'}`;
}

// Legacy fallback for personas without a voice card (~35% chance, globally balanced)
function appendBalancedEmoji(body, history) {
  if (Math.random() >= 0.35) return body;

  const tone = getToneFromMessage(body);
  const toneEmojiMap = {
    funny: '😂',
    savage: '💀',
    overwhelmed: '😭',
    wholesome: '🥹',
    curious: '👀'
  };

  const lastEmojis = getLastEmojisFromHistory(history);
  const allReactionEmojis = ['😂', '💀', '😭', '🥹', '👀'];

  let chosenEmoji = tone ? toneEmojiMap[tone] : null;

  if (!chosenEmoji || lastEmojis.includes(chosenEmoji)) {
    const filtered = allReactionEmojis.filter(emo => !lastEmojis.includes(emo));
    if (filtered.length > 0) {
      // Find the emoji in the filtered set with the lowest representation in globalEmojiCounts
      filtered.sort((a, b) => (globalEmojiCounts[a] || 0) - (globalEmojiCounts[b] || 0));
      chosenEmoji = filtered[0];
    } else {
      chosenEmoji = allReactionEmojis[0];
    }
  }

  // Update global stat count
  globalEmojiCounts[chosenEmoji] = (globalEmojiCounts[chosenEmoji] || 0) + 1;

  return `${body} ${chosenEmoji}`;
}

// Last line of defense against paragraphs: validated texts are already ≤50
// chars, but the fallback path (all retries failed) can carry anything the
// model produced. Trim to one clause, never mid-word.
function hardTrimToOneLine(text) {
  let t = text.replace(/[\r\n]+/g, ' ').trim();
  if ([...t].length <= 60) return t;
  const sentenceMatch = t.match(/^.{10,59}[.!?]/);
  if (sentenceMatch) return sentenceMatch[0];
  t = [...t].slice(0, 60).join('');
  const lastSpace = t.lastIndexOf(' ');
  if (lastSpace > 10) t = t.slice(0, lastSpace);
  return cleanDanglingEndings(t);
}

async function callAnthropicHaiku(apiKey, userPrompt, config = {}) {
  const model = config.model || 'claude-haiku-4-5';
  const maxTokens = 60;
  
  const bodyData = {
    model: model,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: userPrompt }],
  };

  if (config.temperature !== undefined) {
    bodyData.temperature = config.temperature;
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(bodyData),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Anthropic API error: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  if (data && data.content && data.content[0] && data.content[0].text) {
    return {
      text: data.content[0].text.trim(),
      stopReason: data.stop_reason
    };
  }
  throw new Error(`Unexpected Anthropic response: ${JSON.stringify(data)}`);
}

function getForbiddenTopicWord(history, exemptWords = []) {
  if (!history) return null;
  const exemptSet = new Set((exemptWords || []).map(w => w.toLowerCase()));
  
  const stopWords = new Set([
    'the', 'to', 'is', 'a', 'and', 'in', 'on', 'at', 'for', 'of', 'this', 'that', 'it', 
    'ni', 'na', 'n', 'ya', 'wa', 'kwa', 'i', 'you', 'we', 'they', 'me', 'my', 'your', 'our', 
    'he', 'she', 'him', 'her', 'was', 'were', 'are', 'am', 'be', 'have', 'has', 'had', 
    'do', 'does', 'did', 'go', 'went', 'gone', 'but', 'so', 'if', 'or', 'as', 'an', 'with',
    'here', 'there', 'just', 'got', 'now', 'tonight',
    'sana', 'noma', 'fiti', 'maze', 'buda', 'msee', 'vibe', 'vibes', 'hapa', 'leo',
    'wueh', 'weuh', 'ati', 'surely', 'woiye', 'woi', 'aki', 'kindly', 'imagine', 'fire', 'mid', 'slay', 'cooked', 'sus'
  ]);

  const wordCounts = {};
  const lines = history.split('\n');
  
  for (const line of lines) {
    let msgText = line;
    const colonIndex = line.indexOf(':');
    if (colonIndex !== -1) {
      msgText = line.substring(colonIndex + 1);
    }
    
    const words = msgText.toLowerCase()
      .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'!]/g, ' ')
      .split(/\s+/);
      
    for (const w of words) {
      const cleanW = w.trim();
      if (cleanW.length > 2 && !stopWords.has(cleanW) && !exemptSet.has(cleanW)) {
        wordCounts[cleanW] = (wordCounts[cleanW] || 0) + 1;
      }
    }
  }

  // Top 3 repeated content words — a single banned word let the chat converge
  // on synonyms of the same thought ("vibe" banned → "energy", "mood", …).
  return Object.entries(wordCounts)
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([w]) => w);
}

function getHandlesFromHistory(history) {
  if (!history) return [];
  const handles = new Set();
  const lines = history.split('\n');
  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex !== -1) {
      const username = line.substring(0, colonIndex).trim();
      if (username) {
        handles.add(`@${username}`);
      }
    }
  }
  return Array.from(handles);
}

// Weekend nights lean on venue talk and hype; weeknights lean on genuine
// conversation — icebreakers, life outside tonight, checking in on people.
const INTENTS = [
  { type:'venue_talk', wWeekend:3, wWeeknight:2, hint:'comment on the PLACE — the DJ/music, a drink, the lighting, the bathroom line, the bouncer. an observation, not a question.' },
  { type:'banter',     wWeekend:3, wWeeknight:2, hint:'tease/roast another person in the chat by @handle. playful, light.' },
  { type:'reply',      wWeekend:3, wWeeknight:3, hint:'react to the LAST message but you MAY pivot the topic — do not just repeat it.' },
  { type:'cosign',     wWeekend:2, wWeeknight:2, hint:'agree with what someone said — short and specific, echo the exact thing you agree with instead of a generic "facts".' },
  { type:'hype',       wWeekend:2, wWeeknight:1, hint:'react to the vibe, be specific. never just "its lit".' },
  { type:'tangent',    wWeekend:3, wWeeknight:2, hint:'slightly off-topic — hungry, traffic, an outfit, someone running late, one of the things on your mind today.' },
  { type:'question',   wWeekend:2, wWeeknight:2, hint:'ask something NOT about money/entry — what they think, where they are, who they came with.' },
  { type:'logistics',  wWeekend:1, wWeeknight:1, hint:'one practical detail. use SPARINGLY.' },
  { type:'icebreaker', wWeekend:1, wWeeknight:3, hint:'start a genuine conversation about the PEOPLE, not the venue — "first time here?", "you guys from around?", "who came solo?". friendly and real, no slang needed.',
    openerHint:'throw an open question into the empty chat, directed at no one specific — "anyone here yet?", "anyone been here before?". Do NOT talk as if people are already chatting with you.' },
  { type:'life_talk',  wWeekend:2, wWeeknight:4, hint:'talk about life outside tonight — the things on your mind today, work tomorrow, how the week is going, a match, a show, a new song, plans. draw on YOUR interests if you have them.' },
  { type:'check_in',   wWeekend:1, wWeeknight:2, hint:'genuinely ask how someone\'s night or week is going. warm and simple.',
    openerHint:'ask an open "how is everyone\'s night going" style question — light, aimed at no one specific.' },
  { type:'disagree',   wWeekend:2, wWeeknight:2, hint:'push back on the last opinion in the chat — you see it differently and say why in one casual line. light and friendly, never hostile. ground it in YOUR opinion of the place.' },
  { type:'hot_take',   wWeekend:2, wWeeknight:2, hint:'drop a mildly spicy opinion about the place (the music, the food, the prices, the layout) that invites pushback. own it, no hedging.',
    openerHint:'open the chat with a mildly spicy opinion about the place that invites reactions. own it.' },
];

// Personality types finally matter in ambient mode: each type multiplies the
// weights of the intents it naturally leans toward.
const PTYPE_INTENT_BOOST = {
  opinion:    { disagree: 3, hot_take: 3, venue_talk: 1.5 },
  question:   { question: 3, icebreaker: 2, check_in: 2 },
  hype:       { hype: 2.5, cosign: 2, banter: 1.5 },
  enthusiast: { life_talk: 2, tangent: 2, venue_talk: 1.5 },
};

async function generateMessage(context) {
  const { variant, persona, venueName, history, daypart } = context;
  
  const apiKey = context.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('Anthropic API key is not configured.');
  }

  // 1. Resolve dayAndTime / daypart first — intent weights and tonight's
  // energy both depend on which night of the week it actually is.
  const nowForDay = new Date();
  const currentWeekday = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'Africa/Nairobi' }).format(nowForDay);
  let dayAndTime = daypart;
  if (dayAndTime) {
    const dp = dayAndTime.toLowerCase();
    if (dp === 'morning') dayAndTime = `${currentWeekday} at 9AM`;
    else if (dp === 'afternoon') dayAndTime = `${currentWeekday} at 3PM`;
    else if (dp === 'evening') dayAndTime = `${currentWeekday} at 8PM`;
    else if (dp === 'night') dayAndTime = `${currentWeekday} at 11PM`;
  } else {
    // Nairobi hour, not server hour — Cloud Functions run in UTC (3h behind EAT).
    const nairobiHour = parseInt(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: 'Africa/Nairobi' }).format(nowForDay), 10) % 24;
    const hourLabel = nairobiHour > 12 ? `${nairobiHour - 12}PM` : nairobiHour === 12 ? '12PM' : nairobiHour === 0 ? '12AM' : `${nairobiHour}AM`;
    dayAndTime = `${currentWeekday} at ${hourLabel}`;
  }

  // Non-nightlife venues carry a context card that reframes the whole prompt
  // (daytime energy, venue-appropriate topics, explicit "no DJ here" negatives).
  const dayCard = getVenueContextCard(context.venueProfile);
  const venueContextInstruction = buildVenueContextInstruction(dayCard, venueName, context.venueDescription);

  // Daytime awareness: a nightlife venue (bar, sports bar) chatting at 2pm must
  // use a daytime register — no "tonight", no DJ, no dance floor.
  const isDay = isDaytimeHour(dayAndTime);

  const isWeeknight = isWeeknightVibe(dayAndTime);
  const energyInstruction = getEnergyInstruction(dayAndTime, dayCard, isDay);

  // 2. Sample one intent per generateMessage call, weighted for tonight.
  // Directed intents (reply/banter/cosign/disagree) need someone to respond to,
  // so they're excluded only when the chat is empty — ambient venues now get
  // real persona-to-persona conversation instead of standalone statements.
  const isHistoryEmpty = !history || history.trim() === '' || history.trim() === 'No recent messages.';
  const DIRECTED_INTENTS = ['reply', 'banter', 'cosign', 'disagree'];
  const availableIntents = isHistoryEmpty
    ? INTENTS.filter(i => !DIRECTED_INTENTS.includes(i.type))
    : INTENTS;

  // Personality type shapes which intents this persona gravitates to
  const typeRawEarly = persona.type || persona.personalityType || 'hype';
  let pTypeEarly = 'hype';
  if (typeRawEarly.includes('question')) pTypeEarly = 'question';
  else if (typeRawEarly.includes('opinion')) pTypeEarly = 'opinion';
  else if (typeRawEarly.includes('enthusiast')) pTypeEarly = 'enthusiast';
  const typeBoost = PTYPE_INTENT_BOOST[pTypeEarly] || {};

  const intentWeight = (i) => (isWeeknight ? i.wWeeknight : i.wWeekend) * (typeBoost[i.type] || 1);
  const totalWeight = availableIntents.reduce((sum, i) => sum + intentWeight(i), 0);
  let r = Math.random() * totalWeight;
  let sampledIntent = null;
  for (const intent of availableIntents) {
    r -= intentWeight(intent);
    if (r <= 0) {
      sampledIntent = intent;
      break;
    }
  }
  if (!sampledIntent) {
    sampledIntent = availableIntents[0];
  }

  const personaVoice = (persona && persona.voice) || null;
  const langMode = rollLanguageMode();

  let langInstruction = '';
  if (langMode === 'plain') {
    langInstruction = `\nFor THIS message: plain casual English texting — NO slang words and NO Kenyan markers this time, just say the thing like a normal text. Keep it extremely brief.\n`;
  } else {
    const slangOptions = (personaVoice && Array.isArray(personaVoice.slang) && personaVoice.slang.length > 0)
      ? personaVoice.slang
      : [...sampleFrom(KENYAN_MARKERS, 1), ...sampleFrom(GLOBAL_SLANG, 1)];
    langInstruction = `\nFor THIS message: casual English texting, weaving in AT MOST one slang item — one of YOUR words: ${slangOptions.map(s => `"${s}"`).join(' or ')}. Only if it fits naturally; never force it, never use two. Keep it extremely brief.\n`;
  }

  const emojiInstruction = (variant === 'ambient' || variant === 'ambient_seeding')
    ? `Do NOT use any emoji this time.\n`
    : `No emoji this time.\n`;

  // Ground the message in how busy the venue currently looks in the app,
  // so chat energy matches the crowd count users see on the map.
  let crowdInstruction = '';
  if (dayCard || isDay) {
    // Daytime venues: crowd wording is about people around, never dance floors.
    if (context.crowdLevel === 'packed') {
      crowdInstruction = `\nCROWD RIGHT NOW: ${venueName} is very busy today — lots of groups and families around. ` +
        `Your message can note how full it is (queues, finding a spot). NEVER describe it as quiet or dead, and NEVER as a party.\n`;
    } else if (context.crowdLevel === 'busy') {
      crowdInstruction = `\nCROWD RIGHT NOW: a decent number of people at ${venueName} today. ` +
        `Pleasantly busy — do NOT describe it as either packed or empty.\n`;
    } else if (context.crowdLevel === 'quiet') {
      crowdInstruction = `\nCROWD RIGHT NOW: ${venueName} is quiet today — only a few people around. ` +
        `That can be a good thing here (peaceful, no queues). Do NOT describe crowds.\n`;
    }
  } else if (context.crowdLevel === 'packed') {
    crowdInstruction = `\nCROWD RIGHT NOW: ${venueName} is PACKED — one of the busiest spots in town tonight. ` +
      `Your message can ride that energy (full dance floor, queue outside, hard to move). NEVER describe it as quiet or dead.\n`;
  } else if (context.crowdLevel === 'busy') {
    crowdInstruction = `\nCROWD RIGHT NOW: decent crowd at ${venueName}, steadily filling up. ` +
      `Good vibe but not madness — do NOT describe it as either packed wall-to-wall or empty.\n`;
  } else if (context.crowdLevel === 'quiet') {
    crowdInstruction = `\nCROWD RIGHT NOW: ${venueName} is still quiet — only a few people in. ` +
      `Keep the energy lowkey: early scouting, wondering who else is coming, waiting for it to fill up. Do NOT describe a packed party.\n`;
  }

  let prompt = '';
  const personaName = persona.name || 'EventGoer';
  const personaUsername = persona.username || 'EventGoer';

  // Map personality type for robust matching
  const typeRaw = persona.type || persona.personalityType || 'hype';
  let pType = 'hype';
  if (typeRaw.includes('hype')) pType = 'hype';
  else if (typeRaw.includes('question')) pType = 'question';
  else if (typeRaw.includes('opinion')) pType = 'opinion';
  else if (typeRaw.includes('enthusiast')) pType = 'enthusiast';

  // Construct intent instruction
  let intentInstruction = '';
  if (variant === 'ambient' || variant === 'ambient_seeding') {
    if (sampledIntent.type === 'reply') {
      let lastMessage = '';
      if (history) {
        const lines = history.trim().split('\n').filter(line => line.trim().length > 0);
        if (lines.length > 0) {
          const lastLine = lines[lines.length - 1];
          const colonIndex = lastLine.indexOf(':');
          if (colonIndex !== -1) {
            lastMessage = lastLine.substring(colonIndex + 1).trim();
          } else {
            lastMessage = lastLine.trim();
          }
        }
      }
      intentInstruction = `\nInstruction for this message: Respond directly to the last message by reacting to its actual content.\n` +
                          `The last message was: "${lastMessage}". Write a reply addressing that specific point.\n`;
    } else if (sampledIntent.type === 'banter') {
      // Banter only ever targets tonight's cast members — never real users.
      const castSet = new Set((context.castUsernames || []).map(u => `@${u}`));
      const handles = getHandlesFromHistory(history)
        .filter(h => h !== `@${personaUsername}` && (castSet.size === 0 || castSet.has(h)));
      if (handles.length > 0) {
        intentInstruction = `\nInstruction for this message: ${sampledIntent.hint} You can target one of these people: ${handles.join(', ')}.\n`;
      } else {
        // Nobody safe to tease — fall back to a tangent
        const tangent = INTENTS.find(i => i.type === 'tangent');
        intentInstruction = `\nInstruction for this message: ${tangent.hint}\n`;
      }
    } else if (sampledIntent.type === 'cosign') {
      const handles = getHandlesFromHistory(history).filter(h => h !== `@${personaUsername}`);
      let hint = sampledIntent.hint;
      if (handles.length > 0) {
        hint += ` Reference what ${handles.join(' or ')} said.`;
      }
      intentInstruction = `\nInstruction for this message: ${hint}\n`;
    } else {
      let hint = (isHistoryEmpty && sampledIntent.openerHint) ? sampledIntent.openerHint : sampledIntent.hint;
      // Daytime venues: the "comment on the PLACE" hint must draw from the
      // venue's own world, not the nightlife DJ/drinks/bouncer list.
      if (dayCard && sampledIntent.type === 'venue_talk') {
        hint = `comment on the PLACE — ${dayCard.topics}. an observation, not a question.`;
      }
      if (dayCard && sampledIntent.type === 'hype') {
        hint = 'react to how nice the place/day is, be specific. never generic.';
      }
      // Nightlife venue during the day: the default hints (DJ, bouncer,
      // dance floor) don't exist yet — swap in afternoon-appropriate ones.
      if (!dayCard && isDay && sampledIntent.type === 'venue_talk') {
        hint = 'comment on the PLACE — the food, what drinks cost, the match on the screens, the space itself. an observation, not a question.';
      }
      if (!dayCard && isDay && sampledIntent.type === 'hype') {
        hint = 'react to how nice the afternoon here is, be specific. never generic, never party talk.';
      }
      intentInstruction = `\nInstruction for this message: ${hint}\n`;
    }
  }

  const forbiddenWords = getForbiddenTopicWord(history, context.scenarioKeywords || []) || [];
  const topicNegationInstruction = forbiddenWords.length > 0
    ? `\nCRITICAL: Do NOT use these overused words from the chat: ${forbiddenWords.map(w => `"${w}"`).join(', ')}. Say something with different words and ideally a different angle.\n`
    : '';

  // Self-memory: never let a persona repeat their own recent thought
  // (history is already limited to fresh messages by fetchLast5ChatMessages).
  let ownLastInstruction = '';
  if (history && !isHistoryEmpty) {
    const ownLines = history.split('\n').filter(l => l.startsWith(`${personaUsername}:`));
    if (ownLines.length > 0) {
      const lastOwn = ownLines[ownLines.length - 1].slice(personaUsername.length + 1).trim();
      ownLastInstruction = `\nYOU ALREADY SAID: "${lastOwn}". Do NOT repeat that thought, wording, or topic — move to something new.\n`;
    }
  }

  // Nightly verdict: the persona's held opinion of this venue tonight.
  // Deep-scenario stances take precedence when present.
  let verdictInstruction = '';
  if (!(context.role && context.stance) && context.venueId && context.nightSeed) {
    const verdict = getNightlyVerdict(persona.id || personaUsername, context.venueId, context.nightSeed, !!dayCard || isDay);
    verdictInstruction = buildVerdictInstruction(verdict, venueName, isDay);
  }

  // Hooks seeded per (venue, night): stable within a venue's night, different
  // across venues — so the whole town doesn't talk about queues at once.
  const hookSeed = (context.venueId && context.nightSeed)
    ? `${context.nightSeed}|${context.venueId}|hooks`
    : null;
  const detailInstruction = buildDetailInstruction(dayCard, isDay, hookSeed);

  // Life topics seeded per (persona, day): every persona carries two non-venue
  // subjects, so the few posts they make range beyond reviewing the place.
  const lifeTopicInstruction = buildLifeTopicInstruction(
    context.nightSeed ? `${context.nightSeed}|${personaUsername}|life` : null
  );
  const shapeInstruction = SHAPE_INSTRUCTIONS[rollMessageShape(isHistoryEmpty)] || '';

  let scenarioInstruction = '';
  if (context.role && context.stance) {
    scenarioInstruction = `\nROLE AND STANCE CONTROLS:\n` +
                          `- Your Role: ${context.role}\n` +
                          `- Your Stance/Opinion: ${context.stance}\n` +
                          `- Your Current Location: ${context.location || 'at_venue'}\n` +
                          `CRITICAL: Ground your message strictly in your role, stance, and location. For example, if your location is 'at_home', you are NOT at the venue yet (do not say you are inside or listening to the DJ, speak as someone at home). If you are 'en_route', you are on the way. If you are a skeptic, maintain your skeptical stance. Stay consistent!\n`;
  }

  let relationshipInstruction = '';
  if (context.isStranger) {
    const strangerExamples = isHistoryEmpty
      ? `- Sound open, curious, and inclusive — but nobody has texted yet, so keep questions open-ended and aimed at no one specific (e.g. "anyone here yet?").\n`
      : `- Sound open, curious, and inclusive. E.g., ask: "first time here?", "who else came solo?", "you guys know each other or just met?".\n`;
    relationshipInstruction =
      `\nRELATIONSHIP STATUS: STRANGERS MEETING FOR THE FIRST TIME\n` +
      `- You do NOT know the other people in this chat. You just arrived at ${venueName} or are thinking of coming.\n` +
      `- You have NO shared history with anyone here. Never say "remember when", "you always", or roast/tease anyone about their past behavior/habits.\n` +
      strangerExamples +
      (dayCard
        ? `- Banter must stay light and friendly (the queue, the weather, the moment), NOT familiar roasting.\n`
        : `- Banter must stay light and friendly (teasing the DJ, the line, the drinks, or the moment), NOT familiar roasting.\n`);
  } else if (context.friendUsername) {
    relationshipInstruction = 
      `\nRELATIONSHIP STATUS: PRE-EXISTING FRIENDSHIP\n` +
      `- You know @${context.friendUsername} from before. You two are friends.\n` +
      `- You are strangers to everyone else in the chat.\n` +
      `- You can tease or roast @${context.friendUsername} specifically, but be open and inclusive to other participants in the chat who are strangers.\n`;
  } else {
    relationshipInstruction = 
      `\nRELATIONSHIP STATUS: ACQUAINTANCES MEETING AT THE VENUE\n` +
      `- Sound open, friendly, and inclusive. React to the venue together.\n`;
  }

  const voiceCard = buildVoiceCard(personaVoice);

  if (variant === 'ambient' || variant === 'ambient_seeding') {
    prompt =
      getBaseStyle(venueName, isHistoryEmpty, dayCard, isDay) +
      `Your personality: ${personaStyles[pType] || personaStyles.hype}\n` +
      voiceCard +
      getRules(isHistoryEmpty) +
      langInstruction +
      shapeInstruction +
      emojiInstruction +
      venueContextInstruction +
      energyInstruction +
      crowdInstruction +
      verdictInstruction +
      detailInstruction +
      lifeTopicInstruction +
      relationshipInstruction +
      intentInstruction +
      topicNegationInstruction +
      ownLastInstruction +
      scenarioInstruction +
      (isHistoryEmpty
        ? `\nTHE CHAT IS EMPTY — you are posting the FIRST message tonight. Nobody has said anything yet:\n` +
          `- Do NOT text as if you are mid-conversation with people. No "you guys...", no replying to things nobody said.\n` +
          `- Write a true opener: an observation about the place or your night, a thought thrown into the void, or an open question directed at no one specific ("anyone here yet?").\n` +
          `\nIt is ${dayAndTime}.\n` +
          `Write ONE opening message as ${personaName}. Return ONLY the raw message text.`
        : `\nThis is a GROUP CHAT — read what others just said and CONTINUE the conversation. ` +
          `React to the last message, answer a question someone asked, or build on the topic. Do NOT post a random unrelated statement.\n` +
          `\nIt is ${dayAndTime}. Recent chat:\n${history}\n` +
          `Write ONE message as ${personaName} that flows from the conversation above. Return ONLY the raw message text.`);
  } else if (variant === 'dm' || variant === 'dm_reply') {
    const cleanSenderName = (context.senderName || 'EventGoer').toLowerCase().includes('nils') ? 'VibeGoer' : (context.senderName || 'EventGoer');
    const senderMsg = context.senderMessage || '';
    const followUpInstruction = (context.isFollowUp && context.ownPriorMessage)
      ? `\nIMPORTANT: @${cleanSenderName} is asking you to explain what YOU said earlier: "${context.ownPriorMessage}". ` +
        `Give a short, concrete explanation of what you meant — name the specific thing. Do NOT answer with another question, and do NOT say "what do you mean".\n`
      : '';
    prompt =
      getBaseStyle(venueName, false, dayCard, isDay) +
      voiceCard +
      getRules() +
      langInstruction +
      emojiInstruction +
      venueContextInstruction +
      energyInstruction +
      crowdInstruction +
      verdictInstruction +
      detailInstruction +
      lifeTopicInstruction +
      relationshipInstruction +
      scenarioInstruction +
      topicNegationInstruction +
      ownLastInstruction +
      followUpInstruction +
      `\nIt is ${dayAndTime}. @${cleanSenderName} just said directly to you: "${senderMsg}".\n` +
      `Recent chat:\n${history || 'No recent messages.'}\n` +
      `Reply directly to what @${cleanSenderName} said — respond to their actual point, don't change the subject. ` +
      `Return ONLY the raw message text.`;
  } else if (variant === 'reaction' || variant === 'reaction_reply') {
    const cleanReactingName = (context.reactingName || 'EventGoer').toLowerCase().includes('nils') ? 'VibeGoer' : (context.reactingName || 'EventGoer');
    const emoji = context.reactionEmoji || context.emoji || '🔥';
    const origMsg = context.originalMessage || '';
    prompt =
      getBaseStyle(venueName, false, dayCard, isDay) +
      voiceCard +
      getRules() +
      langInstruction +
      emojiInstruction +
      venueContextInstruction +
      energyInstruction +
      verdictInstruction +
      relationshipInstruction +
      scenarioInstruction +
      `\nIt is ${dayAndTime}. @${cleanReactingName} reacted ${emoji} to your message: "${origMsg}".\n` +
      `Recent chat:\n${history || 'No recent messages.'}\n` +
      `Write a short, natural acknowledgement of the reaction — a real person reacting to being reacted to. Keep it light. ` +
      `Return ONLY the raw message text.`;
  } else {
    throw new Error(`Unknown message variant: ${variant}`);
  }

  const callConfig = {
    model: context.model,
    temperature: context.temperature,
  };

  let text = '';
  let stopReason = '';
  let finalMessage = '';
  let attempts = 0;
  let savedEndTurnText = null;
  let lastText = '';
  
  const BANNED_OPENERS = new Set(['yo', 'yoo', 'ayo', 'bro', 'buda']);

  while (attempts < 5) {
    console.log(`[Persona Generator] Generation attempt ${attempts + 1} for @${personaUsername}...`);
    try {
      const res = await callAnthropicHaiku(apiKey, prompt, callConfig);
      text = res.text;
      stopReason = res.stopReason;
      lastText = text;
      
      const isCutoff = stopReason !== 'end_turn';
      const isDangling = endsWithConnectorOrComma(text);
      const isTooLong = [...text].length > 50;
      
      if (!isCutoff) {
        savedEndTurnText = text;
      }
      
      if (isCutoff) {
        console.warn(`[Persona Generator] Attempt ${attempts + 1} truncated (stop_reason: ${stopReason}). Retrying. Text: "${text}"`);
        attempts++;
        continue;
      }
      
      if (isDangling) {
        console.warn(`[Persona Generator] Attempt ${attempts + 1} ended with a connector or comma. Retrying. Text: "${text}"`);
        attempts++;
        continue;
      }
      
      if (isTooLong) {
        console.warn(`[Persona Generator] Attempt ${attempts + 1} exceeded soft limit of 50 chars (${[...text].length} chars). Retrying. Text: "${text}"`);
        attempts++;
        continue;
      }
      
      // Opener validation
      const candidateCleaned = enforceCeiling(text, personaUsername, personaName, sampledIntent.type, history || '', personaVoice);
      const firstW = getCleanedFirstWord(candidateCleaned, personaUsername, personaName);
      
      const isBanned = BANNED_OPENERS.has(firstW);
      
      const venue = venueName || 'default';
      const recentForVenue = recentOpenersByVenue[venue] || [];
      const isConsecutiveThree = recentForVenue.length >= 2 && recentForVenue[0] === firstW && recentForVenue[1] === firstW;
      
      const currentCount = globalOpenerCounts[firstW] || 0;
      const totalCount = globalOpenersList.length;
      const isOverGlobalCap = (currentCount + 1) > Math.max(2, Math.ceil((totalCount + 1) * 0.15));

      if (isBanned && attempts < 4) {
        console.warn(`[Persona Generator] Attempt ${attempts + 1} started with banned opener "${firstW}". Retrying.`);
        attempts++;
        continue;
      }
      
      if (isConsecutiveThree && attempts < 4) {
        console.warn(`[Persona Generator] Attempt ${attempts + 1} venue consecutive three opener violation for "${firstW}". Retrying.`);
        attempts++;
        continue;
      }
      
      if (isOverGlobalCap && attempts < 4) {
        console.warn(`[Persona Generator] Attempt ${attempts + 1} global cap 15% opener violation for "${firstW}" (${currentCount + 1}/${totalCount + 1} > 15%). Retrying.`);
        attempts++;
        continue;
      }
      
      finalMessage = text;
      break;
    } catch (err) {
      console.error(`[Persona Generator] Attempt ${attempts + 1} failed:`, err.message);
      attempts++;
    }
  }

  if (!finalMessage) {
    if (savedEndTurnText) {
      console.warn(`[Persona Generator] All attempts failed validation, but using saved complete (end_turn) text: "${savedEndTurnText}"`);
      finalMessage = savedEndTurnText;
    } else {
      console.warn(`[Persona Generator] All attempts failed and no end_turn text was found. Falling back to last text: "${lastText}"`);
      finalMessage = lastText;
    }
  }

  // Fallback texts skipped length validation — never let a paragraph through
  finalMessage = hardTrimToOneLine(finalMessage);

  const finalCleaned = enforceCeiling(finalMessage, personaUsername, personaName, sampledIntent.type, history || '', personaVoice);
  
  // Track selected opener
  const actualFirstW = getCleanedFirstWord(finalCleaned, personaUsername, personaName);
  if (actualFirstW) {
    const venue = venueName || 'default';
    if (!recentOpenersByVenue[venue]) {
      recentOpenersByVenue[venue] = [];
    }
    recentOpenersByVenue[venue].push(actualFirstW);
    if (recentOpenersByVenue[venue].length > 2) {
      recentOpenersByVenue[venue].shift();
    }
    
    globalOpenersList.push(actualFirstW);
    globalOpenerCounts[actualFirstW] = (globalOpenerCounts[actualFirstW] || 0) + 1;
  }

  return finalCleaned;
}

module.exports = {
  generateMessage,
  cleanPersonaMessageText,
  enforceCeiling,
  rollLanguageMode,
  rollEmoji
};
