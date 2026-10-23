import { BOSSES } from './data/bosses.js';
import { buildModel, simulate, priceKey } from './lib/calc.js';

const RUNS = [5, 10, 100];
const ITERS = 10000;
const STORE = 'pbpa:v1';

const state = {
  prices: {},
  meta: null,
  unit: 'div',
  selected: null,
  simRuns: 10,
  overrides: { price: {}, chance: {} },
};

const $ = (s) => document.querySelector(s);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ---------- persistence (per-viewer convenience only) ----------
function loadPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || '{}');
    if (saved.unit) state.unit = saved.unit;
    if (saved.overrides) state.overrides = { price: {}, chance: {}, ...saved.overrides };
    if (saved.selected) state.selected = saved.selected;
  } catch {}
}
function savePrefs() {
  try {
    localStorage.setItem(STORE, JSON.stringify({ unit: state.unit, overrides: state.overrides, selected: state.selected }));
  } catch {}
}

// ---------- money formatting ----------
const D = () => state.meta?.chaosPerDivine || 1;
function money(chaos, { sign = false } = {}) {
  if (chaos == null || Number.isNaN(chaos)) return '—';
  const s = sign && chaos > 0 ? '+' : '';
  if (state.unit === 'chaos') return `${s}${Math.round(chaos).toLocaleString('en-US')}c`;
  const d = chaos / D();
  const abs = Math.abs(d);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return `${s}${d.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })} div`;
}
const toUnit = (chaos) => (chaos == null ? '' : state.unit === 'chaos' ? round(chaos, 1) : round(chaos / D(), 3));
const fromUnit = (v) => (state.unit === 'chaos' ? v : v * D());
const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
const pct = (v, d = 0) => `${(v * 100).toFixed(d)}%`;
const signCls = (v) => (v >= 0 ? 'pos' : 'neg');

// ---------- data loading ----------
async function loadPrices() {
  try {
    const res = await fetch('/api/prices');
    if (!res.ok) throw new Error(`API ${res.status}`);
    const data = await res.json();
    state.prices = data.prices;
    state.meta = { ...data, source: 'live' };
  } catch (e) {
    const snap = await fetch('/data/snapshot.json').then((r) => r.json());
    state.prices = Object.fromEntries(Object.entries(snap.p).map(([k, [c, n]]) => [k, { c, n }]));
    state.meta = { league: snap.league, chaosPerDivine: snap.chaosPerDivine, updatedAt: snap.updatedAt, source: 'snapshot' };
    console.warn('Live prices unavailable, using snapshot:', e);
  }
}

