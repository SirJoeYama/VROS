import * as THREE from 'three';
import { CFG } from './config.js';

const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

// A button on the front wall, beside the scoreboard. Point a controller at it
// and pull the trigger (the shared laser Pointer), or click it on the
// desktop. `surface` is what Pointer.update() takes.
export class WallButton {
  constructor(parent, x, color, onPress) {
    const w = CFG.BUTTON_W, h = CFG.BUTTON_H;
    this.color = color;
    this.canvas = document.createElement('canvas');
    this.canvas.width = 512;
    this.canvas.height = Math.round((512 * h) / w);
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, toneMapped: false }),
    );
    this.mesh.position.set(x, (CFG.OUT_H + CFG.COURT_H) / 2, CFG.FRONT_Z + 0.02);
    parent.add(this.mesh);
    this.surface = { object: this.mesh, w, h, press: () => this.press() };
    this.onPress = onPress;
    this.label = '';
    this.flash = 0;
  }

  press() {
    this.flash = 1;
    this._draw();
    this.onPress();
  }

  setLabel(label) {
    if (label === this.label) return;
    this.label = label;
    this._draw();
  }

  // the press glow fades back to the normal look
  update(dt) {
    if (this.flash <= 0) return;
    this.flash = Math.max(0, this.flash - dt * 4);
    if (this.flash === 0) this._draw();
  }

  _draw() {
    const c = this.canvas.getContext('2d'), w = this.canvas.width, h = this.canvas.height;
    c.clearRect(0, 0, w, h);
    c.beginPath();
    c.roundRect(8, 8, w - 16, h - 16, 40);
    c.fillStyle = this.flash > 0 ? this.color : 'rgba(4,6,16,0.88)';
    c.fill();
    c.lineWidth = 8;
    c.strokeStyle = this.color;
    c.shadowColor = this.color;
    c.shadowBlur = 20;
    c.stroke();
    c.shadowBlur = 0;
    c.fillStyle = this.flash > 0 ? '#04050a' : '#ffffff';
    c.font = `800 ${Math.round(h * 0.42)}px ${FONT}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(this.label, w / 2, h / 2 + 4);
    this.tex.needsUpdate = true;
  }
}
