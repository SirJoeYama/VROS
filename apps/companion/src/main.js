import * as THREE from 'three';
import { Input } from '../../../shared/input.js';
import { HandsView } from '../../../shared/handsView.js';
import { CloseGesture } from '../../../shared/closeGesture.js';
import { HelpGesture } from '../../../shared/helpGesture.js';
import { setupEnterXR } from '../../../shared/xr.js';
import { SceneGrab } from '../../../shared/sceneGrab.js';
import { Speech, micPermission } from '../../../shared/speech.js';
import { Pet } from './pet.js';
import { Bubble, BUBBLE_H } from './bubble.js';
import { Brain, speakable } from './brain.js';
import { Voice } from './voice.js';

const params = new URLSearchParams(location.search);
const isQuest = /OculusBrowser|Quest/i.test(navigator.userAgent);
const hasWebSpeech = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
const ENGINE = params.get('engine') || (hasWebSpeech && !isQuest ? 'web' : 'whisper');
const BG = new THREE.Color(0x04050a);
const TAP_TIME = 0.45, TAP_MOVE = 0.04; // a pinch shorter/stiller than this is a tap
const SEND_AFTER = 0.9; // seconds of quiet after you speak before Pip answers
const LISTEN_FOR = 30; // Pip stops listening after this long without hearing anything
const DOZE_AFTER = 90; // idle seconds before Pip falls asleep

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = BG;
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.01, 50);
scene.add(new THREE.HemisphereLight(0xfff4f8, 0x404060, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(0.6, 1.2, 1);
scene.add(sun);

// ---------- the pet ----------
const pet = new Pet();
scene.add(pet.group);
const bubble = new Bubble();
bubble.mesh.position.set(0, 0.16 + BUBBLE_H / 2, 0.01);
pet.group.add(bubble.mesh);

// ---------- mind and voice ----------
const $ = (id) => document.getElementById(id);
const status = $('status');
const brain = new Brain();
const voice = new Voice({ onChange: renderVoices });

// 'idle' | 'listening' | 'thinking' | 'speaking'
let phase = 'idle';
let listening = false; // conversation mode: Pip listens again after answering
let heard = ''; // what you've said so far this turn
let sendAt = 0; // when to send it (seconds), 0 = not scheduled
let searching = false;
let lastActive = 0; // last time anything happened (for dozing off)
let lastHeard = 0;
let tickleUntil = 0, errorUntil = 0;
let speechStatus = '';
const now = () => performance.now() / 1000;

let speech = null; // created on first use: the on-device model is a big download
function getSpeech() {
  speech ??= new Speech({
    engine: ENGINE,
    model: 'Xenova/whisper-tiny.en',
    onInterim: (s) => {
      if (phase !== 'listening' || !s) return;
      lastHeard = lastActive = now();
      sendAt = 0; // still talking
      bubble.set({ heard: (heard + ' ' + s).trim(), answer: '' });
    },
    onFinal: (s) => {
      if (phase !== 'listening' || !s.trim()) return;
      heard = (heard + ' ' + s).trim();
      lastHeard = lastActive = now();
      sendAt = now() + SEND_AFTER;
      bubble.set({ heard, answer: '' });
    },
    onStatus: (s) => {
      speechStatus = s;
      status.textContent = s;
    },
  });
  return speech;
}

let mic = 'prompt'; // microphone permission: 'granted' | 'prompt' | 'denied'
micPermission().then((state) => (mic = state));
const NEEDS_MIC = 'leave XR and allow the microphone first';
const NEEDS_KEY = 'I need an Anthropic API key. Add one in window mode.';

function say(text, statusText = '') {
  bubble.set({ heard: '', answer: text, status: statusText });
}

async function startListening() {
  if (!brain.hasKey) return say(NEEDS_KEY);
  // Inside XR the permission prompt can't appear, so don't ask there.
  if (renderer.xr.isPresenting && mic !== 'granted') return say('I can’t hear you yet.', NEEDS_MIC);
  listening = true;
  heard = '';
  sendAt = 0;
  phase = 'listening';
  lastHeard = lastActive = now();
  bubble.set({ heard: '', answer: '', status: '' });
  await getSpeech().start();
  if (speech.active) mic = 'granted';
  else stopListening();
  renderTalk();
}

function stopListening() {
  bubble.set({ status: '' });
  listening = false;
  speech?.active && speech.stop();
  if (phase === 'listening') phase = 'idle';
  heard = '';
  sendAt = 0;
  lastActive = now();
  renderTalk();
}

// Stop the answer: the request and the speech.
function hush() {
  brain.cancel();
  voice.stop();
  resume();
}

// After an answer (or a hush): back to listening in conversation mode.
function resume() {
  phase = 'idle';
  lastActive = now();
  if (listening) {
    phase = 'listening';
    heard = '';
    lastHeard = now();
    speech?.start();
  }
  renderTalk();
}

function forget() {
  brain.forget();
  voice.stop();
  sendAt = 0;
  resume();
  bubble.set({ heard: '', answer: '', status: 'conversation cleared' });
  setTimeout(() => bubble.status === 'conversation cleared' && bubble.set({ status: '' }), 2000);
  tickleUntil = now() + 1.5;
}

// The one action: tap to talk, tap again to stop; while Pip answers, hush it.
function talk() {
  lastActive = now();
  if (phase === 'thinking' || phase === 'speaking') return hush();
  if (listening) return stopListening();
  startListening();
}

function tickle() {
  lastActive = now();
  tickleUntil = now() + 2;
}

async function ask(question) {
  question = question.trim();
  if (!question) return;
  if (!brain.hasKey) return say(NEEDS_KEY);
  if (brain.busy) brain.cancel();
  voice.stop();
  heard = '';
  sendAt = 0;
  // Stop listening while Pip answers, so it doesn't hear itself.
  if (speech?.active) speech.stop();
  phase = 'thinking';
  searching = false;
  lastActive = now();
  bubble.set({ heard: question, answer: '', status: '' });
  renderTalk();
  const result = await brain.ask(question, {
    onSentence: (s) => voice.say(s),
    onText: (text) => bubble.set({ answer: speakable(text) }),
    onSearch: () => {
      searching = true;
      bubble.set({ status: 'searching the web…' });
    },
  });
  searching = false;
  if (result.cancelled) return;
  bubble.set({ status: '' });
  if (result.error) {
    errorUntil = now() + 3;
    bubble.set({ answer: result.error });
    voice.say(result.error);
  }
  if (voice.blocked) bubble.set({ status: 'pinch once so Pip can speak' });
  answered = true;
}
let answered = false;

// Moves the conversation along each frame.
function updatePhase() {
  const t = now();
  if (phase === 'listening') {
    if (sendAt && t >= sendAt && heard) ask(heard);
    else if (!heard && t - lastHeard > LISTEN_FOR) {
      stopListening();
      bubble.set({ status: 'tap to talk' });
    }
  }
  if (phase === 'thinking' && voice.speaking) phase = 'speaking';
  if ((phase === 'thinking' || phase === 'speaking') && answered && !brain.busy && !voice.speaking) {
    answered = false;
    resume();
  }
  if (phase !== 'idle') lastActive = t;
}

function face() {
  const t = now();
  if (!brain.hasKey) return 'nokey';
  if (t < errorUntil) return 'error';
  if (t < tickleUntil) return 'happy';
  if (phase === 'listening') return 'listening';
  if (phase === 'thinking') return searching ? 'searching' : 'thinking';
  if (phase === 'speaking') return 'speaking';
  return t - lastActive > DOZE_AFTER ? 'sleep' : 'idle';
}

// ---------- 2D page ----------
const keyInput = $('key');
function renderKey() {
  const note = $('key-note');
  if (brain.hasKey) {
    keyInput.value = '';
    keyInput.placeholder = 'API key saved in this browser';
    note.innerHTML = 'Your key stays in this browser and is sent only to Anthropic. <button type="button" id="key-remove">Remove</button>';
    $('key-remove').onclick = () => {
      brain.setKey('');
      renderKey();
    };
  } else {
    keyInput.placeholder = 'Anthropic API key (sk-ant-…)';
    note.innerHTML = 'Pip thinks with Claude. Get a key at <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a>; it stays in this browser.';
  }
}
$('key-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!keyInput.value.trim()) return;
  brain.setKey(keyInput.value);
  renderKey();
  bubble.set({ heard: '', answer: 'Hello! Tap to talk, or type a question.', status: '' });
  tickle();
});
renderKey();

function renderTalk() {
  const b = $('talk');
  const busy = phase === 'thinking' || phase === 'speaking';
  b.textContent = busy ? 'Hush' : listening ? 'Stop listening' : 'Talk';
  b.classList.toggle('on', listening || busy);
}
$('talk').addEventListener('click', talk);
renderTalk();

$('ask-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('ask').value;
  $('ask').value = '';
  ask(q);
});

