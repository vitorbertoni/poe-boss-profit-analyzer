// Boss data for Path of Exile 1: uber pinnacles, regular pinnacles and other fragment bosses.
// Drop rates are community estimates published on poewiki.net (pulled Oct–Nov 2026, game version 3.29).
// GGG does not publish official drop rates — every number here can be overridden in the UI.
//
// Price refs point at poe.ninja's PoE1 economy API:
//   "x:<Type>:<id>" -> /poe1/api/economy/exchange/current/overview?type=<Type>   (stackables)
//   "s:<Type>:<id>" -> /poe1/api/economy/stash/current/item/overview?type=<Type>  (uniques, gems, invitations, maps)
// A ref can also be an array, in which case the average of the listed prices is used.
// ref: null means poe.ninja has no listing for the item; the UI lets the user type a price.
// p / w are percentages. p: null means the wiki lists the drop without an estimated rate.
//
// tier: 'uber' (uber pinnacle) | 'pinnacle' (regular pinnacle) | 'other' (other fragment bosses)
// entry: everything consumed to open one attempt. entryLabel is the short name shown on cards.
// Keep the uber boss ids and group order stable: saved user edits are keyed by `${id}/${group}:${item}`.

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
const invite = (id) => S('Invitation', id);

const NO_PRICE = null;
const one = (name, ref) => [{ name, ref, qty: 1 }];
const four = (name, ref) => [{ name, ref, qty: 4 }];

// ---------- shared drop lists ----------

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

const IMPRESENCE = ['chaos', 'physical', 'fire', 'lightning', 'cold'].map((e) => acc(`impresence-${e}-onyx-amulet`));

const SHAPER_FRAGMENT = {
  kind: 'pick',
  label: 'Shaper fragment (guaranteed)',
  items: [
    { name: 'Fragment of Knowledge', ref: frag('fragment-of-knowledge'), w: 50 },
    { name: 'Fragment of Shape', ref: frag('fragment-of-shape'), w: 50 },
  ],
};

// "Additional drops" rows the wiki lists for both the regular and the uber version of a boss.
const EATER_EXTRA = (auspicious) => ({
  kind: 'each',
  label: 'Additional drops',
  items: [
    { name: 'Forbidden Flesh', ref: jewel('forbidden-flesh-cobalt-jewel'), p: 5, note: 'Unidentified price' },
    { name: 'Exceptional Eldritch Ichor', ref: cur('exceptional-eldritch-ichor'), p: 15 },
    ...ELDRITCH_CURRENCY,
    { name: 'Gluttony Support', ref: gem('gluttony-support'), p: null },
    { name: 'Auspicious Ambitions', ref: NO_PRICE, p: auspicious },
  ],
});
const EXARCH_EXTRA = {
  kind: 'each',
  label: 'Additional drops',
  items: [
    { name: 'Forbidden Flame', ref: jewel('forbidden-flame-crimson-jewel'), p: 5, note: 'Unidentified price' },
    { name: 'Exceptional Eldritch Ember', ref: cur('exceptional-eldritch-ember'), p: 15 },
    ...ELDRITCH_CURRENCY,
    { name: 'Overheat Support', ref: gem('overheat-support'), p: null },
    { name: 'Auspicious Ambitions', ref: NO_PRICE, p: 0.5 },
  ],
};
const SHAPER_EXTRA = {
  kind: 'each',
  label: 'Additional drops',
  items: [
    { name: 'Voidstorm Support', ref: gem('voidstorm-support'), p: 10 },
    { name: "Shaper's Exalted Orb", ref: cur('shapers-exalted-orb'), p: 13 },
    { name: 'Orb of Dominance', ref: cur('mavens-orb'), p: 3 },
  ],
};
const UBER_ELDER_EXTRA = {
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
};
const SIRUS_EXTRA = {
  kind: 'each',
  label: 'Additional drops',
  items: [
    { name: 'Annihilation Support', ref: gem('annihilation-support'), p: 7 },
    { name: 'Orb of Dominance', ref: cur('mavens-orb'), p: 5 },
    { name: "Awakener's Orb", ref: cur('awakeners-orb'), p: 20 },
    { name: 'A Fate Worse Than Death', ref: card('a-fate-worse-than-death'), p: 4 },
  ],
};
const MAVEN_EXTRA = {
  kind: 'each',
  label: 'Additional drops',
  items: [
    { name: 'Invert the Rules Support', ref: gem('invert-the-rules-support'), p: 10 },
    { name: 'Orb of Conflict', ref: cur('orb-of-conflict'), p: 32 },
    { name: 'Auspicious Ambitions', ref: NO_PRICE, p: 0.025 },
  ],
};
const VENARIUS_EXTRA = {
  kind: 'each',
  label: 'Additional drops',
  items: [
    { name: 'Greater Kinetic Instability Support', ref: gem('greater-kinetic-instability-support'), p: 10 },
    { name: 'The Hook', ref: card('the-hook'), p: 5 },
    { name: 'Imperfect Memories', ref: card('imperfect-memories'), p: 0.25 },
  ],
};
const NEGLECT_EXTRA = {
  kind: 'each',
  label: 'Additional drops',
  items: [
    BOUND_BY_DESTINY,
    { name: 'Frostmage Support', ref: gem('frostmage-support'), p: 5 },
    { name: 'Orb of Remembrance', ref: cur('orb-of-remembrance'), p: 33 },
    { name: 'Monochrome', ref: card('monochrome'), p: 3 },
  ],
};
const FEAR_EXTRA = {
  kind: 'each',
  label: 'Additional drops',
  items: [
    BOUND_BY_DESTINY,
    { name: 'Greater Devour Support', ref: gem('greater-devour-support'), p: 5 },
    { name: 'Orb of Intention', ref: cur('orb-of-intention'), p: 50 },
  ],
};
const DREAD_EXTRA = {
  kind: 'each',
  label: 'Additional drops',
  items: [
    BOUND_BY_DESTINY,
    { name: 'Congregation Support', ref: gem('congregation-support'), p: null },
    { name: 'Orb of Unravelling', ref: cur('orb-of-unravelling'), p: 33 },
  ],
};

