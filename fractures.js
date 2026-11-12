// Fractured Base Search: one official trade search per armour slot for a fractured top-tier prefix plus a
// top-tier suffix that is (almost) alone on its side. Data: /data/fractures/fracture-mods.json (RePoE).
import { buildSlotSearches, tradeLink, lockCost, rollsOn } from './lib/fractures.js';

const STORE = 'pbpa:fractures:v1';
const DEF_LABEL = {
  str_armour: 'Armour', dex_armour: 'Evasion', int_armour: 'Energy Shield', str_dex_armour: 'Armour/Evasion',
  str_int_armour: 'Armour/ES', dex_int_armour: 'Evasion/ES', str_dex_int_armour: 'Armour/Evasion/ES',
};

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

const state = {
  target: 'ChanceToSuppressSpells', ttier: 1, ftier: 1, status: 'online', maxPrice: null, league: '',
  fractures: null, // Set of mod types, null = defaults
  slots: {}, // key -> { suffixes, base }
};
let DATA = null;

try {
  const s = JSON.parse(localStorage.getItem(STORE) || '{}');
  for (const k of ['target', 'ttier', 'ftier', 'status', 'maxPrice']) if (s[k] != null) state[k] = s[k];
  if (Array.isArray(s.fractures)) state.fractures = new Set(s.fractures);
  if (s.slots && typeof s.slots === 'object') state.slots = s.slots;
} catch {}
const save = () => {
  try {
    const { league, ...keep } = state; // the league comes from poe.ninja on every visit
    localStorage.setItem(STORE, JSON.stringify({ ...keep, fractures: state.fractures ? [...state.fractures] : null }));
  } catch {}
};
const slotState = (key) => (state.slots[key] ||= { suffixes: 1, base: '' });

function seg(id, value, onPick) {
  const box = $(id);
  for (const b of box.querySelectorAll('button')) {
    b.setAttribute('aria-pressed', String(b.dataset.v === String(value)));
    b.onclick = () => onPick(b.dataset.v);
  }
}

const target = () => DATA.targets.find((t) => t.type === state.target) || DATA.targets[0];
const selectedFractures = () => DATA.fractures.filter((f) => (state.fractures ? state.fractures.has(f.type) : f.on));
const tierText = (t) => (t === 1 ? 'T1' : 'T1–T2');
const statLine = (id, min) => (DATA.stats[id]?.text || id).replace(/#/, `${min}+`).replace(' (Local)', '');

// ---------- controls ----------
function renderControls() {
  const sel = $('target');
  sel.replaceChildren(...DATA.targets.map((t) => {
    const o = el('option', null, t.label);
    o.value = t.type;
    return o;
  }));
  sel.value = target().type;
  sel.onchange = () => { state.target = sel.value; save(); render(); };
  seg('ttier', state.ttier, (v) => { state.ttier = Number(v); save(); renderControls(); render(); });
  seg('ftier', state.ftier, (v) => { state.ftier = Number(v); save(); renderControls(); render(); });
  seg('status-opt', state.status, (v) => { state.status = v; save(); renderControls(); render(); });
  const mp = $('maxprice');
  mp.value = state.maxPrice ?? '';
  mp.oninput = () => { const v = Number(mp.value); state.maxPrice = mp.value === '' || !(v > 0) ? null : v; save(); render(); };
  const lg = $('league');
  lg.value = state.league;
  lg.oninput = () => { state.league = lg.value.trim(); save(); render(); };
}

function renderFractureChecks() {
  const groups = new Map();
  for (const f of DATA.fractures) {
    if (!groups.has(f.group)) groups.set(f.group, []);
    groups.get(f.group).push(f);
  }
  const chosen = new Set(selectedFractures().map((f) => f.type));
  const box = $('fr-groups');
  box.replaceChildren(...[...groups].map(([g, list]) => {
    const div = el('div');
    div.append(el('h4', null, g));
    for (const f of list) {
      const lab = el('label', 'check');
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = chosen.has(f.type);
      cb.onchange = () => {
        const s = new Set(selectedFractures().map((x) => x.type));
        if (cb.checked) s.add(f.type);
        else s.delete(f.type);
        state.fractures = s;
        save();
        render();
      };
      lab.append(cb, f.label);
      div.append(lab);
    }
    return div;
  }));
  $('fr-default').onclick = () => { state.fractures = null; save(); renderFractureChecks(); render(); };
  $('fr-all').onclick = () => { state.fractures = new Set(DATA.fractures.map((f) => f.type)); save(); renderFractureChecks(); render(); };
  $('fr-none').onclick = () => { state.fractures = new Set(); save(); renderFractureChecks(); render(); };
}

// ---------- slots ----------
function copyButton(body) {
  const b = el('button', 'btn', 'Copy JSON');
  b.type = 'button';
  b.onclick = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(body));
      b.textContent = 'Copied';
    } catch {
      b.textContent = 'Copy failed';
    }
    setTimeout(() => (b.textContent = 'Copy JSON'), 1500);
  };
  return b;
}

