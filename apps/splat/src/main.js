import * as THREE from 'three';
import { SparkRenderer } from '@sparkjsdev/spark';
import { Input, palmFacesUp } from '../../../shared/input.js';
import { HandsView } from '../../../shared/handsView.js';
import { CloseGesture } from '../../../shared/closeGesture.js';
import { UndoGesture } from '../../../shared/undoGesture.js';
import { HelpGesture } from '../../../shared/helpGesture.js';
import { FistTwist } from '../../../shared/fistTwist.js';
import { PanelGrab } from '../../../shared/panelGrab.js';
import { Pointer } from '../../../shared/pointer.js';
import { PalmDock } from '../../../shared/palmDock.js';
import { NavGrab, NavDrag, resetDolly, StickNav } from '../../../shared/navGrab.js';
import { setupEnterXR } from '../../../shared/xr.js';
import { Scene, SAMPLES, FORMATS } from './scene.js';
import { Measure } from './measure.js';
import { Panel, PANEL_W, PANEL_H } from './panel.js';

const BG = new THREE.Color(0x04050a);
const PRESS_DEPTH = 0.012, HOVER_DEPTH = 0.05;
const SPIN_SPEED = 0.35; // auto-spin (rad/s)

const $ = (id) => document.getElementById(id);
const statusEl = $('status');

// ---------- renderer / scene ----------
// No antialiasing: it doesn't help splats and costs a lot (Spark's advice).
const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = BG;
scene.add(new SparkRenderer({ renderer }));
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.01, 1000);

// The camera sits in a "dolly": every way of moving around (pulling the
// world with one hand, the two-hand grab, the desktop mouse) moves the
// dolly, never the splat. The panel lives in the dolly too, so it stays
// with you.
const dolly = new THREE.Group();
dolly.add(camera);
scene.add(dolly);
const you = () => dolly.scale.x; // your size in the world

// Everything you look at sits in `world`. Zooming with both hands scales
// the world, not you: you stay life size, so the splat stays put in your
// room when you move your head (scaling you made it float).
const world = new THREE.Group();
scene.add(world);
const view = new Scene(world);
const measure = new Measure(view.holder, world);
scene.add(measure.group);

const panel = new Panel();
const desk = new THREE.Group();
desk.add(panel.mesh);
dolly.add(desk);
const panelGrab = new PanelGrab(desk, panel.mesh, PANEL_W, PANEL_H);
// Palm up for a second: the panel comes to your hand.
const palmDock = new PalmDock(desk, panel.mesh, PANEL_H, { busy: () => panelGrab.dragging, onMove: () => (panelGrab.moved = true) });
scene.add(palmDock.group);
// Controllers: a laser pointer for the panel (point + trigger).
const pointer = new Pointer();
scene.add(pointer.group);
// Controllers: the sticks move you (right) and turn you (left).
const stickNav = new StickNav(dolly);

const handsView = new HandsView();
scene.add(handsView.points);
const input = new Input(renderer, camera);
input.origin = dolly; // tracked hands come in world space, wherever the view has gone
const closeGesture = new CloseGesture(renderer);
scene.add(closeGesture.group);
// Peace sign held a second: left hand undo, right hand redo (the view and the splat's orientation).
const undoGesture = new UndoGesture({ undo: () => history('undo'), redo: () => history('redo') });
scene.add(undoGesture.group);
const help = HelpGesture.fromPage();
scene.add(help.group);
const twist = new FistTwist();

// ---------- state ----------
const S = {
  mode: 'move', // or 'measure'
  current: null, // the sample, or the File
  own: null, // the last file opened
  progress: null,
  busy: '',
  note: '',
  passthrough: true,
  spin: false,
};
const say = (t) => { S.note = t; statusEl.textContent = t; };

// ---------- view and orientation history (undo / redo) ----------
// A snapshot is where you are (the dolly) and how the splat sits.
const past = [], future = [];
const snapshot = () => ({ dolly: [dolly.position.toArray(), dolly.quaternion.toArray(), dolly.scale.x], zoom: world.scale.x, pose: view.pose });
function restore(s) {
  dolly.position.fromArray(s.dolly[0]);
  dolly.quaternion.fromArray(s.dolly[1]);
  dolly.scale.setScalar(s.dolly[2]);
  dolly.updateMatrixWorld(true);
  world.scale.setScalar(s.zoom ?? 1);
  world.updateMatrixWorld(true);
  view.pose = s.pose;
  savePose();
}
function remember() {
  past.push(snapshot());
  if (past.length > 100) past.shift();
  future.length = 0;
}
function history(kind) {
  const [from, to] = kind === 'undo' ? [past, future] : [future, past];
  const s = from.pop();
  if (!s) return null;
  to.push(snapshot());
  restore(s);
  return kind === 'undo' ? 'Undo view' : 'Redo view';
}

