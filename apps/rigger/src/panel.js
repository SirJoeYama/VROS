import * as THREE from 'three';

const CW = 1024, CH = 600;
export const PANEL_W = 0.52, PANEL_H = (PANEL_W * CH) / CW;
const PAD = 28, TAB_Y = 22, TAB_H = 56, STATUS_Y = 112, BODY_Y = 150, ROW_H = 60, ROW_GAP = 10, ROWS = 5;
const ACT_Y = 510, ACT_H = 66;
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const STRIP_H = 120, STRIP_CELLS = 8;
export const STEPS = [['model', '1 MODEL'], ['skeleton', '2 SKELETON'], ['fit', '3 FIT'], ['animate', '4 ANIMATE'], ['pose', '5 POSE']];

// The control desk: step tabs, a status line, a grid of items (models,
// skeletons, tools or clips; scrolls when there are more than fit), an
// optional film strip of frames above them, and a row of actions. Poked with a fingertip; everything is drawn to one canvas.
export class Panel {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = CW;
    this.canvas.height = CH;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(PANEL_W, PANEL_H), new THREE.MeshBasicMaterial({ map: this.texture, transparent: true }));
    this.mesh.renderOrder = 15;
    this.regions = [];
    this.state = { step: 'model', open: new Set(['model']), status: '', items: [], cols: 3, actions: [], strip: null };
    this.scroll = 0;
    this.flashId = null;
    this._key = '';
  }

  set(state) {
    if (state.items && state.items !== this.state.items && state.step !== this.state.step) this.scroll = 0;
    Object.assign(this.state, state);
    this.scrollBy(0);
  }

  get rows() {
    return this.state.strip ? ROWS - 2 : ROWS;
  }

  get maxScroll() {
    const s = this.state;
    return Math.max(0, Math.ceil(s.items.length / s.cols) - this.rows);
  }

  scrollBy(rows) {
    this.scroll = THREE.MathUtils.clamp(this.scroll + rows, 0, this.maxScroll);
  }

  flash(id) {
    this.flashId = id;
    clearTimeout(this._t);
    this._t = setTimeout(() => (this.flashId = null), 180);
  }

  draw() {
    const s = this.state;
    const key = JSON.stringify([s.step, [...s.open], s.status, s.cols, this.scroll, this.flashId,
      s.items.map((i) => [i.id, i.label, i.sub, i.on, i.off, i.check]), s.actions.map((a) => [a.id, a.label, a.on, a.off]), s.strip?.key]);
    if (key === this._key) return;
    this._key = key;
    const g = this.ctx;
    this.regions = [];
    g.clearRect(0, 0, CW, CH);
    g.fillStyle = 'rgba(10, 12, 24, 0.92)';
    rr(g, 0, 0, CW, CH, 30);
    g.fill();
    g.strokeStyle = 'rgba(159, 184, 255, 0.4)';
    g.lineWidth = 3;
    g.stroke();
    g.textBaseline = 'middle';

    // tabs
    const tw = (CW - PAD * 2 - (STEPS.length - 1) * 12) / STEPS.length;
    STEPS.forEach(([id, label], k) => {
      const x = PAD + k * (tw + 12), open = s.open.has(id), cur = s.step === id;
      this._button(`step:${id}`, x, TAB_Y, tw, TAB_H, label, { on: cur, off: !open, size: 22 });
    });

    g.textAlign = 'left';
    g.font = `300 26px ${FONT}`;
    g.fillStyle = '#b9c0dc';
    g.fillText(fit(g, s.status, CW - PAD * 2 - 90), PAD + 4, STATUS_Y);

    if (s.strip) this._strip(s.strip);
    const bodyY = s.strip ? BODY_Y + STRIP_H + ROW_GAP * 2 : BODY_Y, rows = this.rows;

    // items
    const cols = s.cols, cw = (CW - PAD * 2 - 60 - (cols - 1) * 12) / cols;
    const first = this.scroll * cols;
    s.items.slice(first, first + rows * cols).forEach((it, k) => {
      const x = PAD + (k % cols) * (cw + 12), y = bodyY + Math.floor(k / cols) * (ROW_H + ROW_GAP);
      const bw = it.check === undefined ? cw : cw - ROW_H - 8;
      this._button(it.id, x, y, bw, ROW_H, it.label, { on: it.on, off: it.off, sub: it.sub, align: 'left', size: 25 });
      if (it.check !== undefined) this._button(`check:${it.id}`, x + bw + 8, y, ROW_H, ROW_H, it.check ? '✓' : '', { on: it.check, size: 34 });
    });
    if (!s.items.length && s.empty) {
      g.textAlign = 'center';
      g.fillStyle = '#8b93b3';
      g.font = `300 26px ${FONT}`;
      g.fillText(s.empty, CW / 2, BODY_Y + 170);
    }

    // scroll bar with ▲ ▼
    const max = this.maxScroll;
    if (max > 0) {
      const x = CW - PAD - 48, h = rows * (ROW_H + ROW_GAP) - ROW_GAP;
      this._button('up', x, bodyY, 48, 56, '▲', { size: 22, off: this.scroll === 0 });
      this._button('down', x, bodyY + h - 56, 48, 56, '▼', { size: 22, off: this.scroll === max });
      const trackY = bodyY + 64, trackH = h - 128, thumbH = Math.max(24, (trackH * rows) / (rows + max));
      g.fillStyle = 'rgba(159, 184, 255, 0.12)';
      rr(g, x + 18, trackY, 12, trackH, 6);
      g.fill();
      g.fillStyle = '#9fb8ff';
      rr(g, x + 18, trackY + ((trackH - thumbH) * this.scroll) / max, 12, thumbH, 6);
      g.fill();
    }

    // actions
    const n = s.actions.length;
    if (n) {
      const aw = (CW - PAD * 2 - (n - 1) * 12) / n;
      s.actions.forEach((a, k) => this._button(a.id, PAD + k * (aw + 12), ACT_Y, aw, ACT_H, a.label, { on: a.on, off: a.off, size: 25, strong: a.strong }));
    }
    this.texture.needsUpdate = true;
  }

  // Film strip: `count` frames, `current` one outlined, `thumb(i)` gives its
  // stick figure as segments in [-0.5, 0.5] × [0, 1]. Centred on the current frame.
  _strip({ count, current, thumb }) {
    const g = this.ctx;
    const gap = 10, cw = (CW - PAD * 2 - (STRIP_CELLS - 1) * gap) / STRIP_CELLS, y = BODY_Y;
    const first = Math.max(0, Math.min(current - Math.floor(STRIP_CELLS / 2), count - STRIP_CELLS));
    for (let k = 0; k < STRIP_CELLS; k++) {
      const i = first + k, x = PAD + k * (cw + gap);
      if (i >= count) {
        g.strokeStyle = 'rgba(159, 184, 255, 0.15)';
        g.setLineDash([6, 6]);
        g.lineWidth = 2;
        g.strokeRect(x, y, cw, STRIP_H);
        g.setLineDash([]);
        continue;
      }
      const cur = i === current;
      g.fillStyle = cur ? '#f3ead2' : '#cfc8b4';
      g.fillRect(x, y, cw, STRIP_H);
      g.fillStyle = 'rgba(10, 12, 24, 0.9)';
      for (let sy = y + 8; sy < y + STRIP_H - 6; sy += 22) {
        g.fillRect(x + 4, sy, 6, 10);
        g.fillRect(x + cw - 10, sy, 6, 10);
      }
      const size = STRIP_H - 34, cx = x + cw / 2, base = y + STRIP_H - 8;
      g.strokeStyle = '#2b2418';
      g.lineWidth = 2.5;
      g.lineCap = 'round';
      g.beginPath();
      for (const [x1, y1, x2, y2] of thumb(i)) {
        g.moveTo(cx + x1 * size, base - y1 * size);
        g.lineTo(cx + x2 * size, base - y2 * size);
      }
      g.stroke();
      g.fillStyle = '#6b5f4a';
      g.font = `400 16px ${FONT}`;
      g.textAlign = 'center';
      g.fillText(String(i + 1), cx, y + 13);
      if (cur) {
        g.strokeStyle = '#7fe7ff';
        g.lineWidth = 5;
        g.strokeRect(x - 3, y - 3, cw + 6, STRIP_H + 6);
      }
      this.regions.push({ id: `frame:${i}`, x, y, w: cw, h: STRIP_H });
    }
  }

  _button(id, x, y, w, h, label, { on, off, sub, align = 'center', size = 26, strong } = {}) {
    const g = this.ctx;
    const flash = this.flashId === id;
    g.globalAlpha = off ? 0.35 : 1;
    g.fillStyle = flash ? 'rgba(159, 184, 255, 0.6)' : on ? 'rgba(127, 231, 255, 0.3)' : strong ? 'rgba(159, 184, 255, 0.26)' : 'rgba(159, 184, 255, 0.1)';
    rr(g, x, y, w, h, 16);
    g.fill();
    g.strokeStyle = on ? 'rgba(127, 231, 255, 0.9)' : 'rgba(159, 184, 255, 0.4)';
    g.lineWidth = on ? 3 : 2;
    g.stroke();
    g.fillStyle = '#dfe6ff';
    g.font = `${on || strong ? 500 : 400} ${size}px ${FONT}`;
    g.textAlign = align;
    const tx = align === 'left' ? x + 18 : x + w / 2;
    if (sub) {
      g.fillText(fit(g, label, w - 30), tx, y + h / 2 - 11);
      g.font = `300 18px ${FONT}`;
      g.fillStyle = '#8b93b3';
      g.fillText(fit(g, sub, w - 30), tx, y + h / 2 + 15);
    } else g.fillText(fit(g, label, w - 24), tx, y + h / 2 + 1);
    g.globalAlpha = 1;
    if (!off) this.regions.push({ id, x, y, w, h });
  }

  // `local`: a point in the panel's frame (meters). Returns a region id or null.
  hit(local) {
    const px = (local.x / PANEL_W + 0.5) * CW, py = (0.5 - local.y / PANEL_H) * CH;
    return this.regions.find((r) => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h)?.id ?? null;
  }
}

function rr(g, x, y, w, h, r) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

function fit(g, text, w) {
  if (g.measureText(text).width <= w) return text;
  let t = text;
  while (t.length > 1 && g.measureText(t + '…').width > w) t = t.slice(0, -1);
  return t + '…';
}
