import * as THREE from 'three';

const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _eye = new THREE.Vector3();

// Measuring: pinch to drop a point, pinch again for the second; the line
// between them shows its length. A third pinch starts a new measurement.
// Points are kept in the splat's own space (`space`), so they stay on it
// when you spin, turn or scale it. Lengths are measured in `ref` (the world
// group the view zooms), so zooming doesn't change them: they're meters at
// life size, real sizes once the splat is the right size.
export class Measure {
  constructor(space, ref) {
    this.space = space;
    this.ref = ref;
    this.points = []; // in `space`
    this.group = new THREE.Group();
    this.dots = [0, 1].map(() => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffd84a, depthTest: false, transparent: true }));
      m.renderOrder = 18;
      m.visible = false;
      this.group.add(m);
      return m;
    });
    this.line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0xffd84a, depthTest: false, transparent: true }));
    this.line.renderOrder = 18;
    this.line.frustumCulled = false;
    this.line.visible = false;
    this.group.add(this.line);
    this.canvas = document.createElement('canvas');
    this.canvas.width = 512;
    this.canvas.height = 128;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.label = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.texture, depthTest: false, transparent: true }));
    this.label.renderOrder = 19;
    this.label.visible = false;
    this.group.add(this.label);
    this._text = '';
  }

  // A point at `world`. Returns the length (m) once there are two points.
  add(world) {
    if (this.points.length >= 2) this.points = [];
    this.points.push(this.space.worldToLocal(world.clone()));
    return this.length;
  }

  clear() {
    this.points = [];
  }

  get length() {
    if (this.points.length < 2) return null;
    const a = this.ref.worldToLocal(this.space.localToWorld(_a.copy(this.points[0])));
    const b = this.ref.worldToLocal(this.space.localToWorld(_b.copy(this.points[1])));
    return a.distanceTo(b);
  }

  // `k`: your size in the world, so the dots and label look the same size at any zoom.
  update(viewer, k) {
    viewer.getWorldPosition(_eye);
    const pts = this.points.map((p) => this.space.localToWorld(p.clone()));
    this.dots.forEach((d, i) => {
      d.visible = !!pts[i];
      if (d.visible) {
        d.position.copy(pts[i]);
        d.scale.setScalar(0.006 * k);
      }
    });
    const two = pts.length === 2;
    this.line.visible = this.label.visible = two;
    if (!two) return;
    this.line.geometry.attributes.position.setXYZ(0, ...pts[0].toArray());
    this.line.geometry.attributes.position.setXYZ(1, ...pts[1].toArray());
    this.line.geometry.attributes.position.needsUpdate = true;
    const len = this.length;
    const text = len < 1 ? `${(len * 100).toFixed(1)} cm` : `${len.toFixed(2)} m`;
    if (text !== this._text) this._draw((this._text = text));
    this.label.position.copy(pts[0]).add(pts[1]).multiplyScalar(0.5);
    this.label.position.y += 0.03 * k;
    this.label.scale.set(0.16 * k, 0.04 * k, 1);
  }

  _draw(text) {
    const g = this.canvas.getContext('2d');
    g.clearRect(0, 0, 512, 128);
    g.fillStyle = 'rgba(10, 12, 24, 0.85)';
    g.beginPath();
    g.roundRect(8, 8, 496, 112, 56);
    g.fill();
    g.fillStyle = '#ffd84a';
    g.font = `500 64px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 256, 68);
    this.texture.needsUpdate = true;
  }
}
