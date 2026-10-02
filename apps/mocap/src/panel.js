import * as THREE from 'three';

const CW = 1024, CH = 760;
export const PANEL_W = 0.5, PANEL_H = (PANEL_W * CH) / CW;
const PAD = 26, GAP = 10, BTN_H = 62;
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

// The panel, poked with a fingertip: the status, the take's timeline (in /
// out marks and the playhead; poke or drag it to scrub), and rows of
// buttons (capture, legs, takes, the take). One canvas.
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
    this.flashId = null;
    this._key = '';
  }

  flash(id) {
    this.flashId = id;
    clearTimeout(this._t);
    this._t = setTimeout(() => (this.flashId = null), 180);
  }

  // `s`: see main.js panelState(). Rows: [{ label, cols, items: [{ id, label, sub, on, off, strong }] }]
  draw(s) {
    const key = JSON.stringify(s) + this.flashId;
    if (key === this._key) return;
    this._key = key;
    const g = this.ctx;
    this.regions = [];
    g.clearRect(0, 0, CW, CH);
    g.fillStyle = 'rgba(10, 12, 24, 0.93)';
    rr(g, 0, 0, CW, CH, 30);
    g.fill();
    g.strokeStyle = 'rgba(159, 184, 255, 0.4)';
    g.lineWidth = 3;
    g.stroke();
    g.textBaseline = 'middle';

    g.textAlign = 'left';
    g.fillStyle = '#dfe6ff';
    g.font = `300 34px ${FONT}`;
    g.fillText(fit(g, s.title, CW - PAD * 2), PAD + 4, 44);
    g.fillStyle = '#8b93b3';
    g.font = `300 22px ${FONT}`;
    g.fillText(fit(g, s.status, CW - PAD * 2), PAD + 4, 82);
    if (s.timeline) this._timeline(s.timeline);
    else if (s.progress != null) {
      g.fillStyle = 'rgba(159, 184, 255, 0.15)';
      rr(g, PAD, 100, CW - PAD * 2, 8, 4);
      g.fill();
      g.fillStyle = '#9fb8ff';
      rr(g, PAD, 100, (CW - PAD * 2) * s.progress, 8, 4);
      g.fill();
    }

    let y = 150;
    for (const row of s.rows) {
      g.fillStyle = '#9fb8ff';
      g.font = `500 19px ${FONT}`;
      g.textAlign = 'left';
      g.fillText(row.label, PAD + 2, y + 12);
      y += 28;
      const cols = row.cols || row.items.length;
      const w = (CW - PAD * 2 - (cols - 1) * GAP) / cols;
      row.items.forEach((it, k) => {
        const x = PAD + (k % cols) * (w + GAP), yy = y + Math.floor(k / cols) * (BTN_H + GAP);
        this._button(it, x, yy, w, BTN_H);
      });
      y += Math.ceil(row.items.length / cols) * (BTN_H + GAP) + 10;
    }
    this.texture.needsUpdate = true;
  }

  // { t, in, out, len } in seconds: the take, its kept part, the playhead.
  _timeline({ t, in: a, out: b, len }) {
    const g = this.ctx, x = PAD, y = 100, w = CW - PAD * 2, h = 34;
    const X = (s) => x + (w * s) / Math.max(len, 1e-3);
    g.fillStyle = 'rgba(159, 184, 255, 0.1)';
    rr(g, x, y, w, h, 8);
    g.fill();
    g.fillStyle = 'rgba(127, 231, 255, 0.28)';
    rr(g, X(a), y, Math.max(2, X(b) - X(a)), h, 8);
    g.fill();
    g.fillStyle = '#7fe7ff';
    for (const s of [a, b]) g.fillRect(X(s) - 2, y - 4, 4, h + 8);
    g.fillStyle = '#ffffff';
    g.fillRect(X(t) - 1.5, y - 6, 3, h + 12);
    g.font = `300 16px ${FONT}`;
    g.fillStyle = '#8b93b3';
    g.textAlign = 'left';
    g.fillText(`${t.toFixed(1)} s`, Math.min(X(t) + 6, x + w - 50), y + h + 9);
    this.regions.push({ id: 'timeline', x, y: y - 8, w, h: h + 16, len });
  }

  _button({ id, label, sub, on, off, strong }, x, y, w, h) {
    const g = this.ctx;
    g.globalAlpha = off ? 0.35 : 1;
    g.fillStyle = this.flashId === id ? 'rgba(159, 184, 255, 0.6)' : on ? 'rgba(127, 231, 255, 0.3)' : strong ? 'rgba(159, 184, 255, 0.26)' : 'rgba(159, 184, 255, 0.1)';
    rr(g, x, y, w, h, 14);
    g.fill();
    g.strokeStyle = on ? 'rgba(127, 231, 255, 0.9)' : 'rgba(159, 184, 255, 0.4)';
    g.lineWidth = on ? 3 : 2;
    g.stroke();
    g.fillStyle = '#dfe6ff';
    g.textAlign = 'center';
    g.font = `${on || strong ? 500 : 400} 22px ${FONT}`;
    if (sub) {
      g.fillText(fit(g, label, w - 20), x + w / 2, y + h / 2 - 11);
      g.font = `300 16px ${FONT}`;
      g.fillStyle = '#8b93b3';
      g.fillText(fit(g, sub, w - 20), x + w / 2, y + h / 2 + 15);
    } else g.fillText(fit(g, label, w - 20), x + w / 2, y + h / 2 + 1);
    g.globalAlpha = 1;
    if (!off) this.regions.push({ id, x, y, w, h });
  }

  // `local`: a point in the panel's frame (meters). Returns a region id or
  // null; on the timeline, `timeline:<seconds>`.
  hit(local) {
    const px = (local.x / PANEL_W + 0.5) * CW, py = (0.5 - local.y / PANEL_H) * CH;
    const r = this.regions.find((r) => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h);
    if (!r) return null;
    return r.id === 'timeline' ? `timeline:${THREE.MathUtils.clamp((px - r.x) / r.w, 0, 1) * r.len}` : r.id;
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
