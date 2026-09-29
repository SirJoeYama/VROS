// The skeleton templates, their sample models and animation libraries. The
// rigs, models and animations are Mesh2Motion's (CC0), in ../assets.
// `track`: the one bone whose position is animated (besides rotations).
export const RIGS = [
  { id: 'human', name: 'Human', track: 'pelvis', anims: ['human-base-animations.glb', 'human-addon-animations.glb', 'human-mocap-animations.glb'] },
  { id: 'fox', name: 'Fox', track: 'hips', anims: ['fox-animations.glb'] },
  { id: 'horse', name: 'Horse', track: 'hips', anims: ['horse-animations.glb'] },
  { id: 'bird', name: 'Bird', track: 'hips', anims: ['bird-animations.glb'] },
  { id: 'dragon', name: 'Dragon', track: 'hips', anims: ['dragon-animations.glb'] },
  { id: 'kaiju', name: 'Kaiju', track: 'hips', anims: ['kaiju-animations.glb'] },
  { id: 'spider', name: 'Spider', track: 'hips', anims: ['spider-animations.glb'] },
  { id: 'snake', name: 'Snake', track: 'head', anims: ['snake-animations.glb'] },
  { id: 'fish', name: 'Fish', track: 'pelvis', anims: ['shark-animations.glb'], model: 'shark' },
];

export const ASSETS = new URL('../assets/', import.meta.url).href;
export const rigUrl = (rig) => `${ASSETS}rigs/rig-${rig.model || rig.id}.glb`;
export const modelUrl = (rig) => `${ASSETS}models/model-${rig.model || rig.id}.glb`;
export const animUrls = (rig) => rig.anims.map((f) => `${ASSETS}animations/${f}`);