function renderVoices() {
  const sel = $('voice');
  if (!voice.available || !voice.voices.length) {
    sel.replaceChildren(new Option(voice.available ? 'default voice' : 'no speech on this browser', ''));
    return;
  }
  sel.replaceChildren(...voice.voices.map((v) => new Option(`${v.name} (${v.lang})`, v.name)));
  sel.value = voice.voice?.name || '';
}
$('voice').addEventListener('change', (e) => {
  voice.choose(e.target.value);
  voice.say('Hello, I sound like this.');
});
renderVoices();
// Any click on the page counts as a user action, which lets Pip speak.
addEventListener('pointerdown', () => voice.unlock(), true);

// ---------- placement ----------
function placeDesktop() {
  pet.group.position.set(0, 1.28, -0.25);
  pet.group.quaternion.identity();
  pet.group.scale.setScalar(1);
  camera.position.set(-0.13, 1.36, 0.42);
  camera.lookAt(-0.13, 1.34, -0.25);
}
placeDesktop();

// Pip half a meter ahead, a little below eye height, facing you.
function placeXR(frame) {
  const pose = frame.getViewerPose(renderer.xr.getReferenceSpace());
  if (!pose) return false;
  const p = pose.transform.position, q = pose.transform.orientation;
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w));
  fwd.y = 0;
  if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
  fwd.normalize();
  pet.group.position.set(p.x + fwd.x * 0.5, p.y - 0.2, p.z + fwd.z * 0.5);
  pet.group.lookAt(p.x, p.y - 0.2, p.z);
  pet.group.scale.setScalar(1);
  return true;
}