function ago(iso) {
  const min = Math.round((Date.now() - new Date(iso)) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

// ---------- rendering ----------
function models() {
  return BOSSES.map((b) => buildModel(b, state.prices, state.overrides)).sort((a, b) => (b.roi ?? -9) - (a.roi ?? -9));
}

function renderHeader() {
  const m = state.meta;
  $('#league').innerHTML = `League <b>${esc(m.league)}</b> · 1 div = ${Math.round(m.chaosPerDivine)}c`;
  const st = $('#status');
  if (m.source === 'live') {
    st.className = 'status';
    st.textContent = `Prices from poe.ninja, updated ${ago(m.updatedAt)}.`;
  } else {
    st.className = 'status warn';
    st.textContent = `Live prices are unavailable right now. Showing a saved snapshot from ${new Date(m.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}.`;
  }
  document.querySelectorAll('.seg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.unit === state.unit)));
}

function fragIcon(model) {
  const icon = state.prices[model.boss.fragment.ref]?.icon;
  return icon
    ? `<span class="frag-icon"><img src="${esc(icon)}" alt="" loading="lazy" /></span>`
    : `<span class="frag-icon">${esc(model.boss.name.replace('Uber ', '')[0])}</span>`;
}

function roiChip(roi) {
  if (roi == null) return '<span class="roi">—</span>';
  return `<span class="roi ${signCls(roi)}">${roi >= 0 ? '+' : ''}${Math.round(roi * 100)}%</span>`;
}

function renderGrid(all) {
  $('#grid').innerHTML = all
    .map(
      (m) => `
    <button class="card" data-boss="${m.boss.id}" aria-pressed="${m.boss.id === state.selected}">
      <div class="card-head">
        ${fragIcon(m)}
        <div>
          <div class="card-name">${esc(m.boss.name)}</div>
          <div class="card-frag">${m.boss.fragment.qty}× ${esc(m.boss.fragment.name)}</div>
        </div>
      </div>
      <div class="card-stats">
        <div>Cost<b>${money(m.cost)}</b></div>
        <div>Return<b>${money(m.ev)}</b></div>
        ${roiChip(m.roi)}
      </div>
    </button>`,
    )
    .join('');
}

function itemIcon(row) {
  return row.price.icon ? `<img src="${esc(row.price.icon)}" alt="" loading="lazy" />` : '<span class="ph"></span>';
}

function dropRow(model, row, kind) {
  const b = [];
  if (row.rateUnknown) b.push('<span class="badge warn" title="The wiki lists this drop without an estimated rate">rate unknown</span>');
  if (row.price.c == null) b.push('<span class="badge warn" title="Not listed on poe.ninja — type a price">no price</span>');
  else if (row.price.src === 'ninja' && row.price.n < 20) b.push(`<span class="badge warn" title="Only ${row.price.n} listings — price may be unreliable">low volume</span>`);
  const priceEdited = row.price.src === 'manual';
  const note = row.item.note ? `<span class="item-note">${esc(row.item.note)}</span>` : '';
  return `
    <tr>
      <td><div class="item">${itemIcon(row)}<div><span class="item-name">${esc(row.item.name)}</span>${b.join('')}${note}</div></div></td>
      <td class="num"><input class="in ${row.rateEdited ? 'edited' : ''}" type="number" min="0" step="any" inputmode="decimal"
        data-chance="${model.boss.id}/${row.key}" value="${row.pct ?? ''}" placeholder="?" aria-label="${kind === 'pick' ? 'Weight' : 'Drop chance'} for ${esc(row.item.name)}" /><span class="unit">%</span></td>
      <td class="num"><input class="in ${priceEdited ? 'edited' : ''}" type="number" min="0" step="any" inputmode="decimal"
        data-price="${esc(priceKey(row.item))}" value="${toUnit(row.price.c)}" placeholder="—" aria-label="Price for ${esc(row.item.name)}" /></td>
      <td class="num col-ev">${money(row.ev)}</td>
    </tr>`;
}

function renderDrops(model) {
  return model.groups
    .map(
      (g) => `
    <div class="group">
      <div class="group-head">
        <h4>${esc(g.label)}${g.kind === 'pick' ? '<em>one of</em>' : ''}</h4>
        <span>${money(g.ev)} / kill</span>
      </div>
      <table>
        <thead><tr><th>Item</th><th>Chance</th><th>Price (${state.unit === 'chaos' ? 'c' : 'div'})</th><th class="col-ev">EV</th></tr></thead>
        <tbody>${g.rows.map((r) => dropRow(model, r, g.kind)).join('')}</tbody>
      </table>
    </div>`,
    )
    .join('');
}

function histogramSvg(sim) {
  const { lo, width, counts } = sim.hist;
  const W = 600;
  const H = 170;
  const pad = { l: 6, r: 6, t: 8, b: 22 };
  const max = Math.max(...counts);
  const bw = (W - pad.l - pad.r) / counts.length;
  const x = (v) => pad.l + ((v - lo) / (width * counts.length)) * (W - pad.l - pad.r);
  const bars = counts
    .map((c, i) => {
      const h = max ? (c / max) * (H - pad.t - pad.b) : 0;
      const mid = lo + (i + 0.5) * width;
      const color = mid >= 0 ? 'var(--pos)' : 'var(--neg)';
      return `<rect x="${pad.l + i * bw + 1}" y="${H - pad.b - h}" width="${Math.max(1, bw - 2)}" height="${h}" rx="2" fill="${color}" opacity="0.85"><title>${money(lo + i * width)} to ${money(lo + (i + 1) * width)}: ${pct(c / sim.iters, 1)} of sessions</title></rect>`;
    })
    .join('');
  const hi = lo + width * counts.length;
  const zero = lo < 0 && hi > 0 ? `<line x1="${x(0)}" x2="${x(0)}" y1="${pad.t}" y2="${H - pad.b}" stroke="var(--gold)" stroke-dasharray="3 3" /><text x="${x(0)}" y="${H - 6}" text-anchor="middle">break-even</text>` : '';
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Distribution of profit over ${sim.runs} runs">
    <line x1="${pad.l}" x2="${W - pad.r}" y1="${H - pad.b}" y2="${H - pad.b}" stroke="var(--line)" />
    ${bars}${zero}
    <text x="${pad.l}" y="${H - 6}">${money(lo, { sign: true })}</text>
    <text x="${W - pad.r}" y="${H - 6}" text-anchor="end">${money(hi, { sign: true })}</text>
  </svg>`;
}

function renderDetail(model) {
  const b = model.boss;
  const sims = Object.fromEntries(RUNS.map((n) => [n, simulate(model, n, ITERS)]));
  const sim = sims[state.simRuns];
  const fragC = model.fragPrice.c;

  $('#detail').innerHTML = `
    <div class="detail-head">
      <div>
        <h2>${esc(b.name)}</h2>
        <p>Drop rates: <a href="https://www.poewiki.net/wiki/${encodeURIComponent(b.wiki)}" target="_blank" rel="noopener">poewiki</a> estimates, ${esc(b.sample)}.${b.note ? ` ${esc(b.note)}` : ''}</p>
      </div>
      <button class="btn" id="reset">Reset my edits</button>
    </div>
    <div class="layout">
      <div class="panel drops">
        <h3>Drops <small>edit any chance or price</small></h3>
        ${renderDrops(model)}
      </div>
      <div class="side">
        <div class="panel">
          <h3>Per kill</h3>
          <div class="kpis">
            <div class="kpi"><span>Cost</span><b>${money(model.cost)}</b></div>
            <div class="kpi"><span>Expected return</span><b>${money(model.ev)}</b></div>
            <div class="kpi"><span>ROI</span><b class="${model.roi == null ? '' : signCls(model.roi) + '-t'}">${model.roi == null ? '—' : (model.roi >= 0 ? '+' : '') + Math.round(model.roi * 100) + '%'}</b></div>
          </div>
          <div class="cost-line">
            Entry: ${b.fragment.qty} ×
            <input class="in ${model.fragPrice.src === 'manual' ? 'edited' : ''}" type="number" min="0" step="any" inputmode="decimal"
              data-price="${esc(priceKey(b.fragment))}" value="${toUnit(fragC)}" placeholder="—" aria-label="Price of ${esc(b.fragment.name)}" />
            <span>${state.unit === 'chaos' ? 'c' : 'div'} (${esc(b.fragment.name)})</span>
          </div>
        </div>

        <div class="panel">
          <h3>Expected return</h3>
          <table class="returns">
            <thead><tr><th>Runs</th><th>Invested</th><th>Return</th><th>Profit</th></tr></thead>
            <tbody>${RUNS.map(
              (n) => `<tr><td>${n}</td><td>${money(model.cost * n)}</td><td>${money(model.ev * n)}</td><td class="${signCls(model.profit)}-t">${money(model.profit * n, { sign: true })}</td></tr>`,
            ).join('')}</tbody>
          </table>
        </div>

        <div class="panel">
          <h3>Simulation <small>${ITERS.toLocaleString('en-US')} sessions</small></h3>
          <div class="seg" role="group" aria-label="Session length">
            ${RUNS.map((n) => `<button data-runs="${n}" aria-pressed="${n === state.simRuns}">${n} runs</button>`).join('')}
          </div>
          <div class="sim-stats">
            <div class="kpi"><span>Chance of profit</span><b class="${sim.pProfit >= 0.5 ? 'pos' : 'neg'}-t">${pct(sim.pProfit)}</b></div>
            <div class="kpi"><span>Median result</span><b class="${signCls(sim.median)}-t">${money(sim.median, { sign: true })}</b></div>
            <div class="kpi"><span>Bad luck (P10)</span><b class="${signCls(sim.p10)}-t">${money(sim.p10, { sign: true })}</b></div>
            <div class="kpi"><span>Good luck (P90)</span><b class="${signCls(sim.p90)}-t">${money(sim.p90, { sign: true })}</b></div>
          </div>
          ${histogramSvg(sim)}
          <p class="fine">Profit after paying for ${sim.runs} sets of fragments. Chase drops make the distribution lopsided: the median can sit well below the average. Chart shows the 1st–99th percentile.</p>
        </div>
      </div>
    </div>`;
}

function render() {
  const all = models();
  if (!state.selected || !all.some((m) => m.boss.id === state.selected)) state.selected = all[0].boss.id;
  renderHeader();
  renderGrid(all);
  renderDetail(all.find((m) => m.boss.id === state.selected));
}

// ---------- events ----------
document.addEventListener('click', (e) => {
  const card = e.target.closest('[data-boss]');
  if (card) {
    state.selected = card.dataset.boss;
    savePrefs();
    render();
    if (window.innerWidth < 960) $('#detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  const unit = e.target.closest('[data-unit]');
  if (unit) {
    state.unit = unit.dataset.unit;
    savePrefs();
    render();
    return;
  }
  const runs = e.target.closest('[data-runs]');
  if (runs) {
    state.simRuns = Number(runs.dataset.runs);
    render();
    return;
  }
  if (e.target.id === 'reset') {
    const boss = BOSSES.find((b) => b.id === state.selected);
    for (const k of Object.keys(state.overrides.chance)) if (k.startsWith(`${boss.id}/`)) delete state.overrides.chance[k];
    const keys = [boss.fragment, ...boss.groups.flatMap((g) => g.items)].map(priceKey);
    for (const k of keys) delete state.overrides.price[k];
    savePrefs();
    render();
  }
});

document.addEventListener('change', (e) => {
  const el = e.target;
  if (!(el instanceof HTMLInputElement)) return;
  const raw = el.value.trim();
  const v = raw === '' ? null : Number(raw);
  if (v != null && (!Number.isFinite(v) || v < 0)) return;
  if (el.dataset.chance) {
    if (v == null) delete state.overrides.chance[el.dataset.chance];
    else state.overrides.chance[el.dataset.chance] = v;
  } else if (el.dataset.price) {
    if (v == null) delete state.overrides.price[el.dataset.price];
    else state.overrides.price[el.dataset.price] = fromUnit(v);
  } else return;
  savePrefs();
  render();
});

// ---------- boot ----------
loadPrefs();
await loadPrices();
render();
