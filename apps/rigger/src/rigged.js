import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { loadGLTF } from './model.js';
import { computeWeights, weightColors } from './skinning.js';
import { animUrls } from './rigs.js';

// The model bound to the fitted skeleton: skinned meshes sharing one
// skeleton, an animation mixer, and export to GLB.
export class Rigged {
  // `model`: from loadModel; `modelGroup`: where the model is shown (its
  // transform, e.g. a turn, is baked in); `editRig`: the fitted skeleton.
  // Both must sit directly in `space`.
  constructor(model, modelGroup, editRig, space) {
    this.group = new THREE.Group();
    this.group.name = model.name;
    space.add(this.group);
    this.armature = editRig.root.clone(true);
    this.group.add(this.armature);
    this.group.updateMatrixWorld(true);
    this.bones = [];
    this.armature.traverse((o) => o.isBone && this.bones.push(o));
    this.skeleton = new THREE.Skeleton(this.bones);
    this.editRig = editRig;

    const toSpace = new THREE.Matrix4().copy(this.group.matrixWorld).invert();
    const joints = this.bones.map((b) => b.getWorldPosition(new THREE.Vector3()).applyMatrix4(toSpace));
    const trackBone = this.bones[editRig.bones.indexOf(editRig.trackBone)];
    modelGroup.updateMatrix();

    this.meshes = model.parts.map((p, k) => {
      const g = p.geometry.clone().applyMatrix4(modelGroup.matrix);
      const { index, weight } = computeWeights(g, this.bones, joints, { trackBone, human: editRig.rig.id === 'human' });
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(index, 4));
      g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weight, 4));
      g.userData.weightColors = weightColors(g.attributes.position.count, index, weight, this.bones.length);
      const mat = p.material.clone();
      Object.assign(mat, p.material.userData.orig); // not the fit view's see-through look
      const mesh = new THREE.SkinnedMesh(g, mat);
      mesh.name = `${model.name}_${k}`;
      mesh.frustumCulled = false; // bounds don't follow the animation
      this.group.add(mesh);
      mesh.bind(this.skeleton);
      return mesh;
    });

    this.mixer = new THREE.AnimationMixer(this.group);
    this.action = null;
    this.clip = null;
    this.prepared = new Map();
    this.showWeights = false;
  }

  // Library clips are authored for the template. Rotations carry over as they
  // are; the few position tracks (hips, and the root on root-motion clips)
  // are scaled with the skeleton and shifted by how far that joint was moved.
  prepare(clip) {
    if (clip.custom) return clip; // made on this skeleton already
    let out = this.prepared.get(clip);
    if (out) return out;
    const er = this.editRig;
    out = clip.clone();
    if (clip.imported) {
      // from a file: move its position tracks from the file's skeleton to this fit
      for (const t of out.tracks) {
        if (!t.name.endsWith('.position')) continue;
        const name = t.name.slice(0, -9), i = er.bones.findIndex((b) => b.name === name);
        if (i >= 0) retargetPosition(t, er, i, clip.sourceRest?.[name]);
      }
      this.prepared.set(clip, out);
      return out;
    }
    for (const t of out.tracks) {
      if (!t.name.endsWith('.position')) continue;
      const i = er.bones.findIndex((b) => b.name === t.name.slice(0, -9));
      if (i < 0) continue;
      const tpl = er.template.pos[i], now = er.bones[i].position, s = er.scale;
      const off = [now.x - tpl.x * s, now.y - tpl.y * s, now.z - tpl.z * s];
      const v = (t.values = t.values.slice());
      for (let j = 0; j < v.length; j++) v[j] = v[j] * s + off[j % 3];
    }
    this.prepared.set(clip, out);
    return out;
  }

  play(clip) {
    const c = this.prepare(clip);
    const next = this.mixer.clipAction(c);
    if (this.action && this.action !== next) this.action.fadeOut(0.2);
    next.reset().fadeIn(this.action ? 0.2 : 0).play();
    next.paused = false;
    this.action = next;
    this.clip = clip;
  }

  stop() {
    this.mixer.stopAllAction();
    this.action = null;
  }

  // Pose the skeleton as `clip` is at time `t` and call `read` (stopping the
  // action afterwards puts the bones back as they were).
  sample(clip, t, read) {
    this.mixer.stopAllAction();
    const a = this.mixer.clipAction(this.prepare(clip));
    a.reset().play();
    a.time = t;
    this.mixer.update(0);
    read();
    a.stop();
    this.action = null;
  }

  get paused() {
    return !this.action || this.action.paused;
  }

  togglePause() {
    if (this.action) this.action.paused = !this.action.paused;
  }

  tick(dt) {
    this.mixer.update(dt);
  }

  setWeightsView(on) {
    this.showWeights = on;
    for (const m of this.meshes) {
      m.userData.material ??= m.material;
      if (on) {
        m.geometry.setAttribute('color', new THREE.BufferAttribute(m.geometry.userData.weightColors, 3));
        m.material = new THREE.MeshBasicMaterial({ vertexColors: true });
      } else {
        m.geometry.deleteAttribute('color');
        if (m.material !== m.userData.material) m.material.dispose();
        m.material = m.userData.material;
      }
    }
  }

  // A GLB with the rigged model and the chosen clips.
  async exportGLB(clips) {
    const weights = this.showWeights;
    const resume = this.action ? this.clip : null; // only what was actually playing
    if (weights) this.setWeightsView(false);
    this.mixer.stopAllAction();
    this.armature.traverse((o) => {
      if (!o.isBone) return;
      const src = this.editRig.bones[this.bones.indexOf(o)];
      o.position.copy(src.position);
      o.quaternion.copy(src.quaternion);
      o.scale.copy(src.scale);
    });
    this.group.updateMatrixWorld(true);
    try {
      const animations = clips.map((c) => {
        const p = this.prepare(c).clone();
        p.name = c.name;
        return p;
      });
      return await new GLTFExporter().parseAsync(this.group, { binary: true, animations });
    } finally {
      if (resume) this.play(resume);
      else this.action = null;
      if (weights) this.setWeightsView(true);
    }
  }

  dispose() {
    this.mixer.stopAllAction();
    for (const m of this.meshes) {
      m.geometry.dispose();
      m.material.dispose();
    }
    this.group.removeFromParent();
  }
}

