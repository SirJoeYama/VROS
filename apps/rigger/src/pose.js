import * as THREE from 'three';

// Posing the rigged model frame by frame, like Marionette, on whatever
// skeleton it has:
// - amber spheres sit at joints and bend the bone behind them (FK); what's
//   further down follows;
// - diamonds past each hand and foot: IK (cyan) places the hand/foot and the
//   elbow/knee bends to follow, keeping the hand/foot's orientation; FK
//   (amber) turns the hand/foot itself. HANDS and FEET switch each;
// - the magenta cube moves the hips with the feet planted;
// - the white ring on the floor moves the whole body.
// Frames are poses (every bone's rotation + the hips' offset), played back
// stepped or smoothly, and turned into an AnimationClip to export.

const FPS_STEPS = [4, 6, 8, 12, 24, 30];
const AMBER = 0xffc36a, CYAN = 0x7fe7ff, MAGENTA = 0xff5fd2, WHITE = 0xffffff;
const RING_R = 0.045;

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

// hand_l, Foot_L, Back_Leg_Foot_L, front_foot_l (not Back_Leg_Foot_1_L)
const END = /(^|_)(hand|foot)(_[lr])?$/i;

function setWorldQuaternion(bone, q) {
  bone.parent.getWorldQuaternion(_q2);
  bone.quaternion.copy(_q2.invert().multiply(q));
  bone.updateMatrixWorld(true);
}

function turnBone(bone, from, to) {
  if (from.lengthSq() < 1e-12 || to.lengthSq() < 1e-12) return;
  _q.setFromUnitVectors(from.clone().normalize(), to.clone().normalize());
  setWorldQuaternion(bone, _q.multiply(bone.getWorldQuaternion(new THREE.Quaternion())));
}

const isBone = (o) => o?.isBone;
const isTip = (b) => /tip|leaf/i.test(b.name);

export class Poser {
  // `rigged`: the Rigged model; `editRig`: its fitted skeleton (the rest pose).
  constructor(rigged, editRig) {
    this.rigged = rigged;
    this.rig = editRig.rig;
    this.bones = rigged.bones;
    this.armature = rigged.armature;
    this.track = this.bones[editRig.bones.indexOf(editRig.trackBone)];
    this.restQ = editRig.bones.map((b) => b.quaternion.clone());
    this.restTrack = editRig.trackBone.position.clone();
    this.key = `vros.rigger.frames.${this.rig.id}`;
    this._restore();

    // Limbs: a hand or foot, its two parents as the IK chain.
    const ends = this.bones.filter((b) =>
      isBone(b.parent) && isBone(b.parent.parent) &&
      (END.test(b.name) || (/leg/i.test(b.name) && b.children.filter(isBone).length === 1 && b.children.every((c) => !isBone(c) || isTip(c)))));
    this.limbs = ends
      .filter((e) => !ends.some((o) => o !== e && isAncestor(o, e)))
      .filter((e) => ![e.parent, e.parent.parent].some((b) => b === this.track || b.name === 'root'))
      .map((end) => {
        const kids = end.children.filter(isBone);
        const tip = new THREE.Vector3();
        if (kids.length) {
          for (const k of kids) tip.add(k.position);
          tip.divideScalar(kids.length);
          const len = tip.length();
          if (len > 1e-6) tip.multiplyScalar((len + end.position.length() * 0.15) / len); // just past the knuckles / toes
        } else tip.copy(end.position).multiplyScalar(0.35);
        const type = /hand|front/i.test(end.name) ? 'hand' : 'foot';
        return { end, lower: end.parent, upper: end.parent.parent, tip, type, pole: type === 'hand' ? [0, 0, -1] : [0, 0, 1] };
      });
    const endSet = new Set(this.limbs.map((l) => l.end));

    this.handles = [];
    // FK: a joint's handle turns the bone that ends there. Skip what the
    // diamonds already cover (fingers, toes) and the root.
    for (const b of this.bones) {
      const p = b.parent;
      if (!isBone(p) || p.name === 'root' || endSet.has(p) || isAncestorInSet(p, endSet)) continue;
      this.handles.push({ type: 'fk', bone: b, rotates: p });
    }
    for (const l of this.limbs) this.handles.push({ type: 'end', bone: l.end, limb: l });
    this.handles.push({ type: 'hip', bone: this.track }, { type: 'move', bone: this.track });

    this._buildView();
  }

