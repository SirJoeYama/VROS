import * as THREE from 'three';
import { CFG } from './config.js';

// A cube paddle. Each frame: begin() keeps last frame's pose (for the swept
// hit test), set() gives this frame's pose in court space, finish() works out
// the velocity from a short history and animates the hit glow.
export class Paddle {
  constructor(parent, side, color) {
    this.side = side;
    const s = CFG.PADDLE_SIZE;
    this.group = new THREE.Group();
    this.mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, roughness: 0.4, metalness: 0.1 });
    const box = new THREE.BoxGeometry(s, s, s);
    this.group.add(new THREE.Mesh(box, this.mat));
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(box), new THREE.LineBasicMaterial({ color: 0xffffff }));
    edge.scale.setScalar(1.01);
    this.group.add(edge);
    this.group.visible = false;
    parent.add(this.group);

    this.pos = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.prevPos = new THREE.Vector3();
    this.prevQuat = new THREE.Quaternion();
    this.vel = new THREE.Vector3();
    this.hist = Array.from({ length: CFG.VEL_SAMPLES }, () => ({ p: new THREE.Vector3(), t: 0 }));
    this.histIdx = 0;
    this.histCount = 0;
    this.active = false;
    this.wasActive = false;
    this.mouse = false; // driven by the desktop mouse (no forward swing)
    this.glow = 0;
    this.lastHit = -1;
  }

  begin() {
    this.prevPos.copy(this.pos);
    this.prevQuat.copy(this.quat);
    this.wasActive = this.active;
    this.active = false;
  }

  set(pos, quat, mouse = false) {
    this.pos.copy(pos);
    this.quat.copy(quat);
    this.active = true;
    this.mouse = mouse;
  }

  // Desktop: the mouse paddle is close to the camera, so it's see-through.
  setSeeThrough(on) {
    if (this.mat.transparent === on) return;
    this.mat.transparent = on;
    this.mat.opacity = on ? 0.45 : 1;
    this.mat.needsUpdate = true;
  }

  finish(dt, time) {
    this.group.visible = this.active;
    if (!this.active) return;
    if (!this.wasActive) {
      // just appeared: nothing to sweep from
      this.prevPos.copy(this.pos);
      this.prevQuat.copy(this.quat);
      this.histCount = 0;
      this.vel.set(0, 0, 0);
    }
    const N = CFG.VEL_SAMPLES;
    const h = this.hist[this.histIdx];
    h.p.copy(this.pos);
    h.t = time;
    this.histIdx = (this.histIdx + 1) % N;
    this.histCount = Math.min(this.histCount + 1, N);
    if (this.histCount >= 2) {
      const newest = this.hist[(this.histIdx - 1 + N) % N];
      const oldest = this.hist[(this.histIdx - this.histCount + N) % N];
      const span = newest.t - oldest.t;
      if (span > 1e-4) this.vel.subVectors(newest.p, oldest.p).divideScalar(span);
    }
    this.group.position.copy(this.pos);
    this.group.quaternion.copy(this.quat);
    this.glow = Math.max(0, this.glow - dt * 4);
    this.mat.emissiveIntensity = 0.35 + this.glow * 2.5;
    this.group.scale.setScalar(1 + this.glow * 0.08);
  }
}
