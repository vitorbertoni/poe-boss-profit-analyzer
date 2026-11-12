// Mercenaries: which Mercenary Warrants sell for the most, by class, skill and support.
// Data: /api/mercs — per-feature asking-price stats in divines from the trade-mercs collector (last 7 days).

const STORE = 'pbpa:mercs:v1';
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

const state = { unit: 'div', view: 'class', minSellers: 3, q: '', sort: 'median', dir: -1 };
let API = null;
let FEATURES = []; // {kind, feature, obs, sellers, p25, median, p75, supply, statId}
let BASE = null; // the "All warrants" row

try {
  const s = JSON.parse(localStorage.getItem(STORE) || '{}');
  if (s.unit) state.unit = s.unit;
  if (s.view) state.view = s.view;
  if (Number(s.minSellers) > 0) state.minSellers = Number(s.minSellers);
} catch {}
const save = () => {
  try {
    localStorage.setItem(STORE, JSON.stringify({ unit: state.unit, view: state.view, minSellers: state.minSellers }));
  } catch {}
};

// ---------- formatting (stats arrive in divines) ----------
function money(div) {
  if (div == null || !Number.isFinite(div)) return '—';
  if (state.unit === 'chaos' && API?.chaosPerDivine) return `${Math.round(div * API.chaosPerDivine).toLocaleString('en-US')}c`;
  const a = Math.abs(div);
  const d = a >= 100 ? 0 : a >= 10 ? 1 : 2;
  return `${div.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })} div`;
}
const times = (v) => (v == null ? '—' : `${v >= 10 ? Math.round(v) : v.toFixed(1)}×`);
function ago(iso) {
  if (!iso) return 'never';
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  if (m < 60) return `${Math.max(1, m)} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}
const kpi = (label, value, note, cls) => {
  const k = el('div', 'kpi');
  k.append(el('span', null, label), el('b', cls || null, value));
  if (note) k.append(el('small', null, note));
  return k;
};

// ---------- data ----------
function build() {
  const supply = new Map(API.supply.map(([label, statId, total, at]) => [label, { statId, total, at }]));
  FEATURES = API.features.map(([kind, feature, obs, sellers, p25, median, p75]) => {
    const s = supply.get(feature);
    return { kind, feature, obs, sellers, p25, median, p75, supply: s?.total ?? null, statId: s?.statId ?? null };
  });
  BASE = FEATURES.find((f) => f.kind === 'all') || null;
  for (const f of FEATURES) f.premium = BASE?.median > 0 && f.median != null ? f.median / BASE.median : null;
}

const VIEWS = {
  class: (f) => f.kind === 'class',
  gilded: (f) => f.kind === 'support' && f.feature.startsWith('Gilded '),
  support: (f) => f.kind === 'support',
  skill: (f) => f.kind === 'skill',
  other: (f) => f.kind === 'infamous' || f.kind === 'level',
};

function rows() {
  const q = state.q.trim().toLowerCase();
  const list = FEATURES.filter((f) => VIEWS[state.view](f) && f.sellers >= state.minSellers && (!q || f.feature.toLowerCase().includes(q)));
  const key = { feature: (f) => f.feature, median: (f) => f.median, p25: (f) => f.p25, premium: (f) => f.premium, sellers: (f) => f.sellers, supply: (f) => f.supply ?? -1 }[state.sort];
  list.sort((a, b) => {
    const x = key(a);
    const y = key(b);
    if (typeof x === 'string') return x.localeCompare(y) * -state.dir;
    return ((x ?? -Infinity) - (y ?? -Infinity)) * state.dir;
  });
  return list;
}

function tradeUrl(f) {
  const query = { status: { option: 'securable' }, type: 'Mercenary Warrant' };
  if (f?.statId) query.stats = [{ type: 'and', filters: [{ id: f.statId }] }];
  return `https://www.pathofexile.com/trade/search/${encodeURIComponent(API.league)}?q=${encodeURIComponent(JSON.stringify({ query, sort: { price: 'asc' } }))}`;
}

