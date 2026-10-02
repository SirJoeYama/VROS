import * as THREE from 'three';
import { Input } from '../../../shared/input.js';
import { HandsView } from '../../../shared/handsView.js';
import { CloseGesture } from '../../../shared/closeGesture.js';
import { UndoGesture } from '../../../shared/undoGesture.js';
import { HelpGesture } from '../../../shared/helpGesture.js';
import { PanelGrab } from '../../../shared/panelGrab.js';
import { Pointer } from '../../../shared/pointer.js';
import { PalmDock } from '../../../shared/palmDock.js';
import { setupEnterXR } from '../../../shared/xr.js';
import { RIGS, rigUrl, modelUrl } from '../../rigger/src/rigs.js';
import { loadModel, loadGLTF } from '../../rigger/src/model.js';
import { EditRig } from '../../rigger/src/skeleton.js';
import { Rigged } from '../../rigger/src/rigged.js';
import { FPS, FRAME, SIDES, capture, clean, handKind } from './capture.js';
import { Solver, LEGS } from './solve.js';
import { listTakes, saveTake, deleteTake } from './takes.js';
import { Panel, PANEL_W, PANEL_H } from './panel.js';

const BG = new THREE.Color(0x04050a);
const HUMAN = RIGS.find((r) => r.id === 'human');
const PRESS_DEPTH = 0.012, HOVER_DEPTH = 0.05;
const COUNT = 3; // countdown before calibrating and recording (s)
const LENGTHS = [0, 5, 10, 30, 60]; // recording length (s); 0 = until STOP
const VIEWS = [
  { id: 'mirror', name: 'Mirror', sub: 'in front, like a mirror' },
  { id: 'facing', name: 'Facing', sub: 'in front, facing you' },
  { id: 'side', name: 'Side', sub: 'beside you, in profile' },
];
const MAX_TAKES = 8; // shown on the panel (the newest)

const $ = (id) => document.getElementById(id);
const statusEl = $('status');

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = BG;
scene.add(new THREE.HemisphereLight(0xf0f3ff, 0x202040, 1.8));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(1, 3, 2);
scene.add(sun);
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.01, 100);

// You stay where you are in your room (moving the view would end up in the
// recording), so there's no dolly here. The mannequin stands on a `stage`:
// its skeleton is solved in "solve space" (you at the origin at
// calibration, facing +z, at the skeleton's size) and the stage shows that
// space in front of you (mirrored, facing you or beside you), at your size.
const stage = new THREE.Group();
scene.add(stage);
const mirror = new THREE.Group(); // the left-right flip of the mirror view
stage.add(mirror);
const disc = new THREE.Mesh(
  new THREE.RingGeometry(0.3, 0.34, 64).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0x9fb8ff, transparent: true, opacity: 0.35, depthWrite: false }),
);
mirror.add(disc);

const label = makeLabel(); // the countdown, ● REC, what to do
scene.add(label.sprite);

const panel = new Panel();
const desk = new THREE.Group();
desk.add(panel.mesh);
scene.add(desk);
const panelGrab = new PanelGrab(desk, panel.mesh, PANEL_W, PANEL_H);
const palmDock = new PalmDock(desk, panel.mesh, PANEL_H, { busy: () => panelGrab.dragging, onMove: () => (panelGrab.moved = true) });
scene.add(palmDock.group);
// Controllers: a laser pointer for the panel (point + trigger).
const pointer = new Pointer();
scene.add(pointer.group);

const handsView = new HandsView();
scene.add(handsView.points);
const input = new Input(renderer, camera);
const closeGesture = new CloseGesture(renderer);
scene.add(closeGesture.group);
// Peace sign held a second: left hand undo, right hand redo (trims, legs, deleted and new takes).
const undoGesture = new UndoGesture({ undo: () => history('undo'), redo: () => history('redo') });
scene.add(undoGesture.group);
const help = HelpGesture.fromPage();
scene.add(help.group);

