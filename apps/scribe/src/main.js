import * as THREE from 'three';
import { Input } from '../../galaxies/src/input.js';
import { HandsView } from '../../galaxies/src/handsView.js';
import { Doc } from './doc.js';
import { Page, PAGE_H } from './page.js';
import { Speech } from './speech.js';
import { Buttons } from './buttons.js';

const params = new URLSearchParams(location.search);
const isQuest = /OculusBrowser|Quest/i.test(navigator.userAgent);
const hasWebSpeech = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
const ENGINE = params.get('engine') || (hasWebSpeech && !isQuest ? 'web' : 'whisper');
const MODEL = params.get('model') === 'base' ? 'Xenova/whisper-base.en' : 'Xenova/whisper-tiny.en';
const BG = new THREE.Color(0x04050a);
const SCROLL_PER_RADIAN = 520; // canvas px per radian of fist twist
const TOUCH_DEPTH = 0.05; // how close to the page (m) a fingertip or pinch counts

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = BG;
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.01, 50);

const doc = new Doc();
const page = new Page(doc);
page.texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
scene.add(page.group);

const handsView = new HandsView();
scene.add(handsView.points);

const input = new Input(renderer, camera);

// ---------- speech ----------
const status = document.getElementById('status');
let speechStatus = '';
const speech = new Speech({
  engine: ENGINE,
  model: MODEL,
  onInterim: (s) => doc.setInterim(s),
  onFinal: (s) => { doc.setInterim(''); doc.dictate(s); },
  onStatus: (s) => { speechStatus = s; status.textContent = s; },
});

const micBtn = document.getElementById('mic');
async function toggleMic() {
  await speech.toggle();
  micBtn.textContent = speech.active ? 'Stop dictation' : 'Start dictation';
}
micBtn.addEventListener('click', toggleMic);
document.getElementById('copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(doc.text);
    status.textContent = 'text copied';
  } catch {
    status.textContent = 'copy failed';
  }
});

// ---------- placement ----------
function placePage(pos, facing) {
  page.group.position.copy(pos);
  page.group.lookAt(facing.x, pos.y, facing.z);
}
function placeDesktop() {
  camera.position.set(0, 1.4, 0);
  camera.lookAt(0, 1.4, -1);
  placePage(new THREE.Vector3(0, 1.4, -0.62), camera.position);
}
placeDesktop();

// Half a meter in front of the viewer, a little below eye level.
function recenter(frame) {
  const pose = frame.getViewerPose(renderer.xr.getReferenceSpace());
  if (!pose) return false;
  const p = pose.transform.position, q = pose.transform.orientation;
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w));
  fwd.y = 0;
  if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
  fwd.normalize();
  const head = new THREE.Vector3(p.x, p.y, p.z);
  placePage(new THREE.Vector3(p.x + fwd.x * 0.5, p.y - 0.1, p.z + fwd.z * 0.5), head);
  return true;
}

let needRecenter = false;
const buttons = new Buttons([
  { kind: 'mic', x: -0.06, y: -PAGE_H / 2 - 0.035, onPress: toggleMic, isOn: () => speech.active },
  { kind: 'undo', x: 0, y: -PAGE_H / 2 - 0.035, onPress: () => doc.undo() },
  { kind: 'recenter', x: 0.06, y: -PAGE_H / 2 - 0.035, onPress: () => (renderer.xr.isPresenting ? (needRecenter = true) : placeDesktop()) },
]);
page.group.add(buttons.group);

// ---------- XR session ----------
const enterBtn = document.getElementById('enter');
let sessionMode = null;

async function detectXR() {
  if (!navigator.xr) {
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
    enterBtn.textContent = 'XR not available';
    return;
  }
  enterBtn.disabled = false;
  enterBtn.textContent = sessionMode === 'immersive-ar' ? 'Enter (passthrough)' : 'Enter VR';
}
detectXR();

enterBtn.addEventListener('click', async () => {
  // Ask for the mic in the same tap, but don't wait on it: the XR request
  // needs this click's user activation, which a permission prompt can outlast.
  if (!speech.active) toggleMic();
  try {
    const session = await navigator.xr.requestSession(sessionMode, {
      requiredFeatures: ['local-floor'],
      optionalFeatures: ['hand-tracking'],
    });
    await renderer.xr.setSession(session);
  } catch (err) {
    status.textContent = 'Could not start XR: ' + err.message;
  }
});

