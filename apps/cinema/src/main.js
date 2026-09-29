import * as THREE from 'three';
import { Input } from '../../../shared/input.js';
import { HandsView } from '../../../shared/handsView.js';
import { CloseGesture } from '../../../shared/closeGesture.js';
import { UndoGesture } from '../../../shared/undoGesture.js';
import { HelpGesture } from '../../../shared/helpGesture.js';
import { setupEnterXR } from '../../../shared/xr.js';
import { FistTwist } from '../../../shared/fistTwist.js';
import { NavGrab, resetDolly } from '../../../shared/navGrab.js';
import { Player, formatTime } from './player.js';
import { Remote, REMOTE_W, REMOTE_H } from './remote.js';

const BG = new THREE.Color(0x04050a);
const SCREEN_W = 1.6; // meters; height follows the video's shape
const SECONDS_PER_TURN = 60; // a full clockwise turn of the fist = one minute forward
const TAP_TIME = 0.45, TAP_MOVE = 0.04; // a pinch shorter/stiller than this is a tap
const SAMPLES = [
  { name: 'Flower (CC0 sample)', src: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4' },
  { name: 'T-rex roar (CC0 audio sample)', src: 'https://interactive-examples.mdn.mozilla.net/media/cc0-audio/t-rex-roar.mp3' },
];

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = BG;
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.01, 50);
// The camera sits in a "dolly": grabbing empty space with both hands moves,
// turns and scales the dolly (your view), never the screen.
// The remote lives in it too, so it stays with you.
const dolly = new THREE.Group();
dolly.add(camera);
scene.add(dolly);
const you = () => dolly.scale.x; // your size in the world: real distances get multiplied by it

// ---------- player ----------
const video = document.createElement('video');
video.playsInline = true;
video.preload = 'auto';
const player = new Player(video);
player.add(SAMPLES);

// ---------- screen ----------
const theater = new THREE.Group(); // screen + glow; two-hand pinch moves/scales/turns it
scene.add(theater);
const videoTex = new THREE.VideoTexture(video);
videoTex.colorSpace = THREE.SRGBColorSpace;
const card = document.createElement('canvas');
card.width = 1024;
card.height = 576;
const cardTex = new THREE.CanvasTexture(card);
cardTex.colorSpace = THREE.SRGBColorSpace;
const screen = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: cardTex, toneMapped: false }));
const glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0x9fb8ff, transparent: true, opacity: 0.12, depthWrite: false }));
glow.position.z = -0.01;
theater.add(glow, screen);

// On-screen feedback (play/pause, how far you've scrubbed), drawn over the picture.
const osdCanvas = document.createElement('canvas');
osdCanvas.width = 1024;
osdCanvas.height = 256;
const osdTex = new THREE.CanvasTexture(osdCanvas);
osdTex.colorSpace = THREE.SRGBColorSpace;
const osd = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.2), new THREE.MeshBasicMaterial({ map: osdTex, transparent: true, depthWrite: false }));
osd.position.z = 0.01;
theater.add(osd);
let osdText = '', osdTime = 0;
function flash(text, hold = 0.9) {
  osdText = text;
  osdTime = hold;
  const g = osdCanvas.getContext('2d');
  g.clearRect(0, 0, 1024, 256);
  g.fillStyle = 'rgba(4, 5, 10, 0.6)';
  g.beginPath();
  g.roundRect(212, 38, 600, 180, 40);
  g.fill();
  g.fillStyle = '#fff';
  g.font = '300 96px system-ui, -apple-system, "Segoe UI", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 512, 130);
  osdTex.needsUpdate = true;
}

function drawCard() {
  const g = card.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 1024, 576);
  grad.addColorStop(0, '#15183a');
  grad.addColorStop(1, '#06070f');
  g.fillStyle = grad;
  g.fillRect(0, 0, 1024, 576);
  g.fillStyle = '#9fb8ff';
  g.font = '200 150px system-ui, -apple-system, "Segoe UI", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(player.error ? '⚠' : player.item ? '♪' : '▶', 512, 230);
  g.fillStyle = '#dfe6ff';
  g.font = '300 44px system-ui, -apple-system, "Segoe UI", sans-serif';
  g.fillText(player.error || player.item?.name || 'Open a video or audio file', 512, 400);
  cardTex.needsUpdate = true;
}

// Show the picture when there is one, a title card otherwise, at the right shape.
let shownKey = '';
function updateScreen() {
  const pic = player.hasPicture && !player.error;
  const key = `${pic}|${player.index}|${player.error}|${video.videoWidth}x${video.videoHeight}`;
  if (key === shownKey) return;
  shownKey = key;
  if (!pic) drawCard();
  screen.material.map = pic ? videoTex : cardTex;
  screen.material.needsUpdate = true;
  const aspect = pic ? video.videoWidth / video.videoHeight : 16 / 9;
  const h = SCREEN_W / aspect;
  screen.scale.set(SCREEN_W, h, 1);
  glow.scale.set(SCREEN_W + 0.06, h + 0.06, 1);
  osd.position.y = -h / 2 + 0.16;
}

