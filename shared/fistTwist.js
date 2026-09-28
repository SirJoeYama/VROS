import * as THREE from 'three';

const _axis = new THREE.Vector3(), _across = new THREE.Vector3(), _v = new THREE.Vector3();

// Twisting a closed fist like a knob. roll(h) returns how far a tracked
// hand's fist has rolled around the forearm since the last call, in radians;
// seen from behind the hand (the wearer's view), positive is clockwise.
// It returns 0 on the first frame of a fist; call release(h) when the hand
// opens (or once per frame with prune(hands)) so the next fist starts fresh.
export class FistTwist {
  constructor() {
    this.prev = new Map(); // hand id → last "across the knuckles" direction
  }

  roll(h) {
    const j = h.joints;
    _axis.set(j[33] - j[0], j[34] - j[1], j[35] - j[2]).normalize(); // wrist → middle knuckle
    _across.set(j[18] - j[63], j[19] - j[64], j[20] - j[65]); // pinky knuckle → index knuckle
    _across.addScaledVector(_axis, -_across.dot(_axis)).normalize();
    const prev = this.prev.get(h.id);
    this.prev.set(h.id, _across.clone());
    if (!prev) return 0;
    return Math.atan2(_v.crossVectors(prev, _across).dot(_axis), prev.dot(_across));
  }

  release(h) {
    this.prev.delete(h.id);
  }

  // Forget hands that aren't tracked any more.
  prune(hands) {
    for (const id of [...this.prev.keys()]) if (!hands.some((h) => h.id === id)) this.prev.delete(id);
  }
}
