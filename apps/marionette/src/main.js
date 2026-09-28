import * as THREE from 'three';
import { Input } from '../../../shared/input.js';
import { HandsView } from '../../../shared/handsView.js';
import { CloseGesture } from '../../../shared/closeGesture.js';
import { HelpGesture } from '../../../shared/helpGesture.js';
import { setupEnterXR } from '../../../shared/xr.js';
import { Rig, HANDLES } from './rig.js';
import { Timeline, TimelinePanel, PANEL_H } from './timeline.js';
import { SceneGrab } from './sceneGrab.js';

const BG = new THREE.Color(0x04050a);
const GRAB_RADIUS = 0.035; // how close a pinch must be to a handle
const RING_R = 0.05; // the whole-puppet ring on the floor
const PRESS_DEPTH = 0.012, HOVER_DEPTH = 0.05; // poking the timeline panel

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
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.01, 50);

// ---------- stage, puppet, onion skins, timeline ----------
const stage = new THREE.Group();
scene.add(stage);
const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.21, 0.025, 48), new THREE.MeshStandardMaterial({ color: 0x5a3a24, roughness: 0.8 }));
disc.position.y = -0.0125;
stage.add(disc);

const rig = new Rig();
const prevGhost = new Rig({ ghost: true, color: 0xff5050 });
const nextGhost = new Rig({ ghost: true, color: 0x50b4ff });
const measure = new Rig({ ghost: true }); // never shown; poses thumbnails
stage.add(rig.root, prevGhost.root, nextGhost.root);

const timeline = new Timeline(new Rig().restPose());
const panel = new TimelinePanel(timeline, (pose) => {
  measure.setPose(pose);
  return measure.joints();
});
// The timeline sits on a "desk" that follows the stage around but keeps its
// size when you scale the scene, so it stays readable and pokeable.
const desk = new THREE.Group();
panel.mesh.rotation.x = -0.75; // tilted up toward your eyes
desk.add(panel.mesh);
scene.add(desk);
function placeDesk() {
  const k = stage.scale.x;
  desk.position.copy(stage.position);
  desk.quaternion.copy(stage.quaternion);
  panel.mesh.position.set(0, -0.07, 0.21 * k + 0.06);
  desk.updateMatrixWorld(true);
}

// Handles: amber spheres bend (FK); diamonds at the finger and toe tips are
// cyan in IK mode and amber in FK mode; the magenta cube moves the hips with
// the feet planted; the white ring on the floor moves the whole puppet.
const AMBER = 0xffc36a, CYAN = 0x7fe7ff;
const handleMeshes = HANDLES.map((h) => {
  const geo = {
    end: () => new THREE.OctahedronGeometry(0.011),
    move: () => new THREE.TorusGeometry(RING_R, 0.004, 8, 48),
    hip: () => new THREE.BoxGeometry(0.018, 0.018, 0.018),
  }[h.type]?.() || new THREE.SphereGeometry(0.009, 16, 12);
  const color = { move: 0xffffff, hip: 0xff5fd2 }[h.type] || AMBER;
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthTest: false }));
  m.renderOrder = 10;
  scene.add(m);
  return { h, m, hover: 0 };
});

function showFrame() {
  rig.setPose(timeline.pose);
  const n = timeline.frames.length, show = timeline.onion && !timeline.playing && n > 1;
  prevGhost.root.visible = show && timeline.current > 0;
  nextGhost.root.visible = show && timeline.current < n - 1;
  if (prevGhost.root.visible) prevGhost.setPose(timeline.frames[timeline.current - 1]);
  if (nextGhost.root.visible) nextGhost.setPose(timeline.frames[timeline.current + 1]);
}
timeline.addEventListener('change', (e) => {
  if (e.detail.frameChanged || !timeline.playing) showFrame();
});
showFrame();

const handsView = new HandsView();
scene.add(handsView.points);
const input = new Input(renderer, camera);
const closeGesture = new CloseGesture(renderer);
scene.add(closeGesture.group);
const help = HelpGesture.fromPage();
scene.add(help.group);

// ---------- placement ----------
function placeDesktop() {
  stage.position.set(0, 0.9, -0.62);
  stage.rotation.set(0, 0, 0);
  stage.updateMatrixWorld(true);
  // aimed a little left so the page overlay doesn't cover the stage
  camera.position.set(-0.12, 1.36, 0.3);
  camera.lookAt(-0.12, 1.04, -0.5);
}
placeDesktop();

// Stage half a meter ahead, its floor ~55 cm below your eyes; the timeline
// sits in front of it like a desk.
function placeXR(frame) {
  const pose = frame.getViewerPose(renderer.xr.getReferenceSpace());
  if (!pose) return false;
  const p = pose.transform.position, q = pose.transform.orientation;
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w));
  fwd.y = 0;
  if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
  fwd.normalize();
  stage.position.set(p.x + fwd.x * 0.5, p.y - 0.55, p.z + fwd.z * 0.5);
  stage.lookAt(p.x, stage.position.y, p.z);
  stage.updateMatrixWorld(true);
  return true;
}

