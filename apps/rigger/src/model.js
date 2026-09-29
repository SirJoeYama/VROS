import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const gltfLoader = new GLTFLoader();
export const loadGLTF = (url) => gltfLoader.loadAsync(url);

// A model to rig: plain meshes (any rig or skin it came with is dropped),
// baked into one space, standing on the floor and centred left-right and
// front-back so the skeleton's mirror plane runs through it.
// { parts: [{ geometry, material }], height, name, sample }
export async function loadModel(source, { sample = false, name } = {}) {
  let root;
  if (typeof source === 'string') root = (await loadGLTF(source)).scene;
  else {
    const url = URL.createObjectURL(source);
    const ext = source.name.split('.').pop().toLowerCase();
    try {
      if (ext === 'fbx') root = await new FBXLoader().loadAsync(url);
      else if (ext === 'obj') root = await new OBJLoader().loadAsync(url);
      else root = (await gltfLoader.loadAsync(url)).scene;
    } finally {
      URL.revokeObjectURL(url);
    }
    name ??= source.name.replace(/\.[^.]+$/, '');
  }
  root.updateMatrixWorld(true);

  const parts = [];
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes.position) return;
    let g = o.geometry.clone();
    for (const k of ['skinIndex', 'skinWeight']) g.deleteAttribute(k);
    g.morphAttributes = {};
    g.applyMatrix4(o.matrixWorld);
    if (!g.index) g = mergeVertices(g); // the weight smoother walks triangles
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    // Multi-material meshes are split per group so each part has one material.
    if (mats.length > 1 && g.groups.length) {
      for (const grp of g.groups) parts.push({ geometry: subGeometry(g, grp), material: prep(mats[grp.materialIndex] || mats[0]) });
    } else parts.push({ geometry: g, material: prep(mats[0]) });
  });
  if (!parts.length) throw new Error('No meshes in that file.');

  const box = new THREE.Box3();
  for (const p of parts) {
    p.geometry.computeBoundingBox();
    box.union(p.geometry.boundingBox);
  }
  const size = box.getSize(new THREE.Vector3());
  // The samples are authored to fit their skeletons: leave them as they are.
  // Anything else is put on the floor at the origin, and brought to a human
  // scale if it's wildly off (centimetres, kilometres).
  if (!sample) {
    const big = Math.max(size.x, size.y, size.z);
    const k = big > 20 || big < 0.05 ? 1.8 / big : 1;
    const m = new THREE.Matrix4().makeScale(k, k, k)
      .multiply(new THREE.Matrix4().makeTranslation(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2));
    for (const p of parts) {
      p.geometry.applyMatrix4(m);
      p.geometry.computeBoundingBox();
    }
    box.applyMatrix4(m);
  }
  for (const p of parts) {
    p.geometry.computeBoundingSphere();
    if (!p.geometry.attributes.normal) p.geometry.computeVertexNormals();
  }
  return { parts, box, name: name || 'model', sample };
}

function prep(m) {
  return (m || new THREE.MeshStandardMaterial({ color: 0xb8b8c8 })).clone();
}

function subGeometry(g, grp) {
  const out = g.clone();
  const idx = g.index.array.slice(grp.start, grp.start + grp.count);
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.clearGroups();
  return out;
}
