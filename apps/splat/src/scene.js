import * as THREE from 'three';
import { SplatMesh } from '@sparkjsdev/spark';

// Sample splats from Spark's examples (served with open CORS).
const ASSETS = 'https://sparkjs.dev/assets/splats/';
export const SAMPLES = [
  { id: 'butterfly', name: 'Butterfly', url: ASSETS + 'butterfly.spz' },
  { id: 'penguin', name: 'Penguin', url: ASSETS + 'penguin.spz' },
  { id: 'cat', name: 'Cat', url: ASSETS + 'cat.spz' },
  { id: 'robot', name: 'Robot head', url: ASSETS + 'robot-head.spz' },
  { id: 'woobles', name: 'Woobles', url: ASSETS + 'woobles.spz' },
  { id: 'fireplace', name: 'Fireplace', url: ASSETS + 'fireplace.spz' },
  { id: 'valley', name: 'Valley', url: ASSETS + 'valley.spz' },
];
export const FORMATS = '.ply,.spz,.splat,.ksplat,.sog';

// Most splats are made in computer-vision axes (y down, z forward), so by
// default they're turned upside down (180° about x); FLIP undoes that.
const FLIPPED = new THREE.Quaternion(1, 0, 0, 0);
const OBJECT_SIZE = 4; // the splats (bar the outer 2 %) span less than this (its own units): an object to hold, not a place to stand in

// Where the splats really are. Bounding boxes are no use: a few stray
// splats far out (common in captured scenes) make them huge. So: the median
// position of a sample of splats, and their size leaving out the outer 2 %
// on each side.
function spread(splat) {
  const n = splat.packedSplats?.numSplats || 0;
  const step = Math.max(1, Math.floor(n / 20000));
  const xs = [], ys = [], zs = [];
  splat.packedSplats.forEachSplat((i, c) => {
    if (i % step) return;
    xs.push(c.x); ys.push(c.y); zs.push(c.z);
  });
  const sorted = [xs, ys, zs].map((a) => Float32Array.from(a).sort());
  const at = (a, f) => a[Math.min(a.length - 1, Math.floor(a.length * f))] ?? 0;
  const middle = new THREE.Vector3(...sorted.map((a) => at(a, 0.5)));
  const size = Math.max(...sorted.map((a) => at(a, 0.98) - at(a, 0.02)));
  return { middle, size };
}

// The splat sits in a `holder`. For objects the holder's origin is the
// splat's middle, so turning, flipping, spinning and scaling happen about
// it and the object never drifts off; for places it's the place's own
// origin, where you stand.
export class Scene {
  constructor(parent) {
    this.holder = new THREE.Group();
    parent.add(this.holder);
    this.splat = null;
    this.info = null; // { name, key, count, size, object }
    this.loading = null;
  }

  // `source`: a sample, or a File. Resolves when it's ready to show.
  async load(source, onProgress) {
    this.unload();
    const file = source instanceof File ? source : null;
    const opts = file
      ? { fileBytes: await file.arrayBuffer(), fileName: file.name }
      : { url: source.url };
    const splat = new SplatMesh({ ...opts, onProgress: (e) => e.total && onProgress?.(e.loaded / e.total) });
    this.splat = splat;
    this.loading = splat.initialized;
    await splat.initialized;
    if (this.splat !== splat) return null; // another load started meanwhile
    this.loading = null;
    const { middle, size } = spread(splat);
    const object = size < OBJECT_SIZE;
    // An object turns about its middle. A place keeps its own origin, which
    // is usually where the capture camera stood: you start inside it.
    if (object) splat.position.copy(middle).negate();
    this.holder.add(splat);
    const name = file ? file.name.replace(/\.[^.]+$/, '') : source.name;
    this.info = {
      name,
      key: file ? `file:${file.name}:${file.size}` : `url:${source.url}`,
      count: splat.packedSplats?.numSplats || 0,
      size,
      object,
    };
    return this.info;
  }

  unload() {
    if (this.splat) {
      this.splat.removeFromParent();
      this.splat.dispose();
    }
    this.splat = null;
    this.info = null;
  }

  // How it sits: orientation and scale (what FLIP / TURN / SIZE change).
  get pose() {
    return { q: this.holder.quaternion.toArray(), s: this.holder.scale.x };
  }

  set pose(p) {
    this.holder.quaternion.fromArray(p.q);
    this.holder.scale.setScalar(p.s);
    this.holder.updateMatrixWorld(true);
  }

  defaultPose() {
    // objects come out about 0.8 m big; places stay life size
    const s = this.info?.object ? 0.8 / Math.max(0.05, this.info.size) : 1;
    return { q: FLIPPED.toArray(), s };
  }

  flip() {
    this.holder.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI));
  }

  // A quarter turn about a world axis ('x', 'y' or 'z').
  turn(axis) {
    const v = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[axis];
    this.holder.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...v), Math.PI / 2));
  }

  // Turntable: spin about the vertical.
  spin(rad) {
    this.holder.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rad));
  }

  scaleBy(k) {
    this.holder.scale.multiplyScalar(k);
  }
}
