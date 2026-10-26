// Cluster Jewels: which rare cluster jewels are worth crafting — 2-notable and 3-notable combos.
// Data: /api/clusters (Supabase views filled by the collectors) + /data/clusters/cluster-mods.json (RePoE).
// Craft costs are computed here with lib/craft/engine.js, so price edits recalculate in the browser.
import { prepareCraft, solveCraft, notableKey } from './lib/craft/engine.js';

const TIERS = [75, 84];
const PASSIVES = { Large: 8, Medium: 4 }; // matches the trade searches
const THIN_MARKET = 10; // fewer listings than this: price shown with a warning
const MIN_SAMPLE_FOR_VALUE = 5; // listings needed before a combo's price is used to value by-products
const STORE = 'pbpa:clusters:v2';
const CURRENCY = [
  ['alt', 'Orb of Alteration', 'Alteration'],
  ['aug', 'Orb of Augmentation', 'Augmentation'],
  ['regal', 'Regal Orb', 'Regal'],
  ['exalt', 'Exalted Orb', 'Exalted Orb'],
  ['scour', 'Orb of Scouring', 'Scouring'],
  ['transmute', 'Orb of Transmutation', 'Transmutation'],
];

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const enchantKey = (lines) => lines.map((l) => l.trim().toLowerCase()).sort().join(' | ');
const tierLabel = (t) => (t === 84 ? '84+' : '75–83');

const state = {
  unit: 'div', size: 'all', count: 'all', tier: 'best', minList: 10, maxBase: null, q: '', sort: 'net', dir: -1,
  selected: null, byproducts: true, overrides: {},
};
let API = null;
let DATA = null;
let ROWS = [];
let BY_KEY = new Map();
let PRICE_IDX = new Map(); // size|tag|tier -> Map(notableKey -> chaos)
const prepCache = new Map();

// ---------- persistence (per-viewer only) ----------
try {
  const s = JSON.parse(localStorage.getItem(STORE) || localStorage.getItem('pbpa:clusters:v1') || '{}');
  if (s.unit) state.unit = s.unit;
  if (s.overrides) state.overrides = s.overrides;
  if (typeof s.byproducts === 'boolean') state.byproducts = s.byproducts;
} catch {}
const save = () => {
  try {
    localStorage.setItem(STORE, JSON.stringify({ unit: state.unit, overrides: state.overrides, byproducts: state.byproducts }));
  } catch {}
};

