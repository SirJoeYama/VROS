import * as THREE from 'three';

const GRAB_RADIUS = 0.035; // how close a pinch must be to the bar or grip (m)
const BAR_W = 0.12, BAR_H = 0.012, GAP = 0.02;
const IDLE = 0.35, HOT = 0.95;

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _eye = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();

// Moving, turning and resizing a floating panel by hand, with two handles:
// - the bar under the panel: pinch it and move to carry the panel; it keeps
//   the angle it has;
// - the grip at the top-right corner: pinch it and pull away from the
//   panel's middle to make it bigger, push in to make it smaller;
// - both at once, one hand on each: hold it like a board. Moving your hands
//   moves it, turning or tilting the line between them turns it, any way;
//   the size stays.
// `target` is what moves (the panel or a group holding it); `panel` is the
// mesh whose plane, `width` × `height` (meters, unscaled), the bar and grip
// sit under. update() returns the ids of the hands it's using, so the app
// can leave them out of its own gestures. With `detach`, the first grab moves
// the target out of whatever carries it around (e.g. a desk that follows the
// stage) into `detach` (usually the scene), where it stays put.
export class PanelGrab {
  constructor(target, panel, width, height, { min = 0.5, max = 3, detach = null } = {}) {
    this.target = target;
    this.detach = detach;
    this.panel = panel;
    this.min = min;
    this.max = max;
    this.moved = false; // set once the user has placed the panel themselves
    const mat = () => new THREE.MeshBasicMaterial({ color: 0xdfe6ff, transparent: true, opacity: IDLE, depthWrite: false });
    this.bar = new THREE.Mesh(new THREE.CapsuleGeometry(BAR_H / 2, BAR_W - BAR_H, 4, 12).rotateZ(Math.PI / 2), mat());
    this.bar.position.set(0, -height / 2 - GAP, 0.002);
    // at the top-right corner, well apart from the bar (bottom middle), so
    // holding both gives a long line to turn the panel with
    this.grip = new THREE.Mesh(gripGeometry(0.03), mat());
    this.grip.position.set(width / 2 + GAP * 0.6, height / 2 + GAP * 0.6, 0.002);
    for (const m of [this.bar, this.grip]) {
      m.renderOrder = 16;
      panel.add(m);
    }
    this.hot = { bar: 0, grip: 0 };
    this.visible = false;
    this.grabs = { bar: null, grip: null }; // { hand, ready, ... } for the hand holding each handle
    this.two = null; // both handles held: the board grab's starting state
    this.was = new Map(); // hand id → pinching last frame
  }

  update(hands, dt, viewer) {
    const used = new Set();
    const gripAt = this.grip.getWorldPosition(new THREE.Vector3());
    // Reach in real terms: your size in the world, times how much bigger
    // than normal the panel has been made.
    const you = viewer.getWorldScale(_a).x;
    const scale = this.target.getWorldScale(_a).x;
    const reach = GRAB_RADIUS * you * Math.max(1, (scale / you) * 0.7);
    const near = { bar: false, grip: false };
    const byId = new Map(hands.filter((h) => h.kind !== 'mouse').map((h) => [h.id, h]));

    // Pick up a handle that's free.
    for (const h of byId.values()) {
      const start = h.pinch && !this.was.get(h.id);
      this.was.set(h.id, h.pinch);
      const dBar = segmentDistance(h.pinchPoint, this.bar, BAR_W * scale), dGrip = h.pinchPoint.distanceTo(gripAt);
      if (dBar < reach * 1.5) near.bar = true;
      if (dGrip < reach * 1.5) near.grip = true;
      if (!start || this._holding(h.id)) continue;
      const bar = !this.grabs.bar && dBar < reach, grip = !this.grabs.grip && dGrip < reach;
      const kind = grip && (!bar || dGrip <= dBar) ? 'grip' : bar ? 'bar' : null;
      if (!kind) continue;
      if (this.detach && this.target.parent !== this.detach) this.detach.attach(this.target);
      this.grabs[kind] = { hand: h.id, ready: false };
    }

    // Let go of handles whose hand stopped pinching (or went away).
    for (const kind of ['bar', 'grip']) {
      const g = this.grabs[kind];
      if (!g) continue;
      const h = byId.get(g.hand);
      if (!h || !h.pinch) this.grabs[kind] = null;
      else used.add(h.id);
    }

    const bar = this.grabs.bar && byId.get(this.grabs.bar.hand);
    const grip = this.grabs.grip && byId.get(this.grabs.grip.hand);
    if (bar && grip) {
      this._board(bar.pinchPoint, grip.pinchPoint);
      this.moved = true;
    } else {
      if (this.two) {
        // back to one hand: it starts afresh from where the panel is now
        this.two = null;
        for (const g of Object.values(this.grabs)) if (g) g.ready = false;
      }
      if (bar) this._carry(this.grabs.bar, bar.pinchPoint);
      if (grip) this._resize(this.grabs.grip, grip.pinchPoint);
      if (bar || grip) this.moved = true;
    }

    for (const kind of ['bar', 'grip']) {
      const target = this.grabs[kind] ? 1 : near[kind] ? 0.6 : 0;
      this.hot[kind] += (target - this.hot[kind]) * Math.min(1, dt * 14);
      this[kind].material.opacity = IDLE + (HOT - IDLE) * this.hot[kind];
      this[kind].scale.setScalar(1 + this.hot[kind] * 0.25);
    }
    return used;
  }