// ---------- state ----------
const S = {
  ready: false, // the solver and the mannequin are loaded
  calib: loadCalib(), // your T-pose, kept between visits
  phase: 'idle', // 'calibrate' / 'count' (countdowns), 'rec'
  countT: 0,
  rec: null, // { frames, acc, t }
  length: 0,
  view: 'mirror',
  legs: 'planted',
  takes: [],
  sel: null, // the selected take, or null: live
  t: 0, // the playhead (s)
  playing: true,
  note: '',
};
const say = (t) => { S.note = t; statusEl.textContent = t; };
const sel = () => S.takes.find((k) => k.id === S.sel) || null;
const takeLen = (k) => k.frames.length / FRAME / k.fps;

function loadCalib() {
  try { return JSON.parse(localStorage.getItem('vros.mocap.calib') || 'null'); } catch { return null; }
}
function storeCalib(c) {
  try { localStorage.setItem('vros.mocap.calib', JSON.stringify(c)); } catch {}
}

// ---------- the solver and the mannequin ----------
let solver = null, rigged = null, using = null;
async function init() {
  say('Getting the mannequin ready…');
  try {
    const [s, model, { scene: armature }] = await Promise.all([
      Solver.load(),
      loadModel(modelUrl(HUMAN), { sample: true, name: 'Human' }),
      loadGLTF(rigUrl(HUMAN)),
    ]);
    solver = s;
    // Rigger's own skinning, on its sample model: what you see here is what
    // you'll get there.
    mirror.add(armature);
    mirror.updateMatrixWorld(true);
    rigged = new Rigged(model, new THREE.Group(), new EditRig(armature, HUMAN), mirror);
    armature.removeFromParent();
    S.takes = await listTakes().catch(() => []);
    S.ready = true;
    useCalib(S.calib);
    placeNow();
    if (!renderer.xr.isPresenting) say('Recording happens in the headset; here you can play back and trim takes.');
    else say(S.calib ? 'Ready. RECORD when you are (or CALIBRATE again).' : 'First, CALIBRATE: stand in a T-pose.');
  } catch (err) {
    console.error(err);
    say('Could not load the mannequin: ' + (err.message || err));
  }
}

// The calibration the solver works with: yours (live) or a take's.
function useCalib(c) {
  if (!solver || c === using) return;
  using = c;
  solver.reset();
  if (c) solver.use(c);
}

// The mannequin takes the solver's pose (same skeleton, same bone order).
function showPose() {
  solver.bones.forEach((b, i) => {
    rigged.bones[i].position.copy(b.position);
    rigged.bones[i].quaternion.copy(b.quaternion);
  });
}
function showRest() {
  solver.reset();
  solver.bones.forEach((b, i) => {
    b.position.copy(solver.rest[i].p);
    b.quaternion.copy(solver.rest[i].q);
  });
  showPose();
}

