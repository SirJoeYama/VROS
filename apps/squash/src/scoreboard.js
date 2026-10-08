import * as THREE from 'three';
import { CFG } from './config.js';

const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

// The floating panel above the front wall's playing area: rally, lives,
// best and what to do next. Redrawn only when something changes.
export class Scoreboard {
  constructor(parent) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024;
    this.canvas.height = 512;
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 1.3),
      new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, toneMapped: false }),
    );
    this.mesh.position.set(0, CFG.OUT_H + 0.75, CFG.FRONT_Z + 0.05);
    parent.add(this.mesh);
    this.key = '';
  }

  // game: { state, rally, best, lives, message }; xr: in the headset (trigger
  // / pinch wording) or the desktop preview (click).
  draw(game, xr) {
    const { state, rally, best, lives } = game;
    let msg = game.message;
    if (state === 'serve') msg = xr ? 'PINCH OR TRIGGER TO SERVE' : 'CLICK TO SERVE';
    else if (state === 'over') msg = xr ? 'GAME OVER · PINCH TO RESTART' : 'GAME OVER · CLICK TO RESTART';
    const key = `${state}|${rally}|${best}|${lives}|${msg}`;
    if (key === this.key) return;
    this.key = key;

    const c = this.ctx, w = 1024, h = 512;
    c.clearRect(0, 0, w, h);
    roundRect(c, 10, 10, w - 20, h - 20, 36);
    c.fillStyle = 'rgba(4,6,16,0.88)';
    c.fill();
    c.lineWidth = 6;
    c.strokeStyle = '#00f6ff';
    c.shadowColor = '#00f6ff';
    c.shadowBlur = 24;
    c.stroke();
    c.shadowBlur = 0;
    c.textAlign = 'center';
    c.textBaseline = 'middle';

    c.font = `800 46px ${FONT}`;
    c.fillStyle = '#ff2bd6';
    c.fillText('C U B E   S Q U A S H', w / 2, 64);

    c.font = `600 34px ${FONT}`;
    c.fillStyle = '#7fdfff';
    c.fillText('RALLY', 220, 140);
    c.fillText('LIVES', 512, 140);
    c.fillText('BEST', 804, 140);

    c.font = `800 150px ${FONT}`;
    c.fillStyle = '#ffffff';
    c.shadowColor = '#00f6ff';
    c.shadowBlur = 18;
    c.fillText(String(rally), 220, 255);
    c.fillStyle = '#ffd0f6';
    c.shadowColor = '#ff2bd6';
    c.fillText(String(best), 804, 255);
    c.shadowBlur = 0;

    const sq = 52, gap = 22, total = CFG.LIVES * sq + (CFG.LIVES - 1) * gap;
    for (let i = 0; i < CFG.LIVES; i++) {
      const x = 512 - total / 2 + i * (sq + gap), y = 255 - sq / 2;
      c.lineWidth = 5;
      c.strokeStyle = '#00f6ff';
      if (i < lives) {
        c.fillStyle = '#00f6ff';
        c.shadowColor = '#00f6ff';
        c.shadowBlur = 16;
        c.fillRect(x, y, sq, sq);
        c.shadowBlur = 0;
      } else c.strokeRect(x, y, sq, sq);
    }

    c.font = `700 44px ${FONT}`;
    c.fillStyle = state === 'miss' || state === 'over' ? '#ff4d7a' : '#aaffff';
    c.fillText(msg || '', w / 2, 420);
    this.tex.needsUpdate = true;
  }
}
