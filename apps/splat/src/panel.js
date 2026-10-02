import * as THREE from 'three';

const CW = 1024, CH = 700;
export const PANEL_W = 0.5, PANEL_H = (PANEL_W * CH) / CW;
const PAD = 26, GAP = 10, BTN_H = 62;
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

// The panel, poked with a fingertip: what's loaded and its status; the
// scenes to load; tools (move / measure, view history); orientation (flip,
// quarter turns, size); display (passthrough, spin). One canvas.
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
    if (s.progress != null) {
      g.fillStyle = 'rgba(159, 184, 255, 0.15)';
      rr(g, PAD, 100, CW - PAD * 2, 8, 4);
      g.fill();
      g.fillStyle = '#9fb8ff';
      rr(g, PAD, 100, (CW - PAD * 2) * s.progress, 8, 4);
      g.fill();
    }

    let y = 124;
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