// ---------- placement ----------
// `anchor`: where you stood and which way you faced (calibration, or the
// start of the session). The stage is put relative to it.
let anchor = { pos: new THREE.Vector3(0, 0, 0), fwd: new THREE.Vector3(0, 0, -1) };
let needPlace = false;
function placeStage() {
  const { pos, fwd } = anchor, right = new THREE.Vector3(-fwd.z, 0, fwd.x);
  const yaw = Math.atan2(fwd.x, fwd.z); // turns +z to your forward
  const k = 1 / (S.calib?.scale || 1); // the skeleton's size → yours
  // The solve space's origin is where you calibrated, so the mannequin
  // walks when you walk; the stage puts that origin in front of (or beside) you.
  if (S.view === 'side') {
    stage.position.copy(pos).addScaledVector(fwd, 0.9).addScaledVector(right, 1.3);
    stage.rotation.set(0, yaw, 0);
  } else {
    stage.position.copy(pos).addScaledVector(fwd, 2.2);
    stage.rotation.set(0, yaw + Math.PI, 0);
  }
  stage.scale.setScalar(k);
  mirror.scale.x = S.view === 'mirror' ? -1 : 1;
  stage.updateMatrixWorld(true);
}
function placePanel(head, fwd) {
  if (panelGrab.moved) return;
  const left = new THREE.Vector3(fwd.z, 0, -fwd.x);
  desk.position.copy(head).addScaledVector(fwd, 0.42).addScaledVector(left, 0.34);
  desk.position.y = head.y - 0.38;
  desk.scale.setScalar(1);
  desk.lookAt(head);
  desk.updateMatrixWorld(true);
}
function placeNow() {
  if (renderer.xr.isPresenting) needPlace = true;
  else placeDesktop();
}
function placeDesktop() {
  anchor = { pos: new THREE.Vector3(0, 0, 0), fwd: new THREE.Vector3(0, 0, -1) };
  camera.position.set(0.5, 1.45, 0.9);
  camera.lookAt(0.05, 1.0, -2.2);
  placeStage();
  if (!panelGrab.moved) {
    desk.position.set(0.62, 1.14, 0.12);
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
  if (!S.calib) anchor = { pos: head.clone().setY(0), fwd };
  else anchorFromCalib(S.calib);
  placeStage();
  placePanel(head, fwd);
  return true;
}
function anchorFromCalib(c) {
  const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion().fromArray(c.align).invert());
  anchor = { pos: new THREE.Vector3().fromArray(c.origin), fwd };
}

// ---------- the label over the mannequin ----------
function makeLabel() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 256;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.renderOrder = 30;
  sprite.scale.set(1, 0.25, 1);
  let key = '';
  return {
    sprite,
    set(big, small = '', color = '#dfe6ff') {
      sprite.visible = !!(big || small);
      const k = big + small + color;
      if (k === key) return;
      key = k;
      const g = canvas.getContext('2d');
      g.clearRect(0, 0, 1024, 256);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = color;
      g.font = '300 120px system-ui, -apple-system, "Segoe UI", sans-serif';
      g.fillText(big, 512, 100);
      g.fillStyle = '#c5cdee';
      g.font = '300 44px system-ui, -apple-system, "Segoe UI", sans-serif';
      g.fillText(small, 512, 210);
      texture.needsUpdate = true;
    },
  };
}
function updateLabel() {
  const top = new THREE.Vector3(0, 2.25, 0).applyMatrix4(stage.matrixWorld);
  label.sprite.position.copy(top);
  label.sprite.scale.set(1, 0.25, 1).multiplyScalar(stage.scale.x);
  const left = Math.ceil(COUNT - S.countT);
  if (S.phase === 'calibrate') label.set(String(left), 'T-pose: arms out, palms down, look ahead');
  else if (S.phase === 'count') label.set(String(left), 'get ready…');
  else if (S.phase === 'rec') label.set(`● ${S.rec.t.toFixed(1)} s`, S.length ? `of ${S.length} s` : 'STOP on the panel when done', '#ff6b7a');
  else if (!S.calib && S.ready && renderer.xr.isPresenting) label.set('', 'CALIBRATE first: hold a T-pose');
  else label.set('');
}

// ---------- calibration and recording ----------
const live = new Float32Array(FRAME);
let liveOk = false; // this frame has tracking in it (the headset)

function startCountdown(phase) {
  if (!renderer.xr.isPresenting) return say('Calibrating and recording need the headset: ENTER XR first.');
  S.sel = null;
  S.phase = phase;
  S.countT = 0;
}

function calibrate() {
  if (SIDES.some((s) => !handKind(live, s))) {
    S.phase = 'idle';
    return say("Couldn't see both hands. Keep them in view, out to your sides, and CALIBRATE again.");
  }
  S.calib = solver.calibrate(live);
  storeCalib(S.calib);
  using = null;
  useCalib(S.calib);
  anchorFromCalib(S.calib);
  placeStage();
  S.phase = 'idle';
  say(`Calibrated (your eyes at ${(S.calib.height - 0.11).toFixed(2)} m). RECORD when you're ready.`);
}