// ---------- remote ----------
const remote = new Remote(player);
dolly.add(remote.mesh);

// ---------- 2D page ----------
const $ = (id) => document.getElementById(id);
const list = $('playlist');
function renderPlaylist() {
  list.replaceChildren(
    ...player.list.map((it, i) => {
      const li = document.createElement('li');
      li.textContent = it.name;
      li.className = i === player.index ? 'on' : '';
      li.onclick = () => player.load(i);
      return li;
    }),
  );
  $('playpause').textContent = player.playing || player.pendingPlay ? 'Pause' : 'Play';
  $('time').textContent = `${formatTime(player.time)} / ${formatTime(player.duration)}`;
}
player.addEventListener('change', renderPlaylist);
renderPlaylist();
$('files').addEventListener('change', (e) => {
  if (e.target.files.length) player.addFiles(e.target.files);
  e.target.value = '';
});
$('url-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const url = $('url').value.trim();
  if (!url) return;
  player.add([{ name: decodeURIComponent(url.split('/').pop().split('?')[0]) || url, src: url }], true);
  $('url').value = '';
});
$('playpause').addEventListener('click', () => player.toggle());

// ---------- placement ----------
function placeDesktop() {
  theater.position.set(0, 1.5, -2);
  theater.quaternion.identity();
  theater.scale.setScalar(1);
  remote.mesh.position.set(0, 0.88, -1.0);
  remote.mesh.rotation.set(-0.6, 0, 0);
  camera.position.set(-0.3, 1.35, 0.4);
  camera.lookAt(-0.3, 1.3, -2);
}
placeDesktop();

// The screen 1.4 m ahead at eye height; the remote close to your hands.
function placeXR(frame) {
  const pose = frame.getViewerPose(renderer.xr.getReferenceSpace());
  if (!pose) return false;
  const p = pose.transform.position, q = pose.transform.orientation;
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w));
  fwd.y = 0;
  if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
  fwd.normalize();
  const head = new THREE.Vector3(p.x, p.y, p.z);
  resetDolly(dolly); // back to your real place and size
  theater.position.set(p.x + fwd.x * 1.4, p.y, p.z + fwd.z * 1.4);
  theater.lookAt(head.x, p.y, head.z);
  remote.mesh.position.set(p.x + fwd.x * 0.42, p.y - 0.4, p.z + fwd.z * 0.42);
  remote.mesh.lookAt(head);
  return true;
}

// ---------- gestures ----------
const handsView = new HandsView();
scene.add(handsView.points);
const input = new Input(renderer, camera);
input.origin = dolly; // tracked hands come in world space, wherever the view has gone
const closeGesture = new CloseGesture(renderer);
scene.add(closeGesture.group);
// Peace sign held a second: undo / redo (nothing to undo here, it just says so).
const undoGesture = new UndoGesture();
scene.add(undoGesture.group);
const help = HelpGesture.fromPage();
scene.add(help.group);
const twist = new FistTwist();

const pinches = new Map(); // pointer id → { t, at, cancelled }
const armed = new Map(); // hand id → fingertip is in front of the remote
let grab = null, scrub = 0, scrubbing = false;
const local = new THREE.Vector3();

function onRemote(point, depth) {
  remote.mesh.worldToLocal(local.copy(point));
  return Math.abs(local.x) < REMOTE_W / 2 && Math.abs(local.y) < REMOTE_H / 2 && local.z < depth && local.z > -0.04;
}

// Two hands pinching empty space: look around. Move your view, pull apart /
// push together to zoom, turn your hands to turn the view; it only moves the
// camera. Two fists held for a second: back in front of the screen, at life size.
let fistsHeld = 0;
function updateView(pinching, hands, dt) {
  if (pinching.length >= 2) {
    grab ??= new NavGrab(dolly, pinching[0].realPinch, pinching[1].realPinch, { min: 0.1, max: 10 });
    grab.update(pinching[0].realPinch, pinching[1].realPinch);
    for (const h of pinching) if (pinches.has(h.id)) pinches.get(h.id).cancelled = true;
  } else grab = null;
  const fists = hands.filter((h) => h.kind === 'hand' && h.fist).length;
  fistsHeld = fists === 2 ? fistsHeld + dt : 0;
  if (fistsHeld > 1) {
    fistsHeld = -1e9; // once per hold
    needPlace = true;
  }
  return fists;
}

