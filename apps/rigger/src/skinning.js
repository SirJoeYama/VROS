import * as THREE from 'three';

// Automatic skin weights, after Mesh2Motion's solver (MIT):
// 1. each vertex goes 100% to the bone whose midpoint (joint → first child)
//    is closest; the root and "leaf"/"tip" bones get nothing;
// 2. finger/toe bones hand back vertices that sit behind their start joint;
// 3. boundaries between bones are blended: torso boundaries over three rings
//    of vertices, limbs only on the child's side (so bending the elbow
//    doesn't dent the bicep), fingers and toes not at all.
// Everything is in one space: `geometry` positions and `joints` (each bone's
// world position) must share it.

const EXTREMITY = ['hand', 'foot', 'feet', 'toe', 'ball', 'thumb', 'index', 'middle', 'ring', 'pinky', 'finger', 'teeth', 'eye', 'tongue', 'wing', 'feather', 'leaf', 'ear', 'horn'];
const LIMB = ['arm', 'elbow', 'wrist', 'nose', 'shoulder', 'clavicle', 'ankle', 'fin', 'head', 'chin', 'jaw', 'mouth', 'thigh', 'calf', 'shin', 'knee', 'leg', 'neck', 'humerus'];
const TORSO = ['spine', 'chest', 'hips', 'pelvis', 'torso', 'abdomen', 'body', 'tail', 'stomach', 'collar', 'scapula', 'ribcage'];

function category(bone) {
  const n = bone.name.toLowerCase();
  if (EXTREMITY.some((k) => n.includes(k))) return 'extremity';
  if (LIMB.some((k) => n.includes(k))) return 'limb';
  if (TORSO.some((k) => n.includes(k))) return 'torso';
  if (!bone.parent?.isBone) return 'root';
  return 'other';
}

export const isLeaf = (bone) => !bone.children.some((c) => c.isBone) && /leaf|tip/i.test(bone.name);

// bones: the skeleton's bones in order; joints: Vector3 per bone.
// Returns { index: Uint16Array, weight: Float32Array }, 4 influences per vertex.
export function computeWeights(geometry, bones, joints, { trackBone, human } = {}) {
  const pos = geometry.attributes.position;
  const n = pos.count;
  const nb = bones.length;
  const boneIndex = new Map(bones.map((b, i) => [b, i]));
  const firstChild = bones.map((b) => b.children.find((c) => c.isBone));
  const mids = bones.map((b, i) => (firstChild[i] ? joints[i].clone().lerp(joints[boneIndex.get(firstChild[i])], 0.5) : joints[i].clone()));
  const skip = bones.map((b) => b.name === 'root' || isLeaf(b));
  const cats = bones.map(category);
  const hips = bones.map((b) => /hips|pelvis/i.test(b.name));

  // Humans: vertices below the crotch can't belong to the hips, or the legs
  // would pull the groin apart. The crotch is found by a ray straight down
  // from the tracking bone.
  let crotchY = -Infinity;
  if (human && trackBone) {
    const ti = bones.indexOf(trackBone);
    const ray = new THREE.Raycaster(mids[ti], new THREE.Vector3(0, -1, 0));
    const hit = ray.intersectObject(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })), false)[0];
    crotchY = hit ? mids[ti].y - hit.distance * 1.1 : -Infinity;
  }

  const index = new Uint16Array(n * 4);
  const weight = new Float32Array(n * 4);
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i);
    let best = 0, bestD = Infinity;
    for (let b = 0; b < nb; b++) {
      if (skip[b]) continue;
      if (hips[b] && v.y < crotchY) continue;
      const d = mids[b].distanceToSquared(v);
      if (d < bestD) { bestD = d; best = b; }
    }
    index[i * 4] = best;
    weight[i * 4] = 1;
  }

  // Step 2: pull knuckle vertices back off finger bones.
  for (let b = 0; b < nb; b++) {
    if (cats[b] !== 'extremity') continue;
    const parent = boneIndex.get(bones[b].parent);
    if (parent === undefined) continue;
    const dir = firstChild[b]
      ? joints[boneIndex.get(firstChild[b])].clone().sub(joints[b])
      : joints[b].clone().sub(joints[parent]);
    if (dir.lengthSq() < 1e-12) continue;
    for (let i = 0; i < n; i++) {
      if (index[i * 4] !== b) continue;
      v.fromBufferAttribute(pos, i).sub(joints[b]);
      if (v.dot(dir) < 0) index[i * 4] = parent;
    }
  }

  smooth(geometry, bones, cats, index, weight);
  return { index, weight };
}