renderer.xr.addEventListener('sessionstart', () => {
  document.body.classList.add('in-xr');
  scene.background = sessionMode === 'immersive-ar' ? null : BG;
  handsView.points.material.uniforms.uScale.value = 1000;
  needRecenter = true;
});
renderer.xr.addEventListener('sessionend', () => {
  document.body.classList.remove('in-xr');
  scene.background = BG;
  placeDesktop();
  onResize();
});

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

// ---------- gestures ----------
// How far a fist has rolled around the forearm since last frame. Seen from
// behind the hand (the wearer's view), a positive angle is clockwise.
const _axis = new THREE.Vector3(), _across = new THREE.Vector3(), _v = new THREE.Vector3();
function fistRoll(h) {
  const j = h.joints;
  _axis.set(j[33] - j[0], j[34] - j[1], j[35] - j[2]).normalize(); // wrist → middle knuckle
  _across.set(j[18] - j[63], j[19] - j[64], j[20] - j[65]); // pinky knuckle → index knuckle
  _across.addScaledVector(_axis, -_across.dot(_axis)).normalize();
  const prev = rolls.get(h.id);
  rolls.set(h.id, _across.clone());
  if (!prev) return 0;
  return Math.atan2(_v.crossVectors(prev, _across).dot(_axis), prev.dot(_across));
}

const rolls = new Map(); // hand id → last "across" vector while a fist is held
const drags = new Map(); // hand id → character range of the word a pinch-selection started on
const wasPinching = new Map();
const local = new THREE.Vector3();
const center = new THREE.Vector3();

function updateGestures(hands, dt) {
  let hover = -1;
  const pokes = [], clicks = [];

  for (const h of hands) {
    const pinchStart = h.pinch && !wasPinching.get(h.id);
    wasPinching.set(h.id, h.pinch);

    // Hover: a fingertip resting on (or just in front of) a word.
    const tip = h.kind === 'mouse' ? h.pinchPoint : h.indexTip;
    page.toLocal(tip, local);
    if (page.contains(local) && local.z > -0.01 && local.z < TOUCH_DEPTH) {
      const k = page.hit(local);
      if (k >= 0) hover = k;
    }
    if (h.kind === 'hand') pokes.push(h.indexTip);
    if (h.kind !== 'hand' && pinchStart) clicks.push(h.pinchPoint);

    // Pinch on the page selects the word under it; drag to extend the selection.
    page.toLocal(h.pinchPoint, local);
    const onPage = page.contains(local, 0.01) && Math.abs(local.z) < TOUCH_DEPTH;
    if (pinchStart && onPage) {
      const k = page.hit(local);
      if (k >= 0) {
        const { start, end } = page.tokens[k];
        drags.set(h.id, { start, end });
        doc.select(drags.get(h.id), page.tokens[k]);
      } else doc.clearSelection();
    } else if (h.pinch && drags.has(h.id)) {
      const k = page.hit(local);
      if (k >= 0) doc.select(drags.get(h.id), page.tokens[k]);
    }
    if (!h.pinch) drags.delete(h.id);

    // Fist + twist scrolls: clockwise moves down the page.
    if (h.kind === 'hand' && h.fist) {
      const d = fistRoll(h);
      if (Math.abs(d) > 0.004) page.scrollBy(d * SCROLL_PER_RADIAN);
    } else rolls.delete(h.id);
  }

  for (const id of [...rolls.keys()]) if (!hands.some((h) => h.id === id)) rolls.delete(id);
  page.hover = hover;
  buttons.update(dt, pokes, clicks);
}

// ---------- main loop ----------
let t = 0, last = 0;

renderer.setAnimationLoop((time, frame) => {
  const now = time / 1000;
  const dt = Math.min(Math.max(now - last, 0), 1 / 30);
  last = now;
  t += dt;

  if (frame && needRecenter && recenter(frame)) needRecenter = false;

  page.mesh.getWorldPosition(center);
  input.update(frame, dt, center);
  for (const ev of input.events) {
    if (ev === 'recenter') needRecenter = true;
    else if (ev === 'next') page.scrollBy(58 * 6);
    else if (ev === 'prev') page.scrollBy(-58 * 6);
  }
  if (input.wheel) {
    page.scrollBy(input.wheel * 0.8);
    input.wheel = 0;
  }

  updateGestures(input.hands, dt);

  const hint = doc.sel ? 'say the replacement · "delete that" removes it' : '';
  page.status = [speechStatus, hint].filter(Boolean).join('   ·   ');
  page.draw(t);

  handsView.update(input.hands);
  renderer.render(scene, camera);
});