  // ---------- poses and frames ----------
  getPose() {
    const rot = {};
    for (const b of this.bones) rot[b.name] = b.quaternion.toArray().map((v) => +v.toFixed(5));
    const d = this.track.position.clone().sub(this.restTrack);
    return { rot, track: d.toArray().map((v) => +v.toFixed(5)) };
  }

  setPose(pose, bones = this.bones, track = this.track) {
    bones.forEach((b, i) => {
      const q = pose.rot[b.name];
      if (q) b.quaternion.fromArray(q);
      else b.quaternion.copy(this.restQ[i]);
    });
    track.position.copy(this.restTrack).add(_a.fromArray(pose.track || [0, 0, 0]));
    bones[0].parent.updateMatrixWorld(true);
  }

  restPose() {
    const rot = {};
    this.bones.forEach((b, i) => (rot[b.name] = this.restQ[i].toArray()));
    return { rot, track: [0, 0, 0] };
  }

  get pose() {
    return this.frames[this.current];
  }

  commit() {
    this._record();
    this.frames[this.current] = this.getPose();
    this._changed();
  }

  // ---------- undo ----------
  // A snapshot of the frames before each change.
  _record() {
    this.past.push({ frames: structuredClone(this.frames), current: this.current });
    if (this.past.length > 100) this.past.shift();
    this.future.length = 0;
  }

  // Both return true if they changed something.
  undo() {
    return this._swap(this.past, this.future);
  }

  redo() {
    return this._swap(this.future, this.past);
  }

  _swap(from, to) {
    const s = from.pop();
    if (!s) return false;
    this.stop();
    to.push({ frames: structuredClone(this.frames), current: this.current });
    this.frames = s.frames;
    this.current = Math.min(s.current, this.frames.length - 1);
    this.setPose(this.pose);
    this._changed();
    return true;
  }

  show() {
    this.playing = false;
    this.rigged.stop(); // whatever 4 ANIMATE was playing
    this.setPose(this.pose);
  }

  go(i) {
    const n = this.frames.length;
    this.stop();
    this.current = ((i % n) + n) % n;
    this.setPose(this.pose);
    this._changed();
  }

  addFrame() {
    this.stop();
    this._record();
    this.frames.splice(this.current + 1, 0, structuredClone(this.pose));
    this.current++;
    this._changed();
  }

  deleteFrame() {
    if (this.frames.length === 1) return;
    this.stop();
    this._record();
    this.frames.splice(this.current, 1);
    this.current = Math.min(this.current, this.frames.length - 1);
    this.setPose(this.pose);
    this._changed();
  }

  clear() {
    this.stop();
    this._record();
    this.frames = [this.restPose()];
    this.current = 0;
    this.setPose(this.pose);
    this._changed();
  }

  resetPose() {
    this.stop();
    this.setPose(this.restPose());
    this.commit();
  }

  // Copy a library clip's pose at time `t` into this frame.
  useClipPose(clip, t) {
    this.stop();
    this._record();
    this.rigged.sample(clip, t, () => (this.frames[this.current] = this.getPose()));
    this.setPose(this.pose);
    this._changed();
  }

  toggleMode(type) {
    this.modes[type] = this.modes[type] === 'ik' ? 'fk' : 'ik';
    this._changed();
  }

  toggleOnion() {
    this.onion = !this.onion;
    this._changed();
  }

  toggleSmooth() {
    this.smooth = !this.smooth;
    this._changed();
  }

  cycleFps() {
    this.fps = FPS_STEPS[(FPS_STEPS.indexOf(this.fps) + 1) % FPS_STEPS.length] || 8;
    this._changed();
  }

  // ---------- playback ----------
  togglePlay() {
    if (this.playing) this.stop();
    else if (this.frames.length > 1) {
      this.playing = true;
      this.rigged.play(this.clip('preview'));
    }
  }

  stop() {
    if (!this.playing) return;
    this.playing = false;
    this.rigged.stop();
    this.setPose(this.pose);
  }

  get playFrame() {
    const a = this.rigged.action;
    return this.playing && a ? Math.min(this.frames.length - 1, Math.floor(a.time * this.fps)) : this.current;
  }

  // The frames as a clip: one key per frame, stepped or interpolated. The
  // last frame is keyed again at the end so it keeps its full length (a GLB
  // clip lasts until its last key).
  clip(name) {
    return this.clipFrom({ name, frames: this.frames, fps: this.fps, smooth: this.smooth });
  }

