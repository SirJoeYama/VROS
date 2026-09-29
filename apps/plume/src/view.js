import * as THREE from 'three';
import { meshesFor, strokeArrays, geometryFrom, MATERIALS, materialOf } from './brush.js';

// Shows the drawing: for each visible layer, the frame at the playhead, as
// merged meshes (rebuilt only when that frame changes). While paused, the
// active layer's previous and next frames show as tinted ghosts (onion skin).
// The stroke being drawn is its own mesh, rebuilt as it grows.
export class View {
  constructor(doc, canvas) {
    this.doc = doc;
    this.canvas = canvas; // the Group the drawing lives in
    this.onion = true;
    this.playing = false;
    this.cache = new Map(); // frame id → { version, meshes }
    this.layerGroups = new Map();
    this.ghostMats = [0xff6a6a, 0x6ab4ff].map((c) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }));
    this.ghosts = new THREE.Group();
    canvas.add(this.ghosts);
    this.live = new Map(); // stroke → mesh
    this._key = '';
  }

  _meshes(f) {
    let c = this.cache.get(f.id);
    if (c && c.version === (f.version || 0) && c.strokes === f.strokes) return c.meshes;
    if (c) for (const m of c.meshes) m.geometry.dispose();
    c = { version: f.version || 0, strokes: f.strokes, meshes: meshesFor(f.strokes) };
    this.cache.set(f.id, c);
    return c.meshes;
  }

  update() {
    const d = this.doc;
    const key = `${d.version}|${d.t}|${this.onion}|${this.playing}`;
    if (key === this._key) return;
    this._key = key;
    const live = new Set();
    d.layers.forEach((l, order) => {
      let g = this.layerGroups.get(l.id);
      if (!g) {
        g = new THREE.Group();
        this.layerGroups.set(l.id, g);
        this.canvas.add(g);
      }
      live.add(l.id);
      g.visible = l.visible;
      const meshes = l.visible ? this._meshes(d.shown(l)) : [];
      if (g.children.length !== meshes.length || g.children.some((m, i) => m !== meshes[i])) {
        g.clear();
        for (const m of meshes) g.add(m);
      }
      g.renderOrder = order;
    });
    for (const [id, g] of this.layerGroups) {
      if (!live.has(id)) {
        g.removeFromParent();
        this.layerGroups.delete(id);
      }
    }

    // onion skin
    this.ghosts.clear();
    const l = d.layer, n = l.frames.length;
    if (this.onion && !this.playing && n > 1 && l.visible) {
      const i = d.frameIndex();
      [i - 1, i + 1].forEach((k, side) => {
        if (k < 0 || k >= n) return;
        for (const m of this._meshes(l.frames[k])) {
          const ghost = new THREE.Mesh(m.geometry, this.ghostMats[side]);
          ghost.renderOrder = -1;
          this.ghosts.add(ghost);
        }
      });
    }

    // Drop cached meshes of frames that no longer exist (after deletes / undo trimming).
    if (this.cache.size > 64) {
      const ids = new Set(d.layers.flatMap((l) => l.frames.map((f) => f.id)));
      for (const [id, c] of this.cache) if (!ids.has(id)) { for (const m of c.meshes) m.geometry.dispose(); this.cache.delete(id); }
    }
  }

  // The stroke being drawn, redrawn from scratch as it grows.
  drawLive(s) {
    let m = this.live.get(s);
    if (!m) {
      m = new THREE.Mesh(new THREE.BufferGeometry(), MATERIALS[materialOf(s.brush)]);
      m.frustumCulled = false;
      this.live.set(s, m);
      this.canvas.add(m);
    }
    m.geometry.dispose();
    m.geometry = geometryFrom([strokeArrays(s)]);
  }

  endLive(s) {
    const m = this.live.get(s);
    if (!m) return;
    m.geometry.dispose();
    m.removeFromParent();
    this.live.delete(s);
    this._key = ''; // the frame's mesh changes too
  }
}
