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

async function callAnthropicHaiku(apiKey, userPrompt) {
  const url = 'https://api.anthropic.com/v1/messages';
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 150,
      messages: [{ role: 'user', content: userPrompt }]
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Anthropic API error: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  if (data && data.content && data.content[0] && data.content[0].text) {
    return data.content[0].text.trim();
  }
  throw new Error(`Unexpected Anthropic response: ${JSON.stringify(data)}`);
}

function cleanPersonaMessageText(text, username, personaName) {
  if (!text) return '';
  let cleaned = text.trim();
  if (cleaned.startsWith('"') && cleaned.endsWith('"')) cleaned = cleaned.slice(1, -1).trim();
  if (cleaned.startsWith("'") && cleaned.endsWith("'")) cleaned = cleaned.slice(1, -1).trim();
  const prefixes = [
    username + ':', '@' + username + ':', personaName + ':', '@' + personaName + ':', username + ' -', personaName + ' -'
  ];
  for (const prefix of prefixes) {
    if (cleaned.toLowerCase().startsWith(prefix.toLowerCase())) {
      cleaned = cleaned.substring(prefix.length).trim();
      break;
    }
  }
  const match = cleaned.match(/^@?([A-Za-z0-9_]{1,20}):\s*(.*)/i);
  if (match && match[2]) {
    cleaned = match[2].trim();
  }
  return cleaned;
}

function rollLanguageMode() { return 'sheng'; }
function rollEmoji() { return Math.random() > 0.5; }
const getBaseStyle = (venueName) => 
  `You are a young Nairobi socialite texting in the ${venueName} group chat on a nightlife app. ` +
  `You must write EXACTLY like young Nairobians text in 2025. ` +
  `\n\nWHAT SHENG ACTUALLY SOUNDS LIKE:\n` +
  `Nairobians chop, blend and switch mid-sentence naturally. Examples: ` +
  `"maze place ni fiti sana leo", "si unajua vibes ziko different usiku huu", ` +
  `"waah buda nilikuwa sishuku itakuwa hivi", "noma sana hapa crowd ni different", ` +
  `"msee DJ ameweka fire track tena", "maze nimekuwa hapa from 10 vibes ni noma". ` +
  `\n\nSHENG VOCABULARY: msee/dem/buda/jamaa (people), maze/waah/sawa/kweli (reactions), ` +
  `fiti/noma/different/poa/top (quality), hapa/hapo/njiani/imejaa (location), ` +
  `leo/usiku/saa hii (time), si unajua/ama/lakini/tena/hata (connectors).\n`;

const RULES = 
  `\nRULES: ` +
  `(1) Keep message length strictly under 40 characters total. ` +
  `(2) No hashtags. (3) No line breaks. ` +
  `(4) Be extremely casual, like texting a friend.\n`;

function enforceCeiling(text, username, personaName) {
  return cleanPersonaMessageText(text, username, personaName);
}

const personaStyles = {
  hype: `You hype the crowd. Short energy bursts reacting to right now.`,
  question: `You ask before committing. One genuine question — crowd, music, entry.`,
  opinion: `You give honest takes. Can be mixed or critical, not just hype.`,
  enthusiast: `You know events. Name a specific song, DJ, or compare to last week.`
};

async function testPrompt() {
  const simSettingsDoc = await db.collection('settings').doc('simulation').get();
  const apiKey = simSettingsDoc.exists ? simSettingsDoc.data().anthropicApiKey : null;
  if (!apiKey) {
    console.error("No API key found in admin_settings/global.");
    process.exit(1);
  }

  const targetVenue = { name: "Alchemist" };
  const persona = { name: "Shaz", username: "shaz_m", type: "enthusiast" };
  const dayAndTime = "Fri at 10PM";
  const last5Messages = "msee_ke: bro it's packed\njohnny: anyone here yet?\n";

  const langMode = rollLanguageMode();
  const useEmoji = rollEmoji();

  const langInstruction = langMode === 'english'
    ? `\nFor THIS message: write in casual English only (no Sheng). Still sound like a young Nairobian texting fast.\n`
    : `\nFor THIS message: mix Sheng and English naturally, switching mid-sentence.\n`;

  const emojiInstruction = useEmoji
    ? `Include ONE emoji that fits the mood.\n`
    : `Do NOT use any emoji this time.\n`;

  const prompt =
    getBaseStyle(targetVenue.name) +
    `Your personality: ${personaStyles[persona.type] || personaStyles.hype}\n` +
    RULES +
    langInstruction +
    emojiInstruction +
    `\nThis is a GROUP CHAT — read what others just said and CONTINUE the conversation. ` +
    `React to the last message, answer a question someone asked, or build on the topic. Do NOT post a random unrelated statement.\n` +
    `\nIt is ${dayAndTime}. Recent chat:\n${last5Messages}\n` +
    `Write ONE message as ${persona.name} that flows from the conversation above. Return ONLY the raw message text.`;

  console.log("=== GENERATING MESSAGE WITH PROMPT ===");
  console.log(prompt);
  console.log("======================================\n");

  const rawRes = await callAnthropicHaiku(apiKey, prompt);
  console.log("Raw Response:");
  console.log(rawRes);
  console.log("\nCleaned Response:");
  console.log(enforceCeiling(rawRes, persona.username, persona.name));

  process.exit(0);
}

testPrompt();
