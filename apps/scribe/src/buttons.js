import * as THREE from 'three';

const R = 0.018, POKE = 0.024;

function drawIcon(ctx, kind, on) {
  const s = ctx.canvas.width;
  ctx.clearRect(0, 0, s, s);
  ctx.fillStyle = on ? 'rgba(255, 95, 110, 0.9)' : 'rgba(20, 24, 40, 0.85)';
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, s / 2 - 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(159, 184, 255, 0.8)';
  ctx.lineWidth = 4;
  ctx.stroke();

  ctx.strokeStyle = ctx.fillStyle = '#eef2ff';
  ctx.lineWidth = 9;
  ctx.lineCap = 'round';
  const c = s / 2;
  ctx.beginPath();
  if (kind === 'mic') {
    ctx.roundRect(c - 14, c - 38, 28, 50, 14);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(c, c - 2, 26, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.moveTo(c, c + 24);
    ctx.lineTo(c, c + 38);
    ctx.stroke();
  } else if (kind === 'undo') {
    ctx.arc(c + 4, c + 6, 26, 1.1 * Math.PI, 2.6 * Math.PI);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(c - 36, c - 16);
    ctx.lineTo(c - 22, c + 4);
    ctx.lineTo(c - 4, c - 12);
    ctx.stroke();
  } else if (kind === 'recenter') {
    ctx.arc(c, c, 22, 0, Math.PI * 2);
    ctx.moveTo(c, c - 40); ctx.lineTo(c, c - 26);
    ctx.moveTo(c, c + 26); ctx.lineTo(c, c + 40);
    ctx.moveTo(c - 40, c); ctx.lineTo(c - 26, c);
    ctx.moveTo(c + 26, c); ctx.lineTo(c + 40, c);
    ctx.stroke();
  }
}

// Round buttons that press when an index fingertip pokes them (or the mouse clicks).
export class Buttons {
  constructor(defs) {
    this.group = new THREE.Group();
    this.items = defs.map((d) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 128;
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      const mesh = new THREE.Mesh(new THREE.CircleGeometry(R, 32), new THREE.MeshBasicMaterial({ map: texture, transparent: true }));
      mesh.position.set(d.x, d.y, 0.004);
      this.group.add(mesh);
      const item = { ...d, canvas, texture, mesh, on: null, hover: 0, inside: false };
      return item;
    });
    this.cooldown = 0;
    this._p = new THREE.Vector3();
  }

  // `pokes`: world points of fingertips; `clicks`: world points where a mouse click started.
  update(dt, pokes, clicks) {
    this.cooldown -= dt;
    for (const it of this.items) {
      const on = !!it.isOn?.();
      if (on !== it.on) {
        it.on = on;
        drawIcon(it.canvas.getContext('2d'), it.kind, on);
        it.texture.needsUpdate = true;
      }
      const center = it.mesh.getWorldPosition(this._p);
      const inside = pokes.some((p) => p.distanceTo(center) < POKE);
      const clicked = clicks.some((p) => p.distanceTo(center) < R * 1.2);
      if (((inside && !it.inside) || clicked) && this.cooldown <= 0) {
        this.cooldown = 0.5;
        it.onPress();
      }
      it.inside = inside;
      it.hover += ((inside ? 1 : 0) - it.hover) * Math.min(1, dt * 12);
      it.mesh.scale.setScalar(1 + it.hover * 0.2);
    }
  }
}
