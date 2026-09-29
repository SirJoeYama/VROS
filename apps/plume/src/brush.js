import * as THREE from 'three';

// Stroke geometry. A stroke is points in the canvas's space, each with a
// "side" direction (which way a flat ribbon lies) and a width, plus one
// colour and a brush:
// - ribbon: a flat band, turned the way your hand is turned (calligraphy);
// - tube: round;
// - glow: a round, see-through, additive tube that lights up what's behind.
// Both ends taper. Geometry is built per stroke and cached; a frame's strokes
// are merged into one mesh per material so drawings stay cheap to render.

export const BRUSHES = ['ribbon', 'tube', 'glow'];
const SIDES = 6; // tube cross-section
const TAPER = 4; // points of taper at each end

const _t = new THREE.Vector3(), _s = new THREE.Vector3(), _b = new THREE.Vector3(), _p = new THREE.Vector3();

export function newStroke(brush, color) {
  return { brush, color: [...color], n: 0, pts: new Float32Array(3 * 64), side: new Float32Array(3 * 64), w: new Float32Array(64), done: false };
}

export function addPoint(s, p, side, w) {
  if (s.n * 3 >= s.pts.length) {
    const grow = (a, k) => { const b = new Float32Array(a.length * 2); b.set(a); return b; };
    s.pts = grow(s.pts); s.side = grow(s.side); s.w = grow(s.w);
  }
  p.toArray(s.pts, s.n * 3);
  side.toArray(s.side, s.n * 3);
  s.w[s.n] = w;
  s.n++;
}

// Trim the buffers to size once the stroke is finished.
export function finish(s) {
  s.pts = s.pts.slice(0, s.n * 3);
  s.side = s.side.slice(0, s.n * 3);
  s.w = s.w.slice(0, s.n);
  s.done = true;
  return s;
}

const cache = new WeakMap(); // finished stroke → { pos, col, idx }

// { pos: Float32Array, col: Float32Array, idx: Uint32Array }
export function strokeArrays(s) {
  if (s.done && cache.has(s)) return cache.get(s);
  const out = s.brush === 'ribbon' ? ribbon(s) : tube(s);
  if (s.done) cache.set(s, out);
  return out;
}

function taper(s, i) {
  const a = Math.min(1, (i + 1) / TAPER);
  const b = s.done ? Math.min(1, (s.n - i) / TAPER) : 1;
  return s.w[i] * Math.min(a, b) * (0.35 + 0.65 * Math.min(a, b));
}

function tangent(s, i, out) {
  const a = Math.max(0, i - 1), b = Math.min(s.n - 1, i + 1);
  out.set(s.pts[b * 3] - s.pts[a * 3], s.pts[b * 3 + 1] - s.pts[a * 3 + 1], s.pts[b * 3 + 2] - s.pts[a * 3 + 2]);
  if (out.lengthSq() < 1e-14) out.set(0, 0, 1);
  return out.normalize();
}

// The side direction made perpendicular to the stroke, so bands don't twist
// into a line when the hand turns along the stroke.
function sideAt(s, i, t, out) {
  out.fromArray(s.side, i * 3);
  out.addScaledVector(t, -out.dot(t));
  if (out.lengthSq() < 1e-8) out.set(0, 1, 0).addScaledVector(t, -t.y);
  if (out.lengthSq() < 1e-8) out.set(1, 0, 0);
  return out.normalize();
}

// A single dot: make it a tiny stroke so it still shows.
function points(s) {
  if (s.n > 1) return s;
  const d = { ...s, n: 2, pts: new Float32Array(6), side: new Float32Array(6), w: new Float32Array(2), done: true };
  d.pts.set(s.pts.subarray(0, 3));
  d.pts.set(s.pts.subarray(0, 3), 3);
  d.pts[3] += s.w[0] * 0.5;
  d.side.set(s.side.subarray(0, 3));
  d.side.set(s.side.subarray(0, 3), 3);
  d.w[0] = d.w[1] = s.w[0] * 2;
  return d;
}

