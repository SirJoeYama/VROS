import * as THREE from 'three';
import { LCD } from './lcd.js';

// The companion's body: an egg-shaped handheld with a keychain loop, a small
// pixel screen and three buttons, like the virtual pets of the 90s.
const H = 0.24; // egg height (m)
const R = 0.095; // widest radius
const ZS = 0.5; // front-to-back squash
const SCREEN = { y: 0.022, w: 0.09, h: 0.06 };
const BEZEL = { w: 0.108, h: 0.078, depth: 0.03, front: 0.05 };
export const BUTTONS = [
  { id: 'talk', label: 'TALK', x: -0.036, y: -0.052 },
  { id: 'hush', label: 'HUSH', x: 0, y: -0.062 },
  { id: 'forget', label: 'FORGET', x: 0.036, y: -0.052 },
];
const BTN_R = 0.011;

// Egg outline: radius at height t ∈ [0, 1] (bottom to top), a bit fuller below.
function radiusAt(t) {
  const s = 2 * t - 1;
  return R * Math.sqrt(Math.max(0, 1 - s * s)) * (1 - 0.12 * s);
}
const tOf = (y) => THREE.MathUtils.clamp((y + H / 2) / H, 0, 1);
export function surfaceZ(x, y) {
  const r = radiusAt(tOf(y));
  return ZS * Math.sqrt(Math.max(0, r * r - x * x));
}

