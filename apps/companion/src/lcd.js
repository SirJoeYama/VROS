import * as THREE from 'three';

// The pet's dot-matrix screen: 48 × 32 pixels on a greenish LCD, with faint
// "ghost" pixels like the real thing. The creature has a face per mood:
//   idle · listening · thinking · searching · speaking · happy · sleep · nokey · error
const GW = 48, GH = 32, CELL = 12;
const ON = '#1f2a1d', BG = '#a8b996';

// Tiny bitmaps: '#' on, '+' dim.
const ICONS = {
  mic: ['.###.', '.###.', '.###.', '#.#.#', '.###.', '..#..'],
  talk: ['#######', '#.....#', '#.#.#.#', '#.....#', '###.###', '..##...'],
  globe: ['.###.', '#.#.#', '#####', '#.#.#', '.###.'],
  heart: ['.#.#.', '#####', '#####', '.###.', '..#..'],
  key: ['.##....', '#..####', '#..#.#.', '.##....'],
  Z: ['####', '..#.', '.#..', '####'],
  z: ['###', '.#.', '###'],
  '?': ['###', '..#', '.##', '...', '.#.'],
  '!': ['#', '#', '#', '.', '#'],
};

export class LCD {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = GW * CELL;
    this.canvas.height = GH * CELL;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.px = new Uint8Array(GW * GH); // 0 off · 1 on · 2 dim
    this._key = '';
    this.wander = 0; // idle stroll offset
    this._wanderTick = -1;
  }

  set(x, y, v = 1) {
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 0 && x < GW && y >= 0 && y < GH) this.px[y * GW + x] = v;
  }

  bitmap(rows, x, y, v = 1) {
    rows.forEach((row, j) => [...row].forEach((c, i) => c !== '.' && this.set(x + i, y + j, c === '+' ? 2 : v)));
  }

  // `face`: mood name. `t`: seconds. Redraws only when a pixel could change
  // (the screen ticks at about 4 frames a second, like an LCD toy).
  draw(face, t) {
    const tick = Math.floor(t * 4);
    const key = face + '|' + tick;
    if (key === this._key) return;
    this._key = key;
    this.px.fill(0);
    const f = tick % 2; // two-frame animation
    const blink = face === 'idle' && tick % 17 === 0;

    // Wander left and right while idle, like the pets do.
    if (face === 'idle' && tick !== this._wanderTick && tick % 2 === 0) {
      this._wanderTick = tick;
      const step = [-1, 0, 1][Math.floor(Math.abs(Math.sin(tick * 12.9898) * 43758.5453) % 3)];
      this.wander = THREE.MathUtils.clamp(this.wander + step * 2, -10, 10);
    } else if (face !== 'idle') this.wander += Math.sign(-this.wander);
    const cx = 23.5 + this.wander;
    const cy = 18 + (face === 'idle' || face === 'speaking' ? f : 0);

    // status icons along the top: lit for what the pet is doing
    this.bitmap(ICONS.mic, 6, 1, face === 'listening' ? 1 : 2);
    this.bitmap(ICONS.talk, 20, 1, face === 'speaking' || face === 'thinking' ? 1 : 2);
    this.bitmap(ICONS.globe, 37, 1, face === 'searching' ? 1 : 2);

    // body: an outlined blob with feet and little arms
    for (let y = 0; y < GH; y++) {
      for (let x = 0; x < GW; x++) {
        const d = ((x - cx) / 8.5) ** 2 + ((y - cy) / 7.5) ** 2;
        if (d <= 1 && d > 0.7) this.set(x, y);
      }
    }
    for (const s of [-1, 1]) {
      this.set(cx + s * 3.5, cy + 8);
      this.set(cx + s * 4.5, cy + 8);
      const up = face === 'speaking' ? (f ? s > 0 : s < 0) : face === 'happy';
      this.set(cx + s * 9.5, cy + (up ? -1 : 1));
      this.set(cx + s * 10.5, cy + (up ? -2 : 2));
    }
    // antenna
    const tilt = face === 'thinking' || face === 'searching' ? (f ? 1 : -1) : 0;
    this.set(cx - 0.5, cy - 8);
    this.set(cx - 0.5 + tilt * 0.5, cy - 9);
    const bulb = face === 'listening' ? f : 1;
    if (bulb) {
      this.set(cx - 0.5 + tilt, cy - 11);
      this.set(cx - 1.5 + tilt, cy - 10);
      this.set(cx + 0.5 + tilt, cy - 10);
      this.set(cx - 0.5 + tilt, cy - 10, face === 'listening' ? 1 : 0);
    }

    // eyes
    const ex = [cx - 3.5, cx + 2.5];
    for (const x of ex) {
      if (face === 'sleep' || face === 'nokey' || blink) {
        this.set(x, cy);
        this.set(x + 1, cy);
      } else if (face === 'happy') {
        this.set(x, cy);
        this.set(x + 0.5, cy - 1);
        this.set(x + 1, cy);
      } else if (face === 'error') {
        this.set(x, cy - 1);
        this.set(x + 1, cy);
        this.set(x + 1, cy - 1);
        this.set(x, cy);
      } else {
        const up = face === 'thinking' || face === 'searching' ? -1 : 0;
        const look = face === 'searching' ? (f ? 1 : 0) : 0;
        this.set(x + look, cy - 1 + up);
        this.set(x + look, cy + up);
        this.set(x + 1 + look, cy - 1 + up);
        this.set(x + 1 + look, cy + up);
      }
    }

    // mouth
    if (face === 'speaking' && f) {
      for (let x = -1.5; x <= 1.5; x++) this.set(cx + x, cy + 3);
      this.set(cx - 1.5, cy + 4);
      this.set(cx + 1.5, cy + 4);
      for (let x = -1.5; x <= 1.5; x++) this.set(cx + x, cy + 5);
    } else if (face === 'happy' || face === 'idle') {
      this.set(cx - 2.5, cy + 3);
      for (let x = -1.5; x <= 1.5; x++) this.set(cx + x, cy + 4);
      this.set(cx + 2.5, cy + 3);
    } else if (face === 'listening') {
      this.set(cx - 0.5, cy + 3);
      this.set(cx + 0.5, cy + 3);
      this.set(cx - 0.5, cy + 4);
      this.set(cx + 0.5, cy + 4);
    } else if (face === 'error') {
      this.set(cx - 2.5, cy + 4);
      for (let x = -1.5; x <= 1.5; x++) this.set(cx + x, cy + 3);
      this.set(cx + 2.5, cy + 4);
    } else {
      this.set(cx - 0.5, cy + 3);
      this.set(cx + 0.5, cy + 3);
    }

    // extras around the pet
    if (face === 'listening') {
      // sound waves coming in
      const r = 11 + f;
      for (let a = -2; a <= 2; a++) {
        this.set(cx + r + Math.abs(a) * -0.4, cy + a - 2);
        this.set(cx - r - Math.abs(a) * -0.4 - 1, cy + a - 2);
      }
      this.bitmap(ICONS['?'], cx + 12, cy - 11);
    } else if (face === 'thinking' || face === 'searching') {
      const n = tick % 4;
      for (let k = 0; k < n; k++) this.set(cx + 10 + k * 2, cy - 9);
      if (face === 'searching') this.bitmap(ICONS.globe, cx - 17, cy - 11);
    } else if (face === 'sleep' || face === 'nokey') {
      const rise = tick % 6;
      this.bitmap(ICONS.Z, cx + 10, cy - 6 - rise);
      if (rise > 2) this.bitmap(ICONS.z, cx + 15, cy - 9 - rise + 2);
      if (face === 'nokey') this.bitmap(ICONS.key, cx - 20, cy + 3);
    } else if (face === 'happy') {
      this.bitmap(ICONS.heart, cx + 11, cy - 8 - f);
      this.bitmap(ICONS.heart, cx - 16, cy - 6 - (1 - f));
    } else if (face === 'error') {
      this.bitmap(ICONS['!'], cx + 12, cy - 10);
    }

    this._render();
  }

  _render() {
    const g = this.ctx;
    g.fillStyle = BG;
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    for (let y = 0; y < GH; y++) {
      for (let x = 0; x < GW; x++) {
        const v = this.px[y * GW + x];
        g.fillStyle = v === 1 ? ON : v === 2 ? 'rgba(31, 42, 29, 0.28)' : 'rgba(31, 42, 29, 0.06)';
        g.fillRect(x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2);
      }
    }
    // soft shade from the bezel
    const shade = g.createLinearGradient(0, 0, 0, this.canvas.height);
    shade.addColorStop(0, 'rgba(0, 0, 0, 0.16)');
    shade.addColorStop(0.2, 'rgba(0, 0, 0, 0)');
    g.fillStyle = shade;
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.texture.needsUpdate = true;
  }
}