// ---------- money ----------
const D = () => API?.currency['Divine Orb'] || 1;
function money(c, { sign = false } = {}) {
  if (c == null || !Number.isFinite(c)) return '—';
  const s = sign && c > 0 ? '+' : '';
  if (state.unit === 'chaos') return `${s}${Math.round(c).toLocaleString('en-US')}c`;
  const d = c / D();
  const a = Math.abs(d);
  return `${s}${d.toLocaleString('en-US', { minimumFractionDigits: a >= 10 ? 1 : 2, maximumFractionDigits: a >= 10 ? 1 : 2 })} div`;
}
const pct = (v) => `${(v * 100).toFixed(v >= 0.1 ? 0 : 1)}%`;
const num = (v, d = 1) => (v >= 100 ? Math.round(v).toLocaleString('en-US') : v.toFixed(d));
function ago(iso) {
  if (!iso) return 'never';
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  if (m < 60) return `${Math.max(1, m)} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

function prices() {
  const p = {};
  for (const [k, name] of CURRENCY) p[k] = state.overrides[k] ?? API.currency[name] ?? (k === 'exalt' ? Infinity : 0);
  return p;
}

// ---------- model ----------
function build() {
  const enchants = new Map();
  for (const [size, s] of Object.entries(DATA.sizes)) for (const e of s.enchants) enchants.set(e.tag, { ...e, size, key: enchantKey(e.text) });
  const byText = new Map([...enchants.values()].map((e) => [`${e.size}|${e.key}`, e]));

  const bases = new Map(); // size|tag|tier -> chaos (fixed passives), fallback: cheapest any passives
  for (const [size, name, passives, tier, chaos, n] of API.bases) {
    const e = byText.get(`${size}|${enchantKey(name.split(', '))}`);
    if (!e) continue;
    const k = `${size}|${e.tag}|${tier}`;
    if (passives === PASSIVES[size]) bases.set(k, { chaos, n, exact: true });
    else if (!bases.get(k)?.exact && (!bases.has(k) || bases.get(k).chaos > chaos)) bases.set(k, { chaos, n, exact: false, passives });
  }
  const trade = new Map(API.trade.map(([key, tier, listings, sample, min, p25, med, at, searchId]) => [`${key}|${tier}`, { listings, sample, min, p25, med, at, searchId }]));
  const queries = new Map(API.queries.map(([key, tier, q]) => [`${key}|${tier}`, q]));

  PRICE_IDX = new Map();
  for (const [k, t] of trade) {
    // by-products are valued at the 25th percentile of the cheapest listings (conservative: a quick sale)
    if (!(t.sample >= MIN_SAMPLE_FOR_VALUE) || !(t.p25 > 0)) continue;
    const [size, tag, names, tier] = k.split('|');
    const ik = `${size}|${tag}|${tier}`;
    if (!PRICE_IDX.has(ik)) PRICE_IDX.set(ik, new Map());
    PRICE_IDX.get(ik).set(names, Number(t.p25));
  }

  ROWS = API.usage
    .filter((u) => u[2].length === 2 || u[2].length === 3)
    .map(([size, tag, notables, builds, share]) => {
      const nk = notableKey(notables);
      const comboKey = `${size}|${tag}|${nk}`;
      const tiers = TIERS.map((tier) => ({
        tier,
        base: bases.get(`${size}|${tag}|${tier}`) || null,
        trade: trade.get(`${comboKey}|${tier}`) || null,
        query: queries.get(`${comboKey}|${tier}`) || null,
        craft: null,
      }));
      return { comboKey, nk, size, tag, enchant: enchants.get(tag)?.name || tag, notables: [...notables].sort(), builds, share, tiers, upgrades: [], pairs: [] };
    });
  BY_KEY = new Map(ROWS.map((r) => [r.comboKey, r]));
  // link each 3-notable combo with the pairs inside it
  for (const r of ROWS) {
    if (r.notables.length !== 3) continue;
    for (let i = 0; i < 3; i++) {
      const pair = BY_KEY.get(`${r.size}|${r.tag}|${notableKey(r.notables.filter((_, j) => j !== i))}`);
      if (!pair) continue;
      r.pairs.push(pair);
      pair.upgrades.push(r);
    }
  }
}

const isPriced = (t) => t.trade?.sample > 0 && t.trade.med > 0;

function solveTier(r, t, p) {
  const prep = prepCache.get(`${r.comboKey}|${t.tier}`);
  if (!prep) return;
  const known = PRICE_IDX.get(`${r.size}|${r.tag}|${t.tier}`);
  const sell = isPriced(t) ? Number(t.trade.med) : null;
  const values = (k) => (k === r.nk ? sell || 0 : known?.get(k) || 0);
  t.craft = solveCraft(prep, { ...p, base: t.base?.chaos ?? 0 }, { values, sellByproducts: state.byproducts });
  t.cost = t.craft.feasible && t.base ? t.craft.expectedCost : null;
  t.sell = sell;
  // Conservative profit: sale − expected cost. By-product sales above the base they replace and jackpots are shown
  // as upside in the detail panel, not here — they are really the profit of crafting a different combo.
  t.net = t.cost != null && sell != null ? sell - t.cost : null;
}
function solveRow(r) {
  const p = prices();
  for (const t of r.tiers) solveTier(r, t, p);
}

function ensurePrepared(r) {
  for (const t of r.tiers) {
    const k = `${r.comboKey}|${t.tier}`;
    if (!prepCache.has(k)) prepCache.set(k, prepareCraft(DATA, { size: r.size, enchant: r.tag, ilvl: t.tier, targets: r.notables }));
  }
  solveRow(r);
}

const tick = () => new Promise((res) => setTimeout(res, 0));

/** Prepares craft tables for every priced combo in small batches (~40 ms each), most used first. */
async function prepareAll(onProgress) {
  const jobs = [];
  for (const r of ROWS) for (const t of r.tiers) if (isPriced(t) && !prepCache.has(`${r.comboKey}|${t.tier}`)) jobs.push([r, t]);
  jobs.sort((a, b) => b[0].builds - a[0].builds);
  let done = 0;
  const p = prices();
  for (const [r, t] of jobs) {
    prepCache.set(`${r.comboKey}|${t.tier}`, prepareCraft(DATA, { size: r.size, enchant: r.tag, ilvl: t.tier, targets: r.notables }));
    solveTier(r, t, p);
    if (++done % 5 === 0) {
      onProgress(done, jobs.length);
      await tick();
    }
  }
  onProgress(jobs.length, jobs.length);
}

let resolving = 0;
/** Re-prices every prepared combo after a price or option change (solve only, in batches). */
async function resolveAll() {
  const run = ++resolving;
  const p = prices();
  let i = 0;
  for (const r of ROWS) {
    for (const t of r.tiers) if (prepCache.has(`${r.comboKey}|${t.tier}`)) solveTier(r, t, p);
    if (++i % 40 === 0) {
      await tick();
      if (run !== resolving) return; // a newer change started
    }
  }
  renderTable();
  renderDetail();
}

function pickTier(r) {
  const ts = r.tiers.filter((t) => (state.tier === 'best' ? true : t.tier === Number(state.tier)));
  const ok = ts.filter((t) => t.net != null && (t.trade?.listings ?? 0) >= state.minList && (state.maxBase == null || (t.base?.chaos ?? Infinity) <= state.maxBase));
  if (ok.length) return ok.sort((a, b) => b.net - a.net)[0];
  return null;
}

function view() {
  const q = state.q;
  const list = ROWS.filter(
    (r) =>
      (state.size === 'all' || r.size === state.size) &&
      (state.count === 'all' || r.notables.length === Number(state.count)) &&
      (!q || r.notables.some((n) => n.toLowerCase().includes(q)) || r.enchant.toLowerCase().includes(q)),
  ).map((r) => ({ r, t: pickTier(r) }));
  const val = ({ r, t }, k) =>
    k === 'name' ? r.notables.join(' ') : k === 'share' ? r.share : k === 'ilvl' ? t?.tier ?? -1 : k === 'sell' ? t?.sell ?? -Infinity
      : k === 'cost' ? t?.cost ?? Infinity : k === 'listings' ? t?.trade?.listings ?? -1 : t?.net ?? -Infinity;
  const priced = list.filter((x) => x.t);
  const rest = list.filter((x) => !x.t);
  priced.sort((a, b) => {
    const va = val(a, state.sort), vb = val(b, state.sort);
    return (typeof va === 'string' ? va.localeCompare(vb) : va - vb) * state.dir;
  });
  rest.sort((a, b) => b.r.builds - a.r.builds);
  return { priced, rest };
}

// ---------- render ----------
function renderHeader() {
  $('league').replaceChildren('League ', el('b', null, API.league), ` · 1 div = ${Math.round(D())}c`);
  document.querySelectorAll('#unit button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.unit === state.unit)));
  const src = $('sources');
  src.replaceChildren();
  const names = { 'ninja-builds': 'Builds', 'ninja-prices': 'Bases & currency', 'trade-prices': 'Trade prices' };
  for (const s of API.status.filter((x) => names[x.source])) {
    const t = el('span', `tag${s.status === 'error' ? ' bad' : ''}`, `${names[s.source]}: ${s.status === 'error' ? 'failed' : 'updated'} ${ago(s.finished_at || s.started_at)}`);
    if (s.status === 'error') t.title = s.error || '';
    src.append(t);
  }
}

function renderPrices() {
  const box = $('prices');
  box.replaceChildren(
    ...CURRENCY.map(([k, name, label]) => {
      const f = el('label', 'field', label);
      const i = el('input', `in${state.overrides[k] != null ? ' edited' : ''}`);
      Object.assign(i, { type: 'number', min: 0, step: 'any', inputmode: 'decimal', value: String(state.overrides[k] ?? API.currency[name] ?? '') });
      i.dataset.cur = k;
      f.append(i, el('span', 'unit', 'c'));
      return f;
    }),
  );
  $('byp').checked = state.byproducts;
}

function comboCell(r) {
  const name = el('td', 'nm combo', r.notables.join(' + '));
  if (r.notables.length === 3) name.append(el('span', 'tag', '3 notables'));
  name.append(el('span', 'sub', `${r.size} · ${r.enchant}`));
  return name;
}

function renderTable() {
  const { priced, rest } = view();
  document.querySelectorAll('.rank th').forEach((th) => {
    const k = th.querySelector('button').dataset.sort;
    th.setAttribute('aria-sort', k === state.sort ? (state.dir > 0 ? 'ascending' : 'descending') : 'none');
  });
  $('rank-note').textContent = `${priced.length} priced · ${rest.length} waiting for prices`;
  const tbody = $('rows');
  if (!priced.length && !rest.length) {
    const tr = el('tr');
    const td = el('td', 'empty', 'No combos match these filters.');
    td.colSpan = 7;
    tr.append(td);
    tbody.replaceChildren(tr);
    return;
  }
  const maxNet = Math.max(...priced.map((x) => Math.max(0, x.t.net)), 1);
  const row = ({ r, t }) => {
    const tr = el('tr', t ? '' : 'unpriced');
    tr.dataset.key = r.comboKey;
    tr.setAttribute('aria-selected', String(r.comboKey === state.selected));
    const net = el('td');
    if (t) {
      const w = el('span', `ret ${t.net >= 0 ? 'pos-t' : 'neg-t'}`);
      if (t.net > 0) {
        const bar = el('i');
        bar.style.width = `${Math.max(2, (48 * t.net) / maxNet)}px`;
        w.append(bar);
      }
      w.append(money(t.net, { sign: true }));
      net.append(w);
    } else net.textContent = '—';
    tr.append(
      comboCell(r),
      el('td', null, pct(r.share)),
      el('td', 'col-n', t ? tierLabel(t.tier) : '—'),
      el('td', null, t ? money(t.sell) : '—'),
      el('td', null, t ? money(t.cost) : '—'),
      net,
      el('td', 'col-best', t ? String(t.trade.listings) : '—'),
    );
    return tr;
  };
  tbody.replaceChildren(...priced.map(row), ...rest.slice(0, 40).map(row));
  const top = priced.filter((x) => x.t.net > 0).slice(0, 3);
  $('takeaway').replaceChildren(
    ...(top.length
      ? ['Best right now: ', ...top.flatMap((x, i) => [el('b', null, x.r.notables.join(' + ')), ` (${money(x.t.net, { sign: true })})`, i < top.length - 2 ? ', ' : i === top.length - 2 ? ' and ' : '.'])]
      : ['No profitable combo with these filters yet.']),
  );
}

// Prefer the trade site's own share format (/search/<league>/<id>); fall back to the query in the URL.
function tradeUrl(trade, query) {
  const base = `https://www.pathofexile.com/trade/search/${encodeURIComponent(API.league)}`;
  if (trade?.searchId) return `${base}/${encodeURIComponent(trade.searchId)}`;
  return query ? `${base}?q=${encodeURIComponent(JSON.stringify({ query }))}` : null;
}

