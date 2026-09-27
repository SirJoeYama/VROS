import * as THREE from 'three';
import { TextSprite } from './text.js';

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const SPACING = 0.045, LIFT = 0.07, POKE = 0.025;

// Turn a palm up to summon the app dock above it; poke an orb with the other
// hand's index finger to launch that app.
export class Launcher {
  constructor(apps, onSelect) {
    this.apps = apps;
    this.onSelect = onSelect;
    this.group = new THREE.Group();
    this.group.visible = false;
    this.vis = 0;
    this.cooldown = 0;
    this.lastHover = -1;
    this.anchor = new THREE.Vector3();
    this.normal = new THREE.Vector3(0, 1, 0);
    this.lateral = new THREE.Vector3(1, 0, 0);

    const tex = glowTexture();
    const sphere = new THREE.SphereGeometry(1, 20, 14);
    this.orbs = apps.map((app) => {
      const color = new THREE.Color(...app.colorA).lerp(new THREE.Color(...app.colorB), 0.35);
      const core = new THREE.Mesh(sphere, new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      this.group.add(core, halo);
      return { core, halo, hover: 0 };
    });

    this.label = new TextSprite(0.2);
    this.group.add(this.label.sprite);
  }

  update(hands, dt, t, current, viewerRight) {
    this.cooldown -= dt;
    const menuHand =
      hands.find((h) => h.kind === 'hand' && h.palmUp && h.handedness === 'left') ||
      hands.find((h) => h.kind === 'hand' && h.palmUp);

    if (menuHand) {
      this.normal.copy(menuHand.palmNormal);
      this.anchor.copy(menuHand.palmCenter).addScaledVector(this.normal, LIFT);
      this.lateral.copy(menuHand.lateral);
      if (this.lateral.dot(viewerRight) < 0) this.lateral.negate();
    }
    this.vis += ((menuHand ? 1 : 0) - this.vis) * Math.min(1, dt * 8);
    this.group.visible = this.vis > 0.01;
    if (!this.group.visible) {
      this.label.tick(dt, false);
      return null;
    }

    const poker = menuHand && hands.find((h) => h !== menuHand && h.kind === 'hand');
    const n = this.orbs.length;
    let hovered = -1;
    this.orbs.forEach((orb, k) => {
      const pos = orb.core.position
        .copy(this.anchor)
        .addScaledVector(this.lateral, (k - (n - 1) / 2) * SPACING)
        .addScaledVector(this.normal, 0.008 * Math.sin(t * 2 + k));
      orb.halo.position.copy(pos);
      const isHover = !!poker && poker.indexTip.distanceTo(pos) < POKE;
      if (isHover) hovered = k;
      orb.hover += ((isHover ? 1 : 0) - orb.hover) * Math.min(1, dt * 12);
      const s = this.vis * (k === current ? 1.3 : 1) * (1 + orb.hover * 0.5);
      orb.core.scale.setScalar(0.009 * s);
      orb.halo.scale.setScalar(0.05 * s);
      orb.halo.material.opacity = 0.6 + 0.4 * orb.hover;
    });

    // Launch on entering an orb, not while resting inside it.
    if (hovered >= 0 && hovered !== this.lastHover && this.cooldown <= 0 && this.vis > 0.8) {
      this.cooldown = 0.6;
      this.onSelect(hovered);
    }
    this.lastHover = hovered;

    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const shown = this.apps[hovered >= 0 ? hovered : current];
    this.label.set(time, shown.name.toLowerCase() + (hovered >= 0 ? '  ·  touch to open' : ''));
    this.label.sprite.position.copy(this.anchor).addScaledVector(this.normal, 0.05);
    this.label.tick(dt, true);
    this.label.material.opacity *= this.vis;
    return menuHand;
  }
}
