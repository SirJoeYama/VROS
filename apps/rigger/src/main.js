import * as THREE from 'three';
import { Input, palmFacesUp } from '../../../shared/input.js';
import { HandsView } from '../../../shared/handsView.js';
import { CloseGesture } from '../../../shared/closeGesture.js';
import { UndoGesture } from '../../../shared/undoGesture.js';
import { HelpGesture } from '../../../shared/helpGesture.js';
import { FistTwist } from '../../../shared/fistTwist.js';
import { NavGrab, resetDolly, StickNav } from '../../../shared/navGrab.js';
import { PanelGrab } from '../../../shared/panelGrab.js';
import { Pointer } from '../../../shared/pointer.js';
import { PalmDock } from '../../../shared/palmDock.js';
import { setupEnterXR } from '../../../shared/xr.js';
import { RIGS, rigUrl, modelUrl } from './rigs.js';
import { loadModel, loadGLTF } from './model.js';
import { EditRig, SkeletonView } from './skeleton.js';
import { Rigged, loadLibrary, download, importAnimations } from './rigged.js';
import * as store from './store.js';
import { listTakes, deleteTake } from '../../mocap/src/takes.js';
import { Poser } from './pose.js';
import { Panel, PANEL_W, PANEL_H, STEPS } from './panel.js';

const BG = new THREE.Color(0x04050a);
const FIT_SIZE = 0.9; // the model is first shown this big (m, largest side)
const JOINT_R = 0.0075, GRAB_RADIUS = 0.03;
const PRESS_DEPTH = 0.012, HOVER_DEPTH = 0.05;
const TWIST_SCALE = 0.15; // skeleton size change per radian of fist twist
const TWIST_ROW = 0.5; // radians of twist per row of clips
const TAP_TIME = 0.35, TAP_MOVE = 0.03;

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
sun.position.set(0.6, 2, 1.2);
scene.add(sun);
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.01, 100);
// The camera sits in a "dolly": grabbing empty space with both hands moves,
// turns and scales the dolly (your view), never the model. Things that stay
// with you (the panel) live in it too.
const dolly = new THREE.Group();
dolly.add(camera);
scene.add(dolly);
// Everything you look at sits in `world`. Zooming with both hands scales the
// world, not you: you stay life size, so things stay put in your room when
// you move your head (scaling you made them float).
const world = new THREE.Group();
scene.add(world);
const you = () => dolly.scale.x; // your size in the world: real distances get multiplied by it

// The stage holds the model, the skeleton being fitted and the rigged result,
// in the model's own units; it is scaled to a comfortable size in the room.
const stage = new THREE.Group();
world.add(stage);
const modelGroup = new THREE.Group();
stage.add(modelGroup);
const floor = new THREE.Mesh(
  new THREE.RingGeometry(0.97, 1, 96).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0x9fb8ff, transparent: true, opacity: 0.35, depthWrite: false }),
);
floor.visible = false;
stage.add(floor);

const panel = new Panel();
const desk = new THREE.Group();
desk.add(panel.mesh);
dolly.add(desk);
// Pinch the bar under the panel to carry it, or its corner to resize it. A
// panel you've placed stays there until you recenter.
const panelGrab = new PanelGrab(desk, panel.mesh, PANEL_W, PANEL_H);
// Palm up for a second: the panel comes to your hand (like Galaxies' dock).
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
// Peace sign held a second: left hand undo, right hand redo.
const undoGesture = new UndoGesture({
  undo: () => historyStep('undo'),
  redo: () => historyStep('redo'),
});
scene.add(undoGesture.group);
const help = HelpGesture.fromPage();
scene.add(help.group);
const twist = new FistTwist();

// ---------- state ----------
const S = {
  step: 'model',
  model: null, // from loadModel
  own: null, // the user's own file, once loaded
  suggested: null, // rig for a sample model
  rigDef: null,
  editRig: null,
  view: null, // SkeletonView
  version: 0, // bumps whenever the fit changes, so the skin knows it's stale
  rigged: null,
  riggedVersion: -1,
  clips: null, // library clips for the current rig, once loaded
  custom: [], // clips made in 5 POSE
  imported: [], // clips imported from GLB files
  takes: [], // takes recorded in Mocap (human skeleton only)
  chosen: new Set(), // clip names to export
  poser: null, // 5 POSE: frames and pose handles on the rigged model
  lastClip: null, // { clip, time } last played in 4 ANIMATE, for CLIP POSE
  clearArmed: 0,
  xray: true,
  busy: '',
  note: '',
  baseScale: 1,
};

function say(text) {
  S.note = text;
  statusEl.textContent = text;
}

// ---------- the model ----------
function modelBox() {
  modelGroup.updateMatrix();
  return S.model.box.clone().applyMatrix4(modelGroup.matrix);
}

function setModel(model) {
  clearRig();
  modelGroup.clear();
  modelGroup.rotation.set(0, 0, 0);
  S.model = model;
  for (const p of model.parts) modelGroup.add(new THREE.Mesh(p.geometry, p.material));
  setXray(S.xray);
  const size = model.box.getSize(new THREE.Vector3());
  const r = 0.62 * Math.max(size.x, size.z, size.y * 0.4);
  floor.scale.setScalar(r);
  floor.visible = true;
  S.baseScale = THREE.MathUtils.clamp(FIT_SIZE / Math.max(size.x, size.y, size.z), 0.02, 3);
  placeStage();
  go('skeleton');
}