function startRecording() {
  if (!S.calib) return say('CALIBRATE first: stand in a T-pose.');
  startCountdown('count');
}

async function stopRecording() {
  const frames = S.rec.frames;
  S.phase = 'idle';
  S.rec = null;
  if (frames.length < FPS / 2) return say('That was too short to keep.');
  const packed = new Float32Array(frames.length * FRAME);
  frames.forEach((f, i) => packed.set(f, i * FRAME));
  const n = Math.max(0, ...S.takes.map((k) => +(k.name.match(/^Take (\d+)$/)?.[1] || 0))) + 1;
  const take = { id: `t${Date.now().toString(36)}`, name: `Take ${n}`, created: Date.now(), fps: FPS, frames: packed, calib: S.calib, inT: 0, outT: frames.length / FPS, legs: S.legs };
  record({ id: take.id, state: null });
  S.takes.push(take);
  select(take.id);
  await bakeAndSave(take);
  say(`${take.name} saved: ${(frames.length / FPS).toFixed(1)} s. It's in Rigger now, for the human skeleton (4 ANIMATE, marked ●).`);
}

// ---------- takes ----------
const cleaned = new Map(); // take id → its frames, cleaned
function framesOf(take) {
  let f = cleaned.get(take.id);
  if (!f) {
    const raw = [];
    for (let i = 0; i < take.frames.length; i += FRAME) raw.push(take.frames.subarray(i, i + FRAME));
    cleaned.set(take.id, (f = clean(raw)));
  }
  return f;
}

// The clip Rigger gets: the kept part (in → out), with the take's legs.
async function bakeAndSave(take) {
  await solver.loadLegs(take.legs).catch(() => {});
  const all = framesOf(take);
  const a = Math.round(take.inT * take.fps), b = Math.max(a + 2, Math.round(take.outT * take.fps));
  useCalib(take.calib);
  const clip = solver.bake(take.name, all.slice(a, b), take.fps, take.legs);
  using = null; // the solver was reset by baking
  take.clip = THREE.AnimationClip.toJSON(clip);
  try {
    await saveTake(take);
  } catch (err) {
    console.error(err);
    say(`Couldn't save ${take.name} in the browser: ${err.message || err}`);
  }
}
const saveTimers = new Map();
function saveSoon(take) {
  clearTimeout(saveTimers.get(take.id));
  saveTimers.set(take.id, setTimeout(() => bakeAndSave(take), 500));
}

function select(id) {
  S.sel = id;
  const k = sel();
  if (!k) return;
  S.legs = k.legs;
  S.t = k.inT;
  S.playing = true;
  using = null;
  solver?.loadLegs(k.legs);
}

function edit(take, change) {
  record({ id: take.id, state: { ...take } });
  Object.assign(take, change);
  saveSoon(take);
}

// ---------- undo / redo ----------
// Each step is { id, state }: a take as it was (or null: it didn't exist).
const past = [], future = [];
function record(step) {
  past.push(step);
  if (past.length > 60) past.shift();
  future.length = 0;
}
function history(kind) {
  const [from, to] = kind === 'undo' ? [past, future] : [future, past];
  const step = from.pop();
  if (!step) return null;
  const now = S.takes.find((k) => k.id === step.id);
  to.push({ id: step.id, state: now ? { ...now } : null });
  if (!step.state) {
    S.takes = S.takes.filter((k) => k !== now);
    cleaned.delete(step.id);
    deleteTake(step.id).catch(() => {});
    if (S.sel === step.id) S.sel = null;
  } else {
    const k = now || step.state;
    Object.assign(k, step.state);
    if (!now) S.takes.push(k);
    S.takes.sort((a, b) => a.created - b.created);
    select(k.id);
    bakeAndSave(k);
  }
  return kind === 'undo' ? 'Undo' : 'Redo';
}