// ---------- gestures ----------
const handsView = new HandsView();
scene.add(handsView.points);
const input = new Input(renderer, camera);
const closeGesture = new CloseGesture(renderer);
scene.add(closeGesture.group);
const help = HelpGesture.fromPage();
scene.add(help.group);

const pinches = new Map(); // pointer id → { t, at, cancelled }
const armed = new Map(); // hand id → the fingertip hovering in front of a button
let grab = null;
const local = new THREE.Vector3();
const ACTIONS = { talk, hush, forget, screen: tickle };

function toPet(p) {
  return pet.body.worldToLocal(local.copy(p));
}

function updateGestures(hands) {
  const t = now();
  const pinching = hands.filter((h) => h.pinch && h.kind !== 'mouse');

  // Two hands pinching: move / scale / turn Pip. Neither pinch is a tap.
  if (pinching.length >= 2) {
    if (!grab) grab = new SceneGrab(pet.group, pinching[0].pinchPoint, pinching[1].pinchPoint, { min: 0.4, max: 4 });
    grab.update(pinching[0].pinchPoint, pinching[1].pinchPoint);
    for (const h of pinching) if (pinches.has(h.id)) pinches.get(h.id).cancelled = true;
  } else grab = null;

  for (const h of hands) {
    if (h.kind === 'mouse') continue; // clicks: see the listeners below
    // Pinch tap anywhere away from the egg: talk / stop / hush.
    const p = pinches.get(h.id);
    if (h.pinch && !p) {
      pinches.set(h.id, { t, at: h.pinchPoint.clone(), cancelled: pet.near(toPet(h.pinchPoint), 0.02) || !!grab });
    } else if (!h.pinch && p) {
      pinches.delete(h.id);
      if (!p.cancelled && t - p.t < TAP_TIME && h.pinchPoint.distanceTo(p.at) < TAP_MOVE) talk();
    }

    // Poke a button (or the screen) with an index finger.
    if (h.kind === 'hand') {
      const tip = toPet(h.indexTip);
      const deep = pet.hit(tip, 0.001);
      const near = pet.hit(tip, 0.04);
      if (deep && armed.get(h.id) === deep) {
        pet.press(deep);
        ACTIONS[deep]();
      }
      armed.set(h.id, deep ? null : near);
    }
  }
  for (const id of [...pinches.keys()]) if (!hands.some((h) => h.id === id)) pinches.delete(id);
  for (const ev of input.events) if (ev === 'recenter') needPlace = true;
}