function setXray(on) {
  S.xray = on;
  const fitting = S.step === 'fit';
  modelGroup.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of [o.material].flat()) {
      m.userData.orig ??= { transparent: m.transparent, opacity: m.opacity, depthWrite: m.depthWrite };
      const see = on && fitting;
      m.transparent = see || m.userData.orig.transparent;
      m.opacity = see ? 0.4 : m.userData.orig.opacity;
      m.depthWrite = see ? false : m.userData.orig.depthWrite;
      m.needsUpdate = true;
    }
  });
}

async function pickSample(rig) {
  await busy(`Loading the ${rig.name.toLowerCase()} sample…`, async () => {
    const model = await loadModel(modelUrl(rig), { sample: true, name: `${rig.name} sample` });
    S.suggested = rig.id;
    setModel(model);
  });
}

async function openFile(file) {
  await busy(`Loading ${file.name}…`, async () => {
    const model = await loadModel(file);
    S.own = model;
    S.suggested = null;
    setModel(model);
  });
}

// ---------- the skeleton ----------
function clearRig() {
  S.view?.dispose();
  S.editRig?.root.removeFromParent();
  S.poser?.dispose();
  S.rigged?.dispose();
  S.view = S.editRig = S.rigged = S.poser = S.clips = S.lastClip = null;
  S.rigDef = null;
  S.custom = [];
  S.imported = [];
  S.takes = [];
  S.chosen.clear();
  drags.clear();
}

async function chooseRig(rig) {
  await busy(`Loading the ${rig.name.toLowerCase()} skeleton…`, async () => {
    const { scene: armature } = await loadGLTF(rigUrl(rig));
    clearRig();
    S.rigDef = rig;
    stage.add(armature);
    stage.updateMatrixWorld(true);
    S.editRig = new EditRig(armature, rig);
    if (!S.model.sample || S.suggested !== rig.id) S.editRig.autoFit(modelBox(), stage);
    S.view = new SkeletonView(S.editRig);
    scene.add(S.view.group);
    S.version++;
    go('fit');
    loadLibrary(rig, new Set(S.editRig.bones.map((b) => b.name))).catch(() => {}); // start downloading
  });
}

// ---------- skinning and animation ----------
async function skin() {
  if (S.rigged && S.riggedVersion === S.version) return true;
  let ok = false;
  await busy('Skinning: working out which bone moves each vertex…', async () => {
    await new Promise((r) => setTimeout(r, 60)); // let the message show first
    S.poser?.dispose();
    S.rigged?.dispose();
    S.rigged = new Rigged(S.model, modelGroup, S.editRig, stage);
    S.poser = new Poser(S.rigged, S.editRig);
    S.poser.group.visible = false;
    scene.add(S.poser.group);
    restoreClips();
    restoreImported();
    restoreTakes();
    S.riggedVersion = S.version;
    ok = true;
  });
  if (!ok) return false;
  await busy('Loading animations…', async () => {
    S.clips = await loadLibrary(S.rigDef, new Set(S.editRig.bones.map((b) => b.name)));
  });
  if (S.clips?.length && S.rigged) {
    const last = S.clips.find((c) => c === S.rigged.clip);
    S.rigged.play(last || S.clips.find((c) => /idle/i.test(c.name)) || S.clips[0]);
  }
  return true;
}

async function exportGLB() {
  const clips = allClips().filter((c) => S.chosen.has(c.name));
  await busy('Exporting…', async () => {
    const buf = await S.rigged.exportGLB(clips);
    if (S.step === 'pose') S.poser.show(); // exporting put the skeleton back at rest
    const name = `${S.model.name.replace(/[^\w\- ]+/g, '').trim() || 'model'}-rigged.glb`;
    download(buf, name);
    say(`Saved ${name} with ${clips.length} animation${clips.length === 1 ? '' : 's'} (in Downloads).`);
  });
}

async function busy(text, fn) {
  S.busy = text;
  statusEl.textContent = text;
  try {
    await fn();
  } catch (err) {
    console.error(err);
    say('Something went wrong: ' + (err.message || err));
  } finally {
    S.busy = '';
    statusEl.textContent = S.note;
  }
}

const allClips = () => [...S.custom, ...S.imported, ...S.takes, ...(S.clips || [])];

