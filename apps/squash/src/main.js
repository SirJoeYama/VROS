import * as THREE from 'three';
import { Input } from '../../../shared/input.js';
import { HandsView } from '../../../shared/handsView.js';
import { CloseGesture } from '../../../shared/closeGesture.js';
import { UndoGesture } from '../../../shared/undoGesture.js';
import { HelpGesture } from '../../../shared/helpGesture.js';
import { setupEnterXR } from '../../../shared/xr.js';
import { CFG, COLORS, clamp } from './config.js';
import { buildCourt, Flashes, glowTexture } from './court.js';
import { Sfx } from './audio.js';
import { Scoreboard } from './scoreboard.js';
import { Paddle } from './paddles.js';
import { Game } from './game.js';

const BG = new THREE.Color(0x020308);

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.xr.setFoveation(1);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = BG;
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.02, 50);
scene.add(camera);
scene.add(new THREE.HemisphereLight(0x8899ff, 0x111122, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.position.set(1, 4, 2);
scene.add(sun);

// The court and everything in it live in `court`: entering XR (or
// recentering) puts it around you, the front wall ahead of where you look.
// The game runs in its local space.
const court = new THREE.Group();
scene.add(court);
const glowTex = glowTexture();
buildCourt(court);
const flashes = new Flashes(court, glowTex);
const scoreboard = new Scoreboard(court);
const sfx = new Sfx();
const paddles = { left: new Paddle(court, 'left', COLORS.left), right: new Paddle(court, 'right', COLORS.right) };
const paddleList = [paddles.left, paddles.right];
const game = new Game(court, { sfx, flashes, glowTex, haptic });

// Controller rumble on a hit, stronger for harder hits.
function haptic(side, strength) {
  const session = renderer.xr.getSession();
  if (!session) return;
  for (const src of session.inputSources) {
    if (src.handedness !== side || !src.gamepad) continue;
    const ms = 20 + 60 * strength;
    try {
      const a = src.gamepad.hapticActuators?.[0];
      if (a?.pulse) a.pulse(strength, ms);
      else src.gamepad.vibrationActuator?.playEffect('dual-rumble', { duration: ms, strongMagnitude: strength, weakMagnitude: strength });
    } catch { /* no rumble */ }
  }
}

// ---------- placement ----------
function placeDesktop() {
  court.position.set(0, 0, 0);
  court.rotation.set(0, 0, 0);
  camera.position.set(0, 1.6, 0);
  camera.lookAt(0, 2.0, CFG.FRONT_Z);
}
placeDesktop();

// You at the origin of the court, facing the front wall.
function placeXR(frame) {
  const pose = frame.getViewerPose(renderer.xr.getReferenceSpace());
  if (!pose) return false;
  const p = pose.transform.position, q = pose.transform.orientation;
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w));
  fwd.y = 0;
  if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
  fwd.normalize();
  court.position.set(p.x, 0, p.z);
  court.rotation.set(0, Math.atan2(-fwd.x, -fwd.z), 0);
  court.updateMatrixWorld(true);
  return true;
}

// ---------- shared gestures ----------
const handsView = new HandsView();
scene.add(handsView.points);
const input = new Input(renderer, camera);
const closeGesture = new CloseGesture(renderer);
scene.add(closeGesture.group);
const undoGesture = new UndoGesture(); // nothing to undo in a rally: it just says so
scene.add(undoGesture.group);
const help = HelpGesture.fromPage();
scene.add(help.group);

// ---------- paddles from hands, controllers or the mouse ----------
const _pos = new THREE.Vector3(), _quat = new THREE.Quaternion(), _courtQInv = new THREE.Quaternion();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _basis = new THREE.Matrix4();

// The cube's pose for one hand-like state, in court space. Controllers: on
// the pointing ray, just past the tip, turned with the controller. Hands: in
// front of the palm, square to it.
function paddlePose(h) {
  if (h.kind === 'controller') {
    _quat.copy(h.quat);
    _pos.copy(h.rayOrigin).addScaledVector(h.rayDir, CFG.PADDLE_OFFSET);
  } else if (h.kind === 'hand') {
    _y.copy(h.palmNormal);
    _x.copy(h.lateral).addScaledVector(_y, -h.lateral.dot(_y)).normalize();
    _z.crossVectors(_x, _y);
    _quat.setFromRotationMatrix(_basis.makeBasis(_x, _y, _z));
    _pos.copy(h.palmCenter).addScaledVector(_y, CFG.PALM_OFFSET);
  } else {
    _quat.identity();
    _pos.copy(h.pinchPoint);
    _pos.x = clamp(_pos.x, -CFG.COURT_W / 2 + 0.1, CFG.COURT_W / 2 - 0.1);
    _pos.y = clamp(_pos.y, 0.1, CFG.COURT_H - 0.1);
  }
  court.worldToLocal(_pos);
  _quat.premultiply(_courtQInv);
}

