import * as THREE from 'three';
import { loadGLTF } from '../../rigger/src/model.js';
import { RIGS, rigUrl, animUrls } from '../../rigger/src/rigs.js';
import { headPos, headQuat, handKind, wristPos, wristRot, handJoints, SIDES } from './capture.js';

// From head + hands (+ fingers) to Rigger's Human skeleton (Mesh2Motion's).
// The Quest only tracks those, so:
// - the head drives the neck and spine (leaning, turning) and the head bone;
// - each wrist drives its arm by two-bone IK (elbows bend down and back) and
//   the hand bone's rotation; tracked fingers curl the finger bones;
// - the hips follow under the head (crouching lowers them) and turn with
//   it, slowly;
// - the legs are made up: "planted" feet that step when you move or turn
//   away from them, or the legs of a library clip (idle, walk, jog, crouch).
// Rotations are taken relative to the T-pose you held when calibrating
// (your T-pose = the skeleton's rest pose), so the tracking's own axes never
// matter. Positions are scaled by your eye height against the skeleton's.
// Everything happens on the template skeleton, so a baked take is just like
// a library clip for Rigger.

export const LEGS = [
  { id: 'planted', name: 'Planted' },
  { id: 'idle', name: 'Idle', clip: 'Idle_A' },
  { id: 'walk', name: 'Walk', clip: 'Walk' },
  { id: 'jog', name: 'Jog', clip: 'Jog' },
  { id: 'crouch', name: 'Crouch', clip: 'Crouch_Idle' },
];
const HUMAN = RIGS.find((r) => r.id === 'human');
const LEG_BONES = ['thigh', 'calf', 'foot', 'ball'];
const FINGERS = [['index', 5], ['middle', 10], ['ring', 15], ['pinky', 20]];
const STEP_DIST = 0.22, STEP_TURN = 0.6; // planted feet step when the hips get this far (m) or turn this much (rad) from them
const YAW_FOLLOW = 0.12; // how quickly the body turns after the head (per frame at 30 fps)

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();

function setWorldQuaternion(bone, q) {
  bone.parent.getWorldQuaternion(_q2);
  bone.quaternion.copy(_q2.invert().multiply(q));
  bone.updateMatrixWorld(true);
}

function setWorldPosition(bone, p) {
  bone.parent.updateMatrixWorld(true);
  bone.position.copy(bone.parent.worldToLocal(_a.copy(p)));
  bone.updateMatrixWorld(true);
}

// Turn `bone` so the world direction `from` points along `to` (partly: `t`).
function turnBone(bone, from, to, t = 1) {
  if (from.lengthSq() < 1e-10 || to.lengthSq() < 1e-10) return;
  _q.setFromUnitVectors(_c.copy(from).normalize(), _d.copy(to).normalize());
  if (t < 1) _q.slerp(_q2.identity(), 1 - t);
  setWorldQuaternion(bone, _q.multiply(bone.getWorldQuaternion(new THREE.Quaternion())));
}

const wpos = (b, out = new THREE.Vector3()) => b.getWorldPosition(out);
const wquat = (b) => b.getWorldQuaternion(new THREE.Quaternion());

export class Solver {
  static async load() {
    const { scene } = await loadGLTF(rigUrl(HUMAN));
    return new Solver(scene);
  }

