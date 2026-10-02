import * as THREE from 'three';

// WebXR joint order (XRHand iterates in this order).
export const JOINTS = [
  'wrist',
  'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip',
  'index-finger-metacarpal', 'index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate', 'index-finger-phalanx-distal', 'index-finger-tip',
  'middle-finger-metacarpal', 'middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal', 'middle-finger-tip',
  'ring-finger-metacarpal', 'ring-finger-phalanx-proximal', 'ring-finger-phalanx-intermediate', 'ring-finger-phalanx-distal', 'ring-finger-tip',
  'pinky-finger-metacarpal', 'pinky-finger-phalanx-proximal', 'pinky-finger-phalanx-intermediate', 'pinky-finger-phalanx-distal', 'pinky-finger-tip',
];
export const TIPS = [4, 9, 14, 19, 24];
const WRIST = 0, THUMB_TIP = 4, INDEX_TIP = 9;
const FINGERS = [[6, 9], [11, 14], [16, 19], [21, 24]]; // [knuckle, tip]

const PINCH_ON = 0.018, PINCH_OFF = 0.035;
const TIP = 0.02; // a controller's tip: this far past the front of the controller, along its ray (m)

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

function makeState(id) {
  return {
    id,
    kind: 'hand', // 'hand' | 'controller' | 'mouse'
    handedness: id,
    active: false,
    joints: new Float32Array(JOINTS.length * 3),
    jointCount: 0,
    pinch: false,
    pressure: 1, // how hard: a controller's analog trigger, 1 for hands and the mouse
    open: false,
    fist: false,
    thumbOut: false, // thumb stuck out, not tucked (thumbs up / down)
    curled: 0, // how many of the four fingers are curled
    palmUp: false,
    pinchPoint: new THREE.Vector3(),
    realPinch: new THREE.Vector3(), // the pinch point in the room, before `origin` (see Input)
    palmCenter: new THREE.Vector3(),
    palmNormal: new THREE.Vector3(0, -1, 0),
    indexTip: new THREE.Vector3(),
    lateral: new THREE.Vector3(1, 0, 0),
    vel: new THREE.Vector3(),
    // controllers only (Quest Touch): see Input._updateXR
    grip: false,
    quat: new THREE.Quaternion(), // the controller's orientation
    rayOrigin: new THREE.Vector3(), // where it points from, and which way
    rayDir: new THREE.Vector3(0, 0, -1),
    stick: new THREE.Vector2(), // thumbstick, x right, y up (-1..1)
    btn: { a: false, b: false, stick: false }, // A/B on the right, X/Y on the left (named a/b too), stick click
    aim: null, // set by Pointer: { point, surface } where the ray hits something the app can press
    _prev: new THREE.Vector3(),
    _hasPrev: false,
    _buttons: [],
  };
}

function joint(st, k, out) {
  return out.set(st.joints[k * 3], st.joints[k * 3 + 1], st.joints[k * 3 + 2]);
}

// Turn 25 joint positions into gesture state (with hysteresis on pinch).
function analyzeHand(st) {
  const wrist = joint(st, WRIST, _a);
  const thumb = joint(st, THUMB_TIP, _b);
  const index = joint(st, INDEX_TIP, _c);
  st.indexTip.copy(index);

  const pinchDist = thumb.distanceTo(index);
  if (st.pinch ? pinchDist < PINCH_OFF : pinchDist < PINCH_ON) st.pinch = true;
  else st.pinch = false;
  st.pinchPoint.copy(thumb).add(index).multiplyScalar(0.5);

  let extended = 0, curled = 0;
  const knuckle = new THREE.Vector3(), tip = new THREE.Vector3();
  for (const [kn, tp] of FINGERS) {
    joint(st, kn, knuckle);
    joint(st, tp, tip);
    const ratio = tip.distanceTo(wrist) / Math.max(1e-4, knuckle.distanceTo(wrist));
    if (ratio > 1.55) extended++;
    else if (ratio < 1.2) curled++;
  }

  // Thumb out: in a fist the thumb tip rests on the index and middle fingers'
  // middle joints; stuck out (thumbs up / down) it's well away from all of
  // them. Measured against the hand's size (wrist to middle knuckle).
  const size = joint(st, 11, knuckle).distanceTo(wrist);
  let near = Infinity;
  for (const k of [7, 8, 12, 13]) near = Math.min(near, thumb.distanceTo(joint(st, k, tip)));
  st.thumbOut = near / Math.max(1e-4, size) > 0.5;
  st.curled = curled;

  // Palm frame from wrist and index/pinky knuckles. For a right hand,
  // cross(index - wrist, pinky - wrist) points out of the palm.
  const idx = joint(st, 6, new THREE.Vector3()).sub(wrist);
  const pky = joint(st, 21, new THREE.Vector3()).sub(wrist);
  const n = st.handedness === 'left' ? pky.clone().cross(idx) : idx.clone().cross(pky);
  st.palmNormal.copy(n.normalize());
  st.lateral.copy(idx).sub(pky).normalize();
  joint(st, 11, st.palmCenter).add(wrist).multiplyScalar(0.5);

  st.open = !st.pinch && extended >= 4 && pinchDist > 0.05;
  // A fist has its thumb tucked in; with the thumb out it's a thumbs up or down.
  st.fist = !st.pinch && curled >= 4 && !st.thumbOut;
  st.palmUp = !st.pinch && extended >= 3 && st.palmNormal.y > 0.65;
}

