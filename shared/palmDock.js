import * as THREE from 'three';

const HOLD = 1; // seconds the palm must stay up
const LET_GO = 0.3; // the palm can drop this long (tracking flicker) before the menu stays behind
const LIFT = 0.03; // gap between the palm and the menu's bottom edge (m)
const RING_R = 0.03, SEGMENTS = 48;
const UP = new THREE.Vector3(0, 1, 0);

const _p = new THREE.Vector3(), _eye = new THREE.Vector3(), _s = new THREE.Vector3();

// Palm up for a second and the menu comes to your hand, like the dock in
// Galaxies: it turns to face you as it arrives, then rides just above your
// palm (without turning) while you poke it with your other hand. Lower your
// palm and it stays where it was, in the air. To turn it, hold its two
// handles (see PanelGrab).
// It doesn't come while both palms are up or a hand is pinching: that's the
// two-hand grab getting ready. With controllers: click the left stick and
// the menu comes to the left controller; click again and it stays in the air.
// The left hand is preferred when both are up.
// `target` moves (the panel or a group holding it); `panel` is the panel mesh,
// `height` its unscaled height, so its bottom edge can sit above the palm.
// Options: `detach` moves the target into that parent first (out of whatever
// carries it); `busy()` true means something else is moving the panel (the
// grab bar), which takes it off the palm; `onMove()` is called when it
// docks, so the app knows the panel has been placed by hand.
export class PalmDock {
  constructor(target, panel, height, { detach = null, busy = () => false, onMove = () => {} } = {}) {
    this.target = target;
    this.panel = panel;
    this.height = height;
    this.detach = detach;
    this.busy = busy;
    this.onMove = onMove;
    this.hold = 0;
    this.hand = null; // id of the hand the menu is on
    this.lost = 0;

    const pts = [];
    for (let i = 0; i <= SEGMENTS; i++) {
      const a = Math.PI / 2 - (i / SEGMENTS) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * RING_R, Math.sin(a) * RING_R, 0));
    }
    this.ring = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0x9fb8ff, transparent: true, depthTest: false, depthWrite: false }),
    );
    this.ring.renderOrder = 21;
    this.ring.visible = false;
    this.ring.frustumCulled = false;
    this.group = this.ring;
  }

  get docked() {
    return this.hand !== null;
  }

  // Take the menu off the palm (e.g. when the app recenters it).
  release() {
    this.hand = null;
    this.hold = 0;
  }

  // Returns the hand that's holding (or summoning) the menu, so the app can
  // leave it out of its own gestures.
  update(hands, dt, viewer) {
    viewer.getWorldPosition(_eye);
    const k = viewer.getWorldScale(_s).x; // your size in the world (zoomed views)
    const up = (h) => h.kind === 'hand' && h.palmUp;
    if (this.busy()) {
      this.hand = null;
      this.hold = 0;
    }

    // controllers: the left stick click
    const pad = hands.find((x) => x.kind === 'controller' && x.handedness === 'left');
    const click = !!pad?.btn.stick && !this._click;
    this._click = !!pad?.btn.stick;
    if (click && !this.busy()) {
      if (this.docked && this.hand === pad.id) this.hand = null;
      else {
        if (this.detach && this.target.parent !== this.detach) this.detach.attach(this.target);
        this.hand = pad.id;
        this.lost = 0;
        this.onMove();
        this._follow(pad, k, true);
      }
    }

    if (this.docked) {
      const h = hands.find((x) => x.id === this.hand);
      if (h && h.kind === 'controller') {
        this._follow(h, k); // stays on the controller until the next click
        this.ring.visible = false;
        return h;
      }
      if (h && up(h)) {
        this.lost = 0;
        this._follow(h, k);
      } else if ((this.lost += dt) > LET_GO) {
        this.hand = null; // it stays where it was
        this.hold = 0;
      }
      this.ring.visible = false;
      return this.docked ? h || null : null;
    }

    const h = hands.find((x) => up(x) && x.handedness === 'left') || hands.find(up);
    const grabbing = hands.filter(up).length > 1 || hands.some((x) => x.kind === 'hand' && x.pinch);
    if (h && !this.busy() && !grabbing) {
      this.hold += dt;
      if (this.hold >= HOLD) {
        if (this.detach && this.target.parent !== this.detach) this.detach.attach(this.target);
        this.hand = h.id;
        this.lost = 0;
        this.onMove();
        this._follow(h, k, true);
      }
    } else this.hold = Math.max(0, this.hold - dt * 3);

    const p = Math.min(1, this.hold / HOLD);
    this.ring.visible = !!h && !this.docked && p > 0.05;
    if (this.ring.visible) {
      this.ring.position.copy(h.palmCenter).addScaledVector(UP, 0.06 * k);
      this.ring.lookAt(_eye);
      this.ring.scale.setScalar(k);
      this.ring.geometry.setDrawRange(0, Math.max(2, Math.round(p * SEGMENTS) + 1));
      this.ring.material.opacity = 0.35 + 0.65 * p;
    }
    return h || null;
  }

  // The panel's middle goes half its height (plus a gap) above the palm, a
  // little toward you so it clears your fingers. It turns to face you only as
  // it arrives (`snap`); after that only its position follows the palm,
  // smoothed so hand-tracking jitter doesn't shake it.
  _follow(h, k, snap = false) {
    const half = (this.height / 2) * this.panel.getWorldScale(_s).y;
    _p.copy(h.palmCenter).addScaledVector(UP, LIFT * k + half);
    const toEye = _s.copy(_eye).sub(h.palmCenter);
    toEye.y = 0;
    if (toEye.lengthSq() > 1e-8) _p.addScaledVector(toEye.normalize(), 0.03 * k);
    const parent = this.target.parent;
    const world = this.target.getWorldPosition(new THREE.Vector3());
    world.lerp(_p, snap ? 1 : 0.35);
    if (parent) parent.worldToLocal(world);
    this.target.position.copy(world);
    if (snap) this.target.lookAt(_eye);
    this.target.updateMatrixWorld(true);
  }
}