  constructor(armature) {
    this.root = new THREE.Group(); // the solve space: your floor, you facing +z
    this.root.add(armature);
    this.root.updateMatrixWorld(true);
    this.bones = [];
    armature.traverse((o) => o.isBone && this.bones.push(o));
    this.by = new Map(this.bones.map((b) => [b.name, b]));
    this.rest = this.bones.map((b) => ({ p: b.position.clone(), q: b.quaternion.clone() }));
    const B = (n) => this.by.get(n);
    this.pelvis = B('pelvis');
    this.spine = ['spine_01', 'spine_02', 'spine_03'].map(B);
    this.neck = B('neck_01');
    this.head = B('head');
    // rest pose, in the solve space
    this.restW = {};
    for (const b of this.bones) this.restW[b.name] = { p: wpos(b), q: wquat(b) };
    // the skeleton's eyes: a little above and in front of the head bone
    this.eyeRest = wpos(this.head).add(new THREE.Vector3(0, 0.07, 0.09));
    this.eyeToNeck = this.restW.neck_01.p.clone().sub(this.eyeRest);
    this.eyeFloor = new THREE.Vector3(this.eyeRest.x, 0, this.eyeRest.z);
    this.neckToHips = this.restW.pelvis.p.clone().sub(this.restW.neck_01.p).setY(0);
    // Each finger bone bends about the axis across it, toward the palm:
    // worked out from the rest pose (a T-pose, palms down), in its own space.
    this.bendAxis = new Map();
    for (const side of ['l', 'r']) {
      for (const [finger] of [...FINGERS, ['thumb']]) {
        for (let k = 1; k <= 3; k++) {
          const b = this.by.get(`${finger}_0${k}_${side}`), next = this.by.get(`${finger}_0${k + 1}_${side}`) || this.by.get(`${finger}_0${k + 1}_leaf_${side}`);
          if (!b || !next) continue;
          const dir = this.restW[next.name].p.clone().sub(this.restW[b.name].p).normalize();
          const axis = dir.cross(new THREE.Vector3(0, -1, 0)).normalize(); // turns the bone toward the floor
          this.bendAxis.set(b.name, axis.applyQuaternion(this.restW[b.name].q.clone().invert()));
        }
      }
    }
    this.calib = null;
    this.legClips = new Map(); // leg mode → { tracks: [{ bone, interp }], duration }
    this.reset();
  }

  // Start a new sequence (live preview, or baking a take).
  reset() {
    this.yaw = null;
    this.feet = null;
  }

  // ---------- calibration ----------
  // From a frame where you stand straight, looking ahead, arms out to the
  // sides, palms down (a T-pose): your eye height, which way is forward,
  // and how your head and wrists are turned when the skeleton is at rest.
  calibrate(f) {
    const eye = headPos(f);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(headQuat(f));
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    const align = new THREE.Quaternion().setFromUnitVectors(fwd, new THREE.Vector3(0, 0, 1)); // your forward → the skeleton's (+z)
    const c = {
      origin: [eye.x, 0, eye.z],
      align: align.toArray(),
      scale: this.eyeRest.y / Math.max(0.5, eye.y),
      height: eye.y + 0.11, // eyes to the top of the head, roughly
      head: align.clone().multiply(headQuat(f)).toArray(),
      wrist: {},
      curl: {},
    };
    for (const side of SIDES) {
      const k = handKind(f, side);
      if (!k) continue;
      c.wrist[side] = align.clone().multiply(wristRot(f, side)).toArray();
      if (k === 1) c.curl[side] = curls(handJoints(f, side));
    }
    // Your shoulders, guessed from your wrists: as far in from them as the
    // skeleton's are from its hands, scaled by how your arm span compares
    // (in solve space, kept relative to your neck). Hands then reach from
    // your shoulders, so long or short arms still meet the skeleton's.
    if (handKind(f, 'left') && handKind(f, 'right')) {
      const at = (p) => p.sub(new THREE.Vector3().fromArray(c.origin)).applyQuaternion(align).multiplyScalar(c.scale).add(this.eyeFloor);
      const wl = at(wristPos(f, 'left')), wr = at(wristPos(f, 'right'));
      const restL = this.restW.hand_l.p, restR = this.restW.hand_r.p;
      const span = wl.distanceTo(wr) / restL.distanceTo(restR);
      const mid = wl.clone().add(wr).multiplyScalar(0.5), restMid = restL.clone().add(restR).multiplyScalar(0.5);
      const neck = at(eye.clone()).add(this.eyeToNeck);
      c.reach = 1 / Math.max(0.5, span);
      c.shoulder = {};
      for (const s of ['l', 'r']) {
        const sh = this.restW[`upperarm_${s}`].p.clone().sub(restMid).multiplyScalar(span).add(mid);
        c.shoulder[s] = sh.sub(neck).toArray();
      }
    }
    return c;
  }

