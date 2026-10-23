// poe.ninja builds data (internal, undocumented API — used at low volume for testing).
// Formats, as observed in Oct 2026:
//   GET /poe1/api/data/index-state                 JSON; snapshotVersions[] gives {url, type, version, timeMachineLabels}
//   GET /poe1/api/builds/<version>/search?overview=<url>&type=exp[&timemachine=<label>][&keypassives=<name>]
//       protobuf: field 1 = result { 1: total characters, 2: dimension[] { 1: id, 2: dictionary name,
//       3: entry[] { 1: index (absent = 0), 2: count } }, 6: dictionary ref[] { 1: name, 2: hash } , ... }
//   GET /poe1/api/builds/dictionary/<hash>        "NDIC" container: sorted names with a byte-length table
import { NINJA, UA } from './ninja.mjs';

// ---------- protobuf wire format (only what we need) ----------
function varint(b, p) {
  let r = 0, s = 0, x;
  do {
    if (p >= b.length) throw new Error('truncated varint');
    x = b[p++];
    r += (x & 127) * 2 ** s;
    s += 7;
  } while (x & 128);
  return [r, p];
}

export function fields(b) {
  const out = [];
  let p = 0;
  while (p < b.length) {
    let key;
    [key, p] = varint(b, p);
    const f = Math.floor(key / 8), t = key & 7;
    if (t === 0) {
      let v;
      [v, p] = varint(b, p);
      out.push({ f, v });
    } else if (t === 2) {
      let len;
      [len, p] = varint(b, p);
      if (p + len > b.length) throw new Error('truncated field');
      out.push({ f, b: b.subarray(p, p + len) });
      p += len;
    } else if (t === 5) p += 4;
    else if (t === 1) p += 8;
    else throw new Error(`unsupported wire type ${t}`);
  }
  return out;
}

const td = new TextDecoder();
const str = (fs, n) => {
  const x = fs.find((e) => e.f === n);
  return x?.b ? td.decode(x.b) : null;
};

/** Parses a search response into { total, dimensions: {id: {dict, counts: Map(index -> count)}}, dictionaries: {name: [hash]} }. */
export function parseSearch(buf) {
  const top = fields(buf).find((e) => e.f === 1);
  if (!top?.b) throw new Error('search: missing result message');
  const root = fields(top.b);
  const total = root.find((e) => e.f === 1)?.v ?? 0;
  const dimensions = {};
  const dictionaries = {};
  for (const e of root) {
    if (e.f === 2 && e.b) {
      const d = fields(e.b);
      const counts = new Map();
      for (const entry of d.filter((x) => x.f === 3 && x.b)) {
        const ef = fields(entry.b);
        counts.set(ef.find((x) => x.f === 1)?.v ?? 0, ef.find((x) => x.f === 2)?.v ?? 0);
      }
      dimensions[str(d, 1)] = { dict: str(d, 2), counts };
    } else if (e.f === 6 && e.b) {
      const d = fields(e.b);
      dictionaries[str(d, 1)] = d.filter((x) => x.f === 2 && x.b).map((x) => td.decode(x.b));
    }
  }
  return { total, dimensions, dictionaries };
}

/** Decodes an NDIC dictionary into an array of names (array index = dimension entry index). */
export function parseDictionary(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (td.decode(b.subarray(0, 4)) !== 'NDIC') throw new Error('dictionary: not an NDIC container');
  const n = dv.getUint32(12, true);
  const blocks = dv.getUint32(28, true);
  const lens = 36 + blocks * 8;
  const data = lens + n;
  const names = [];
  let p = data;
  for (let i = 0; i < n; i++) {
    const l = b[lens + i];
    names.push(td.decode(b.subarray(p, p + l)));
    p += l;
  }
  if (p !== b.length) throw new Error(`dictionary: size mismatch (${p} != ${b.length})`);
  return names;
}

// ---------- HTTP (paced, identified) ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function client({ fetchFn = fetch, delayMs = 2500 } = {}) {
  let last = 0;
  let requests = 0;
  async function get(path) {
    const wait = last + delayMs - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    requests++;
    const res = await fetchFn(`${NINJA}${path}`, { headers: { 'User-Agent': UA } });
    if (res.status === 429) throw new Error('poe.ninja returned 429 — stopping');
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
    return res;
  }
  return {
    get requests() {
      return requests;
    },
    async snapshot(leagueUrl) {
      const idx = await (await get('/data/index-state')).json();
      leagueUrl ||= idx.buildLeagues?.[0]?.url; // first entry is the current softcore league
      const s = (idx.snapshotVersions || []).find((v) => v.url === leagueUrl && v.type === 'exp');
      if (!s) throw new Error(`no builds snapshot for "${leagueUrl}"`);
      return s;
    },
    async search(snap, { timeMachine, keypassive } = {}) {
      const q = new URLSearchParams({ overview: snap.url, type: 'exp' });
      if (timeMachine && timeMachine !== 'current') q.set('timemachine', timeMachine);
      if (keypassive) q.set('keypassives', keypassive);
      return parseSearch(new Uint8Array(await (await get(`/builds/${snap.version}/search?${q}`)).arrayBuffer()));
    },
    async dictionary(hash) {
      return parseDictionary(new Uint8Array(await (await get(`/builds/dictionary/${hash}`)).arrayBuffer()));
    },
  };
}

// ---------- combo inference ----------
/**
 * Builds lookup tables from cluster-mods.json: notable name -> { size, affix, enchants: Map(tag -> weight) }.
 * A notable belongs to the sizes of the enchants it can spawn on.
 */
export function notableIndex(clusterData) {
  const enchantSize = new Map();
  for (const [size, s] of Object.entries(clusterData.sizes)) for (const e of s.enchants) enchantSize.set(e.tag, size);
  const byName = new Map();
  for (const m of clusterData.mods) {
    if (!m.notable) continue;
    for (const [tag, w] of Object.entries(m.weights)) {
      const size = enchantSize.get(tag);
      if (!size || !(w > 0)) continue;
      const k = `${size}|${m.notable}`;
      if (!byName.has(k)) byName.set(k, { name: m.notable, size, affix: m.affix, enchants: new Map() });
      byName.get(k).enchants.set(tag, w);
    }
  }
  return [...byName.values()];
}

/** Picks the enchant two notables can share (highest combined weight), or null if none. */
export function sharedEnchant(a, b) {
  let best = null;
  for (const [tag, wa] of a.enchants) {
    const wb = b.enchants.get(tag);
    if (wb > 0 && (!best || wa + wb > best.w)) best = { tag, w: wa + wb };
  }
  return best?.tag ?? null;
}

export const comboKey = (size, enchant, names) => `${size}|${enchant}|${[...names].sort().join('+')}`;