function slotCard(slot) {
  const ss = slotState(slot.key);
  const t = target();
  const card = el('section', 'panel slot');
  const h = el('h3', null, slot.label);
  card.append(h);

  // Controls: suffix count and base.
  const row = el('div', 'row');
  const sfx = el('div', 'field', 'Suffixes on the item');
  const sg = el('div', 'seg');
  sg.setAttribute('role', 'group');
  for (const [v, label] of [[1, 'Only 1'], [2, 'Up to 2'], [3, 'Up to 3']]) {
    const b = el('button', null, label);
    b.setAttribute('aria-pressed', String(ss.suffixes === v));
    b.onclick = () => { ss.suffixes = v; save(); render(); };
    sg.append(b);
  }
  sfx.append(sg);
  const baseField = el('label', 'field', 'Base');
  const bs = el('select', 'sel');
  const defsForTarget = rollsOn(t, slot.key, slot.defs);
  const anyOpt = el('option', null, 'Any base');
  anyOpt.value = '';
  bs.append(anyOpt);
  for (const def of defsForTarget) {
    const og = el('optgroup');
    og.label = DEF_LABEL[def] || def;
    for (const b of slot.bases.filter((x) => x.def === def)) {
      const o = el('option', null, `${b.name} (lvl ${b.level})`);
      o.value = b.name;
      og.append(o);
    }
    if (og.children.length) bs.append(og);
  }
  if (ss.base && !slot.bases.some((b) => b.name === ss.base && defsForTarget.includes(b.def))) ss.base = '';
  bs.value = ss.base;
  bs.onchange = () => { ss.base = bs.value; save(); render(); };
  baseField.append(bs);
  row.append(sfx, baseField);
  card.append(row);

  const res = buildSlotSearches(DATA, slot.key, {
    target: t, targetTier: state.ttier, fractures: selectedFractures(), fractureTier: state.ftier,
    maxSuffixes: ss.suffixes, base: ss.base || null, status: state.status, maxPrice: state.maxPrice,
  });
  if (res.error && !res.target) {
    card.append(el('p', 'err', res.error));
    return card;
  }

  const tl = el('p', 'line');
  tl.append('Keep: ', el('b', null, `${tierText(state.ttier)} ${t.label}`), ` — ${res.target.stats.map((s) => statLine(s.id, s.min)).join(', ')}`);
  card.append(tl);
  const on = el('p', 'line', `Rolls on ${res.target.on.map((d) => DEF_LABEL[d]).join(', ')} bases.`);
  card.append(on);

  if (res.error) {
    card.append(el('p', 'err', res.error));
    return card;
  }

  const fl = el('p', 'line');
  fl.append('Fractured: ', el('b', null, `${tierText(state.ftier)}, at least one of`));
  card.append(fl);
  const ul = el('ul');
  for (const s of res.searches) for (const p of s.fractures) {
    const tag = el('li', `tag${p.ambiguous ? ' warn' : ''}`, `${p.mod.label}: ${p.stats.map((x) => statLine(x.id, x.min)).join(' & ')}${p.own ? ' (own search)' : ''}`);
    if (p.ambiguous) tag.title = 'Another mod in this slot can roll this value too, so the search may include lower tiers of it.';
    ul.append(tag);
  }
  for (const m of res.skipped) {
    const tag = el('li', 'tag off', m.label);
    tag.title = `Cannot roll on the same bases as ${t.label}`;
    ul.append(tag);
  }
  card.append(ul);

  const league = state.league || 'Standard';
  const box = el('div', 'searches');
  for (const s of res.searches) {
    const r = el('div', 'search-row');
    const a = el('a', 'btn', res.searches.length > 1 ? `Open on trade: ${s.label}` : 'Open on trade');
    a.href = tradeLink(league, s.query);
    a.target = '_blank';
    a.rel = 'noopener';
    r.append(a, copyButton(s.query));
    box.append(r);
  }
  card.append(box);
  card.append(el('p', 'fine', `Lock cost: ${lockCost(ss.suffixes)}.`));
  return card;
}

function render() {
  if (!DATA) return;
  $('slots').replaceChildren(...DATA.slots.map(slotCard));
  const n = selectedFractures().length;
  $('takeaway').replaceChildren(
    'Searching for ', el('b', null, `${tierText(state.ttier)} ${target().label}`), ' with ',
    el('b', null, `${n} fractured mod${n === 1 ? '' : 's'}`), ` (${tierText(state.ftier)}) on ${state.league || 'Standard'}.`,
  );
  $('league-pill').replaceChildren('League ', el('b', null, state.league || 'Standard'));
}

async function main() {
  try {
    const [data, prices] = await Promise.all([
      fetch('/data/fractures/fracture-mods.json').then((r) => r.json()),
      fetch('/api/prices').then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    DATA = data;
    if (prices?.league) state.league = prices.league;
    $('data-note').textContent = `Mod tiers from RePoE, game version ${DATA.patch}.`;
    renderControls();
    renderFractureChecks();
    render();
  } catch (e) {
    $('status').textContent = `Could not load mod data: ${e.message}`;
    $('league-pill').textContent = 'Data unavailable';
  }
}
main();