  use(calib) {
    this.calib = calib;
    this.c = {
      origin: new THREE.Vector3().fromArray(calib.origin),
      align: new THREE.Quaternion().fromArray(calib.align),
      scale: calib.scale,
      headInv: new THREE.Quaternion().fromArray(calib.head).invert(),
      wristInv: Object.fromEntries(Object.entries(calib.wrist).map(([s, q]) => [s, new THREE.Quaternion().fromArray(q).invert()])),
      curl: calib.curl,
      reach: calib.reach || 1,
      shoulder: calib.shoulder && { l: new THREE.Vector3().fromArray(calib.shoulder.l), r: new THREE.Vector3().fromArray(calib.shoulder.r) },
    };
  }

  // room → solve space (where your eyes were at calibration is where the
  // skeleton's eyes are, over the floor)
  toSolve(p, out = new THREE.Vector3()) {
    return out.copy(p).sub(this.c.origin).applyQuaternion(this.c.align).multiplyScalar(this.c.scale).add(this.eyeFloor);
  }

  // How much a tracked rotation has turned since the T-pose, in the solve space.
  relRot(q, inv) {
    return _q.copy(this.c.align).multiply(q).multiply(inv).clone();
  }

  // ---------- leg clips ----------
  async loadLegs(mode) {
    const leg = LEGS.find((l) => l.id === mode);
    if (!leg?.clip || this.legClips.has(mode)) return;
    for (const url of animUrls(HUMAN)) {
      const { animations } = await loadGLTF(url);
      const clip = animations.find((a) => a.name === leg.clip);
      if (!clip) continue;
      const tracks = clip.tracks
        .filter((t) => t.name.endsWith('.quaternion') && LEG_BONES.some((n) => t.name.startsWith(n)))
        .map((t) => ({ bone: this.by.get(t.name.slice(0, -11)), interp: t.createInterpolant() }))
        .filter((t) => t.bone);
      this.legClips.set(mode, { tracks, duration: clip.duration });
      return;
    }
  }

