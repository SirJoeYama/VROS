import * as THREE from 'three';
import { SplatMesh } from '@sparkjsdev/spark';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

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
// Meshes too: photogrammetry scans (.glb, or a .gltf with everything
// embedded), often Draco or meshopt compressed to keep them small enough
// for the headset.
const MESH = /\.(glb|gltf)$/i;
// Sample scans: CC0 photogrammetry by ffish.asia / floraZia.com on
// Sketchfab, meshopt-compressed (and their textures made WebP) with
// glTF-Transform so each is a few MB. Served from this repo.
export const SCANS = [
  { id: 'tree-frog', name: 'Tree frog', url: 'models/tree-frog.glb' },
  { id: 'rhinoceros-beetle', name: 'Rhino beetle', url: 'models/rhinoceros-beetle.glb' },
  { id: 'freshwater-crab', name: 'Freshwater crab', url: 'models/freshwater-crab.glb' },
  { id: 'bumblebee', name: 'Bumblebee', url: 'models/bumblebee.glb' },
  { id: 'swallowtail', name: 'Swallowtail', url: 'models/swallowtail.glb' },
];
export const FORMATS = '.ply,.spz,.splat,.ksplat,.sog,.glb,.gltf';
const isMesh = (name) => MESH.test(name.split('?')[0]);

const draco = new DRACOLoader().setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/libs/draco/gltf/');
const gltfLoader = new GLTFLoader().setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder);

// Most splats are made in computer-vision axes (y down, z forward), so by
// default they're turned upside down (180° about x); FLIP undoes that.
// Meshes (glTF) are y up already.
const FLIPPED = new THREE.Quaternion(1, 0, 0, 0);
const UPRIGHT = new THREE.Quaternion();
const OBJECT_SIZE = 4; // the splats (bar the outer 2 %) span less than this (its own units): an object to hold, not a place to stand in

// Where the splats really are. Bounding boxes are no use: a few stray
// splats far out (common in captured scenes) make them huge. So: the median
// position of a sample of splats, and their size leaving out the outer 2 %
// on each side.
// A mesh is measured the same way, from a sample of its vertices.
function spread(splat) {
  const n = splat.packedSplats?.numSplats || 0;
  const step = Math.max(1, Math.floor(n / 20000));
  const xs = [], ys = [], zs = [];
  splat.packedSplats.forEachSplat((i, c) => {
    if (i % step) return;
    xs.push(c.x); ys.push(c.y); zs.push(c.z);
  });
  return percentiles(xs, ys, zs);
}

function meshSpread(root) {
  root.updateMatrixWorld(true);
  const meshes = [];
  let n = 0;
  root.traverse((o) => { if (o.isMesh && o.geometry.attributes.position) { meshes.push(o); n += o.geometry.attributes.position.count; } });
  const step = Math.max(1, Math.floor(n / 20000));
  const xs = [], ys = [], zs = [], v = new THREE.Vector3();
  for (const m of meshes) {
    const pos = m.geometry.attributes.position;
    for (let i = 0; i < pos.count; i += step) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      xs.push(v.x); ys.push(v.y); zs.push(v.z);
    }
  }
  return percentiles(xs, ys, zs);
}

function percentiles(xs, ys, zs) {
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
    const fileName = file ? file.name : source.url;
    const token = (this.token = {});
    const { item, middle, size, count, unit, flipped } = isMesh(fileName)
      ? await this._loadMesh(source, file, onProgress, token)
      : await this._loadSplat(source, file, onProgress, token);
    if (this.token !== token) { dispose(item); return null; } // another load started meanwhile
    this.loading = null;
    const object = size < OBJECT_SIZE;
    // An object turns about its middle. A place keeps its own origin, which
    // is usually where the capture camera stood: you start inside it.
    if (object) item.position.sub(middle);
    this.splat = item;
    this.holder.add(item);
    const name = file ? file.name.replace(/\.[^.]+$/, '') : source.name;
    this.info = {
      name,
      key: file ? `file:${file.name}:${file.size}` : `url:${source.url}`,
      count,
      unit,
      size,
      object,
      flipped,
    };
    return this.info;
  }

  async _loadSplat(source, file, onProgress) {
    const opts = file
      ? { fileBytes: await file.arrayBuffer(), fileName: file.name }
      : { url: source.url };
    const splat = new SplatMesh({ ...opts, onProgress: (e) => e.total && onProgress?.(e.loaded / e.total) });
    this.loading = splat.initialized;
    await splat.initialized;
    const { middle, size } = spread(splat);
    return { item: splat, middle, size, count: splat.packedSplats?.numSplats || 0, unit: 'splats', flipped: true };
  }

  async _loadMesh(source, file, onProgress) {
    const gltf = file
      ? await gltfLoader.parseAsync(await file.arrayBuffer(), '')
      : await (this.loading = gltfLoader.loadAsync(source.url, (e) => e.total && onProgress?.(e.loaded / e.total)));
    const root = gltf.scene;
    let tris = 0;
    root.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry;
      tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
      // scans are often a single open surface: show both sides
      for (const m of [].concat(o.material)) m.side = THREE.DoubleSide;
    });
    const { middle, size } = meshSpread(root);
    // the holder turns and scales; the scan's own transform stays inside it
    const item = new THREE.Group();
    item.add(root);
    return { item, middle, size, count: Math.round(tris), unit: 'triangles', flipped: false };
  }

  unload() {
    this.token = null;
    if (this.splat) {
      this.splat.removeFromParent();
      dispose(this.splat);
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
    return { q: (this.info?.flipped === false ? UPRIGHT : FLIPPED).toArray(), s };
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

// A splat frees itself; a mesh's geometry, materials and textures are freed one by one.
function dispose(item) {
  if (!item) return;
  if (item.dispose) return item.dispose();
  item.traverse((o) => {
    o.geometry?.dispose();
    for (const m of [].concat(o.material || [])) {
      for (const v of Object.values(m)) if (v?.isTexture) v.dispose();
      m.dispose();
    }
  });
}
