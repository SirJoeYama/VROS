import * as THREE from 'three';

// The puppet's skeleton. Each bone sits at its joint and is named after it:
// "shoulderL" is the upper arm (it turns at the shoulder), "elbowL" the
// forearm, and so on. Children follow their parents (forward kinematics).
// "L"/"R" are the viewer's left/right; the puppet faces the viewer (+z).
const BONES = [
  // name, parent, joint offset from the parent joint (m)
  ['hips', null, [0, 0.2, 0]],
  ['spine', 'hips', [0, 0, 0]],
  ['chest', 'spine', [0, 0.1, 0]],
  ['neck', 'chest', [0, 0.055, 0]],
  ['head', 'neck', [0, 0.03, 0]],
  ['shoulderL', 'chest', [-0.058, 0.045, 0]],
  ['elbowL', 'shoulderL', [0, -0.075, 0]],
  ['handL', 'elbowL', [0, -0.07, 0]],
  ['shoulderR', 'chest', [0.058, 0.045, 0]],
  ['elbowR', 'shoulderR', [0, -0.075, 0]],
  ['handR', 'elbowR', [0, -0.07, 0]],
  ['hipL', 'hips', [-0.032, -0.012, 0]],
  ['kneeL', 'hipL', [0, -0.09, 0]],
  ['footL', 'kneeL', [0, -0.088, 0]],
  ['hipR', 'hips', [0.032, -0.012, 0]],
  ['kneeR', 'hipR', [0, -0.09, 0]],
  ['footR', 'kneeR', [0, -0.088, 0]],
];
// Rest pose: arms a little away from the body.
const REST_ROT = { shoulderL: [0, 0, -0.18], shoulderR: [0, 0, 0.18], elbowL: [0.12, 0, 0], elbowR: [0.12, 0, 0] };

// Grab handles:
// - "fk" handles bend the bone that ends at them (the chest bends the spine,
//   the elbow the upper arm, the wrist the forearm, ...); children follow.
// - "end" handles sit at the fingertips and toe tips. In IK mode they place
//   the tip and the elbow/knee bends to follow; in FK mode they rotate the
//   hand or foot itself at the wrist/ankle. The mode is chosen per limb type.
// - "hip" moves the pelvis while the feet stay planted (legs re-solve by IK).
// - "move" (a ring on the floor) moves the whole puppet.
export const HANDLES = [
  { name: 'puppet', type: 'move', bone: 'hips', at: [0, 0, 0] },
  { name: 'hips', type: 'hip', bone: 'hips', at: [0, -0.005, 0.034] },
  { name: 'chest', type: 'fk', bone: 'chest', at: [0, 0, 0], rotates: 'spine' },
  { name: 'head', type: 'fk', bone: 'head', at: [0, 0.035, 0], rotates: 'neck' },
];
for (const s of ['L', 'R']) {
  HANDLES.push(
    { name: 'elbow' + s, type: 'fk', bone: 'elbow' + s, at: [0, 0, 0], rotates: 'shoulder' + s },
    { name: 'wrist' + s, type: 'fk', bone: 'hand' + s, at: [0, 0, 0], rotates: 'elbow' + s },
    { name: 'fingers' + s, type: 'end', limb: 'hand', bone: 'hand' + s, at: [0, -0.034, 0], chain: ['shoulder' + s, 'elbow' + s], rotates: 'hand' + s, pole: [0, 0, -1] },
    { name: 'knee' + s, type: 'fk', bone: 'knee' + s, at: [0, 0, 0], rotates: 'hip' + s },
    { name: 'ankle' + s, type: 'fk', bone: 'foot' + s, at: [0, 0, 0], rotates: 'knee' + s },
    { name: 'toes' + s, type: 'end', limb: 'foot', bone: 'foot' + s, at: [0, -0.014, 0.042], chain: ['hip' + s, 'knee' + s], rotates: 'foot' + s, pole: [0, 0, 1] },
  );
}
const FEET = HANDLES.filter((h) => h.limb === 'foot');

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();

// Give `bone` this world rotation, keeping its parent where it is.
function setWorldQuaternion(bone, q) {
  bone.parent.getWorldQuaternion(_q2);
  bone.quaternion.copy(_q2.invert().multiply(q));
  bone.updateMatrixWorld(true);
}

// Turn `bone` so that the world direction `from` now points along `to`.
function turnBone(bone, from, to) {
  _q.setFromUnitVectors(from.clone().normalize(), to.clone().normalize());
  setWorldQuaternion(bone, _q.multiply(bone.getWorldQuaternion(new THREE.Quaternion())));
}

