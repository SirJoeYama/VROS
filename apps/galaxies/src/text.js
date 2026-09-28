import * as THREE from 'three';

// A camera-facing text label drawn to a canvas. Redraws only when text changes.
export class TextSprite {
  constructor(width = 0.36) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024;
    this.canvas.height = 256;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.material = new THREE.SpriteMaterial({ map: this.texture, transparent: true, depthWrite: false, opacity: 0 });
    this.sprite = new THREE.Sprite(this.material);
    this.sprite.scale.set(width, width / 4, 1);
    this.sprite.renderOrder = 10;
    this.sprite.visible = false;
    this.opacity = 0;
    this.hold = 0;
    this._key = '';
  }

  set(title, sub = '') {
    const key = title + '\n' + sub;
    if (key === this._key) return;
    this._key = key;
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.shadowColor = 'rgba(160, 190, 255, 0.9)';
    ctx.shadowBlur = 24;
    ctx.letterSpacing = '18px';
    ctx.font = '200 96px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.fillText(title.toUpperCase(), canvas.width / 2, sub ? 105 : 128);
    if (sub) {
      ctx.globalAlpha = 0.7;
      ctx.shadowBlur = 12;
      ctx.letterSpacing = '6px';
      ctx.font = '300 40px system-ui, -apple-system, "Segoe UI", sans-serif';
      ctx.fillText(sub, canvas.width / 2, 195);
      ctx.globalAlpha = 1;
    }
    this.texture.needsUpdate = true;
  }

  flash(title, sub, hold = 2.5) {
    this.set(title, sub);
    this.hold = hold;
  }

  // Fade in while held (or while `forceVisible`), fade out after.
  tick(dt, forceVisible = false) {
    this.hold -= dt;
    const target = forceVisible || this.hold > 0 ? 1 : 0;
    this.opacity += (target - this.opacity) * Math.min(1, dt * 4);
    this.material.opacity = this.opacity;
    this.sprite.visible = this.opacity > 0.01;
  }
}