// ---------- actions ----------
function press(region) {
  panel.flash(region);
  const id = region.id;
  if (id.startsWith('frame:')) {
    timeline.pause();
    timeline.go(+id.slice(6));
  } else if (id === 'prev') { timeline.pause(); timeline.go(timeline.current - 1); }
  else if (id === 'next') { timeline.pause(); timeline.go(timeline.current + 1); }
  else if (id === 'play') timeline.togglePlay();
  else if (id === 'add') { timeline.pause(); timeline.addFrame(); }
  else if (id === 'delete') { timeline.pause(); timeline.deleteFrame(); }
  else if (id === 'onion') timeline.toggleOnion();
  else if (id === 'hands') timeline.toggleMode('hand');
  else if (id === 'feet') timeline.toggleMode('foot');
  else if (id === 'fps') timeline.cycleFps();
}

addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea')) return;
  const k = e.key.toLowerCase();
  const map = { arrowleft: 'prev', arrowright: 'next', ' ': 'play', n: 'add', delete: 'delete', backspace: 'delete', o: 'onion', h: 'hands', j: 'feet', f: 'fps' };
  if (map[k]) {
    e.preventDefault();
    press({ id: map[k] });
  }
});
document.getElementById('reset').addEventListener('click', () => {
  timeline.pause();
  timeline.setPose(new Rig().restPose());
  showFrame();
});
document.getElementById('clear').addEventListener('click', () => {
  if (confirm('Delete all frames and start a new animation?')) timeline.clear(new Rig().restPose());
});

// ---------- grabbing ----------
const FLAT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
const drags = new Map(); // pointer id → { drag, plane? }
const wasPinching = new Map();
const pressedPanel = new Map(); // hand id → armed in front of the panel
const tmp = new THREE.Vector3(), local = new THREE.Vector3();
const raycaster = new THREE.Raycaster();
const plane = new THREE.Plane();

const grabRadius = () => GRAB_RADIUS * THREE.MathUtils.clamp(stage.scale.x, 0.6, 2);

const _up = new THREE.Vector3();
// Distance from a point to a handle; the floor ring counts anywhere along its rim.
function handleDistance(hm, point) {
  rig.handlePosition(hm.h, tmp);
  if (hm.h.type !== 'move') return tmp.distanceTo(point);
  const k = stage.scale.x;
  _up.set(0, 1, 0).applyQuaternion(stage.quaternion);
  const rel = point.clone().sub(tmp);
  const height = rel.dot(_up);
  const radial = rel.addScaledVector(_up, -height).length();
  return Math.hypot(radial - RING_R * k, height);
}

function nearestHandle(point, max) {
  let best = null, bestD = max;
  for (const hm of handleMeshes) {
    const d = handleDistance(hm, point);
    if (d < bestD) { bestD = d; best = hm; }
  }
  return best;
}

// Mouse clicks on the timeline are handled straight from the event: a quick
// click can press and release between two frames and never be seen by the
// per-frame pinch check.
let panelClickAt = -1e9;
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (renderer.xr.isPresenting || e.button !== 0) return;
  raycaster.setFromCamera(new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), camera);
  panel.mesh.updateMatrixWorld();
  plane.setFromNormalAndCoplanarPoint(panel.mesh.getWorldDirection(new THREE.Vector3()), panel.mesh.getWorldPosition(new THREE.Vector3()));
  const hit = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
  const region = hit && panel.hit(panel.mesh.worldToLocal(hit));
  if (region) {
    panelClickAt = performance.now();
    press(region);
  }
});

// The mouse picks what's under the pointer and drags on a plane facing the camera.
function mouseRay() {
  raycaster.setFromCamera(input.mouse.ndc, camera);
  return raycaster.ray;
}
function nearestHandleToRay(ray, max) {
  let best = null, bestD = max;
  for (const hm of handleMeshes) {
    let d;
    if (hm.h.type === 'move') {
      // where the ray meets the floor plane, compared with the ring's rim
      const c = rig.handlePosition(hm.h, new THREE.Vector3());
      const hit = ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(_up.set(0, 1, 0).applyQuaternion(stage.quaternion), c), new THREE.Vector3());
      d = hit ? handleDistance(hm, hit) : Infinity;
    } else d = ray.distanceToPoint(rig.handlePosition(hm.h, tmp));
    if (d < bestD) { bestD = d; best = hm; }
  }
  return best;
}

