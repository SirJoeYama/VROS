import * as THREE from 'three';

const CW = 1024, CH = 560, TAIL = 50;
export const BUBBLE_W = 0.36, BUBBLE_H = (BUBBLE_W * CH) / CW;
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const PAD = 48, LINE = 44;

// A speech bubble above the pet: what you said (dim), the answer as it
// streams in, and a status line. Shows the newest lines when it overflows.
export class Bubble {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = CW;
    this.canvas.height = CH;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(BUBBLE_W, BUBBLE_H),
      new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false, toneMapped: false }),
    );
    this.heard = '';
    this.answer = '';
    this.status = '';
    this._key = null;
  }

  set({ heard = this.heard, answer = this.answer, status = this.status } = {}) {
    this.heard = heard;
    this.answer = answer;
    this.status = status;
  }

  draw() {
    const key = this.heard + '\u0000' + this.answer + '\u0000' + this.status;
    if (key === this._key) return;
    this._key = key;
    const g = this.ctx;
    g.clearRect(0, 0, CW, CH);
    const empty = !this.heard && !this.answer && !this.status;
    this.mesh.visible = !empty;
    if (empty) return;

    const bottom = CH - TAIL;
    g.textBaseline = 'top';
    g.textAlign = 'left';
    const lines = [];
    const width = CW - PAD * 2;
    if (this.heard) {
      g.font = `italic 400 32px ${FONT}`;
      for (const l of wrap(g, '“' + this.heard + '”', width)) lines.push({ text: l, font: `italic 400 32px ${FONT}`, color: '#9a7f8a' });
      if (this.answer) lines.push({ gap: 12 });
    }
    if (this.answer) {
      g.font = `500 36px ${FONT}`;
      for (const l of wrap(g, this.answer, width)) lines.push({ text: l, font: `500 36px ${FONT}`, color: '#3a2440' });
    }
    const statusH = this.status ? 46 : 0;
    const room = bottom - 34 - 28 - statusH - 6;
    // keep the newest lines
    let h = 0, first = lines.length;
    while (first > 0) {
      const lh = lines[first - 1].gap ?? LINE;
      if (h + lh > room) break;
      h += lh;
      first--;
    }
    // The bubble grows upward from the tail to fit its text.
    const top = Math.max(6, bottom - (34 + h + (h ? 22 : 0) + statusH + 12));
    g.fillStyle = 'rgba(255, 250, 242, 0.96)';
    g.strokeStyle = '#ff8fa8';
    g.lineWidth = 6;
    g.beginPath();
    g.roundRect(6, top, CW - 12, bottom - top, 44);
    g.moveTo(CW / 2 - 34, bottom);
    g.lineTo(CW / 2, CH - 6);
    g.lineTo(CW / 2 + 34, bottom);
    g.fill();
    g.stroke();
    // cover the stroke where the tail joins the bubble
    g.fillRect(CW / 2 - 31, bottom - 8, 62, 12);

    let y = top + 30;
    if (first > 0) {
      g.fillStyle = '#c9a9b6';
      g.font = `400 26px ${FONT}`;
      g.fillText('…', PAD, top + 4);
    }
    for (const l of lines.slice(first)) {
      if (l.gap) {
        y += l.gap;
        continue;
      }
      g.font = l.font;
      g.fillStyle = l.color;
      g.fillText(l.text, PAD, y);
      y += LINE;
    }
    if (this.status) {
      g.font = `500 28px ${FONT}`;
      g.fillStyle = '#d05d85';
      g.textAlign = 'center';
      g.fillText(this.status, CW / 2, bottom - 50);
    }
    this.texture.needsUpdate = true;
  }
}

function wrap(g, text, width) {
  const out = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      if (!word) continue;
      const test = line ? line + ' ' + word : word;
      if (g.measureText(test).width > width && line) {
        out.push(line);
        line = word;
      } else line = test;
    }
    if (line) out.push(line);
  }
  return out;
}
