import * as THREE from 'three';

const HOLD = 0.7; // seconds the palms must stay together
const NEAR = 0.1; // max distance between palm centers (m)
const FACING = -0.6; // palm normals must point at each other (dot product)
const RING_R = 0.045, SEGMENTS = 64;

// Press both palms together (prayer pose) and hold to close the app and go
// back to the home screen (or, on the home screen, to leave XR). A ring
// between the hands fills up while you hold.
// Brief tracking dropouts (common when hands touch) drain the hold slowly
// instead of resetting it.
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
    const left = hands.find((h) => h.kind === 'hand' && h.handedness === 'left');
    const right = hands.find((h) => h.kind === 'hand' && h.handedness === 'right');
    const pressed =
      !!left && !!right && !left.fist && !right.fist &&
      left.palmCenter.distanceTo(right.palmCenter) < NEAR * k &&
      left.palmNormal.dot(right.palmNormal) < FACING;

    this.hold = pressed ? this.hold + dt : Math.max(0, this.hold - dt * 2);
    const p = Math.min(1, this.hold / HOLD);

    this.ring.visible = p > 0.05;
    if (this.ring.visible) {
      if (pressed) this._mid.copy(left.palmCenter).add(right.palmCenter).multiplyScalar(0.5);
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
