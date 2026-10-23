// Builds the League Investments dataset straight from poe.ninja's data dumps.
// Each dump is a large zip; only "<League>.currency.csv" is needed, so we read the zip's
// central directory and that one entry with HTTP range requests (~0.3 MB per league instead of ~50 MB).

import { inflateRawSync } from 'node:zlib';

const BASE = 'https://poe.ninja/poe1/api/data/dumps';
const UA = { 'User-Agent': 'poe-boss-profit-analyzer (fan-made ROI calculator)' };
export const CHECKPOINTS = [0, 1, 2, 3, 5, 7, 10, 14, 21, 30, 45, 60, 75, 90, 105, 120];
const MAX_DAY = 120;
const MIN_DAYS_WITH_DATA = 30;
const FRAG_RE =
  /Fragment|Splinter|Emblem|Reliquary Key|Crest|Sacrifice at|Mortal |Goddess|Simulacrum|Maven's Writ|Audience With The King|Valdo's Puzzle|Breachstone|Scarab|Echo of|Memory of|Ritual Vessel|Divine Vessel|Flesh of Xesht|Black Barya|Syndicate Medallion|Offering|Tribute|Dedication|Gift to/;

/** Main softcore challenge leagues, oldest first (no Hardcore, Ruthless, or short events). */
export async function listLeagues(count = 7, fetchFn = fetch) {
  const res = await fetchFn(BASE, { headers: UA });
  if (!res.ok) throw new Error(`dump list: HTTP ${res.status}`);
  const all = await res.json();
  const days = (l) => (new Date(l.maxDate) - new Date(l.minDate)) / 864e5;
  return all
    .filter((l) => !/Hardcore|\bHC\b|Ruthless|SSF|Standard|Phrecia/i.test(l.leagueName) && days(l) >= 70)
    .sort((a, b) => new Date(a.minDate) - new Date(b.minDate))
    .slice(-count)
    .map((l) => l.leagueName);
}

async function range(url, start, end, fetchFn) {
  const res = await fetchFn(url, { headers: { ...UA, Range: `bytes=${start}-${end}` } });
  if (res.status !== 206) throw new Error(`range request not honoured (HTTP ${res.status})`);
  const total = Number((res.headers.get('content-range') || '').split('/')[1]);
  return { buf: Buffer.from(await res.arrayBuffer()), total };
}

/** Reads one file out of a remote zip without downloading the whole archive. */
async function readZipEntry(url, entryName, fetchFn) {
  const probe = await range(url, 0, 0, fetchFn);
  const size = probe.total;
  const tailLen = Math.min(size, 66000);
  const { buf: tail } = await range(url, size - tailLen, size - 1, fetchFn);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('zip end record not found');
  const cdSize = tail.readUInt32LE(eocd + 12);
  const cdOffset = tail.readUInt32LE(eocd + 16);
  let cd;
  const tailStart = size - tailLen;
  if (cdOffset >= tailStart) cd = tail.subarray(cdOffset - tailStart, cdOffset - tailStart + cdSize);
  else cd = (await range(url, cdOffset, cdOffset + cdSize - 1, fetchFn)).buf;

  for (let p = 0; p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50; ) {
    const method = cd.readUInt16LE(p + 10);
    const compSize = cd.readUInt32LE(p + 20);
    const nameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const commentLen = cd.readUInt16LE(p + 32);
    const localOffset = cd.readUInt32LE(p + 42);
    const name = cd.toString('utf8', p + 46, p + 46 + nameLen);
    if (name === entryName) {
      const { buf } = await range(url, localOffset, localOffset + 30 + 1024 + compSize, fetchFn);
      if (buf.readUInt32LE(0) !== 0x04034b50) throw new Error('bad local header');
      const start = 30 + buf.readUInt16LE(26) + buf.readUInt16LE(28);
      const data = buf.subarray(start, start + compSize);
      if (method === 0) return data.toString('utf8');
      if (method === 8) return inflateRawSync(data).toString('utf8');
      throw new Error(`unsupported zip method ${method}`);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`${entryName} not in archive`);
}

const median = (a) => {
  const b = [...a].sort((x, y) => x - y);
  const m = b.length >> 1;
  return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
};
const r3 = (v) => (v == null ? null : Number(v.toPrecision(3)));

/** Daily chaos price per item for one league, smoothed with a centred 3-day median. */
function parseLeague(csv) {
  const lines = csv.split(/\r?\n/);
  const head = lines[0].split(';');
  const col = Object.fromEntries(head.map((h, i) => [h.trim(), i]));
  const rows = [];
  let minDate = null;
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const f = lines[i].split(';');
    if (f[col.Pay] !== 'Chaos Orb') continue;
    const get = f[col.Get];
    if (f[col.Confidence] === 'Low' && get !== 'Divine Orb') continue;
    const date = f[col.Date];
    if (!minDate || date < minDate) minDate = date;
    rows.push([get, date, Number(f[col.Value])]);
  }
  // minDate must come from every Chaos-priced row (as the analysis did), including Low ones
  for (let i = 1; i < lines.length; i++) {
    const f = lines[i].split(';');
    if (f[col.Pay] === 'Chaos Orb' && f[col.Date] && f[col.Date] < minDate) minDate = f[col.Date];
  }
  const t0 = Date.parse(minDate);
  const acc = new Map(); // item -> Array(day) of [sum, n]
  for (const [get, date, v] of rows) {
    const d = Math.round((Date.parse(date) - t0) / 864e5);
    if (d < 0 || d > MAX_DAY || !(v > 0)) continue;
    let a = acc.get(get);
    if (!a) acc.set(get, (a = Array.from({ length: MAX_DAY + 1 }, () => [0, 0])));
    a[d][0] += v;
    a[d][1] += 1;
  }
  const out = new Map();
  for (const [item, a] of acc) {
    const raw = a.map(([s, n]) => (n ? s / n : null));
    const sm = raw.map((_, d) => {
      const w = [raw[d - 1], raw[d], raw[d + 1]].filter((x) => x != null);
      return w.length ? median(w) : null;
    });
    out.set(item, sm);
  }
  return out;
}

export async function buildHistory({ count = 7, fetchFn = fetch } = {}) {
  const leagues = await listLeagues(count, fetchFn);
  const perLeague = await Promise.all(
    leagues.map(async (lg) => {
      const csv = await readZipEntry(`${BASE}/dump?name=${encodeURIComponent(lg)}`, `${lg}.currency.csv`, fetchFn);
      return [lg, parseLeague(csv)];
    })
  );
  const divine = {};
  const byItem = new Map();
  for (const [lg, items] of perLeague) {
    const div = items.get('Divine Orb') || [];
    divine[lg] = CHECKPOINTS.map((d) => r3(div[d]));
    for (const [item, s] of items) {
      if (item === 'Chaos Orb') continue;
      if (s.filter((x) => x != null).length < MIN_DAYS_WITH_DATA) continue;
      if (!byItem.has(item)) byItem.set(item, {});
      byItem.get(item)[lg] = CHECKPOINTS.map((d) => r3(s[d]));
    }
  }
  const items = [...byItem]
    .filter(([, ls]) => Object.keys(ls).length >= 2)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, ls]) => [name, FRAG_RE.test(name) ? 1 : 0, ls]);
  return { days: CHECKPOINTS, leagues, divine, items, builtAt: new Date().toISOString(), source: 'poe.ninja data dumps' };
}