// Mouse: click a button, the screen (tickle) or the egg (talk).
const raycaster = new THREE.Raycaster();
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (renderer.xr.isPresenting || e.button !== 0) return;
  raycaster.setFromCamera(new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), camera);
  const hit = raycaster.intersectObject(pet.body, true)[0];
  if (!hit) return;
  const id = pet.hit(toPet(hit.point), 0.02);
  if (id) {
    pet.press(id);
    ACTIONS[id]();
  } else talk();
});

// ---------- XR session ----------
let needPlace = false;
const xr = setupEnterXR({
  renderer,
  button: $('enter'),
  status,
  // The mic permission prompt can't show inside XR. If it hasn't been
  // answered yet, this tap only asks for the mic; the next tap enters XR.
  beforeEnter: (handedOver) => {
    if (mic !== 'prompt' || handedOver) return true;
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((s) => {
        s.getTracks().forEach((tr) => tr.stop());
        mic = 'granted';
        status.textContent = 'microphone ready: tap Enter again';
      })
      .catch(() => {
        mic = 'denied';
        status.textContent = 'no microphone: you can still type questions here. Tap Enter again';
      });
    return false;
  },
});
renderer.xr.addEventListener('sessionstart', () => {
  document.body.classList.add('in-xr');
  scene.background = xr.mode === 'immersive-ar' ? null : BG;
  handsView.points.material.uniforms.uScale.value = 1000;
  // A pinch ("select") counts as a user action: it lets the mic start and
  // Pip speak, which a poke on a 3D button can't.
  const session = renderer.xr.getSession();
  const unlock = () => {
    speech?.unlock();
    voice.unlock();
  };
  session.addEventListener('select', unlock);
  session.addEventListener('squeeze', unlock);
  needPlace = true;
  if (!brain.hasKey) say(NEEDS_KEY);
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

if (!brain.hasKey) say('Hi, I’m Pip! Give me an API key and we can talk.');
else say('Hi, I’m Pip! Tap to talk.');

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
  input.update(frame, dt, pet.group.getWorldPosition(center));
  const viewer = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  const helpHand = help.update(input.hands, dt, viewer);
  closeGesture.update(input.hands, dt, viewer);
  updateGestures(input.hands.filter((h) => h !== helpHand));
  updatePhase();
  if (phase === 'listening' && speechStatus && !heard && !bubble.answer) bubble.set({ status: speechStatus === 'listening' ? 'listening…' : speechStatus });
  pet.update(dt, face());
  bubble.draw();
  handsView.update(input.hands);
  renderer.render(scene, camera);
});
