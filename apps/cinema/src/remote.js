import * as THREE from 'three';
import { formatTime } from './player.js';

const CW = 1024, CH = 250;
export const REMOTE_W = 0.38, REMOTE_H = (REMOTE_W * CH) / CW;
const BAR = { x: 40, y: 92, w: CW - 80, h: 26 };
const BTN_Y = 150, BTN_H = 80;
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

// A small remote that floats near your hands: title and time, a progress
// bar you can poke to seek, and prev / −10 s / play / +10 s / next buttons.
export class Remote {
  constructor(player) {
    this.player = player;
    this.canvas = document.createElement('canvas');
    this.canvas.width = CW;
    this.canvas.height = CH;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(REMOTE_W, REMOTE_H), new THREE.MeshBasicMaterial({ map: this.texture, transparent: true }));
    this.regions = [];
    this.pressed = null;
    this._key = '';
  }

  draw() {
    const p = this.player;
    const key = [p.index, p.playing, p.pendingPlay, Math.floor(p.time), Math.floor(p.duration), p.error, this.pressed?.id].join('|');
    if (key === this._key) return;
    this._key = key;
    const g = this.ctx;
    g.clearRect(0, 0, CW, CH);
    g.fillStyle = 'rgba(10, 12, 24, 0.9)';
    g.beginPath();
    g.roundRect(0, 0, CW, CH, 28);
    g.fill();
    g.strokeStyle = 'rgba(159, 184, 255, 0.4)';
    g.lineWidth = 3;
    g.stroke();

    g.textBaseline = 'middle';
    g.font = `400 30px ${FONT}`;
    g.fillStyle = '#dfe6ff';
    g.textAlign = 'left';
    const title = p.error || p.item?.name || 'no media: open a file in window mode';
    g.fillText(title.length > 44 ? title.slice(0, 43) + '…' : title, 40, 46);
    g.textAlign = 'right';
    g.fillStyle = '#8b93b3';
    g.fillText(`${formatTime(p.time)} / ${formatTime(p.duration)}`, CW - 40, 46);

    g.fillStyle = 'rgba(159, 184, 255, 0.18)';
    g.beginPath();
    g.roundRect(BAR.x, BAR.y, BAR.w, BAR.h, 13);
    g.fill();
    const f = p.duration ? p.time / p.duration : 0;
    g.fillStyle = '#9fb8ff';
    g.beginPath();
    g.roundRect(BAR.x, BAR.y, Math.max(BAR.h, BAR.w * f), BAR.h, 13);
    g.fill();

    this.regions = [{ id: 'seek', ...BAR, y: BAR.y - 14, h: BAR.h + 28 }];
    const btns = [
      ['prev', '⏮  PREV'],
      ['back', '−10 s'],
      ['play', p.playing || p.pendingPlay ? '❚❚  PAUSE' : '▶  PLAY'],
      ['fwd', '+10 s'],
      ['next', 'NEXT  ⏭'],
    ];
    const bw = (CW - 80 - (btns.length - 1) * 14) / btns.length;
    btns.forEach(([id, label], k) => {
      const x = 40 + k * (bw + 14);
      g.fillStyle = this.pressed?.id === id ? 'rgba(159, 184, 255, 0.55)' : id === 'play' ? 'rgba(159, 184, 255, 0.28)' : 'rgba(159, 184, 255, 0.1)';
      g.beginPath();
      g.roundRect(x, BTN_Y, bw, BTN_H, 18);
      g.fill();
      g.strokeStyle = 'rgba(159, 184, 255, 0.45)';
      g.lineWidth = 2;
      g.stroke();
      g.fillStyle = '#dfe6ff';
      g.font = `500 28px ${FONT}`;
      g.textAlign = 'center';
      g.fillText(label, x + bw / 2, BTN_Y + BTN_H / 2);
      this.regions.push({ id, x, y: BTN_Y, w: bw, h: BTN_H });
    });
    this.texture.needsUpdate = true;
  }

  // `local`: a point in the remote's frame (meters). Returns { id, fraction }.
  hit(local) {
    const px = (local.x / REMOTE_W + 0.5) * CW, py = (0.5 - local.y / REMOTE_H) * CH;
    const r = this.regions.find((r) => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h);
    return r ? { id: r.id, fraction: (px - BAR.x) / BAR.w } : null;
  }

  press(hit) {
    const p = this.player;
    ({
      seek: () => p.seekTo(hit.fraction),
      prev: () => p.prev(),
      back: () => p.seekBy(-10),
      play: () => p.toggle(),
      fwd: () => p.seekBy(10),
      next: () => p.next(),
    })[hit.id]?.();
    this.pressed = hit;
    clearTimeout(this._t);
    this._t = setTimeout(() => (this.pressed = null), 180);
  }
}
