import * as THREE from 'three';

const GRAB_RADIUS = 0.035; // how close a pinch must be to the bar or grip (m)
const BAR_W = 0.12, BAR_H = 0.012, GAP = 0.02;
const IDLE = 0.35, HOT = 0.95;

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _eye = new THREE.Vector3();

// Moving and resizing a floating panel by hand. A bar under the panel:
// pinch it and move to carry the panel (it keeps facing you). A grip at the
// bottom-right corner: pinch it and pull away from the panel's middle to
// make it bigger, push in to make it smaller.
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
    this.grip = new THREE.Mesh(gripGeometry(0.03), mat());
    this.grip.position.set(width / 2 + GAP * 0.6, -height / 2 - GAP * 0.6, 0.002);
    for (const m of [this.bar, this.grip]) {
      m.renderOrder = 16;
      panel.add(m);
    }
    this.hot = { bar: 0, grip: 0 };
    this.visible = false;
    this.drag = null; // { hand, kind, ... }
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

    for (const h of hands) {
      if (h.kind === 'mouse') continue;
      const start = h.pinch && !this.was.get(h.id);
      this.was.set(h.id, h.pinch);
      const dBar = segmentDistance(h.pinchPoint, this.bar, BAR_W * scale), dGrip = h.pinchPoint.distanceTo(gripAt);
      if (dBar < reach * 1.5) near.bar = true;
      if (dGrip < reach * 1.5) near.grip = true;

      if (start && !this.drag) {
        const kind = dGrip < reach && dGrip <= dBar ? 'grip' : dBar < reach ? 'bar' : null;
        if (kind) {
          if (this.detach && this.target.parent !== this.detach) this.detach.attach(this.target);
          const center = this.panel.getWorldPosition(new THREE.Vector3());
          this.drag = {
            hand: h.id, kind,
            offset: this.target.getWorldPosition(new THREE.Vector3()).sub(h.pinchPoint),
            scale: this.target.scale.x,
            dist: Math.max(0.02, h.pinchPoint.distanceTo(center)),
            center,
          };
        }
      }
      if (this.drag?.hand !== h.id) continue;
      used.add(h.id);
      if (!h.pinch) {
        this.drag = null;
        continue;
      }
      const d = this.drag;
      if (d.kind === 'bar') {
        this._setWorldPosition(_b.copy(h.pinchPoint).add(d.offset));
        this.target.lookAt(viewer.getWorldPosition(_eye));
      } else {
        // Scale about the panel's middle, which stays where it is.
        const k = THREE.MathUtils.clamp((d.scale * h.pinchPoint.distanceTo(d.center)) / d.dist, this.min, this.max);
        this.target.scale.setScalar(k);
        this.target.updateMatrixWorld(true);
        const now = this.panel.getWorldPosition(new THREE.Vector3());
        this._setWorldPosition(this.target.getWorldPosition(_b).add(d.center).sub(now));
      }
      this.moved = true;
    }
    if (this.drag && !hands.some((h) => h.id === this.drag.hand)) this.drag = null;

    for (const kind of ['bar', 'grip']) {
      const target = this.drag?.kind === kind ? 1 : near[kind] ? 0.6 : 0;
      this.hot[kind] += (target - this.hot[kind]) * Math.min(1, dt * 14);
      this[kind].material.opacity = IDLE + (HOT - IDLE) * this.hot[kind];
      this[kind].scale.setScalar(1 + this.hot[kind] * 0.25);
    }
    return used;
  }

  // The bar and grip are for hands; apps hide them outside XR.
  set visible(v) {
    this.bar.visible = this.grip.visible = v;
  }

  get dragging() {
    return !!this.drag;
  }

  _setWorldPosition(p) {
    const parent = this.target.parent;
    if (parent) parent.worldToLocal(p);
    this.target.position.copy(p);
    this.target.updateMatrixWorld(true);
  }
}

// Distance from a point to the bar's centre line.
function segmentDistance(p, bar, length) {
  const c = bar.getWorldPosition(_a);
  const dir = _b.set(1, 0, 0).applyQuaternion(bar.getWorldQuaternion(new THREE.Quaternion()));
  const t = THREE.MathUtils.clamp(_eye.copy(p).sub(c).dot(dir), -length / 2, length / 2);
  return p.distanceTo(c.addScaledVector(dir, t));
}

// An L-shaped corner grip, like a window's resize corner.
function gripGeometry(size) {
  const t = size * 0.28, s = new THREE.Shape();
  s.moveTo(-size / 2, -size / 2);
  s.lineTo(size / 2, -size / 2);
  s.lineTo(size / 2, size / 2);
  s.lineTo(size / 2 - t, size / 2);
  s.lineTo(size / 2 - t, -size / 2 + t);
  s.lineTo(-size / 2, -size / 2 + t);
  s.closePath();
  return new THREE.ShapeGeometry(s);
}