// Clips saved in 5 POSE are kept in the browser for each skeleton type (as
// their frames), so they survive reloads, closing the app and re-skinning.
const clipsKey = (rig) => `vros.rigger.clips.${rig.id}`;
function savedClips(rig) {
  try {
    return JSON.parse(localStorage.getItem(clipsKey(rig)) || '[]');
  } catch {
    return [];
  }
}
function storeClips(rig, list) {
  try {
    localStorage.setItem(clipsKey(rig), JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}
// Imported clips are kept in IndexedDB (they're too big for localStorage),
// also per skeleton type.
const importedKey = (rig) => `clips.${rig.id}`;
async function restoreImported() {
  const rig = S.rigDef;
  try {
    const list = (await store.get(importedKey(rig))) || [];
    if (S.rigDef !== rig) return; // the skeleton changed meanwhile
    const first = !S.imported.length;
    S.imported = list.filter((e) => e?.clip).map(({ clip, sourceRest }) => {
      const c = THREE.AnimationClip.parse(clip);
      c.imported = true;
      c.sourceRest = sourceRest;
      return c;
    });
    if (first) for (const c of S.imported) S.chosen.add(c.name);
  } catch (err) {
    console.warn('Could not restore imported clips', err);
  }
}
const saveImported = () => store.set(importedKey(S.rigDef), S.imported.map((c) => ({ clip: THREE.AnimationClip.toJSON(c), sourceRest: c.sourceRest })));

// Takes recorded in the Mocap app (same browser storage), already baked on
// the human template skeleton: they play like library clips.
async function restoreTakes() {
  const rig = S.rigDef;
  if (rig?.id !== 'human') return;
  try {
    const list = await listTakes();
    if (S.rigDef !== rig) return;
    const first = !S.takes.length;
    S.takes = list.filter((t) => t.clip).map((t) => {
      const c = THREE.AnimationClip.parse(t.clip);
      c.mocap = t.id;
      return c;
    });
    if (first) for (const c of S.takes) S.chosen.add(c.name);
  } catch (err) {
    console.warn('Could not read the Mocap takes', err);
  }
}

async function importFile(file) {
  if (!S.rigged) return say('Skin a model first (3 FIT → SKIN & ANIMATE), then import its animations.');
  await busy(`Importing animations from ${file.name}…`, async () => {
    const { clips, rejected } = await importAnimations(file, S.rigged, new Set(allClips().map((c) => c.name)));
    const why = rejected.length ? ` ${rejected.length} didn't fit the ${S.rigDef.name.toLowerCase()} skeleton (e.g. “${rejected[0].name}”: ${rejected[0].matched} of ${rejected[0].total} bones match).` : '';
    if (!clips.length) return say(`Nothing imported: no animation in ${file.name} fits the ${S.rigDef.name.toLowerCase()} skeleton.${why}`);
    S.imported.push(...clips);
    for (const c of clips) S.chosen.add(c.name);
    let kept = true;
    await saveImported().catch(() => (kept = false));
    if (S.step !== 'animate') go('animate');
    S.rigged.play(clips[0]);
    say(`Imported ${clips.length} animation${clips.length === 1 ? '' : 's'} from ${file.name}, ticked for export.${why}${kept ? '' : ' (Couldn’t keep them in the browser: they’ll be gone after a reload.)'}`);
  });
}

function restoreClips() {
  const first = !S.custom.length;
  S.custom = savedClips(S.rigDef).map((c) => S.poser.clipFrom(c));
  if (first) for (const c of S.custom) S.chosen.add(c.name); // ticked for export, like when saved
}

// ---------- steps ----------
function go(step) {
  const from = S.step;
  S.step = step;
  const rigged = step === 'animate' || step === 'pose';
  modelGroup.visible = !rigged;
  if (S.view) S.view.group.visible = step === 'fit';
  if (S.rigged) S.rigged.group.visible = rigged;
  if (S.poser) S.poser.group.visible = step === 'pose';
  if (from === 'animate' && step !== 'animate' && S.rigged?.clip && !S.rigged.clip.custom) {
    S.lastClip = { clip: S.rigged.clip, time: S.rigged.action?.time || 0 };
  }
  if (step === 'pose' && from !== 'pose') S.poser.show();
  if (from === 'pose' && step !== 'pose' && S.poser) {
    S.poser.stop();
    const c = S.lastClip?.clip || S.clips?.find((c) => /idle/i.test(c.name)) || S.clips?.[0];
    if (c) S.rigged.play(c);
  }
  setXray(S.xray);
}

async function goStep(step) {
  if (step === 'model') go('model');
  else if (step === 'skeleton' && S.model) go('skeleton');
  else if (step === 'fit' && S.editRig) go('fit');
  else if ((step === 'animate' || step === 'pose') && S.editRig) {
    if (await skin()) go(step);
  }
}

function openSteps() {
  const s = new Set(['model']);
  if (S.model) s.add('skeleton');
  if (S.editRig) s.add('fit').add('animate').add('pose');
  return s;
}

// ---------- the panel's contents ----------
function panelState() {
  const xr = renderer.xr.isPresenting;
  const base = { step: S.step, open: openSteps(), actions: [], items: [], cols: 3, empty: '' };
  const status = (t) => S.busy || t;
  if (S.step === 'model') {
    const items = RIGS.map((r) => ({ id: `sample:${r.id}`, label: r.name, sub: 'sample model', on: S.model?.sample && S.suggested === r.id }));
    if (S.own) items.unshift({ id: 'own', label: S.own.name, sub: 'your model', on: S.model === S.own });
    return {
      ...base, items,
      status: status(S.own || !xr ? 'Pick a model to rig.' : 'Pick a sample, or load your own model in window mode.'),
      actions: xr ? [] : [{ id: 'open', label: 'OPEN A FILE…  (GLB · GLTF · FBX · OBJ)', strong: true }],
    };
  }
  if (S.step === 'skeleton') {
    const sug = RIGS.find((r) => r.id === S.suggested);
    return {
      ...base,
      items: RIGS.map((r) => ({ id: `rig:${r.id}`, label: r.name, sub: r.id === S.suggested ? 'made for this model' : undefined, on: S.rigDef === r })),
      status: status(sug ? `This is the ${sug.name.toLowerCase()} sample: pick ${sug.name}.` : `Which skeleton fits ${S.model.name}?`),
    };
  }
  if (S.step === 'fit') {
    const er = S.editRig;
    return {
      ...base,
      items: [
        { id: 'mirror', label: 'MIRROR', sub: er.mirror ? 'left and right move together' : 'off: each side on its own', on: er.mirror },
        { id: 'children', label: er.children === 'follow' ? 'CHILDREN FOLLOW' : 'CHILDREN STAY', sub: er.children === 'follow' ? 'the rest of the limb moves too' : 'only the joint moves' },
        { id: 'xray', label: 'SEE-THROUGH', sub: 'show joints inside the model', on: S.xray },
        { id: 'undo', label: 'UNDO', sub: er.undoStack.length ? `${er.undoStack.length} step${er.undoStack.length > 1 ? 's' : ''}` : 'nothing to undo' },
        { id: 'smaller', label: 'SIZE −', sub: `skeleton ${Math.round(er.scale * 100)}%` },
        { id: 'bigger', label: 'SIZE +', sub: 'or fist + twist' },
        { id: 'turn', label: 'TURN MODEL 90°', sub: 'face it toward the front' },
        { id: 'reset', label: 'RESET FIT', sub: 'back to the first guess' },
        { id: 'recenter', label: 'RECENTER', sub: 'bring it in front of you' },
      ],
      status: status('Pinch a joint and move it inside the model. Fist + twist resizes the skeleton.'),
      actions: [{ id: 'step:skeleton', label: '‹  SKELETON' }, { id: 'step:animate', label: 'SKIN & ANIMATE  ›', strong: true }],
    };
  }
  if (S.step === 'pose') {
    const p = S.poser, n = p.frames.length, cur = p.playFrame;
    const ik = (t) => p.modes[t] === 'ik';
    const lc = S.lastClip?.clip.name.replace(/_/g, ' ');
    const armed = S.clearArmed > performance.now();
    return {
      ...base,
      strip: { count: n, current: cur, thumb: (i) => p.thumb(i), key: `${p.version}|${cur}|${n}` },
      items: [
        { id: 'p:hands', label: `HANDS ${p.modes.hand.toUpperCase()}`, sub: ik('hand') ? 'diamond places the hand' : 'diamond turns the hand', on: ik('hand') },
        { id: 'p:feet', label: `FEET ${p.modes.foot.toUpperCase()}`, sub: ik('foot') ? 'diamond places the foot' : 'diamond turns the foot', on: ik('foot') },
        { id: 'p:onion', label: 'ONION SKIN', sub: 'ghosts: previous red, next blue', on: p.onion },
        { id: 'p:smooth', label: p.smooth ? 'SMOOTH' : 'STEPPED', sub: p.smooth ? 'in-betweens when it plays' : 'stop-motion: no in-betweens', on: p.smooth },
        { id: 'p:fps', label: `${p.fps} FPS`, sub: `${(n / p.fps).toFixed(2)} s long` },
        { id: 'p:clippose', label: 'CLIP POSE', sub: lc ? `copy “${lc}” here` : 'play a clip in 4 ANIMATE first', off: !lc },
        { id: 'p:rest', label: 'RESET POSE', sub: 'this frame back to rest' },
        { id: 'p:clear', label: armed ? 'SURE? PRESS AGAIN' : 'NEW ANIMATION', sub: 'start over with one frame', on: armed },
        { id: 'p:save', label: 'SAVE AS CLIP', sub: 'goes to 4 ANIMATE, for export' },
      ],
      status: status(S.note || (p.playing ? `playing · ${n} frames at ${p.fps} fps` : `frame ${cur + 1} / ${n} · pinch a joint to pose · + FRAME copies this pose`)),
      actions: [
        { id: 'p:prev', label: '◀  PREV' },
        { id: 'p:play', label: p.playing ? '❚❚  PAUSE' : '▶  PLAY', off: n < 2 },
        { id: 'p:next', label: 'NEXT  ▶' },
        { id: 'p:add', label: '+ FRAME', strong: true },
        { id: 'p:delete', label: 'DELETE', off: n < 2 },
        { id: 'export', label: `EXPORT (${S.chosen.size})` },
      ],
    };
  }
  // animate
  const r = S.rigged, n = S.chosen.size, clips = allClips();
  return {
    ...base,
    items: clips.map((c) => ({ id: `clip:${c.name}`, label: (c.imported ? '⤓ ' : c.custom ? '★ ' : c.mocap ? '● ' : '') + c.name.replace(/_/g, ' '), on: r?.clip === c, check: S.chosen.has(c.name) })),
    empty: 'loading animations…',
    status: status(S.note || (r?.clip ? `${r.clip.name.replace(/_/g, ' ')}${r.paused ? ' (paused)' : ''} · tick ✓ the clips to export` : '')),
    actions: [
      { id: 'step:fit', label: '‹  FIT' },
      { id: 'pause', label: r?.paused ? '▶ PLAY' : '❚❚ PAUSE' },
      { id: 'weights', label: 'WEIGHTS', on: r?.showWeights },
      { id: 'all', label: n && n === clips.length ? 'NONE' : 'ALL' },
      { id: 'removeClip', label: 'REMOVE', off: !r?.clip?.custom && !r?.clip?.imported && !r?.clip?.mocap },
      { id: 'import', label: 'IMPORT' },
      { id: 'export', label: `EXPORT (${n})`, strong: true },
    ],
  };
}

// ---------- actions ----------
async function press(id) {
  if (!id) return;
  panel.flash(id);
  if (S.busy) return;
  if (id !== 'export') S.note = '';
  const er = S.editRig;
  if (id.startsWith('step:')) return goStep(id.slice(5));
  if (id === 'up') return panel.scrollBy(-1);
  if (id === 'down') return panel.scrollBy(1);
  if (id === 'open') return $('file').click();
  if (id === 'own') return S.own && (S.suggested = null, setModel(S.own));
  if (id.startsWith('sample:')) return pickSample(RIGS.find((r) => r.id === id.slice(7)));
  if (id.startsWith('rig:')) return chooseRig(RIGS.find((r) => r.id === id.slice(4)));
  if (id.startsWith('frame:')) return S.poser?.go(+id.slice(6));
  if (id.startsWith('p:')) return posePress(id.slice(2));
  if (id.startsWith('clip:')) {
    const clip = allClips().find((c) => c.name === id.slice(5));
    if (clip) S.rigged.play(clip);
    return;
  }
  if (id.startsWith('check:clip:')) {
    const name = id.slice(11);
    S.chosen.has(name) ? S.chosen.delete(name) : S.chosen.add(name);
    return;
  }
  const edits = {
    mirror: () => (er.mirror = !er.mirror),
    children: () => (er.children = er.children === 'follow' ? 'stay' : 'follow'),
    xray: () => setXray(!S.xray),
    undo: () => er.undo() && S.version++,
    reset: () => (er.reset(), S.version++),
    smaller: () => (er.pushUndo(), er.scaleBy(1 / 1.05), S.version++),
    bigger: () => (er.pushUndo(), er.scaleBy(1.05), S.version++),
    turn: () => {
      modelGroup.rotation.y -= Math.PI / 2;
      S.version++;
    },
    recenter: () => recenter(),
    pause: () => S.rigged?.togglePause(),
    weights: () => S.rigged?.setWeightsView(!S.rigged.showWeights),
    all: () => {
      const clips = allClips();
      if (S.chosen.size === clips.length) S.chosen.clear();
      else for (const c of clips) S.chosen.add(c.name);
    },
    export: () => {
      S.poser?.stop();
      return S.rigged && exportGLB();
    },
    // The browser can't show a file picker inside XR.
    import: () => (renderer.xr.isPresenting ? say('To import animations, leave XR and use “Import animations…” in window mode.') : $('animfile').click()),
    // Remove a clip made in 5 POSE, imported or recorded in Mocap (the one playing).
    removeClip: () => {
      const c = S.rigged?.clip;
      if (!c?.custom && !c?.imported && !c?.mocap) return;
      if (c.mocap) {
        S.takes = S.takes.filter((x) => x !== c);
        deleteTake(c.mocap).catch(() => {});
      } else if (c.imported) {
        S.imported = S.imported.filter((x) => x !== c);
        saveImported().catch(() => {});
      } else storeClips(S.rigDef, savedClips(S.rigDef).filter((x) => x.name !== c.name));
      S.custom = S.custom.filter((x) => x !== c);
      S.chosen.delete(c.name);
      const next = S.lastClip?.clip || S.clips?.find((x) => /idle/i.test(x.name)) || S.clips?.[0];
      if (next) S.rigged.play(next);
      say(`Removed “${c.name}”.`);
    },
  };
  edits[id]?.();
}

// Undo / redo for the step you're in: the skeleton fit or the pose frames.
function historyStep(kind) {
  if (S.step === 'fit' && S.editRig?.[kind]()) {
    S.version++;
    return kind === 'undo' ? 'Undo: skeleton' : 'Redo: skeleton';
  }
  if (S.step === 'pose' && S.poser?.[kind]()) return kind === 'undo' ? 'Undo: pose' : 'Redo: pose';
  return null;
}

function posePress(id) {
  const p = S.poser;
  if (!p) return;
  if (id !== 'clear') S.clearArmed = 0;
  ({
    prev: () => p.go(p.current - 1),
    next: () => p.go(p.current + 1),
    play: () => p.togglePlay(),
    add: () => p.addFrame(),
    delete: () => p.deleteFrame(),
    hands: () => p.toggleMode('hand'),
    feet: () => p.toggleMode('foot'),
    onion: () => p.toggleOnion(),
    smooth: () => p.toggleSmooth(),
    fps: () => p.cycleFps(),
    clippose: () => S.lastClip && p.useClipPose(S.lastClip.clip, S.lastClip.time),
    rest: () => p.resetPose(),
    // No dialogs in XR: a second press within 3 s confirms.
    clear: () => {
      if (S.clearArmed > performance.now()) {
        S.clearArmed = 0;
        p.clear();
      } else S.clearArmed = performance.now() + 3000;
    },
    save: () => {
      p.stop();
      let k = S.custom.length + 1;
      while (allClips().some((c) => c.name === `My animation ${k}`)) k++;
      const name = `My animation ${k}`;
      const kept = storeClips(S.rigDef, [...savedClips(S.rigDef), p.saved(name)]);
      const clip = p.clip(name);
      S.custom.push(clip);
      S.chosen.add(clip.name);
      const still = p.frames.length < 2 ? ' It has one frame, so it holds a still pose; + FRAME adds more.' : '';
      say(`Saved “${clip.name}”, ticked for export: EXPORT saves it in the GLB.${still}${kept ? '' : ' (The browser is out of space, so it will be gone after a reload.)'}`);
    },
  })[id]?.();
}

// ---------- window-mode controls ----------
$('animfile').addEventListener('change', (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (f) importFile(f);
});
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
$('export').addEventListener('click', () => {
  if ((S.step === 'animate' || S.step === 'pose') && S.rigged) press('export');
  else say('Fit a skeleton and go to 4 ANIMATE first.');
});
addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, textarea')) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') historyStep(e.shiftKey ? 'redo' : 'undo');
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') historyStep('redo');
  else if (S.step === 'pose') {
    const map = { ArrowLeft: 'p:prev', ArrowRight: 'p:next', ' ': 'p:play', n: 'p:add', Delete: 'p:delete', o: 'p:onion', h: 'p:hands', j: 'p:feet', f: 'p:fps', s: 'p:smooth' };
    if (map[e.key]) { e.preventDefault(); press(map[e.key]); }
  } else if (e.key === ' ') { e.preventDefault(); press('pause'); }
  else if (e.key === 'm' && S.step === 'fit') press('mirror');
  else if (e.key === 'c' && S.step === 'fit') press('children');
});

