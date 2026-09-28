import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);

// Two-hand grab of the whole scene, like in Galaxies: the midpoint between
// the pinches moves it, their distance scales it, and turning them turns it
// about the vertical axis. Scaling and turning happen about the midpoint, so
// whatever is between your hands stays there.
export class SceneGrab {
  // `object`: what gets moved; `a`, `b`: the two pinch points at the start.
  constructor(object, a, b, { min = 0.25, max = 4 } = {}) {
    this.object = object;
    this.min = min;
    this.max = max;
    this.mid = a.clone().add(b).multiplyScalar(0.5);
    this.dist = Math.max(0.02, a.distanceTo(b));
    this.ang = Math.atan2(b.z - a.z, b.x - a.x);
    this.pos = object.position.clone();
    this.scale = object.scale.x;
    this.quat = object.quaternion.clone();
  }

  update(a, b) {
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const k = THREE.MathUtils.clamp((this.scale * Math.max(0.02, a.distanceTo(b))) / this.dist, this.min, this.max);
    let turn = Math.atan2(b.z - a.z, b.x - a.x) - this.ang;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    const yaw = new THREE.Quaternion().setFromAxisAngle(UP, -turn);
    const rel = this.pos.clone().sub(this.mid).applyQuaternion(yaw).multiplyScalar(k / this.scale);
    this.object.position.copy(mid).add(rel);
    this.object.quaternion.copy(yaw).multiply(this.quat);
    this.object.scale.setScalar(k);
    this.object.updateMatrixWorld(true);
  }
}
