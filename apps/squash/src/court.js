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
// Its depth can change while you play (setDepth): the back wall stays put
// and the front wall moves. Built so that's cheap every frame:
// - `stretch`: the walls and everything running along the court, built one
//   metre deep from the back wall and scaled to the depth;
// - `front`: the front wall's lines, plus whatever rides on the wall (the
//   scoreboard and buttons), moved to the front wall;
// - the grid's cross lines stay 0.5 m apart; the ones beyond the front wall
//   aren't drawn.
export class Court {
  constructor(parent) {
    const W = CFG.COURT_W, H = CFG.COURT_H, HW = W / 2, B = CFG.BACK_Z;
    const lines = (group, pts, color) => {
      const g = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color }));
      group.add(l);
      return l;
    };

    this.stretch = new THREE.Group();
    this.stretch.position.z = B;
    parent.add(this.stretch);
    const geo = new THREE.BoxGeometry(W, H, 1).translate(0, H / 2, -0.5);
    this.materials = {
      wall: new THREE.MeshLambertMaterial({ color: COLORS.wall, side: THREE.BackSide }),
      floor: new THREE.MeshLambertMaterial({ color: COLORS.floor, side: THREE.BackSide }),
      front: new THREE.MeshLambertMaterial({ color: COLORS.front, side: THREE.BackSide }),
    };
    const { wall, floor, front } = this.materials;
    // face order: +x, -x, +y, -y, +z (back), -z (front)
    this.stretch.add(new THREE.Mesh(geo, [wall, wall, wall, floor, wall, front]));
    this.stretch.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: COLORS.edge })));
    const y = 0.002, fy = 0.004, sx = HW - 0.005, sz = -(1 - CFG.SHORT_LINE); // local z: 0 = back wall, -1 = front wall
    const along = [];
    for (let x = -HW; x <= HW + 1e-6; x += 0.5) along.push(x, y, -1, x, y, 0);
    lines(this.stretch, along, COLORS.grid);
    lines(this.stretch, [-sx, CFG.OUT_H, -1, -sx, CFG.OUT_BACK_H, 0, sx, CFG.OUT_H, -1, sx, CFG.OUT_BACK_H, 0], COLORS.line);
    lines(this.stretch, [-HW, fy, sz, HW, fy, sz, 0, fy, sz, 0, fy, 0], COLORS.floorLine);

    // grid lines across the floor, from the back wall forward
    const across = [];
    for (let d = 0; d <= CFG.DEPTH_START + 1e-6; d += 0.5) across.push(-HW, y, B - d, HW, y, B - d);
    this.across = lines(parent, across, COLORS.grid);

    this.front = new THREE.Group();
    parent.add(this.front);
    lines(this.front, [-HW, CFG.TIN_H, 0.005, HW, CFG.TIN_H, 0.005], COLORS.tin);
    lines(this.front, [-HW, CFG.SERVICE_H, 0.005, HW, CFG.SERVICE_H, 0.005, -HW, CFG.OUT_H, 0.005, HW, CFG.OUT_H, 0.005], COLORS.line);

    this.setDepth(CFG.DEPTH_START);
  }

  get frontZ() {
    return CFG.BACK_Z - this.depth;
  }

  setDepth(depth) {
    if (depth === this.depth) return;
    this.depth = depth;
    this.stretch.scale.z = depth;
    this.front.position.z = this.frontZ;
    this.across.geometry.setDrawRange(0, 2 * (Math.floor(depth / 0.5 + 1e-6) + 1));
  }

  // Mixed reality: the walls and floor turn almost see-through, so your room
  // shows behind the neon lines.
  setPassthrough(on) {
    for (const m of Object.values(this.materials)) {
      m.transparent = on;
      m.opacity = on ? CFG.MR_WALL_OPACITY : 1;
      m.depthWrite = !on;
      m.needsUpdate = true;
    }
  }
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