export class Pet {
  constructor() {
    this.group = new THREE.Group(); // placed in the world; two-hand pinch moves it
    this.body = new THREE.Group(); // bobs gently inside it
    this.group.add(this.body);

    // shell
    const N = 64;
    const profile = [];
    for (let k = 0; k < N; k++) {
      const t = (1 - Math.cos((Math.PI * k) / (N - 1))) / 2;
      profile.push(new THREE.Vector2(Math.max(1e-4, radiusAt(t)), t * H - H / 2));
    }
    // Starting the lathe at π puts the front (+z) in the middle of the texture.
    const shellGeo = new THREE.LatheGeometry(profile, 96, Math.PI, Math.PI * 2);
    shellGeo.scale(1, 1, ZS);
    this.skin = document.createElement('canvas');
    this.skin.width = 2048;
    this.skin.height = 1024;
    this._paintSkin(profile);
    const skinTex = new THREE.CanvasTexture(this.skin);
    skinTex.colorSpace = THREE.SRGBColorSpace;
    skinTex.anisotropy = 8;
    const shell = new THREE.Mesh(
      shellGeo,
      new THREE.MeshPhysicalMaterial({ map: skinTex, roughness: 0.45, clearcoat: 0.8, clearcoatRoughness: 0.25 }),
    );
    this.body.add(shell);

    // keychain loop
    const metal = new THREE.MeshStandardMaterial({ color: 0xd8dce6, metalness: 0.9, roughness: 0.25 });
    const lug = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.008, 0.012, 16), new THREE.MeshPhysicalMaterial({ color: 0xff7f9a, roughness: 0.4, clearcoat: 0.8 }));
    lug.position.y = H / 2 + 0.002;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.017, 0.0032, 12, 40), metal);
    ring.position.y = H / 2 + 0.024;
    ring.rotation.y = 0.5;
    this.body.add(lug, ring);

    // screen, sunk into a dark bezel
    const bezelShape = roundedRect(BEZEL.w, BEZEL.h, 0.014);
    const bezelGeo = new THREE.ExtrudeGeometry(bezelShape, { depth: BEZEL.depth, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 3 });
    bezelGeo.translate(0, 0, -BEZEL.depth);
    const bezel = new THREE.Mesh(bezelGeo, new THREE.MeshPhysicalMaterial({ color: 0x3b2f52, roughness: 0.5, clearcoat: 0.5 }));
    bezel.position.set(0, SCREEN.y, BEZEL.front);
    this.body.add(bezel);
    this.lcd = new LCD();
    this.screen = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN.w, SCREEN.h), new THREE.MeshBasicMaterial({ map: this.lcd.texture, toneMapped: false }));
    this.screen.position.set(0, SCREEN.y, BEZEL.front + 0.0025);
    this.body.add(this.screen);

    // buttons
    const btnMat = new THREE.MeshPhysicalMaterial({ color: 0xffd45e, roughness: 0.35, clearcoat: 1 });
    const btnGeo = new THREE.CylinderGeometry(BTN_R, BTN_R, 0.014, 32);
    btnGeo.rotateX(Math.PI / 2);
    this.buttons = BUTTONS.map((b) => {
      const mesh = new THREE.Mesh(btnGeo, btnMat.clone());
      const z = surfaceZ(b.x, b.y);
      mesh.position.set(b.x, b.y, z);
      mesh.rotation.y = Math.asin(THREE.MathUtils.clamp(b.x / radiusAt(tOf(b.y)), -1, 1)) * 0.6;
      this.body.add(mesh);
      return { ...b, mesh, rest: z, front: z + 0.007, pressed: 0 };
    });

    this.time = 0;
  }

  // Pastel shell with speckles, a cream face plate and the button labels,
  // painted so they land in the right place once wrapped around the egg.
  _paintSkin(profile) {
    const g = this.skin.getContext('2d');
    const W = this.skin.width, CH = this.skin.height;
    const grad = g.createLinearGradient(0, 0, 0, CH);
    grad.addColorStop(0, '#ff9fb6');
    grad.addColorStop(1, '#ff7f9f');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, CH);
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = rand() < 0.7 ? 'rgba(255, 255, 255, 0.55)' : 'rgba(255, 226, 120, 0.7)';
      g.beginPath();
      g.ellipse(rand() * W, rand() * CH, 4 + rand() * 7, 4 + rand() * 7, 0, 0, Math.PI * 2);
      g.fill();
    }
    // (x, y) on the front of the egg → canvas pixel
    const ts = profile.map((p) => (p.y + H / 2) / H);
    const vOf = (y) => {
      const t = tOf(y);
      let k = 1;
      while (k < ts.length - 1 && ts[k] < t) k++;
      const f = (t - ts[k - 1]) / (ts[k] - ts[k - 1] || 1);
      return (k - 1 + f) / (ts.length - 1);
    };
    const uv = (x, y) => {
      const r = radiusAt(tOf(y));
      const u = 0.5 + Math.asin(THREE.MathUtils.clamp(x / r, -1, 1)) / (Math.PI * 2);
      return [u * W, (1 - vOf(y)) * CH];
    };
    // face plate
    g.fillStyle = '#fff3df';
    g.beginPath();
    for (let a = 0; a <= 64; a++) {
      const th = (a / 64) * Math.PI * 2;
      const [px, py] = uv(Math.cos(th) * 0.074, -0.004 + Math.sin(th) * 0.088);
      a ? g.lineTo(px, py) : g.moveTo(px, py);
    }
    g.fill();
    // button labels, drawn in millimeters around each spot
    for (const b of BUTTONS) {
      const y = b.y - 0.02;
      const [px, py] = uv(b.x, y);
      const [px2] = uv(b.x + 0.001, y);
      const [, py2] = uv(b.x, y + 0.001);
      g.save();
      g.translate(px, py);
      g.scale(px2 - px, py - py2); // 1 unit = 1 mm
      g.fillStyle = '#b0476a';
      g.font = '700 6.5px system-ui, -apple-system, "Segoe UI", sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(b.label, 0, 0);
      g.restore();
    }
    // brand line above the screen
    const [bx, by] = uv(0, SCREEN.y + 0.052);
    const [bx2] = uv(0.001, SCREEN.y + 0.052);
    const [, by2] = uv(0, SCREEN.y + 0.053);
    g.save();
    g.translate(bx, by);
    g.scale(bx2 - bx, by - by2);
    g.fillStyle = '#b0476a';
    g.font = 'italic 800 9px system-ui, -apple-system, "Segoe UI", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('pip', 0, 0);
    g.restore();
  }

  press(id) {
    const b = this.buttons.find((b) => b.id === id);
    if (b) b.pressed = 0.18;
  }

  // Point in the pet's local frame → button id, or 'screen', or null.
  // `depth`: how far in front of the surface still counts.
  hit(local, depth = 0.005) {
    for (const b of this.buttons) {
      if (Math.hypot(local.x - b.x, local.y - b.y) < BTN_R + 0.006 && local.z < b.front + depth && local.z > b.rest - 0.03) return b.id;
    }
    const s = this.screen.position;
    if (Math.abs(local.x) < BEZEL.w / 2 && Math.abs(local.y - s.y) < BEZEL.h / 2 && local.z < s.z + depth && local.z > s.z - 0.04) return 'screen';
    return null;
  }

  // Is the point near the egg at all (so a pinch there isn't a "tap anywhere")?
  near(local, margin = 0.05) {
    const r = radiusAt(tOf(local.y)) + margin;
    return Math.abs(local.y) < H / 2 + margin && Math.hypot(local.x, local.z / ZS) < r;
  }

  update(dt, face) {
    this.time += dt;
    this.body.position.y = Math.sin(this.time * 1.6) * 0.004;
    this.body.rotation.z = Math.sin(this.time * 0.9) * 0.03;
    for (const b of this.buttons) {
      b.pressed = Math.max(0, b.pressed - dt);
      b.mesh.position.z = b.rest - (b.pressed > 0 ? 0.004 : 0);
    }
    this.lcd.draw(face, this.time);
  }
}

function roundedRect(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