// The rig's animation library, once per rig: rotation tracks, plus position
// tracks for the tracking bone and (on root-motion "RM" clips) the root.
const libraries = new Map();
export function loadLibrary(rig, boneNames) {
  if (libraries.has(rig.id)) return libraries.get(rig.id);
  const track = rig.track.toLowerCase();
  const p = Promise.all(animUrls(rig).map(loadGLTF)).then((files) => {
    const clips = [];
    const seen = new Set();
    for (const f of files) {
      for (const clip of f.animations) {
        if (seen.has(clip.name)) continue;
        seen.add(clip.name);
        const rm = /[_ ]?rm$/i.test(clip.name);
        const tracks = clip.tracks.filter((t) => {
          const dot = t.name.lastIndexOf('.');
          const node = t.name.slice(0, dot), prop = t.name.slice(dot + 1);
          if (!boneNames.has(node)) return false;
          if (prop === 'quaternion') return true;
          if (prop !== 'position') return false;
          const n = node.toLowerCase();
          return n.includes(track) || (rm && n === 'root');
        });
        if (tracks.length) clips.push(new THREE.AnimationClip(clip.name, clip.duration, tracks));
      }
    }
    clips.sort((a, b) => a.name.localeCompare(b.name));
    return clips;
  });
  p.catch(() => libraries.delete(rig.id));
  libraries.set(rig.id, p);
  return p;
}

