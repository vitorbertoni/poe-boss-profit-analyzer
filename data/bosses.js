// Uber pinnacle boss data for Path of Exile 1.
// Drop rates are community estimates published on poewiki.net (pulled Oct 2026, game version 3.29).
// GGG does not publish official drop rates — every number here can be overridden in the UI.
//
// Price refs point at poe.ninja's PoE1 economy API:
//   "x:<Type>:<id>" -> /poe1/api/economy/exchange/current/overview?type=<Type>   (stackables)
//   "s:<Type>:<id>" -> /poe1/api/economy/stash/current/item/overview?type=<Type>  (uniques, gems)
// A ref can also be an array, in which case the average of the listed prices is used.
// ref: null means poe.ninja has no listing for the item; the UI lets the user type a price.
// p / w are percentages. p: null means the wiki lists the drop without an estimated rate.

const X = (type, id) => `x:${type}:${id}`;
const S = (type, id) => `s:${type}:${id}`;
const cur = (id) => X('Currency', id);
const frag = (id) => X('Fragment', id);
const card = (id) => X('DivinationCard', id);
const gem = (id) => S('SkillGem', `${id}-1`); // level 1 / 0% quality, as dropped
const jewel = (id) => S('UniqueJewel', id);
const wep = (id) => S('UniqueWeapon', id);
const arm = (id) => S('UniqueArmour', id);
const acc = (id) => S('UniqueAccessory', id);
const flask = (id) => S('UniqueFlask', id);

const NO_PRICE = null;

const ELDRITCH_CURRENCY = [
  { name: 'Eldritch Orb of Annulment', ref: cur('eldritch-orb-of-annulment'), p: 5 },
  { name: 'Eldritch Chaos Orb', ref: cur('eldritch-chaos-orb'), p: 5 },
  { name: 'Eldritch Exalted Orb', ref: cur('eldritch-exalted-orb'), p: 5 },
];

const ASTROLABES = {
  kind: 'pick',
  label: 'Astrolabe (guaranteed)',
  items: [
    { name: 'Templar Astrolabe', ref: X('Astrolabe', 'templar-astrolabe'), w: 33 },
    ...['deceptive', 'fruiting', 'grasping', 'lightless', 'timeless', 'chaotic', 'fungal', 'nameless', 'runic'].map(
      (k) => ({
        name: `${k[0].toUpperCase()}${k.slice(1)} Astrolabe`,
        ref: X('Astrolabe', `${k}-astrolabe`),
        w: 7.5,
      }),
    ),
  ],
};

const BOUND_BY_DESTINY = { name: 'Bound by Destiny', ref: NO_PRICE, p: 10, note: 'Divination card not tracked by poe.ninja' };