const SYNTH_NOTE = 'Uniques drop synthesised with three implicits; prices shown are for the regular item.';
const QUANT_NOTE = 'Additional drops scale with map item quantity; rates shown are for a plain map.';

// ---------- uber pinnacles ----------

const UBERS = [
  {
    id: 'eater',
    name: 'Uber Eater of Worlds',
    entry: four('Devouring Fragment', frag('devouring-fragment')),
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
      EATER_EXTRA(null),
    ],
  },
  {
    id: 'exarch',
    name: 'Uber Searing Exarch',
    entry: four('Blazing Fragment', frag('blazing-fragment')),
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
      EXARCH_EXTRA,
    ],
  },
  {
    id: 'shaper',
    name: 'Uber Shaper',
    entry: four('Cosmic Fragment', frag('cosmic-fragment')),
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
      SHAPER_FRAGMENT,
      SHAPER_EXTRA,
    ],
  },
  {
    id: 'uber-elder',
    name: 'Uber Uber Elder',
    entry: four('Decaying Fragment', frag('decaying-fragment')),
    wiki: 'Uber_Elder',
    sample: 'n≈1,738 kills, 3.28–3.29',
    groups: [
      {
        kind: 'pick',
        label: 'Guaranteed unique',
        items: [
          { name: 'Call of the Void', ref: acc('call-of-the-void-sapphire-ring'), w: 46 },
          { name: 'The Devourer of Minds', ref: arm('the-devourer-of-minds-pig-faced-bascinet'), w: 28.5 },
          { name: 'Impresence (full power)', ref: IMPRESENCE, w: 10, note: 'Average of the five element variants' },
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
      UBER_ELDER_EXTRA,
    ],
  },
  {
    id: 'sirus',
    name: 'Uber Sirus',
    entry: four('Awakening Fragment', frag('awakening-fragment')),
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
      SIRUS_EXTRA,
    ],
  },
  {
    id: 'maven',
    name: 'Uber Maven',
    entry: four('Reality Fragment', frag('reality-fragment')),
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
      MAVEN_EXTRA,
    ],
  },
  {
    id: 'venarius',
    name: 'Uber Venarius',
    entry: four('Synthesising Fragment', frag('synthesising-fragment')),
    wiki: 'Venarius',
    sample: 'n≈315 kills, 3.28',
    note: SYNTH_NOTE,
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
      VENARIUS_EXTRA,
    ],
  },
  {
    id: 'neglect',
    name: 'Uber Incarnation of Neglect',
    entry: four('Lonely Fragment', frag('lonely-fragment')),
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
      NEGLECT_EXTRA,
    ],
  },
  {
    id: 'fear',
    name: 'Uber Incarnation of Fear',
    entry: four('Traumatic Fragment', frag('traumatic-fragment')),
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
      FEAR_EXTRA,
    ],
  },
  {
    id: 'dread',
    name: 'Uber Incarnation of Dread',
    entry: four('Reverent Fragment', frag('reverent-fragment')),
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
      DREAD_EXTRA,
    ],
  },
].map((b) => ({ ...b, tier: 'uber', entryLabel: `${b.entry[0].qty}× ${b.entry[0].name}` }));

