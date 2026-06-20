/**
 * runCleanupJob.js
 * Executable script to trigger the one-time event cleanup job immediately.
 * Fetches all live events from Firestore, sends them to Claude Sonnet for KEEP/REMOVE/NEEDS EDIT evaluation,
 * and saves findings in pendingEvents collection for admin approval.
 */

const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

if (admin.apps.length === 0) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

/**
 * Converts date string (DD/MM/YYYY) and time string (HH:MM or equivalent) into EAT timestamps.
 */
function parseDateTime(dateStr, timeStr) {
  if (!dateStr) {
    throw new Error('Date string is required.');
  }
  const parts = dateStr.split('/');
  if (parts.length !== 3) {
    throw new Error(`Invalid date format: ${dateStr}`);
  }
  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const year = parseInt(parts[2], 10);

  let hour = 18;
  let minute = 0;

  if (timeStr) {
    const timeMatch = timeStr.match(/(\d+):(\d+)\s*(pm|am)?/i);
    if (timeMatch) {
      hour = parseInt(timeMatch[1], 10);
      minute = parseInt(timeMatch[2], 10);
      const ampm = timeMatch[3];
      if (ampm) {
        if (ampm.toLowerCase() === 'pm' && hour < 12) hour += 12;
        if (ampm.toLowerCase() === 'am' && hour === 12) hour = 0;
      }
    }
  }

  const pad = (n) => String(n).padStart(2, '0');
  const isoString = `${year}-${pad(month + 1)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00+03:00`;
  const startDate = new Date(isoString).getTime();
  const expirationDate = startDate + (6 * 60 * 60 * 1000); // 6 hours duration fallback

  return { startDate, expirationDate };
}