// ---------- placement ----------
function placeStage() {
  stage.scale.setScalar(S.baseScale);
  stage.rotation.set(0, 0, 0);
  if (renderer.xr.isPresenting) needPlace = true;
  else placeDesktop();
}

function placeDesktop() {
  const box = S.model ? S.model.box : new THREE.Box3(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 1.8, 1));
  const cy = (box.min.y + box.max.y) / 2;
  stage.scale.setScalar(S.baseScale);
  stage.rotation.set(0, 0, 0);
  // aimed left of the scene so the page overlay doesn't cover it
  floor.visible = !!S.model;
  stage.position.set(0.3, 1.36 - cy * S.baseScale, -1);
  stage.updateMatrixWorld(true);
  desk.position.set(0.24, 0.93, -0.18);
  desk.scale.setScalar(1);
  camera.position.set(0, 1.3, 1.05);
  camera.lookAt(0.05, 1.06, -0.6);
  desk.lookAt(camera.position);
  desk.updateMatrixWorld(true);
}

// The model ~1 m ahead with its middle a little below your eyes; the panel
// closer and lower, tilted up at you like a desk.
let needPlace = false;
function placeXR(frame) {
  const pose = frame.getViewerPose(renderer.xr.getReferenceSpace());
  if (!pose) return false;
  resetDolly(dolly, world); // back to your real place and size, no zoom
  const p = pose.transform.position, q = pose.transform.orientation;
  const eye = new THREE.Vector3(p.x, p.y, p.z);
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w));
  fwd.y = 0;
  if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
  fwd.normalize();
  const box = S.model ? S.model.box : new THREE.Box3(new THREE.Vector3(), new THREE.Vector3(0, 1.8, 0));
  const k = stage.scale.x;
  stage.position.copy(eye).addScaledVector(fwd, 1.0);
  stage.position.y = eye.y - 0.22 - ((box.min.y + box.max.y) / 2) * k;
  stage.lookAt(eye.x, stage.position.y, eye.z);
  stage.updateMatrixWorld(true);
  if (!panelGrab.moved) {
    desk.position.copy(eye).addScaledVector(fwd, 0.42);
    desk.position.y = eye.y - 0.42;
    desk.lookAt(eye);
    desk.updateMatrixWorld(true);
  }
  return true;
}