// Each splat remembers how you turned and sized it.
const poseKey = () => view.info && `vros.splat.pose.${view.info.key}`;
let poseTimer = 0;
function savePose() {
  clearTimeout(poseTimer);
  poseTimer = setTimeout(() => { try { if (poseKey()) localStorage.setItem(poseKey(), JSON.stringify(view.pose)); } catch {} }, 400);
}
function savedPose() {
  try { return JSON.parse(localStorage.getItem(poseKey()) || 'null'); } catch { return null; }
}

// ---------- loading ----------
async function load(source) {
  S.current = source;
  S.busy = `Loading ${source.name}…`;
  S.progress = 0;
  measure.clear();
  try {
    const info = await view.load(source, (p) => (S.progress = p));
    if (!info) return;
    view.pose = savedPose() || view.defaultPose();
    past.length = future.length = 0;
    placeNow();
    say(`${info.name}: ${info.count.toLocaleString()} splats. ${info.object ? 'Pinch to pull yourself around it.' : 'Pinch to pull yourself through it.'}`);
  } catch (err) {
    console.error(err);
    say(`Could not load ${source.name}: ${err.message || err}`);
  } finally {
    S.busy = '';
    S.progress = null;
  }
}

function openFile(file) {
  S.own = file;
  load(file);
}
$('file').accept = FORMATS;
$('file').addEventListener('change', (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (f) openFile(f);
});
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => {
  e.preventDefault();
  const f = e.dataTransfer.files[0];
  if (f) openFile(f);
});
$('load-url').addEventListener('click', () => {
  const url = $('url').value.trim();
  if (url) load({ name: decodeURIComponent(url.split('/').pop().split('?')[0]) || 'splat', url });
});

// ---------- placement ----------
// Objects float in front of you at chest height; places are put around
// you, their middle at your head. The view goes back to life size.
let needPlace = false;
function place(head, fwd) {
  resetDolly(dolly, world);
  const info = view.info;
  if (info?.object) {
    view.holder.position.copy(head).addScaledVector(fwd, 0.9);
    view.holder.position.y = head.y - 0.15;
  } else view.holder.position.copy(head);
  view.holder.updateMatrixWorld(true);
}
function placeNow() {
  if (renderer.xr.isPresenting) needPlace = true;
  else placeDesktop();
}
// Desktop: a step back from where a headset would put you, aimed a little
// left so the page overlay doesn't cover the splat.
function placeDesktop() {
  camera.position.set(0, 1.5, 1.7);
  camera.lookAt(0.2, 1.35, 0);
  place(new THREE.Vector3(0.12, 1.5, 0.9), new THREE.Vector3(0, 0, -1));
  if (!panelGrab.moved) {
    desk.position.set(0.62, 1.12, 0.55);
    desk.scale.setScalar(1);
    desk.lookAt(camera.position);
  }
}
function placeXR(frame) {
  const pose = frame.getViewerPose(renderer.xr.getReferenceSpace());
  if (!pose) return false;
  const p = pose.transform.position, q = pose.transform.orientation;
  const head = new THREE.Vector3(p.x, p.y, p.z);
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w));
  fwd.y = 0;
  if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
  fwd.normalize();
  place(head, fwd);
  if (!panelGrab.moved) {
    const left = new THREE.Vector3(fwd.z, 0, -fwd.x);
    desk.position.copy(head).addScaledVector(fwd, 0.4).addScaledVector(left, 0.28);
    desk.position.y = head.y - 0.36;
    desk.lookAt(head);
    desk.updateMatrixWorld(true);
  }
  return true;
}
// Reset the view (and bring the panel back), as an undoable step.
function resetView() {
  remember();
  palmDock.release();
  panelGrab.moved = false;
  placeNow();
}