// Animations from a GLB/GLTF file (one exported from Rigger or Mesh2Motion,
// or any file whose bones have the same names). Tracks are matched to our
// bones by name; a clip is only taken if at least half of its rotation
// tracks find a bone. Rotations carry over as they are. Position tracks are
// kept only for the tracking bone (hips) and, on root-motion clips, the
// root, and are moved from the file's skeleton to ours when played or
// exported (Rigged.prepare): their offset from the file's rest position,
// scaled by how the two skeletons compare, so they follow later re-fits.
// Files without that bone just get the template treatment, like library clips.
// `taken`: names already in use, so imported ones get unique names.
// Returns { clips, rejected: [{ name, matched, total }] }.
export async function importAnimations(file, rigged, taken = new Set()) {
  const url = URL.createObjectURL(file);
  let gltf;
  try {
    gltf = await loadGLTF(url);
  } finally {
    URL.revokeObjectURL(url);
  }
  if (!gltf.animations?.length) throw new Error(`${file.name} has no animations.`);
  const er = rigged.editRig;
  const ours = new Map(er.bones.map((b, i) => [b.name, i]));
  const theirs = new Map();
  gltf.scene.traverse((o) => o.name && !theirs.has(o.name) && theirs.set(o.name, o));
  const track = er.trackBone.name;
  const clips = [], rejected = [];
  const rest = (name) => theirs.get(name)?.position?.toArray() || null;
  for (const clip of gltf.animations) {
    let total = 0, matched = 0;
    const tracks = [], sourceRest = {};
    for (const t of clip.tracks) {
      const dot = t.name.lastIndexOf('.');
      const node = t.name.slice(0, dot), prop = t.name.slice(dot + 1);
      if (prop === 'quaternion') total++;
      const i = ours.get(node);
      if (i === undefined) continue;
      if (prop === 'quaternion') {
        matched++;
        tracks.push(t.clone());
      } else if (prop === 'position' && (node === track || (node === 'root' && /[_ ]?rm$/i.test(clip.name)))) {
        tracks.push(t.clone());
        sourceRest[node] = rest(node);
      }
    }
    if (matched < 3 || matched < total / 2) {
      rejected.push({ name: clip.name, matched, total });
      continue;
    }
    // a clash with a library or saved clip becomes "Jog (imported)", then "(imported 2)"…
    const base = clip.name || 'Animation';
    let name = base;
    for (let k = 1; taken.has(name); k++) name = `${base} (imported${k > 1 ? ' ' + k : ''})`;
    taken.add(name);
    const out = new THREE.AnimationClip(name, clip.duration, tracks);
    out.imported = true;
    out.sourceRest = sourceRest; // the file's rest positions, { bone: [x, y, z] | null }
    clips.push(out);
  }
  return { clips, rejected };
}

// `src`: the file's rest position for this bone, [x, y, z], or null.
function retargetPosition(t, er, i, src) {
  const now = er.bones[i].position;
  const v = (t.values = t.values.slice());
  const from = src && new THREE.Vector3().fromArray(src);
  if (from && from.lengthSq() > 1e-12) {
    const k = now.lengthSq() > 1e-12 ? now.length() / from.length() : 1;
    for (let j = 0; j < v.length; j += 3) {
      v[j] = now.x + (v[j] - from.x) * k;
      v[j + 1] = now.y + (v[j + 1] - from.y) * k;
      v[j + 2] = now.z + (v[j + 2] - from.z) * k;
    }
  } else {
    // no skeleton in the file: assume it was made for the template, like the library
    const tpl = er.template.pos[i], s = er.scale;
    const off = [now.x - tpl.x * s, now.y - tpl.y * s, now.z - tpl.z * s];
    for (let j = 0; j < v.length; j++) v[j] = v[j] * s + off[j % 3];
  }
  return t;
}

export function download(buffer, name) {
  const url = URL.createObjectURL(new Blob([buffer], { type: 'model/gltf-binary' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