// ---------- the panel ----------
const fmt = (s) => `${s.toFixed(1)} s`;
function panelState() {
  const k = sel(), rec = S.phase === 'rec', counting = S.phase === 'calibrate' || S.phase === 'count';
  const xr = renderer.xr.isPresenting, view = VIEWS.find((v) => v.id === S.view);
  const takes = S.takes.slice(-MAX_TAKES).map((t) => ({ id: `take:${t.id}`, label: t.name, sub: `${fmt(t.outT - t.inT)} · ${LEGS.find((l) => l.id === t.legs)?.name.toLowerCase()}`, on: t.id === S.sel }));
  if (!takes.length) takes.push({ id: 'none', label: 'No takes yet', sub: 'RECORD one', off: true });
  const busy = rec || counting;
  return {
    title: k ? `MOCAP · ${k.name}` : 'MOCAP · live',
    status: S.note || (S.ready ? '' : 'Loading…'),
    timeline: k && { t: S.t, in: k.inT, out: k.outT, len: takeLen(k) },
    rows: [
      { label: 'CAPTURE', items: [
        { id: 'calibrate', label: 'CALIBRATE', sub: S.calib ? 'again: T-pose' : 'T-pose first', strong: !S.calib, on: S.phase === 'calibrate', off: !S.ready || rec || !xr },
        { id: 'record', label: rec ? '■ STOP' : '● RECORD', sub: rec ? fmt(S.rec.t) : counting && S.phase === 'count' ? 'get ready…' : xr ? '3 s countdown' : 'in the headset', on: busy && S.phase !== 'calibrate', strong: !!S.calib && !busy, off: !S.ready || !S.calib || !xr || S.phase === 'calibrate' },
        { id: 'length', label: 'LENGTH', sub: S.length ? `${S.length} s` : 'until STOP', off: busy },
        { id: 'view', label: view.name.toUpperCase(), sub: view.sub },
      ] },
      { label: 'LEGS (the headset doesn’t see them)', items: LEGS.map((l) => ({ id: `legs:${l.id}`, label: l.name.toUpperCase(), sub: l.id === 'planted' ? 'feet step to follow' : 'from the library', on: S.legs === l.id, off: rec })) },
      { label: 'TAKES (also in Rigger, for the human skeleton)', cols: 4, items: takes.map((t) => ({ ...t, off: t.off || busy })) },
      { label: 'TAKE', items: [
        { id: 'live', label: 'LIVE', sub: 'follow me', on: !k, off: busy },
        { id: 'play', label: S.playing ? '❚❚ PAUSE' : '▶ PLAY', sub: 'the kept part', off: !k },
        { id: 'in', label: 'SET IN', sub: k ? fmt(k.inT) : 'start here', off: !k },
        { id: 'out', label: 'SET OUT', sub: k ? fmt(k.outT) : 'end here', off: !k },
        { id: 'full', label: 'FULL', sub: 'undo the trim', off: !k || (k.inT === 0 && Math.abs(k.outT - takeLen(k)) < 1e-3) },
        { id: 'delete', label: 'DELETE', sub: 'peace sign undoes', off: !k },
      ] },
    ],
  };
}

