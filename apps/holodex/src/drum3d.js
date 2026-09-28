import * as THREE from 'three';
import { hostOf, titleOf } from './tabs.js';

const CARD_W = 0.22, CARD_H = 0.13; // meters
const M_PER_CARD = 0.045; // swipe distance that flips one card
const LEAN = THREE.MathUtils.degToRad(12); // every card leans back a little, toward your eyes
const SWIPE_NEAR = 0.008, SWIPE_FAR = 0.07; // swipe band in front of the front card
const FONT = '"Courier New", Courier, monospace';

function hue(s) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

function drawCard(ctx, tab, slot) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const host = hostOf(tab.url);
  const h = hue(host || 'new');
  ctx.clearRect(0, 0, W, H);
  // index-card tab on top
  ctx.fillStyle = `hsl(${h} 45% 72%)`;
  ctx.beginPath();
  const tabX = 24 + slot * 100; // staggered so each card's tab peeks out
  ctx.roundRect(tabX, 0, 240, 60, [14, 14, 0, 0]);
  ctx.fill();
  ctx.fillStyle = '#2b2418';
  ctx.font = `bold 30px ${FONT}`;
  ctx.textBaseline = 'middle';
  ctx.fillText((host || 'new tab').slice(0, 13), tabX + 16, 32);
  // card body
  ctx.fillStyle = '#f3ead2';
  ctx.beginPath();
  ctx.roundRect(0, 50, W, H - 50, 16);
  ctx.fill();
  ctx.strokeStyle = 'rgba(190, 60, 60, 0.55)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(24, 118);
  ctx.lineTo(W - 24, 118);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(80, 110, 170, 0.18)';
  ctx.lineWidth = 2;
  for (let y = 170; y < H - 10; y += 48) {
    ctx.beginPath();
    ctx.moveTo(24, y);
    ctx.lineTo(W - 24, y);
    ctx.stroke();
  }
  // Rolodex slots at the bottom
  ctx.fillStyle = '#04050a';
  for (const x of [W / 2 - 70, W / 2 + 70]) {
    ctx.beginPath();
    ctx.ellipse(x, H - 18, 20, 10, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // badge + title + url
  ctx.fillStyle = `hsl(${h} 55% 45%)`;
  ctx.beginPath();
  ctx.arc(70, 88, 24, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = `bold 28px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText((host || '+')[0].toUpperCase(), 70, 90);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#2b2418';
  ctx.font = `bold 44px ${FONT}`;
  ctx.fillText(titleOf(tab).slice(0, 22), 110, 90);
  ctx.fillStyle = '#6b5f4a';
  ctx.font = `26px ${FONT}`;
  const url = tab.url || 'type an address in the 2D view';
  ctx.fillText(url.length > 40 ? url.slice(0, 39) + '…' : url, 30, 158);
}

// A 3D Rolodex of the open tabs. Cards hinge on the axle: the front card
// stands up, the ones behind fan backwards, flipped ones tip toward you and
// down. Swipe up or down in the air just in front of the front card to flip;
// poke it to open that tab. Controllers and
// the mouse pinch-drag to spin and pinch-release on the front card to open.
export class Drum3D {
  constructor(tabs, onPick) {
    this.tabs = tabs;
    this.onPick = onPick;
    this.group = new THREE.Group();
    this.cards = new Map(); // tab id → { mesh, ctx, texture, url }
    this.rot = tabs.activeIndex; // continuous index of the card at the front
    this.vel = 0;
    this.touch = new Map(); // hand id → { y, moved, t }
    this._local = new THREE.Vector3();
    this.slot = new THREE.Object3D();
    this.slot.rotation.x = -LEAN;

    // Axle and knobs, for the look.
    const metal = new THREE.MeshBasicMaterial({ color: 0x3a4466 });
    const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, CARD_W + 0.06, 12), metal);
    axle.rotation.z = Math.PI / 2;
    const knobGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.012, 32);
    const knobMat = new THREE.MeshBasicMaterial({ color: 0x9fb8ff, transparent: true, opacity: 0.7 });
    for (const x of [-1, 1]) {
      const knob = new THREE.Mesh(knobGeo, knobMat);
      knob.rotation.z = Math.PI / 2;
      knob.position.set(x * (CARD_W / 2 + 0.035), 0, 0);
      this.group.add(knob);
    }
    this.group.add(axle, this.slot);
    this.sync();
  }

  // `head`: eye position; `fwd`: horizontal unit vector the viewer faces.
  place(head, fwd) {
    const y = head.y - 0.3; // axle below eye level, so you look down onto the cards
    this.group.position.set(head.x + fwd.x * 0.42, y, head.z + fwd.z * 0.42);
    this.group.lookAt(head.x, y, head.z);
    this.group.updateMatrixWorld(true);
  }

  sync() {
    const alive = new Set();
    this.tabs.list.forEach((tab, i) => {
      alive.add(tab.id);
      let c = this.cards.get(tab.id);
      if (!c) {
        const canvas = document.createElement('canvas');
        canvas.width = 640;
        canvas.height = Math.round((640 * CARD_H) / CARD_W);
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 4;
        const mesh = new THREE.Mesh(
          new THREE.PlaneGeometry(CARD_W, CARD_H).translate(0, CARD_H / 2 + 0.008, 0), // hinge at the bottom edge
          new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide }),
        );
        c = { mesh, ctx: canvas.getContext('2d'), texture, key: null };
        this.cards.set(tab.id, c);
        this.group.add(mesh);
      }
      const key = tab.url + '|' + (i % 4);
      if (c.key !== key) {
        c.key = key;
        drawCard(c.ctx, tab, i % 4);
        c.texture.needsUpdate = true;
      }
    });
    for (const [id, c] of this.cards) {
      if (alive.has(id)) continue;
      this.group.remove(c.mesh);
      c.mesh.material.map.dispose();
      c.mesh.material.dispose();
      c.mesh.geometry.dispose();
      this.cards.delete(id);
    }
  }

  get frontIndex() {
    return Math.max(0, Math.min(this.tabs.list.length - 1, Math.round(this.rot)));
  }

  update(hands, dt) {
    const n = this.tabs.list.length;
    const local = this._local;
    let touching = false;

    // Positions are measured where the front card rests (the slot), not on the
    // card itself, which tips toward you while it flips: x across, y up from
    // the hinge, z out of the card face.
    this.slot.updateMatrixWorld();
    for (const h of hands) {
      const hand = h.kind === 'hand';
      this.slot.worldToLocal(local.copy(hand ? h.indexTip : h.pinchPoint));
      const y = local.y;
      const inX = Math.abs(local.x) < CARD_W / 2 + 0.03;
      const inY = local.y > -0.03 && local.y < CARD_H + 0.05;
      const onFront = inX && local.y > 0 && local.y < CARD_H + 0.01;
      let t = this.touch.get(h.id);

      // Hands swipe in a band just in front of the cards; controllers and the
      // mouse drag while pinching.
      const active = hand
        ? inX && inY && local.z > SWIPE_NEAR && local.z < SWIPE_FAR
        : h.pinch && (!!t || (inX && inY && Math.abs(local.z) < 0.08));
      if (active) {
        touching = true;
        if (!t) this.touch.set(h.id, (t = { y, moved: 0 }));
        const dy = y - t.y;
        t.y = y;
        t.moved = t.moved * Math.exp(-3 * dt) + Math.abs(dy); // recent motion only
        // Moving the finger down flips the front card toward you; the next
        // card comes up.
        const d = -dy / M_PER_CARD;
        this.rot += d;
        this.vel = this.vel * 0.6 + (d / Math.max(dt, 1e-3)) * 0.4;
      } else if (t) {
        // Poke: from the band straight into the front card, without swiping.
        const poked = hand && onFront && local.z <= SWIPE_NEAR && local.z > -0.04;
        // Controller / mouse: release on the front card without dragging.
        const clicked = !hand && !h.pinch && onFront;
        if ((poked || clicked) && t.moved < 0.012) this._pick();
        this.touch.delete(h.id);
      }
    }
    for (const id of [...this.touch.keys()]) if (!hands.some((h) => h.id === id)) this.touch.delete(id);

    if (!touching) {
      this.rot += this.vel * dt;
      this.vel *= Math.exp(-5 * dt);
      if (Math.abs(this.vel) < 1.5) this.rot += (this.frontIndex - this.rot) * Math.min(1, dt * 10);
    }
    this.rot = THREE.MathUtils.clamp(this.rot, -0.45, n - 0.55);

    this.tabs.list.forEach((tab, i) => {
      const c = this.cards.get(tab.id);
      if (!c) return;
      const d = i - this.rot;
      // Lean back (negative x rotation) behind the front card, tip forward once flipped.
      const back = d >= 0 ? Math.min(d * 0.19, 1.2) : d * 1.9;
      const vis = back > -1.5 && d < 7;
      c.mesh.visible = vis;
      if (!vis) return;
      c.mesh.rotation.set(-(LEAN + back), 0, 0);
      c.mesh.material.opacity = d > 0 ? 1 - Math.min(d, 6) * 0.1 : 1;
      c.mesh.renderOrder = d < 0 ? 2 : 1;
    });
  }

  _pick() {
    const tab = this.tabs.list[this.frontIndex];
    if (tab) this.onPick(tab);
  }
}
