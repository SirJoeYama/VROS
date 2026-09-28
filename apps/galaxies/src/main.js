import * as THREE from 'three';
import { ParticleField } from './particles.js';
import { APPS } from './apps.js';
import { Input } from './input.js';
import { HandsView } from './handsView.js';
import { Launcher } from './launcher.js';
import { TextSprite } from './text.js';

const params = new URLSearchParams(location.search);
const isQuest = /OculusBrowser|Quest/i.test(navigator.userAgent);
const COUNT = Number(params.get('n')) || (isQuest ? 16000 : 24000);
const BG = new THREE.Color(0x04050a);

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = BG;
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.01, 50);

// The formation's pose in the room: center, uniform scale, yaw.
const world = { cx: 0, cy: 1.35, cz: -0.8, scale: 1, yaw: 0 };
const center = new THREE.Vector3();
function placeDesktopCamera() {
  camera.position.set(0, world.cy + 0.1, world.cz + 1.25);
  camera.lookAt(world.cx, world.cy, world.cz);
}
placeDesktopCamera();

const field = new ParticleField(COUNT);
scene.add(field.points);
const handsView = new HandsView();
scene.add(handsView.points);
const title = new TextSprite(0.42);
scene.add(title.sprite);

const grabLine = new THREE.Line(
  new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
  new THREE.LineBasicMaterial({ color: 0x9fb8ff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }),
);
grabLine.frustumCulled = false;
grabLine.visible = false;
scene.add(grabLine);

const input = new Input(renderer, camera);

// ---------- apps ----------
let appIndex = 0;
const dock = document.getElementById('dock');
APPS.forEach((app, i) => {
  const b = document.createElement('button');
  b.textContent = `${i + 1} · ${app.name}`;
  b.onclick = () => switchApp(i);
  dock.appendChild(b);
});

function switchApp(i) {
  appIndex = (i + APPS.length) % APPS.length;
  const app = APPS[appIndex];
  field.setApp(app);
  title.flash(app.name, app.tagline);
  [...dock.children].forEach((b, k) => b.classList.toggle('on', k === appIndex));
}

const launcher = new Launcher(APPS, switchApp);
scene.add(launcher.group);

addEventListener('keydown', (e) => {
  const n = Number(e.key);
  if (n >= 1 && n <= APPS.length) switchApp(n - 1);
  else if (e.key === 'ArrowRight') switchApp(appIndex + 1);
  else if (e.key === 'ArrowLeft') switchApp(appIndex - 1);
});

// ---------- boot ----------
function boot() {
  field.setApp(APPS[appIndex]);
  field.scatter(world.cx, world.cy, world.cz, 1.5, 3.5);
  title.flash('Galaxies', 'VROS', 2.2);
  setTimeout(() => switchApp(appIndex), 2600);
}
boot();

// ---------- XR session ----------
const enterBtn = document.getElementById('enter');
const status = document.getElementById('status');
let sessionMode = null;
let needRecenter = false;

async function detectXR() {
  if (!navigator.xr) {
    status.textContent = 'WebXR unavailable. Open this page in the Meta Quest Browser.';
    enterBtn.textContent = 'XR not available';
    return;
  }
  for (const mode of ['immersive-ar', 'immersive-vr']) {
    if (await navigator.xr.isSessionSupported(mode).catch(() => false)) {
      sessionMode = mode;
      break;
    }
  }
  if (!sessionMode) {
    status.textContent = 'No immersive session available. Desktop preview only.';
    enterBtn.textContent = 'XR not available';
    return;
  }
  enterBtn.disabled = false;
  enterBtn.textContent = sessionMode === 'immersive-ar' ? 'Enter (passthrough)' : 'Enter VR';
}
detectXR();

enterBtn.addEventListener('click', async () => {
  try {
    const session = await navigator.xr.requestSession(sessionMode, {
      requiredFeatures: ['local-floor'],
      optionalFeatures: ['hand-tracking', 'bounded-floor'],
    });
    await renderer.xr.setSession(session);
  } catch (err) {
    status.textContent = 'Could not start XR: ' + err.message;
  }
});

renderer.xr.addEventListener('sessionstart', () => {
  document.body.classList.add('in-xr');
  scene.background = sessionMode === 'immersive-ar' ? null : BG;
  field.material.uniforms.uScale.value = 1000;
  handsView.points.material.uniforms.uScale.value = 1000;
  needRecenter = true;
});
renderer.xr.addEventListener('sessionend', () => {
  document.body.classList.remove('in-xr');
  scene.background = BG;
  world.cx = 0; world.cy = 1.35; world.cz = -0.8;
  placeDesktopCamera();
  onResize();
});