function updatePaddles(hands, dt) {
  court.getWorldQuaternion(_courtQInv).invert();
  for (const p of paddleList) p.begin();
  for (const h of hands) {
    const p = h.kind === 'mouse' ? paddles.right : paddles[h.handedness];
    if (!p) continue;
    paddlePose(h);
    p.set(_pos, _quat, h.kind === 'mouse');
  }
  paddles.right.setSeeThrough(!renderer.xr.isPresenting);
  for (const p of paddleList) p.finish(dt, game.time);
}

// Where you are and which way you face, in court space.
const _fwd = new THREE.Vector3();
function updateHead(viewer) {
  court.worldToLocal(viewer.getWorldPosition(game.head));
  viewer.getWorldDirection(_fwd).applyQuaternion(_courtQInv);
  _fwd.y = 0;
  if (_fwd.lengthSq() < 1e-4) _fwd.set(0, 0, -1);
  _fwd.normalize();
}

// Serve with a pinch or a trigger pull (its start), restart the same way.
// Two fists held a second (or the right stick click) recenter the court
// between rallies, never during one: a fist is how you hold a cube.
const pinched = new Map();
let fistsHeld = 0;
function updateGestures(hands, dt) {
  for (const h of hands) {
    if (h.kind === 'mouse') continue; // see the click listener
    if (h.pinch && !pinched.get(h.id)) {
      sfx.unlock();
      game.trigger(_fwd);
    }
    pinched.set(h.id, h.pinch);
  }
  for (const id of [...pinched.keys()]) if (!hands.some((h) => h.id === id)) pinched.delete(id);

  const calm = game.state !== 'play';
  const fists = hands.filter((h) => h.kind === 'hand' && h.fist).length;
  fistsHeld = fists === 2 && calm ? fistsHeld + dt : 0;
  if (fistsHeld > 1) {
    fistsHeld = -1e9; // once per hold
    needPlace = true;
  }
  if (calm && input.events.includes('recenter')) needPlace = true;
}

// Desktop: a click serves (straight from the event: a quick click can fall
// between two frames).
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (renderer.xr.isPresenting || e.button !== 0) return;
  sfx.unlock();
  game.trigger(_fwd);
});

// ---------- 2D page ----------
const scoreLine = document.getElementById('score');
let scoreText = '';
function updatePage() {
  const t = `Best rally: ${game.best}`;
  if (t !== scoreText) scoreLine.textContent = scoreText = t;
}

// ---------- XR session ----------
let needPlace = false;
setupEnterXR({ renderer, button: document.getElementById('enter'), status: document.getElementById('status') });
renderer.xr.addEventListener('sessionstart', () => {
  document.body.classList.add('in-xr');
  handsView.points.material.uniforms.uScale.value = 1000;
  sfx.unlock();
  renderer.xr.getSession().addEventListener('select', () => sfx.unlock());
  needPlace = true;
});
renderer.xr.addEventListener('sessionend', () => {
  document.body.classList.remove('in-xr');
  help.hide();
  placeDesktop();
  onResize();
});

function onResize() {
  if (renderer.xr.isPresenting) return;
  camera.fov = 70;
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  handsView.points.material.uniforms.uScale.value =
    renderer.getDrawingBufferSize(new THREE.Vector2()).y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
}
addEventListener('resize', onResize);
onResize();

// ---------- main loop ----------
const mouseCenter = new THREE.Vector3();
let last = 0;
renderer.setAnimationLoop((time, frame) => {
  const dt = Math.min(Math.max(time / 1000 - last, 0), 1 / 30);
  last = time / 1000;
  if (frame && needPlace && placeXR(frame)) {
    needPlace = false;
    help.hint(renderer.xr.getCamera());
  }
  // the mouse paddle moves on a plane just ahead of the desktop camera
  camera.getWorldDirection(mouseCenter).multiplyScalar(CFG.DESKTOP_PLANE).add(camera.position);
  input.update(frame, dt, mouseCenter);
  const xr = renderer.xr.isPresenting;
  const viewer = xr ? renderer.xr.getCamera() : camera;
  help.update(input.hands, dt, viewer);
  closeGesture.update(input.hands, dt, viewer);
  undoGesture.update(input.hands, dt, viewer);

  updatePaddles(input.hands, dt);
  updateHead(viewer);
  game.desktop = !xr;
  updateGestures(input.hands, dt);
  game.update(dt, paddleList);
  flashes.update(dt);
  scoreboard.draw(game, xr);
  updatePage();
  handsView.update(input.hands);
  renderer.render(scene, camera);
});