// Model and panel back in front of you (and the view back to life size),
// wherever you'd put the panel.
function recenter() {
  palmDock.release();
  panelGrab.moved = false;
  needPlace = true;
}

// ---------- grabbing handles ----------
// What a pinch (or the mouse) grabs depends on the step: skeleton joints in
// 3 FIT, pose handles in 5 POSE. Each drag is { hm, g, d }: the handle, this
// grabber and its drag state.
const fitGrab = {
  nearest: (p, r) => S.view.nearest(p, r),
  nearestToRay: (ray, r) => S.view.nearestToRay(ray, r),
  begin: (hm) => S.editRig.pushUndo(),
  drag: (drag, p) => S.editRig.moveJoint(drag.hm.bone, p),
  end: () => S.version++,
  update: (dt, grabbed, hovered) => S.view.update(dt, grabbed, hovered, JOINT_R * you()),
};
const poseGrab = {
  nearest: (p, r) => S.poser.nearest(p, r),
  nearestToRay: (ray, r) => S.poser.nearestToRay(ray, r),
  begin: (hm, p) => {
    S.poser.stop();
    return S.poser.beginDrag(hm.h, p);
  },
  drag: (drag, p) => S.poser.drag(drag.d, p),
  end: () => S.poser.commit(),
  update: (dt, grabbed, hovered) => S.poser.update(dt, grabbed, hovered, JOINT_R * you(), you()),
};
const grabber = () => (S.step === 'fit' && S.view ? fitGrab : S.step === 'pose' && S.poser ? poseGrab : null);

