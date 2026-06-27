/**
 * scripts/fixtures.js
 * Representative test inputs with no Firebase dependencies.
 * Used for running local persona messaging system testing harnesses.
 */

const venues = [
  {
    id: 'venue_001',
    name: 'Alchemist Bar',
    type: 'Club'
  },
  {
    id: 'venue_002',
    name: 'B-Club',
    type: 'Club'
  },
  {
    id: 'venue_005',
    name: 'Brew Bistro & Lounge',
    type: 'Bar'
  }
];

const personas = [
  {
    id: 'persona_zawadi_muthoni',
    name: 'Zawadi Muthoni',
    username: 'NightOwl8324',
    type: 'hype',
    personalityType: 'hype_person',
    preferredVenueTypes: ['Club', 'Bar']
  },
  {
    id: 'persona_mwenda_kamau',
    name: 'Mwenda Kamau',
    username: 'BassDrop6820',
    type: 'question',
    personalityType: 'question_asker',
    preferredVenueTypes: ['Bar', 'Activity']
  },
  {
    id: 'persona_neema_achieng',
    name: 'Neema Achieng',
    username: 'BeatRider5920',
    type: 'opinion',
    personalityType: 'opinion_giver',
    preferredVenueTypes: ['Club', 'Bar']
  },
  {
    id: 'persona_amina_hassan',
    name: 'Amina Hassan',
    username: 'MidnightRider8192',
    type: 'enthusiast',
    personalityType: 'event_enthusiast',
    preferredVenueTypes: ['Event', 'Club']
  }
];

const histories = [
  {
    name: 'Empty Chat',
    text: 'No recent messages.'
  },
  {
    name: 'Mid-Conversation',
    text: 'Kev: Yo is anyone at Alchemist?\nJoy: Yeah it\'s pretty packed already, music is decent\nKev: Nice, which DJ is on?'
  },
  {
    name: 'DM Context',
    text: 'VibeGoer: Yo this place is fire!'
  }
];

const dayparts = ['morning', 'afternoon', 'evening', 'night'];

module.exports = {
  venues,
  personas,
  histories,
  dayparts,
  overrideDaypart: null // Set to 'morning', 'afternoon', 'evening', or 'night' to override.
};
