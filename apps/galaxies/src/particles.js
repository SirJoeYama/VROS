import * as THREE from 'three';

const VERT = /* glsl */ `
uniform float uSize;
uniform float uScale;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uFade;
attribute float aSpeed;
attribute float aSeed;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float sz = uSize * (0.6 + 0.8 * fract(aSeed * 7.13)) * (1.0 + aSpeed * 1.5);
  gl_PointSize = clamp(sz * uScale / max(-mv.z, 0.05), 1.0, 64.0);
  vec3 base = mix(uColorA, uColorB, aSeed);
  vColor = base * (0.6 + 1.4 * aSpeed) + vec3(aSpeed * aSpeed * 0.5);
  vAlpha = uFade * (0.15 + 0.45 * fract(aSeed * 3.7));
}`;

const FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = dot(c, c) * 4.0;
  if (d > 1.0) discard;
  float a = 1.0 - d;
  gl_FragColor = vec4(vColor, a * a * vAlpha);
}`;

export function makePointsMaterial({ size = 0.006, colorA = [1, 1, 1], colorB = [1, 1, 1] } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uSize: { value: size },
      uScale: { value: 800 },
      uColorA: { value: new THREE.Color(...colorA) },
      uColorB: { value: new THREE.Color(...colorB) },
      uFade: { value: 1 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

// CPU-simulated particle field. Every particle is sprung toward its home in the
// current app's formation, drifts in a divergence-free noise field, and reacts
// to hand forces (gravity wells from pinches, wind from open palms).
export class ParticleField {
  constructor(count) {
    this.count = count;
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.speed = new Float32Array(count);
    this.seed = new Float32Array(count);
    this.R = new Float32Array(count * 4);
    for (let i = 0; i < count * 4; i++) this.R[i] = Math.random();
    for (let i = 0; i < count; i++) this.seed[i] = Math.random();
    this._o = new Float32Array(3);

    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.speedAttr = new THREE.BufferAttribute(this.speed, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aSpeed', this.speedAttr);
    geo.setAttribute('aSeed', new THREE.BufferAttribute(this.seed, 1));

    this.material = makePointsMaterial({ size: 0.006 });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;

    this.colorA = new THREE.Color();
    this.colorB = new THREE.Color();
  }

  // Throw every particle onto a far shell so the boot sequence can pull them in.
  scatter(cx, cy, cz, rMin, rMax) {
    for (let i = 0, j = 0; i < this.count; i++, j += 3) {
      const z = Math.random() * 2 - 1, s = Math.sqrt(1 - z * z), p = Math.random() * Math.PI * 2;
      const r = rMin + (rMax - rMin) * Math.random();
      this.pos[j] = cx + r * s * Math.cos(p);
      this.pos[j + 1] = cy + r * z;
      this.pos[j + 2] = cz + r * s * Math.sin(p);
      this.vel[j] = this.vel[j + 1] = this.vel[j + 2] = 0;
    }
  }

  setApp(app) {
    this.app = app;
    this.colorA.setRGB(...app.colorA);
    this.colorB.setRGB(...app.colorB);
  }

  // F: { cx, cy, cz, scale, yaw, spring, stillness, wells[], pushers[] }
  update(dt, t, F) {
    const app = this.app, R = this.R, p = this.pos, v = this.vel, sp = this.speed, o = this._o;
    const S = F.scale, cyw = Math.cos(F.yaw), syw = Math.sin(F.yaw);
    const k = app.spring * F.spring;
    const nz = app.noise * S;
    const damp = Math.exp(-(1.6 + F.stillness * 9) * dt);
    const wells = F.wells, pushers = F.pushers;
    const nw = wells.length, np = pushers.length;
    const t1 = t * 0.37, t2 = t * 0.21, t3 = t * 0.29, t4 = t * 0.17, t5 = t * 0.33, t6 = t * 0.23;

    for (let i = 0, j = 0; i < this.count; i++, j += 3) {
      app.target(i, t, R, o);
      const lx = o[0] * cyw + o[2] * syw;
      const lz = -o[0] * syw + o[2] * cyw;
      const px = p[j], py = p[j + 1], pz = p[j + 2];

      let ax = (F.cx + lx * S - px) * k;
      let ay = (F.cy + o[1] * S - py) * k;
      let az = (F.cz + lz * S - pz) * k;

      // Divergence-free drift: each component ignores its own axis.
      const qx = (px - F.cx) / S, qy = (py - F.cy) / S, qz = (pz - F.cz) / S;
      ax += nz * (Math.sin(qy * 4.0 + t1) + Math.sin(qz * 5.3 - t2));
      ay += nz * (Math.sin(qz * 3.7 + t3) + Math.sin(qx * 4.9 + t4));
      az += nz * (Math.sin(qx * 4.3 - t5) + Math.sin(qy * 5.1 + t6));

      for (let w = 0; w < nw; w++) {
        const W = wells[w];
        const dx = W.x - px, dy = W.y - py, dz = W.z - pz;
        const d2 = dx * dx + dy * dy + dz * dz;
        const f = W.s / (d2 + 0.012);
        ax += dx * f - dz * f * 0.6;
        ay += dy * f;
        az += dz * f + dx * f * 0.6;
      }

      for (let h = 0; h < np; h++) {
        const H = pushers[h];
        const dx = px - H.x, dy = py - H.y, dz = pz - H.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < 0.09) {
          const d = Math.sqrt(d2) + 1e-4;
          const fall = 1 - d / 0.3;
          const f = fall * fall * H.s;
          ax += (dx / d) * f * 10 + H.nx * f * 6 + (H.ny * dz - H.nz * dy) * f * 40 + H.vx * f * 8;
          ay += (dy / d) * f * 10 + H.ny * f * 6 + (H.nz * dx - H.nx * dz) * f * 40 + H.vy * f * 8;
          az += (dz / d) * f * 10 + H.nz * f * 6 + (H.nx * dy - H.ny * dx) * f * 40 + H.vz * f * 8;
        }
      }

      const vx = (v[j] + ax * dt) * damp;
      const vy = (v[j + 1] + ay * dt) * damp;
      const vz = (v[j + 2] + az * dt) * damp;
      v[j] = vx; v[j + 1] = vy; v[j + 2] = vz;
      p[j] = px + vx * dt;
      p[j + 1] = py + vy * dt;
      p[j + 2] = pz + vz * dt;

      const s = Math.min(1, Math.sqrt(vx * vx + vy * vy + vz * vz) * 1.2);
      sp[i] += (s - sp[i]) * 0.2;
    }

    this.posAttr.needsUpdate = true;
    this.speedAttr.needsUpdate = true;

    const blend = 1 - Math.exp(-dt * 2);
    this.material.uniforms.uColorA.value.lerp(this.colorA, blend);
    this.material.uniforms.uColorB.value.lerp(this.colorB, blend);
  }
}