// Palm facing up, whatever the fingers are doing (`palmUp` needs an open
// hand). The two-hand grab only starts when both hands pinch like this, so
// two ordinary pinches never start it by accident. Controllers have no palm,
// so they always count.
export function palmFacesUp(h, min = 0.4) {
  return h.kind !== 'hand' || h.palmNormal.y > min;
}

function trackVelocity(st, pos, dt) {
  if (st._hasPrev && dt > 0) {
    _a.copy(pos).sub(st._prev).divideScalar(dt);
    st.vel.lerp(_a, 0.35);
  } else st.vel.set(0, 0, 0);
  st._prev.copy(pos);
  st._hasPrev = true;
}

// Unifies tracked hands, controllers and the desktop mouse into hand-like states.
//
// Quest controllers (the standard VROS mapping):
//   trigger = pinch (analog: `pressure`) · grip = fist (grip + twist the
//   controller = the knob; both grips = two fists) · both triggers = the
//   two-hand grab · ray = `rayOrigin` / `rayDir` (the laser pointer, see
//   Pointer) · thumbstick = `stick` · buttons in `btn`: on the left `a` is X
//   and `b` is Y. Events: 'recenter' (right stick click), 'menu' (left stick
//   click), and stick flicks 'next' / 'prev' (right stick right / left) and
//   'up' / 'down'. The shared gestures read X / A (undo / redo), B (help),
//   holding Y (close) and the left stick click (menu to hand) themselves.
export class Input {
  constructor(renderer, camera) {
    this.renderer = renderer;
    this.camera = camera;
    this.states = { left: makeState('left'), right: makeState('right'), mouse: makeState('mouse') };
    this.states.mouse.kind = 'mouse';
    this.hands = [];
    this.events = []; // 'next' | 'prev' | 'recenter'
    this.wheel = 0;
    // Optional: the Object3D the XR camera sits in (a "dolly" that moves and
    // scales your viewpoint). Tracked hands and controllers are then given in
    // world space, so they line up with what you see; `realPinch` keeps the
    // pinch point in the room's own space.
    this.origin = null;

    this.mouse = { ndc: new THREE.Vector2(), l: false, r: false, inside: false };
    this.raycaster = new THREE.Raycaster();
    this.plane = new THREE.Plane();

    const el = renderer.domElement;
    el.addEventListener('pointermove', (e) => {
      this.mouse.ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
      this.mouse.inside = true;
    });
    el.addEventListener('pointerdown', (e) => {
      this.mouse.ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
      this.mouse.inside = true;
      if (e.button === 2 || e.shiftKey) this.mouse.r = true;
      else this.mouse.l = true;
      el.setPointerCapture?.(e.pointerId);
    });
    const up = () => { this.mouse.l = false; this.mouse.r = false; };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', () => { up(); this.mouse.inside = false; });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('wheel', (e) => { this.wheel += e.deltaY; e.preventDefault(); }, { passive: false });
  }

  update(frame, dt, center) {
    this.hands.length = 0;
    this.events.length = 0;
    for (const st of Object.values(this.states)) st.active = false;

    const session = this.renderer.xr.getSession();
    if (session && frame) this._updateXR(session, frame, dt);
    else this._updateMouse(dt, center);

    for (const st of Object.values(this.states)) {
      if (st.active) this.hands.push(st);
      else { st._hasPrev = false; st.pinch = false; }
    }
  }

