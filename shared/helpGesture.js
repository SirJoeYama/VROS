import * as THREE from 'three';

const HOLD = 0.5; // seconds the pose must be held to toggle help
const PANEL_W = 0.46; // meters
const CW = 1024, PAD = 44, COLS = 2, ICON = 64;
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const EMOJI = '"Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", sans-serif';

// The gestures every app shares. An app's legend lists the ones it has in
// `data-common` (close and help are always there), and they're shown as a
// compact strip under the app's own gestures instead of repeating them.
export const COMMON = {
  view: ['🙌', 'Both palms up, pinch', 'move · zoom · turn the view'],
  reset: ['✊✊', 'Two fists, 1 s', 'back in front of you'],
  menu: ['🤲', 'Palm up, 1 s', 'panel to your hand'],
  panel: ['🤏', 'Panel handles', 'carry · resize · both: turn'],
  undo: ['✌️', 'Peace sign, 1 s', 'left: undo · right: redo'],
  close: ['👎', 'Right thumbs down', 'close the app'],
  help: ['✋', 'Palm to your eyes', 'show / hide this help'],
};

const _eye = new THREE.Vector3(), _toEye = new THREE.Vector3(), _up = new THREE.Vector3();
const _fwd = new THREE.Vector3(), _right = new THREE.Vector3();

// Help pose: an open hand held up near eye height, palm facing your eyes,
// fingers pointing up — like reading a note in your hand. It stays clear of
// palm-up (lower, palm to the sky) and of open-palm wind (palm facing away).
// `k`: your size in the world (1 unless the app zooms its view).
function inHelpPose(h, eye, k = 1) {
  if (h.kind !== 'hand' || !h.open) return false;
  _toEye.copy(eye).sub(h.palmCenter);
  const dist = _toEye.length() / k;
  if (dist < 0.15 || dist > 0.7) return false;
  if (h.palmCenter.y < eye.y - 0.25 * k) return false;
  _toEye.divideScalar(dist);
  const j = h.joints;
  _up.set(j[33] - j[0], j[34] - j[1], j[35] - j[2]).normalize(); // wrist → middle knuckle
  return h.palmNormal.dot(_toEye) > 0.6 && h.palmNormal.y < 0.6 && _up.y > 0.4;
}