// ---------- regular pinnacles ----------

const PINNACLES = [
  {
    id: 'eater-normal',
    name: 'The Eater of Worlds',
    entry: one('Screaming Invitation', invite('screaming-invitation')),
    wiki: 'The_Eater_of_Worlds',
    sample: 'n≈625 kills, 3.26–3.27',
    note: QUANT_NOTE,
    groups: [
      {
        kind: 'pick',
        label: 'Guaranteed unique',
        items: [
          { name: 'Inextricable Fate', ref: arm('inextricable-fate-fugitive-boots'), w: 55 },
          { name: 'The Gluttonous Tide', ref: wep('the-gluttonous-tide-citadel-bow'), w: 43 },
          { name: 'Melding of the Flesh', ref: jewel('melding-of-the-flesh-cobalt-jewel'), w: 2 },
        ],
      },
      EATER_EXTRA(null),
    ],
  },
  {
    id: 'exarch-normal',
    name: 'The Searing Exarch',
    entry: one('Incandescent Invitation', invite('incandescent-invitation')),
    wiki: 'The_Searing_Exarch',
    sample: 'n≈317 kills, 3.26',
    note: QUANT_NOTE,
    groups: [
      {
        kind: 'pick',
        label: 'Guaranteed unique',
        items: [
          { name: 'Dawnbreaker', ref: arm('dawnbreaker-colossal-tower-shield'), w: 63 },
          { name: 'Dawnstrider', ref: arm('dawnstrider-vaal-greaves'), w: 35 },
          { name: 'Dissolution of the Flesh', ref: jewel('dissolution-of-the-flesh-crimson-jewel'), w: 2 },
        ],
      },
      EXARCH_EXTRA,
    ],
  },
  {
    id: 'shaper-normal',
    name: 'The Shaper',
    entryLabel: 'Key to the Crucible (4 fragments)',
    entry: [
      { name: 'Fragment of the Hydra', ref: frag('hydra'), qty: 1 },
      { name: 'Fragment of the Chimera', ref: frag('chimer'), qty: 1 },
      { name: 'Fragment of the Minotaur', ref: frag('minot'), qty: 1 },
      { name: 'Fragment of the Phoenix', ref: frag('phoenix'), qty: 1 },
    ],
    wiki: 'The_Shaper',
    sample: 'n≈538 kills, 3.24–3.27',
    groups: [
      {
        kind: 'pick',
        label: 'Guaranteed unique',
        items: [
          { name: "Shaper's Touch", ref: arm('shapers-touch-crusader-gloves'), w: 56 },
          { name: 'Voidwalker', ref: arm('voidwalker-murder-boots'), w: 30 },
          { name: 'Solstice Vigil', ref: acc('solstice-vigil-onyx-amulet'), w: 11 },
          { name: 'Dying Sun', ref: flask('dying-sun'), w: 3 },
        ],
      },
      SHAPER_FRAGMENT,
      SHAPER_EXTRA,
    ],
  },
  {
    id: 'elder-normal',
    name: 'The Elder',
    entryLabel: 'Key to Decay (4 fragments)',
    entry: [
      { name: 'Fragment of Purification', ref: frag('fragment-of-purification'), qty: 1 },
      { name: 'Fragment of Constriction', ref: frag('fragment-of-constriction'), qty: 1 },
      { name: 'Fragment of Eradication', ref: frag('fragment-of-eradication'), qty: 1 },
      { name: 'Fragment of Enslavement', ref: frag('fragment-of-enslavement'), qty: 1 },
    ],
    wiki: 'The_Elder',
    sample: 'n≈845 kills, 3.25–3.27',
    groups: [
      {
        kind: 'pick',
        label: 'Guaranteed unique',
        items: [
          { name: 'Cyclopean Coil', ref: acc('cyclopean-coil-leather-belt'), w: 30 },
          { name: "Blasphemer's Grasp", ref: arm('blasphemers-grasp-assassins-mitts'), w: 26 },
          { name: 'Impresence (any)', ref: IMPRESENCE, w: 20, note: 'Average of the five element variants' },
          { name: 'Hopeshredder', ref: wep('hopeshredder-ranger-bow'), w: 8 },
          { name: 'Nebuloch', ref: wep('nebuloch-nightmare-mace'), w: 8 },
          { name: 'Shimmeron', ref: wep('shimmeron-tornado-wand'), w: 8 },
        ],
      },
      {
        kind: 'pick',
        label: 'Elder fragment (guaranteed)',
        items: [
          { name: 'Fragment of Terror', ref: frag('fragment-of-terror'), w: 50 },
          { name: 'Fragment of Emptiness', ref: frag('fragment-of-emptiness'), w: 50 },
        ],
      },
      {
        kind: 'each',
        label: 'Additional drops',
        items: [
          { name: "Watcher's Eye (2 mod)", ref: jewel('watchers-eye-prismatic-jewel'), p: 40, note: 'Generic unidentified Watcher\'s Eye price' },
          { name: "Elder's Exalted Orb", ref: cur('elders-exalted-orb'), p: 12 },
          { name: 'Eldritch Blasphemy Support', ref: gem('eldritch-blasphemy-support'), p: 10 },
          { name: 'Orb of Dominance', ref: cur('mavens-orb'), p: 2 },
          { name: 'Void of the Elements', ref: NO_PRICE, p: 0.5, note: 'Divination card not tracked by poe.ninja' },
        ],
      },
    ],
  },
  {
    id: 'uber-elder-normal',
    name: 'Uber Elder',
    entryLabel: 'Maddening Object (4 fragments)',
    entry: [
      { name: 'Fragment of Knowledge', ref: frag('fragment-of-knowledge'), qty: 1 },
      { name: 'Fragment of Shape', ref: frag('fragment-of-shape'), qty: 1 },
      { name: 'Fragment of Emptiness', ref: frag('fragment-of-emptiness'), qty: 1 },
      { name: 'Fragment of Terror', ref: frag('fragment-of-terror'), qty: 1 },
    ],
    wiki: 'Uber_Elder',
    sample: 'n≈429 kills, 3.24–3.27',
    groups: [
      {
        kind: 'pick',
        label: 'Guaranteed unique',
        items: [
          { name: 'Mark of the Shaper', ref: acc('mark-of-the-shaper-opal-ring'), w: 35 },
          { name: 'Mark of the Elder', ref: acc('mark-of-the-elder-steel-ring'), w: 35 },
          {
            name: 'Voidfletcher',
            ref: ['penetrating-arrow', 'ornate', 'primal-arrow'].map((b) => arm(`voidfletcher-${b}-quiver`)),
            w: 20,
            note: 'Average of the quiver bases',
          },
          { name: 'Indigon', ref: arm('indigon-hubris-circlet'), w: 8 },
          { name: 'Disintegrator', ref: wep('disintegrator-maelstrom-staff'), w: 2 },
        ],
      },
      UBER_ELDER_EXTRA,
    ],
  },
  {
    id: 'sirus-normal',
    name: 'Sirus, Awakener of Worlds',
    entryLabel: 'Crest of the Elderslayers (4 crests)',
    entry: [
      { name: "Al-Hezmin's Crest", ref: frag('al-hezmins-crest'), qty: 1 },
      { name: "Baran's Crest", ref: frag('barans-crest'), qty: 1 },
      { name: "Drox's Crest", ref: frag('droxs-crest'), qty: 1 },
      { name: "Veritania's Crest", ref: frag('veritanias-crest'), qty: 1 },
    ],
    wiki: 'Sirus,_Awakener_of_Worlds',
    sample: 'n≈260 kills, 3.28',
    groups: [
      {
        kind: 'pick',
        label: 'Guaranteed unique',
        items: [
          { name: 'Hands of the High Templar', ref: arm('hands-of-the-high-templar-crusader-gloves'), w: 43 },
          { name: 'Crown of the Inward Eye', ref: arm('crown-of-the-inward-eye-prophet-crown'), w: 32 },
          { name: 'The Burden of Truth', ref: acc('the-burden-of-truth-crystal-belt'), w: 20 },
          {
            name: 'Thread of Hope (Small–Very Large)',
            ref: jewel('thread-of-hope-crimson-jewel'),
            w: 5,
            note: 'poe.ninja does not split ring sizes',
          },
        ],
      },
      SIRUS_EXTRA,
    ],
  },
  {
    id: 'maven-normal',
    name: 'The Maven',
    entry: one("The Maven's Writ", frag('the-mavens-writ')),
    wiki: 'The_Maven',
    sample: 'n≈1,231 kills, 3.26–3.27',
    groups: [
      {
        kind: 'pick',
        label: 'Guaranteed unique',
        items: [
          { name: 'Legacy of Fury', ref: arm('legacy-of-fury-wyrmscale-boots'), w: 41 },
          { name: "Graven's Secret", ref: acc('gravens-secret-cloth-belt'), w: 17 },
          { name: "Arn's Anguish", ref: acc('arns-anguish-cloth-belt'), w: 17 },
          { name: "Olesya's Delight", ref: acc('olesyas-delight-cloth-belt'), w: 17 },
          { name: 'Doppelgänger Guise', ref: arm('doppelganger-guise-sadist-garb'), w: 7 },
          { name: 'Echoforge', ref: wep('echoforge-infernal-sword'), w: 1 },
        ],
      },
      MAVEN_EXTRA,
    ],
  },
  {
    id: 'venarius-normal',
    name: 'Venarius (Cortex)',
    entry: one('Cortex (map)', S('UniqueMap', 'cortex-t0')),
    wiki: 'Venarius',
    sample: 'n≈201 kills, 3.25–3.27',
    note: SYNTH_NOTE,
    groups: [
      {
        kind: 'pick',
        label: 'Guaranteed unique',
        items: [
          { name: 'Offering to the Serpent', ref: arm('offering-to-the-serpent-legion-gloves'), w: 43 },
          { name: 'Perepiteia', ref: arm('perepiteia-ezomyte-spiked-shield'), w: 43 },
          { name: 'Garb of the Ephemeral', ref: arm('garb-of-the-ephemeral-savants-robe'), w: 9 },
          { name: 'Bottled Faith', ref: flask('bottled-faith'), w: 5 },
        ],
      },
      VENARIUS_EXTRA,
    ],
  },
  {
    id: 'neglect-normal',
    name: 'Incarnation of Neglect',
    entry: one('Echo of Loneliness', frag('echo-of-loneliness')),
    wiki: 'Incarnation_of_Neglect',
    sample: 'n≈540 kills, 3.26–3.27',
    groups: [
      {
        kind: 'pick',
        label: 'Guaranteed unique',
        items: [
          { name: "Betrayal's Sting", ref: acc('betrayals-sting-steel-ring'), w: 50 },
          { name: "The Arkhon's Tools", ref: acc('the-arkhons-tools-cloth-belt'), w: 38 },
          { name: "Venarius' Astrolabe", ref: acc('venarius-astrolabe-astrolabe-amulet'), w: 10 },
          { name: 'Legacy of the Rose', ref: wep('legacy-of-the-rose-judgement-staff'), w: 2 },
        ],
      },
      ASTROLABES,
      NEGLECT_EXTRA,
    ],
  },
  {
    id: 'fear-normal',
    name: 'Incarnation of Fear',
    entry: one('Echo of Trauma', frag('echo-of-trauma')),
    wiki: 'Incarnation_of_Fear',
    sample: 'n≈700 kills, 3.28–3.29',
    groups: [
      {
        kind: 'pick',
        label: 'Guaranteed unique',
        items: [
          { name: 'Servant of Decay', ref: arm('servant-of-decay-torturer-garb'), w: 50 },
          { name: 'The Unseen Hue', ref: acc('the-unseen-hue-opal-ring'), w: 37 },
          { name: "Enmity's Embrace", ref: acc('enmitys-embrace-vermillion-ring'), w: 11 },
          { name: 'Starcaller', ref: wep('starcaller-abyssal-axe'), w: 2 },
        ],
      },
      ASTROLABES,
      FEAR_EXTRA,
    ],
  },
  {
    id: 'dread-normal',
    name: 'Incarnation of Dread',
    entry: one('Echo of Reverence', frag('echo-of-reverence')),
    wiki: 'Incarnation_of_Dread',
    sample: 'n≈100 kills, 3.27 (small sample)',
    groups: [
      {
        kind: 'pick',
        label: 'Guaranteed unique',
        items: [
          { name: 'Bonemeld', ref: acc('bonemeld-marble-amulet'), w: 55 },
          { name: 'The Dark Monarch', ref: arm('the-dark-monarch-lichs-circlet'), w: 35 },
          { name: 'Seven Teachings', ref: arm('seven-teachings-waxed-garb'), w: 8 },
          { name: 'Wine of the Prophet', ref: flask('wine-of-the-prophet'), w: 2 },
        ],
      },
      ASTROLABES,
      DREAD_EXTRA,
    ],
  },
  {
    id: 'zorath',
    name: 'Zorath, Vile Assembled',
    entryLabel: "Zorath's Eyes (4 fragments)",
    entry: [
      { name: "Zorath's Eye of Malevolence", ref: frag('zoraths-eye-of-malevolence'), qty: 1 },
      { name: "Zorath's Eye of Authority", ref: frag('zoraths-eye-of-authority'), qty: 1 },
      { name: "Zorath's Eye of the Inevitable", ref: frag('zoraths-eye-of-the-inevitable'), qty: 1 },
      { name: "Zorath's Eye of the Endless", ref: frag('zoraths-eye-of-the-endless'), qty: 1 },
    ],
    wiki: 'Zorath,_Vile_Assembled',
    sample: 'n≈311 kills, 3.29',
    groups: [
      {
        kind: 'pick',
        label: 'Guaranteed unique',
        items: [
          { name: 'Subsume the Source', ref: arm('subsume-the-source-faithful-helmet'), w: 40 },
          { name: 'Spinesnatch', ref: wep('spinesnatch-fleshripper'), w: 20 },
          { name: 'Baleful Dominion', ref: jewel('baleful-dominion-hypnotic-eye-jewel'), w: 10 },
          { name: 'Destructive Aspiration', ref: jewel('destructive-aspiration-ghastly-eye-jewel'), w: 10 },
          { name: 'Extinguishing Grasp', ref: jewel('extinguishing-grasp-searching-eye-jewel'), w: 10 },
          { name: 'Festering Vengeance', ref: jewel('festering-vengeance-murderous-eye-jewel'), w: 10 },
        ],
      },
      {
        kind: 'each',
        label: 'Additional drops',
        items: [{ name: 'Crystalfall Support', ref: gem('crystalfall-support'), p: 10 }],
      },
    ],
  },
].map((b) => ({ ...b, tier: 'pinnacle' }));