function press(id) {
  if (!id) return;
  // While recording, the panel only stops it (a stray poke would be lost work).
  if (S.phase === 'rec' && id !== 'record') return;
  if (!id.startsWith('timeline:')) panel.flash(id);
  const k = sel();
  if (id.startsWith('timeline:') && k) {
    S.t = THREE.MathUtils.clamp(+id.slice(9), 0, takeLen(k));
    S.playing = false;
    using = null;
    return;
  }
  if (id.startsWith('take:')) return select(id.slice(5));
  if (id.startsWith('legs:')) {
    S.legs = id.slice(5);
    solver?.loadLegs(S.legs);
    solver?.reset();
    if (k && k.legs !== S.legs) edit(k, { legs: S.legs });
    return;
  }
  S.note = '';
  ({
    calibrate: () => startCountdown('calibrate'),
    record: () => (S.phase === 'rec' ? stopRecording() : S.phase === 'count' ? (S.phase = 'idle') : startRecording()),
    length: () => (S.length = LENGTHS[(LENGTHS.indexOf(S.length) + 1) % LENGTHS.length]),
    view: () => {
      S.view = VIEWS[(VIEWS.findIndex((v) => v.id === S.view) + 1) % VIEWS.length].id;
      placeStage();
    },
    live: () => { S.sel = null; using = null; },
    play: () => (S.playing = !S.playing),
    in: () => k && edit(k, { inT: Math.min(S.t, k.outT - 0.2) }),
    out: () => k && edit(k, { outT: Math.max(S.t, k.inT + 0.2) }),
    full: () => k && edit(k, { inT: 0, outT: takeLen(k) }),
    delete: () => {
      if (!k) return;
      record({ id: k.id, state: { ...k } });
      S.takes = S.takes.filter((x) => x !== k);
      cleaned.delete(k.id);
      deleteTake(k.id).catch(() => {});
      S.sel = null;
      say(`Deleted ${k.name}. Peace sign (left hand) to bring it back.`);
    },
  })[id]?.();
}

// ---------- each frame: live, countdowns, recording, playback ----------
function step(dt, raw) {
  if (!S.ready) return;
  if (S.phase === 'calibrate' || S.phase === 'count') {
    S.countT += raw;
    if (S.countT >= COUNT) {
      if (S.phase === 'calibrate') calibrate();
      else {
        S.phase = 'rec';
        S.rec = { frames: [], acc: 1 / FPS, t: 0 };
      }
    }
  }
  if (S.phase === 'rec') {
    // 30 a second, on real time (a slow frame is filled by repeating it)
    S.rec.acc += raw;
    S.rec.t += raw;
    while (S.rec.acc >= 1 / FPS) {
      S.rec.frames.push(live.slice());
      S.rec.acc -= 1 / FPS;
    }
    if (S.length && S.rec.t >= S.length) stopRecording();
  }

  const k = S.phase === 'idle' ? sel() : null;
  if (k) {
    useCalib(k.calib);
    const frames = framesOf(k);
    if (S.playing) {
      S.t += dt;
      if (S.t > k.outT || S.t < k.inT) {
        S.t = k.inT;
        solver.reset(); // the feet start over too
      }
    }
    const i = THREE.MathUtils.clamp(Math.round(S.t * k.fps), 0, frames.length - 1);
    solver.pose(frames[i], S.t - k.inT, k.legs);
    showPose();
  } else if (S.calib && liveOk) {
    useCalib(S.calib);
    solver.pose(live, performance.now() / 1000, S.legs);
    showPose();
  } else showRest();
}

// ---------- hands on the panel ----------
const pokeState = new Map(), wasPinching = new Map();
const local = new THREE.Vector3();
function panelLocal(point) {
  panel.mesh.worldToLocal(local.copy(point));
  local.z *= desk.scale.x;
  return local;
}
const insidePanel = (l) => Math.abs(l.x) < PANEL_W / 2 && Math.abs(l.y) < PANEL_H / 2;
function pokePanel(hands) {
  for (const h of hands) {
    if (h.kind !== 'hand') continue;
    const l = panelLocal(h.indexTip);
    const inside = insidePanel(l);
    const deep = inside && l.z < PRESS_DEPTH && l.z > -0.04;
    const id = deep && panel.hit(l);
    if (deep && pokeState.get(h.id) === false) press(id);
    else if (deep && id?.startsWith('timeline:')) press(id); // keep scrubbing
    pokeState.set(h.id, deep ? true : inside && l.z < HOVER_DEPTH ? false : undefined);
    wasPinching.set(h.id, h.pinch);
  }
}