  // A clip from saved frames (see saved()).
  clipFrom({ name, frames: saved, fps, smooth }) {
    const n = saved.length, dt = 1 / fps;
    const frames = [...saved, saved[n - 1]];
    const times = frames.map((_, i) => i * dt);
    const interp = smooth ? THREE.InterpolateLinear : THREE.InterpolateDiscrete;
    const tracks = this.bones.map((b, i) => {
      const v = [];
      for (const f of frames) v.push(...(f.rot[b.name] || this.restQ[i].toArray()));
      const t = new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, times, v);
      t.setInterpolation(interp);
      return t;
    });
    const pv = [];
    for (const f of frames) pv.push(...this.restTrack.clone().add(_a.fromArray(f.track || [0, 0, 0])).toArray());
    const pt = new THREE.VectorKeyframeTrack(`${this.track.name}.position`, times, pv);
    pt.setInterpolation(interp);
    tracks.push(pt);
    const clip = new THREE.AnimationClip(name, n * dt, tracks);
    clip.custom = true; // made on this skeleton: no retargeting
    return clip;
  }

  // What SAVE AS CLIP keeps, so the clip can be rebuilt after a reload.
  saved(name) {
    return { name, frames: structuredClone(this.frames), fps: this.fps, smooth: this.smooth };
  }

  // ---------- handles ----------
  handlePosition(h, out = new THREE.Vector3()) {
    if (h.type === 'fk' || h.type === 'hip') return h.bone.getWorldPosition(out);
    if (h.type === 'end') return h.bone.localToWorld(out.copy(h.limb.tip));
    // the ring: on the floor under the hips
    h.bone.getWorldPosition(out);
    this.armature.getWorldPosition(_d);
    _b.copy(out).sub(_d);
    const up = _c.copy(UP).applyQuaternion(this.armature.getWorldQuaternion(_q2));
    return out.addScaledVector(up, -_b.dot(up));
  }

  beginDrag(h, point) {
    const d = { h, start: point.clone() };
    if (h.type === 'move' || h.type === 'hip') {
      d.world = this.track.getWorldPosition(new THREE.Vector3());
      if (h.type === 'hip') {
        d.feet = this.limbs.filter((l) => l.type === 'foot').map((l) => ({ l, pos: l.end.getWorldPosition(new THREE.Vector3()), q: l.end.getWorldQuaternion(new THREE.Quaternion()) }));
      }
    } else if (h.type === 'fk' || this.modes[h.limb.type] === 'fk') {
      d.mode = 'fk';
      d.bone = h.type === 'fk' ? h.rotates : h.bone;
      d.joint = d.bone.getWorldPosition(new THREE.Vector3());
      d.from = this.handlePosition(h).sub(d.joint);
      d.offset = this.handlePosition(h).sub(point);
      d.startQ = d.bone.getWorldQuaternion(new THREE.Quaternion());
    } else {
      d.mode = 'ik';
      d.endQ = h.bone.getWorldQuaternion(new THREE.Quaternion());
      d.offset = h.bone.getWorldPosition(new THREE.Vector3()).sub(point);
    }
    return d;
  }

  drag(d, point) {
    const h = d.h;
    if (h.type === 'move' || h.type === 'hip') {
      const delta = _a.copy(point).sub(d.start);
      if (h.type === 'move') {
        const up = _c.copy(UP).applyQuaternion(this.armature.getWorldQuaternion(_q2));
        delta.addScaledVector(up, -delta.dot(up));
      }
      this.track.parent.updateMatrixWorld(true);
      this.track.position.copy(this.track.parent.worldToLocal(_b.copy(d.world).add(delta)));
      this.track.updateMatrixWorld(true);
      for (const { l, pos, q } of d.feet || []) {
        this.solveIK(l, pos);
        setWorldQuaternion(l.end, q);
      }
    } else if (d.mode === 'fk') {
      const to = _a.copy(point).add(d.offset).sub(d.joint);
      if (to.lengthSq() < 1e-10) return;
      _q.setFromUnitVectors(_b.copy(d.from).normalize(), to.normalize());
      setWorldQuaternion(d.bone, _q.multiply(d.startQ));
    } else {
      this.solveIK(h.limb, _c.copy(point).add(d.offset));
      setWorldQuaternion(h.bone, d.endQ);
    }
  }

  // Two-bone IK: put the hand/foot's joint at `target`, bending the elbow or
  // knee in the plane it already bends in (or the natural way when straight).
  solveIK(l, target) {
    const A = l.upper.getWorldPosition(new THREE.Vector3());
    const B = l.lower.getWorldPosition(new THREE.Vector3());
    const C = l.end.getWorldPosition(new THREE.Vector3());
    const l1 = B.distanceTo(A), l2 = C.distanceTo(B);
    if (l1 < 1e-6 || l2 < 1e-6) return;
    const toT = _a.copy(target).sub(A);
    const dist = THREE.MathUtils.clamp(toT.length(), Math.abs(l1 - l2) + 1e-5, l1 + l2 - 1e-5);
    const dir = toT.normalize();
    const bend = _b.copy(B).sub(A);
    bend.addScaledVector(dir, -bend.dot(dir));
    if (bend.lengthSq() < 1e-10 * l1 * l1) {
      bend.set(...l.pole).applyQuaternion(this.armature.getWorldQuaternion(_q2));
      bend.addScaledVector(dir, -bend.dot(dir));
    }
    bend.normalize();
    const cosA = (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist);
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    const newB = new THREE.Vector3().copy(A).addScaledVector(dir, l1 * cosA).addScaledVector(bend, l1 * sinA);
    const newC = new THREE.Vector3().copy(A).addScaledVector(dir, dist);
    turnBone(l.upper, B.clone().sub(A), newB.clone().sub(A));
    const B2 = l.lower.getWorldPosition(new THREE.Vector3());
    const C2 = l.end.getWorldPosition(new THREE.Vector3());
    turnBone(l.lower, C2.sub(B2), newC.sub(B2));
  }

  nearest(point, max) {
    let best = null, bestD = max;
    for (const v of this.view) {
      const d = this._distance(v, point);
      if (d < bestD) { bestD = d; best = v; }
    }
    return best;
  }

  nearestToRay(ray, max) {
    let best = null, bestD = max;
    for (const v of this.view) {
      let d;
      if (v.h.type === 'move') {
        const hit = ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(_c.copy(UP), v.m.position), new THREE.Vector3());
        d = hit ? this._distance(v, hit) : Infinity;
      } else d = ray.distanceToPoint(v.m.position);
      if (d < bestD) { bestD = d; best = v; }
    }
    return best;
  }

  // The ring counts anywhere along its rim.
  _distance(v, p) {
    if (v.h.type !== 'move') return v.m.position.distanceTo(p);
    const rel = _a.copy(p).sub(v.m.position);
    const height = rel.dot(UP);
    return Math.hypot(rel.addScaledVector(UP, -height).length() - RING_R * (this.k || 1), height);
  }

  // ---------- the view: handles and onion-skin skeletons ----------
  _buildView() {
    this.group = new THREE.Group();
    this.view = this.handles.map((h) => {
      const geo = { end: () => new THREE.OctahedronGeometry(1.4), hip: () => new THREE.BoxGeometry(2.2, 2.2, 2.2), move: () => new THREE.TorusGeometry(RING_R, 0.004, 8, 48) }[h.type]?.() || new THREE.SphereGeometry(1, 14, 10);
      const color = { hip: MAGENTA, move: WHITE }[h.type] || AMBER;
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthTest: false }));
      m.renderOrder = 10;
      this.group.add(m);
      return { h, m, hover: 0 };
    });

    // A second, invisible skeleton to pose the ghosts and thumbnails with.
    this.measure = this.armature.clone(true);
    this.measure.visible = false;
    this.armature.parent.add(this.measure);
    this.mBones = [];
    this.measure.traverse((o) => o.isBone && this.mBones.push(o));
    this.mTrack = this.mBones[this.bones.indexOf(this.track)];
    this.segments = [];
    this.bones.forEach((b, i) => {
      if (isBone(b.parent) && b.parent.name !== 'root') this.segments.push([this.bones.indexOf(b.parent), i]);
    });
    this.ghosts = [0xff5050, 0x50b4ff].map((color) => {
      const pos = new Float32Array(this.segments.length * 6);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
      const line = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.7, depthTest: false }));
      line.frustumCulled = false;
      line.renderOrder = 8;
      this.group.add(line);
      return { line, pos, frame: null };
    });

    // Thumbnail view: front for upright creatures, side for long ones, top
    // for flat ones (snakes).
    const j = this._joints(this.restPose());
    const box = new THREE.Box3().setFromPoints(j);
    const s = box.getSize(new THREE.Vector3());
    this.axes = s.y < 0.35 * Math.max(s.x, s.z) ? ['x', 'z', -1] : s.z > s.x ? ['z', 'y', 1] : ['x', 'y', 1];
    const [u, v, sign] = this.axes;
    this.thumbBox = { u0: (box.min[u] + box.max[u]) / 2, v0: sign > 0 ? box.min[v] : box.max[v], k: 1 / Math.max(s[u], s[v], 1e-6) };
    this.thumbCache = new WeakMap();
  }

  // Joint positions for a pose, in the rigged group's space.
  _joints(pose) {
    this.setPose(pose, this.mBones, this.mTrack);
    const inv = new THREE.Matrix4().copy(this.rigged.group.matrixWorld).invert();
    return this.mBones.map((b) => b.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv));
  }

  // Stick figure for the timeline cell: segments in [-0.5, 0.5] × [0, 1].
  thumb(i) {
    const f = this.frames[i];
    let segs = this.thumbCache.get(f);
    if (segs) return segs;
    const j = this._joints(f);
    const [u, v, sign] = this.axes, { u0, v0, k } = this.thumbBox;
    const P = (p) => [(p[u] - u0) * k, (p[v] - v0) * k * sign];
    segs = this.segments.map(([a, b]) => [...P(j[a]), ...P(j[b])]);
    this.thumbCache.set(f, segs);
    return segs;
  }

  // `grabbed`, `hovered`: sets of view entries; `size`: joint radius (m);
  // `k`: your size in the world (for the ring).
  update(dt, grabbed, hovered, size, k = 1) {
    this.k = k;
    for (const v of this.view) {
      this.handlePosition(v.h, v.m.position);
      if (v.h.type === 'end') v.m.material.color.setHex(this.modes[v.h.limb.type] === 'ik' ? CYAN : AMBER);
      if (v.h.type === 'move') v.m.quaternion.setFromAxisAngle(_a.set(1, 0, 0), Math.PI / 2);
      const target = grabbed.has(v) ? 1 : hovered.has(v) ? 0.6 : 0;
      v.hover += (target - v.hover) * Math.min(1, dt * 14);
      v.m.scale.setScalar(v.h.type === 'move' ? k * (1 + v.hover * 0.2) : size * (1 + v.hover * 0.7));
      v.m.material.opacity = 0.55 + v.hover * 0.45;
      v.m.visible = !this.playing;
    }
    // onion skin: the previous (red) and next (blue) frames
    const n = this.frames.length;
    const show = this.onion && !this.playing && n > 1;
    [this.current - 1, this.current + 1].forEach((i, k) => {
      const g = this.ghosts[k];
      g.line.visible = show && i >= 0 && i < n;
      if (!g.line.visible) return;
      if (g.frame !== this.frames[i]) {
        g.frame = this.frames[i];
        this.setPose(g.frame, this.mBones, this.mTrack);
        this.segments.forEach(([a, b], s) => {
          this.mBones[a].getWorldPosition(_a).toArray(g.pos, s * 6);
          this.mBones[b].getWorldPosition(_a).toArray(g.pos, s * 6 + 3);
        });
        g.line.geometry.attributes.position.needsUpdate = true;
      }
    });
    // the ghosts are drawn in world space: follow the stage if it moved
    const m = this.rigged.group.matrixWorld;
    if (this._ghostMatrix && !this._ghostMatrix.equals(m)) for (const g of this.ghosts) g.frame = null;
    this._ghostMatrix = m.clone();
  }

  dispose() {
    this.stop();
    this.group.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
    this.group.removeFromParent();
    this.measure.removeFromParent();
  }

  // ---------- saving ----------
  _restore() {
    this.frames = [];
    this.current = 0;
    this.fps = 8;
    this.onion = true;
    this.smooth = true;
    this.modes = { hand: 'ik', foot: 'ik' };
    this.playing = false;
    this.version = 0;
    this.past = [];
    this.future = [];
    try {
      const s = JSON.parse(localStorage.getItem(this.key) || 'null');
      if (s?.frames?.length) Object.assign(this, { frames: s.frames, fps: s.fps || 8, smooth: s.smooth ?? true });
    } catch {}
    if (!this.frames.length) this.frames = [this.restPose()];
  }

  _changed() {
    this.version++;
    try {
      localStorage.setItem(this.key, JSON.stringify({ frames: this.frames, fps: this.fps, smooth: this.smooth }));
    } catch {}
  }
}

function isAncestor(a, b) {
  for (let p = b.parent; p; p = p.parent) if (p === a) return true;
  return false;
}

function isAncestorInSet(b, set) {
  for (let p = b.parent; p; p = p.parent) if (set.has(p)) return true;
  return false;
}