// ---------- render ----------
function renderHeader() {
  $('league').innerHTML = '';
  $('league').append('League ', el('b', null, API.league), API.chaosPerDivine ? ` · 1 div = ${Math.round(API.chaosPerDivine)}c` : '');
  document.querySelectorAll('[data-unit]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.unit === state.unit)));
  const st = $('status');
  const s = API.status;
  st.className = `status${s?.status === 'error' ? ' warn' : ''}`;
  st.textContent = `${API.sample.listings7d.toLocaleString('en-US')} listings from ${API.sample.sellers7d.toLocaleString('en-US')} sellers in the last 7 days · collector ${
    s?.status === 'error' ? 'failed' : 'ran'
  } ${ago(s?.finished_at || s?.started_at)}.`;
}

function renderKpis() {
  const box = $('kpis');
  box.innerHTML = '';
  const inf = FEATURES.find((f) => f.kind === 'infamous' && f.feature === 'Infamous');
  const notInf = FEATURES.find((f) => f.kind === 'infamous' && f.feature === 'Not infamous');
  const topClass = FEATURES.filter((f) => f.kind === 'class' && f.sellers >= state.minSellers).sort((a, b) => b.median - a.median)[0];
  const topGilded = FEATURES.filter(VIEWS.gilded).filter((f) => f.sellers >= state.minSellers).sort((a, b) => b.median - a.median)[0];
  box.append(
    kpi('Median warrant', money(BASE?.median), BASE ? `range ${money(BASE.p25)} – ${money(BASE.p75)}` : null),
    kpi('Infamous premium', inf && notInf?.median > 0 ? times(inf.median / notInf.median) : '—', inf ? `median ${money(inf.median)}` : null),
    kpi('Priciest class', topClass ? topClass.feature : '—', topClass ? `median ${money(topClass.median)}` : null),
    kpi('Priciest Gilded support', topGilded ? topGilded.feature.replace(/ \(Tier \d\)$/, '') : '—', topGilded ? `median ${money(topGilded.median)}` : null),
  );
}

function renderTable() {
  document.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === state.view)));
  document.querySelectorAll('.rank th').forEach((th) => {
    const b = th.querySelector('button');
    if (b) th.setAttribute('aria-sort', b.dataset.sort === state.sort ? (state.dir < 0 ? 'descending' : 'ascending') : 'none');
  });
  const list = rows();
  const body = $('rows');
  body.innerHTML = '';
  const maxPrem = Math.max(1, ...list.map((f) => f.premium || 0));
  for (const f of list) {
    const tr = el('tr');
    const name = el('td', 'nm', f.feature);
    if (f.sellers < 5) name.append(el('span', 'tag', 'thin'));
    const prem = el('td');
    const w = el('span', 'ret');
    const bar = el('i', f.premium != null && f.premium < 1 ? 'neg' : null);
    bar.style.width = `${Math.max(2, Math.round(((f.premium || 0) / maxPrem) * 60))}px`;
    w.append(bar, times(f.premium));
    prem.append(w);
    const link = el('td');
    if (f.kind !== 'level') {
      const a = el('a', 'out', 'Trade ↗');
      a.href = tradeUrl(f.statId || f.kind === 'all' ? f : null);
      a.target = '_blank';
      a.rel = 'noopener';
      a.title = f.statId ? `Warrants with ${f.feature} on the trade site` : 'All warrants on the trade site (class is not a trade filter)';
      link.append(a);
    }
    tr.append(
      name,
      el('td', null, money(f.median)),
      el('td', 'range col-range', `${money(f.p25)} – ${money(f.p75)}`),
      prem,
      el('td', null, f.sellers.toLocaleString('en-US')),
      el('td', 'col-supply', f.supply == null ? '—' : f.supply >= 10000 ? '10,000+' : f.supply.toLocaleString('en-US')),
      link,
    );
    body.append(tr);
  }
  if (!list.length) {
    const tr = el('tr');
    const td = el('td', 'empty', FEATURES.length ? 'Nothing matches these filters yet — lower Min. sellers or clear the search.' : 'Collecting the first samples…');
    td.colSpan = 7;
    tr.append(td);
    body.append(tr);
  }
  $('rank-note').textContent = `${list.length} shown · prices in ${state.unit === 'chaos' ? 'chaos' : 'divines'}`;

  const top = list.filter((f) => f.kind !== 'all').slice(0, 3);
  const t = $('takeaway');
  t.innerHTML = '';
  if (top.length && state.sort === 'median' && state.dir < 0) {
    t.append('Highest asking prices right now: ');
    top.forEach((f, i) => {
      t.append(el('b', null, f.feature), ` (${money(f.median)}, ${times(f.premium)})`, i < top.length - 2 ? ', ' : i === top.length - 2 ? ' and ' : '.');
    });
  }
}

function render() {
  renderHeader();
  renderKpis();
  renderTable();
}

// ---------- events ----------
document.addEventListener('click', (e) => {
  const u = e.target.closest('[data-unit]');
  if (u) {
    state.unit = u.dataset.unit;
    save();
    return render();
  }
  const v = e.target.closest('[data-view]');
  if (v) {
    state.view = v.dataset.view;
    save();
    return renderTable();
  }
  const s = e.target.closest('[data-sort]');
  if (s) {
    if (state.sort === s.dataset.sort) state.dir *= -1;
    else {
      state.sort = s.dataset.sort;
      state.dir = s.dataset.sort === 'feature' ? 1 : -1;
    }
    return renderTable();
  }
});
$('minsellers').addEventListener('input', (e) => {
  const v = Number(e.target.value);
  if (v >= 1) {
    state.minSellers = Math.floor(v);
    save();
    renderKpis();
    renderTable();
  }
});
$('q').addEventListener('input', (e) => {
  state.q = e.target.value;
  renderTable();
});

// ---------- boot ----------
$('minsellers').value = state.minSellers;
try {
  const r = await fetch('/api/mercs');
  const b = await r.json();
  if (!r.ok || b.error) throw new Error(b.error || `HTTP ${r.status}`);
  if (b.empty) {
    $('league').textContent = 'No data yet';
    $('status').textContent = 'The warrant collector has not stored any listings yet. The first run fills this page within a few hours.';
    $('rows').innerHTML = '<tr><td class="empty" colspan="7">Collecting the first samples…</td></tr>';
  } else {
    API = b;
    build();
    render();
  }
} catch (e) {
  $('status').textContent = `Could not load mercenary data (${e.message}).`;
  $('status').classList.add('warn');
}
