import * as THREE from 'three';
import { Input } from './shared/input.js';
import { HandsView } from './shared/handsView.js';
import { CloseGesture } from './shared/closeGesture.js';
import { Pointer } from './shared/pointer.js';
import { HelpGesture } from './shared/helpGesture.js';
import { setupEnterXR } from './shared/xr.js';

const TILE = 0.11; // icon size (m)
const GAP = 0.035;
const RADIUS = 0.55; // distance of the icon arc from your head
const HOVER_DEPTH = 0.06; // fingertip this close in front of an icon highlights it
const PRESS_DEPTH = 0.012; // ...and this close presses it

const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

function textPlane(width, aspect) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = Math.round(1024 / aspect);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, width / aspect),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }),
  );
  return { canvas, ctx: canvas.getContext('2d'), texture, mesh };
}

function roundedRect(size, radius) {
  const h = size / 2, r = radius;
  const s = new THREE.Shape();
  s.moveTo(-h + r, -h);
  s.lineTo(h - r, -h);
  s.quadraticCurveTo(h, -h, h, -h + r);
  s.lineTo(h, h - r);
  s.quadraticCurveTo(h, h, h - r, h);
  s.lineTo(-h + r, h);
  s.quadraticCurveTo(-h, h, -h, h - r);
  s.lineTo(-h, -h + r);
  s.quadraticCurveTo(-h, -h, -h + r, -h);
  return new THREE.ShapeGeometry(s, 6);
}

function iconTexture(src) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const img = new Image();
  img.onload = () => {
    canvas.getContext('2d').drawImage(img, 0, 0, 256, 256);
    texture.needsUpdate = true;
  };
  img.src = src;
  return texture;
}

// The icons, title and clock, laid out on an arc in front of the viewer.
// Poke an icon with your index finger (or pinch on it with a controller) to
// call onLaunch(app).
export class HomeShelf {
  constructor(apps, onLaunch) {
    this.onLaunch = onLaunch;
    this.group = new THREE.Group();
    this.launching = false;
    this._local = new THREE.Vector3();
    this._wasPinching = new Map();

    this.title = textPlane(0.3, 4);
    this.group.add(this.title.mesh);
    this._titleKey = '';

    this.tiles = apps.map((app) => {
      const group = new THREE.Group();
      const glow = new THREE.Mesh(
        roundedRect(TILE * 1.22, TILE * 0.3),
        new THREE.MeshBasicMaterial({ color: 0x9fb8ff, transparent: true, opacity: 0, depthWrite: false }),
      );
      glow.position.z = -0.002;
      const icon = new THREE.Mesh(
        new THREE.PlaneGeometry(TILE, TILE),
        new THREE.MeshBasicMaterial({ map: iconTexture(`apps/${app.id}/icon.svg`), transparent: true }),
      );
      const label = textPlane(TILE * 1.6, 5);
      label.ctx.textAlign = 'center';
      label.ctx.textBaseline = 'middle';
      label.ctx.font = `400 120px ${FONT}`;
      label.ctx.fillStyle = '#dfe6ff';
      label.ctx.fillText(app.name, 512, 102);
      label.texture.needsUpdate = true;
      label.mesh.position.y = -TILE * 0.72;
      group.add(glow, icon, label.mesh);
      this.group.add(group);
      return { app, group, glow, hover: 0, pressed: new Map() };
    });
  }

