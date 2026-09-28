import * as THREE from 'three';
import { Input } from '../../../shared/input.js';
import { HandsView } from '../../../shared/handsView.js';
import { CloseGesture } from '../../../shared/closeGesture.js';
import { HelpGesture } from '../../../shared/helpGesture.js';
import { setupEnterXR } from '../../../shared/xr.js';
import { Marionette } from './puppet.js';

const BG = new THREE.Color(0x04050a);
const INDEX_TIP = 9, MIDDLE_TIP = 14, RING_TIP = 19;

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = BG;
scene.add(new THREE.HemisphereLight(0xfff3e0, 0x202040, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(0.5, 2, 1);
scene.add(sun);
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.01, 50);

const puppet = new Marionette();
scene.add(puppet.stage, puppet.group);
const handsView = new HandsView();
scene.add(handsView.points);
const input = new Input(renderer, camera);
const closeGesture = new CloseGesture(renderer);
scene.add(closeGesture.group);
const help = HelpGesture.fromPage();
scene.add(help.group);

// ---------- placement ----------
function placeDesktop() {
  puppet.place(new THREE.Vector3(0, 0.9, -0.6), new THREE.Vector3(0, 0.9, 0));
  camera.position.set(0, 1.2, 0);
  camera.lookAt(0, 1.05, -0.6);
}
placeDesktop();

// The stage sits half a meter ahead, about 80 cm below your eyes, so your
// hands hang naturally above the puppet.
function placeXR(frame) {
  const pose = frame.getViewerPose(renderer.xr.getReferenceSpace());
  if (!pose) return false;
  const p = pose.transform.position, q = pose.transform.orientation;
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w));
  fwd.y = 0;
  if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
  fwd.normalize();
  puppet.place(new THREE.Vector3(p.x + fwd.x * 0.5, p.y - 0.8, p.z + fwd.z * 0.5), new THREE.Vector3(p.x, p.y, p.z));
  return true;
}

// ---------- hands → strings ----------
const joint = (h, k, out) => out.set(h.joints[k * 3], h.joints[k * 3 + 1], h.joints[k * 3 + 2]);
const tips = { L: {}, R: {} };
for (const s of ['L', 'R']) for (const k of ['index', 'middle', 'ring', 'palm']) tips[s][k] = new THREE.Vector3();
const bar = {};
for (const c of ['head', 'sL', 'sR', 'hL', 'hR', 'kL', 'kR']) bar[c] = new THREE.Vector3();
const headMid = new THREE.Vector3();
const right = new THREE.Vector3();

// Which side of the stage a hand is on, as you look at it.
function sideOf(h) {
  if (h.handedness === 'left') return 'L';
  if (h.handedness === 'right') return 'R';
  return null;
}

function anchorsFrom(hands) {
  const anchors = {};
  const heads = [];
  for (const h of hands) {
    const side = sideOf(h);
    if (h.kind === 'hand' && side) {
      // Fingers: index → hand, middle → head, ring → knee, palm → shoulder.
      const t = tips[side];
      anchors['h' + side] = joint(h, INDEX_TIP, t.index);
      anchors['k' + side] = joint(h, RING_TIP, t.ring);
      anchors['s' + side] = t.palm.copy(h.palmCenter);
      heads.push(joint(h, MIDDLE_TIP, t.middle));
    } else if (h.kind === 'controller' && side) {
      // A controller is half a control bar: trigger lifts the hand string,
      // grip lifts the knee string.
      const sign = side === 'L' ? -1 : 1;
      const p = h.pinchPoint;
      anchors['s' + side] = bar['s' + side].copy(p);
      anchors['h' + side] = bar['h' + side].copy(p).addScaledVector(right, sign * 0.05);
      anchors['k' + side] = bar['k' + side].copy(p).addScaledVector(right, sign * 0.02);
      if (h.pinch) anchors['h' + side].y += 0.1;
      if (h.open) anchors['k' + side].y += 0.08;
      heads.push(bar['head'].copy(p).addScaledVector(right, -sign * 0.03));
    } else if (h.kind === 'mouse') {
      // Desktop: one control bar at the pointer. Left button waves the arms;
      // right button (or shift) lifts the knees in turn.
      const p = h.pinchPoint;
      const wave = h.pinch ? Math.sin(performance.now() / 180) * 0.06 : 0;
      const step = h.open ? Math.sin(performance.now() / 250) * 0.05 : 0;
      anchors.head = bar.head.copy(p);
      anchors.sL = bar.sL.copy(p).addScaledVector(right, -0.06);
      anchors.sR = bar.sR.copy(p).addScaledVector(right, 0.06);
      anchors.hL = bar.hL.copy(p).addScaledVector(right, -0.1);
      anchors.hR = bar.hR.copy(p).addScaledVector(right, 0.1);
      anchors.kL = bar.kL.copy(p).addScaledVector(right, -0.04);
      anchors.kR = bar.kR.copy(p).addScaledVector(right, 0.04);
      anchors.hL.y += Math.max(0, wave);
      anchors.hR.y += Math.max(0, -wave);
      anchors.kL.y += Math.max(0, step);
      anchors.kR.y += Math.max(0, -step);
    }
  }
  if (heads.length) anchors.head = headMid.copy(heads[0]).add(heads[1] || heads[0]).multiplyScalar(0.5);
  return anchors;
}

// ---------- XR session ----------
let needPlace = false;
const xr = setupEnterXR({ renderer, button: document.getElementById('enter'), status: document.getElementById('status') });
renderer.xr.addEventListener('sessionstart', () => {
  document.body.classList.add('in-xr');
  scene.background = xr.mode === 'immersive-ar' ? null : BG;
  handsView.points.material.uniforms.uScale.value = 1000;
  needPlace = true;
});
renderer.xr.addEventListener('sessionend', () => {
  document.body.classList.remove('in-xr');
  scene.background = BG;
  help.hide();
  placeDesktop();
  onResize();
});
document.getElementById('reset').addEventListener('click', () => puppet.reset());

function onResize() {
  if (renderer.xr.isPresenting) return;
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  handsView.points.material.uniforms.uScale.value =
    renderer.getDrawingBufferSize(new THREE.Vector2()).y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
}
addEventListener('resize', onResize);
onResize();

// ---------- main loop ----------
const center = new THREE.Vector3();
let fistTime = 0, last = 0;
renderer.setAnimationLoop((time, frame) => {
  const dt = Math.min(Math.max(time / 1000 - last, 0), 1 / 30);
  last = time / 1000;
  if (frame && needPlace && placeXR(frame)) {
    needPlace = false;
    help.hint(renderer.xr.getCamera());
  }

  // Desktop pointer moves on a plane 30 cm above the stage.
  center.copy(puppet.stage.position).y += 0.32;
  input.update(frame, dt, center);
  for (const ev of input.events) if (ev === 'recenter') needPlace = true;

  const viewer = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  right.setFromMatrixColumn(viewer.matrixWorld, 0).setY(0).normalize();
  const helpHand = help.update(input.hands, dt, viewer);
  closeGesture.update(input.hands, dt, viewer);

  // Two fists held for a moment: stand the puppet back up (and re-place the stage in XR).
  fistTime = input.hands.filter((h) => h.fist).length >= 2 ? fistTime + dt : 0;
  if (fistTime > 1) {
    fistTime = -10;
    if (frame) needPlace = true;
    else puppet.reset();
  }

  puppet.setAnchors(anchorsFrom(input.hands.filter((h) => h !== helpHand && !h.fist)));
  puppet.update(dt);
  handsView.update(input.hands);
  renderer.render(scene, camera);
});