function updateGestures(hands, dt) {
  const now = performance.now() / 1000;
  const pinching = hands.filter((h) => h.pinch && h.kind !== 'mouse');
  // Neither pinch of a two-hand grab is a tap.
  const fists = updateView(pinching, hands, dt);

  let twisting = false;
  for (const h of hands) {
    // Pinch tap anywhere (not on the remote): play / pause. (Mouse clicks are
    // handled by the click listener below.)
    const p = pinches.get(h.id);
    if (h.kind === 'mouse') {
      // nothing: see the click listener
    } else if (h.pinch && !p) {
      pinches.set(h.id, { t: now, at: h.pinchPoint.clone(), cancelled: onRemote(h.pinchPoint, 0.06) || !!grab });
    } else if (!h.pinch && p) {
      pinches.delete(h.id);
      const still = h.pinchPoint.distanceTo(p.at) < TAP_MOVE * you();
      if (!p.cancelled && now - p.t < TAP_TIME && still) {
        player.toggle();
        flash(player.playing || player.pendingPlay ? '▶' : '❚❚');
      }
    }

    // Fist + twist: a jog dial. Clockwise goes forward, counter-clockwise back.
    // (One fist only: two fists are the recenter gesture.)
    if (h.kind === 'hand' && h.fist && fists === 1) {
      twisting = true;
      const d = twist.roll(h);
      if (Math.abs(d) > 0.003) {
        const s = (d / (Math.PI * 2)) * SECONDS_PER_TURN;
        player.seekBy(s);
        scrub += s;
      }
    } else twist.release(h);

    // Poke the remote with an index finger.
    if (h.kind === 'hand') {
      const deep = onRemote(h.indexTip, 0.01);
      if (deep && armed.get(h.id) === false) {
        remote.mesh.worldToLocal(local.copy(h.indexTip));
        const hit = remote.hit(local);
        if (hit) {
          remote.press(hit);
          if (hit.id === 'play') flash(player.playing || player.pendingPlay ? '▶' : '❚❚');
        }
      }
      armed.set(h.id, deep ? true : onRemote(h.indexTip, 0.06) ? false : undefined);
    }
  }
  twist.prune(hands);
  for (const id of [...pinches.keys()]) if (!hands.some((h) => h.id === id)) pinches.delete(id);

  if (twisting) {
    scrubbing = true;
    flash(`${scrub >= 0 ? '⏩ +' : '⏪ −'}${Math.abs(Math.round(scrub))} s`, 0.8);
  } else if (scrubbing) {
    scrubbing = false;
    scrub = 0;
  }

  for (const ev of input.events) {
    if (ev === 'next') { player.seekBy(10); flash('⏩ +10 s'); }
    else if (ev === 'prev') { player.seekBy(-10); flash('⏪ −10 s'); }
    else if (ev === 'recenter') needPlace = true;
  }
  if (input.wheel) {
    // desktop: the wheel scrubs
    player.seekBy(input.wheel / 20);
    flash(`${input.wheel > 0 ? '⏩' : '⏪'} ${formatTime(player.time)}`, 0.6);
    input.wheel = 0;
  }

  osdTime -= dt;
  osd.material.opacity = THREE.MathUtils.clamp(osdTime * 3, 0, 1);
  osd.visible = osdTime > 0 && !!osdText;
}

// Mouse clicks on the remote, straight from the event (a quick click can fall
// between two frames).
let remoteClickAt = -1e9;
const raycaster = new THREE.Raycaster();
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (renderer.xr.isPresenting || e.button !== 0) return;
  raycaster.setFromCamera(new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), camera);
  const hit = raycaster.intersectObject(remote.mesh)[0];
  if (!hit) return;
  const r = remote.hit(remote.mesh.worldToLocal(hit.point.clone()));
  if (r) {
    remoteClickAt = performance.now();
    remote.press(r);
  }
});
// A click anywhere else on the view: play / pause.
renderer.domElement.addEventListener('click', () => {
  if (renderer.xr.isPresenting || performance.now() - remoteClickAt < 400) return;
  player.toggle();
  flash(player.playing || player.pendingPlay ? '▶' : '❚❚');
});
addEventListener('keydown', (e) => {
  if (e.target.closest('input')) return;
  const k = e.key;
  if (k === ' ') { e.preventDefault(); player.toggle(); flash(player.playing || player.pendingPlay ? '▶' : '❚❚'); }
  else if (k === 'ArrowRight') { player.seekBy(10); flash('⏩ +10 s'); }
  else if (k === 'ArrowLeft') { player.seekBy(-10); flash('⏪ −10 s'); }
  else if (k === 'n') player.next();
  else if (k === 'p') player.prev();
});

// ---------- XR session ----------
let needPlace = false;
const xr = setupEnterXR({ renderer, button: $('enter'), status: $('status') });
renderer.xr.addEventListener('sessionstart', () => {
  document.body.classList.add('in-xr');
  scene.background = xr.mode === 'immersive-ar' ? null : BG;
  handsView.points.material.uniforms.uScale.value = 1000;
  // A pinch ("select") counts as a user action, so it can start playback
  // the browser refused earlier.
  const session = renderer.xr.getSession();
  session.addEventListener('select', () => player.unlock());
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
  input.update(frame, dt, theater.getWorldPosition(center));
  const viewer = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  const helpHand = help.update(input.hands, dt, viewer);
  closeGesture.update(input.hands, dt, viewer);
  undoGesture.update(input.hands, dt, viewer);
  updateGestures(input.hands.filter((h) => h !== helpHand), dt);
  updateScreen();
  remote.draw();
  handsView.update(input.hands, you());
  renderer.render(scene, camera);
});