  _updateXR(session, frame, dt) {
    const ref = this.renderer.xr.getReferenceSpace();
    for (const src of session.inputSources) {
      const st = this.states[src.handedness];
      if (!st) continue;

      if (src.hand) {
        let ok = true;
        for (let k = 0; k < JOINTS.length; k++) {
          const space = src.hand.get(JOINTS[k]);
          const pose = space && frame.getJointPose(space, ref);
          if (!pose) { ok = false; break; }
          const q = pose.transform.position;
          st.joints[k * 3] = q.x; st.joints[k * 3 + 1] = q.y; st.joints[k * 3 + 2] = q.z;
        }
        if (!ok) continue;
        st.kind = 'hand';
        st.pressure = 1;
        st.jointCount = JOINTS.length;
        analyzeHand(st);
        this._toWorld(st);
        trackVelocity(st, st.palmCenter, dt);
        st.active = true;
      } else if (src.gripSpace) {
        const pose = frame.getPose(src.gripSpace, ref);
        if (!pose) continue;
        const q = pose.transform.position, m = pose.transform.matrix;
        st.kind = 'controller';
        st.palmNormal.set(-m[8], -m[9], -m[10]).normalize();
        st.pinchPoint.set(q.x, q.y, q.z).addScaledVector(st.palmNormal, 0.06);
        st.palmCenter.copy(st.pinchPoint);
        st.indexTip.copy(st.pinchPoint);
        st.joints[0] = st.pinchPoint.x; st.joints[1] = st.pinchPoint.y; st.joints[2] = st.pinchPoint.z;
        st.jointCount = 1;
        const b = src.gamepad ? src.gamepad.buttons : [];
        const pressed = (i) => !!(b[i] && (b[i].pressed || b[i].value > 0.5));
        st.pinch = pressed(0);
        st.pressure = b[0] ? Math.max(0.15, b[0].value) : 1;
        st.grip = pressed(1);
        st.fist = st.grip && !st.pinch; // grip + twist = the knob; both grips = two fists
        st.open = false;
        st.palmUp = false;
        st.thumbOut = false;
        st.curled = 0;
        st.btn.a = pressed(4);
        st.btn.b = pressed(5);
        st.btn.stick = pressed(3);
        // orientation, the lateral axis (which way a ribbon brush lies) and the ray
        st.quat.set(pose.transform.orientation.x, pose.transform.orientation.y, pose.transform.orientation.z, pose.transform.orientation.w);
        st.lateral.set(1, 0, 0).applyQuaternion(st.quat);
        const ray = src.targetRaySpace && frame.getPose(src.targetRaySpace, ref);
        if (ray) {
          const r = ray.transform;
          st.rayOrigin.set(r.position.x, r.position.y, r.position.z);
          st.rayDir.set(0, 0, -1).applyQuaternion(new THREE.Quaternion(r.orientation.x, r.orientation.y, r.orientation.z, r.orientation.w));
        } else {
          st.rayOrigin.set(q.x, q.y, q.z);
          st.rayDir.copy(st.palmNormal);
        }
        // The controller's "fingertip" (where it pinches, draws, touches): just
        // past its front, along the pointing ray, so it stays fixed to the
        // controller however you hold or turn it (the grip's own axis slants
        // down and back on Quest, which made a point placed along it drift).
        st.pinchPoint.copy(st.rayOrigin).addScaledVector(st.rayDir, TIP);
        st.palmCenter.copy(st.pinchPoint);
        st.indexTip.copy(st.pinchPoint);
        st.joints[0] = st.pinchPoint.x; st.joints[1] = st.pinchPoint.y; st.joints[2] = st.pinchPoint.z;
        const ax = src.gamepad?.axes || [];
        st.stick.set(ax[2] || 0, -(ax[3] || 0));
        const edge = (i, name) => {
          const now = pressed(i);
          if (now && !st._buttons[i]) this.events.push(name);
          st._buttons[i] = now;
        };
        edge(3, src.handedness === 'left' ? 'menu' : 'recenter');
        // flicks of the right stick step through things
        if (src.handedness === 'right') {
          const flick = (v, plus, minus, key) => {
            if (Math.abs(v) > 0.7 && !st._buttons[key]) {
              this.events.push(v > 0 ? plus : minus);
              st._buttons[key] = true;
            } else if (Math.abs(v) < 0.3) st._buttons[key] = false;
          };
          flick(st.stick.x, 'next', 'prev', 'fx');
          flick(st.stick.y, 'up', 'down', 'fy');
        }
        this._toWorld(st);
        trackVelocity(st, st.palmCenter, dt);
        st.active = true;
      }
    }
  }

  // Hand geometry is analysed in the room (pinch and fist thresholds are real
  // distances); then positions and directions go through `origin`.
  _toWorld(st) {
    st.realPinch.copy(st.pinchPoint);
    const o = this.origin;
    if (!o) return;
    o.updateMatrixWorld();
    const m = o.matrixWorld;
    for (let k = 0; k < st.jointCount; k++) {
      _a.fromArray(st.joints, k * 3).applyMatrix4(m).toArray(st.joints, k * 3);
    }
    st.pinchPoint.applyMatrix4(m);
    st.palmCenter.applyMatrix4(m);
    st.indexTip.applyMatrix4(m);
    st.palmNormal.transformDirection(m);
    st.lateral.transformDirection(m);
    if (st.kind === 'controller') {
      st.rayOrigin.applyMatrix4(m);
      st.rayDir.transformDirection(m);
      st.quat.premultiply(o.getWorldQuaternion(new THREE.Quaternion()));
    }
  }

  _updateMouse(dt, center) {
    const st = this.states.mouse;
    if (!this.mouse.inside) return;
    const dir = this.camera.getWorldDirection(_a);
    this.plane.setFromNormalAndCoplanarPoint(dir, center);
    this.raycaster.setFromCamera(this.mouse.ndc, this.camera);
    if (!this.raycaster.ray.intersectPlane(this.plane, st.pinchPoint)) return;
    st.palmCenter.copy(st.pinchPoint);
    st.indexTip.copy(st.pinchPoint);
    st.palmNormal.copy(dir);
    st.pinch = this.mouse.l;
    st.open = this.mouse.r;
    st.fist = false;
    st.palmUp = false;
    st.joints[0] = st.pinchPoint.x; st.joints[1] = st.pinchPoint.y; st.joints[2] = st.pinchPoint.z;
    st.jointCount = 1;
    trackVelocity(st, st.palmCenter, dt);
    st.active = true;
  }
}