  // ---------- one frame ----------
  // Pose the skeleton from frame `f`, at time `t` (s, for the leg clips).
  pose(f, t = 0, legs = 'planted') {
    if (!this.c) return;
    this.bones.forEach((b, i) => {
      b.position.copy(this.rest[i].p);
      b.quaternion.copy(this.rest[i].q);
    });
    this.root.updateMatrixWorld(true);

    // head and body facing
    const eye = this.toSolve(headPos(f));
    const head = this.relRot(headQuat(f), this.c.headInv);
    const headYaw = new THREE.Euler().setFromQuaternion(head, 'YXZ').y;
    if (this.yaw === null) this.yaw = headYaw;
    let dy = headYaw - this.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yaw += dy * YAW_FOLLOW;
    const yawQ = new THREE.Quaternion().setFromAxisAngle(UP, this.yaw);
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(yawQ);

    // hips: under the neck, dropping as much as your eyes do (crouching)
    const neckTarget = eye.clone().add(this.eyeToNeck.clone().applyQuaternion(head));
    const restHips = this.restW.pelvis;
    const drop = Math.min(0, eye.y - this.eyeRest.y);
    const hips = new THREE.Vector3(neckTarget.x, Math.max(restHips.p.y * 0.4, restHips.p.y + drop), neckTarget.z).add(this.neckToHips.clone().applyQuaternion(yawQ));
    setWorldPosition(this.pelvis, hips);
    setWorldQuaternion(this.pelvis, yawQ.clone().multiply(restHips.q));

    // spine: bend so the neck reaches its target, spread over three bones
    this.spine.forEach((b, i) => {
      b.updateMatrixWorld(true);
      const from = wpos(this.neck).sub(wpos(b)), to = neckTarget.clone().sub(wpos(b));
      turnBone(b, from, to, 1 / (this.spine.length - i));
    });
    setWorldQuaternion(this.head, head.clone().multiply(this.restW.head.q));

    // arms and hands
    for (const side of SIDES) {
      const s = side[0];
      const kind = handKind(f, side);
      if (!kind || !this.c.wristInv[side]) continue;
      const upper = this.by.get(`upperarm_${s}`), lower = this.by.get(`lowerarm_${s}`), hand = this.by.get(`hand_${s}`);
      let target = this.toSolve(wristPos(f, side));
      if (this.c.shoulder) {
        // from your shoulder (it follows your neck and turns with you) to
        // the skeleton's, scaled to its arm
        const yours = this.c.shoulder[s].clone().applyQuaternion(yawQ).add(neckTarget);
        target = wpos(upper).add(target.sub(yours).multiplyScalar(this.c.reach));
      }
      const out = new THREE.Vector3(side === 'left' ? 1 : -1, 0, 0).applyQuaternion(yawQ);
      const pole = new THREE.Vector3(0, -1, 0).addScaledVector(fwd, -0.5).addScaledVector(out, 0.3);
      twoBoneIK(upper, lower, hand, target, pole);
      const rot = this.relRot(wristRot(f, side), this.c.wristInv[side]);
      setWorldQuaternion(hand, rot.multiply(this.restW[`hand_${s}`].q));
      if (kind === 1) this._fingers(side, handJoints(f, side));
    }

    // legs
    const clip = this.legClips.get(legs);
    if (clip) {
      const tt = clip.duration ? t % clip.duration : 0;
      for (const { bone, interp } of clip.tracks) bone.quaternion.fromArray(interp.evaluate(tt));
      this.pelvis.updateMatrixWorld(true);
    } else this._plant(hips, yawQ, fwd);
  }

  // Finger bones curl as much as your fingers do (beyond how curled they
  // were in the T-pose), at each of their three joints; the thumb at two.
  _fingers(side, joints) {
    const s = side[0];
    const now = curls(joints), base = this.c.curl[side] || {};
    const apply = (name, angle) => {
      const b = this.by.get(name), axis = this.bendAxis.get(name);
      if (b && axis) b.quaternion.multiply(_q.setFromAxisAngle(axis, Math.max(0, angle)));
    };
    for (const [finger] of FINGERS) {
      const c = now[finger], c0 = base[finger] || [0, 0, 0];
      for (let k = 0; k < 3; k++) apply(`${finger}_0${k + 1}_${s}`, c[k] - c0[k]);
    }
    const c = now.thumb, c0 = base.thumb || [0, 0];
    apply(`thumb_02_${s}`, c[0] - c0[0]);
    apply(`thumb_03_${s}`, c[1] - c0[1]);
    this.root.updateMatrixWorld(true);
  }

