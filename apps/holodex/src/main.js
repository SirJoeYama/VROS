import * as THREE from 'three';
import { Input } from '../../../shared/input.js';
import { HandsView } from '../../../shared/handsView.js';
import { CloseGesture } from '../../../shared/closeGesture.js';
import { HelpGesture } from '../../../shared/helpGesture.js';
import { setupEnterXR } from '../../../shared/xr.js';
import { Tabs } from './tabs.js';
import { startUI } from './ui.js';
import { Drum3D } from './drum3d.js';

const tabs = new Tabs();
startUI(tabs);

// ---------- XR: the same tabs on a 3D Rolodex ----------
// Web pages can't be drawn inside an immersive session, so picking a card
// leaves XR and shows that tab in the 2D browser.
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.domElement.classList.add('xr-canvas');
renderer.domElement.style.display = 'none';
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.01, 50);
const input = new Input(renderer, camera);
const handsView = new HandsView();
handsView.points.material.uniforms.uScale.value = 1000;
scene.add(handsView.points);
const closeGesture = new CloseGesture(renderer);
scene.add(closeGesture.group);
const help = HelpGesture.fromPage();
scene.add(help.group);

const drum = new Drum3D(tabs, (tab) => {
  tabs.activate(tab.id);
  renderer.xr.getSession()?.end();
});
scene.add(drum.group);
tabs.addEventListener('change', () => drum.sync());

function place(frame) {
  const pose = frame.getViewerPose(renderer.xr.getReferenceSpace());
  if (!pose) return false;
  const p = pose.transform.position, q = pose.transform.orientation;
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w));
  fwd.y = 0;
  if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
  drum.place(new THREE.Vector3(p.x, p.y, p.z), fwd.normalize());
  return true;
}

let needPlace = false;
const xr = setupEnterXR({ renderer, button: document.getElementById('enter') });
renderer.xr.addEventListener('sessionstart', () => {
  renderer.domElement.style.display = 'block';
  scene.background = xr.mode === 'immersive-ar' ? null : new THREE.Color(0x04050a);
  drum.rot = tabs.activeIndex;
  drum.vel = 0;
  needPlace = true;
});
renderer.xr.addEventListener('sessionend', () => {
  renderer.domElement.style.display = 'none';
  help.hide();
});

const center = new THREE.Vector3();
let last = 0;
renderer.setAnimationLoop((time, frame) => {
  if (!renderer.xr.isPresenting) return;
  const dt = Math.min(Math.max(time / 1000 - last, 0), 1 / 30);
  last = time / 1000;
  if (frame && needPlace && place(frame)) {
    needPlace = false;
    help.hint(renderer.xr.getCamera());
  }
  input.update(frame, dt, drum.group.getWorldPosition(center));
  for (const ev of input.events) if (ev === 'recenter') needPlace = true;
  const viewer = renderer.xr.getCamera();
  const helpHand = help.update(input.hands, dt, viewer);
  closeGesture.update(input.hands, dt, viewer);
  drum.update(input.hands.filter((h) => h !== helpHand), dt);
  handsView.update(input.hands);
  renderer.render(scene, camera);
});
