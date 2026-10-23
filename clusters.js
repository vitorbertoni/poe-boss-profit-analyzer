// Cluster Jewels: which rare cluster jewels are worth crafting.
// Data: /api/clusters (Supabase views filled by the collectors) + /data/clusters/cluster-mods.json (RePoE).
// Craft costs are computed here with lib/craft/engine.js, so price edits recalculate instantly.
import { prepareCraft, solveCraft } from './lib/craft/engine.js';

const TIERS = [75, 84];
const PASSIVES = { Large: 8, Medium: 4 }; // matches the trade searches
const STORE = 'pbpa:clusters:v1';
const CURRENCY = [
  ['alt', 'Orb of Alteration', 'Alteration'],
  ['aug', 'Orb of Augmentation', 'Augmentation'],
  ['regal', 'Regal Orb', 'Regal'],
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

const state = {
  unit: 'div', size: 'all', tier: 'best', minList: 10, maxBase: null, q: '', sort: 'net', dir: -1, selected: null,
  overrides: {},
};
let API = null;
let DATA = null;
let ROWS = [];
const prepCache = new Map();

// ---------- persistence (per-viewer only) ----------
try {
  const s = JSON.parse(localStorage.getItem(STORE) || '{}');
  if (s.unit) state.unit = s.unit;
  if (s.overrides) state.overrides = s.overrides;
} catch {}
const save = () => {
  try {
    localStorage.setItem(STORE, JSON.stringify({ unit: state.unit, overrides: state.overrides }));
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
function ago(iso) {
  if (!iso) return 'never';
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  if (m < 60) return `${Math.max(1, m)} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

function prices() {
  const p = {};
  for (const [k, name] of CURRENCY) p[k] = state.overrides[k] ?? API.currency[name] ?? 0;
  return p;
}

// ---------- model ----------
function build() {
  const enchants = new Map();
  for (const [size, s] of Object.entries(DATA.sizes)) for (const e of s.enchants) enchants.set(e.tag, { ...e, size, key: enchantKey(e.text) });
  const byKey = new Map([...enchants.values()].map((e) => [`${e.size}|${e.key}`, e]));

  const bases = new Map(); // size|tag|tier -> chaos (fixed passives), fallback: cheapest any passives
  for (const [size, name, passives, tier, chaos, n] of API.bases) {
    const e = byKey.get(`${size}|${enchantKey(name.split(', '))}`);
    if (!e) continue;
    const k = `${size}|${e.tag}|${tier}`;
    if (passives === PASSIVES[size]) bases.set(k, { chaos, n, exact: true });
    else if (!bases.get(k)?.exact && (!bases.has(k) || bases.get(k).chaos > chaos)) bases.set(k, { chaos, n, exact: false, passives });
  }
  const trade = new Map(API.trade.map(([key, tier, listings, sample, min, p25, med, at]) => [`${key}|${tier}`, { listings, sample, min, p25, med, at }]));
  const queries = new Map(API.queries.map(([key, tier, q]) => [`${key}|${tier}`, q]));

  ROWS = API.usage
    .filter((u) => u[2].length === 2)
    .map(([size, tag, notables, builds, share]) => {
      const comboKey = `${size}|${tag}|${[...notables].sort().join('+')}`;
      const tiers = TIERS.map((tier) => ({
        tier,
        base: bases.get(`${size}|${tag}|${tier}`) || null,
        trade: trade.get(`${comboKey}|${tier}`) || null,
        query: queries.get(`${comboKey}|${tier}`) || null,
        craft: null,
      }));
      return { comboKey, size, tag, enchant: enchants.get(tag)?.name || tag, notables, builds, share, tiers };
    });
}

function solveRow(r) {
  const p = prices();
  for (const t of r.tiers) {
    const prep = prepCache.get(`${r.comboKey}|${t.tier}`);
    if (!prep) continue;
    t.craft = solveCraft(prep, { ...p, base: t.base?.chaos ?? 0 });
    t.cost = t.craft.feasible && t.base ? t.craft.expectedCost : null;
    t.sell = t.trade?.sample ? t.trade.med : null;
    t.net = t.cost != null && t.sell != null ? t.sell - t.cost : null;
  }
}

/** Prepares craft tables in small batches so the page stays responsive (~30 ms each). */
async function prepareAll(onProgress) {
  const jobs = [];
  for (const r of ROWS) for (const t of r.tiers) if (!prepCache.has(`${r.comboKey}|${t.tier}`)) jobs.push([r, t]);
  // priced rows first
  jobs.sort((a, b) => (b[1].trade ? 1 : 0) - (a[1].trade ? 1 : 0) || b[0].builds - a[0].builds);
  let done = 0;
  for (const [r, t] of jobs) {
    prepCache.set(`${r.comboKey}|${t.tier}`, prepareCraft(DATA, { size: r.size, enchant: r.tag, ilvl: t.tier, targets: r.notables }));
    solveRow(r);
    if (++done % 6 === 0) {
      onProgress(done, jobs.length);
      await new Promise((res) => setTimeout(res, 0));
    }
  }
  onProgress(jobs.length, jobs.length);
}

function pickTier(r) {
  const ts = r.tiers.filter((t) => (state.tier === 'best' ? true : t.tier === Number(state.tier)));
  const ok = ts.filter((t) => t.net != null && (t.trade?.listings ?? 0) >= state.minList && (state.maxBase == null || (t.base?.chaos ?? Infinity) <= state.maxBase));
  if (ok.length) return ok.sort((a, b) => b.net - a.net)[0];
  return null;
}

function view() {
  const q = state.q;
  const list = ROWS.filter((r) => (state.size === 'all' || r.size === state.size) && (!q || r.notables.some((n) => n.toLowerCase().includes(q)) || r.enchant.toLowerCase().includes(q)))
    .map((r) => ({ r, t: pickTier(r) }));
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
    const name = el('td', 'nm combo', r.notables.join(' + '));
    name.append(el('span', 'sub', `${r.size} · ${r.enchant}`));
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
      name,
      el('td', null, pct(r.share)),
      el('td', 'col-n', t ? (t.tier === 84 ? '84+' : '75–83') : '—'),
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

function tradeUrl(query) {
  return query ? `https://www.pathofexile.com/trade/search/${encodeURIComponent(API.league)}?q=${encodeURIComponent(JSON.stringify(query))}` : null;
}

function renderDetail() {
  const box = $('detail');
  const r = ROWS.find((x) => x.comboKey === state.selected);
  if (!r) {
    box.replaceChildren(el('h2', 'item-title', 'Pick a combo'), el('p', 'item-sub', 'Click a row to see craft cost by item level, the strategy and the trade search.'));
    return;
  }
  const best = pickTier(r) || r.tiers.filter((t) => t.net != null).sort((a, b) => b.net - a.net)[0] || r.tiers[0];
  const kpi = (label, value, cls) => {
    const k = el('div', 'kpi');
    k.append(el('span', null, label), el('b', cls || null, value));
    return k;
  };
  const kpis = el('div', 'kpis four');
  kpis.append(
    kpi('Profit per jewel', money(best?.net, { sign: true }), best?.net >= 0 ? 'pos-t' : 'neg-t'),
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
      el('td', null, t.tier === 84 ? '84+' : '75–83'),
      el('td', null, t.base ? money(t.base.chaos) + (t.base.exact ? '' : '*') : '—'),
      el('td', null, craftOk ? money(t.craft.craftCost) : t.craft ? 'not possible' : '…'),
      el('td', null, t.sell != null ? money(t.sell) : t.trade ? 'no listings' : 'not priced'),
      el('td', t.net == null ? null : t.net >= 0 ? 'pos-t' : 'neg-t', t.net != null ? money(t.net, { sign: true }) : '—'),
      el('td', null, t.trade ? String(t.trade.listings) : '—'),
    );
    table.tBodies[0].append(tr);
  }

  const parts = [el('h2', 'item-title', r.notables.join(' + ')), el('p', 'item-sub', `${r.size} cluster · ${r.enchant} · used by ${pct(r.share)} of characters`), kpis];
  const panel = el('div');
  panel.style.marginTop = '14px';
  panel.append(table);
  if (r.tiers.some((t) => t.base && !t.base.exact)) panel.append(el('p', 'fine', `* no ${PASSIVES[r.size]}-passive base listed; cheapest other passive count shown.`));
  parts.push(panel);

  if (best?.craft?.feasible) {
    const c = best.craft;
    const s = el('p', 'strategy');
    s.append(el('b', null, 'How: '), c.strategy.label);
    const n = el('p', 'strategy');
    n.append(
      el('b', null, 'Expected currency: '),
      `${Math.round(c.expected.alterations)} Alteration, ${c.expected.augs.toFixed(1)} Augmentation, ${c.expected.regals.toFixed(1)} Regal, ${c.expected.resets.toFixed(1)} Scouring + Transmutation. Half of crafts finish under ${money(c.p50)} including the base.`,
    );
    parts.push(s, n);
  } else if (best?.craft) parts.push(el('p', 'strategy', `Can't be crafted with alt/aug/regal here: ${best.craft.reason}.`));

  const url = tradeUrl(best?.query);
  if (url) {
    const a = el('a', 'btn', 'Open this trade search');
    Object.assign(a, { href: url, target: '_blank', rel: 'noopener' });
    a.style.display = 'inline-block';
    a.style.marginTop = '12px';
    a.style.textDecoration = 'none';
    parts.push(a);
  }
  if (best?.trade?.at) parts.push(el('p', 'fine', `Trade price checked ${ago(best.trade.at)}${best.trade.min != null ? ` · cheapest ${money(best.trade.min)}` : ''}.`));
  box.replaceChildren(...parts);
}

function render() {
  renderHeader();
  renderTable();
  renderDetail();
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
  const tr = e.target.closest('#rows tr[data-key]');
  if (tr) {
    state.selected = tr.dataset.key;
    renderTable();
    renderDetail();
    if (window.matchMedia('(max-width: 1020px)').matches) $('detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  if (e.target.id === 'reset-prices') {
    state.overrides = {};
    save();
    renderPrices();
    ROWS.forEach(solveRow);
    render();
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
  } else if (t.dataset?.cur) {
    const v = t.value.trim() === '' ? null : Number(t.value);
    if (v == null) delete state.overrides[t.dataset.cur];
    else if (Number.isFinite(v) && v >= 0) state.overrides[t.dataset.cur] = v;
    t.classList.toggle('edited', state.overrides[t.dataset.cur] != null);
    save();
    ROWS.forEach(solveRow); // solve-only: tables are cached, so this is instant
    renderTable();
    renderDetail();
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
  st.textContent = `${ROWS.length} notable pairs from ${API.snapshot.characters.toLocaleString('en-US')} characters (poe.ninja, ${ago(API.snapshot.capturedAt)}). Mod weights: RePoE ${DATA.patch}.`;
  const firstPriced = ROWS.find((r) => r.tiers.some((t) => t.trade));
  state.selected = firstPriced?.comboKey || ROWS[0]?.comboKey || null;
  render();
  const prog = el('span', 'progress');
  st.append(' ', prog);
  await prepareAll((done, total) => {
    prog.textContent = done < total ? `Calculating craft costs… ${done}/${total}` : '';
    renderTable();
    if (done === total || done % 24 === 0) renderDetail();
  });
} catch (e) {
  $('league').textContent = 'Data unavailable';
  $('status').textContent = `Could not load cluster data (${e.message}).`;
  $('status').classList.add('warn');
}