function beginDrag(g, hm, point) {
  return { hm, g, d: g.begin(hm, point) };
}
function endDrag(drag) {
  if (drag) drag.g.end();
}

// ---------- hands ----------
const drags = new Map(); // hand id → drag
const wasPinching = new Map();
const pinchStart = new Map(); // hand id → { t, p, used }
const pokeState = new Map();
const local = new THREE.Vector3();
let navGrab = null;
let twistAcc = 0, twistHand = null;
let fistsHeld = 0;

function panelLocal(point) {
  panel.mesh.worldToLocal(local.copy(point));
  local.z *= desk.scale.x; // press depth in meters, whatever the panel's size
  return local;
}
const insidePanel = (l) => Math.abs(l.x) < PANEL_W / 2 && Math.abs(l.y) < PANEL_H / 2;

function updateHands(hands, dt, now) {
  const hovered = new Set();
  const g = grabber();
  for (const h of hands) {
    if (h.kind === 'mouse') continue;
    const was = wasPinching.get(h.id), start = h.pinch && !was, end = !h.pinch && was;
    wasPinching.set(h.id, h.pinch);

    // Poke the panel with an index fingertip; a controller pulls its trigger on it.
    let onPanel = false;
    if (h.kind === 'hand' && !drags.has(h.id)) {
      const l = panelLocal(h.indexTip);
      const inside = insidePanel(l);
      const deep = inside && l.z < PRESS_DEPTH && l.z > -0.04;
      if (deep && pokeState.get(h.id) === false) press(panel.hit(l));
      pokeState.set(h.id, deep ? true : inside && l.z < HOVER_DEPTH ? false : undefined);
      onPanel = inside && l.z < HOVER_DEPTH && l.z > -0.04;
    } else if (h.kind === 'controller' && start) {
      const l = panelLocal(h.pinchPoint);
      if (insidePanel(l) && Math.abs(l.z) < 0.05) {
        press(panel.hit(l));
        onPanel = true;
      }
    }

    if (start) pinchStart.set(h.id, { t: now, p: h.pinchPoint.clone(), used: onPanel });
    const ps = pinchStart.get(h.id);
    if (ps && h.pinch && ps.p.distanceTo(h.pinchPoint) > TAP_MOVE * you()) ps.used = true;

    // Pinch a handle to drag it (unless the other hand is grabbing the scene).
    if (g) {
      const otherFree = hands.some((o) => o !== h && o.kind !== 'mouse' && o.pinch && !drags.has(o.id) && palmFacesUp(o));
      if (start && !onPanel && !otherFree) {
        const hm = g.nearest(h.pinchPoint, GRAB_RADIUS * you());
        if (hm) {
          drags.set(h.id, beginDrag(g, hm, h.pinchPoint));
          ps.used = true;
        }
      }
      const d = drags.get(h.id);
      if (d && h.pinch) d.g.drag(d, h.pinchPoint);
      const near = d?.hm || (!navGrab && !h.pinch && g.nearest(h.pinchPoint, GRAB_RADIUS * you()));
      if (near) hovered.add(near);
    }

    if (end) {
      const d = drags.get(h.id);
      if (d) {
        drags.delete(h.id);
        endDrag(d);
      } else if (ps && !ps.used && !navGrab && now - ps.t < TAP_TIME) {
        // A quick pinch plays and pauses.
        if (S.step === 'animate') press('pause');
        else if (S.step === 'pose') press('p:play');
      }
      pinchStart.delete(h.id);
    }
  }
  for (const [id, d] of [...drags]) {
    if (!hands.some((h) => h.id === id && h.kind !== 'mouse')) {
      drags.delete(id);
      endDrag(d);
    }
  }
  if (g) {
    if (mouseDrag) hovered.add(mouseDrag.hm);
    else if (mouseHover) hovered.add(mouseHover);
    g.update(dt, new Set([...[...drags.values()].map((d) => d.hm), ...(mouseDrag ? [mouseDrag.hm] : [])]), hovered);
  }

  updateView(hands);
  updateFists(hands, dt);
}

