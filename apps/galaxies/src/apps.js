// Each "app" is a living formation. target() writes the local-space home
// position of particle i at time t into out[0..2]; R holds 4 random seeds per
// particle. Coordinates are meters around the formation center, before scale.

const TAU = Math.PI * 2;

export const APPS = [
  {
    id: 'nebula',
    name: 'Nebula',
    tagline: 'breathing cloud',
    colorA: [0.35, 0.5, 1.0],
    colorB: [1.0, 0.4, 0.75],
    spring: 2.4,
    noise: 0.55,
    target(i, t, R, out) {
      const a = R[4 * i], b = R[4 * i + 1], c = R[4 * i + 2], d = R[4 * i + 3];
      const z = 2 * b - 1;
      const s = Math.sqrt(1 - z * z);
      const phi = TAU * c + t * 0.12;
      const rad = 0.34 * Math.cbrt(0.12 + 0.88 * a) * (1 + 0.07 * Math.sin(t * 0.9 + d * TAU));
      out[0] = rad * s * Math.cos(phi);
      out[1] = rad * z;
      out[2] = rad * s * Math.sin(phi);
    },
  },
  {
    id: 'galaxy',
    name: 'Galaxy',
    tagline: 'three-armed spiral',
    colorA: [1.0, 0.72, 0.4],
    colorB: [0.45, 0.6, 1.0],
    spring: 3.2,
    noise: 0.2,
    target(i, t, R, out) {
      const a = R[4 * i], b = R[4 * i + 1], c = R[4 * i + 2], d = R[4 * i + 3];
      let x, y, z;
      if (d < 0.12) {
        // central bulge
        const zz = 2 * b - 1, s = Math.sqrt(1 - zz * zz), phi = TAU * c + t * 0.4;
        const r = 0.075 * Math.cbrt(a);
        x = r * s * Math.cos(phi); y = r * zz * 0.6; z = r * s * Math.sin(phi);
      } else {
        const arm = Math.floor(b * 3);
        const rr = 0.04 + 0.42 * Math.pow(a, 0.85);
        const ang = arm * TAU / 3 + rr * 7.5 + (c - 0.5) * 0.55 - t * 0.22 / (0.25 + rr * 2);
        x = rr * Math.cos(ang);
        z = rr * Math.sin(ang);
        y = ((d - 0.56) / 0.44) * 0.03 * Math.exp(-rr * 4);
      }
      // tilt toward the viewer
      const ct = 0.88, st = 0.47;
      out[0] = x;
      out[1] = y * ct - z * st;
      out[2] = y * st + z * ct;
    },
  },
  {
    id: 'threads',
    name: 'Threads',
    tagline: 'light flowing along a knot',
    colorA: [0.3, 1.0, 0.85],
    colorB: [0.75, 0.45, 1.0],
    spring: 4.5,
    noise: 0.12,
    target(i, t, R, out) {
      const a = R[4 * i], b = R[4 * i + 1];
      const T = 36, k = i % T;
      const ph = (k / T) * TAU;
      const w = 0.012 + 0.03 * (((k * 7) % T) / T);
      const s = a * TAU + t * 0.05 * (0.6 + 0.8 * (((k * 13) % T) / T));
      const r = Math.cos(3 * s) + 2.2;
      const jitter = (b - 0.5) * 0.006;
      out[0] = r * Math.cos(2 * s) * 0.12 + Math.cos(ph + s * 4) * w + jitter;
      out[1] = -Math.sin(3 * s) * 0.12 + Math.sin(ph + s * 4) * w;
      out[2] = r * Math.sin(2 * s) * 0.12 + Math.sin(ph * 2 + s * 3) * w * 0.5 - jitter;
    },
  },
  {
    id: 'bloom',
    name: 'Bloom',
    tagline: 'a flower that opens and closes',
    colorA: [1.0, 0.35, 0.45],
    colorB: [1.0, 0.85, 0.5],
    spring: 3.0,
    noise: 0.18,
    target(i, t, R, out) {
      const a = R[4 * i], b = R[4 * i + 1], c = R[4 * i + 2], d = R[4 * i + 3];
      const open = 0.5 + 0.5 * Math.sin(t * 0.45);
      if (d < 0.1) {
        // pistil
        const zz = 2 * b - 1, s = Math.sqrt(1 - zz * zz), phi = TAU * c;
        const r = 0.035 * Math.cbrt(a);
        out[0] = r * s * Math.cos(phi); out[1] = -0.08 + r * zz; out[2] = r * s * Math.sin(phi);
        return;
      }
      const base = a * TAU;
      const th = base + t * 0.07;
      const env = Math.pow(Math.abs(Math.cos(2.5 * base)), 0.6);
      const rr = 0.42 * env * Math.sqrt(b) * (0.75 + 0.25 * open);
      out[0] = rr * Math.cos(th);
      out[2] = rr * Math.sin(th);
      out[1] = -0.08 + rr * rr * (3.2 - 2.2 * open) + (c - 0.5) * 0.01;
    },
  },
];
