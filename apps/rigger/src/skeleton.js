import * as THREE from 'three';
import { isLeaf } from './skinning.js';

// "upperarm_l" and "upperarm_r" share the base name "upperarm_#".
const SIDE = /^(l|r|left|right)$/;
const baseName = (name) => name.toLowerCase().split(/([_.\-])/).map((t) => (SIDE.test(t) ? '#' : t)).join('');
const sideOf = (name) => {
  const t = name.toLowerCase().split(/[_.\-]/).find((t) => SIDE.test(t));
  return t ? t[0] : null;
};

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _m = new THREE.Matrix4();

// The template skeleton, being fitted into a model. Joints are moved by
// translating bones only; every bone keeps the rest rotation the animations
// were made for, so they still play on the fitted skeleton.
export class EditRig {
  constructor(scene, rig) {
    this.rig = rig;
    this.root = scene; // the "Armature" node and everything under it
    this.bones = [];
    scene.traverse((o) => o.isBone && this.bones.push(o));
    this.handles = this.bones.filter((b) => b.parent?.isBone || b.name !== 'root');
    this.trackBone = this.bones.find((b) => b.name.toLowerCase().includes(rig.track)) || this.bones[1] || this.bones[0];
    this.scale = 1; // how much the whole skeleton was scaled from the template
    this.template = this.snapshot(); // as authored: what the animations expect
    this.initial = this.template;
    this.undoStack = [];
    this.mirror = true;
    this.children = 'follow'; // or 'stay': children keep their place when a joint moves
    this.mirrorOf = new Map();
    for (const b of this.bones) {
      const base = baseName(b.name);
      const twin = this.bones.find((o) => o !== b && baseName(o.name) === base);
      if (twin) this.mirrorOf.set(b, twin);
    }
  }

  side(bone) {
    return this.mirrorOf.has(bone) ? sideOf(bone.name) : null;
  }

  snapshot() {
    return { pos: this.bones.map((b) => b.position.clone()), scale: this.scale };
  }

  restore(s) {
    s.pos.forEach((p, i) => this.bones[i].position.copy(p));
    this.scale = s.scale;
    this.root.updateMatrixWorld(true);
  }

  pushUndo() {
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > 60) this.undoStack.shift();
  }

  undo() {
    const s = this.undoStack.pop();
    if (s) this.restore(s);
    return !!s;
  }

  reset() {
    this.pushUndo();
    this.restore(this.initial);
  }

  // Put a joint at `world`. Its twin on the other side follows, mirrored
  // across the skeleton's centre plane (x = 0 in the armature's space).
  moveJoint(bone, world) {
    this._place(bone, world);
    const twin = this.mirror && this.mirrorOf.get(bone);
    if (twin) {
      this.root.worldToLocal(_b.copy(world));
      _b.x = -_b.x;
      this._place(twin, this.root.localToWorld(_b));
    }
  }

  _place(bone, world) {
    const kids = this.children === 'stay' ? bone.children.filter((c) => c.isBone).map((c) => [c, c.getWorldPosition(new THREE.Vector3())]) : [];
    bone.parent.updateMatrixWorld(true);
    bone.position.copy(bone.parent.worldToLocal(_a.copy(world)));
    bone.updateMatrixWorld(true);
    for (const [c, p] of kids) {
      c.position.copy(bone.worldToLocal(p));
      c.updateMatrixWorld(true);
    }
  }

  // Scale the whole skeleton about its origin (between the feet).
  scaleBy(k) {
    for (const b of this.bones) b.position.multiplyScalar(k);
    this.scale *= k;
    this.root.updateMatrixWorld(true);
  }

  // Bounding box of the joints in `space` (an ancestor of the skeleton).
  box(space) {
    const box = new THREE.Box3();
    _m.copy(space.matrixWorld).invert();
    for (const b of this.bones) box.expandByPoint(b.getWorldPosition(_a).applyMatrix4(_m));
    return box;
  }

  // First guess for a model that isn't the template's own sample: scale the
  // skeleton to the model's height (or its length, for flat creatures) and
  // stand it on the same floor, centred.
  autoFit(modelBox, space) {
    this.root.updateMatrixWorld(true);
    const rb = this.box(space), rs = rb.getSize(new THREE.Vector3()), ms = modelBox.getSize(new THREE.Vector3());
    const flat = rs.y < 0.5 * Math.max(rs.x, rs.z);
    const k = flat ? Math.max(ms.x, ms.z) / Math.max(rs.x, rs.z, 1e-4) : ms.y / Math.max(rs.y, 1e-4);
    if (isFinite(k) && k > 0) this.scaleBy(k);
    const nb = this.box(space);
    const shift = new THREE.Vector3(
      (modelBox.min.x + modelBox.max.x) / 2 - (nb.min.x + nb.max.x) / 2,
      modelBox.min.y - nb.min.y,
      (modelBox.min.z + modelBox.max.z) / 2 - (nb.min.z + nb.max.z) / 2,
    );
    // Moving the top bone moves them all. Convert the shift into its parent's space.
    const top = this.bones[0];
    const p0 = top.getWorldPosition(new THREE.Vector3());
    const p1 = space.localToWorld(space.worldToLocal(p0.clone()).add(shift));
    this._placeAll(top, p1);
    this.initial = this.snapshot();
  }

  _placeAll(bone, world) {
    bone.parent.updateMatrixWorld(true);
    bone.position.copy(bone.parent.worldToLocal(_a.copy(world)));
    this.root.updateMatrixWorld(true);
  }
}

