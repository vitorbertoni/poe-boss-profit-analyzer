// pathofexile.com trade API helpers: query building, rate limiting, price summaries.
// Observed Oct 2026: instant buyout = status "securable"; each cluster notable has its own explicit stat
// ("1 Added Passive Skill is X"); enchants are options of enchant.stat_3948993189; passive count is
// enchant.stat_3086156145.
export const TRADE = 'https://www.pathofexile.com/api/trade';
export const UA = 'poe-boss-profit-analyzer cluster-price-check/0.1 (+https://github.com/vitorbertoni/poe-boss-profit-analyzer)';

const ENCHANT_STAT = 'enchant.stat_3948993189';
const PASSIVES_STAT = 'enchant.stat_3086156145';
const PREFIX = 'Added Small Passive Skills grant: ';

/** Order- and case-insensitive key for an enchant given as lines (RePoE) or a joined string (trade, poe.ninja). */
export const enchantKey = (lines) => lines.map((l) => l.trim().toLowerCase()).sort().join(' | ');

/** Maps trade stat data to { notables: Map(name -> stat id), enchants: Map(enchantKey -> option) }. */
export function indexStats(statsJson) {
  const notables = new Map();
  const enchants = new Map();
  for (const group of statsJson.result || []) {
    for (const e of group.entries || []) {
      const m = /^1 Added Passive Skill is (.+)$/.exec(e.text);
      if (group.id === 'explicit' && m) notables.set(m[1], e.id);
      if (group.id === 'enchant' && e.id.startsWith(`${ENCHANT_STAT}|`)) {
        enchants.set(enchantKey(e.text.split('\n').map((l) => l.replace(PREFIX, ''))), Number(e.id.split('|')[1]));
      }
    }
  }
  return { notables, enchants };
}

/** Trade option for a RePoE enchant (its `text` lines). */
export function enchantOption(index, enchant) {
  return index.enchants.get(enchantKey(enchant.text)) ?? null;
}

export const DEFAULT_PASSIVES = { Large: 8, Medium: 4 };
export const TIER_RANGES = { 1: [1, 49], 50: [50, 67], 68: [68, 74], 75: [75, 83], 84: [84, null] };

/**
 * Search body for a combo on one item level tier: instant buyout only, uncorrupted, cheapest first.
 * excludeStats: notables that must NOT be on the jewel (used so a pair is priced without 3-notable jewels).
 */
export function buildQuery({ size, enchantOption: opt, notableStats, excludeStats = [], passives = DEFAULT_PASSIVES[size], tier }) {
  const [min, max] = TIER_RANGES[tier];
  const ilvl = max ? { min, max } : { min };
  return {
    query: {
      status: { option: 'securable' },
      type: `${size} Cluster Jewel`,
      stats: [
        {
          type: 'and',
          filters: [
            { id: ENCHANT_STAT, value: { option: opt } },
            { id: PASSIVES_STAT, value: { min: passives, max: passives } },
            ...notableStats.map((id) => ({ id })),
          ],
        },
        ...(excludeStats.length ? [{ type: 'not', filters: excludeStats.map((id) => ({ id })) }] : []),
      ],
      filters: {
        misc_filters: { filters: { ilvl, corrupted: { option: 'false' } } },
      },
    },
    sort: { price: 'asc' },
  };
}

// ---------- rate limiting ----------
export class LongWait extends Error {
  constructor(ms) {
    super(`rate limit window needs a ${Math.round(ms / 1000)}s wait — stopping this run`);
    this.waitMs = ms;
  }
}

/** "8:10:60,15:60:120" -> [{max, period, penalty}] ; state "1:10:0" -> [{current, period, active}] */
export function parseRules(header) {
  if (!header) return [];
  return header.split(',').map((r) => {
    const [a, b, c] = r.split(':').map(Number);
    return { a, period: b, c };
  });
}

/**
 * Keeps our own usage under `fraction` of every rule the server announces, and also waits when the server's
 * shared state (which counts every request from this IP, not just ours) is near the limit.
 * maxWaitMs: a longer wait (e.g. the 6-hour window already half used) throws LongWait to end the run cleanly.
 */
export function limiter({ fraction = 0.5, maxWaitMs = 180e3, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const history = new Map(); // policy -> [timestamps]
  const rules = new Map(); // policy -> [{max, period}]
  const pressure = new Map(); // policy -> wait-until ms from server state
  return {
    async before(policy) {
      for (;;) {
        const t = now();
        let wait = Math.max(0, (pressure.get(policy) || 0) - t);
        const hist = (history.get(policy) || []).filter((x) => t - x < 3600e3);
        history.set(policy, hist);
        for (const r of rules.get(policy) || []) {
          const allowed = Math.max(1, Math.floor(r.max * fraction));
          const inWindow = hist.filter((x) => t - x < r.period * 1000);
          if (inWindow.length >= allowed) wait = Math.max(wait, inWindow[inWindow.length - allowed] + r.period * 1000 - t + 50);
        }
        if (!rules.get(policy)?.length) wait = Math.max(wait, (hist.at(-1) ?? -Infinity) + 6000 - t); // unknown rules: 1 req / 6s
        if (wait <= 0) break;
        if (wait > maxWaitMs) throw new LongWait(wait);
        await sleep(wait);
      }
      history.get(policy).push(now());
    },
    after(policy, headers) {
      const rulesHeader = headers.get('x-rate-limit-ip');
      const stateHeader = headers.get('x-rate-limit-ip-state');
      if (rulesHeader) rules.set(policy, parseRules(rulesHeader).map((r) => ({ max: r.a, period: r.period })));
      if (rulesHeader && stateHeader) {
        const rs = parseRules(rulesHeader);
        const ss = parseRules(stateHeader);
        let until = 0;
        ss.forEach((s, i) => {
          const r = rs[i];
          if (!r) return;
          if (s.c > 0) until = Math.max(until, now() + s.c * 1000); // active penalty
          else if (s.a >= Math.floor(r.a * fraction)) until = Math.max(until, now() + r.period * 1000); // shared IP is busy
        });
        pressure.set(policy, until);
      }
    },
  };
}

// ---------- prices ----------
/** chaos value of one unit of a trade currency id, from poe.ninja currency rows (by name). */
export function rateTable(currencyRows) {
  const byName = new Map(currencyRows.map((r) => [r.name, Number(r.chaos_value)]));
  return {
    chaos: 1,
    divine: byName.get('Divine Orb'),
    exalted: byName.get('Exalted Orb'),
    alt: byName.get('Orb of Alteration'),
    regal: byName.get('Regal Orb'),
    scour: byName.get('Orb of Scouring'),
  };
}

const quant = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1) + 0.5))];

/**
 * Summarises fetched listings (cheapest first). Drops prices below 25% of the sample median (bait or
 * mispriced listings), converts to chaos, and returns min / p25 / median.
 */
export function summarize(listings, rates) {
  const chaos = [];
  for (const l of listings) {
    const p = l?.listing?.price;
    const rate = p && rates[p.currency];
    if (p && rate > 0 && p.amount > 0) chaos.push(p.amount * rate);
  }
  chaos.sort((a, b) => a - b);
  if (!chaos.length) return { sample_n: 0, min_chaos: null, p25_chaos: null, median_n_chaos: null };
  const med = quant(chaos, 0.5);
  const kept = chaos.filter((v) => v >= med * 0.25);
  return { sample_n: kept.length, min_chaos: kept[0], p25_chaos: quant(kept, 0.25), median_n_chaos: quant(kept, 0.5) };
}
