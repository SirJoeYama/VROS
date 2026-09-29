import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { meshesFor } from './brush.js';

// The drawing as a GLB: a node per layer, and under it a node per frame
// holding that frame's meshes. Animated layers get one clip ("animation")
// that shows one frame at a time by switching the frame nodes' scale
// between 1 and 0 (stepped). Viewers without animation see frame 1.
export async function exportGLB(doc) {
  const root = new THREE.Group();
  root.name = 'drawing';
  const tracks = [];
  const n = doc.length, dt = 1 / doc.fps;
  const times = Array.from({ length: n + 1 }, (_, i) => i * dt);
  doc.layers.forEach((l, li) => {
    if (!l.visible) return;
    const lg = new THREE.Group();
    lg.name = `layer_${li + 1}_${l.name}`.replace(/[^\w]/g, '_');
    root.add(lg);
    l.frames.forEach((f, fi) => {
      const fg = new THREE.Group();
      fg.name = `${lg.name}_frame_${fi + 1}`;
      for (const m of meshesFor(f.strokes)) {
        const copy = new THREE.Mesh(m.geometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: m.userData.kind === 'glow', opacity: m.userData.kind === 'glow' ? 0.6 : 1 }));
        copy.name = `${fg.name}_${m.userData.kind}`;
        fg.add(copy);
      }
      lg.add(fg);
      if (l.frames.length < 2) return;
      const values = [];
      for (let i = 0; i <= n; i++) {
        const k = (i % n) % l.frames.length === fi ? 1 : 0;
        values.push(k, k, k);
      }
      if (fi !== 0) fg.scale.setScalar(0);
      tracks.push(new THREE.VectorKeyframeTrack(`${fg.name}.scale`, times, values, THREE.InterpolateDiscrete));
    });
  });
  const animations = tracks.length ? [new THREE.AnimationClip('animation', n * dt, tracks)] : [];
  return new GLTFExporter().parseAsync(root, { binary: true, animations });
}