const kpi = (label, value, cls) => {
  const k = el('div', 'kpi');
  k.append(el('span', null, label), el('b', cls || null, value));
  return k;
};
const signCls = (v) => (v == null ? null : v >= 0 ? 'pos-t' : 'neg-t');

/** Small comparison table: other combos related to this one, on the same item level tier when priced. */
function relatedTable(title, intro, rows, tier, baseSell, labelOf) {
  const wrap = el('div', 'related');
  wrap.append(el('h4', null, title), el('p', 'fine', intro));
  const table = el('table', 'tiers');
  const head = el('tr');
  for (const h of ['Combo', 'Sells for', 'Price jump', 'Cost', 'Profit']) head.append(el('th', null, h));
  table.append(el('thead'), el('tbody'));
  table.tHead.append(head);
  for (const u of rows) {
    const ut = u.tiers.find((t) => t.tier === tier && t.net != null) || pickTier(u) || u.tiers.find((t) => t.tier === tier);
    const tr = el('tr', 'link');
    tr.dataset.key = u.comboKey;
    const jump = ut?.sell != null && baseSell != null ? ut.sell - baseSell : null;
    tr.append(
      el('td', null, labelOf(u)),
      el('td', null, ut?.sell != null ? `${money(ut.sell)} (${tierLabel(ut.tier)})` : 'not priced yet'),
      el('td', signCls(jump), jump != null ? money(jump, { sign: true }) : '—'),
      el('td', null, ut?.cost != null ? money(ut.cost) : '—'),
      el('td', signCls(ut?.net), ut?.net != null ? money(ut.net, { sign: true }) : '—'),
    );
    table.tBodies[0].append(tr);
  }
  wrap.append(table);
  return wrap;
}

