// Property test for src/lib/diff.ts: applying the ops must rebuild both inputs, and edits must be minimal-ish.
import { build } from 'esbuild';
import assert from 'node:assert/strict';
await build({ entryPoints: ['src/lib/diff.ts'], bundle: true, format: 'esm', platform: 'node', outfile: 'test/out/diff.mjs', logLevel: 'error' });
const { diff } = await import('../test/out/diff.mjs');
let seed = 7; const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
for (let i = 0; i < 2000; i++) {
  const a = Array.from({ length: rnd(40) }, () => 'w' + rnd(6));
  const b = a.slice();
  for (let e = rnd(6); e > 0; e--) { const p = rnd(b.length + 1); if (rnd(2)) b.splice(p, 0, 'n' + rnd(6)); else b.splice(p, 1); }
  const ops = diff(a, b);
  const A = ops.flatMap((o) => (o.t === 'ins' ? [] : o.v)), B = ops.flatMap((o) => (o.t === 'del' ? [] : o.v));
  assert.deepEqual(A, a); assert.deepEqual(B, b);
}
const ops = diff('the quick brown fox'.split(' '), 'the slow brown fox jumps'.split(' '));
assert.deepEqual(ops.map((o) => [o.t, o.v.join(' ')]), [['eq', 'the'], ['del', 'quick'], ['ins', 'slow'], ['eq', 'brown fox'], ['ins', 'jumps']]);
assert.equal(diff(Array.from({ length: 300 }, (_, i) => 'a' + i), Array.from({ length: 300 }, (_, i) => 'b' + i), 50), null);
console.log('✓ diff: 2000 random cases rebuild both sides; too-different input returns null');
