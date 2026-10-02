import * as THREE from 'three';

const HOLD = 0.8; // seconds the thumbs down must be held
const DOWN = -0.7; // how straight down the thumb must point (y of its direction)
const RING_R = 0.06, SEGMENTS = 64;

const _t = new THREE.Vector3();

// Thumbs down: the right hand's fingers curled, thumb out and pointing at
// the floor.
export function isThumbsDown(h) {
  if (h.kind !== 'hand' || h.handedness !== 'right' || h.pinch || !h.thumbOut || h.curled < 3) return false;
  const j = h.joints;
  _t.set(j[12] - j[6], j[13] - j[7], j[14] - j[8]); // thumb: proximal joint → tip
  return _t.normalize().y < DOWN;
}

// Give a thumbs down with the right hand and hold it to close the app and go
// back to the home screen (or, on the home screen, to leave XR); with
// controllers, hold Y (left controller). A ring around the fist (or the
// controller) fills up while you hold.
// Brief tracking dropouts drain the hold slowly instead of resetting it.
export class CloseGesture {
  constructor(renderer, homeUrl = '../../') {
    this.renderer = renderer;
    this.homeUrl = homeUrl;
    this.hold = 0;
    this.closing = false;

    const pts = [];
    for (let i = 0; i <= SEGMENTS; i++) {
      const a = Math.PI / 2 - (i / SEGMENTS) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * RING_R, Math.sin(a) * RING_R, 0));
    }
    this.ring = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0xffd9a0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.ring.frustumCulled = false;
    this.ring.renderOrder = 20;
    this.ring.visible = false;
    this.group = this.ring;
    this._mid = new THREE.Vector3();
    this._eye = new THREE.Vector3();
  }

  update(hands, dt, viewer) {
    if (this.closing) return;
    const k = viewer.getWorldScale(this._eye).x; // your size in the world (zoomed views)
    const hand = hands.find(isThumbsDown) || hands.find((h) => h.kind === 'controller' && h.handedness === 'left' && h.btn.b);
    const pressed = !!hand;

    this.hold = pressed ? this.hold + dt : Math.max(0, this.hold - dt * 2);
    const p = Math.min(1, this.hold / HOLD);

    this.ring.visible = p > 0.05;
    if (this.ring.visible) {
      if (pressed) this._mid.copy(hand.palmCenter);
      this.ring.position.copy(this._mid);
      this.ring.lookAt(viewer.getWorldPosition(this._eye));
      this.ring.scale.setScalar(k);
      this.ring.geometry.setDrawRange(0, Math.max(2, Math.round(p * SEGMENTS) + 1));
      this.ring.material.opacity = 0.4 + 0.6 * p;
    }
    if (p >= 1) this.close();
  }

  // Navigate while the XR session is still running, so the home screen can
  // pick it up (WebXR navigation) and you stay in the headset. With no
  // homeUrl (on the home screen itself) this just leaves XR.
  close() {
    this.closing = true;
    this.ring.visible = false;
    if (this.homeUrl) {
      location.assign(this.homeUrl);
      return;
    }
    const session = this.renderer.xr.getSession();
    const reset = () => { this.closing = false; this.hold = 0; };
    if (session) session.end().then(reset, reset);
    else reset();
  }
}
