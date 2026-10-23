// Expected value + Monte Carlo engine. Pure functions, no DOM — shared by the UI and the tests.
// All money values are in chaos orbs.

export const priceKey = (item) =>
  Array.isArray(item.ref) ? item.ref.join('|') : item.ref || `name:${item.name}`;

// prices: { [ref]: { c, n, icon } }   overrides: { price: {[priceKey]: chaos}, chance: {[`${bossId}/${key}`]: pct} }
export function buildModel(boss, prices, overrides = { price: {}, chance: {} }) {
  const lookup = (item) => {
    const k = priceKey(item);
    if (k in overrides.price) return { c: overrides.price[k], src: 'manual' };
    const refs = Array.isArray(item.ref) ? item.ref : item.ref ? [item.ref] : [];
    const found = refs.map((r) => prices[r]).filter(Boolean);
    if (!found.length) return { c: null, src: 'none' };
    const c = found.reduce((s, p) => s + p.c, 0) / found.length;
    const n = Math.min(...found.map((p) => p.n || 0));
    return { c, n, icon: found[0].icon, src: 'ninja' };
  };

  const fragPrice = lookup(boss.fragment);
  const cost = (fragPrice.c ?? 0) * boss.fragment.qty;

  const groups = boss.groups.map((g, gi) => {
    const rows = g.items.map((item, ii) => {
      const key = `${gi}:${ii}`;
      const ck = `${boss.id}/${key}`;
      const base = g.kind === 'pick' ? item.w : item.p;
      const pct = ck in overrides.chance ? overrides.chance[ck] : base;
      const price = lookup(item);
      return {
        key,
        item,
        pct, // percent (weight for pick groups)
        rateUnknown: pct == null,
        rateEdited: ck in overrides.chance,
        price,
      };
    });
    if (g.kind === 'pick') {
      const total = rows.reduce((s, r) => s + (r.pct || 0), 0) || 1;
      rows.forEach((r) => (r.prob = (r.pct || 0) / total));
    } else {
      rows.forEach((r) => (r.prob = Math.min(1, (r.pct || 0) / 100)));
    }
    rows.forEach((r) => {
      r.qty = r.item.qty || 1;
      r.value = (r.price.c ?? 0) * r.qty;
      r.ev = r.prob * r.value;
    });
    return { label: g.label, kind: g.kind, rows, ev: rows.reduce((s, r) => s + r.ev, 0) };
  });

  const ev = groups.reduce((s, g) => s + g.ev, 0);
  return {
    boss,
    fragPrice,
    cost,
    groups,
    ev,
    profit: ev - cost,
    roi: cost > 0 ? (ev - cost) / cost : null,
  };
}

// Mulberry32 — small, fast, seedable PRNG so results are stable between re-renders.
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Simulate `runs` kills, `iters` times. Returns stats on total profit (drops - cost) per session.
export function simulate(model, runs, iters = 10000, seed = 42) {
  const rand = rng(seed + runs);
  const picks = [];
  const each = [];
  for (const g of model.groups) {
    if (g.kind === 'pick') {
      let acc = 0;
      const cum = [];
      const vals = [];
      for (const r of g.rows) {
        acc += r.prob;
        cum.push(acc);
        vals.push(r.value);
      }
      picks.push({ cum, vals });
    } else {
      for (const r of g.rows) if (r.prob > 0 && r.value !== 0) each.push([r.prob, r.value]);
    }
  }

  const out = new Float64Array(iters);
  for (let i = 0; i < iters; i++) {
    let total = 0;
    for (let k = 0; k < runs; k++) {
      for (const p of picks) {
        const u = rand() * p.cum[p.cum.length - 1];
        let j = 0;
        while (j < p.cum.length - 1 && u > p.cum[j]) j++;
        total += p.vals[j];
      }
      for (let e = 0; e < each.length; e++) if (rand() < each[e][0]) total += each[e][1];
    }
    out[i] = total - model.cost * runs;
  }
  out.sort();
  const q = (f) => out[Math.min(iters - 1, Math.floor(f * iters))];
  let sum = 0;
  let wins = 0;
  for (const v of out) {
    sum += v;
    if (v > 0) wins++;
  }
  return {
    runs,
    iters,
    mean: sum / iters,
    expected: model.profit * runs,
    pProfit: wins / iters,
    p10: q(0.1),
    median: q(0.5),
    p90: q(0.9),
    min: out[0],
    max: out[iters - 1],
    hist: histogram(out, 32),
  };
}

// Histogram clipped to the 1st–99th percentile so one lucky chase drop doesn't flatten the chart.
function histogram(sorted, bins) {
  const n = sorted.length;
  let lo = sorted[Math.floor(n * 0.01)];
  let hi = sorted[Math.min(n - 1, Math.floor(n * 0.99))];
  if (hi === lo) {
    lo -= 1;
    hi += 1;
  }
  const width = (hi - lo) / bins;
  const counts = new Array(bins).fill(0);
  for (const v of sorted) {
    const b = Math.max(0, Math.min(bins - 1, Math.floor((v - lo) / width)));
    counts[b]++;
  }
  return { lo, hi, width, counts, total: n };
}