  // Planted feet: they stay where they are until the hips have moved or
  // turned too far from them, then both step to where they'd be under the
  // hips (eased over a few frames).
  _plant(hips, yawQ, fwd) {
    const restHips = this.restW.pelvis.p;
    const footAt = (s) => {
      const r = this.restW[`foot_${s}`].p.clone().sub(restHips);
      r.y = 0;
      return hips.clone().setY(0).add(r.applyQuaternion(yawQ)).setY(this.restW[`foot_${s}`].p.y);
    };
    if (!this.feet) this.feet = { l: footAt('l'), r: footAt('r'), goal: null, yaw: this.yaw };
    const mid = this.feet.l.clone().add(this.feet.r).multiplyScalar(0.5);
    const far = Math.hypot(mid.x - hips.x, mid.z - hips.z) > STEP_DIST;
    let turn = this.yaw - this.feet.yaw;
    turn = Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn)));
    if (!this.feet.goal && (far || turn > STEP_TURN)) this.feet.goal = { l: footAt('l'), r: footAt('r'), yaw: this.yaw };
    if (this.feet.goal) {
      const g = this.feet.goal;
      this.feet.l.lerp(g.l, 0.3);
      this.feet.r.lerp(g.r, 0.3);
      if (this.feet.l.distanceTo(g.l) < 0.01 && this.feet.r.distanceTo(g.r) < 0.01) {
        this.feet.yaw = g.yaw;
        this.feet.goal = null;
      }
    }
    const footYaw = new THREE.Quaternion().setFromAxisAngle(UP, this.feet.goal ? this.feet.goal.yaw : this.feet.yaw);
    for (const s of ['l', 'r']) {
      const thigh = this.by.get(`thigh_${s}`), calf = this.by.get(`calf_${s}`), foot = this.by.get(`foot_${s}`);
      twoBoneIK(thigh, calf, foot, this.feet[s], fwd); // knees forward
      setWorldQuaternion(foot, footYaw.clone().multiply(this.restW[`foot_${s}`].q));
    }
  }

  // The current pose, for a frame of a clip: every bone's local rotation and
  // the hips' local position.
  snapshot() {
    return { q: this.bones.map((b) => b.quaternion.toArray()), hips: this.pelvis.position.toArray() };
  }

  // A whole take as a clip, frame by frame (`frames` already cleaned).
  bake(name, frames, fps, legs = 'planted') {
    this.reset();
    const n = frames.length, times = new Float32Array(n), qs = this.bones.map(() => new Float32Array(n * 4)), hp = new Float32Array(n * 3);
    frames.forEach((f, i) => {
      times[i] = i / fps;
      this.pose(f, i / fps, legs);
      this.bones.forEach((b, k) => b.quaternion.toArray(qs[k], i * 4));
      this.pelvis.position.toArray(hp, i * 3);
    });
    const tracks = this.bones.map((b, k) => new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, times, qs[k]));
    tracks.push(new THREE.VectorKeyframeTrack(`${this.pelvis.name}.position`, times, hp));
    this.reset();
    return new THREE.AnimationClip(name, n / fps, tracks);
  }
}

// How bent each finger is at each joint (radians): the angle between one
// segment and the next. Fingers: knuckle, middle, end joint; thumb: two.
function curls(joints) {
  const P = (k) => new THREE.Vector3(joints[k * 3], joints[k * 3 + 1], joints[k * 3 + 2]);
  const seg = (a, b) => P(b).sub(P(a));
  const out = {};
  for (const [finger, k] of FINGERS) {
    const s = [seg(k, k + 1), seg(k + 1, k + 2), seg(k + 2, k + 3), seg(k + 3, k + 4)];
    out[finger] = [s[0].angleTo(s[1]), s[1].angleTo(s[2]), s[2].angleTo(s[3])];
  }
  const t = [seg(1, 2), seg(2, 3), seg(3, 4)];
  out.thumb = [t[0].angleTo(t[1]), t[1].angleTo(t[2])];
  return out;
}

// Two-bone IK: put `end`'s joint at `target`, bending the middle joint
// toward `pole` (a direction).
function twoBoneIK(upper, lower, end, target, pole) {
  const A = wpos(upper), B = wpos(lower), C = wpos(end);
  const l1 = B.distanceTo(A), l2 = C.distanceTo(B);
  if (l1 < 1e-6 || l2 < 1e-6) return;
  const toT = target.clone().sub(A);
  const dist = THREE.MathUtils.clamp(toT.length(), Math.abs(l1 - l2) + 1e-4, l1 + l2 - 1e-4);
  const dir = toT.normalize();
  const bend = pole.clone().addScaledVector(dir, -pole.dot(dir));
  if (bend.lengthSq() < 1e-8) return;
  bend.normalize();
  const cosA = (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const newB = A.clone().addScaledVector(dir, l1 * cosA).addScaledVector(bend, l1 * sinA);
  const newC = A.clone().addScaledVector(dir, dist);
  turnBone(upper, B.clone().sub(A), newB.clone().sub(A));
  const B2 = wpos(lower), C2 = wpos(end);
  turnBone(lower, C2.sub(B2), newC.sub(B2));
}
