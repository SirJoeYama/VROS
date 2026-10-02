import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Vector3(), _p = new THREE.Vector3();

// Looking around with both hands, without touching anything: pinch empty
// space with both hands and move them to move your viewpoint, pull them apart
// to zoom in (you get smaller, the world bigger) or together to zoom out,
// and turn them to turn the view around you. Only the "dolly" the XR camera
// sits in moves, so the models, skeletons and poses are never changed.
// Works in the room's own coordinates (the hands' `realPinch`), so moving
// the dolly doesn't feed back into the hands it's following. The floor stays
// level: the view only turns about the vertical.
//
// Zooming by scaling you has a cost: once you're not life size, moving your
// head 10 cm moves your view more (or less) than 10 cm, so in passthrough the
// scene no longer sits still in your room; it drifts as you move. With the
// `world` option (a group holding the content, unrotated, directly in the
// scene) you stay life size and the world group is scaled instead, about the
// spot between your hands: same feel while you grab, and everything stays put
// afterwards.
export class NavGrab {
  // `dolly`: the camera's parent; `a`, `b`: the two pinch points in the room.
  constructor(dolly, a, b, { min = 0.1, max = 10, world = null } = {}) {
    this.dolly = dolly;
    this.world = world;
    this.min = min;
    this.max = max;
    const mid = _m.copy(a).add(b).multiplyScalar(0.5);
    this.anchor = dolly.localToWorld(mid.clone()); // the world spot between your hands stays between them
    if (world) world.worldToLocal(this.anchor); // …kept in the world group's own space, as it scales
    this.dist = Math.max(0.02, a.distanceTo(b));
    this.ang = Math.atan2(b.z - a.z, b.x - a.x);
    this.scale = (world || dolly).scale.x;
    this.yaw = new THREE.Euler().setFromQuaternion(dolly.quaternion, 'YXZ').y;
  }

  update(a, b) {
    const d = this.dolly, w = this.world;
    const ratio = Math.max(0.02, a.distanceTo(b)) / this.dist; // > 1: hands pulled apart, zoom in
    let turn = Math.atan2(b.z - a.z, b.x - a.x) - this.ang;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    d.quaternion.setFromAxisAngle(UP, this.yaw + turn);
    const target = _p;
    if (w) {
      w.scale.setScalar(THREE.MathUtils.clamp(this.scale * ratio, this.min, this.max)); // the world grows
      w.updateMatrixWorld(true);
      w.localToWorld(target.copy(this.anchor));
    } else {
      d.scale.setScalar(THREE.MathUtils.clamp(this.scale / ratio, this.min, this.max)); // you shrink
      target.copy(this.anchor);
    }
    // place the dolly so the midpoint of your hands lands on the anchor
    const mid = _m.copy(a).add(b).multiplyScalar(0.5).multiplyScalar(d.scale.x).applyQuaternion(d.quaternion);
    d.position.copy(target).sub(mid);
    d.updateMatrixWorld(true);
  }
}

// One hand: grab the world and pull yourself through it. The world spot you
// pinched stays under your fingers as you move your hand (no zoom, no turn).
export class NavDrag {
  constructor(dolly, a) {
    this.dolly = dolly;
    this.anchor = dolly.localToWorld(a.clone());
  }

  update(a) {
    const d = this.dolly;
    _p.copy(a).multiplyScalar(d.scale.x).applyQuaternion(d.quaternion);
    d.position.copy(this.anchor).sub(_p);
    d.updateMatrixWorld(true);
  }
}

// Thumbsticks (Quest controllers): the right stick moves you over the floor
// in the direction you're looking (forward / back / sideways), the left
// stick turns you 30° at a flick, about where you stand. Returns true on a
// frame where you started moving (so an app can remember the view for undo).
const MOVE_SPEED = 1.4, DEAD = 0.18, TURN = Math.PI / 6;
export class StickNav {
  constructor(dolly) {
    this.dolly = dolly;
    this.moving = false;
    this.flicked = false;
  }

  update(hands, dt, viewer) {
    const d = this.dolly;
    const right = hands.find((h) => h.kind === 'controller' && h.handedness === 'right');
    const left = hands.find((h) => h.kind === 'controller' && h.handedness === 'left');
    let started = false;
    const s = right?.stick;
    if (s && Math.hypot(s.x, s.y) > DEAD) {
      if (!this.moving) started = true;
      this.moving = true;
      const fwd = _m.set(0, 0, -1).applyQuaternion(viewer.getWorldQuaternion(new THREE.Quaternion()));
      fwd.y = 0;
      if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
      fwd.normalize();
      const side = _p.set(-fwd.z, 0, fwd.x);
      d.position.addScaledVector(fwd, s.y * MOVE_SPEED * dt * d.scale.x).addScaledVector(side, s.x * MOVE_SPEED * dt * d.scale.x);
      d.updateMatrixWorld(true);
    } else this.moving = false;
    const x = left?.stick.x || 0;
    if (Math.abs(x) > 0.7 && !this.flicked) {
      this.flicked = true;
      started = true;
      // turn about your head, so you stay where you are
      const head = viewer.getWorldPosition(new THREE.Vector3());
      const q = new THREE.Quaternion().setFromAxisAngle(UP, x > 0 ? -TURN : TURN);
      d.position.sub(head).applyQuaternion(q).add(head);
      d.quaternion.premultiply(q);
      d.updateMatrixWorld(true);
    } else if (Math.abs(x) < 0.3) this.flicked = false;
    return started;
  }
}

// Back to where you really are: no offset, no turn, life size; and, given
// the `world` group, no zoom.
export function resetDolly(dolly, world = null) {
  for (const o of [dolly, world]) {
    if (!o) continue;
    o.position.set(0, 0, 0);
    o.quaternion.identity();
    o.scale.setScalar(1);
    o.updateMatrixWorld(true);
  }
}