function smooth(geometry, bones, cats, index, weight) {
  const pos = geometry.attributes.position;
  const n = pos.count;
  const idx = geometry.index?.array;
  if (!idx) return;

  // Vertices at the same spot (UV seams, split normals) move together.
  const byPos = new Map();
  const twin = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const k = `${pos.getX(i).toFixed(5)},${pos.getY(i).toFixed(5)},${pos.getZ(i).toFixed(5)}`;
    let list = byPos.get(k);
    if (!list) byPos.set(k, (list = []));
    list.push(i);
    twin[i] = byPos.size - 1;
  }
  const groups = [...byPos.values()];
  const shared = (i) => groups[twin[i]];

  const adj = Array.from({ length: n }, () => new Set());
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    adj[a].add(b).add(c);
    adj[b].add(a).add(c);
    adj[c].add(a).add(b);
  }

  const set = (i, primary, secondary, w2) => {
    for (const j of shared(i)) {
      const o = j * 4;
      index[o] = primary; index[o + 1] = secondary; index[o + 2] = 0; index[o + 3] = 0;
      weight[o] = 1 - w2; weight[o + 1] = w2; weight[o + 2] = 0; weight[o + 3] = 0;
    }
  };
  const isParent = (p, c) => bones[c].parent === bones[p];

  // Boundary pairs: neighbours still 100% on different bones.
  const pairs = [];
  for (let i = 0; i < n; i++) {
    if (weight[i * 4] !== 1) continue;
    const a = index[i * 4];
    for (const j of adj[i]) {
      if (j <= i || weight[j * 4] !== 1) continue;
      const b = index[j * 4];
      if (a === b) continue;
      const ca = cats[a], cb = cats[b];
      let type = 'standard';
      if ((ca === 'torso' || cb === 'torso') && ca !== 'extremity' && cb !== 'extremity') type = 'torso';
      else if (ca === 'limb' || cb === 'limb') type = 'limb';
      else if (ca === 'extremity' && cb === 'extremity') type = 'none';
      pairs.push([i, j, a, b, type]);
    }
  }

  // Torso: 50/50 at the boundary, then 75/25 and 90/10 one and two rings out.
  const done = new Set();
  let ring = new Set();
  for (const [i, j, a, b, type] of pairs) {
    if (type !== 'torso') continue;
    set(i, a, b, 0.5);
    set(j, b, a, 0.5);
    done.add(i).add(j);
    ring.add(i).add(j);
  }
  for (const w2 of [0.25, 0.1]) {
    const next = new Set();
    for (const i of ring) {
      const primary = index[i * 4], other = index[i * 4 + 1];
      if (other === primary || other === 0) continue;
      for (const j of adj[i]) {
        if (done.has(j) || index[j * 4] !== primary || weight[j * 4] !== 1) continue;
        set(j, primary, other, w2);
        done.add(j);
        next.add(j);
      }
    }
    ring = next;
  }

  for (const [i, j, a, b, type] of pairs) {
    if (type === 'limb') {
      if (isParent(a, b)) set(j, b, a, 0.5);
      else if (isParent(b, a)) set(i, a, b, 0.5);
      else { set(i, a, b, 0.5); set(j, b, a, 0.5); }
    } else if (type === 'standard') {
      set(i, a, b, 0.5);
      set(j, b, a, 0.5);
    }
  }
}

// A preview that colours each vertex by the bones it follows.
export function weightColors(count, index, weight, boneCount) {
  const palette = Array.from({ length: boneCount }, (_, b) => new THREE.Color().setHSL(((b * 0.618034) % 1), 0.75, 0.55));
  const col = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    let r = 0, g = 0, bl = 0;
    for (let k = 0; k < 4; k++) {
      const w = weight[i * 4 + k];
      if (!w) continue;
      const c = palette[index[i * 4 + k]];
      r += c.r * w; g += c.g * w; bl += c.b * w;
    }
    col[i * 3] = r; col[i * 3 + 1] = g; col[i * 3 + 2] = bl;
  }
  return col;
}