function renderDetail() {
  const box = $('detail');
  const r = BY_KEY.get(state.selected);
  if (!r) {
    box.replaceChildren(el('h2', 'item-title', 'Pick a combo'), el('p', 'item-sub', 'Click a row to see craft cost by item level, the strategy and the trade search.'));
    return;
  }
  if (r.tiers.some((t) => !prepCache.has(`${r.comboKey}|${t.tier}`))) ensurePrepared(r);
  for (const u of [...r.upgrades, ...r.pairs]) if (u.tiers.some((t) => !t.craft && isPriced(t))) ensurePrepared(u);

  const best = pickTier(r) || r.tiers.filter((t) => t.net != null).sort((a, b) => b.net - a.net)[0] || r.tiers.find((t) => t.craft?.feasible) || r.tiers[0];
  const kpis = el('div', 'kpis four');
  kpis.append(
    kpi('Profit per jewel', money(best?.net, { sign: true }), signCls(best?.net)),
    kpi('Sells for', best?.sell != null ? money(best.sell) : '—'),
    kpi('Expected cost', money(best?.cost)),
    kpi('Unlucky (P90) cost', best?.craft?.feasible && best.base ? money(best.craft.p90) : '—'),
  );

  const table = el('table', 'tiers');
  const head = el('tr');
  for (const h of ['ilvl', 'Base', 'Craft', 'Sells for', 'Profit', 'Listings']) head.append(el('th', null, h));
  table.append(el('thead'), el('tbody'));
  table.tHead.append(head);
  for (const t of r.tiers) {
    const tr = el('tr', t === best ? 'best' : '');
    const craftOk = t.craft?.feasible;
    tr.append(
      el('td', null, tierLabel(t.tier)),
      el('td', null, t.base ? money(t.base.chaos) + (t.base.exact ? '' : '*') : '—'),
      el('td', null, craftOk ? money(t.craft.craftCost) : t.craft ? 'not possible' : '…'),
      el('td', null, t.sell != null ? money(t.sell) : t.trade ? 'no listings' : 'not priced'),
      el('td', signCls(t.net), t.net != null ? money(t.net, { sign: true }) : '—'),
      el('td', t.trade && t.trade.listings < THIN_MARKET ? 'neg-t' : null, t.trade ? String(t.trade.listings) + (t.trade.listings < THIN_MARKET ? ' ⚠' : '') : '—'),
    );
    if (t.trade && t.trade.listings < THIN_MARKET) tr.title = 'Few listings: this price is unreliable (asking prices in a thin market).';
    table.tBodies[0].append(tr);
  }

  const sub = `${r.size} cluster · ${r.enchant} · ${r.notables.length} notables · used by ${pct(r.share)} of characters`;
  const parts = [el('h2', 'item-title', r.notables.join(' + ')), el('p', 'item-sub', sub), kpis];
  const panel = el('div');
  panel.style.marginTop = '14px';
  panel.append(table);
  if (r.tiers.some((t) => t.base && !t.base.exact)) panel.append(el('p', 'fine', `* no ${PASSIVES[r.size]}-passive base listed; cheapest other passive count shown.`));
  if (r.tiers.some((t) => t.trade && t.trade.listings < THIN_MARKET))
    panel.append(el('p', 'fine', `⚠ fewer than ${THIN_MARKET} listings: a thin market, where asking prices can be far from what actually sells.`));
  parts.push(panel);

  if (best?.craft?.feasible) {
    const c = best.craft;
    const s = el('p', 'strategy');
    s.append(el('b', null, 'How: '), c.strategy.label);
    const x = c.expected;
    const n = el('p', 'strategy');
    n.append(
      el('b', null, 'Expected currency: '),
      `${num(x.alterations, 0)} Alteration, ${x.augs.toFixed(1)} Augmentation, ${x.regals.toFixed(1)} Regal` +
        (x.exalts > 0.005 ? `, ${x.exalts.toFixed(2)} Exalted Orb` : '') +
        `, ${x.resets.toFixed(1)} Scouring + Transmutation. Half of crafts finish under ${money(c.p50)} including the base.`,
    );
    parts.push(s, n);
    if (x.byproductsSold > 0.005) {
      const b = el('p', 'strategy');
      const top = c.byproducts.slice(0, 2).map((bp) => `${bp.notables.join(' + ')} (${money(bp.value)})`).join(', ');
      b.append(
        el('b', null, 'By-products: '),
        `about ${x.byproductsSold.toFixed(1)} misses per jewel are worth selling — mostly ${top}. They bring back ${money(x.byproductCredit)}` +
          (c.byproductSurplus > 0.5
            ? `; ${money(c.byproductSurplus)} of that is above the base they replace — upside on top of the profit shown, not counted in it.`
            : ', which pays for new bases (already in the cost).'),
      );
      parts.push(b);
    }
    if (c.jackpot > 0.5) {
      const j = el('p', 'strategy');
      j.append(el('b', null, 'Jackpot: '), `some crafts land a priced extra notable; on average that adds ${money(c.jackpot)} per jewel (upside, not in the profit).`);
      parts.push(j);
    }
  } else if (best?.craft) parts.push(el('p', 'strategy', `Can't be crafted with alt/aug/regal/exalt here: ${best.craft.reason}.`));

  const url = tradeUrl(best?.trade, best?.query);
  if (url) {
    const a = el('a', 'btn', 'Open this trade search');
    Object.assign(a, { href: url, target: '_blank', rel: 'noopener' });
    a.style.display = 'inline-block';
    a.style.marginTop = '12px';
    a.style.textDecoration = 'none';
    parts.push(a);
  }
  if (best?.trade?.at) parts.push(el('p', 'fine', `Trade price checked ${ago(best.trade.at)}${best.trade.min != null ? ` · cheapest ${money(best.trade.min)}` : ''}.`));

  // pair vs 3 notables
  const tier = best?.tier;
  if (r.notables.length === 2 && r.upgrades.length) {
    const ups = [...r.upgrades].sort((a, b) => (pickTier(b)?.net ?? -Infinity) - (pickTier(a)?.net ?? -Infinity) || b.builds - a.builds);
    parts.push(
      relatedTable(
        'Upgrade to 3 notables',
        'The same jewel with a third notable: what it sells for, how much more than this pair, and what it costs to craft directly.',
        ups,
        tier,
        best?.sell ?? null,
        (u) => `+ ${u.notables.find((n) => !r.notables.includes(n))}`,
      ),
    );
  } else if (r.notables.length === 2 && r.size === 'Large') {
    parts.push(el('p', 'fine', 'No 3-notable version of this pair is tracked yet (only the most used pairs are checked for a third notable).'));
  }
  if (r.notables.length === 3 && r.pairs.length) {
    parts.push(
      relatedTable(
        'Same jewel with 2 notables',
        'The pairs inside this combo, priced without a third notable. "Price jump" is what the third notable adds.',
        r.pairs,
        tier,
        null,
        (u) => u.notables.join(' + '),
      ),
    );
    const rows = parts.at(-1).querySelectorAll('tbody tr');
    r.pairs.forEach((u, i) => {
      const ut = u.tiers.find((t) => t.tier === tier && t.sell != null) || pickTier(u);
      const jump = best?.sell != null && ut?.sell != null ? best.sell - ut.sell : null;
      const cell = rows[i]?.children[2];
      if (cell) {
        cell.textContent = jump != null ? money(jump, { sign: true }) : '—';
        cell.className = signCls(jump) || '';
      }
    });
  }
  box.replaceChildren(...parts);
}

