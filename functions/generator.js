const fetch = require('node-fetch');

// --- Persona Prompt Helpers ---
function rollLanguageMode() {
  const r = Math.random();
  if (r < 0.45) return 'english_dominant';
  if (r < 0.80) return 'mixed_light';
  return 'mixed_heavy';
}

function rollEmoji() {
  return Math.random() > 0.5;
}

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
  `(1) Write ONE COMPLETE short line (~8 words max). It must be a finished thought. Never stop mid-sentence. ` +
  `(2) No hashtags. (3) No line breaks. ` +
  `(4) Be extremely casual, like texting a friend.\n`;

function enforceCeiling(text, username, personaName, intentType = 'default', history = '') {
  return cleanPersonaMessageText(text, username, personaName, intentType, history);
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

function cleanPersonaMessageText(text, username, personaName, intentType = 'default', history = '') {
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
  
  // Clean dangling endings (never cut mid-word or end on connector/comma)
  body = cleanDanglingEndings(body);

  // Enforce minimum 20 characters by appending Sheng fillers
  bodyArr = [...body];
  if (bodyArr.length < 20) {
    const fillers = [" maze", " buda", " noma", " vibe", " fiti", " sana", " hapa"];
    let fillerIdx = 0;
    while (bodyArr.length < 20) {
      const fillerChars = [...fillers[fillerIdx % fillers.length]];
      bodyArr = bodyArr.concat(fillerChars);
      fillerIdx++;
    }
    body = bodyArr.join('');
  }

  // Clean dangling endings final check
  body = cleanDanglingEndings(body);

  // 2. Decide whether to append an emoji (~35% chance)
  const appendEmoji = Math.random() < 0.35;
  if (appendEmoji) {
    const EMOJI_POOLS = {
      hype: ['🔥','🥵','💯','✨'],
      question: ['👀','🤔','📍'],
      logistics: ['📍','🚗','🎟️'],
      plan: ['🙌','💃','🕺'],
      default: ['😂','🎶','🍻','👀']
    };
    const pool = EMOJI_POOLS[intentType] || EMOJI_POOLS.default;
    const lastEmojis = getLastEmojisFromHistory(history);
    let filteredPool = pool.filter(emo => !lastEmojis.includes(emo));
    if (filteredPool.length === 0) {
      filteredPool = pool;
    }
    const chosenEmoji = filteredPool[Math.floor(Math.random() * filteredPool.length)];
    body = `${body} ${chosenEmoji}`;
  }

  return body;
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
    'sana', 'noma', 'fiti', 'maze', 'buda', 'msee', 'vibe', 'vibes', 'hapa', 'leo'
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

  let maxWord = null;
  let maxCount = 0;
  for (const [w, count] of Object.entries(wordCounts)) {
    if (count > maxCount) {
      maxCount = count;
      maxWord = w;
    }
  }

  return maxCount >= 2 ? maxWord : null;
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

const INTENTS = [
  { type:'venue_talk', weight:4, hint:'comment on the PLACE — the DJ/music, a drink, the lighting, the bathroom line, the bouncer. an observation, not a question.' },
  { type:'banter',     weight:3, hint:'tease/roast another person in the chat by @handle. playful, light.' },
  { type:'reply',      weight:3, hint:'react to the LAST message but you MAY pivot the topic — do not just repeat it.' },
  { type:'cosign',     weight:2, hint:'agree/hype what someone said. short. "facts", "exactly msee".' },
  { type:'hype',       weight:2, hint:'react to the vibe, be specific. never just "its lit".' },
  { type:'tangent',    weight:2, hint:'slightly off-topic — hungry, traffic, an outfit, someone running late.' },
  { type:'question',   weight:2, hint:'ask something NOT about money/entry — what they think, where they are, who they came with.' },
  { type:'logistics',  weight:1, hint:'one practical detail. use SPARINGLY.' },
];

async function generateMessage(context) {
  const { variant, persona, venueName, history, daypart } = context;
  
  const apiKey = context.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('Anthropic API key is not configured.');
  }

  // 1. Sample one intent per generateMessage call (seeded RNG so harness runs are reproducible)
  const isHistoryEmpty = !history || history.trim() === '' || history.trim() === 'No recent messages.';
  const isAmbient = context.tier === 'ambient';
  const availableIntents = isHistoryEmpty || isAmbient
    ? INTENTS.filter(i => i.type !== 'reply' && i.type !== 'banter' && i.type !== 'cosign')
    : INTENTS;

  const totalWeight = availableIntents.reduce((sum, i) => sum + i.weight, 0);
  let r = Math.random() * totalWeight;
  let sampledIntent = null;
  for (const intent of availableIntents) {
    r -= intent.weight;
    if (r <= 0) {
      sampledIntent = intent;
      break;
    }
  }
  if (!sampledIntent) {
    sampledIntent = availableIntents[0];
  }

  // Resolve dayAndTime / daypart
  let dayAndTime = daypart;
  if (dayAndTime) {
    const dp = dayAndTime.toLowerCase();
    if (dp === 'morning') dayAndTime = 'Sat at 9AM';
    else if (dp === 'afternoon') dayAndTime = 'Sat at 3PM';
    else if (dp === 'evening') dayAndTime = 'Sat at 8PM';
    else if (dp === 'night') dayAndTime = 'Sat at 11PM';
  } else {
    const now = new Date();
    const hourLabel = now.getHours() > 12 ? `${now.getHours() - 12}PM` : now.getHours() === 12 ? '12PM' : `${now.getHours()}AM`;
    const weekdayLabel = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'Africa/Nairobi' }).format(now);
    dayAndTime = `${weekdayLabel} at ${hourLabel}`;
  }

  const langMode = rollLanguageMode();

  let langInstruction = '';
  if (langMode === 'english_dominant') {
    langInstruction = `\nFor THIS message: write in natural casual English texting style, naturally weaving exactly 1 or 2 Sheng/Swahili words (like maze, msee, buda, fiti, noma, poa, sawa, sana) into the sentence. Keep it extremely brief (under 50 characters). English must dominate completely. NEVER write a full Swahili or Swahili-dominant sentence.\n`;
  } else if (langMode === 'mixed_light') {
    langInstruction = `\nFor THIS message: write in casual English texting style, naturally weaving exactly 2 or 3 Sheng/Swahili words (like maze, msee, buda, fiti, noma, poa, sawa, leo, usiku, njiani, sana) into the sentence. Keep it extremely brief (under 50 characters). English must still be the grammatical base.\n`;
  } else {
    langInstruction = `\nFor THIS message: mix Sheng/Swahili and English (3-4 Sheng/Swahili words max, e.g. maze, msee, buda, fiti, noma, poa, sawa, usiku, leo, njiani, sana, lakini) switching naturally mid-sentence. Keep it extremely brief (under 50 characters). English must still be present.\n`;
  }

  const emojiInstruction = (variant === 'ambient' || variant === 'ambient_seeding')
    ? `Do NOT use any emoji this time.\n`
    : `No emoji this time.\n`;

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
      const handles = getHandlesFromHistory(history).filter(h => h !== `@${personaUsername}`);
      let hint = sampledIntent.hint;
      if (handles.length > 0) {
        hint += ` You can target one of these users: ${handles.join(', ')}.`;
      }
      intentInstruction = `\nInstruction for this message: ${hint}\n`;
    } else if (sampledIntent.type === 'cosign') {
      const handles = getHandlesFromHistory(history).filter(h => h !== `@${personaUsername}`);
      let hint = sampledIntent.hint;
      if (handles.length > 0) {
        hint += ` Reference what ${handles.join(' or ')} said.`;
      }
      intentInstruction = `\nInstruction for this message: ${hint}\n`;
    } else {
      intentInstruction = `\nInstruction for this message: ${sampledIntent.hint}\n`;
    }
  }

  const forbiddenWord = getForbiddenTopicWord(history, context.scenarioKeywords || []);
  const topicNegationInstruction = forbiddenWord
    ? `\nCRITICAL: Do NOT mention or talk about "${forbiddenWord}". Pivot the topic away from it completely.\n`
    : '';

  let scenarioInstruction = '';
  if (context.role && context.stance) {
    scenarioInstruction = `\nROLE AND STANCE CONTROLS:\n` +
                          `- Your Role: ${context.role}\n` +
                          `- Your Stance/Opinion: ${context.stance}\n` +
                          `- Your Current Location: ${context.location || 'at_venue'}\n` +
                          `CRITICAL: Ground your message strictly in your role, stance, and location. For example, if your location is 'at_home', you are NOT at the venue yet (do not say you are inside or listening to the DJ, speak as someone at home). If you are 'en_route', you are on the way. If you are a skeptic, maintain your skeptical stance. Stay consistent!\n`;
  }

  if (variant === 'ambient' || variant === 'ambient_seeding') {
    prompt =
      getBaseStyle(venueName) +
      `Your personality: ${personaStyles[pType] || personaStyles.hype}\n` +
      RULES +
      langInstruction +
      emojiInstruction +
      intentInstruction +
      topicNegationInstruction +
      scenarioInstruction +
      `\nThis is a GROUP CHAT — read what others just said and CONTINUE the conversation. ` +
      `React to the last message, answer a question someone asked, or build on the topic. Do NOT post a random unrelated statement.\n` +
      `\nIt is ${dayAndTime}. Recent chat:\n${history || 'No recent messages.'}\n` +
      `Write ONE message as ${personaName} that flows from the conversation above. Return ONLY the raw message text.`;
  } else if (variant === 'dm' || variant === 'dm_reply') {
    const cleanSenderName = (context.senderName || 'EventGoer').toLowerCase().includes('nils') ? 'VibeGoer' : (context.senderName || 'EventGoer');
    const senderMsg = context.senderMessage || '';
    prompt =
      getBaseStyle(venueName) +
      RULES +
      langInstruction +
      emojiInstruction +
      scenarioInstruction +
      `\nIt is ${dayAndTime}. @${cleanSenderName} just said directly to you: "${senderMsg}".\n` +
      `Recent chat:\n${history || 'No recent messages.'}\n` +
      `Reply directly to what @${cleanSenderName} said — actually respond to their point, don't change the subject. ` +
      `Return ONLY the raw message text.`;
  } else if (variant === 'reaction' || variant === 'reaction_reply') {
    const cleanReactingName = (context.reactingName || 'EventGoer').toLowerCase().includes('nils') ? 'VibeGoer' : (context.reactingName || 'EventGoer');
    const emoji = context.reactionEmoji || context.emoji || '🔥';
    const origMsg = context.originalMessage || '';
    prompt =
      getBaseStyle(venueName) +
      RULES +
      langInstruction +
      emojiInstruction +
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

  while (attempts < 3) {
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

  return enforceCeiling(finalMessage, personaUsername, personaName, sampledIntent.type, history || '');
}

module.exports = {
  generateMessage,
  cleanPersonaMessageText,
  enforceCeiling,
  rollLanguageMode,
  rollEmoji
};
