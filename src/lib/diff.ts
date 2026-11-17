/** Myers diff (O((N+M)·D)) over token arrays. Returns null when the inputs are too different to diff cheaply. */
export type Op = { t: 'eq' | 'del' | 'ins'; v: string[] };

export function diff(a: string[], b: string[], maxD = 4000): Op[] | null {
  // trim common prefix/suffix first: most edits are local
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const A = a.slice(pre, a.length - suf), B = b.slice(pre, b.length - suf);
  const mid = core(A, B, maxD);
  if (!mid) return null;
  const ops: Op[] = [];
  const push = (t: Op['t'], v: string[]) => {
    if (!v.length) return;
    const last = ops[ops.length - 1];
    if (last && last.t === t) last.v.push(...v); else ops.push({ t, v: v.slice() });
  };
  push('eq', a.slice(0, pre));
  for (const o of mid) push(o.t, o.v);
  push('eq', a.slice(a.length - suf));
  return ops;
}

function core(a: string[], b: string[], maxD: number): Op[] | null {
  const n = a.length, m = b.length;
  if (!n) return m ? [{ t: 'ins', v: b }] : [];
  if (!m) return [{ t: 'del', v: a }];
  const max = Math.min(n + m, maxD);
  const off = max + 1;
  let v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice(off - d - 1, off + d + 2)); // only the window this step can read
    const nv = v.slice();
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      nv[off + k] = x;
      if (x >= n && y >= m) { found = d; break; }
    }
    v = nv;
    if (found >= 0) break;
  }
  if (found < 0) return null;

  // backtrack using the stored windows (trace[d] holds v before step d, indices k ∈ [-d-1, d+1])
  const rev: { t: Op['t']; v: string }[] = [];
  let x = n, y = m;
  for (let d = found; d > 0; d--) {
    const w = trace[d];
    const get = (k: number) => w[k + d + 1];
    const k = x - y;
    const down = k === -d || (k !== d && get(k - 1) < get(k + 1));
    const pk = down ? k + 1 : k - 1;
    const px = get(pk), py = px - pk;
    while (x > px && y > py) { rev.push({ t: 'eq', v: a[x - 1] }); x--; y--; }
    if (down) { rev.push({ t: 'ins', v: b[y - 1] }); y--; } else { rev.push({ t: 'del', v: a[x - 1] }); x--; }
  }
  while (x > 0 && y > 0) { rev.push({ t: 'eq', v: a[x - 1] }); x--; y--; }
  const ops: Op[] = [];
  for (let i = rev.length - 1; i >= 0; i--) {
    const r = rev[i], last = ops[ops.length - 1];
    if (last && last.t === r.t) last.v.push(r.v); else ops.push({ t: r.t, v: [r.v] });
  }
  return ops;
}

/** Whitespace-insensitive word tokens. */
export function words(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}