// ---------- the mouse and keys (desktop) ----------
const raycaster = new THREE.Raycaster();
let mouseDown = false;
function mousePanel(e) {
  raycaster.setFromCamera(new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), camera);
  panel.mesh.updateMatrixWorld();
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(panel.mesh.getWorldDirection(new THREE.Vector3()), panel.mesh.getWorldPosition(new THREE.Vector3()));
  const p = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
  if (!p) return null;
  const l = panelLocal(p);
  return insidePanel(l) ? panel.hit(l) : null;
}
const el = renderer.domElement;
el.addEventListener('pointerdown', (e) => {
  if (renderer.xr.isPresenting) return;
  mouseDown = true;
  press(mousePanel(e));
});
el.addEventListener('pointermove', (e) => {
  if (!mouseDown) return;
  const id = mousePanel(e);
  if (id?.startsWith('timeline:')) press(id);
});
addEventListener('pointerup', () => (mouseDown = false));
addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, textarea')) return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'z') return history(e.shiftKey ? 'redo' : 'undo');
  if ((e.ctrlKey || e.metaKey) && k === 'y') return history('redo');
  const map = { ' ': 'play', i: 'in', o: 'out', delete: 'delete', l: 'live', v: 'view' };
  if (map[k]) {
    e.preventDefault();
    press(map[k]);
  }
});

// ---------- XR session ----------
const xrSetup = setupEnterXR({ renderer, button: $('enter'), status: statusEl });
renderer.xr.addEventListener('sessionstart', () => {
  document.body.classList.add('in-xr');
  if (S.ready) say(S.calib ? 'Ready. RECORD when you are (or CALIBRATE again).' : 'First, CALIBRATE: stand in a T-pose.');
  handsView.points.material.uniforms.uScale.value = 1000;
  panelGrab.visible = true;
  panelGrab.moved = false;
  palmDock.release();
  scene.background = xrSetup.mode === 'immersive-ar' ? null : BG;
  needPlace = true;
});
renderer.xr.addEventListener('sessionend', () => {
  document.body.classList.remove('in-xr');
  help.hide();
  if (S.phase !== 'idle') {
    if (S.phase === 'rec') stopRecording();
    S.phase = 'idle';
  }
  panelGrab.visible = false;
  panelGrab.moved = false;
  palmDock.release();
  scene.background = BG;
  liveOk = false;
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
  const raw = last ? Math.min(Math.max(now - last, 0), 0.5) : 0;
  const dt = Math.min(raw, 1 / 30);
  last = now;
  if (frame && needPlace && placeXR(frame)) {
    needPlace = false;
    help.hint(renderer.xr.getCamera());
  }
  input.update(frame, dt, stage.position);
  for (const ev of input.events) if (ev === 'recenter') { panelGrab.moved = false; palmDock.release(); placeNow(); }

  const viewer = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  if (renderer.xr.isPresenting) {
    viewer.updateMatrixWorld(true);
    capture(live, viewer, input.hands);
    liveOk = true;
  }
  // While counting down or recording, the gestures are off: a thumbs down
  // or a peace sign in the middle of a performance is part of it.
  const performing = S.phase !== 'idle';
  let hands = input.hands;
  if (!performing) {
    const helpHand = help.update(input.hands, dt, viewer);
    closeGesture.update(input.hands, dt, viewer);
    const peace = undoGesture.update(input.hands, dt, viewer);
    const palmHand = palmDock.update(input.hands.filter((h) => h !== helpHand && !peace.includes(h)), dt, viewer);
    const carrying = panelGrab.update(input.hands.filter((h) => h !== helpHand && !peace.includes(h) && h !== palmHand), dt, viewer);
    hands = input.hands.filter((h) => h !== helpHand && !peace.includes(h) && h !== palmHand && !carrying.has(h.id));
  }
  pointer.update(input.hands, [{ object: panel.mesh, w: PANEL_W, h: PANEL_H, press: (l) => press(panel.hit(l)), drag: (l) => { const id = panel.hit(l); if (id?.startsWith('timeline:')) press(id); } }]);
  pokePanel(hands);
  step(dt, raw);
  updateLabel();
  panel.draw(panelState());
  handsView.update(input.hands);
  renderer.render(scene, camera);
});

init();