export class Rig {
  // `ghost`: a see-through copy for onion skinning, in `color`.
  constructor({ ghost = false, color = 0xffffff } = {}) {
    this.root = new THREE.Group();
    this.bones = {};
    for (const [name, parent, off] of BONES) {
      const b = new THREE.Object3D();
      b.name = name;
      b.position.set(...off);
      b.userData.rest = b.position.clone();
      if (REST_ROT[name]) b.rotation.set(...REST_ROT[name]);
      b.userData.restQ = b.quaternion.clone();
      (parent ? this.bones[parent] : this.root).add(b);
      this.bones[name] = b;
    }
    this._buildBody(ghost, color);
    this.root.updateMatrixWorld(true);
  }

  _buildBody(ghost, color) {
    const mat = (c) =>
      ghost
        ? new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, depthWrite: false })
        : new THREE.MeshStandardMaterial({ color: c, roughness: 0.55 });
    const skin = mat(0xe8c39e), shirt = mat(0xb8423a), pants = mat(0x2f3e66), shoe = mat(0x2b2118), hat = mat(0x3a5fb8);
    const B = this.bones;
    const add = (bone, geo, m, pos = [0, 0, 0], rot = [0, 0, 0]) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(...pos);
      mesh.rotation.set(...rot);
      B[bone].add(mesh);
      return mesh;
    };
    // a capsule from this bone's joint to its child's joint (child hangs along local y)
    const limb = (bone, child, r, m) => {
      const len = B[child].userData.rest.length();
      const dir = B[child].userData.rest.clone().normalize();
      const mesh = add(bone, new THREE.CapsuleGeometry(r, Math.max(0.001, len - 2 * r), 4, 10), m);
      mesh.position.copy(dir).multiplyScalar(len / 2);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    };
    add('hips', new THREE.BoxGeometry(0.085, 0.04, 0.05), pants, [0, -0.005, 0]);
    add('spine', new THREE.BoxGeometry(0.1, 0.11, 0.055), shirt, [0, 0.055, 0]);
    limb('neck', 'head', 0.012, skin);
    add('head', new THREE.SphereGeometry(0.036, 24, 16), ghost ? skin : new THREE.MeshStandardMaterial({ map: faceTexture(), roughness: 0.6 }), [0, 0.035, 0]);
    add('head', new THREE.ConeGeometry(0.03, 0.05, 20), hat, [0, 0.085, 0]);
    for (const s of ['L', 'R']) {
      limb('shoulder' + s, 'elbow' + s, 0.013, shirt);
      limb('elbow' + s, 'hand' + s, 0.011, skin);
      add('hand' + s, new THREE.SphereGeometry(0.016, 12, 10), skin, [0, -0.012, 0]);
      limb('hip' + s, 'knee' + s, 0.015, pants);
      limb('knee' + s, 'foot' + s, 0.013, pants);
      add('foot' + s, new THREE.BoxGeometry(0.03, 0.02, 0.055), shoe, [0, -0.008, 0.012]);
    }
  }

  // ---------- poses ----------
  getPose() {
    const rot = {};
    for (const n in this.bones) rot[n] = this.bones[n].quaternion.toArray().map((v) => +v.toFixed(5));
    return { root: this.bones.hips.position.toArray().map((v) => +v.toFixed(5)), rot };
  }

  setPose(pose) {
    this.bones.hips.position.fromArray(pose.root);
    for (const n in this.bones) if (pose.rot[n]) this.bones[n].quaternion.fromArray(pose.rot[n]);
    this.root.updateMatrixWorld(true);
  }

  restPose() {
    for (const n in this.bones) {
      this.bones[n].position.copy(this.bones[n].userData.rest);
      this.bones[n].quaternion.copy(this.bones[n].userData.restQ);
    }
    this.root.updateMatrixWorld(true);
    return this.getPose();
  }

  // Joint positions in the puppet's own frame (for timeline thumbnails).
  joints() {
    const out = {};
    const inv = new THREE.Matrix4().copy(this.root.matrixWorld).invert();
    for (const n in this.bones) out[n] = this.bones[n].getWorldPosition(new THREE.Vector3()).applyMatrix4(inv);
    out.headTop = this.bones.head.localToWorld(new THREE.Vector3(0, 0.07, 0)).applyMatrix4(inv);
    return out;
  }

  handlePosition(h, out = new THREE.Vector3()) {
    if (h.type === 'move') {
      const p = this.bones.hips.position;
      return this.root.localToWorld(out.set(p.x, 0.004, p.z)); // on the floor under the hips
    }
    return this.bones[h.bone].localToWorld(out.set(...h.at));
  }

  // ---------- dragging ----------
  // Start dragging handle `h`, grabbed at world `point`. `modes` says
  // whether hand and foot tips are IK or FK: { hand: 'ik'|'fk', foot: ... }.
  beginDrag(h, point, modes = { hand: 'ik', foot: 'ik' }) {
    const d = { h, offset: this.handlePosition(h).sub(point) };
    if (h.type === 'move' || h.type === 'hip') {
      d.mode = h.type;
      d.rootStart = this.bones.hips.position.clone();
      d.parentStart = this.root.worldToLocal(point.clone());
      if (h.type === 'hip') {
        // remember where the feet are, to keep them there
        d.feet = FEET.map((f) => ({ f, pos: this.bones[f.bone].getWorldPosition(new THREE.Vector3()), q: this.bones[f.bone].getWorldQuaternion(new THREE.Quaternion()) }));
      }
    } else if (h.type === 'fk' || modes[h.limb] === 'fk') {
      d.mode = 'fk';
      d.bone = this.bones[h.rotates];
      d.joint = d.bone.getWorldPosition(new THREE.Vector3());
      d.from = this.handlePosition(h).sub(d.joint);
      d.startQ = d.bone.getWorldQuaternion(new THREE.Quaternion());
    } else {
      d.mode = 'ik';
      const end = this.bones[h.bone];
      d.endQ = end.getWorldQuaternion(new THREE.Quaternion());
      // The tip follows the pinch; the wrist/ankle keeps its offset from the
      // tip because the hand/foot keeps its orientation.
      d.offset = end.getWorldPosition(new THREE.Vector3()).sub(point);
    }
    return d;
  }

  drag(d, point) {
    if (d.mode === 'move' || d.mode === 'hip') {
      const now = this.root.worldToLocal(point.clone());
      this.bones.hips.position.copy(d.rootStart).add(now.sub(d.parentStart));
      this.root.updateMatrixWorld(true);
      if (d.mode === 'hip') {
        for (const { f, pos, q } of d.feet) {
          this.solveIK(f, pos);
          setWorldQuaternion(this.bones[f.bone], q);
        }
      }
    } else if (d.mode === 'fk') {
      // Swing the bone about its joint so the grabbed spot follows the hand.
      const to = _a.copy(point).add(d.offset).sub(d.joint);
      if (to.lengthSq() < 1e-8) return;
      _q.setFromUnitVectors(_b.copy(d.from).normalize(), to.normalize());
      setWorldQuaternion(d.bone, _q.multiply(d.startQ));
    } else {
      this.solveIK(d.h, _c.copy(point).add(d.offset));
      setWorldQuaternion(this.bones[d.h.bone], d.endQ); // hand/foot keeps its orientation
    }
  }

  // Two-bone IK: put the hand/foot at `target`, bending the elbow/knee in its
  // current plane (or the natural way when the limb is straight).
  solveIK(h, target) {
    const upper = this.bones[h.chain[0]], lower = this.bones[h.chain[1]], end = this.bones[h.bone];
    const A = upper.getWorldPosition(new THREE.Vector3());
    const B = lower.getWorldPosition(new THREE.Vector3());
    const l1 = lower.userData.rest.length() * this._scale(), l2 = end.userData.rest.length() * this._scale();
    const toT = _a.copy(target).sub(A);
    const d = THREE.MathUtils.clamp(toT.length(), Math.abs(l1 - l2) + 1e-4, l1 + l2 - 1e-4);
    const dir = toT.normalize();

    // Bend direction: where the elbow/knee points now, away from the line A→target.
    const bend = _b.copy(B).sub(A);
    bend.addScaledVector(dir, -bend.dot(dir));
    if (bend.lengthSq() < 1e-8) {
      bend.set(...h.pole).applyQuaternion(this.root.getWorldQuaternion(_q2));
      bend.addScaledVector(dir, -bend.dot(dir));
    }
    bend.normalize();

    const cosA = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    const newB = _c.copy(A).addScaledVector(dir, l1 * cosA).addScaledVector(bend, l1 * sinA);
    const newC = _d.copy(A).addScaledVector(dir, d);

    turnBone(upper, B.clone().sub(A), newB.clone().sub(A));
    const B2 = lower.getWorldPosition(new THREE.Vector3());
    const C2 = end.getWorldPosition(new THREE.Vector3());
    turnBone(lower, C2.sub(B2), newC.clone().sub(B2));
  }

  _scale() {
    return this.root.getWorldScale(_a).x;
  }
}

function faceTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#e8c39e';
  g.fillRect(0, 0, 256, 256);
  const cx = 64, cy = 128; // on a three.js sphere, u = 0.25 faces +z
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
