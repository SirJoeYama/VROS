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
export class NavGrab {
  // `dolly`: the camera's parent; `a`, `b`: the two pinch points in the room.
  constructor(dolly, a, b, { min = 0.1, max = 10 } = {}) {
    this.dolly = dolly;
    this.min = min;
    this.max = max;
    const mid = _m.copy(a).add(b).multiplyScalar(0.5);
    this.anchor = dolly.localToWorld(mid.clone()); // the world spot between your hands stays between them
    this.dist = Math.max(0.02, a.distanceTo(b));
    this.ang = Math.atan2(b.z - a.z, b.x - a.x);
    this.scale = dolly.scale.x;
    this.yaw = new THREE.Euler().setFromQuaternion(dolly.quaternion, 'YXZ').y;
  }

  update(a, b) {
    const d = this.dolly;
    const k = THREE.MathUtils.clamp((this.scale * this.dist) / Math.max(0.02, a.distanceTo(b)), this.min, this.max);
    let turn = Math.atan2(b.z - a.z, b.x - a.x) - this.ang;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    d.quaternion.setFromAxisAngle(UP, this.yaw + turn);
    d.scale.setScalar(k);
    // place the dolly so the midpoint of your hands lands on the anchor
    const mid = _m.copy(a).add(b).multiplyScalar(0.5);
    _p.copy(mid).multiplyScalar(k).applyQuaternion(d.quaternion);
    d.position.copy(this.anchor).sub(_p);
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

// Back to where you really are: no offset, no turn, life size.
export function resetDolly(dolly) {
  dolly.position.set(0, 0, 0);
  dolly.quaternion.identity();
  dolly.scale.setScalar(1);
  dolly.updateMatrixWorld(true);
}
