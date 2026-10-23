// League Investments: how currency/fragment prices move through a PoE1 league.
// Data: /api/history, built from poe.ninja data dumps (see lib/history.js).
// { days: [checkpoint days], leagues: [...], divine: {league: [chaos per divine]}, items: [[name, isFrag, {league: [chaos]}]] }

const BUY = [1, 2, 3, 5, 7, 10, 14, 21, 30];
const SELL = [7, 10, 14, 21, 30, 45, 60, 75, 90];
const MIN_LEAGUES = 4;
const COLORS = ['#c9a45c', '#5fb3b3', '#a58bd6', '#74c27c', '#d9675e', '#6f9fd8', '#d68ab0', '#b9b08a'];

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const svgEl = (tag, attrs = {}) => {
  const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};

const nf0 = new Intl.NumberFormat('en', { maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const pct = (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + nf0.format(Math.abs(v * 100)) + '%';
const share = (v) => nf0.format(v * 100) + '%';
const chaosFmt = (v) => (v >= 10000 ? compact.format(v) : v >= 10 ? nf0.format(v) : v >= 1 ? v.toFixed(1) : v.toFixed(2)) + 'c';
const divFmt = (v) =>
  (v >= 100 ? nf0.format(v) : v >= 1 ? v.toFixed(2) : v >= 0.01 ? v.toFixed(3) : v.toExponential(1)) + ' div';
const median = (a) => {
  const b = [...a].sort((x, y) => x - y);
  const m = b.length >> 1;
  return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
};

const state = { buy: 7, sell: 60, cat: 'all', q: '', cons: true, unit: 'div', item: 'Exceptional Eldritch Ember', sort: 'med', dir: -1 };
let DATA = null;
let RANK = new Map(); // "buy|sell" -> rows

// ---------- URL state ----------
function readUrl() {
  const p = new URLSearchParams(location.search);
  const num = (k, list) => (list.includes(Number(p.get(k))) ? Number(p.get(k)) : null);
  state.buy = num('buy', BUY) ?? state.buy;
  state.sell = num('sell', SELL) ?? state.sell;
  if (state.sell <= state.buy) state.sell = SELL.find((s) => s > state.buy);
  if (['all', 'cur', 'frag'].includes(p.get('cat'))) state.cat = p.get('cat');
  if (p.get('unit') === 'chaos') state.unit = 'chaos';
  if (p.get('all') === '1') state.cons = false;
  if (p.get('item')) state.item = p.get('item');
}
function writeUrl() {
  const p = new URLSearchParams();
  p.set('buy', state.buy);
  p.set('sell', state.sell);
  if (state.cat !== 'all') p.set('cat', state.cat);
  if (state.unit !== 'div') p.set('unit', state.unit);
  if (!state.cons) p.set('all', '1');
  p.set('item', state.item);
  history.replaceState(null, '', `${location.pathname}?${p}`);
}

// ---------- data ----------
async function load() {
  const res = await fetch('/api/history');
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

function prepare(raw) {
  const idx = Object.fromEntries(raw.days.map((d, i) => [d, i]));
  const items = raw.items.map(([name, frag, ls]) => ({ name, frag: !!frag, ls }));
  return { ...raw, idx, items };
}

function ranking(b, s) {
  const key = `${b}|${s}`;
  if (RANK.has(key)) return RANK.get(key);
  const { idx, divine, items } = DATA;
  const ib = idx[b], is = idx[s];
  const rows = [];
  for (const it of items) {
    const rets = [], buys = [];
    for (const [lg, series] of Object.entries(it.ls)) {
      const pb = series[ib], ps = series[is], db = divine[lg]?.[ib], ds = divine[lg]?.[is];
      if (pb > 0 && ps > 0 && db > 0 && ds > 0) {
        rets.push(ps / ds / (pb / db) - 1);
        buys.push(pb);
      }
    }
    if (rets.length < MIN_LEAGUES) continue;
    rows.push({
      name: it.name, frag: it.frag, n: rets.length, med: median(rets),
      pos: rets.filter((r) => r > 0).length / rets.length,
      worst: Math.min(...rets), best: Math.max(...rets), buyC: median(buys),
    });
  }
  RANK.set(key, rows);
  return rows;
}

// ---------- controls ----------
function setupControls() {
  const buy = $('buy'), sell = $('sell');
  buy.replaceChildren(...BUY.map((d) => new Option(`Day ${d}`, d)));
  sell.replaceChildren(...SELL.map((d) => new Option(`Day ${d}`, d)));
  buy.addEventListener('change', () => {
    state.buy = Number(buy.value);
    if (state.sell <= state.buy) state.sell = SELL.find((x) => x > state.buy);
    render();
  });
  sell.addEventListener('change', () => {
    state.sell = Number(sell.value);
    if (state.buy >= state.sell) state.buy = [...BUY].reverse().find((x) => x < state.sell);
    render();
  });
  $('cat').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-cat]');
    if (b) { state.cat = b.dataset.cat; render(); }
  });
  $('q').addEventListener('input', (e) => { state.q = e.target.value.trim().toLowerCase(); renderTable(); });
  $('cons').addEventListener('change', (e) => { state.cons = e.target.checked; render(); });
  document.querySelectorAll('.controls .seg button[data-unit]').forEach((b) =>
    b.addEventListener('click', () => { state.unit = b.dataset.unit; render(); })
  );
  document.querySelectorAll('.rank th button').forEach((b) =>
    b.addEventListener('click', () => {
      const k = b.dataset.sort;
      if (state.sort === k) state.dir = -state.dir;
      else { state.sort = k; state.dir = k === 'name' ? 1 : -1; }
      renderTable();
    })
  );
  $('rows').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-name]');
    if (!tr) return;
    state.item = tr.dataset.name;
    render();
    if (window.matchMedia('(max-width: 1020px)').matches) $('item-name').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  let t;
  window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(renderCharts, 120); });
}

