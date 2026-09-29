import * as THREE from 'three';

const CW = 1024, CH = 800;
export const PANEL_W = 0.56, PANEL_H = (PANEL_W * CH) / CW;
const PAD = 26, GAP = 10;
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const CELLS = 10;

export const SWATCHES = [
  '#ffffff', '#b9bec9', '#5b606b', '#15161a', '#ff4d4d', '#ff9a3c', '#ffd84a', '#8be35a',
  '#2fc98f', '#3cc8ff', '#3f7bff', '#8b5cff', '#ff5ccf', '#b5652f', '#f2c8a0', '#7a3b2e',
];

// Everything on one canvas, poked with a fingertip:
//   tools and file · colour (saturation/value square, hue bar, swatches) and
//   size · layers · the active layer's frames · playback.
// Regions marked `drag` (the colour square, hue bar, size slider) keep
// following the fingertip while it's pressed in.
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

  // `s`: see main.js panelState().
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

    // ---- tools and file ----
    const row1 = [
      ['draw', 'DRAW', s.tool === 'draw'], ['erase', 'ERASE', s.tool === 'erase'], null,
      ['brush:ribbon', 'RIBBON', s.brush === 'ribbon'], ['brush:tube', 'TUBE', s.brush === 'tube'], ['brush:glow', 'GLOW', s.brush === 'glow'], null,
      ['undo', '↶ UNDO', false, !s.canUndo], ['redo', '↷ REDO', false, !s.canRedo],
    ];
    this._row(row1, PAD, 22, CW - PAD * 2, 64, 22);

    // ---- colour ----
    const Y = 108, SQ = 230;
    const hueColor = `hsl(${s.hsv[0] * 360}, 100%, 50%)`;
    g.fillStyle = hueColor;
    g.fillRect(PAD, Y, SQ, SQ);
    let gr = g.createLinearGradient(PAD, 0, PAD + SQ, 0);
    gr.addColorStop(0, '#fff');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(PAD, Y, SQ, SQ);
    gr = g.createLinearGradient(0, Y, 0, Y + SQ);
    gr.addColorStop(0, 'rgba(0,0,0,0)');
    gr.addColorStop(1, '#000');
    g.fillStyle = gr;
    g.fillRect(PAD, Y, SQ, SQ);
    ring(g, PAD + s.hsv[1] * SQ, Y + (1 - s.hsv[2]) * SQ, 11);
    this.regions.push({ id: 'sv', x: PAD, y: Y, w: SQ, h: SQ, drag: true });

    const HX = PAD + SQ + 16, HW = 44;
    gr = g.createLinearGradient(0, Y, 0, Y + SQ);
    for (let k = 0; k <= 6; k++) gr.addColorStop(k / 6, `hsl(${k * 60}, 100%, 50%)`);
    g.fillStyle = gr;
    rr(g, HX, Y, HW, SQ, 10);
    g.fill();
    g.strokeStyle = '#fff';
    g.lineWidth = 4;
    g.strokeRect(HX - 3, Y + s.hsv[0] * SQ - 4, HW + 6, 8);
    this.regions.push({ id: 'hue', x: HX - 8, y: Y, w: HW + 16, h: SQ, drag: true });

    // swatches
    const SX = HX + HW + 26, SW = (CW - PAD - SX - 7 * 8) / 8;
    SWATCHES.forEach((c, k) => {
      const x = SX + (k % 8) * (SW + 8), y = Y + Math.floor(k / 8) * (SW + 8);
      g.fillStyle = c;
      rr(g, x, y, SW, SW, 12);
      g.fill();
      const on = s.hex === c;
      g.strokeStyle = on ? '#7fe7ff' : 'rgba(159, 184, 255, 0.35)';
      g.lineWidth = on ? 5 : 2;
      g.stroke();
      this.regions.push({ id: `swatch:${k}`, x, y, w: SW, h: SW });
    });

    // current colour + size
    const CY = Y + 2 * (SW + 8) + 6, BH = Y + SQ - CY;
    g.fillStyle = s.hex;
    rr(g, SX, CY, BH, BH, 14);
    g.fill();
    g.strokeStyle = 'rgba(159, 184, 255, 0.5)';
    g.lineWidth = 2;
    g.stroke();
    const LX = SX + BH + 18, LW = CW - PAD - LX;
    g.fillStyle = '#8b93b3';
    g.font = `300 22px ${FONT}`;
    g.textAlign = 'left';
    g.fillText(`size ${s.sizeLabel}  ·  fist + twist`, LX, CY + 16);
    const BY = CY + 36, BHh = BH - 40;
    g.fillStyle = 'rgba(159, 184, 255, 0.12)';
    rr(g, LX, BY, LW, BHh, BHh / 2);
    g.fill();
    // a wedge from thin to thick, and the handle
    g.fillStyle = 'rgba(223, 230, 255, 0.35)';
    g.beginPath();
    g.moveTo(LX + 14, BY + BHh / 2);
    g.lineTo(LX + LW - 14, BY + 8);
    g.lineTo(LX + LW - 14, BY + BHh - 8);
    g.closePath();
    g.fill();
    const hx = LX + 14 + s.sizeT * (LW - 28);
    g.fillStyle = s.hex;
    g.beginPath();
    g.arc(hx, BY + BHh / 2, BHh / 2 - 4, 0, Math.PI * 2);
    g.fill();
    ring(g, hx, BY + BHh / 2, BHh / 2 - 4);
    this.regions.push({ id: 'size', x: LX, y: BY - 10, w: LW, h: BHh + 20, drag: true });

    // ---- layers ----
    const LY = Y + SQ + 26;
    label(g, 'LAYERS', PAD, LY + 12);
    const chipY = LY + 30, chipH = 66, n = s.layers.length;
    const chipW = (CW - PAD * 2 - 2 * (120 + GAP) - 5 * GAP) / 6;
    s.layers.forEach((l, k) => {
      const x = PAD + k * (chipW + GAP);
      this._button(`layer:${k}`, x, chipY, chipW - 52, chipH, l.name, { on: l.active, sub: l.frames > 1 ? `${l.frames} frames` : 'still', size: 26 });
      this._button(`eye:${k}`, x + chipW - 48, chipY, 48, chipH, l.visible ? '◉' : '○', { on: l.visible, size: 26 });
    });
    const bx = CW - PAD - 2 * 120 - GAP;
    this._button('addLayer', bx, chipY, 120, chipH, '+ LAYER', { off: n >= 6, size: 21 });
    this._button('delLayer', bx + 120 + GAP, chipY, 120, chipH, '− LAYER', { off: n < 2, size: 21 });

    // ---- frames of the active layer ----
    const FY = chipY + chipH + 26;
    label(g, `FRAMES · layer ${s.layers.find((l) => l.active)?.name}`, PAD, FY + 12);
    g.textAlign = 'right';
    g.fillStyle = '#8b93b3';
    g.fillText(s.status, CW - PAD, FY + 12);
    const cy = FY + 30, ch = 96, cw = (CW - PAD * 2 - (CELLS - 1) * GAP) / CELLS;
    const count = s.frames.length, cur = s.frame;
    const first = Math.max(0, Math.min(cur - Math.floor(CELLS / 2), count - CELLS));
    for (let k = 0; k < CELLS; k++) {
      const i = first + k, x = PAD + k * (cw + GAP);
      if (i >= count) {
        g.strokeStyle = 'rgba(159, 184, 255, 0.15)';
        g.setLineDash([6, 6]);
        g.lineWidth = 2;
        g.strokeRect(x, cy, cw, ch);
        g.setLineDash([]);
        continue;
      }
      const on = i === cur;
      g.fillStyle = on ? '#f3ead2' : '#cfc8b4';
      g.fillRect(x, cy, cw, ch);
      g.fillStyle = 'rgba(10, 12, 24, 0.9)';
      for (let sy = cy + 8; sy < cy + ch - 6; sy += 20) {
        g.fillRect(x + 4, sy, 6, 9);
        g.fillRect(x + cw - 10, sy, 6, 9);
      }
      g.fillStyle = '#4a4232';
      g.textAlign = 'center';
      g.font = `500 24px ${FONT}`;
      g.fillText(String(i + 1), x + cw / 2, cy + 34);
      // how much is drawn on it
      const k2 = Math.min(1, s.frames[i] / 40);
      g.fillStyle = s.frames[i] ? '#6b5f4a' : 'rgba(107, 95, 74, 0.3)';
      g.fillRect(x + 16, cy + ch - 24, Math.max(4, (cw - 32) * k2), 8);
      if (on) {
        g.strokeStyle = '#7fe7ff';
        g.lineWidth = 5;
        g.strokeRect(x - 3, cy - 3, cw + 6, ch + 6);
      }
      this.regions.push({ id: `frame:${i}`, x, y: cy, w: cw, h: ch });
    }

    // ---- playback ----
    const row3 = [
      ['prev', '◀ PREV'], ['play', s.playing ? '❚❚ PAUSE' : '▶ PLAY', s.playing, s.length < 2], ['next', 'NEXT ▶'], null,
      ['addFrame', '+ FRAME'], ['dupFrame', 'DUPLICATE'], ['delFrame', 'DELETE'], null,
      ['onion', 'ONION', s.onion], ['fps', `${s.fps} FPS`],
    ];
    this._row(row3, PAD, cy + ch + 22, CW - PAD * 2, 64, 21);

    // ---- file ----
    const row4 = [
      ['new', s.armedNew ? 'SURE? PRESS AGAIN' : 'NEW DRAWING', s.armedNew], ['recenter', 'RECENTER'], ['export', 'EXPORT GLB', false, false, true],
    ];
    this._row(row4, PAD, CH - 86, CW - PAD * 2, 60, 21);
    this.texture.needsUpdate = true;
  }

  // A row of buttons; `null` entries are small gaps.
  _row(items, x, y, w, h, size) {
    const gaps = items.filter((i) => !i).length, n = items.length - gaps;
    const bw = (w - gaps * 14 - (n - 1) * GAP) / n;
    for (const it of items) {
      if (!it) { x += 14; continue; }
      const [id, text, on, off, strong] = it;
      this._button(id, x, y, bw, h, text, { on, off, strong, size });
      x += bw + GAP;
    }
  }

  _button(id, x, y, w, h, text, { on, off, sub, size = 24, strong } = {}) {
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
    g.font = `${on || strong ? 500 : 400} ${size}px ${FONT}`;
    if (sub) {
      g.fillText(text, x + w / 2, y + h / 2 - 11);
      g.font = `300 16px ${FONT}`;
      g.fillStyle = '#8b93b3';
      g.fillText(sub, x + w / 2, y + h / 2 + 15);
    } else g.fillText(text, x + w / 2, y + h / 2 + 1);
    g.globalAlpha = 1;
    if (!off) this.regions.push({ id, x, y, w, h });
  }

  // `local`: a point in the panel's frame (meters). Returns { id, u, v, drag }
  // with u, v the position inside the region (0..1), or null.
  hit(local) {
    const px = (local.x / PANEL_W + 0.5) * CW, py = (0.5 - local.y / PANEL_H) * CH;
    const r = this.regions.find((r) => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h);
    if (!r) return null;
    return { id: r.id, drag: !!r.drag, u: clamp01((px - r.x) / r.w), v: clamp01((py - r.y) / r.h) };
  }
}

const clamp01 = (x) => Math.min(1, Math.max(0, x));

function rr(g, x, y, w, h, r) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

function ring(g, x, y, r) {
  g.lineWidth = 4;
  g.strokeStyle = '#fff';
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 2;
  g.strokeStyle = '#000';
  g.beginPath();
  g.arc(x, y, r + 3, 0, Math.PI * 2);
  g.stroke();
}

function label(g, text, x, y) {
  g.fillStyle = '#9fb8ff';
  g.font = `500 20px ${FONT}`;
  g.textAlign = 'left';
  g.fillText(text, x, y);
}
