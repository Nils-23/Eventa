/**
 * persona_metrics.js
 * Placeholder file. Drop your real metrics file here.
 * Do not modify the exported API.
 */

function report(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    console.log("No messages to analyze.");
    return;
  }

  console.log("\n=================== METRICS REPORT ===================");
  console.log(`Total Messages Analyzed: ${messages.length}`);
  
  // Character length stats
  const lengths = messages.map(m => m.length);
  const minLen = Math.min(...lengths);
  const maxLen = Math.max(...lengths);
  const avgLen = lengths.reduce((sum, l) => sum + l, 0) / messages.length;
  console.log(`Character Lengths: Min=${minLen}, Max=${maxLen}, Avg=${avgLen.toFixed(1)}`);

  // Simple emoji count
  let emojiCount = 0;
  // regex for simple emoji matching
  const emojiRegex = /[\uD800-\uDBFF][\uDC00-\uDFFF]|\p{Emoji_Presentation}/gu;
  const emojiMap = {};
  messages.forEach(msg => {
    const matches = msg.match(emojiRegex);
    if (matches) {
      emojiCount += matches.length;
      matches.forEach(e => {
        emojiMap[e] = (emojiMap[e] || 0) + 1;
      });
    }
  });
  console.log(`Total Emojis Found: ${emojiCount}`);
  if (emojiCount > 0) {
    console.log("Top Emojis:", Object.entries(emojiMap).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([e, c]) => `${e}(${c})`).join(', '));
  }

  // Dangling endings checker
  const connectors = new Set(['n', 'na', 'ni', 'tho', 'lakini', 'ama', 'like', 'and', 'or', 'for', 'kwa', 'ya', 'wa']);
  let danglingCount = 0;
  messages.forEach(msg => {
    const msgWithoutEmoji = msg.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]|\p{Emoji_Presentation}|\p{Emoji_Modifier_Base}|\p{Emoji_Component}/gu, '').trim();
    if (msgWithoutEmoji.endsWith(',')) {
      danglingCount++;
    } else {
      const words = msgWithoutEmoji.split(/\s+/);
      if (words.length > 0) {
        const lastWord = words[words.length - 1].toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g,"");
        if (connectors.has(lastWord)) {
          danglingCount++;
        }
      }
    }
  });
  console.log(`Dangling Endings Found: ${danglingCount}`);

  // Topic share analyzer
  const stopWords = new Set([
    'the', 'to', 'is', 'a', 'and', 'in', 'on', 'at', 'for', 'of', 'this', 'that', 'it', 
    'ni', 'na', 'n', 'ya', 'wa', 'kwa', 'i', 'you', 'we', 'they', 'me', 'my', 'your', 'our', 
    'he', 'she', 'him', 'her', 'was', 'were', 'are', 'am', 'be', 'have', 'has', 'had', 
    'do', 'does', 'did', 'go', 'went', 'gone', 'but', 'so', 'if', 'or', 'as', 'an', 'with',
    'sana', 'noma', 'fiti', 'maze', 'buda', 'msee', 'vibe', 'vibes', 'hapa', 'leo'
  ]);
  const wordCounts = {};
  let totalContentWords = 0;
  messages.forEach(msg => {
    const cleanMsg = msg.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]|\p{Emoji_Presentation}|\p{Emoji_Modifier_Base}|\p{Emoji_Component}/gu, '');
    const words = cleanMsg.toLowerCase()
      .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'!]/g, ' ')
      .split(/\s+/);
    words.forEach(w => {
      const cleanW = w.trim();
      if (cleanW.length > 2 && !stopWords.has(cleanW)) {
        wordCounts[cleanW] = (wordCounts[cleanW] || 0) + 1;
        totalContentWords++;
      }
    });
  });

  let topWord = '';
  let topCount = 0;
  for (const [w, count] of Object.entries(wordCounts)) {
    if (count > topCount) {
      topCount = count;
      topWord = w;
    }
  }
  const sharePct = totalContentWords > 0 ? (topCount / totalContentWords) * 100 : 0;
  console.log(`Top Content Word: "${topWord}" (${topCount} times)`);
  console.log(`Topic Share Pct: ${sharePct.toFixed(1)}%`);
  console.log("======================================================\n");
}

module.exports = { report };