function render() {
  renderHeader();
  renderTable();
  renderDetail();
}

function select(key) {
  state.selected = key;
  renderTable();
  renderDetail();
  if (window.matchMedia('(max-width: 1020px)').matches) $('detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- events ----------
document.addEventListener('click', (e) => {
  const u = e.target.closest('#unit [data-unit]');
  if (u) {
    state.unit = u.dataset.unit;
    save();
    return render();
  }
  const s = e.target.closest('#size [data-size]');
  if (s) {
    state.size = s.dataset.size;
    document.querySelectorAll('#size button').forEach((b) => b.setAttribute('aria-pressed', String(b === s)));
    return renderTable();
  }
  const c = e.target.closest('#count [data-count]');
  if (c) {
    state.count = c.dataset.count;
    document.querySelectorAll('#count button').forEach((b) => b.setAttribute('aria-pressed', String(b === c)));
    return renderTable();
  }
  const th = e.target.closest('.rank th button');
  if (th) {
    const k = th.dataset.sort;
    if (state.sort === k) state.dir = -state.dir;
    else {
      state.sort = k;
      state.dir = k === 'name' || k === 'cost' ? 1 : -1;
    }
    return renderTable();
  }
  const tr = e.target.closest('#rows tr[data-key], #detail tr.link[data-key]');
  if (tr) return select(tr.dataset.key);
  if (e.target.id === 'reset-prices') {
    state.overrides = {};
    save();
    renderPrices();
    resolveAll();
  }
});
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'q') {
    state.q = t.value.trim().toLowerCase();
    renderTable();
  } else if (t.id === 'minlist') {
    state.minList = Number(t.value) || 0;
    renderTable();
    renderDetail();
  } else if (t.id === 'maxbase') {
    state.maxBase = t.value === '' ? null : Number(t.value);
    renderTable();
    renderDetail();
  }
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'tier') {
    state.tier = t.value;
    renderTable();
    renderDetail();
  } else if (t.id === 'byp') {
    state.byproducts = t.checked;
    save();
    resolveAll();
  } else if (t.dataset?.cur) {
    const v = t.value.trim() === '' ? null : Number(t.value);
    if (v == null) delete state.overrides[t.dataset.cur];
    else if (Number.isFinite(v) && v >= 0) state.overrides[t.dataset.cur] = v;
    t.classList.toggle('edited', state.overrides[t.dataset.cur] != null);
    save();
    resolveAll(); // solve-only: craft tables are cached
  }
});