const COLORS = { l: 0x7fe7ff, r: 0xff7fd0, c: 0xffc36a };

// Glowing joints and the bones between them, drawn over the model.
export class SkeletonView {
  constructor(editRig) {
    this.rig = editRig;
    this.group = new THREE.Group();
    this.handles = editRig.handles.map((bone) => {
      const side = editRig.side(bone) || 'c';
      const leaf = isLeaf(bone) || !bone.children.some((c) => c.isBone);
      const m = new THREE.Mesh(
        leaf ? new THREE.OctahedronGeometry(1) : new THREE.SphereGeometry(1, 14, 10),
        new THREE.MeshBasicMaterial({ color: COLORS[side], transparent: true, opacity: 0.85, depthTest: false }),
      );
      m.renderOrder = 10;
      this.group.add(m);
      return { bone, m, side, hover: 0 };
    });
    const pairs = editRig.bones.filter((b) => b.parent?.isBone && b.parent.name !== 'root');
    this.pairs = pairs;
    this.linePos = new Float32Array(pairs.length * 6);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.linePos, 3).setUsage(THREE.DynamicDrawUsage));
    this.lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xdfe6ff, transparent: true, opacity: 0.55, depthTest: false }));
    this.lines.renderOrder = 9;
    this.lines.frustumCulled = false;
    this.group.add(this.lines);
  }

  // `grabbed`, `hovered`: sets of handles; `size`: joint radius in meters.
  update(dt, grabbed, hovered, size) {
    for (const h of this.handles) {
      h.bone.getWorldPosition(h.m.position);
      const twinGrabbed = this.rig.mirror && [...grabbed].some((g) => this.rig.mirrorOf.get(g.bone) === h.bone);
      const target = grabbed.has(h) ? 1 : hovered.has(h) || twinGrabbed ? 0.6 : 0;
      h.hover += (target - h.hover) * Math.min(1, dt * 14);
      h.m.scale.setScalar(size * (1 + h.hover * 0.7));
      h.m.material.opacity = 0.6 + h.hover * 0.4;
    }
    this.pairs.forEach((b, i) => {
      b.parent.getWorldPosition(_a).toArray(this.linePos, i * 6);
      b.getWorldPosition(_a).toArray(this.linePos, i * 6 + 3);
    });
    this.lines.geometry.attributes.position.needsUpdate = true;
  }

  nearest(point, max) {
    let best = null, bestD = max;
    for (const h of this.handles) {
      const d = h.m.position.distanceTo(point);
      if (d < bestD) { bestD = d; best = h; }
    }
    return best;
  }

  nearestToRay(ray, max) {
    let best = null, bestD = max;
    for (const h of this.handles) {
      const d = ray.distanceToPoint(h.m.position);
      if (d < bestD) { bestD = d; best = h; }
    }
    return best;
  }

  dispose() {
    this.group.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
    this.group.removeFromParent();
  }
}