// ---------- the panel ----------
function panelState() {
  const xr = renderer.xr.isPresenting, ar = xr && xrSetup.mode === 'immersive-ar';
  const info = view.info, cur = S.current;
  const scenes = SAMPLES.map((s) => ({ id: `sample:${s.id}`, label: s.name, on: cur === s }));
  scenes.push(S.own ? { id: 'own', label: S.own.name.replace(/\.[^.]+$/, ''), sub: 'your file', on: cur === S.own } : { id: 'open', label: xr ? 'Your files: window mode' : 'OPEN A FILE…', off: xr, strong: !xr });
  const len = measure.length;
  return {
    title: info ? `SPLAT · ${info.name}` : 'SPLAT',
    status: S.busy || S.note || (info ? `${info.count.toLocaleString()} splats` : 'Pick a scene to load.'),
    progress: S.progress,
    rows: [
      { label: 'SCENES', cols: 4, items: scenes },
      { label: 'TOOLS', items: [
        { id: 'move', label: 'MOVE', sub: 'pinch: pull the world', on: S.mode === 'move' },
        { id: 'measure', label: 'MEASURE', sub: len != null ? fmt(len) : 'pinch two points', on: S.mode === 'measure' },
        { id: 'clear', label: 'CLEAR', sub: 'the measurement', off: !measure.points.length },
        { id: 'undo', label: '↶ VIEW', off: !past.length },
        { id: 'redo', label: '↷ VIEW', off: !future.length },
        { id: 'reset', label: 'RESET VIEW', sub: 'life size, in front' },
      ] },
      { label: 'ORIENTATION', items: [
        { id: 'flip', label: 'FLIP', sub: 'upside down?', off: !info },
        { id: 'turn:x', label: 'TURN X', sub: '90°', off: !info },
        { id: 'turn:y', label: 'TURN Y', sub: '90°', off: !info },
        { id: 'turn:z', label: 'TURN Z', sub: '90°', off: !info },
        { id: 'smaller', label: 'SIZE −', sub: info ? `× ${+view.holder.scale.x.toPrecision(3)}` : '', off: !info },
        { id: 'bigger', label: 'SIZE +', sub: 'or fist + twist: spin', off: !info },
      ] },
      { label: 'DISPLAY', items: [
        { id: 'passthrough', label: 'PASSTHROUGH', sub: ar ? (S.passthrough ? 'on: see your room' : 'off: dark background') : 'in mixed reality only', on: ar && S.passthrough, off: !ar },
        { id: 'spin', label: 'AUTO SPIN', sub: 'turntable', on: S.spin, off: !info },
        { id: 'unorient', label: 'RESET ORIENTATION', sub: 'as it was loaded', off: !info },
      ] },
    ],
  };
}
const fmt = (m) => (m < 1 ? `${(m * 100).toFixed(1)} cm` : `${m.toFixed(2)} m`);

function press(id) {
  if (!id) return;
  panel.flash(id);
  S.note = '';
  if (id.startsWith('sample:')) return load(SAMPLES.find((s) => s.id === id.slice(7)));
  if (id.startsWith('turn:')) { remember(); view.turn(id.slice(5)); return savePose(); }
  ({
    own: () => S.own && load(S.own),
    open: () => $('file').click(),
    move: () => (S.mode = 'move'),
    measure: () => (S.mode = 'measure'),
    clear: () => measure.clear(),
    undo: () => history('undo'),
    redo: () => history('redo'),
    reset: () => resetView(),
    flip: () => { remember(); view.flip(); savePose(); },
    smaller: () => { remember(); view.scaleBy(1 / 1.25); savePose(); },
    bigger: () => { remember(); view.scaleBy(1.25); savePose(); },
    passthrough: () => { S.passthrough = !S.passthrough; updateBackground(); },
    spin: () => (S.spin = !S.spin),
    unorient: () => { remember(); view.pose = view.defaultPose(); savePose(); },
  })[id]?.();
}

function updateBackground() {
  scene.background = renderer.xr.isPresenting && xrSetup.mode === 'immersive-ar' && S.passthrough ? null : BG;
}

// ---------- hands ----------
const wasPinching = new Map();
const pokeState = new Map();
const local = new THREE.Vector3();
let drag = null, dragHand = null, nav = null, twistHand = null, fistsHeld = 0;
let lastPoint = null; // { hand, t, before }: a measuring point just dropped, in case its pinch becomes a two-hand grab
const GRAB_WINDOW = 0.35; // s

function panelLocal(point) {
  panel.mesh.worldToLocal(local.copy(point));
  local.z *= desk.scale.x; // press depth in meters, whatever the panel's size
  return local;
}
const insidePanel = (l) => Math.abs(l.x) < PANEL_W / 2 && Math.abs(l.y) < PANEL_H / 2;

