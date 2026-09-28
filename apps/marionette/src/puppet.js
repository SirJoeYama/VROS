import * as THREE from 'three';

// Rest pose in meters, standing on the stage, facing the viewer (+z). "L"/"R"
// mean the viewer's left/right (-x/+x), so each of your hands works the parts
// on its own side.
const REST = {
  head: [0, 0.37, 0], neck: [0, 0.305, 0],
  sL: [-0.055, 0.29, 0], sR: [0.055, 0.29, 0],
  eL: [-0.075, 0.225, 0], eR: [0.075, 0.225, 0],
  hL: [-0.085, 0.16, 0], hR: [0.085, 0.16, 0],
  pL: [-0.03, 0.16, 0], pR: [0.03, 0.16, 0],
  kL: [-0.035, 0.085, 0.004], kR: [0.035, 0.085, 0.004],
  fL: [-0.035, 0.012, 0], fR: [0.035, 0.012, 0],
};
const RADIUS = { head: 0.032, fL: 0.012, fR: 0.012, hL: 0.012, hR: 0.012, kL: 0.014, kR: 0.014 };
const STICKS = [
  ['head', 'neck'], ['head', 'sL'], ['head', 'sR'],
  ['neck', 'sL'], ['neck', 'sR'], ['sL', 'sR'], ['neck', 'pL'], ['neck', 'pR'],
  ['sL', 'pL'], ['sR', 'pR'], ['sL', 'pR'], ['sR', 'pL'], ['pL', 'pR'],
  ['sL', 'eL'], ['eL', 'hL'], ['sR', 'eR'], ['eR', 'hR'],
  ['pL', 'kL'], ['kL', 'fL'], ['pR', 'kR'], ['kR', 'fR'],
];
const LIMBS = [
  ['sL', 'eL', 0.011], ['eL', 'hL', 0.009], ['sR', 'eR', 0.011], ['eR', 'hR', 0.009],
  ['pL', 'kL', 0.013], ['kL', 'fL', 0.011], ['pR', 'kR', 0.013], ['kR', 'fR', 0.011],
  ['neck', 'head', 0.008],
];
// Strings: control name → puppet point it pulls.
export const CONTROLS = { head: 'head', sL: 'sL', sR: 'sR', hL: 'hL', hR: 'hR', kL: 'kL', kR: 'kR' };

const GRAVITY = -9.8, H = 1 / 120, ITER = 10;
const STAGE_R = 0.2;

function faceTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#e8c39e';
  g.fillRect(0, 0, 256, 256);
  // on a three.js sphere, u = 0.25 faces +z: that's where the face goes
  const cx = 64, cy = 128;
  g.fillStyle = '#e59a8c';
  for (const dx of [-26, 26]) { g.beginPath(); g.arc(cx + dx, cy + 18, 9, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = '#2b2118';
  for (const dx of [-15, 15]) { g.beginPath(); g.ellipse(cx + dx, cy - 6, 4.5, 7, 0, 0, Math.PI * 2); g.fill(); }
  g.strokeStyle = '#7a3b2e';
  g.lineWidth = 4;
  g.lineCap = 'round';
  g.beginPath();
  g.arc(cx, cy + 8, 16, 0.2 * Math.PI, 0.8 * Math.PI);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// A wooden marionette on a small stage, simulated with Verlet physics: rigid
// sticks between joints, gravity, a floor, and strings that only pull when
// taut. A string's length is fixed when it attaches, so picking the puppet up
// never jerks it.
export class Marionette {
  constructor() {
    this.group = new THREE.Group(); // world-space puppet + strings
    this.floorY = 0;
    this.points = {};
    for (const name in REST) this.points[name] = { pos: new THREE.Vector3(), prev: new THREE.Vector3(), r: RADIUS[name] || 0.012 };
    this.sticks = STICKS.map(([a, b]) => ({ a: this.points[a], b: this.points[b], len: new THREE.Vector3(...REST[a]).distanceTo(new THREE.Vector3(...REST[b])) }));
    this.strings = {};
    for (const c in CONTROLS) this.strings[c] = { point: this.points[CONTROLS[c]], anchor: new THREE.Vector3(), attached: false, len: 0 };
    this._acc = 0;
    this._v = new THREE.Vector3();

    // --- stage ---
    this.stage = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x5a3a24, roughness: 0.8 });
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(STAGE_R, STAGE_R * 1.04, 0.025, 48), wood);
    disc.position.y = -0.0125;
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(STAGE_R * 1.02, 0.003, 8, 64),
      new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.6 }),
    );
    rim.rotation.x = Math.PI / 2;
    this.stage.add(disc, rim);

    // --- puppet body ---
    const paint = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.55 });
    this.torso = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.13, 0.05), paint(0xb8423a));
    this.headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.034, 24, 16), new THREE.MeshStandardMaterial({ map: faceTexture(), roughness: 0.6 }));
    this.hat = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.05, 20), paint(0x3a5fb8));
    this.hat.position.y = 0.045;
    this.headMesh.add(this.hat);
    const limbGeo = new THREE.CylinderGeometry(1, 1, 1, 10);
    const jointGeo = new THREE.SphereGeometry(1, 12, 8);
    const limbMats = { arm: paint(0xb8423a), leg: paint(0x2f3e66), neck: paint(0xe8c39e) };
    this.limbs = LIMBS.map(([a, b, r]) => {
      const mat = a === 'neck' ? limbMats.neck : a.startsWith('s') || a.startsWith('e') ? limbMats.arm : limbMats.leg;
      const mesh = new THREE.Mesh(limbGeo, mat);
      this.group.add(mesh);
      return { a: this.points[a], b: this.points[b], r, mesh };
    });
    this.joints = ['eL', 'eR', 'kL', 'kR'].map((n) => {
      const m = new THREE.Mesh(jointGeo, limbMats.neck);
      m.scale.setScalar(0.011);
      this.group.add(m);
      return { p: this.points[n], m };
    });
    this.extremities = [['hL', 0.014, 0xe8c39e], ['hR', 0.014, 0xe8c39e], ['fL', 0.016, 0x2b2118], ['fR', 0.016, 0x2b2118]].map(([n, r, c]) => {
      const m = new THREE.Mesh(jointGeo, paint(c));
      m.scale.set(r, r * 0.8, r * (n.startsWith('f') ? 1.5 : 1));
      this.group.add(m);
      return { p: this.points[n], m };
    });
    this.group.add(this.torso, this.headMesh);

    // --- strings ---
    const n = Object.keys(CONTROLS).length;
    this.lineGeo = new THREE.BufferGeometry();
    this.lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 6), 3));
    this.lineGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 6), 3));
    this.lines = new THREE.LineSegments(this.lineGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.lines.frustumCulled = false;
    this.group.add(this.lines);

    this._basis = new THREE.Matrix4();
    this._x = new THREE.Vector3();
    this._y = new THREE.Vector3();
    this._z = new THREE.Vector3();
  }

  // Put the stage's top center at `floor`, with the puppet facing `toward`.
  place(floor, toward) {
    this.floorY = floor.y;
    this.stage.position.copy(floor);
    this.stage.lookAt(toward.x, floor.y, toward.z);
    this.stage.updateMatrixWorld(true);
    this.reset();
  }

  // Stand the puppet up in the middle of the stage and drop all strings.
  reset() {
    for (const name in REST) {
      const p = this.points[name];
      this.stage.localToWorld(p.pos.set(...REST[name]));
      p.prev.copy(p.pos);
    }
    for (const c in this.strings) this.strings[c].attached = false;
  }

  // `anchors`: control name → world position of the fingertip holding that
  // string, or null when it isn't held.
  setAnchors(anchors) {
    for (const c in this.strings) {
      const s = this.strings[c];
      const a = anchors[c];
      if (!a) {
        s.attached = false;
        continue;
      }
      s.anchor.copy(a);
      if (!s.attached) {
        s.attached = true;
        s.len = THREE.MathUtils.clamp(a.distanceTo(s.point.pos), 0.08, 1.2);
      }
    }
  }

  update(dt) {
    this._acc = Math.min(this._acc + dt, 0.1);
    while (this._acc >= H) {
      this._step();
      this._acc -= H;
    }
    this._draw();
  }

  _step() {
    const v = this._v;
    for (const name in this.points) {
      const p = this.points[name];
      v.subVectors(p.pos, p.prev).multiplyScalar(0.992);
      if (v.lengthSq() > 0.0004) v.setLength(0.02); // cap speed (2.4 m/s)
      p.prev.copy(p.pos);
      p.pos.add(v);
      p.pos.y += GRAVITY * H * H;
    }
    for (let it = 0; it < ITER; it++) {
      for (const s of this.sticks) {
        v.subVectors(s.b.pos, s.a.pos);
        const d = v.length() || 1e-6;
        v.multiplyScalar(((d - s.len) / d) * 0.5);
        s.a.pos.add(v);
        s.b.pos.sub(v);
      }
      for (const c in this.strings) {
        const s = this.strings[c];
        if (!s.attached) continue;
        v.subVectors(s.point.pos, s.anchor);
        const d = v.length();
        if (d > s.len) s.point.pos.sub(v.multiplyScalar((d - s.len) / d));
      }
      const c = this.stage.position;
      for (const name in this.points) {
        const p = this.points[name];
        // Stay on the stage: pulled sideways, the puppet leans instead of leaving.
        v.set(p.pos.x - c.x, 0, p.pos.z - c.z);
        const maxR = STAGE_R - p.r;
        if (v.lengthSq() > maxR * maxR) {
          v.setLength(maxR);
          p.pos.x = c.x + v.x;
          p.pos.z = c.z + v.z;
        }
        const floor = this.floorY + p.r;
        if (p.pos.y < floor) {
          p.pos.y = floor;
          // friction: bleed off sliding
          p.prev.x = p.pos.x - (p.pos.x - p.prev.x) * 0.7;
          p.prev.z = p.pos.z - (p.pos.z - p.prev.z) * 0.7;
        }
      }
    }
  }

  _draw() {
    const P = this.points;
    // torso: x across the shoulders, y up the spine
    const x = this._x.subVectors(P.sR.pos, P.sL.pos).normalize();
    const hipMid = this._v.addVectors(P.pL.pos, P.pR.pos).multiplyScalar(0.5);
    const y = this._y.subVectors(P.neck.pos, hipMid).normalize();
    const z = this._z.crossVectors(x, y).normalize();
    x.crossVectors(y, z);
    this._basis.makeBasis(x, y, z);
    this.torso.quaternion.setFromRotationMatrix(this._basis);
    this.torso.position.addVectors(P.neck.pos, hipMid).multiplyScalar(0.5);
    this.headMesh.position.copy(P.head.pos);
    // head faces the way the chest does, tilted along the neck
    const up = this._v.subVectors(P.head.pos, P.neck.pos).normalize();
    const hx = x.clone().addScaledVector(up, -x.dot(up)).normalize();
    this._basis.makeBasis(hx, up, new THREE.Vector3().crossVectors(hx, up));
    this.headMesh.quaternion.setFromRotationMatrix(this._basis);

    for (const l of this.limbs) {
      const d = this._v.subVectors(l.b.pos, l.a.pos);
      const len = d.length();
      l.mesh.position.addVectors(l.a.pos, l.b.pos).multiplyScalar(0.5);
      l.mesh.quaternion.setFromUnitVectors(THREE.Object3D.DEFAULT_UP, d.divideScalar(len || 1));
      l.mesh.scale.set(l.r, len, l.r);
    }
    for (const j of this.joints) j.m.position.copy(j.p.pos);
    for (const e of this.extremities) {
      e.m.position.copy(e.p.pos);
      e.m.quaternion.copy(this.torso.quaternion);
    }

    const pos = this.lineGeo.attributes.position, col = this.lineGeo.attributes.color;
    let i = 0;
    for (const c in this.strings) {
      const s = this.strings[c];
      const top = s.attached ? s.anchor : s.point.pos;
      pos.setXYZ(i * 2, top.x, top.y, top.z);
      pos.setXYZ(i * 2 + 1, s.point.pos.x, s.point.pos.y + (c === 'head' ? 0.03 : 0), s.point.pos.z);
      const taut = s.attached ? THREE.MathUtils.clamp((top.distanceTo(s.point.pos) / s.len - 0.9) * 10, 0, 1) : 0;
      const b = s.attached ? 0.35 + 0.65 * taut : 0;
      col.setXYZ(i * 2, b, b * 0.85, b * 0.6);
      col.setXYZ(i * 2 + 1, b, b * 0.85, b * 0.6);
      i++;
    }
    pos.needsUpdate = col.needsUpdate = true;
  }
}