// ---------- render ----------
function render() {
  $('buy').value = state.buy;
  $('sell').value = state.sell;
  $('cons').checked = state.cons;
  document.querySelectorAll('#cat button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.cat === state.cat)));
  document.querySelectorAll('.controls .seg button[data-unit]').forEach((b) =>
    b.setAttribute('aria-pressed', String(b.dataset.unit === state.unit))
  );
  writeUrl();
  renderTakeaway();
  renderTable();
  renderItem();
  renderCharts();
}

function renderTakeaway() {
  const rows = ranking(state.buy, state.sell);
  const top = rows.filter((r) => r.pos >= 0.7 && r.n >= 5).sort((a, b) => b.med - a.med).slice(0, 3);
  const p = $('takeaway');
  p.replaceChildren(`Buying on day ${state.buy} and selling on day ${state.sell}, the most consistent gainers were `);
  if (!top.length) { p.append('— none in this window.'); return; }
  top.forEach((r, i) => {
    p.append(el('b', null, r.name), ` (${pct(r.med)} median)`, i < top.length - 2 ? ', ' : i === top.length - 2 ? ' and ' : '.');
  });
}

function filtered() {
  let rows = ranking(state.buy, state.sell);
  if (state.cat === 'cur') rows = rows.filter((r) => !r.frag);
  if (state.cat === 'frag') rows = rows.filter((r) => r.frag);
  if (state.cons) rows = rows.filter((r) => r.pos >= 0.7);
  if (state.q) rows = rows.filter((r) => r.name.toLowerCase().includes(state.q));
  const k = state.sort;
  return [...rows].sort((a, b) => (k === 'name' ? a.name.localeCompare(b.name) : a[k] - b[k]) * state.dir);
}

function renderTable() {
  const rows = filtered();
  document.querySelectorAll('.rank th').forEach((th) => {
    const k = th.querySelector('button').dataset.sort;
    th.setAttribute('aria-sort', k === state.sort ? (state.dir > 0 ? 'ascending' : 'descending') : 'none');
  });
  $('rank-note').textContent = `${rows.length} items · day ${state.buy} → day ${state.sell}`;
  const tbody = $('rows');
  if (!rows.length) {
    const tr = el('tr'); const td = el('td', 'empty', 'No items match these filters.'); td.colSpan = 7; tr.append(td);
    tbody.replaceChildren(tr);
    return;
  }
  const maxMed = Math.max(...rows.map((r) => Math.max(r.med, 0)), 0.0001);
  tbody.replaceChildren(
    ...rows.map((r) => {
      const tr = el('tr');
      tr.dataset.name = r.name;
      tr.setAttribute('aria-selected', String(r.name === state.item));
      const name = el('td', 'nm', r.name);
      name.append(el('span', 'tag', r.frag ? 'frag' : 'currency'));
      const ret = el('td');
      const wrap = el('span', 'ret ' + (r.med >= 0 ? 'pos-t' : 'neg-t'));
      if (r.med > 0) { const bar = el('i'); bar.style.width = `${Math.max(2, (48 * r.med) / maxMed)}px`; wrap.append(bar); }
      wrap.append(pct(r.med));
      ret.append(wrap);
      tr.append(
        name,
        el('td', null, chaosFmt(r.buyC)),
        ret,
        el('td', null, share(r.pos)),
        el('td', r.worst >= 0 ? 'pos-t' : 'neg-t', pct(r.worst)),
        el('td', 'col-best', pct(r.best)),
        el('td', 'col-n', String(r.n))
      );
      return tr;
    })
  );
}

function renderItem() {
  const r = ranking(state.buy, state.sell).find((x) => x.name === state.item);
  const it = DATA.items.find((x) => x.name === state.item);
  $('item-name').textContent = state.item;
  $('item-sub').textContent = it
    ? `${it.frag ? 'Fragment' : 'Currency'} · day ${state.buy} → day ${state.sell}`
    : 'Not in the data';
  const set = (id, text, cls) => { const n = $(id); n.textContent = text; n.className = cls || ''; };
  if (r) {
    set('k-med', pct(r.med), r.med >= 0 ? 'pos-t' : 'neg-t');
    set('k-pos', `${Math.round(r.pos * r.n)} of ${r.n}`);
    set('k-worst', pct(r.worst), r.worst >= 0 ? 'pos-t' : 'neg-t');
    set('k-buy', chaosFmt(r.buyC));
  } else {
    for (const id of ['k-med', 'k-pos', 'k-worst', 'k-buy']) set(id, '—');
    $('item-sub').textContent += ' · not enough history for this window';
  }
}

function renderCharts() {
  if (!DATA) return;
  drawCurve();
  drawDivine();
}

// ---------- charts (plain SVG) ----------
function lineChart({ svg, wrap, tip, series, log, fmt, tickFmt = fmt, marks = [], height }) {
  const W = Math.max(280, wrap.clientWidth);
  const H = height;
  svg.replaceChildren();
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', '100%');
  const vals = series.flatMap((s) => s.pts.map((p) => p.v));
  if (!vals.length) { tip.style.display = 'none'; return; }
  let lo = Math.min(...vals), hi = Math.max(...vals);
  let ticks;
  const T = (v) => (log ? Math.log10(v) : v);
  if (log) {
    lo = Math.pow(10, Math.floor(Math.log10(lo)));
    hi = Math.pow(10, Math.ceil(Math.log10(hi)));
    if (lo === hi) hi = lo * 10;
    ticks = [];
    for (let e = Math.log10(lo); e <= Math.log10(hi) + 1e-9; e++) ticks.push(Math.pow(10, e));
    if (ticks.length > 6) ticks = ticks.filter((_, i) => i % Math.ceil(ticks.length / 5) === 0);
  } else {
    lo = 0;
    const step = Math.pow(10, Math.floor(Math.log10(hi / 4)));
    const nice = [1, 2, 5, 10].map((m) => m * step).find((st) => hi / st <= 5) || step * 10;
    hi = Math.ceil(hi / nice) * nice;
    ticks = [];
    for (let v = 0; v <= hi + 1e-9; v += nice) ticks.push(v);
  }
  // left margin from widest label
  const probe = svgEl('text', { x: 0, y: -10 });
  svg.append(probe);
  let ml = 0;
  for (const t of ticks) { probe.textContent = tickFmt(t); ml = Math.max(ml, probe.getComputedTextLength()); }
  probe.remove();
  const m = { t: 10, r: 10, b: 22, l: Math.ceil(ml) + 10 };
  const w = W - m.l - m.r, h = H - m.t - m.b;
  const X = (d) => m.l + (d / 120) * w;
  const Y = (v) => m.t + h - ((T(v) - T(lo)) / (T(hi) - T(lo))) * h;

  const grid = svgEl('g', { class: 'grid' });
  for (const t of ticks) {
    grid.append(svgEl('line', { x1: m.l, x2: m.l + w, y1: Y(t), y2: Y(t) }));
    const tx = svgEl('text', { x: m.l - 6, y: Y(t) + 4, 'text-anchor': 'end' });
    tx.textContent = tickFmt(t);
    grid.append(tx);
  }
  const xTicks = w > 360 ? [0, 14, 30, 45, 60, 90, 120] : [0, 30, 60, 90, 120];
  xTicks.forEach((d, i) => {
    const anchor = i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle';
    const tx = svgEl('text', { x: X(d), y: H - 5, 'text-anchor': anchor });
    tx.textContent = `d${d}`;
    grid.append(tx);
  });
  svg.append(grid);
  svg.append(svgEl('line', { class: 'axis', x1: m.l, x2: m.l + w, y1: m.t + h, y2: m.t + h }));

  for (const mk of marks) {
    svg.append(svgEl('line', { class: 'mark', x1: X(mk.d), x2: X(mk.d), y1: m.t, y2: m.t + h }));
    const tx = svgEl('text', { class: 'mark-t', x: X(mk.d) + 4, y: m.t + 10 });
    tx.textContent = mk.label;
    svg.append(tx);
  }

  const lines = series.map((s) => {
    const d = s.pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.d).toFixed(1)},${Y(p.v).toFixed(1)}`).join('');
    const path = svgEl('path', { class: 'ln', d, stroke: s.color });
    svg.append(path);
    return path;
  });

  const rule = svgEl('line', { class: 'axis', y1: m.t, y2: m.t + h, visibility: 'hidden' });
  svg.append(rule);
  const dots = svgEl('g');
  svg.append(dots);
  const hit = svgEl('rect', { x: m.l, y: m.t, width: w, height: h, fill: 'transparent' });
  svg.append(hit);

  const days = [...new Set(series.flatMap((s) => s.pts.map((p) => p.d)))].sort((a, b) => a - b);
  const move = (ev) => {
    const rect = svg.getBoundingClientRect();
    const sx = ((ev.clientX - rect.left) / rect.width) * W;
    const dRaw = ((sx - m.l) / w) * 120;
    const d = days.reduce((best, x) => (Math.abs(x - dRaw) < Math.abs(best - dRaw) ? x : best), days[0]);
    rule.setAttribute('x1', X(d)); rule.setAttribute('x2', X(d)); rule.setAttribute('visibility', 'visible');
    dots.replaceChildren();
    tip.replaceChildren(el('div', 'd', `Day ${d}`));
    for (const s of series) {
      const p = s.pts.find((q) => q.d === d);
      if (!p) continue;
      dots.append(svgEl('circle', { class: 'dot', cx: X(d), cy: Y(p.v), r: 3.5, fill: s.color }));
      const row = el('div');
      const sw = el('i'); sw.style.background = s.color;
      row.append(sw, `${s.name}: ${fmt(p.v)}`);
      tip.append(row);
    }
    tip.style.display = 'block';
    const px = (X(d) / W) * rect.width;
    const tw = tip.offsetWidth;
    let left = px + 14;
    if (left + tw > rect.width) left = px - tw - 14;
    tip.style.left = `${Math.max(0, left)}px`;
    tip.style.top = `${(m.t / H) * rect.height + 4}px`;
  };
  hit.addEventListener('mousemove', move);
  hit.addEventListener('mouseleave', () => {
    tip.style.display = 'none'; rule.setAttribute('visibility', 'hidden'); dots.replaceChildren();
  });
  return lines;
}

function drawCurve() {
  const it = DATA.items.find((x) => x.name === state.item);
  const legend = $('legend');
  legend.replaceChildren();
  $('chart-unit').textContent = `log scale, in ${state.unit === 'div' ? 'divine' : 'chaos'}`;
  const series = [];
  if (it) {
    DATA.leagues.forEach((lg, li) => {
      const s = it.ls[lg];
      if (!s) return;
      const pts = [];
      DATA.days.forEach((d, i) => {
        const c = s[i], dv = DATA.divine[lg]?.[i];
        if (!(c > 0)) return;
        const v = state.unit === 'div' ? (dv > 0 ? c / dv : null) : c;
        if (v > 0) pts.push({ d, v });
      });
      if (pts.length) series.push({ name: lg, color: COLORS[li % COLORS.length], pts });
    });
  }
  const fmt = state.unit === 'div' ? (v) => divFmt(v).replace(' div', '') : chaosFmt;
  const lines = lineChart({
    svg: $('curve'), wrap: $('curve-wrap'), tip: $('curve-tip'), series, log: true, fmt,
    tickFmt: (v) => (v >= 1000 ? compact.format(v) : v >= 1 ? nf0.format(v) : String(Number(v.toPrecision(1)))) + (state.unit === 'div' ? '' : 'c'),
    marks: [{ d: state.buy, label: 'buy' }, { d: state.sell, label: 'sell' }], height: 280,
  });
  series.forEach((s, i) => {
    const sp = el('span');
    const sw = el('i'); sw.style.background = s.color;
    sp.append(sw, s.name);
    sp.addEventListener('mouseenter', () => { $('curve').classList.add('dim'); lines?.[i]?.classList.add('hot'); });
    sp.addEventListener('mouseleave', () => { $('curve').classList.remove('dim'); lines?.[i]?.classList.remove('hot'); });
    legend.append(sp);
  });
}

function drawDivine() {
  const series = DATA.leagues.map((lg, li) => ({
    name: lg, color: COLORS[li % COLORS.length],
    pts: DATA.days.map((d, i) => ({ d, v: DATA.divine[lg][i] })).filter((p) => p.v > 0),
  }));
  lineChart({ svg: $('divchart'), wrap: $('div-wrap'), tip: $('div-tip'), series, log: false, fmt: (v) => nf0.format(v) + 'c', height: 200 });
}

// ---------- boot ----------
readUrl();
setupControls();
load()
  .then((raw) => {
    DATA = prepare(raw);
    if (!DATA.items.some((x) => x.name === state.item)) state.item = DATA.items[0].name;
    const first = DATA.leagues[0], last = DATA.leagues[DATA.leagues.length - 1];
    $('league').replaceChildren(el('b', null, `${DATA.leagues.length} leagues`), ` · ${first} → ${last}`);
    $('m-leagues').textContent = DATA.leagues.join(', ');
    $('status').textContent = `${DATA.items.length} currencies and fragments tracked. Click a row to see its price curve.`;
    render();
  })
  .catch((e) => {
    $('league').textContent = 'Data unavailable';
    $('status').textContent = `Could not load price history (${e.message}).`;
    $('status').classList.add('warn');
  });