  _holding(id) {
    return this.grabs.bar?.hand === id || this.grabs.grip?.hand === id;
  }

  // One hand on the bar: the panel follows it, keeping its angle.
  _carry(g, p) {
    if (!g.ready) {
      g.offset = this.target.getWorldPosition(new THREE.Vector3()).sub(p);
      g.ready = true;
    }
    this._setWorldPosition(_b.copy(p).add(g.offset));
  }

  // One hand on the corner: resize about the panel's middle, which stays put.
  _resize(g, p) {
    if (!g.ready) {
      g.center = this.panel.getWorldPosition(new THREE.Vector3());
      g.scale = this.target.scale.x;
      g.dist = Math.max(0.02, p.distanceTo(g.center));
      g.ready = true;
    }
    const k = THREE.MathUtils.clamp((g.scale * p.distanceTo(g.center)) / g.dist, this.min, this.max);
    this.target.scale.setScalar(k);
    this.target.updateMatrixWorld(true);
    const now = this.panel.getWorldPosition(new THREE.Vector3());
    this._setWorldPosition(this.target.getWorldPosition(_b).add(g.center).sub(now));
  }

  // Both handles: the panel turns as your two hands turn, and moves with the
  // point between them. The turn is that of the frame the hands make (the
  // line from the bar hand to the corner hand, and the vertical), so turning
  // your hands 30° turns the panel 30° even though the line between them
  // slants (the corner is up and right of the bar), and tilting it tilts it.
  _board(a, b) {
    if (!this.two) {
      const f = handFrame(a, b);
      if (!f) return;
      this.two = {
        frame: f,
        mid: a.clone().add(b).multiplyScalar(0.5),
        q: this.target.getWorldQuaternion(new THREE.Quaternion()),
        p: this.target.getWorldPosition(new THREE.Vector3()),
      };
    }
    const t = this.two;
    const f = handFrame(a, b);
    if (!f) return;
    _q.copy(f).multiply(_q2.copy(t.frame).invert()); // how the hands' frame has turned
    const world = new THREE.Quaternion().copy(_q).multiply(t.q);
    const mid = _b.copy(a).add(b).multiplyScalar(0.5);
    this._setWorldPosition(t.p.clone().sub(t.mid).applyQuaternion(_q).add(mid));
    const parent = this.target.parent;
    if (parent) world.premultiply(parent.getWorldQuaternion(new THREE.Quaternion()).invert());
    this.target.quaternion.copy(world);
    this.target.updateMatrixWorld(true);
  }

  // The bar and grip are for hands; apps hide them outside XR.
  set visible(v) {
    this.bar.visible = this.grip.visible = v;
  }

  get dragging() {
    return !!(this.grabs.bar || this.grabs.grip);
  }

  _setWorldPosition(p) {
    const parent = this.target.parent;
    if (parent) parent.worldToLocal(p);
    this.target.position.copy(p);
    this.target.updateMatrixWorld(true);
  }
}

// The orientation two hands make: x along the line from `a` to `b`, y the
// vertical as far as it's square to that line, z across. Null if the hands
// are on top of each other or one straight above the other.
const _fx = new THREE.Vector3(), _fy = new THREE.Vector3(), _fz = new THREE.Vector3(), _fm = new THREE.Matrix4();
function handFrame(a, b) {
  _fx.copy(b).sub(a);
  if (_fx.lengthSq() < 1e-8) return null;
  _fx.normalize();
  _fy.set(0, 1, 0).addScaledVector(_fx, -_fx.y);
  if (_fy.lengthSq() < 1e-6) return null;
  _fy.normalize();
  _fz.crossVectors(_fx, _fy);
  return new THREE.Quaternion().setFromRotationMatrix(_fm.makeBasis(_fx, _fy, _fz));
}

// Distance from a point to the bar's centre line.
function segmentDistance(p, bar, length) {
  const c = bar.getWorldPosition(_a);
  const dir = _b.set(1, 0, 0).applyQuaternion(bar.getWorldQuaternion(new THREE.Quaternion()));
  const t = THREE.MathUtils.clamp(_eye.copy(p).sub(c).dot(dir), -length / 2, length / 2);
  return p.distanceTo(c.addScaledVector(dir, t));
}

// An L-shaped corner grip, like a window's resize corner, for the top-right
// corner: drawn for the bottom right, then turned a quarter left.
function gripGeometry(size) {
  const t = size * 0.28, s = new THREE.Shape();
  s.moveTo(-size / 2, -size / 2);
  s.lineTo(size / 2, -size / 2);
  s.lineTo(size / 2, size / 2);
  s.lineTo(size / 2 - t, size / 2);
  s.lineTo(size / 2 - t, -size / 2 + t);
  s.lineTo(-size / 2, -size / 2 + t);
  s.closePath();
  return new THREE.ShapeGeometry(s).rotateZ(Math.PI / 2);
}