// Put the formation ~75cm in front of the viewer, slightly below eye level.
function recenter(frame) {
  const pose = frame.getViewerPose(renderer.xr.getReferenceSpace());
  if (!pose) return false;
  const p = pose.transform.position, q = pose.transform.orientation;
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w));
  fwd.y = 0;
  if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
  fwd.normalize();
  world.cx = p.x + fwd.x * 0.75;
  world.cy = p.y - 0.2;
  world.cz = p.z + fwd.z * 0.75;
  world.scale = 1;
  world.yaw = 0;
  return true;
}

function onResize() {
  if (renderer.xr.isPresenting) return;
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  const scale = renderer.getDrawingBufferSize(new THREE.Vector2()).y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
  field.material.uniforms.uScale.value = scale;
  handsView.points.material.uniforms.uScale.value = scale;
}
addEventListener('resize', onResize);
onResize();

// ---------- main loop ----------
const F = { cx: 0, cy: 0, cz: 0, scale: 1, yaw: 0, spring: 1, stillness: 0, wells: [], pushers: [] };
let grab = null;
let fistTime = 0;
let t = 0, last = 0;
const viewerRight = new THREE.Vector3();

renderer.setAnimationLoop((time, frame) => {
  const now = time / 1000;
  const dt = Math.min(Math.max(now - last, 0), 1 / 30);
  last = now;
  t += dt;

  if (frame && needRecenter && recenter(frame)) needRecenter = false;

  center.set(world.cx, world.cy, world.cz);
  input.update(frame, dt, center);
  const hands = input.hands;

  for (const ev of input.events) {
    if (ev === 'next') switchApp(appIndex + 1);
    else if (ev === 'prev') switchApp(appIndex - 1);
    else if (ev === 'recenter' && frame) recenter(frame);
  }
  if (input.wheel) {
    world.scale = THREE.MathUtils.clamp(world.scale * Math.exp(-input.wheel * 0.001), 0.25, 5);
    input.wheel = 0;
  }

  const xrCam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  viewerRight.setFromMatrixColumn(xrCam.matrixWorld, 0);
  const menuHand = launcher.update(hands, dt, t, appIndex, viewerRight);

  // Two pinching hands grab the whole formation: move, scale, and turn it.
  const pinching = hands.filter((h) => h.pinch && h !== menuHand);
  F.wells.length = 0;
  if (pinching.length >= 2) {
    const a = pinching[0].pinchPoint, b = pinching[1].pinchPoint;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, mz = (a.z + b.z) / 2;
    const dist = Math.max(0.02, a.distanceTo(b));
    const ang = Math.atan2(b.z - a.z, b.x - a.x);
    if (!grab) grab = { mx, my, mz, dist, ang, cx: world.cx, cy: world.cy, cz: world.cz, scale: world.scale, yaw: world.yaw };
    world.cx = grab.cx + mx - grab.mx;
    world.cy = grab.cy + my - grab.my;
    world.cz = grab.cz + mz - grab.mz;
    world.scale = THREE.MathUtils.clamp((grab.scale * dist) / grab.dist, 0.25, 5);
    let dAng = ang - grab.ang;
    dAng = Math.atan2(Math.sin(dAng), Math.cos(dAng));
    world.yaw = grab.yaw - dAng;
    grabLine.geometry.attributes.position.setXYZ(0, a.x, a.y, a.z);
    grabLine.geometry.attributes.position.setXYZ(1, b.x, b.y, b.z);
    grabLine.geometry.attributes.position.needsUpdate = true;
    grabLine.visible = true;
  } else {
    grab = null;
    grabLine.visible = false;
    for (const h of pinching) F.wells.push({ x: h.pinchPoint.x, y: h.pinchPoint.y, z: h.pinchPoint.z, s: 3 });
  }

  // Open palms push particles like wind.
  F.pushers.length = 0;
  for (const h of hands) {
    if (!h.open || h.palmUp || h === menuHand) continue;
    F.pushers.push({
      x: h.palmCenter.x, y: h.palmCenter.y, z: h.palmCenter.z,
      nx: h.palmNormal.x, ny: h.palmNormal.y, nz: h.palmNormal.z,
      vx: h.vel.x, vy: h.vel.y, vz: h.vel.z, s: 1,
    });
  }

  // A fist stills time; two fists held for a moment recenter the formation.
  const fists = hands.filter((h) => h.fist).length;
  F.stillness += ((fists ? 1 : 0) - F.stillness) * Math.min(1, dt * 5);
  fistTime = fists >= 2 ? fistTime + dt : 0;
  if (fistTime > 1.2 && frame) {
    recenter(frame);
    title.flash('Recentered', '', 1.2);
    fistTime = -10;
  }

  F.spring += ((F.wells.length ? 0.15 : 1) - F.spring) * Math.min(1, dt * 6);
  F.cx = world.cx; F.cy = world.cy; F.cz = world.cz;
  F.scale = world.scale; F.yaw = world.yaw;
  field.update(dt, t, F);

  handsView.update(hands);
  title.sprite.position.set(world.cx, world.cy + 0.5 * world.scale, world.cz);
  title.tick(dt);

  renderer.render(scene, camera);
});