// ---------- other fragment bosses ----------

const SPLENDOUR = [
  'armour', 'evasion', 'es', 'armour-evasion', 'armour-es', 'evasion-es', 'armour-evasion-es', 'armour-es-life', 'evasion-es-life',
].map((v) => arm(`atziris-splendour-${v}-sacrificial-garb`));
const DORYANI = ['fire', 'cold', 'lightning', 'physical'].map((e) => acc(`doryanis-invitation-${e}-heavy-belt`));

const OTHERS = [
  {
    id: 'atziri',
    name: 'Atziri, Queen of the Vaal',
    entryLabel: 'Sacrifice set (4 fragments)',
    entry: [
      { name: 'Sacrifice at Dusk', ref: frag('dusk'), qty: 1 },
      { name: 'Sacrifice at Noon', ref: frag('noon'), qty: 1 },
      { name: 'Sacrifice at Dawn', ref: frag('dawn'), qty: 1 },
      { name: 'Sacrifice at Midnight', ref: frag('mid'), qty: 1 },
    ],
    wiki: 'Atziri,_Queen_of_the_Vaal',
    sample: 'n≈424 kills, 3.28',
    groups: [
      {
        kind: 'pick',
        label: 'Guaranteed unique',
        items: [
          { name: "Atziri's Promise", ref: flask('atziris-promise'), w: 48 },
          { name: 'Triumvirate Authority (3 mods)', ref: acc('triumvirate-authority-unset-ring'), w: 18 },
          { name: "Atziri's Step", ref: arm('atziris-step-slink-boots'), w: 15 },
          { name: "Doryani's Invitation", ref: DORYANI, w: 15, note: 'Average of the four element variants' },
          { name: "Doryani's Catalyst", ref: wep('doryanis-catalyst-vaal-sceptre'), w: 3 },
          { name: 'Pledge of Hands', ref: wep('pledge-of-hands-judgement-staff'), w: 0.5 },
        ],
      },
    ],
  },
  {
    id: 'uber-atziri',
    name: 'Uber Atziri',
    entryLabel: 'Mortal set (4 fragments)',
    entry: [
      { name: 'Mortal Grief', ref: frag('grie'), qty: 1 },
      { name: 'Mortal Ignorance', ref: frag('ign'), qty: 1 },
      { name: 'Mortal Hope', ref: frag('hope'), qty: 1 },
      { name: 'Mortal Rage', ref: frag('rage'), qty: 1 },
    ],
    wiki: 'Atziri,_Queen_of_the_Vaal',
    sample: 'n≈1,543 kills, 3.27',
    note: 'Soul Cores are left out: the wiki gives no rate and poe.ninja no price.',
    groups: [
      {
        kind: 'pick',
        label: 'Guaranteed unique',
        items: [
          { name: "Atziri's Splendour", ref: SPLENDOUR, w: 42, note: 'Average of the nine unlinked variants' },
          { name: 'The Vertex', ref: arm('the-vertex-vaal-mask'), w: 40 },
          { name: "Atziri's Acuity", ref: arm('atziris-acuity-vaal-gauntlets'), w: 6 },
          {
            name: 'Triumvirate Authority (4 mods)',
            ref: acc('triumvirate-authority-unset-ring'),
            w: 5,
            note: 'poe.ninja does not split 3 and 4 mod versions',
          },
          { name: "Atziri's Reflection", ref: arm('atziris-reflection-golden-buckler'), w: 4 },
          { name: "Atziri's Disfavour", ref: wep('atziris-disfavour-vaal-axe'), w: 2 },
          { name: "Atziri's Rule", ref: wep('atziris-rule-judgement-staff'), w: 1 },
        ],
      },
      {
        kind: 'each',
        label: 'Additional drops',
        items: [
          { name: 'Beauty', ref: jewel('beauty-vaal-aspect'), p: 15 },
          { name: 'Vaal Sacrifice Support', ref: gem('vaal-sacrifice-support'), p: 8 },
          { name: 'Greater Spell Echo Support', ref: gem('greater-spell-echo-support'), p: 5 },
          { name: 'Triskaidekaphobia', ref: card('triskaidekaphobia'), p: 20 },
          { name: 'The Price of Devotion', ref: card('the-price-of-devotion'), p: 0.1 },
        ],
      },
    ],
  },
  {
    id: 'black-star',
    name: 'The Black Star',
    entry: one('Polaric Invitation', invite('polaric-invitation')),
    wiki: 'The_Black_Star',
    sample: 'n≈3,600 kills, 3.22',
    note: 'Rates shown are the base (white invitation) rates; quantity from rare or corrupted invitations raises them.',
    groups: [
      {
        kind: 'each',
        label: 'Drops',
        items: [
          { name: 'Polaric Devastation', ref: acc('polaric-devastation-opal-ring'), p: 3 },
          { name: 'Sudden Dawn', ref: arm('sudden-dawn-steel-circlet'), p: 3 },
          { name: 'The Eternal Struggle', ref: acc('the-eternal-struggle-onyx-amulet'), p: 5 },
          ...ELDRITCH_CURRENCY,
          { name: 'Grand Eldritch Ember', ref: cur('grand-eldritch-ember'), p: 12 },
          { name: 'Greater Eldritch Ember', ref: cur('greater-eldritch-ember'), p: 12 },
        ],
      },
    ],
  },
  {
    id: 'infinite-hunger',
    name: 'The Infinite Hunger',
    entry: one('Writhing Invitation', invite('writhing-invitation')),
    wiki: 'The_Infinite_Hunger',
    sample: 'extrapolated from Black Star data',
    note: 'Rates shown are the base (white invitation) rates; quantity from rare or corrupted invitations raises them.',
    groups: [
      {
        kind: 'each',
        label: 'Drops',
        items: [
          { name: 'Choking Guilt', ref: card('choking-guilt'), p: 1 },
          { name: 'Ceaseless Feast', ref: arm('ceaseless-feast-spiked-gloves'), p: 3 },
          { name: 'Black Zenith', ref: arm('black-zenith-fingerless-silk-gloves'), p: 3 },
          { name: 'The Eternal Struggle', ref: acc('the-eternal-struggle-onyx-amulet'), p: 5 },
          ...ELDRITCH_CURRENCY,
          { name: 'Grand Eldritch Ichor', ref: cur('grand-eldritch-ichor'), p: 12 },
          { name: 'Greater Eldritch Ichor', ref: cur('greater-eldritch-ichor'), p: 12 },
        ],
      },
    ],
  },
  {
    // Hive Colony: It That Was Tul and It That Was Esh are fought together; the wiki's table (identical on both
    // boss pages) is per encounter: one exclusive unique, plus one random 1-mod Foulborn Breach unique.
    id: 'hive-colony',
    name: 'It That Was Tul & It That Was Esh',
    entryLabel: '1× Hivebrain Gland',
    entry: one('Hivebrain Gland', frag('hivebrain-gland')),
    wiki: 'It_That_Was_Esh',
    sample: 'n≈330 encounters, 3.28',
    note: 'One drop table per encounter (both bosses together). Hiveblood is not counted: it cannot be traded.',
    groups: [
      {
        kind: 'pick',
        label: 'Guaranteed unique',
        items: [
          { name: 'The Will of Esh', ref: acc('the-will-of-esh-synaptic-ring'), w: 17 },
          { name: 'The Will of Tul', ref: acc('the-will-of-tul-cryonic-ring'), w: 17 },
          { name: 'The Will of Xoph', ref: acc('the-will-of-xoph-enthalpic-ring'), w: 17 },
          { name: 'The Will of Uul-Netol', ref: acc('the-will-of-uul-netol-organic-ring'), w: 12 },
          { name: 'The Sundered Will', ref: acc('the-sundered-will-fugitive-ring'), w: 4 },
          { name: 'Hand of the Lords', ref: arm('hand-of-the-lords-carnal-mitts'), w: 29 },
          { name: 'The Grey Wind', ref: wep('the-grey-wind-spectral-axe'), w: 3 },
          { name: "Uul-Netol's Vow", ref: acc('uul-netols-vow-unset-amulet'), w: 1 },
        ],
      },
      {
        kind: 'each',
        label: 'Additional drops',
        items: [
          {
            name: 'Foulborn Breach unique (random, 1 mod)',
            ref: NO_PRICE,
            p: 100,
            note: 'Guaranteed, but the item and mod are random — type your average sale price',
          },
          { name: 'Flesh of Xesht', ref: cur('flesh-of-xesht'), p: 20 },
          { name: 'Foulgrasp Support', ref: gem('foulgrasp-support'), p: 10 },
          { name: 'Hiveborn Support', ref: gem('hiveborn-support'), p: 5 },
          { name: 'Something Dark', ref: card('something-dark'), p: 10 },
          { name: 'The Escape', ref: card('the-escape'), p: 9 },
        ],
      },
    ],
  },
].map((b) => ({ ...b, tier: 'other' }));

export const TIERS = [
  { id: 'uber', label: 'Uber pinnacle' },
  { id: 'pinnacle', label: 'Pinnacle' },
  { id: 'other', label: 'Other' },
];

export const BOSSES = [...UBERS, ...PINNACLES, ...OTHERS].map((b) => ({
  ...b,
  entryLabel: b.entryLabel || `${b.entry[0].qty}× ${b.entry[0].name}`,
}));

// Every poe.ninja ref the app needs (used by the API route and the snapshot).
export function collectRefs() {
  const refs = new Set();
  const add = (r) => (Array.isArray(r) ? r.forEach(add) : r && refs.add(r));
  for (const b of BOSSES) {
    for (const e of b.entry) add(e.ref);
    for (const g of b.groups) for (const it of g.items) add(it.ref);
  }
  return [...refs];
}