// Pinch empty space with both hands to look around: move your view, pull
// apart / push together to zoom, turn your hands to turn the view. It only
// moves the camera; nothing in the scene changes.
function updateView(hands) {
  const free = hands.filter((h) => h.kind !== 'mouse' && h.pinch && !drags.has(h.id));
  // starts only with both palms up (then keeps going as your hands turn)
  if (free.length < 2 || (!navGrab && !free.every((h) => palmFacesUp(h)))) {
    navGrab = null;
    return;
  }
  for (const h of free) if (pinchStart.get(h.id)) pinchStart.get(h.id).used = true;
  const [a, b] = [free[0].realPinch, free[1].realPinch];
  navGrab ??= new NavGrab(dolly, a, b, { world, min: 0.1, max: 10 });
  navGrab.update(a, b);
}

// One fist + twist: resize the skeleton (fit), scroll the clips (animate) or
// step through the frames like a jog dial (pose).
// Both fists held for a second: bring everything back in front of you.
function updateFists(hands, dt) {
  const fists = hands.filter((h) => h.kind === 'hand' && h.fist);
  twist.prune(hands);
  for (const h of hands) if (!h.fist) twist.release(h);
  fistsHeld = fists.length === 2 ? fistsHeld + dt : 0;
  if (fistsHeld > 1) {
    fistsHeld = -1e9; // once per hold
    recenter();
  }
  if (fists.length !== 1) {
    twistHand = null;
    return;
  }
  const h = fists[0];
  const roll = twist.roll(h);
  if (twistHand !== h.id) {
    twistHand = h.id;
    twistAcc = 0;
    if (S.step === 'fit' && S.editRig) S.editRig.pushUndo();
    return;
  }
  if (S.step === 'fit' && S.editRig && roll) {
    S.editRig.scaleBy(Math.exp(roll * TWIST_SCALE));
    S.version++;
  } else if (S.step === 'animate' || (S.step === 'pose' && S.poser)) {
    const step = S.step === 'animate' ? (k) => panel.scrollBy(k) : (k) => S.poser.go(S.poser.current + k);
    twistAcc += roll;
    while (twistAcc > TWIST_ROW) { step(1); twistAcc -= TWIST_ROW; }
    while (twistAcc < -TWIST_ROW) { step(-1); twistAcc += TWIST_ROW; }
  }
}