  // `head`: eye position; `fwd`: horizontal unit vector the viewer faces.
  layout(head, fwd) {
    const y = head.y - 0.12;
    const step = (TILE + GAP) / RADIUS;
    this.tiles.forEach((tile, i) => {
      const a = (i - (this.tiles.length - 1) / 2) * step;
      const dir = fwd.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -a);
      tile.group.position.set(head.x + dir.x * RADIUS, y, head.z + dir.z * RADIUS);
      tile.group.lookAt(head.x, y, head.z);
    });
    const t = this.title.mesh;
    t.position.set(head.x + fwd.x * (RADIUS + 0.02), y + 0.15, head.z + fwd.z * (RADIUS + 0.02));
    t.lookAt(head.x, y + 0.15, head.z);
    this.group.updateMatrixWorld(true);
  }

  update(hands, dt) {
    this._drawTitle();
    const local = this._local;
    for (const tile of this.tiles) {
      let hover = false;
      for (const h of hands) {
        const pinchStart = h.pinch && !this._wasPinching.get(h.id);
        const point = h.kind === 'hand' ? h.indexTip : h.pinchPoint;
        tile.group.worldToLocal(local.copy(point));
        const inside = Math.abs(local.x) < TILE * 0.6 && Math.abs(local.y) < TILE * 0.6;
        if (inside && local.z < HOVER_DEPTH && local.z > -0.04) hover = true;
        if (h.kind === 'hand') {
          // Press on the way in: the fingertip reaches the icon from in front.
          const deep = inside && local.z < PRESS_DEPTH && local.z > -0.04;
          if (deep && tile.pressed.get(h.id) === false) this._launch(tile);
          tile.pressed.set(h.id, deep ? true : inside && local.z < HOVER_DEPTH ? false : undefined);
        } else if (pinchStart && inside && Math.abs(local.z) < 0.08) this._launch(tile);
      }
      tile.hover += ((hover ? 1 : 0) - tile.hover) * Math.min(1, dt * 12);
      tile.group.scale.setScalar(1 + tile.hover * 0.12);
      if (!this.launching) tile.glow.material.opacity = tile.hover * 0.35;
    }
    for (const h of hands) this._wasPinching.set(h.id, h.pinch);
  }

  _launch(tile) {
    if (this.launching) return;
    this.launching = true;
    tile.glow.material.opacity = 0.9;
    this.onLaunch(tile.app);
  }

  _drawTitle() {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (time === this._titleKey) return;
    this._titleKey = time;
    const { ctx, canvas, texture } = this.title;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#dfe6ff';
    ctx.shadowColor = 'rgba(160, 190, 255, 0.9)';
    ctx.shadowBlur = 20;
    ctx.font = `200 110px ${FONT}`;
    ctx.letterSpacing = '40px';
    ctx.fillText('VROS', canvas.width / 2 + 20, 100);
    ctx.shadowBlur = 0;
    ctx.letterSpacing = '6px';
    ctx.font = `300 44px ${FONT}`;
    ctx.fillStyle = '#9fb8ff';
    ctx.fillText(time, canvas.width / 2, 205);
    texture.needsUpdate = true;
  }
}

// The home screen in XR. Opening an app navigates while still in XR, so the
// app can take the session over (WebXR navigation) and you stay in the
// headset. A right-hand thumbs down leaves XR; palm toward your eyes shows help.
export function startHomeXR(apps, button) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local-floor');
  renderer.domElement.style.display = 'none'; // only shown in XR; the 2D page stays as is
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.01, 50);
  const input = new Input(renderer, camera);
  const handsView = new HandsView();
  handsView.points.material.uniforms.uScale.value = 1000;
  scene.add(handsView.points);

  const closeGesture = new CloseGesture(renderer, null);
  scene.add(closeGesture.group);
  const help = new HelpGesture('VROS', [
    { icon: '👉', key: 'Poke an icon', text: 'open that app' },
    { icon: '👎', key: 'Right thumbs down', text: 'here: leave XR' },
  ], { sub: 'home', common: [] });
  scene.add(help.group);
  // Controllers: point at an icon and pull the trigger.
  const pointer = new Pointer();
  scene.add(pointer.group);

  const shelf = new HomeShelf(apps, (app) => setTimeout(() => location.assign(`apps/${app.id}/`), 120));
  scene.add(shelf.group);

  function layout(frame) {
    const pose = frame.getViewerPose(renderer.xr.getReferenceSpace());
    if (!pose) return false;
    const p = pose.transform.position, q = pose.transform.orientation;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w));
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
    shelf.layout(new THREE.Vector3(p.x, p.y, p.z), fwd.normalize());
    return true;
  }

  let needLayout = false;
  const xr = setupEnterXR({ renderer, button });
  renderer.xr.addEventListener('sessionstart', () => {
    renderer.domElement.style.display = 'block';
    scene.background = xr.mode === 'immersive-ar' ? null : new THREE.Color(0x04050a);
    needLayout = true;
  });
  renderer.xr.addEventListener('sessionend', () => {
    renderer.domElement.style.display = 'none';
    help.hide();
  });

  let last = 0;
  renderer.setAnimationLoop((time, frame) => {
    if (!renderer.xr.isPresenting) return;
    const dt = Math.min(Math.max(time / 1000 - last, 0), 1 / 30);
    last = time / 1000;
    if (frame && needLayout && layout(frame)) {
      needLayout = false;
      help.hint(renderer.xr.getCamera());
    }
    input.update(frame, dt, shelf.title.mesh.position);
    for (const ev of input.events) if (ev === 'recenter') needLayout = true;
    const viewer = renderer.xr.getCamera();
    const helpHand = help.update(input.hands, dt, viewer);
    closeGesture.update(input.hands, dt, viewer);
    const pointing = pointer.update(input.hands, shelf.tiles.map((tile) => ({ object: tile.group, w: TILE * 1.2, h: TILE * 1.2, press: () => shelf._launch(tile) })));
    shelf.update(input.hands.filter((h) => h !== helpHand && !pointing.has(h.id) && !h.aim), dt);
    handsView.update(input.hands);
    renderer.render(scene, camera);
  });
}