function updateHands(hands, dt) {
  for (const h of hands) {
    if (h.kind === 'mouse') continue;
    const was = wasPinching.get(h.id), start = h.pinch && !was;
    wasPinching.set(h.id, h.pinch);
    if (!h.pinch && lastPoint?.hand === h.id) lastPoint = null; // that pinch was just a point

    // Poke the panel with an index fingertip; a controller pulls its trigger on it.
    let onPanel = false;
    if (h.kind === 'hand') {
      const l = panelLocal(h.indexTip);
      const inside = insidePanel(l);
      const deep = inside && l.z < PRESS_DEPTH && l.z > -0.04;
      if (deep && pokeState.get(h.id) === false) press(panel.hit(l));
      pokeState.set(h.id, deep ? true : inside && l.z < HOVER_DEPTH ? false : undefined);
      onPanel = inside && l.z < HOVER_DEPTH && l.z > -0.06;
    } else if (start) {
      const l = panelLocal(h.pinchPoint);
      if (insidePanel(l) && Math.abs(l.z) < 0.05) {
        press(panel.hit(l));
        onPanel = true;
      }
    }

    // A pinch: pull the world (move) or drop a measuring point (measure).
    // A second hand joining a pinch is the start of a two-hand grab instead.
    const other = hands.some((o) => o !== h && o.kind !== 'mouse' && o.pinch);
    if (start && !onPanel && !nav && !other) {
      if (S.mode === 'measure' && view.info) {
        lastPoint = { hand: h.id, t: performance.now() / 1000, before: [...measure.points] };
        measure.add(h.pinchPoint);
      }
      else if (!drag) {
        remember();
        drag = new NavDrag(dolly, h.realPinch);
        dragHand = h.id;
      }
    }
  }

  // Both hands pinching: move, zoom and turn the view (takes over a one-hand pull).
  const pinching = hands.filter((h) => h.kind !== 'mouse' && h.pinch);
  // starts only with both palms up (then keeps going as your hands turn)
  if (pinching.length >= 2 && (nav || pinching.every((h) => palmFacesUp(h)))) {
    if (!nav) {
      // the first hand's pinch was the start of this grab, not a measuring point
      if (lastPoint && performance.now() / 1000 - lastPoint.t < GRAB_WINDOW) measure.points = lastPoint.before;
      lastPoint = null;
      if (!drag) remember();
      nav = new NavGrab(dolly, pinching[0].realPinch, pinching[1].realPinch, { world, min: 0.02, max: 50 });
    }
    drag = null;
    nav.update(pinching[0].realPinch, pinching[1].realPinch);
  } else {
    nav = null;
    const h = drag && hands.find((x) => x.id === dragHand && x.pinch);
    if (h) drag.update(h.realPinch);
    else drag = null;
  }

  // One fist + twist: spin the splat like a turntable. Two fists held a
  // second: reset the view.
  const fists = hands.filter((h) => h.kind === 'hand' && h.fist);
  twist.prune(hands);
  for (const h of hands) if (!h.fist) twist.release(h);
  fistsHeld = fists.length === 2 ? fistsHeld + dt : 0;
  if (fistsHeld > 1) {
    fistsHeld = -1e9; // once per hold
    resetView();
  }
  if (fists.length === 1 && view.info) {
    const h = fists[0], roll = twist.roll(h);
    if (twistHand !== h.id) {
      twistHand = h.id;
      remember();
    } else if (roll) {
      view.spin(-roll);
      savePose();
    }
  } else twistHand = null;
}

// ---------- the mouse (desktop preview) ----------
// Click the panel; left-drag pulls the world; right-drag turns you around
// the splat; the wheel moves you closer or further.
const raycaster = new THREE.Raycaster();
let mouse = null;
const el = renderer.domElement;
el.addEventListener('pointerdown', (e) => {
  if (renderer.xr.isPresenting) return;
  raycaster.setFromCamera(new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), camera);
  panel.mesh.updateMatrixWorld();
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(panel.mesh.getWorldDirection(new THREE.Vector3()), panel.mesh.getWorldPosition(new THREE.Vector3()));
  const p = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
  if (p) {
    const l = panelLocal(p);
    if (insidePanel(l)) return press(panel.hit(l));
  }
  remember();
  mouse = { x: e.clientX, y: e.clientY, turn: e.button === 2 || e.shiftKey };
});
el.addEventListener('pointermove', (e) => {
  if (!mouse) return;
  const dx = e.clientX - mouse.x, dy = e.clientY - mouse.y;
  mouse.x = e.clientX;
  mouse.y = e.clientY;
  if (mouse.turn) orbit(-dx * 0.006);
  else {
    // pull the world: moving the mouse right drags the world right
    const k = 0.0015 * Math.max(0.3, camera.getWorldPosition(new THREE.Vector3()).distanceTo(splatCenter()));
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
    dolly.position.addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
  }
});
const mouseUp = () => (mouse = null);
el.addEventListener('pointerup', mouseUp);
el.addEventListener('pointercancel', mouseUp);
el.addEventListener('contextmenu', (e) => e.preventDefault());

