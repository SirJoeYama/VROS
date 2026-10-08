import * as THREE from 'three';
import { CFG, COLORS } from './config.js';

// A soft radial glow, for impact flashes and the ball's halo.
export function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// The closed court: dark walls seen from inside, neon edges, a floor grid
// and the squash lines (tin, service and out lines, short line, half line).
export function buildCourt(parent) {
  const W = CFG.COURT_W, H = CFG.COURT_H, HW = W / 2;
  const D = CFG.BACK_Z - CFG.FRONT_Z, CZ = (CFG.BACK_Z + CFG.FRONT_Z) / 2;

  const geo = new THREE.BoxGeometry(W, H, D);
  const wall = new THREE.MeshLambertMaterial({ color: COLORS.wall, side: THREE.BackSide });
  const floor = new THREE.MeshLambertMaterial({ color: COLORS.floor, side: THREE.BackSide });
  const front = new THREE.MeshLambertMaterial({ color: COLORS.front, side: THREE.BackSide });
  // face order: +x, -x, +y, -y, +z (back), -z (front)
  const box = new THREE.Mesh(geo, [wall, wall, wall, floor, wall, front]);
  box.position.set(0, H / 2, CZ);
  parent.add(box);

  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: COLORS.edge }));
  edges.position.copy(box.position);
  parent.add(edges);

  const lines = (pts, color) => {
    const g = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    parent.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color })));
  };

  const grid = [], y = 0.002;
  for (let x = -HW; x <= HW + 1e-6; x += 0.5) grid.push(x, y, CFG.FRONT_Z, x, y, CFG.BACK_Z);
  for (let z = CFG.FRONT_Z; z <= CFG.BACK_Z + 1e-6; z += 0.5) grid.push(-HW, y, z, HW, y, z);
  lines(grid, COLORS.grid);

  const fz = CFG.FRONT_Z + 0.005;
  lines([-HW, CFG.TIN_H, fz, HW, CFG.TIN_H, fz], COLORS.tin);
  lines([-HW, CFG.SERVICE_H, fz, HW, CFG.SERVICE_H, fz, -HW, CFG.OUT_H, fz, HW, CFG.OUT_H, fz], COLORS.line);
  const sx = HW - 0.005;
  lines([-sx, CFG.OUT_H, CFG.FRONT_Z, -sx, 2.13, CFG.BACK_Z, sx, CFG.OUT_H, CFG.FRONT_Z, sx, 2.13, CFG.BACK_Z], COLORS.line);
  const shortZ = CFG.FRONT_Z + 5.44, fy = 0.004;
  lines([-HW, fy, shortZ, HW, fy, shortZ, 0, fy, shortZ, 0, fy, CFG.BACK_Z], COLORS.floorLine);
}

const Z_AXIS = new THREE.Vector3(0, 0, 1);

// A small pool of additive glows that flare where the ball lands and fade.
export class Flashes {
  constructor(parent, tex, count = 8) {
    this.items = [];
    this.next = 0;
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
      );
      m.visible = false;
      m.userData = { life: 0, size: 1 };
      parent.add(m);
      this.items.push(m);
    }
  }

  spawn(pos, normal, color, size) {
    const f = this.items[this.next];
    this.next = (this.next + 1) % this.items.length;
    f.position.copy(pos).addScaledVector(normal, 0.012);
    f.quaternion.setFromUnitVectors(Z_AXIS, normal);
    f.material.color.setHex(color);
    f.userData.life = 1;
    f.userData.size = size;
    f.visible = true;
  }

  update(dt) {
    for (const f of this.items) {
      if (!f.visible) continue;
      f.userData.life -= dt * 2.5;
      if (f.userData.life <= 0) {
        f.visible = false;
        continue;
      }
      const l = f.userData.life;
      f.material.opacity = l;
      f.scale.setScalar(f.userData.size * (1.4 - 0.6 * l));
    }
  }
}