export const BOSSES = [
  {
    id: 'eater',
    name: 'Uber Eater of Worlds',
    fragment: { name: 'Devouring Fragment', ref: frag('devouring-fragment'), qty: 4 },
    wiki: 'The_Eater_of_Worlds',
    sample: 'n≈695 kills, 3.26–3.27',
    groups: [
      {
        kind: 'pick',
        label: 'Guaranteed unique',
        items: [
          { name: 'Ravenous Passion', ref: arm('ravenous-passion-zealot-helmet'), w: 68 },
          { name: 'Ashes of the Stars', ref: acc('ashes-of-the-stars-onyx-amulet'), w: 30 },
          { name: 'Nimis', ref: acc('nimis-topaz-ring'), w: 2 },
        ],
      },
      {
        kind: 'each',
        label: 'Encounter-specific',
        items: [
          { name: 'Forbidden Flesh (Hidden Ascendancy)', ref: jewel('forbidden-flesh-cobalt-jewel'), p: null, note: 'Unidentified price' },
          { name: 'Visceral Reliquary Key', ref: NO_PRICE, p: 1 },
          { name: 'Curio of Consumption', ref: acc('curio-of-consumption-primordial-fragment'), p: 5 },
        ],
      },
      {
        kind: 'each',
        label: 'Additional drops',
        items: [
          { name: 'Forbidden Flesh', ref: jewel('forbidden-flesh-cobalt-jewel'), p: 5, note: 'Unidentified price' },
          { name: 'Exceptional Eldritch Ichor', ref: cur('exceptional-eldritch-ichor'), p: 15 },
          ...ELDRITCH_CURRENCY,
          { name: 'Gluttony Support', ref: gem('gluttony-support'), p: null },
          { name: 'Auspicious Ambitions', ref: NO_PRICE, p: null },
        ],
      },
    ],
  },
  {
    id: 'exarch',
    name: 'Uber Searing Exarch',
    fragment: { name: 'Blazing Fragment', ref: frag('blazing-fragment'), qty: 4 },
    wiki: 'The_Searing_Exarch',
    sample: 'n≈650 kills, 3.26',
    groups: [
      {
        kind: 'pick',
        label: 'Guaranteed unique',
        items: [
          { name: 'The Annihilating Light', ref: wep('the-annihilating-light-quarterstaff'), w: 45.5 },
          { name: "Annihilation's Approach", ref: arm('annihilations-approach-dragonscale-boots'), w: 29 },
          { name: 'Crystallised Omniscience', ref: acc('crystallised-omniscience-onyx-amulet'), w: 24 },
          { name: 'The Celestial Brace', ref: arm('the-celestial-brace-goliath-gauntlets'), w: 1.5 },
        ],
      },
      {
        kind: 'each',
        label: 'Encounter-specific',
        items: [
          { name: 'Forbidden Flame (Hidden Ascendancy)', ref: jewel('forbidden-flame-crimson-jewel'), p: null, note: 'Unidentified price' },
          { name: 'Archive Reliquary Key', ref: NO_PRICE, p: 1.5 },
          { name: 'Curio of Absorption', ref: acc('curio-of-absorption-primordial-fragment'), p: 5 },
        ],
      },
      {
        kind: 'each',
        label: 'Additional drops',
        items: [
          { name: 'Forbidden Flame', ref: jewel('forbidden-flame-crimson-jewel'), p: 5, note: 'Unidentified price' },
          { name: 'Exceptional Eldritch Ember', ref: cur('exceptional-eldritch-ember'), p: 15 },
          ...ELDRITCH_CURRENCY,
          { name: 'Overheat Support', ref: gem('overheat-support'), p: null },
          { name: 'Auspicious Ambitions', ref: NO_PRICE, p: 0.5 },
        ],
      },
    ],
  },
  {
    id: 'shaper',
    name: 'Uber Shaper',
    fragment: { name: 'Cosmic Fragment', ref: frag('cosmic-fragment'), qty: 4 },
    wiki: 'The_Shaper',
    sample: 'n≈160 kills (3.29); additional drops n≈14,325',
    groups: [
      {
        kind: 'pick',
        label: 'Guaranteed unique',
        items: [
          { name: 'Echoes of Creation', ref: arm('echoes-of-creation-royal-burgonet'), w: 32 },
          { name: 'Entropic Devastation', ref: arm('entropic-devastation-assassins-mitts'), w: 31 },
          { name: 'The Unblinking Eye', ref: arm('the-unblinking-eye-harlequin-mask'), w: 19 },
          { name: 'The Tides of Time', ref: acc('the-tides-of-time-vanguard-belt'), w: 16 },
          { name: 'Starforge', ref: wep('starforge-infernal-sword'), w: 2 },
        ],
      },
      {
        kind: 'each',
        label: 'Encounter-specific',
        items: [
          { name: 'Sublime Vision', ref: jewel('sublime-vision-prismatic-jewel'), p: 2 },
          { name: 'Cosmic Reliquary Key', ref: NO_PRICE, p: 1 },
        ],
      },
      {
        kind: 'pick',
        label: 'Shaper fragment (guaranteed)',
        items: [
          { name: 'Fragment of Knowledge', ref: frag('fragment-of-knowledge'), w: 50 },
          { name: 'Fragment of Shape', ref: frag('fragment-of-shape'), w: 50 },
        ],
      },
      {
        kind: 'each',
        label: 'Additional drops',
        items: [
          { name: 'Voidstorm Support', ref: gem('voidstorm-support'), p: 10 },
          { name: "Shaper's Exalted Orb", ref: cur('shapers-exalted-orb'), p: 13 },
          { name: 'Orb of Dominance', ref: cur('mavens-orb'), p: 3 },
        ],
      },
    ],
  },
  {
    id: 'uber-elder',
    name: 'Uber Uber Elder',
    fragment: { name: 'Decaying Fragment', ref: frag('decaying-fragment'), qty: 4 },
    wiki: 'Uber_Elder',
    sample: 'n≈1,738 kills, 3.28–3.29',
    groups: [
      {
        kind: 'pick',
        label: 'Guaranteed unique',
        items: [
          { name: 'Call of the Void', ref: acc('call-of-the-void-sapphire-ring'), w: 46 },
          { name: 'The Devourer of Minds', ref: arm('the-devourer-of-minds-pig-faced-bascinet'), w: 28.5 },
          {
            name: 'Impresence (full power)',
            ref: ['chaos', 'physical', 'fire', 'lightning', 'cold'].map((e) => acc(`impresence-${e}-onyx-amulet`)),
            w: 10,
            note: 'Average of the five element variants',
          },
          { name: 'Soul Ascension', ref: arm('soul-ascension-carnal-mitts'), w: 9 },
          { name: 'The Eternity Shroud', ref: arm('the-eternity-shroud-blood-raiment'), w: 5 },
          { name: 'Voidforge', ref: wep('voidforge-infernal-sword'), w: 1.5 },
        ],
      },
      {
        kind: 'each',
        label: 'Encounter-specific',
        items: [
          { name: 'Sublime Vision', ref: jewel('sublime-vision-prismatic-jewel'), p: 1.5 },
          { name: 'Decaying Reliquary Key', ref: NO_PRICE, p: 1.5 },
          { name: 'Curio of Decay', ref: acc('curio-of-decay-primordial-fragment'), p: 5 },
        ],
      },
      {
        kind: 'each',
        label: 'Additional drops',
        items: [
          { name: 'Void Shockwave Support', ref: gem('void-shockwave-support'), p: 10 },
          { name: "Watcher's Eye (3 mod)", ref: jewel('watchers-eye-prismatic-jewel'), p: 35, note: 'Unidentified price' },
          { name: "Shaper's Exalted Orb", ref: cur('shapers-exalted-orb'), p: 13 },
          { name: "Elder's Exalted Orb", ref: cur('elders-exalted-orb'), p: 13 },
          { name: 'Orb of Dominance', ref: cur('mavens-orb'), p: 6 },
          { name: 'Void of the Elements', ref: NO_PRICE, p: 1, note: 'Divination card not tracked by poe.ninja' },
          { name: 'Auspicious Ambitions', ref: NO_PRICE, p: 0.25 },
        ],
      },
    ],
  },
  {
    id: 'sirus',
    name: 'Uber Sirus',
    fragment: { name: 'Awakening Fragment', ref: frag('awakening-fragment'), qty: 4 },
    wiki: 'Sirus,_Awakener_of_Worlds',
    sample: 'n≈1,196 kills, 3.29',
    groups: [
      {
        kind: 'pick',
        label: 'Guaranteed unique',
        items: [
          {
            name: 'Thread of Hope (Massive Ring)',
            ref: jewel('thread-of-hope-crimson-jewel'),
            w: 44,
            note: 'poe.ninja does not split ring sizes',
          },
          { name: 'The Tempest Rising', ref: arm('the-tempest-rising-goliath-greaves'), w: 28 },
          { name: "Zana's Ingenuity", ref: acc('zanas-ingenuity-prismatic-ring'), w: 18 },
          { name: "Oriath's End", ref: flask('oriaths-end'), w: 9 },
          { name: 'The Saviour', ref: wep('the-saviour-legion-sword'), w: 1 },
        ],
      },
      {
        kind: 'each',
        label: 'Encounter-specific',
        items: [{ name: 'Oubliette Reliquary Key', ref: NO_PRICE, p: 1.5 }],
      },
      {
        kind: 'each',
        label: 'Additional drops',
        items: [
          { name: 'Annihilation Support', ref: gem('annihilation-support'), p: 7 },
          { name: 'Orb of Dominance', ref: cur('mavens-orb'), p: 5 },
          { name: "Awakener's Orb", ref: cur('awakeners-orb'), p: 20 },
          { name: 'A Fate Worse Than Death', ref: card('a-fate-worse-than-death'), p: 4 },
        ],
      },
    ],
  },
  {
    id: 'maven',
    name: 'Uber Maven',
    fragment: { name: 'Reality Fragment', ref: frag('reality-fragment'), qty: 4 },
    wiki: 'The_Maven',
    sample: 'n≈2,641 kills, 3.28',
    groups: [
      {
        kind: 'pick',
        label: 'Guaranteed unique',
        items: [
          { name: "Viridi's Veil", ref: arm('viridis-veil-praetor-crown'), w: 52 },
          { name: 'Impossible Escape', ref: jewel('impossible-escape-viridian-jewel'), w: 31.5, note: 'Unidentified price' },
          { name: 'Grace of the Goddess', ref: wep('grace-of-the-goddess-prophecy-wand'), w: 14 },
          { name: 'Progenesis', ref: flask('progenesis'), w: 2.5 },
        ],
      },
      {
        kind: 'each',
        label: 'Encounter-specific',
        items: [
          { name: 'Awakened Empower Support', ref: gem('awakened-empower-support'), p: 0.6 },
          { name: 'Awakened Enhance Support', ref: gem('awakened-enhance-support'), p: 1 },
          { name: 'Awakened Enlighten Support', ref: gem('awakened-enlighten-support'), p: 0.5 },
          { name: 'Eclipse Support', ref: gem('eclipse-support'), p: 2 },
          { name: 'Shiny Reliquary Key', ref: NO_PRICE, p: 0.7 },
          { name: 'Curio of Potential', ref: acc('curio-of-potential-primordial-fragment'), p: 5 },
        ],
      },
      {
        kind: 'each',
        label: 'Additional drops',
        items: [
          { name: 'Invert the Rules Support', ref: gem('invert-the-rules-support'), p: 10 },
          { name: 'Orb of Conflict', ref: cur('orb-of-conflict'), p: 32 },
          { name: 'Auspicious Ambitions', ref: NO_PRICE, p: 0.025 },
        ],
      },
    ],
  },
  {
    id: 'venarius',
    name: 'Uber Venarius',
    fragment: { name: 'Synthesising Fragment', ref: frag('synthesising-fragment'), qty: 4 },
    wiki: 'Venarius',
    sample: 'n≈315 kills, 3.28',
    note: 'Uniques drop synthesised with three implicits; prices shown are for the regular item.',
    groups: [
      {
        kind: 'pick',
        label: 'Guaranteed unique',
        items: [
          { name: 'Nebulis', ref: wep('nebulis-void-sceptre'), w: 34 },
          { name: 'Mask of the Tribunal', ref: arm('mask-of-the-tribunal-magistrate-crown'), w: 34 },
          { name: 'Circle of Ambition', ref: acc('circle-of-ambition-prismatic-ring'), w: 19 },
          { name: 'The Apostate', ref: arm('the-apostate-cabalist-regalia'), w: 8 },
          { name: 'Rational Doctrine', ref: jewel('rational-doctrine-cobalt-jewel'), w: 5 },
        ],
      },
      {
        kind: 'each',
        label: 'Encounter-specific',
        items: [{ name: 'Forgotten Reliquary Key', ref: NO_PRICE, p: 1.5 }],
      },
      {
        kind: 'each',
        label: 'Additional drops',
        items: [
          { name: 'Greater Kinetic Instability Support', ref: gem('greater-kinetic-instability-support'), p: 10 },
          { name: 'The Hook', ref: card('the-hook'), p: 5 },
          { name: 'Imperfect Memories', ref: card('imperfect-memories'), p: 0.25 },
        ],
      },
    ],
  },
  {
    id: 'neglect',
    name: 'Uber Incarnation of Neglect',
    fragment: { name: 'Lonely Fragment', ref: frag('lonely-fragment'), qty: 4 },
    wiki: 'Incarnation_of_Neglect',
    sample: 'n≈1,065 kills, 3.26–3.27',
    groups: [
      {
        kind: 'pick',
        label: 'Guaranteed unique',
        items: [
          { name: 'Refuge in Isolation', ref: arm('refuge-in-isolation-paladin-crown'), w: 55 },
          { name: 'Bitter Instinct', ref: arm('bitter-instinct-spiny-round-shield'), w: 30 },
          { name: 'Haunting Memories', ref: acc('haunting-memories-turquoise-amulet'), w: 13 },
          { name: 'Festering Resentment', ref: wep('festering-resentment-demon-dagger'), w: 2 },
        ],
      },
      {
        kind: 'each',
        label: 'Encounter-specific',
        items: [{ name: 'Lonely Reliquary Key', ref: NO_PRICE, p: 1 }],
      },
      ASTROLABES,
      {
        kind: 'each',
        label: 'Additional drops',
        items: [
          BOUND_BY_DESTINY,
          { name: 'Frostmage Support', ref: gem('frostmage-support'), p: 5 },
          { name: 'Orb of Remembrance', ref: cur('orb-of-remembrance'), p: 33 },
          { name: 'Monochrome', ref: card('monochrome'), p: 3 },
        ],
      },
    ],
  },
  {
    id: 'fear',
    name: 'Uber Incarnation of Fear',
    fragment: { name: 'Traumatic Fragment', ref: frag('traumatic-fragment'), qty: 4 },
    wiki: 'Incarnation_of_Fear',
    sample: 'n≈1,000 kills, 3.28–3.29',
    groups: [
      {
        kind: 'pick',
        label: 'Guaranteed unique',
        items: [
          { name: 'The Caged Mammoth', ref: arm('the-caged-mammoth-antique-gauntlets'), w: 60 },
          { name: 'Coiling Whisper', ref: acc('coiling-whisper-amethyst-ring'), w: 36 },
          { name: 'Wing of the Wyvern', ref: wep('wing-of-the-wyvern-imperial-bow'), w: 2 },
          { name: 'Woespike', ref: acc('woespike-steel-ring'), w: 2 },
        ],
      },
      {
        kind: 'each',
        label: 'Encounter-specific',
        items: [{ name: 'Traumatic Reliquary Key', ref: NO_PRICE, p: 1 }],
      },
      ASTROLABES,
      {
        kind: 'each',
        label: 'Additional drops',
        items: [
          BOUND_BY_DESTINY,
          { name: 'Greater Devour Support', ref: gem('greater-devour-support'), p: 5 },
          { name: 'Orb of Intention', ref: cur('orb-of-intention'), p: 50 },
        ],
      },
    ],
  },
  {
    id: 'dread',
    name: 'Uber Incarnation of Dread',
    fragment: { name: 'Reverent Fragment', ref: frag('reverent-fragment'), qty: 4 },
    wiki: 'Incarnation_of_Dread',
    sample: 'n≈95 kills, 3.27 (small sample)',
    groups: [
      {
        kind: 'pick',
        label: 'Guaranteed unique',
        items: [
          { name: 'The Hallowed Monarch', ref: arm('the-hallowed-monarch-faithful-helmet'), w: 54 },
          { name: 'Whispers of Infinity', ref: acc('whispers-of-infinity-seaglass-amulet'), w: 30 },
          { name: 'Wellwater Phylactery', ref: flask('wellwater-phylactery'), w: 14 },
          { name: 'The Golden Charlatan', ref: wep('the-golden-charlatan-lion-sword'), w: 2 },
        ],
      },
      {
        kind: 'each',
        label: 'Encounter-specific',
        items: [{ name: 'Reverent Reliquary Key', ref: NO_PRICE, p: 1 }],
      },
      ASTROLABES,
      {
        kind: 'each',
        label: 'Additional drops',
        items: [
          BOUND_BY_DESTINY,
          { name: 'Congregation Support', ref: gem('congregation-support'), p: null },
          { name: 'Orb of Unravelling', ref: cur('orb-of-unravelling'), p: 33 },
        ],
      },
    ],
  },
];

// Every poe.ninja ref the app needs, grouped by endpoint + type (used by the API route).
export function collectRefs() {
  const refs = new Set();
  const add = (r) => (Array.isArray(r) ? r.forEach(add) : r && refs.add(r));
  for (const b of BOSSES) {
    add(b.fragment.ref);
    for (const g of b.groups) for (const it of g.items) add(it.ref);
  }
  return [...refs];
}
