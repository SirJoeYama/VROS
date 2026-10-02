import * as THREE from 'three';

const MAX = 6; // how far the beam reaches (m, in the world)
const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _p = new THREE.Vector3(), _n = new THREE.Vector3();
const _plane = new THREE.Plane(), _ray = new THREE.Ray(), _local = new THREE.Vector3();
const raycaster = new THREE.Raycaster();

// The laser pointer for Quest controllers: a beam from each controller to
// whatever it points at, so panels, remotes, buttons and icons work from a
// distance with the trigger (hands keep poking them with a fingertip).
// Each frame the app passes the surfaces it can be pressed on:
//   { object, w, h, press, drag }   a flat rectangle, w × h (meters,
//       unscaled) in the object's own XY plane, facing its +Z (panels);
//       press(local) gets the point in the object's space, like a fingertip;
//   { meshes: [...], press, drag }  anything else, hit by raycasting those
//       meshes; press(aim) gets { point, object }.
// Pulling the trigger while pointing at a surface calls its press(); while
// the trigger stays held, drag() (if any) is called each frame with where
// the beam is now (sliders, colour squares). update() returns the ids of
// the controllers doing that, so the app leaves them out of its other
// gestures. Each controller's `aim` is set to { point, surface } (or null).
export class Pointer {
  constructor() {
    this.group = new THREE.Group();
    this.holding = new Map(); // controller id → the surface its trigger pressed
    this.was = new Map(); // controller id → trigger held last frame
    this.beams = {};
    for (const side of ['left', 'right']) {
      const beam = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]),
        new THREE.LineBasicMaterial({ color: 0x9fb8ff, transparent: true, opacity: 0.5, depthWrite: false }),
      );
      beam.frustumCulled = false;
      beam.renderOrder = 25;
      const dot = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true }));
      dot.renderOrder = 26;
      beam.visible = dot.visible = false;
      this.group.add(beam, dot);
      this.beams[side] = { beam, dot };
    }
  }

  // `k`: your size in the world, so the dot looks the same size at any zoom.
  update(hands, surfaces, k = 1) {
    const seen = new Set(), used = new Set();
    for (const h of hands) {
      if (h.kind !== 'controller') continue;
      seen.add(h.handedness);
      h.aim = this._hit(h, surfaces);
      const start = h.pinch && !this.was.get(h.id);
      this.was.set(h.id, h.pinch);
      if (start && h.aim) {
        this.holding.set(h.id, h.aim.surface);
        h.aim.surface.press?.(this._arg(h.aim));
      } else if (h.pinch && this.holding.has(h.id)) {
        const s = this.holding.get(h.id);
        if (h.aim?.surface === s) s.drag?.(this._arg(h.aim));
      }
      if (!h.pinch) this.holding.delete(h.id);
      if (this.holding.has(h.id)) used.add(h.id);
      const b = this.beams[h.handedness];
      if (!b) continue;
      const end = h.aim ? h.aim.point : _p.copy(h.rayOrigin).addScaledVector(h.rayDir, 0.35 * k);
      const pos = b.beam.geometry.attributes.position;
      pos.setXYZ(0, h.rayOrigin.x, h.rayOrigin.y, h.rayOrigin.z);
      pos.setXYZ(1, end.x, end.y, end.z);
      pos.needsUpdate = true;
      b.beam.visible = true;
      b.beam.material.opacity = h.aim ? 0.85 : 0.3;
      b.beam.material.color.setHex(h.aim && h.pinch ? 0x7fe7ff : 0x9fb8ff);
      b.dot.visible = !!h.aim;
      if (h.aim) {
        b.dot.position.copy(h.aim.point);
        b.dot.scale.setScalar((h.pinch ? 0.006 : 0.004) * k);
      }
    }
    for (const side of ['left', 'right']) if (!seen.has(side)) this.beams[side].beam.visible = this.beams[side].dot.visible = false;
    for (const h of hands) if (h.kind !== 'controller') h.aim = null;
    for (const id of [...this.holding.keys()]) if (!hands.some((h) => h.id === id)) this.holding.delete(id);
    return used;
  }

  // What press() / drag() get: the point in the panel's space, or the hit.
  _arg(aim) {
    const s = aim.surface;
    return s.object ? s.object.worldToLocal(aim.point.clone()) : aim;
  }

  _hit(h, surfaces) {
    _ray.set(_o.copy(h.rayOrigin), _d.copy(h.rayDir).normalize());
    let best = null, bestD = MAX;
    for (const s of surfaces) {
      if (!s) continue;
      if (s.object) {
        if (!s.object.visible) continue;
        s.object.updateMatrixWorld();
        _n.set(0, 0, 1).transformDirection(s.object.matrixWorld);
        _plane.setFromNormalAndCoplanarPoint(_n, s.object.getWorldPosition(_p));
        const hit = _ray.intersectPlane(_plane, new THREE.Vector3());
        if (!hit) continue;
        const d = hit.distanceTo(_o);
        if (d >= bestD) continue;
        s.object.worldToLocal(_local.copy(hit));
        if (Math.abs(_local.x) > s.w / 2 || Math.abs(_local.y) > s.h / 2) continue;
        best = { point: hit, surface: s };
        bestD = d;
      } else if (s.meshes) {
        raycaster.set(_o, _d);
        raycaster.far = bestD;
        const hit = raycaster.intersectObjects(s.meshes.filter((m) => m.visible), true)[0];
        if (hit && hit.distance < bestD) {
          best = { point: hit.point.clone(), surface: s, object: hit.object };
          bestD = hit.distance;
        }
      }
    }
    return best;
  }
}