// ---------- the mouse (desktop preview) ----------
// Click the panel; drag joints on a plane facing the camera; right-drag
// turns the stage; the wheel scales it.
const raycaster = new THREE.Raycaster();
let mouseDrag = null, mouseHover = null, orbit = null;
function mouseRay(e) {
  raycaster.setFromCamera(new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), camera);
  return raycaster.ray;
}
const el = renderer.domElement;
el.addEventListener('pointerdown', (e) => {
  if (renderer.xr.isPresenting) return;
  const ray = mouseRay(e);
  if (e.button === 2 || e.shiftKey) {
    orbit = { x: e.clientX, rot: stage.rotation.y };
    return;
  }
  if (e.button !== 0) return;
  panel.mesh.updateMatrixWorld();
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(panel.mesh.getWorldDirection(new THREE.Vector3()), panel.mesh.getWorldPosition(new THREE.Vector3()));
  const hit = ray.intersectPlane(plane, new THREE.Vector3());
  if (hit) {
    const l = panelLocal(hit);
    if (insidePanel(l)) return press(panel.hit(l));
  }
  const g = grabber();
  const hm = g?.nearestToRay(ray, 0.015);
  if (hm) {
    // Drag on a plane facing the camera through the handle. The ring is
    // grabbed where the ray meets the floor.
    const at = hm.h?.type === 'move' ? ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), hm.m.position), new THREE.Vector3()) || hm.m.position.clone() : hm.m.position.clone();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()), at);
    const start = ray.intersectPlane(plane, new THREE.Vector3()) || at;
    mouseDrag = { ...beginDrag(g, hm, start), plane };
    return;
  }
  if (S.step === 'animate') press('pause');
});
el.addEventListener('pointermove', (e) => {
  if (renderer.xr.isPresenting) return;
  const ray = mouseRay(e);
  if (orbit) {
    stage.rotation.y = orbit.rot + (e.clientX - orbit.x) * 0.01;
    return;
  }
  if (mouseDrag) {
    const p = ray.intersectPlane(mouseDrag.plane, new THREE.Vector3());
    if (p) mouseDrag.g.drag(mouseDrag, p);
    return;
  }
  mouseHover = grabber()?.nearestToRay(ray, 0.015) || null;
});
const mouseUp = () => {
  endDrag(mouseDrag);
  mouseDrag = null;
  orbit = null;
};
el.addEventListener('pointerup', mouseUp);
el.addEventListener('pointercancel', mouseUp);

function wheelZoom() {
  if (!input.wheel) return;
  const k = THREE.MathUtils.clamp(stage.scale.x * Math.exp(-input.wheel * 0.001), S.baseScale * 0.15, S.baseScale * 8);
  stage.scale.setScalar(k);
  input.wheel = 0;
}

// ---------- XR session ----------
const xr = setupEnterXR({ renderer, button: $('enter'), status: statusEl });
renderer.xr.addEventListener('sessionstart', () => {
  document.body.classList.add('in-xr');
  scene.background = xr.mode === 'immersive-ar' ? null : BG;
  handsView.points.material.uniforms.uScale.value = 1000;
  panelGrab.visible = true;
  recenter();
});
renderer.xr.addEventListener('sessionend', () => {
  resetDolly(dolly, world);
  document.body.classList.remove('in-xr');
  scene.background = BG;
  help.hide();
  panelGrab.visible = false;
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
const center = new THREE.Vector3();
let last = 0;
renderer.setAnimationLoop((time, frame) => {
  const now = time / 1000;
  const dt = Math.min(Math.max(now - last, 0), 1 / 30);
  last = now;
  if (frame && needPlace && placeXR(frame)) {
    needPlace = false;
    help.hint(renderer.xr.getCamera());
  }
  stage.getWorldPosition(center);
  input.update(frame, dt, center);
  for (const ev of input.events) if (ev === 'recenter') recenter();

  const viewer = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  // The help card shows the gestures for the step you're on.
  const stepName = STEPS.find(([id]) => id === S.step)?.[1].toLowerCase(); // "3 fit"
  help.setContext(S.step, stepName ? `step ${stepName.replace(' ', ' · ')}` : '');
  const helpHand = help.update(input.hands, dt, viewer);
  closeGesture.update(input.hands, dt, viewer);
  const peace = undoGesture.update(input.hands, dt, viewer);
  const palmHand = palmDock.update(input.hands.filter((h) => h !== helpHand && !peace.includes(h)), dt, viewer);
  const carrying = panelGrab.update(input.hands.filter((h) => h !== helpHand && !peace.includes(h) && h !== palmHand), dt, viewer);
  const pointing = pointer.update(input.hands, [{ object: panel.mesh, w: PANEL_W, h: PANEL_H, press: (l) => press(panel.hit(l)) }], you());
  const hands = input.hands.filter((h) => h !== helpHand && !peace.includes(h) && h !== palmHand && !carrying.has(h.id) && !pointing.has(h.id) && !h.aim);
  stickNav.update(input.hands, dt, viewer);
  updateHands(hands, dt, now);
  wheelZoom();
  S.rigged?.tick(dt);
  panel.set(panelState());
  panel.draw();
  handsView.update(input.hands, you());
  renderer.render(scene, camera);
});