// Face your open palm toward your eyes and hold to show the app's help card;
// do it again to hide it.
// The card: the app's name and what you're doing (its context), the app's
// own gestures as tiles (icon, gesture, what it does), then a strip with the
// gestures every app shares. Rows can be tied to a context (`when`), so an
// app with modes or steps shows only what applies right now; rows for the
// desktop only never show in XR.
// rows: [{ icon, key, text, when }] (or [key, text] pairs); common: keys of COMMON.
export class HelpGesture {
  constructor(title, rows, { sub = '', common = [] } = {}) {
    this.title = title;
    this.sub = sub;
    this.rows = rows.map((r) => (Array.isArray(r) ? { icon: '', key: r[0], text: r[1] } : r));
    this.common = [...new Set([...common, 'close', 'help'])].filter((c) => COMMON[c]);
    this.context = null;
    this.contextLabel = '';
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

  // Build from the page overlay: <h1> for the title, .sub for the line under
  // it, <dl class="legend"> for the rows (<dt data-icon data-when>), and its
  // data-common for the shared gestures. Also adds the shared gestures to the
  // page, as a second short list, so the page and the card always match.
  static fromPage() {
    const title = document.querySelector('h1')?.textContent.trim() || 'Help';
    const sub = document.querySelector('.sub')?.textContent.trim() || '';
    const dl = document.querySelector('.legend');
    const rows = [...(dl?.querySelectorAll('dt') || [])].map((dt) => ({
      icon: dt.dataset.icon || '',
      key: dt.textContent.trim(),
      text: dt.nextElementSibling?.textContent.trim() || '',
      when: dt.dataset.when ? dt.dataset.when.split(/\s+/) : null,
    }));
    const common = (dl?.dataset.common || '').split(/\s+/).filter(Boolean);
    const help = new HelpGesture(title, rows, { sub, common });
    if (dl) {
      const heading = document.createElement('p');
      heading.className = 'common-title';
      heading.textContent = 'Everywhere';
      const list = document.createElement('dl');
      list.className = 'legend common';
      for (const c of help.common) {
        const [icon, key, text] = COMMON[c];
        const dt = document.createElement('dt');
        dt.dataset.icon = icon;
        dt.textContent = key;
        const dd = document.createElement('dd');
        dd.textContent = text;
        list.append(dt, dd);
      }
      dl.after(heading, list);
    }
    return help;
  }

  // What you're doing now (an app's step or mode), so the card shows only the
  // rows for it. `label` is shown under the title.
  setContext(context, label = '') {
    if (context === this.context && label === this.contextLabel) return;
    this.context = context;
    this.contextLabel = label;
    if (this.open) this._render();
  }

  // A short tip when an XR session starts, so the gesture can be discovered.
  hint(viewer) {
    this._draw('Tip', '', [{ icon: '✋', key: 'Palm to your eyes', text: 'hold it for help with this app' }], []);
    this._place(viewer, null);
    this.hintTime = 5;
    this.open = false;
  }

  // Returns the hand currently making the help pose (or null) so apps can
  // ignore it for their own gestures.
  update(hands, dt, viewer) {
    viewer.getWorldPosition(_eye);
    this.k = viewer.getWorldScale(_up).x;
    const hand = hands.find((h) => inHelpPose(h, _eye, this.k)) || null;

    if (hand && this.armed) {
      this.hold += dt;
      if (this.hold >= HOLD) {
        this.armed = false;
        this.open = !this.open;
        this.hintTime = 0;
        if (this.open) {
          this._render();
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
    const k = viewer.getWorldScale(_up).x;
    this.panel.position.copy(_eye).addScaledVector(_fwd, 0.55 * k).addScaledVector(_right, -side * 0.18 * k);
    this.panel.position.y -= 0.04 * k;
    this.panel.lookAt(_eye);
    this.panel.scale.multiplyScalar(k / (this._k || 1));
    this._k = k;
  }

  // The rows for now: the ones tied to the current context, and the ones
  // tied to none (rows for the desktop never show here).
  visibleRows() {
    return this.rows.filter((r) => !r.when || (this.context != null && r.when.includes(String(this.context))));
  }

  _render() {
    this._draw(this.title, this.contextLabel || this.sub, this.visibleRows(), this.common);
  }

  _draw(title, sub, rows, common) {
    const g = this.ctx;
    const tileW = (CW - PAD * 2 - 24) / COLS, textW = tileW - ICON - 22;
    g.font = `300 25px ${FONT}`;
    const tiles = rows.map((r) => ({ ...r, lines: wrap(g, r.text, textW).slice(0, 2) }));
    const tileH = (t) => 40 + t.lines.length * 31;
    const rowHeights = [];
    for (let i = 0; i < tiles.length; i += COLS) rowHeights.push(Math.max(...tiles.slice(i, i + COLS).map(tileH), ICON) + 18);
    const HEAD = sub ? 132 : 104;
    const chipCols = 3, chipH = 74;
    const commonH = common.length ? 48 + Math.ceil(common.length / chipCols) * (chipH + 10) : 0;
    const h = HEAD + rowHeights.reduce((a, b) => a + b, 0) + (tiles.length ? 10 : 0) + commonH + PAD - 10;
    this.canvas.height = h;

    g.fillStyle = 'rgba(8, 10, 22, 0.94)';
    g.beginPath();
    g.roundRect(0, 0, CW, h, 36);
    g.fill();
    g.strokeStyle = 'rgba(159, 184, 255, 0.45)';
    g.lineWidth = 4;
    g.stroke();
    g.textBaseline = 'middle';
    g.textAlign = 'left';

    // header
    g.fillStyle = '#dfe6ff';
    g.font = `200 50px ${FONT}`;
    g.letterSpacing = '6px';
    g.fillText(title, PAD, 58);
    g.letterSpacing = '0px';
    if (sub) {
      g.fillStyle = '#8b93b3';
      g.font = `300 26px ${FONT}`;
      g.fillText(sub, PAD, 102);
    }

    // the app's gestures, as tiles
    let y = HEAD;
    tiles.forEach((t, i) => {
      const col = i % COLS, row = Math.floor(i / COLS);
      if (col === 0 && row > 0) y += rowHeights[row - 1];
      const x = PAD + col * (tileW + 24);
      this._icon(t.icon, x, y, ICON);
      g.textAlign = 'left';
      g.fillStyle = '#9fb8ff';
      g.font = `500 27px ${FONT}`;
      g.fillText(fit(g, t.key, textW), x + ICON + 20, y + 18);
      g.fillStyle = '#c3c9e2';
      g.font = `300 25px ${FONT}`;
      t.lines.forEach((line, k) => g.fillText(line, x + ICON + 20, y + 52 + k * 31));
    });
    if (tiles.length) y += rowHeights[rowHeights.length - 1] + 10;

    // what every app shares
    if (common.length) {
      g.strokeStyle = 'rgba(159, 184, 255, 0.18)';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(PAD, y + 6);
      g.lineTo(CW - PAD, y + 6);
      g.stroke();
      g.fillStyle = '#6f7795';
      g.font = `500 19px ${FONT}`;
      g.letterSpacing = '3px';
      g.fillText('EVERYWHERE', PAD, y + 30);
      g.letterSpacing = '0px';
      y += 48;
      const cw = (CW - PAD * 2 - (chipCols - 1) * 10) / chipCols;
      common.forEach((c, i) => {
        const [icon, key, text] = COMMON[c];
        const x = PAD + (i % chipCols) * (cw + 10), yy = y + Math.floor(i / chipCols) * (chipH + 10);
        g.fillStyle = 'rgba(159, 184, 255, 0.07)';
        g.beginPath();
        g.roundRect(x, yy, cw, chipH, 16);
        g.fill();
        g.font = `${glyphs(icon) > 1 ? 22 : 34}px ${EMOJI}`;
        g.textAlign = 'center';
        g.fillStyle = '#fff';
        g.fillText(icon, x + 34, yy + chipH / 2 + 2);
        g.textAlign = 'left';
        g.fillStyle = '#b9c0dc';
        g.font = `500 20px ${FONT}`;
        g.fillText(fit(g, key, cw - 80), x + 68, yy + 24);
        g.fillStyle = '#8b93b3';
        g.font = `300 19px ${FONT}`;
        g.fillText(fit(g, text, cw - 80), x + 68, yy + 51);
      });
    }

    // A texture can't change size once uploaded, so each redraw gets a new one.
    this.texture.dispose();
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.panel.material.map = this.texture;
    this.panel.material.needsUpdate = true;
    this.panel.scale.set(PANEL_W, (PANEL_W * h) / CW, 1);
    this._k = 1; // _place scales it to your size
  }

  _icon(icon, x, y, size) {
    const g = this.ctx;
    g.fillStyle = 'rgba(159, 184, 255, 0.12)';
    g.beginPath();
    g.roundRect(x, y, size, size, 18);
    g.fill();
    if (!icon) return;
    g.textAlign = 'center';
    g.fillStyle = '#fff';
    g.font = `${glyphs(icon) > 1 ? 26 : 36}px ${EMOJI}`;
    g.fillText(icon, x + size / 2, y + size / 2 + 2);
  }
}

// How many symbols an icon has (✊✊ is two), ignoring emoji style marks.
const glyphs = (icon) => [...icon.replace(/[︎️]/g, '')].length;

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

function fit(ctx, text, width) {
  if (ctx.measureText(text).width <= width) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > width) t = t.slice(0, -1);
  return t + '…';
}
