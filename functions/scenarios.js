const SCENARIOS = [
  {
    type: 'music_skeptic',
    title: 'Music Skeptic',
    description: 'One person thinks the DJ/music tonight is mid; others defend it.',
    keywords: ['music', 'dj', 'song', 'track', 'beat', 'playlist', 'mix', 'playing', 'sounds', 'soundtrack', 'sound', 'system'],
    roles: ['skeptic', 'defender']
  },
  {
    type: 'from_home',
    title: 'Deciding From Home',
    description: 'One person is still at home deciding whether to come; others recruit and tease them.',
    keywords: ['house', 'home', 'bed', 'leaving', 'worth', 'come', 'coming', 'pull up', 'blanket', 'sleep', 'going', 'go'],
    roles: ['homebody', 'recruiter']
  },
  {
    type: 'lost_inside',
    title: 'Lost Inside',
    description: 'One person is at the venue but cannot find the crew.',
    keywords: ['lost', 'find', 'where', 'counter', 'bar', 'entrance', 'vip', 'looking', 'outside', 'inside', 'crowd', 'spot'],
    roles: ['lost_person', 'guide']
  },
  {
    type: 'which_spot',
    title: 'Which Spot?',
    description: 'A pre-game debate about this venue versus going to another spot.',
    keywords: ['spot', 'place', 'venue', 'other', 'move', 'havana', 'alchemist', 'b-club', 'kiza', 'bistro', 'brew', 'leave'],
    roles: ['pro_camp', 'anti_camp']
  },
  {
    type: 'first_timer',
    title: 'First Timer',
    description: 'One person has never been here; others hype it up or warn about the queue.',
    keywords: ['first', 'never', 'queue', 'line', 'entry', 'expect', 'vibe', 'inside', 'newbie', 'gate'],
    roles: ['newbie', 'veteran']
  },
  {
    type: 'always_late',
    title: 'Always Late',
    description: 'One person is running very late, prompting roasting from the crew.',
    keywords: ['late', 'njiani', 'traffic', 'minutes', 'time', 'waiting', 'where', 'eta', 'hurry', 'slow'],
    roles: ['latecomer', 'roaster']
  },
  {
    type: 'food_run',
    title: 'Food Run',
    description: 'Debating whether to get food right now or wait until later.',
    keywords: ['food', 'hungry', 'eat', 'fries', 'burger', 'vibes', 'pork', 'choma', 'kibandaski', 'starving'],
    roles: ['hungry_person', 'full_person']
  },
  {
    type: 'broke_night',
    title: 'Broke Night',
    description: 'One person is short on cash; others tease them or offer to cover them.',
    keywords: ['cash', 'money', 'broke', 'bill', 'sort', 'treat', 'pay', 'expensive', 'drink', 'beers', 'pocket'],
    roles: ['broke_person', 'helper']
  },
  {
    type: 'vibe_check',
    title: 'Vibe Check',
    description: 'One person feels the crowd is too stuck-up/preppy; others defend the vibe.',
    keywords: ['crowd', 'stuck-up', 'vibe', 'people', 'preppy', 'cool', 'energy', 'friendly', 'vibe check'],
    roles: ['critic', 'party_goer']
  },
  {
    type: 'bouncer_drama',
    title: 'Bouncer Drama',
    description: 'One person is complaining about bouncer attitude or long gate lines.',
    keywords: ['bouncer', 'gate', 'line', 'queue', 'id', 'security', 'entry', 'attitude', 'bribe', 'bouncers'],
    roles: ['victim', 'crew_member']
  }
];

function getCoreStanceForScenario(type) {
  switch (type) {
    case 'music_skeptic': return 'You think the DJ/music tonight is mid/boring. Express skepticism about the music quality.';
    case 'from_home': return 'You are still AT HOME in bed/under a blanket. You are hesitant to leave. Express laziness and ask if it is really worth coming.';
    case 'lost_inside': return 'You are inside the venue but lost/separated from the group. You cannot find the bar/VIP area. Ask where the crew is.';
    case 'first_timer': return 'This is your first time at this venue. You are curious but unsure about what to expect or the queue. Ask for details.';
    case 'always_late': return 'You are running late (stuck in traffic / "njiani"). Make excuses for why you are not there yet.';
    case 'food_run': return 'You are starving and want to grab food (choma, fries, burger) immediately. Try to convince others to join you.';
    case 'broke_night': return 'You are low on cash/broke tonight. You want to hang out but worry about high drink prices.';
    case 'vibe_check': return 'You feel the crowd tonight is too preppy, stuck-up, or showing off. Contrast it with better vibes.';
    case 'bouncer_drama': return 'You just had bouncer attitude at the gate or got delayed in the bouncer line. Express annoyance.';
    default: return '';
  }
}

function getSecondaryStanceForScenario(type) {
  switch (type) {
    case 'music_skeptic': return 'Defend the DJ/music! Think it is fire or that the vibe is good. Tell others to stop complaining.';
    case 'from_home': return 'Recruit the person still at home! Tell them they are missing out, the vibe is great, and they must pull up.';
    case 'lost_inside': return 'Guide the lost crew member! Give them a landmark (e.g. near the main bar, left side of DJ booth).';
    case 'first_timer': return 'You are a veteran here. Teach the newbie! Tell them it is a great spot, but warn them about the queue or highlight the best drinks.';
    case 'always_late': return 'Roast the person who is always late! Tease them for being slow or perpetually on "njiani" time.';
    case 'food_run': return 'You want to stay at the club/bar and dance. Oppose the food run right now, say eat later.';
    case 'broke_night': return 'Offer to buy them a drink or tell them not to worry, you got them covered.';
    case 'vibe_check': return 'Disagree with the critic! Say the vibe is great and people are friendly/having fun.';
    case 'bouncer_drama': return 'Give gate tips or laugh it off, saying the bouncers are always like that.';
    default: return '';
  }
}

module.exports = {
  SCENARIOS,
  getCoreStanceForScenario,
  getSecondaryStanceForScenario
};
