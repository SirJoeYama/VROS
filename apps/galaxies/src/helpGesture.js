import * as THREE from 'three';

const HOLD = 0.5; // seconds the pose must be held to toggle help
const PANEL_W = 0.42; // meters
const CW = 1024, PAD = 56, LH = 42, GAP = 20, TITLE = 110;
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

const _eye = new THREE.Vector3(), _toEye = new THREE.Vector3(), _up = new THREE.Vector3();
const _fwd = new THREE.Vector3(), _right = new THREE.Vector3();

// Help pose: an open hand held up near eye height, palm facing your eyes,
// fingers pointing up — like reading a note in your hand. It stays clear of
// palm-up (lower, palm to the sky) and of open-palm wind (palm facing away).
function inHelpPose(h, eye) {
  if (h.kind !== 'hand' || !h.open) return false;
  _toEye.copy(eye).sub(h.palmCenter);
  const dist = _toEye.length();
  if (dist < 0.15 || dist > 0.7) return false;
  if (h.palmCenter.y < eye.y - 0.25) return false;
  _toEye.divideScalar(dist);
  const j = h.joints;
  _up.set(j[33] - j[0], j[34] - j[1], j[35] - j[2]).normalize(); // wrist → middle knuckle
  return h.palmNormal.dot(_toEye) > 0.6 && h.palmNormal.y < 0.6 && _up.y > 0.4;
}

// Face your open palm toward your eyes and hold to show the app's help card;
// do it again to hide it. The card lists the same gestures as the page's
// .legend, so each app keeps a single list.
export class HelpGesture {
  constructor(title, rows) {
    this.title = title;
    this.rows = rows;
    this.canvas = document.createElement('canvas');
    this.canvas.width = CW;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.panel = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthTest: false, depthWrite: false }),
    );
    this.panel.renderOrder = 30;
    this.panel.visible = false;
    this.group = this.panel;
    this.open = false;
    this.hold = 0;
    this.armed = true; // the pose must end before it can toggle again
    this.hintTime = 0;
  }

  // Build from the page overlay: <h1> for the title, <dl class="legend"> for rows.
  static fromPage() {
    const title = document.querySelector('h1')?.textContent.trim() || 'Help';
    const dts = document.querySelectorAll('.legend dt');
    const rows = [...dts].map((dt) => [dt.textContent.trim(), dt.nextElementSibling?.textContent.trim() || '']);
    return new HelpGesture(title, rows);
  }

  // A short tip when an XR session starts, so the gesture can be discovered.
  hint(viewer) {
    this._render('Tip', [['Palm toward your eyes', 'show or hide help (hold ½ s)']]);
    this._place(viewer, null);
    this.hintTime = 5;
    this.open = false;
  }

  // Returns the hand currently making the help pose (or null) so apps can
  // ignore it for their own gestures.
  update(hands, dt, viewer) {
    viewer.getWorldPosition(_eye);
    const hand = hands.find((h) => inHelpPose(h, _eye)) || null;

    if (hand && this.armed) {
      this.hold += dt;
      if (this.hold >= HOLD) {
        this.armed = false;
        this.open = !this.open;
        this.hintTime = 0;
        if (this.open) {
          this._render(this.title, this.rows);
          this._place(viewer, hand);
        }
      }
    } else if (!hand) {
      this.hold = 0;
      this.armed = true;
    }

    if (this.hintTime > 0) this.hintTime -= dt;
    this.panel.visible = this.open || this.hintTime > 0;
    return hand;
  }

  hide() {
    this.open = false;
    this.hintTime = 0;
    this.panel.visible = false;
  }

  // Half a meter ahead at eye level, shifted away from the raised hand so it
  // doesn't cover the card.
  _place(viewer, hand) {
    viewer.getWorldPosition(_eye);
    _fwd.set(0, 0, -1).applyQuaternion(viewer.getWorldQuaternion(new THREE.Quaternion()));
    _fwd.y = 0;
    if (_fwd.lengthSq() < 1e-4) _fwd.set(0, 0, -1);
    _fwd.normalize();
    _right.set(-_fwd.z, 0, _fwd.x);
    const side = hand ? Math.sign(_toEye.copy(hand.palmCenter).sub(_eye).dot(_right)) || 1 : 0;
    this.panel.position.copy(_eye).addScaledVector(_fwd, 0.55).addScaledVector(_right, -side * 0.16);
    this.panel.position.y -= 0.04;
    this.panel.lookAt(_eye);
  }

  _render(title, rows) {
    const ctx = this.ctx;
    ctx.font = `400 31px ${FONT}`;
    const keyW = Math.max(...rows.map(([k]) => ctx.measureText(k).width), 0) + 36;
    ctx.font = `300 31px ${FONT}`;
    const lines = rows.map(([k, v]) => [k, wrap(ctx, v, CW - PAD * 2 - keyW)]);
    const h = TITLE + lines.reduce((n, [, l]) => n + l.length * LH + GAP, 0) + PAD - GAP;
    this.canvas.height = h;

    ctx.fillStyle = 'rgba(8, 10, 22, 0.92)';
    ctx.beginPath();
    ctx.roundRect(0, 0, CW, h, 36);
    ctx.fill();
    ctx.strokeStyle = 'rgba(159, 184, 255, 0.45)';
    ctx.lineWidth = 4;
    ctx.stroke();

    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#dfe6ff';
    ctx.font = `200 54px ${FONT}`;
    ctx.fillText(title, PAD, TITLE / 2 + 8);

    let y = TITLE + LH / 2;
    for (const [k, l] of lines) {
      ctx.font = `400 31px ${FONT}`;
      ctx.fillStyle = '#9fb8ff';
      ctx.fillText(k, PAD, y);
      ctx.font = `300 31px ${FONT}`;
      ctx.fillStyle = '#b9c0dc';
      for (const line of l) {
        ctx.fillText(line, PAD + keyW, y);
        y += LH;
      }
      y += GAP;
    }

    // A texture can't change size once uploaded, so each redraw gets a new one.
    this.texture.dispose();
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.panel.material.map = this.texture;
    this.panel.material.needsUpdate = true;
    this.panel.scale.set(PANEL_W, (PANEL_W * h) / CW, 1);
  }
}

function wrap(ctx, text, width) {
  const out = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const next = line ? line + ' ' + word : word;
    if (line && ctx.measureText(next).width > width) {
      out.push(line);
      line = word;
    } else line = next;
  }
  out.push(line);
  return out;
}
