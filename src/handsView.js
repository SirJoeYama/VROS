import * as THREE from 'three';
import { makePointsMaterial } from './particles.js';
import { JOINTS, TIPS } from './input.js';

const MAX = JOINTS.length * 3; // left, right, mouse

// Draws each tracked joint as a small glowing point; fingertips glow brighter.
export class HandsView {
  constructor() {
    this.pos = new Float32Array(MAX * 3);
    this.glow = new Float32Array(MAX);
    this.seed = new Float32Array(MAX).fill(0.5);
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.glowAttr = new THREE.BufferAttribute(this.glow, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aSpeed', this.glowAttr);
    geo.setAttribute('aSeed', new THREE.BufferAttribute(this.seed, 1));
    this.points = new THREE.Points(geo, makePointsMaterial({ size: 0.007, colorA: [0.75, 0.85, 1], colorB: [0.75, 0.85, 1] }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  update(hands) {
    let v = 0;
    for (const h of hands) {
      for (let k = 0; k < h.jointCount && v < MAX; k++, v++) {
        this.pos[v * 3] = h.joints[k * 3];
        this.pos[v * 3 + 1] = h.joints[k * 3 + 1];
        this.pos[v * 3 + 2] = h.joints[k * 3 + 2];
        let g = h.jointCount === 1 ? 0.6 : TIPS.includes(k) ? 0.45 : 0.15;
        if (h.pinch && (k === 4 || k === 9 || h.jointCount === 1)) g = 1;
        if (h.open && h.jointCount === 1) g = 0.9;
        this.glow[v] = g;
      }
    }
    for (; v < MAX; v++) {
      this.pos[v * 3 + 1] = -1000;
      this.glow[v] = 0;
    }
    this.posAttr.needsUpdate = true;
    this.glowAttr.needsUpdate = true;
  }
}
