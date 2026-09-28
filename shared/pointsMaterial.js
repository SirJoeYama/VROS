// Soft glowing round points; size grows with speed (aSpeed) and color mixes
// between two colors by a per-point seed (aSeed).
import * as THREE from 'three';

const VERT = /* glsl */ `
uniform float uSize;
uniform float uScale;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uFade;
attribute float aSpeed;
attribute float aSeed;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float sz = uSize * (0.6 + 0.8 * fract(aSeed * 7.13)) * (1.0 + aSpeed * 1.5);
  gl_PointSize = clamp(sz * uScale / max(-mv.z, 0.05), 1.0, 64.0);
  vec3 base = mix(uColorA, uColorB, aSeed);
  vColor = base * (0.6 + 1.4 * aSpeed) + vec3(aSpeed * aSpeed * 0.5);
  vAlpha = uFade * (0.15 + 0.45 * fract(aSeed * 3.7));
}`;

const FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = dot(c, c) * 4.0;
  if (d > 1.0) discard;
  float a = 1.0 - d;
  gl_FragColor = vec4(vColor, a * a * vAlpha);
}`;

export function makePointsMaterial({ size = 0.006, colorA = [1, 1, 1], colorB = [1, 1, 1] } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uSize: { value: size },
      uScale: { value: 800 },
      uColorA: { value: new THREE.Color(...colorA) },
      uColorB: { value: new THREE.Color(...colorB) },
      uFade: { value: 1 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}
