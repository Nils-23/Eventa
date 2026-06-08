const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// Helper to convert ISO dates with offset to timestamp ms
function makeTime(isoStr) {
  return new Date(isoStr).getTime();
}

const NAIROBI_VENUES = [
  // ─── CLUBS (10 new + 16 existing preserved/re-seeded or updated) ────────────────────
  {
    id: 'venue_017',
    name: 'Milan Kenya',
    latitude: -1.2608,
    longitude: 36.8029,
    address: 'The Mirage, Chiromo Rd, Westlands',
    description: 'Sophisticated lounge and club on the rooftop of The Mirage, known for high-end dining and elite clubbing.',
    type: 'Club',
    imageUrl: 'https://images.unsplash.com/photo-1570872626485-d8ffea697003?auto=format&fit=crop&q=80&w=600',
    simulatedUsersCount: 45
  },
  {
    id: 'venue_018',
    name: 'Cavalli Club Nairobi',
    latitude: -1.2582,
    longitude: 36.8018,
    address: 'Woodvale Grove, Westlands',
    description: 'An ultra-premium nightclub offering a luxurious ambiance, top-tier drinks, and state-of-the-art light shows.',
    type: 'Club',
    imageUrl: 'https://images.unsplash.com/photo-1545128485-c400e7702796?auto=format&fit=crop&q=80&w=600',
    simulatedUsersCount: 50
  },
  {
    id: 'venue_019',
    name: 'Onyx Lounge & Club',
    latitude: -1.2982,
    longitude: 36.7621,
    address: 'Marsabit Plaza, Ngong Rd',
    description: 'Rooftop club offering breathtaking views of the city, premium signature cocktails, and live DJ sets.',
    type: 'Club',
    imageUrl: 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?auto=format&fit=crop&q=80&w=600',
    simulatedUsersCount: 30
  },
  {
    id: 'venue_020',
    name: 'The Tunnel',
    latitude: -1.3255,
    longitude: 36.8208,
    address: 'Mombasa Road',
    description: 'A massive, energetic clubbing venue on Mombasa Road featuring outstanding sound systems and party vibes.',
    type: 'Club',
    imageUrl: 'https://images.unsplash.com/photo-1506157786151-b8491531f063?auto=format&fit=crop&q=80&w=600',
    simulatedUsersCount: 65
  },
  {
    id: 'venue_021',
    name: 'Kettle House Bar & Grill',
    latitude: -1.2676,
    longitude: 36.8088,
    address: 'Lavington, Nairobi',
    description: 'Highly popular grill and night club in Lavington, famous for excellent meat cuts and high-energy music.',
    type: 'Club',
    imageUrl: 'https://images.unsplash.com/photo-1514933651103-005eec06c04b?auto=format&fit=crop&q=80&w=600',
    simulatedUsersCount: 40
  },
  {
    id: 'venue_022',
    name: 'Kulture Club Nairobi',
    latitude: -1.2650,
    longitude: 36.8055,
    address: 'Westlands, Nairobi',
    description: 'Vibrant club focusing on cultural fusion, Afro-house music, and premium cocktail experiences.',
    type: 'Club',
    imageUrl: 'https://images.unsplash.com/photo-1560624052-449f5ddf0c31?auto=format&fit=crop&q=80&w=600',
    simulatedUsersCount: 35
  },
  {
    id: 'venue_023',
    name: 'Blackyz Lounge',
    latitude: -1.2640,
    longitude: 36.8030,
    address: 'Woodvale Grove, Westlands',
    description: 'Cozy yet energetic nightlife spot in Westlands, known for hip-hop and dancehall music.',
    type: 'Club',
    imageUrl: 'https://images.unsplash.com/photo-1528605248644-14dd04022da1?auto=format&fit=crop&q=80&w=600',
    simulatedUsersCount: 28
  },
  {
    id: 'venue_024',
    name: 'G-Skyye Lounge',
    latitude: -1.2585,
    longitude: 36.8062,
    address: 'Parklands Road, Westlands',
    description: 'A popular club featuring a wide-open rooftop space, perfect for late night dancing under the stars.',
    type: 'Club',
    imageUrl: 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?auto=format&fit=crop&q=80&w=600',
    simulatedUsersCount: 25
  },
  {
    id: 'venue_025',
    name: "Captain's Terrace Restaurant & Club",
    latitude: -1.3615,
    longitude: 36.8430,
    address: 'Mombasa Road (opposite National Park)',
    description: 'Upscale restaurant and club with a stunning viewing deck overlooking the Nairobi National Park.',
    type: 'Club',
    imageUrl: 'https://images.unsplash.com/photo-1533777857889-4be7c70b33f7?auto=format&fit=crop&q=80&w=600',
    simulatedUsersCount: 32
  },
  {
    id: 'venue_026',
    name: 'Golden Spot Lavington',
    latitude: -1.2890,
    longitude: 36.7710,
    address: 'James Gichuru Rd, Lavington',
    description: 'High-energy executive lounge and grill with excellent local food, live bands, and DJs.',
    type: 'Club',
    imageUrl: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&q=80&w=600',
    simulatedUsersCount: 20
  },

  // ─── BARS/LOUNGES (10 new) ──────────────────────────────────────────────────
  {
    id: 'venue_027',
    name: 'Hero Bar',
    latitude: -1.2299,
    longitude: 36.8047,
    address: 'Trademark Hotel, Village Market',
    description: 'Superhero-themed speakeasy offering sophisticated craft cocktails and an elegant rooftop lounge.',
    type: 'Bar',
    imageUrl: 'https://images.unsplash.com/photo-1575444758702-4a6b9222336e?auto=format&fit=crop&q=80&w=600',
    simulatedUsersCount: 22
  },
  {
    id: 'venue_028',
    name: 'Geco Cafe',
    latitude: -1.2842,
    longitude: 36.7725,
    address: 'Mbaazi Ave, Lavington',
    description: 'A charming neighborhood bar and café offering exceptional live acoustic performances, craft beers, and a warm vibe.',
    type: 'Bar',
    imageUrl: 'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?auto=format&fit=crop&q=80&w=600',
    simulatedUsersCount: 38
  },
  {
    id: 'venue_029',
    name: 'The Crafty Chameleon',
    latitude: -1.2833,
    longitude: 36.7667,
    address: 'James Gichuru Rd, Lavington',
    description: 'A custom microbrewery and beer garden serving craft beers on tap in a beautiful open-air garden space.',
    type: 'Bar',
    imageUrl: 'https://images.unsplash.com/photo-1543007630-9710e4a00a20?auto=format&fit=crop&q=80&w=600',
    simulatedUsersCount: 27
  },
  {
    id: 'venue_030',
    name: 'Bao Box',
    latitude: -1.2655,
    longitude: 36.8021,
    address: 'General Mathenge Rd, Westlands',
    description: 'Nairobi\'s ultimate board games bar and cafe, offering dozens of games, cocktails, and visual bites.',
    type: 'Bar',
    imageUrl: 'https://images.unsplash.com/photo-1610890716171-6b1bb98ffd09?auto=format&fit=crop&q=80&w=600',
    simulatedUsersCount: 42
  },
  {
    id: 'venue_031',
    name: 'Cultiva Farm Kenya',
    latitude: -1.3650,
    longitude: 36.7230,
    address: 'Pwani Road, Karen',
    description: 'Rustic farm-to-table restaurant and bar nestled in a leafy garden, known for organic cocktails and fresh produce.',
    type: 'Bar',
    imageUrl: 'https://images.unsplash.com/photo-1508215885820-4585e56135c8?auto=format&fit=crop&q=80&w=600',
    simulatedUsersCount: 31
  },
  {
    id: 'venue_032',
    name: 'Talisman Restaurant & Bar',
    latitude: -1.3435,
    longitude: 36.7145,
    address: 'Ngong Road, Karen',
    description: 'One of Kenya\'s finest dining and bar establishments, featuring a rich, pan-African-inspired decor and garden.',
    type: 'Bar',
    imageUrl: 'https://images.unsplash.com/photo-1533777857889-4be7c70b33f7?auto=format&fit=crop&q=80&w=600',
    simulatedUsersCount: 29
  },
  {
    id: 'venue_033',
    name: 'Jiweke Tavern',
    latitude: -1.2995,
    longitude: 36.7998,
    address: 'Ngong Road, Kilimani',
    description: 'Relaxed open-air tavern featuring great local dishes, sports screens, and a family-friendly afternoon environment.',
    type: 'Bar',
    imageUrl: 'https://images.unsplash.com/photo-1485686531765-ba63b07845a7?auto=format&fit=crop&q=80&w=600',
    simulatedUsersCount: 15
  },
  {
    id: 'venue_034',
    name: 'K1 Klub House Bar',
    latitude: -1.2682,
    longitude: 36.8120,
    address: 'Parklands, Nairobi',
    description: 'Iconic multi-space venue hosting Sunday flea markets, live reggae, and boasting multiple vibrant bars.',
    type: 'Bar',
    imageUrl: 'https://images.unsplash.com/photo-1572116469696-31de0f17cc34?auto=format&fit=crop&q=80&w=600',
    simulatedUsersCount: 48
  },
  {
    id: 'venue_035',
    name: 'Mezze on the Deck',
    latitude: -1.2720,
    longitude: 36.8142,
    address: 'Four Points by Sheraton, Hurlingham',
    description: 'Rooftop bar offering premium Mediterranean tapas, signature cocktails, and a pool deck overlooking Nairobi.',
    type: 'Bar',
    imageUrl: 'https://images.unsplash.com/photo-1514933651103-005eec06c04b?auto=format&fit=crop&q=80&w=600',
    simulatedUsersCount: 23
  },
  {
    id: 'venue_036',
    name: 'Ink 360 Bar',
    latitude: -1.2910,
    longitude: 36.8220,
    address: 'CBD, Nairobi',
    description: 'A stylish rooftop bar in the CBD, providing panoramic skyline views and popular DJ sound systems.',
    type: 'Bar',
    imageUrl: 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?auto=format&fit=crop&q=80&w=600',
    simulatedUsersCount: 19
  },

  // ─── ACTIVITIES (15 new) ────────────────────────────────────────────────────
  {
    id: 'venue_037',
    name: 'Karura Forest',
    latitude: -1.2375,
    longitude: 36.8208,
    address: 'Limuru Road, Nairobi',
    description: 'Lush urban forest featuring waterfalls, caves, cycling trails, and walking paths. A nature lover\'s paradise.',
    type: 'Activity',
    imageUrl: 'https://images.unsplash.com/photo-1448375240586-882707db888b?auto=format&fit=crop&q=80&w=600',
    simulatedUsersCount: 80
  },
  {
    id: 'venue_038',
    name: 'Nairobi National Park',
    latitude: -1.3733,
    longitude: 36.8589,
    address: 'Langata Road, Nairobi',
    description: 'Witness lions, rhinos, and giraffes roaming in the wild with the city skyscrapers as a backdrop.',
    type: 'Activity',
    imageUrl: 'https://images.unsplash.com/photo-1516426122078-c23e76319801?auto=format&fit=crop&q=80&w=600',
    simulatedUsersCount: 95
  },
  {
    id: 'venue_039',
    name: 'Giraffe Centre',
    latitude: -1.3761,
    longitude: 36.7461,
    address: 'Duma Rd, Karen',
    description: 'Feed the endangered Rothschild giraffes from a raised wooden platform and enjoy the nature sanctuary.',
    type: 'Activity',
    imageUrl: 'https://images.unsplash.com/photo-1547721064-da6cfb341d50?auto=format&fit=crop&q=80&w=600',
    simulatedUsersCount: 70
  },
  {
    id: 'venue_040',
    name: 'Sheldrick Elephant Orphanage',
    latitude: -1.3767,
    longitude: 36.7742,
    address: 'Nairobi National Park Gate, Magadi Rd',
    description: 'Watch baby elephants being fed and playing in the mud at this globally renowned rescue sanctuary.',
    type: 'Activity',
    imageUrl: 'https://images.unsplash.com/photo-1557050543-4b5f4e07e99b?auto=format&fit=crop&q=80&w=600',
    simulatedUsersCount: 65
  },
  {
    id: 'venue_041',
    name: 'GP Karting Lang\'ata',
    latitude: -1.3256,
    longitude: 36.7744,
    address: 'Carnivore Road, Lang\'ata',
    description: 'High-octane go-karting track perfect for groups and adrenaline seekers in Nairobi.',
    type: 'Activity',
    imageUrl: 'https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7?auto=format&fit=crop&q=80&w=600',
    simulatedUsersCount: 30
  },
  {
    id: 'venue_042',
    name: 'Village Market Bowling & Ozone',
    latitude: -1.2299,
    longitude: 36.8047,
    address: 'Village Market, Limuru Rd',
    description: 'Ultimate indoor entertainment center with a vintage bowling alley and an action-packed trampoline park.',
    type: 'Activity',
    imageUrl: 'https://images.unsplash.com/photo-1538510122447-2d5cc6e69317?auto=format&fit=crop&q=80&w=600',
    simulatedUsersCount: 45
  },
  {
    id: 'venue_043',
    name: 'Panari Ice Skating Rink',
    latitude: -1.3308,
    longitude: 36.8611,
    address: 'Panari Sky Centre, Mombasa Rd',
    description: 'East Africa\'s first solar-powered ice skating rink. A unique daytime activity for families.',
    type: 'Activity',
    imageUrl: 'https://images.unsplash.com/photo-1546995646-6f140645c36b?auto=format&fit=crop&q=80&w=600',
    simulatedUsersCount: 24
  },
  {
    id: 'venue_044',
    name: 'Nairobi National Museum & Snake Park',
    latitude: -1.2741,
    longitude: 36.8145,
    address: 'Museum Hill Rd, Nairobi',
    description: 'Explore Kenya\'s rich history, cultural heritage, and contemporary art, paired with an adjacent reptile park.',
    type: 'Activity',
    imageUrl: 'https://images.unsplash.com/photo-1580537659444-1237eb7db6b3?auto=format&fit=crop&q=80&w=600',
    simulatedUsersCount: 55
  },
  {
    id: 'venue_045',
    name: 'KICC Heliport Platform',
    latitude: -1.2882,
    longitude: 36.8231,
    address: 'Harambee Avenue, CBD',
    description: 'Get the best 360-degree panoramic view of Nairobi city from the rooftop helipad of the iconic KICC tower.',
    type: 'Activity',
    imageUrl: 'https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?auto=format&fit=crop&q=80&w=600',
    simulatedUsersCount: 60
  },
  {
    id: 'venue_046',
    name: 'Bomas of Kenya',
    latitude: -1.3392,
    longitude: 36.7731,
    address: 'Forest Edge Rd, Lang\'ata',
    description: 'A cultural center showing off traditional Kenyan homesteads and vibrant tribal dances and acrobatics.',
    type: 'Activity',
    imageUrl: 'https://images.unsplash.com/photo-1501281668745-f7f57925c3b4?auto=format&fit=crop&q=80&w=600',
    simulatedUsersCount: 50
  },
  {
    id: 'venue_047',
    name: 'Oloolua Nature Trail',
    latitude: -1.3571,
    longitude: 36.7212,
    address: 'Karen Road, Nairobi',
    description: 'A quiet, scenic nature trail with a waterfall, a natural cave, and peaceful picnic spots under the forest canopy.',
    type: 'Activity',
    imageUrl: 'https://images.unsplash.com/photo-1502082553048-f009c37129b9?auto=format&fit=crop&q=80&w=600',
    simulatedUsersCount: 28
  },
  {
    id: 'venue_048',
    name: 'Paradise Lost Kiambu',
    latitude: -1.1444,
    longitude: 36.8451,
    address: 'Kiambu Road, Nairobi outskirts',
    description: 'A scenic retreat featuring caves, waterfalls, boating, camel rides, and extensive picnic grounds.',
    type: 'Activity',
    imageUrl: 'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?auto=format&fit=crop&q=80&w=600',
    simulatedUsersCount: 35
  },
  {
    id: 'venue_049',
    name: 'Nairobi Arboretum',
    latitude: -1.2751,
    longitude: 36.8081,
    address: 'State House Rd, Nairobi',
    description: 'A quiet, green forest reserve with walking paths and over 350 species of trees, great for bird watching.',
    type: 'Activity',
    imageUrl: 'https://images.unsplash.com/photo-1513836279014-a89f7a76ae86?auto=format&fit=crop&q=80&w=600',
    simulatedUsersCount: 40
  },
  {
    id: 'venue_050',
    name: 'Maji Magic Aqua Park',
    latitude: -1.2091,
    longitude: 36.7972,
    address: 'Waterfront Mall, Karen',
    description: 'An exciting floating inflatable water park featuring obstacle courses and water sports activities.',
    type: 'Activity',
    imageUrl: 'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?auto=format&fit=crop&q=80&w=600',
    simulatedUsersCount: 18
  },
  {
    id: 'venue_051',
    name: 'Two Rivers Theme Park & Ferris Wheel',
    latitude: -1.2091,
    longitude: 36.7972,
    address: 'Limuru Road, Ruaka',
    description: 'Home to "Eye on Kenya" Ferris wheel, go-karts, and theme park rides, making it a perfect day out.',
    type: 'Activity',
    imageUrl: 'https://images.unsplash.com/photo-1513885045260-6b3086b24c17?auto=format&fit=crop&q=80&w=600',
    simulatedUsersCount: 55
  },

  // ─── EVENTS (23 scheduled across June and July 2026) ──────────────────────────────────
  // Note: Current Time is June 8, 2026

  // Past/Expired (Should disappear from live feed immediately)
  {
    id: 'event_001',
    name: 'Madaraka Day Celebrations',
    latitude: -1.3031,
    longitude: 36.8242,
    address: 'Nyayo National Stadium, Nairobi',
    description: 'Celebrating 63 years of self-rule with military parades, cultural dances, and leadership speeches.',
    type: 'Event',
    imageUrl: 'https://images.unsplash.com/photo-1501281668745-f7f57925c3b4?auto=format&fit=crop&q=80&w=600',
    startDate: makeTime('2026-06-01T08:00:00+03:00'),
    expirationDate: makeTime('2026-06-01T17:00:00+03:00'),
    simulatedUsersCount: 0
  },
  {
    id: 'event_002',
    name: 'IFTEX Flower Expo 2026',
    latitude: -1.2582,
    longitude: 36.8035,
    address: 'Oshwal Centre, Westlands',
    description: 'International Floriculture Trade Exhibition, showcasing Kenya\'s finest flowers to the global market.',
    type: 'Event',
    imageUrl: 'https://images.unsplash.com/photo-1596436889106-be35e843f974?auto=format&fit=crop&q=80&w=600',
    startDate: makeTime('2026-06-03T09:00:00+03:00'),
    expirationDate: makeTime('2026-06-05T18:00:00+03:00'),
    simulatedUsersCount: 0
  },
  {
    id: 'event_003',
    name: 'Nairobi City Marathon 2026',
    latitude: -1.2882,
    longitude: 36.8231,
    address: 'Nairobi Expressway, CBD Start',
    description: 'The premier athletic race running along the scenic Nairobi Expressway. High energy and major sporting event.',
    type: 'Event',
    imageUrl: 'https://images.unsplash.com/photo-1502224562085-639556652f33?auto=format&fit=crop&q=80&w=600',
    startDate: makeTime('2026-06-07T06:00:00+03:00'),
    expirationDate: makeTime('2026-06-07T14:00:00+03:00'),
    simulatedUsersCount: 0
  },
  {
    id: 'event_004',
    name: 'Blankets & Wine (June Edition)',
    latitude: -1.2991,
    longitude: 36.7291,
    address: 'Ngong Racecourse, Ngong Rd',
    description: 'Nairobi\'s popular social picnic and outdoor music festival showcasing the best live African music and culture.',
    type: 'Event',
    imageUrl: 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&q=80&w=600',
    startDate: makeTime('2026-06-07T11:00:00+03:00'),
    expirationDate: makeTime('2026-06-07T22:00:00+03:00'),
    simulatedUsersCount: 0
  },

  // Active / Ongoing (Currently active since start is June 4 and end is July 4)
  {
    id: 'event_005',
    name: 'Circle Art Gallery: Ephemerals',
    latitude: -1.2872,
    longitude: 36.7621,
    address: 'Circle Art Gallery, Lavington',
    description: 'A contemporary art exhibition by Raso Cyprian, showcasing fine sculptures and modern abstract paintings.',
    type: 'Event',
    imageUrl: 'https://images.unsplash.com/photo-1460661419201-fd4cecdf8a8b?auto=format&fit=crop&q=80&w=600',
    startDate: makeTime('2026-06-04T10:00:00+03:00'),
    expirationDate: makeTime('2026-07-04T17:00:00+03:00'),
    simulatedUsersCount: 30
  },

  // Future / Scheduled in June 2026 (Should appear in Scheduled list only, then go live on dates)
  {
    id: 'event_006',
    name: 'Kenya Food & Beverage Expo',
    latitude: -1.2562,
    longitude: 36.8015,
    address: 'Sarit Expo Centre, Westlands',
    description: 'The largest food trade show in East Africa, bringing together chefs, manufacturers, and food lovers.',
    type: 'Event',
    imageUrl: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&q=80&w=600',
    startDate: makeTime('2026-06-12T09:00:00+03:00'),
    expirationDate: makeTime('2026-06-14T18:00:00+03:00'),
    simulatedUsersCount: 45
  },
  {
    id: 'event_007',
    name: 'Koroga Festival 2026',
    latitude: -1.2091,
    longitude: 36.7972,
    address: 'Two Rivers Mall Grounds, Ruaka',
    description: 'A celebration of African music, food, and culture featuring live band sets and local culinary experts.',
    type: 'Event',
    imageUrl: 'https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?auto=format&fit=crop&q=80&w=600',
    startDate: makeTime('2026-06-14T12:00:00+03:00'),
    expirationDate: makeTime('2026-06-14T23:59:59+03:00'),
    simulatedUsersCount: 85
  },
  {
    id: 'event_008',
    name: 'Nairobi Tech Summit 2026',
    latitude: -1.2882,
    longitude: 36.8231,
    address: 'KICC, Harambee Avenue, CBD',
    description: 'Connecting innovators, developers, and tech giants across Africa to discuss AI, fintech, and future code.',
    type: 'Event',
    imageUrl: 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?auto=format&fit=crop&q=80&w=600',
    startDate: makeTime('2026-06-18T08:00:00+03:00'),
    expirationDate: makeTime('2026-06-19T18:00:00+03:00'),
    simulatedUsersCount: 110
  },
  {
    id: 'event_009',
    name: 'Sol Fest Warm-up Concert',
    latitude: -1.3251,
    longitude: 36.8021,
    address: 'Carnivore Grounds, Lang\'ata',
    description: 'An exclusive warm-up concert featuring outstanding local afro-pop bands ahead of the main Sol Fest.',
    type: 'Event',
    imageUrl: 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?auto=format&fit=crop&q=80&w=600',
    startDate: makeTime('2026-06-20T14:00:00+03:00'),
    expirationDate: makeTime('2026-06-21T04:00:00+03:00'),
    simulatedUsersCount: 120
  },
  {
    id: 'event_010',
    name: 'Nairobi Wine Week',
    latitude: -1.2625,
    longitude: 36.8039,
    address: 'Various Select Outlets, Westlands',
    description: 'A week-long celebration of global wines with tastings, masterclasses, and fine dining pairings.',
    type: 'Event',
    imageUrl: 'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?auto=format&fit=crop&q=80&w=600',
    startDate: makeTime('2026-06-22T10:00:00+03:00'),
    expirationDate: makeTime('2026-06-28T23:59:59+03:00'),
    simulatedUsersCount: 40
  },
  {
    id: 'event_011',
    name: 'Nairobi International Jazz Festival',
    latitude: -1.2991,
    longitude: 36.7291,
    address: 'Ngong Racecourse, Ngong Rd',
    description: 'An elegant evening under the stars featuring world-class jazz musicians from around the globe.',
    type: 'Event',
    imageUrl: 'https://images.unsplash.com/photo-1486591978090-58e619d37fe7?auto=format&fit=crop&q=80&w=600',
    startDate: makeTime('2026-06-26T16:00:00+03:00'),
    expirationDate: makeTime('2026-06-28T23:59:59+03:00'),
    simulatedUsersCount: 75
  },

  // Future / Scheduled in July 2026
  {
    id: 'event_012',
    name: 'Rhino Charge 2026',
    latitude: -1.3733,
    longitude: 36.8589,
    address: 'Nairobi Safari Picnic HQ',
    description: 'Annual off-road motorsport competition to raise funds for the conservation of Kenya\'s water towers.',
    type: 'Event',
    imageUrl: 'https://images.unsplash.com/photo-1534067783941-51c9c23eccfd?auto=format&fit=crop&q=80&w=600',
    startDate: makeTime('2026-07-01T06:00:00+03:00'),
    expirationDate: makeTime('2026-07-02T18:00:00+03:00'),
    simulatedUsersCount: 90
  },
  {
    id: 'event_013',
    name: 'Dance Life Festival 2026',
    latitude: -1.2782,
    longitude: 36.8188,
    address: 'Kenya National Theatre, Harry Thuku Rd',
    description: 'A three-day annual festival celebrating contemporary, traditional, and street dance arts in East Africa.',
    type: 'Event',
    imageUrl: 'https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?auto=format&fit=crop&q=80&w=600',
    startDate: makeTime('2026-07-03T14:00:00+03:00'),
    expirationDate: makeTime('2026-07-05T21:00:00+03:00'),
    simulatedUsersCount: 50
  },
  {
    id: 'event_014',
    name: 'The Millennials Cookout',
    latitude: -1.2991,
    longitude: 36.7291,
    address: 'Ngong Racecourse, Ngong Rd',
    description: 'The ultimate social cookout event with great food, live barbecue, music acts, and outdoor gaming zones.',
    type: 'Event',
    imageUrl: 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?auto=format&fit=crop&q=80&w=600',
    startDate: makeTime('2026-07-04T12:00:00+03:00'),
    expirationDate: makeTime('2026-07-04T23:59:59+03:00'),
    simulatedUsersCount: 80
  },
  {
    id: 'event_015',
    name: 'Kenya Music Festival 2026',
    latitude: -1.2782,
    longitude: 36.8188,
    address: 'Kenya National Theatre, Nairobi',
    description: 'The largest competitive music and performing arts festival showcasing student choirs and cultural groups.',
    type: 'Event',
    imageUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&q=80&w=600',
    startDate: makeTime('2026-07-10T08:00:00+03:00'),
    expirationDate: makeTime('2026-07-20T18:00:00+03:00'),
    simulatedUsersCount: 65
  },
  {
    id: 'event_016',
    name: 'Nairobi Comic Convention (Naiccon)',
    latitude: -1.2562,
    longitude: 36.8015,
    address: 'Sarit Expo Centre, Westlands',
    description: 'Nairobi\'s ultimate pop culture event featuring gaming tournaments, cosplay, comics, and art showcases.',
    type: 'Event',
    imageUrl: 'https://images.unsplash.com/photo-1568992687947-868a62a9f521?auto=format&fit=crop&q=80&w=600',
    startDate: makeTime('2026-07-11T09:00:00+03:00'),
    expirationDate: makeTime('2026-07-12T19:00:00+03:00'),
    simulatedUsersCount: 95
  },
  {
    id: 'event_017',
    name: 'Africa Pharma CEO Summit',
    latitude: -1.2682,
    longitude: 36.8091,
    address: 'Villa Rosa Kempinski, Westlands',
    description: 'High-level executive meeting bringing together pharmaceutical leaders and policy makers in Africa.',
    type: 'Event',
    imageUrl: 'https://images.unsplash.com/photo-1511556532299-8f662fc26c06?auto=format&fit=crop&q=80&w=600',
    startDate: makeTime('2026-07-15T08:00:00+03:00'),
    expirationDate: makeTime('2026-07-15T17:00:00+03:00'),
    simulatedUsersCount: 30
  },
  {
    id: 'event_018',
    name: 'Untamed Rock Concert',
    latitude: -1.2625,
    longitude: 36.8039,
    address: 'Alchemist Bar, Westlands',
    description: 'A night of high-voltage rock and metal performances by East Africa\'s top rock bands live on stage.',
    type: 'Event',
    imageUrl: 'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?auto=format&fit=crop&q=80&w=600',
    startDate: makeTime('2026-07-17T19:00:00+03:00'),
    expirationDate: makeTime('2026-07-18T03:00:00+03:00'),
    simulatedUsersCount: 60
  },
  {
    id: 'event_019',
    name: 'East Africa Art Biennale',
    latitude: -1.2862,
    longitude: 36.8198,
    address: 'Nairobi Gallery, CBD',
    description: 'Showcasing extraordinary paintings, sculptures, and conceptual art projects from across East Africa.',
    type: 'Event',
    imageUrl: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?auto=format&fit=crop&q=80&w=600',
    startDate: makeTime('2026-07-18T09:00:00+03:00'),
    expirationDate: makeTime('2026-07-30T18:00:00+03:00'),
    simulatedUsersCount: 45
  },
  {
    id: 'event_020',
    name: 'SPE Africa Geothermal Workshop',
    latitude: -1.3022,
    longitude: 36.8167,
    address: 'Radisson Blu Hotel, Upper Hill',
    description: 'A technical workshop focused on advanced drilling techniques and sustainable geothermal power production in Africa.',
    type: 'Event',
    imageUrl: 'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?auto=format&fit=crop&q=80&w=600',
    startDate: makeTime('2026-07-22T08:00:00+03:00'),
    expirationDate: makeTime('2026-07-24T17:00:00+03:00'),
    simulatedUsersCount: 40
  },
  {
    id: 'event_021',
    name: 'Nairobi Fashion Week 2026',
    latitude: -1.2882,
    longitude: 36.8231,
    address: 'KICC, CBD, Nairobi',
    description: 'Celebrating high-fashion African designers and runway models with modern, innovative collections.',
    type: 'Event',
    imageUrl: 'https://images.unsplash.com/photo-1509631179647-0177331693ae?auto=format&fit=crop&q=80&w=600',
    startDate: makeTime('2026-07-24T10:00:00+03:00'),
    expirationDate: makeTime('2026-07-26T21:00:00+03:00'),
    simulatedUsersCount: 85
  },
  {
    id: 'event_022',
    name: 'Blankets & Wine (July Edition)',
    latitude: -1.2991,
    longitude: 36.7291,
    address: 'Ngong Racecourse, Ngong Rd',
    description: 'The mid-year edition of Nairobi\'s most loved picnic festival featuring outstanding live Afrobeat artists.',
    type: 'Event',
    imageUrl: 'https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?auto=format&fit=crop&q=80&w=600',
    startDate: makeTime('2026-07-26T11:00:00+03:00'),
    expirationDate: makeTime('2026-07-26T22:00:00+03:00'),
    simulatedUsersCount: 110
  },
  {
    id: 'event_023',
    name: 'Maasai Cultural Gala',
    latitude: -1.3392,
    longitude: 36.7731,
    address: 'Bomas of Kenya, Lang\'ata',
    description: 'A spectacular showcase of traditional Maasai songs, high-jumping dance, weapons showcase, and rich cultural wisdom.',
    type: 'Event',
    imageUrl: 'https://images.unsplash.com/photo-1501281668745-f7f57925c3b4?auto=format&fit=crop&q=80&w=600',
    startDate: makeTime('2026-07-31T10:00:00+03:00'),
    expirationDate: makeTime('2026-07-31T23:59:59+03:00'),
    simulatedUsersCount: 75
  }
];

async function seedVenues() {
  const batch = db.batch();

  console.log(`Starting migration/seeding of ${NAIROBI_VENUES.length} items to Firestore...`);

  for (const venue of NAIROBI_VENUES) {
    const docRef = db.collection('venues').doc(venue.id);
    batch.set(docRef, venue, { merge: true });
    console.log(`- Queued ${venue.name} (${venue.type}) [ID: ${venue.id}]`);
  }

  await batch.commit();
  console.log(`\n✅ Successfully seeded ${NAIROBI_VENUES.length} Nairobi venues and events to Firestore!`);
  process.exit(0);
}

seedVenues().catch((err) => {
  console.error('❌ Seeding failed:', err);
  process.exit(1);
});