function updatePointers(hands, dt) {
  const hover = new Set();
  for (const h of hands) {
    const start = h.pinch && !wasPinching.get(h.id);
    const end = !h.pinch && wasPinching.get(h.id);
    wasPinching.set(h.id, h.pinch);

    if (h.kind === 'mouse') {
      const ray = mouseRay();
      const hm = drags.get(h.id)?.hm || nearestHandleToRay(ray, 0.02);
      if (hm) hover.add(hm);
      // (Clicks on the timeline are handled by the pointerdown listener below.)
      if (start && performance.now() - panelClickAt > 400) {
        if (hm) {
          timeline.pause();
          const at = rig.handlePosition(hm.h, new THREE.Vector3());
          drags.set(h.id, { hm, drag: rig.beginDrag(hm.h, at, timeline.modes), plane: new THREE.Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()), at) });
        }
      }
      const d = drags.get(h.id);
      if (d && h.pinch) {
        const p = ray.intersectPlane(d.plane, new THREE.Vector3());
        if (p) rig.drag(d.drag, p);
      }
    } else {
      // Hands and controllers pinch (trigger) near a handle to grab it. If the
      // other hand is already pinching empty space, this pinch grabs the scene.
      const otherFree = hands.some((o) => o !== h && o.kind !== 'mouse' && o.pinch && !drags.has(o.id));
      if (start && !otherFree) {
        const hm = nearestHandle(h.pinchPoint, grabRadius());
        if (hm) {
          timeline.pause();
          drags.set(h.id, { hm, drag: rig.beginDrag(hm.h, h.pinchPoint, timeline.modes) });
        }
      }
      const d = drags.get(h.id);
      if (d && h.pinch) rig.drag(d.drag, h.pinchPoint);
      const near = d?.hm || (!sceneGrab && nearestHandle(h.pinchPoint, grabRadius() * 1.4));
      if (near) hover.add(near);

      // Poke the timeline with an index finger (not while holding a handle).
      if (h.kind === 'hand' && !d) {
        panel.mesh.worldToLocal(local.copy(h.indexTip));
        const inside = Math.abs(local.x) < 0.25 && Math.abs(local.y) < PANEL_H / 2;
        const deep = inside && local.z < PRESS_DEPTH && local.z > -0.04;
        if (deep && pressedPanel.get(h.id) === false) {
          const region = panel.hit(local);
          if (region) press(region);
        }
        pressedPanel.set(h.id, deep ? true : inside && local.z < HOVER_DEPTH ? false : undefined);
      }
    }
    if (end && drags.has(h.id)) {
      drags.delete(h.id);
      timeline.setPose(rig.getPose());
    }
  }
  for (const id of [...drags.keys()]) {
    if (!hands.some((h) => h.id === id)) {
      drags.delete(id);
      timeline.setPose(rig.getPose());
    }
  }

  const grabbing = new Set([...drags.values()].map((d) => d.hm));
  const k = stage.scale.x;
  for (const hm of handleMeshes) {
    rig.handlePosition(hm.h, hm.m.position);
    if (hm.h.type === 'end') hm.m.material.color.setHex(timeline.modes[hm.h.limb] === 'ik' ? CYAN : AMBER);
    if (hm.h.type === 'move') hm.m.quaternion.copy(stage.quaternion).multiply(FLAT);
    const target = grabbing.has(hm) ? 1 : hover.has(hm) ? 0.6 : 0;
    hm.hover += (target - hm.hover) * Math.min(1, dt * 14);
    hm.m.scale.setScalar(k * (1 + hm.hover * 0.6));
    hm.m.material.opacity = 0.55 + hm.hover * 0.45;
    hm.m.visible = !timeline.playing;
  }
}

// ---------- moving the whole scene ----------
// Pinch empty space with both hands: move your hands to move the scene, pull
// them apart or together to scale it, turn them to turn it.
let sceneGrab = null;
function updateSceneGrab(hands) {
  const free = hands.filter((h) => h.kind !== 'mouse' && h.pinch && !drags.has(h.id));
  if (free.length < 2) {
    sceneGrab = null;
    return;
  }
  const [a, b] = [free[0].pinchPoint, free[1].pinchPoint];
  if (!sceneGrab) {
    timeline.pause();
    sceneGrab = new SceneGrab(stage, a, b);
  }
  sceneGrab.update(a, b);
}

// Desktop: the mouse wheel scales the scene.
function wheelZoom() {
  if (!input.wheel) return;
  const k = THREE.MathUtils.clamp(stage.scale.x * Math.exp(-input.wheel * 0.001), 0.25, 4);
  stage.scale.setScalar(k);
  stage.updateMatrixWorld(true);
  input.wheel = 0;
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
let last = 0;
renderer.setAnimationLoop((time, frame) => {
  const dt = Math.min(Math.max(time / 1000 - last, 0), 1 / 30);
  last = time / 1000;
  if (frame && needPlace && placeXR(frame)) {
    needPlace = false;
    help.hint(renderer.xr.getCamera());
  }
  rig.bones.hips.getWorldPosition(center);
  input.update(frame, dt, center);
  for (const ev of input.events) if (ev === 'recenter') needPlace = true;

  const viewer = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  const helpHand = help.update(input.hands, dt, viewer);
  closeGesture.update(input.hands, dt, viewer);
  const hands = input.hands.filter((h) => h !== helpHand);
  updateSceneGrab(hands);
  wheelZoom();
  placeDesk();
  updatePointers(hands, dt);
  timeline.tick(dt);
  panel.draw();
  handsView.update(input.hands);
  renderer.render(scene, camera);
});
