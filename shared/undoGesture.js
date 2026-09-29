import * as THREE from 'three';

const HOLD = 1; // seconds the peace sign must be held
const REPEAT = 0.6; // then it repeats this often while still held
const RING_R = 0.04, SEGMENTS = 64;
const COLORS = { undo: 0xffc36a, redo: 0x7fe7ff };
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _eye = new THREE.Vector3();

function joint(h, k, out) {
  return out.set(h.joints[k * 3], h.joints[k * 3 + 1], h.joints[k * 3 + 2]);
}

// How far a finger reaches out: fingertip-to-wrist over knuckle-to-wrist.
function reach(h, knuckle, tip) {
  joint(h, 0, _a);
  return joint(h, tip, _b).distanceTo(_a) / Math.max(1e-4, joint(h, knuckle, _c).distanceTo(_a));
}

// A peace sign: index and middle straight and apart, ring and pinky curled.
export function isPeace(h) {
  if (h.kind !== 'hand' || h.pinch || h.jointCount < 25) return false;
  if (reach(h, 6, 9) < 1.5 || reach(h, 11, 14) < 1.5) return false;
  if (reach(h, 16, 19) > 1.35 || reach(h, 21, 24) > 1.35) return false;
  // the two raised fingers spread into a V
  const d1 = joint(h, 9, _a).sub(joint(h, 6, _c)).normalize();
  const d2 = joint(h, 14, _b).sub(joint(h, 11, _c)).normalize();
  return d1.angleTo(d2) > 0.16 && joint(h, 9, _a).distanceTo(joint(h, 14, _b)) > 0.02;
}

// Undo and redo, the same in every app: hold a peace sign for a second, the
// left hand to undo, the right to redo; keep holding to step again. A ring
// fills around the hand while you hold, and a label says what happened.
// `undo()` / `redo()` do the work and return what to show ("Undo", "Undo:
// stroke", …), or nothing when there was nothing to undo.
export class UndoGesture {
  constructor({ undo, redo } = {}) {
    this.actions = { undo, redo };
    this.group = new THREE.Group();
    this.rings = {};
    for (const kind of ['undo', 'redo']) {
      const pts = [];
      for (let i = 0; i <= SEGMENTS; i++) {
        const a = Math.PI / 2 + (kind === 'undo' ? 1 : -1) * (i / SEGMENTS) * Math.PI * 2; // undo fills anticlockwise
        pts.push(new THREE.Vector3(Math.cos(a) * RING_R, Math.sin(a) * RING_R, 0));
      }
      const ring = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: COLORS[kind], transparent: true, depthTest: false, depthWrite: false }),
      );
      ring.renderOrder = 22;
      ring.visible = false;
      ring.frustumCulled = false;
      ring.add(this._icon(kind === 'undo' ? '↶' : '↷', COLORS[kind]));
      this.group.add(ring);
      this.rings[kind] = { ring, hold: 0, fired: 0, at: new THREE.Vector3() };
    }
    this.toast = this._toast();
    this.group.add(this.toast.sprite);
  }

  // Returns the hands making the sign, so apps can leave them out of their
  // own gestures if they want to.
  update(hands, dt, viewer) {
    viewer.getWorldPosition(_eye);
    const making = [];
    for (const kind of ['undo', 'redo']) {
      const side = kind === 'undo' ? 'left' : 'right';
      const h = hands.find((x) => x.handedness === side && isPeace(x));
      const r = this.rings[kind];
      if (h) {
        making.push(h);
        // the ring sits around the V, between the two raised fingers
        joint(h, 7, r.at).add(joint(h, 12, _a)).multiplyScalar(0.5);
        r.hold += dt;
        if (r.hold >= HOLD + r.fired * REPEAT) {
          r.fired++;
          this._fire(kind, r.at);
        }
      } else {
        // brief tracking dropouts drain the hold instead of resetting it
        r.hold = Math.max(0, r.hold - dt * 3);
        if (r.hold === 0) r.fired = 0;
      }
      const p = r.fired ? 1 : Math.min(1, r.hold / HOLD);
      r.ring.visible = p > 0.05 && !!h;
      if (r.ring.visible) {
        r.ring.position.copy(r.at);
        r.ring.lookAt(_eye);
        r.ring.geometry.setDrawRange(0, Math.max(2, Math.round(p * SEGMENTS) + 1));
        r.ring.material.opacity = 0.35 + 0.65 * p;
      }
    }
    const t = this.toast;
    t.life -= dt;
    t.sprite.visible = t.life > 0;
    if (t.sprite.visible) {
      t.sprite.material.opacity = Math.min(1, t.life * 3);
      t.sprite.position.y += dt * 0.03; // drifts up as it fades
    }
    return making;
  }

  _fire(kind, at) {
    const label = this.actions[kind]?.();
    const text = label || (kind === 'undo' ? 'Nothing to undo' : 'Nothing to redo');
    this._showToast(`${kind === 'undo' ? '↶' : '↷'}  ${text}`, label ? COLORS[kind] : 0x8b93b3);
    this.toast.sprite.position.copy(at).add(_a.set(0, 0.07, 0));
  }

  _icon(char, color) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = '#' + new THREE.Color(color).getHexString();
    g.font = `500 96px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(char, 64, 70);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    s.scale.setScalar(RING_R * 1.1);
    s.renderOrder = 23;
    return s;
  }

  _toast() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 96;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    sprite.scale.set(0.2, 0.0375, 1);
    sprite.renderOrder = 24;
    sprite.visible = false;
    return { canvas, tex, sprite, life: 0 };
  }

  _showToast(text, color) {
    const { canvas, tex } = this.toast;
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = 'rgba(10, 12, 24, 0.85)';
    g.beginPath();
    g.roundRect(4, 4, canvas.width - 8, canvas.height - 8, 40);
    g.fill();
    g.fillStyle = '#' + new THREE.Color(color).getHexString();
    g.font = `400 40px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, canvas.width / 2, canvas.height / 2 + 2);
    tex.needsUpdate = true;
    this.toast.life = 1.2;
  }
}