// Where the splat is in the world (its holder sits in the zoomed world group;
// placement happens with the world at scale 1, so it's set directly).
const splatCenter = () => view.holder.getWorldPosition(new THREE.Vector3());

// Turn the view about the vertical through the splat's middle.
function orbit(rad) {
  const c = splatCenter();
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rad);
  dolly.position.sub(c).applyQuaternion(q).add(c);
  dolly.quaternion.premultiply(q);
  dolly.updateMatrixWorld(true);
}

let wheelTimer = 0;
function wheelZoom() {
  if (!input.wheel) return;
  if (!wheelTimer) remember();
  clearTimeout(wheelTimer);
  wheelTimer = setTimeout(() => (wheelTimer = 0), 500);
  const eye = camera.getWorldPosition(new THREE.Vector3());
  const toward = splatCenter().sub(eye);
  const step = THREE.MathUtils.clamp(-input.wheel * 0.001, -0.5, 0.5) * Math.max(0.2, toward.length());
  dolly.position.addScaledVector(camera.getWorldDirection(new THREE.Vector3()), step);
  input.wheel = 0;
}

addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, textarea')) return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'z') return history(e.shiftKey ? 'redo' : 'undo');
  if ((e.ctrlKey || e.metaKey) && k === 'y') return history('redo');
  const map = { f: 'flip', x: 'turn:x', y: 'turn:y', z: 'turn:z', '-': 'smaller', '=': 'bigger', '+': 'bigger', r: 'reset', s: 'spin' };
  if (map[k]) press(map[k]);
});

// ---------- XR session ----------
const xrSetup = setupEnterXR({ renderer, button: $('enter'), status: statusEl });
renderer.xr.addEventListener('sessionstart', () => {
  document.body.classList.add('in-xr');
  handsView.points.material.uniforms.uScale.value = 1000;
  panelGrab.visible = true;
  panelGrab.moved = false;
  palmDock.release();
  updateBackground();
  needPlace = true;
});
renderer.xr.addEventListener('sessionend', () => {
  document.body.classList.remove('in-xr');
  help.hide();
  panelGrab.visible = false;
  panelGrab.moved = false;
  palmDock.release();
  updateBackground();
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
placeDesktop();

// ---------- main loop ----------
let last = 0;
renderer.setAnimationLoop((time, frame) => {
  const now = time / 1000;
  const dt = Math.min(Math.max(now - last, 0), 1 / 30);
  last = now;
  if (frame && needPlace && placeXR(frame)) {
    needPlace = false;
    help.hint(renderer.xr.getCamera());
  }
  input.update(frame, dt, splatCenter());
  for (const ev of input.events) if (ev === 'recenter') resetView();

  const viewer = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  const helpHand = help.update(input.hands, dt, viewer);
  closeGesture.update(input.hands, dt, viewer);
  const peace = undoGesture.update(input.hands, dt, viewer);
  const palmHand = palmDock.update(input.hands.filter((h) => h !== helpHand && !peace.includes(h)), dt, viewer);
  const carrying = panelGrab.update(input.hands.filter((h) => h !== helpHand && !peace.includes(h) && h !== palmHand), dt, viewer);
  const pointing = pointer.update(input.hands, [{ object: panel.mesh, w: PANEL_W, h: PANEL_H, press: (l) => press(panel.hit(l)) }], you());
  const hands = input.hands.filter((h) => h !== helpHand && !peace.includes(h) && h !== palmHand && !carrying.has(h.id) && !pointing.has(h.id) && !h.aim);
  if (stickNav.update(input.hands, dt, viewer)) remember(); // undo goes back to before you moved
  updateHands(hands, dt);
  wheelZoom();
  if (S.spin && view.info) view.spin(SPIN_SPEED * dt);
  measure.update(viewer, you());
  panel.draw(panelState());
  handsView.update(input.hands, you());
  renderer.render(scene, camera);
});

load(SAMPLES[0]);