async function runCleanupJob() {
  console.log('🔄 Initializing Live Events Cleanup...');

  // 1. Get Anthropic API Key
  const settingsSnap = await db.collection('settings').doc('simulation').get();
  if (!settingsSnap.exists) {
    console.error('❌ settings/simulation document not found in Firestore.');
    process.exit(1);
  }
  const apiKey = settingsSnap.data().anthropicApiKey;
  if (!apiKey) {
    console.error('❌ anthropicApiKey not configured in settings/simulation.');
    process.exit(1);
  }

  // 2. Fetch live events
  const liveEventsSnap = await db.collection('venues')
    .where('type', '==', 'Event')
    .get();

  const existingEvents = [];
  liveEventsSnap.forEach((docSnap) => {
    const vData = docSnap.data();
    let EATDateStr = '';
    let EATTimeStr = '';
    if (vData.startDate) {
      try {
        const d = new Date(vData.startDate);
        const options = { timeZone: 'Africa/Nairobi' };
        
        const dayStr = new Intl.DateTimeFormat('en-GB', { ...options, day: '2-digit' }).format(d);
        const monthStr = new Intl.DateTimeFormat('en-GB', { ...options, month: '2-digit' }).format(d);
        const yearStr = new Intl.DateTimeFormat('en-GB', { ...options, year: 'numeric' }).format(d);
        EATDateStr = `${dayStr}/${monthStr}/${yearStr}`;

        const hourStr = new Intl.DateTimeFormat('en-GB', { ...options, hour: '2-digit', hour12: false }).format(d);
        const minStr = new Intl.DateTimeFormat('en-GB', { ...options, minute: '2-digit' }).format(d);
        EATTimeStr = `${hourStr}:${minStr}`;
      } catch (e) {
        console.warn(`[Cleanup] Date conversion error for ${docSnap.id}:`, e.message);
      }
    }

    existingEvents.push({
      id: docSnap.id,
      name: vData.name || '',
      description: vData.description || '',
      venue: vData.address || '',
      date: EATDateStr,
      time: EATTimeStr,
      category: vData.category || 'Other',
      ticketLink: vData.ticketLink || null,
      sourceLink: vData.sourceLink || null
    });
  });

  console.log(`📊 Found ${existingEvents.length} live events to evaluate.`);
  if (existingEvents.length === 0) {
    console.log('✅ No live events to evaluate. Exiting.');
    process.exit(0);
  }

  // 3. Format Date Details for Prompt
  const now = new Date();
  const options = { timeZone: 'Africa/Nairobi' };
  const currentDate = new Intl.DateTimeFormat('en-GB', { ...options, day: 'numeric', month: 'long', year: 'numeric' }).format(now);
  const existingEventsJSON = JSON.stringify(existingEvents, null, 2);

  // Exact prompt from spec
  const prompt = `Today is ${currentDate}. Below is a list of events currently live on Eventas, a Nairobi nightlife app. Your job is to clean this list. You MUST use Google Maps to verify the coordinates and event location definition of these events, and verify their dates using reliable web sources.

CRITICAL SEARCH EFFICIENCY RULE: Do NOT perform individual search queries for every single event. Instead, batch your searches by category or grouping (e.g., search for "upcoming Nairobi concerts this month", "Nairobi club nights June 2026", "Nairobi art events 2026", etc.) and cross-reference multiple events per search. You should target verifying all events in a total of 5–8 batched searches maximum to keep API search costs low.

For each event: mark it as REMOVE if the date has already passed as of today, mark it as REMOVE if the event details are vague, incomplete, or unverifiable, mark it as KEEP if it is a valid upcoming event with a confirmed date and venue, mark it as NEEDS EDIT if the event is upcoming but has incomplete or poorly written details — and provide a corrected version. Return ONLY a valid JSON array where each object has: originalId (the Firestore document ID), action (KEEP / REMOVE / NEEDS EDIT), and updatedEvent (null if KEEP or REMOVE, or the full corrected event object if NEEDS EDIT). The corrected event object inside updatedEvent must have category as one of: Club / Bar / Activity / Event, and a valid, non-null sourceLink. Here are the current events: ${existingEventsJSON}`;

  console.log('🤖 Sending live events to Claude Sonnet (web search enabled)...');

  // 4. Query Claude Sonnet API
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'anthropic-beta': 'web-search-2025-03-05'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 8000,
      tools: [
        {
          type: 'web_search_20250305',
          name: 'web_search'
        }
      ],
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Claude Sonnet API error: ${response.status} - ${errText}`);
  }

  const resData = await response.json();
  let textResult = '';
  if (resData && resData.content) {
    const textBlock = resData.content.find(block => block.type === 'text');
    if (textBlock && textBlock.text) {
      textResult = textBlock.text.trim();
    }
  }

  if (!textResult) {
    throw new Error(`Unexpected Claude response structure: ${JSON.stringify(resData)}`);
  }

  // 5. Parse JSON array
  let jsonArray = null;
  try {
    jsonArray = JSON.parse(textResult);
  } catch (err) {
    const match = textResult.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (match) {
      try {
        jsonArray = JSON.parse(match[0]);
      } catch (e) {
        console.error('❌ Failed parsing regex-extracted JSON:', e);
      }
    }
  }

  if (!jsonArray || !Array.isArray(jsonArray)) {
    console.error('❌ Failed to parse valid JSON array from Claude response.');
    console.log('Raw output:', textResult);
    process.exit(1);
  }

  console.log(`✅ Claude successfully evaluated ${jsonArray.length} items.`);

  // 6. Delete existing pending cleanups
  const existingCleanupsSnap = await db.collection('pendingEvents')
    .where('curatedBy', '==', 'claude_cleanup')
    .where('status', '==', 'pending')
    .get();

  const batch = db.batch();
  existingCleanupsSnap.forEach((docSnap) => {
    batch.delete(docSnap.ref);
  });
  await batch.commit();
  console.log(`🧹 Cleared ${existingCleanupsSnap.size} outdated pending cleanup logs.`);

  // 7. Write new findings
  let countAdded = 0;
  for (const item of jsonArray) {
    const origEvent = existingEvents.find(e => e.id === item.originalId);
    if (!origEvent) continue;

    const displayEvent = item.action === 'NEEDS EDIT' && item.updatedEvent ? item.updatedEvent : origEvent;

    let startDate = null;
    let expirationDate = null;
    try {
      const parsed = parseDateTime(displayEvent.date || origEvent.date, displayEvent.time || origEvent.time || '18:00');
      startDate = parsed.startDate;
      expirationDate = parsed.expirationDate;
    } catch (e) {
      console.warn(`[Cleanup] Error pre-calculating timestamps for cleanup event ${displayEvent.name}:`, e.message);
    }

    await db.collection('pendingEvents').add({
      name: displayEvent.name || origEvent.name || '',
      venue: displayEvent.venue || origEvent.venue || '',
      date: displayEvent.date || origEvent.date || '',
      time: displayEvent.time || origEvent.time || '',
      category: displayEvent.category || origEvent.category || 'Event',
      description: displayEvent.description || origEvent.description || '',
      ticketLink: displayEvent.ticketLink || origEvent.ticketLink || null,
      sourceLink: displayEvent.sourceLink || origEvent.sourceLink || null,
      status: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      curatedBy: 'claude_cleanup',
      originalId: item.originalId,
      action: item.action || 'KEEP',
      updatedEvent: item.updatedEvent || null,
      startDate: startDate,
      expirationDate: expirationDate
    });
    countAdded++;
    console.log(`  📝 Saved cleanup recommendation for: "${displayEvent.name}" -> Action: ${item.action}`);
  }

  console.log(`\n🎉 Success! Added ${countAdded} cleanup recommendations in pendingEvents collection.`);
  process.exit(0);
}

runCleanupJob().catch((err) => {
  console.error('❌ Cleanup execution failed:', err);
  process.exit(1);
});