function ribbon(src) {
  const s = points(src), n = s.n;
  const pos = new Float32Array(n * 2 * 3), col = new Float32Array(n * 2 * 3), idx = new Uint32Array((n - 1) * 6);
  for (let i = 0; i < n; i++) {
    tangent(s, i, _t);
    sideAt(s, i, _t, _s);
    const hw = taper(s, i) / 2;
    _p.fromArray(s.pts, i * 3);
    _b.copy(_p).addScaledVector(_s, hw).toArray(pos, i * 6);
    _b.copy(_p).addScaledVector(_s, -hw).toArray(pos, i * 6 + 3);
  }
  fill(col, s.color);
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2, b = a + 2;
    idx.set([a, a + 1, b, a + 1, b + 1, b], i * 6);
  }
  return { pos, col, idx };
}

function tube(src) {
  const s = points(src), n = s.n;
  const pos = new Float32Array(n * SIDES * 3), col = new Float32Array(n * SIDES * 3), idx = new Uint32Array((n - 1) * SIDES * 6);
  for (let i = 0; i < n; i++) {
    tangent(s, i, _t);
    sideAt(s, i, _t, _s);
    _b.crossVectors(_t, _s);
    const r = taper(s, i) / 2;
    _p.fromArray(s.pts, i * 3);
    for (let k = 0; k < SIDES; k++) {
      const a = (k / SIDES) * Math.PI * 2, c = Math.cos(a) * r, d = Math.sin(a) * r;
      const o = (i * SIDES + k) * 3;
      pos[o] = _p.x + _s.x * c + _b.x * d;
      pos[o + 1] = _p.y + _s.y * c + _b.y * d;
      pos[o + 2] = _p.z + _s.z * c + _b.z * d;
    }
  }
  fill(col, s.color);
  let q = 0;
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < SIDES; k++) {
      const a = i * SIDES + k, b = i * SIDES + ((k + 1) % SIDES);
      idx[q++] = a; idx[q++] = a + SIDES; idx[q++] = b;
      idx[q++] = b; idx[q++] = a + SIDES; idx[q++] = b + SIDES;
    }
  }
  return { pos, col, idx };
}

function fill(col, c) {
  for (let i = 0; i < col.length; i += 3) { col[i] = c[0]; col[i + 1] = c[1]; col[i + 2] = c[2]; }
}

// Materials shared by every stroke: unlit, coloured per vertex.
export const MATERIALS = {
  solid: new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }),
  glow: new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
};
export const materialOf = (brush) => (brush === 'glow' ? 'glow' : 'solid');

export function geometryFrom(list) {
  let nv = 0, ni = 0;
  for (const a of list) { nv += a.pos.length / 3; ni += a.idx.length; }
  const pos = new Float32Array(nv * 3), col = new Float32Array(nv * 3), idx = new Uint32Array(ni);
  let v = 0, i = 0;
  for (const a of list) {
    pos.set(a.pos, v * 3);
    col.set(a.col, v * 3);
    for (let k = 0; k < a.idx.length; k++) idx[i + k] = a.idx[k] + v;
    v += a.pos.length / 3;
    i += a.idx.length;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

// One mesh per material for a list of strokes.
export function meshesFor(strokes) {
  const groups = { solid: [], glow: [] };
  for (const s of strokes) groups[materialOf(s.brush)].push(strokeArrays(s));
  const out = [];
  for (const k of ['solid', 'glow']) {
    if (!groups[k].length) continue;
    const m = new THREE.Mesh(geometryFrom(groups[k]), MATERIALS[k]);
    m.renderOrder = k === 'glow' ? 2 : 0;
    m.userData.kind = k;
    out.push(m);
  }
  return out;
}

// Does the stroke come within `r` of point `p` (canvas space)?
export function strokeNear(s, p, r) {
  const r2 = (r + maxWidth(s) / 2) ** 2;
  for (let i = 0; i < s.n; i++) {
    const dx = s.pts[i * 3] - p.x, dy = s.pts[i * 3 + 1] - p.y, dz = s.pts[i * 3 + 2] - p.z;
    if (dx * dx + dy * dy + dz * dz < r2) return true;
  }
  return false;
}

function maxWidth(s) {
  let m = 0;
  for (let i = 0; i < s.n; i++) m = Math.max(m, s.w[i]);
  return m;
}