// ---------- boot ----------
try {
  const [api, data] = await Promise.all([
    fetch('/api/clusters').then(async (r) => {
      const b = await r.json().catch(() => ({}));
      if (!r.ok || b.error) throw new Error(b.error || `HTTP ${r.status}`);
      return b;
    }),
    fetch('/data/clusters/cluster-mods.json').then((r) => r.json()),
  ]);
  API = api;
  DATA = data;
  if (API.empty) throw new Error('no builds snapshot collected yet');
  build();
  renderPrices();
  const st = $('status');
  const n2 = ROWS.filter((r) => r.notables.length === 2).length;
  const n3 = ROWS.length - n2;
  st.textContent = `${n2} notable pairs and ${n3} 3-notable combos from ${API.snapshot.characters.toLocaleString('en-US')} characters (poe.ninja, ${ago(API.snapshot.capturedAt)}). Mod weights: RePoE ${DATA.patch}.`;
  const firstPriced = ROWS.find((r) => r.tiers.some(isPriced));
  state.selected = firstPriced?.comboKey || ROWS[0]?.comboKey || null;
  render();
  const prog = el('span', 'progress');
  st.append(' ', prog);
  await prepareAll((done, total) => {
    prog.textContent = done < total ? `Calculating craft costs… ${done}/${total}` : '';
    renderTable();
    if (done === total || done % 25 === 0) renderDetail();
  });
} catch (e) {
  $('league').textContent = 'Data unavailable';
  $('status').textContent = `Could not load cluster data (${e.message}).`;
  $('status').classList.add('warn');
  console.error(e);
}
