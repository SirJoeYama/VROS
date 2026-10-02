import * as THREE from 'three';

// One captured frame, packed in a Float32Array:
//   head: position (3) and orientation (4)
//   then for the left and the right hand:
//     kind (0 = not tracked, 1 = hand, 2 = controller), wrist position (3)
//     and orientation (4), and the 25 hand joints (75; hands only).
// Everything is in the room's own space (local-floor), in meters.
export const FPS = 30;
export const HEAD = 0, HAND = 7, HAND_SIZE = 1 + 7 + 75;
export const FRAME = 7 + 2 * HAND_SIZE;
export const SIDES = ['left', 'right'];
export const handOffset = (side) => HAND + (side === 'left' ? 0 : HAND_SIZE);

const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _m = new THREE.Matrix4();
const j = (a, k, out) => out.set(a[k * 3], a[k * 3 + 1], a[k * 3 + 2]);

// The wrist's orientation, from where the knuckles are: y along the hand
// (wrist → middle knuckle), x across it (pinky → index knuckle), z out of it.
// Only ever compared with itself (relative to the T-pose), so its exact
// convention doesn't matter.
export function wristQuat(joints, out = new THREE.Quaternion()) {
  const w = j(joints, 0, new THREE.Vector3());
  j(joints, 11, _y).sub(w).normalize();
  j(joints, 6, _x).sub(j(joints, 21, _z));
  _x.addScaledVector(_y, -_x.dot(_y)).normalize();
  _z.crossVectors(_x, _y);
  return out.setFromRotationMatrix(_m.makeBasis(_x, _y, _z));
}

// Fill `f` (a Float32Array of FRAME) from the viewer and the tracked hands.
export function capture(f, viewer, hands) {
  f.fill(0);
  const p = viewer.getWorldPosition(new THREE.Vector3()), q = viewer.getWorldQuaternion(new THREE.Quaternion());
  p.toArray(f, HEAD);
  q.toArray(f, HEAD + 3);
  for (const side of SIDES) {
    const h = hands.find((x) => x.handedness === side && x.kind !== 'mouse');
    if (!h) continue;
    const o = handOffset(side);
    if (h.kind === 'hand' && h.jointCount === 25) {
      f[o] = 1;
      f[o + 1] = h.joints[0]; f[o + 2] = h.joints[1]; f[o + 3] = h.joints[2];
      wristQuat(h.joints).toArray(f, o + 4);
      f.set(h.joints, o + 8);
    } else if (h.kind === 'controller') {
      f[o] = 2;
      h.pinchPoint.toArray(f, o + 1);
      h.quat.toArray(f, o + 4);
    }
  }
  return f;
}

// Read parts of a frame back.
export const headPos = (f, out = new THREE.Vector3()) => out.fromArray(f, HEAD);
export const headQuat = (f, out = new THREE.Quaternion()) => out.fromArray(f, HEAD + 3);
export const handKind = (f, side) => f[handOffset(side)];
export const wristPos = (f, side, out = new THREE.Vector3()) => out.fromArray(f, handOffset(side) + 1);
export const wristRot = (f, side, out = new THREE.Quaternion()) => out.fromArray(f, handOffset(side) + 4);
export const handJoints = (f, side) => f.subarray(handOffset(side) + 8, handOffset(side) + 8 + 75);

// Clean a recording before it's turned into animation:
// - gaps where a hand wasn't tracked (out of view, behind your back) are
//   filled by easing from the last frame it was seen to the next one;
// - everything is smoothed a little (hand tracking shivers), keeping fast
//   moves: a 5-frame window, positions averaged, rotations blended.
export function clean(frames) {
  const n = frames.length;
  const out = frames.map((f) => f.slice());
  for (const side of SIDES) {
    const o = handOffset(side);
    let last = -1;
    for (let i = 0; i <= n; i++) {
      const seen = i < n && out[i][o] > 0;
      if (!seen && i < n) continue;
      if (last >= 0 && i - last > 1 && i < n) {
        for (let k = last + 1; k < i; k++) blendHand(out[k], out[last], out[i], o, (k - last) / (i - last));
      } else if (last < 0 && i < n && i > 0) {
        for (let k = 0; k < i; k++) copyHand(out[k], out[i], o); // missing at the start: hold the first one seen
      } else if (i === n && last >= 0) {
        for (let k = last + 1; k < n; k++) copyHand(out[k], out[last], o); // missing at the end: hold the last one
      }
      if (i < n) last = i;
    }
  }
  return smooth(out);
}

function copyHand(dst, src, o) {
  dst.set(src.subarray(o, o + HAND_SIZE), o);
}

const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();
function blendHand(dst, a, b, o, t) {
  dst[o] = a[o] === b[o] ? a[o] : a[o] || b[o];
  for (let k = 1; k < 4; k++) dst[o + k] = a[o + k] + (b[o + k] - a[o + k]) * t;
  _qa.fromArray(a, o + 4).slerp(_qb.fromArray(b, o + 4), t).toArray(dst, o + 4);
  for (let k = 8; k < HAND_SIZE; k++) dst[o + k] = a[o + k] + (b[o + k] - a[o + k]) * t;
}

const W = [1, 2, 3, 2, 1];
function smooth(frames) {
  const n = frames.length, out = frames.map((f) => f.slice());
  const quatAt = (o) => {
    for (let i = 0; i < n; i++) {
      const q = new THREE.Quaternion(), tmp = new THREE.Quaternion();
      let w = 0;
      for (let d = -2; d <= 2; d++) {
        const k = Math.min(n - 1, Math.max(0, i + d)), wt = W[d + 2];
        tmp.fromArray(frames[k], o);
        if (w === 0) q.copy(tmp);
        else {
          if (q.dot(tmp) < 0) tmp.set(-tmp.x, -tmp.y, -tmp.z, -tmp.w);
          q.slerp(tmp, wt / (w + wt));
        }
        w += wt;
      }
      q.toArray(out[i], o);
    }
  };
  const posAt = (o, len) => {
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < len; c++) {
        let s = 0, w = 0;
        for (let d = -2; d <= 2; d++) {
          const k = Math.min(n - 1, Math.max(0, i + d));
          s += frames[k][o + c] * W[d + 2];
          w += W[d + 2];
        }
        out[i][o + c] = s / w;
      }
    }
  };
  posAt(HEAD, 3);
  quatAt(HEAD + 3);
  for (const side of SIDES) {
    const o = handOffset(side);
    posAt(o + 1, 3);
    quatAt(o + 4);
    posAt(o + 8, 75);
  }
  return out;
}
