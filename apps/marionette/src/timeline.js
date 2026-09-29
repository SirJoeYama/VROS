import * as THREE from 'three';

const KEY = 'vros.marionette.frames';
const FPS_STEPS = [4, 6, 8, 12, 24];

// The animation: a list of poses played back one after another with no
// in-betweens, like stop-motion. Saved in localStorage.
export class Timeline extends EventTarget {
  constructor(restPose) {
    super();
    this.frames = [];
    this.current = 0;
    this.playing = false;
    this.fps = 8;
    this.onion = true;
    this.modes = { hand: 'ik', foot: 'ik' }; // IK or FK for the hand and foot tips
    this.version = 0; // bumps on any change the panel shows
    this._clock = 0;
    this.past = []; // { frames, current } before each pose or frame change, for undo
    this.future = [];
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (saved?.frames?.length) {
        this.frames = saved.frames;
        this.fps = saved.fps || 8;
      }
    } catch {}
    if (!this.frames.length) this.frames = [restPose];
  }

  get pose() {
    return this.frames[this.current];
  }

  // Snapshot before a change, so it can be undone.
  _record() {
    this.past.push({ frames: structuredClone(this.frames), current: this.current });
    if (this.past.length > 100) this.past.shift();
    this.future.length = 0;
  }

  // Both return true if they changed something.
  undo() {
    return this._swap(this.past, this.future);
  }

  redo() {
    return this._swap(this.future, this.past);
  }

  _swap(from, to) {
    const s = from.pop();
    if (!s) return false;
    to.push({ frames: structuredClone(this.frames), current: this.current });
    this.frames = s.frames;
    this.current = Math.min(s.current, this.frames.length - 1);
    this.pause();
    this._changed(true);
    return true;
  }

  // The pose being edited changed.
  setPose(pose) {
    this._record();
    this.frames[this.current] = pose;
    this._changed(false);
  }

  go(i) {
    const n = this.frames.length;
    const next = ((i % n) + n) % n;
    if (next === this.current) return;
    this.current = next;
    this._changed(true);
  }

  // Stop-motion step: copy the current pose into a new frame right after it.
  addFrame() {
    this._record();
    this.frames.splice(this.current + 1, 0, structuredClone(this.pose));
    this.current++;
    this._changed(true);
  }

  deleteFrame() {
    if (this.frames.length === 1) return;
    this._record();
    this.frames.splice(this.current, 1);
    this.current = Math.min(this.current, this.frames.length - 1);
    this._changed(true);
  }

  clear(restPose) {
    this._record();
    this.frames = [restPose];
    this.current = 0;
    this.playing = false;
    this._changed(true);
  }

  togglePlay() {
    this.playing = !this.playing;
    this._clock = 0;
    this._changed(false);
  }

  pause() {
    if (this.playing) this.togglePlay();
  }

  toggleOnion() {
    this.onion = !this.onion;
    this._changed(false);
  }

  toggleMode(limb) {
    this.modes[limb] = this.modes[limb] === 'ik' ? 'fk' : 'ik';
    this._changed(false);
  }

  cycleFps() {
    this.fps = FPS_STEPS[(FPS_STEPS.indexOf(this.fps) + 1) % FPS_STEPS.length];
    this._changed(false);
  }

  tick(dt) {
    if (!this.playing || this.frames.length < 2) return;
    this._clock += dt;
    const step = 1 / this.fps;
    if (this._clock >= step) {
      this._clock %= step;
      this.go(this.current + 1);
    }
  }

  _changed(frameChanged) {
    this.version++;
    try {
      localStorage.setItem(KEY, JSON.stringify({ frames: this.frames, fps: this.fps }));
    } catch {}
    this.dispatchEvent(new CustomEvent('change', { detail: { frameChanged } }));
  }
}

// ---------- the film-strip panel ----------
const CW = 1024, CH = 340;
const CELLS = 9, CELL_W = 96, CELL_H = 150, CELL_GAP = 12, CELL_Y = 44;
const BTN_Y = 232, BTN_H = 78;
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
export const PANEL_W = 0.5, PANEL_H = (PANEL_W * CH) / CW;

// Stick figure segments drawn in each cell.
const SEGMENTS = [
  ['hips', 'chest'], ['chest', 'neck'], ['neck', 'head'], ['head', 'headTop'],
  ['chest', 'shoulderL'], ['shoulderL', 'elbowL'], ['elbowL', 'handL'],
  ['chest', 'shoulderR'], ['shoulderR', 'elbowR'], ['elbowR', 'handR'],
  ['hips', 'hipL'], ['hipL', 'kneeL'], ['kneeL', 'footL'],
  ['hips', 'hipR'], ['hipR', 'kneeR'], ['kneeR', 'footR'],
];

// A panel of frame cells (poke one to go there) and buttons. `thumb(pose)`
// returns joint positions in the puppet's frame for the stick-figure
// thumbnails. Pokes and clicks come in as panel-local points.
export class TimelinePanel {
  constructor(timeline, thumb) {
    this.tl = timeline;
    this.thumb = thumb;
    this.canvas = document.createElement('canvas');
    this.canvas.width = CW;
    this.canvas.height = CH;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(PANEL_W, PANEL_H), new THREE.MeshBasicMaterial({ map: this.texture, transparent: true }));
    this.regions = [];
    this.thumbs = new WeakMap(); // pose object → joints
    this.pressed = null; // region highlighted briefly after a press
    this._key = '';
  }

  _buttons() {
    const tl = this.tl;
    return [
      ['prev', '◀ PREV'],
      ['play', tl.playing ? '❚❚ PAUSE' : '▶ PLAY'],
      ['next', 'NEXT ▶'],
      ['add', '+ FRAME'],
      ['delete', 'DELETE'],
      ['onion', 'ONION', tl.onion],
      ['hands', 'HANDS ' + tl.modes.hand.toUpperCase(), tl.modes.hand === 'ik'],
      ['feet', 'FEET ' + tl.modes.foot.toUpperCase(), tl.modes.foot === 'ik'],
      ['fps', `${tl.fps} FPS`],
    ];
  }

  draw() {
    const tl = this.tl;
    const key = `${tl.version}|${this.pressed?.id}`;
    if (key === this._key) return;
    this._key = key;
    const g = this.ctx;
    g.clearRect(0, 0, CW, CH);
    g.fillStyle = 'rgba(10, 12, 24, 0.9)';
    g.beginPath();
    g.roundRect(0, 0, CW, CH, 26);
    g.fill();
    g.strokeStyle = 'rgba(159, 184, 255, 0.4)';
    g.lineWidth = 3;
    g.stroke();
    this.regions = [];

    g.font = `300 22px ${FONT}`;
    g.fillStyle = '#8b93b3';
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.fillText(`frame ${tl.current + 1} / ${tl.frames.length}`, 24, 24);
    g.textAlign = 'right';
    g.fillText(tl.playing ? 'playing' : tl.onion ? 'onion skin on' : '', CW - 24, 24);

    // cells, centred on the current frame
    const n = tl.frames.length;
    const first = Math.max(0, Math.min(tl.current - Math.floor(CELLS / 2), n - CELLS));
    const x0 = (CW - (CELLS * CELL_W + (CELLS - 1) * CELL_GAP)) / 2;
    for (let k = 0; k < CELLS; k++) {
      const i = first + k;
      const x = x0 + k * (CELL_W + CELL_GAP);
      if (i >= n) {
        g.strokeStyle = 'rgba(159, 184, 255, 0.15)';
        g.setLineDash([6, 6]);
        g.strokeRect(x, CELL_Y, CELL_W, CELL_H);
        g.setLineDash([]);
        continue;
      }
      const cur = i === tl.current;
      g.fillStyle = cur ? '#f3ead2' : '#cfc8b4';
      g.fillRect(x, CELL_Y, CELL_W, CELL_H);
      // film sprocket holes
      g.fillStyle = 'rgba(10, 12, 24, 0.9)';
      for (let y = CELL_Y + 8; y < CELL_Y + CELL_H - 6; y += 22) {
        g.fillRect(x + 4, y, 6, 10);
        g.fillRect(x + CELL_W - 10, y, 6, 10);
      }
      this._stick(g, tl.frames[i], x + CELL_W / 2, CELL_Y + CELL_H - 14);
      g.fillStyle = '#6b5f4a';
      g.font = `400 16px ${FONT}`;
      g.textAlign = 'center';
      g.fillText(String(i + 1), x + CELL_W / 2, CELL_Y + 14);
      if (cur) {
        g.strokeStyle = '#9fb8ff';
        g.lineWidth = 5;
        g.strokeRect(x - 3, CELL_Y - 3, CELL_W + 6, CELL_H + 6);
      }
      this.regions.push({ id: 'frame:' + i, x, y: CELL_Y, w: CELL_W, h: CELL_H });
    }

    // buttons
    const btns = this._buttons();
    const bw = (CW - 48 - (btns.length - 1) * 10) / btns.length;
    btns.forEach(([id, label, on], k) => {
      const x = 24 + k * (bw + 10);
      const hot = this.pressed?.id === id;
      g.fillStyle = hot ? 'rgba(159, 184, 255, 0.55)' : on ? 'rgba(159, 184, 255, 0.28)' : 'rgba(159, 184, 255, 0.1)';
      g.beginPath();
      g.roundRect(x, BTN_Y, bw, BTN_H, 16);
      g.fill();
      g.strokeStyle = 'rgba(159, 184, 255, 0.45)';
      g.lineWidth = 2;
      g.stroke();
      g.fillStyle = '#dfe6ff';
      g.font = `500 19px ${FONT}`;
      g.textAlign = 'center';
      g.fillText(label, x + bw / 2, BTN_Y + BTN_H / 2);
      this.regions.push({ id, x, y: BTN_Y, w: bw, h: BTN_H });
    });
    this.texture.needsUpdate = true;
  }

  _stick(g, pose, cx, baseY) {
    let j = this.thumbs.get(pose);
    if (!j) {
      j = this.thumb(pose);
      this.thumbs.set(pose, j);
    }
    const s = 290; // px per meter
    const ox = j.hips.x;
    const floor = Math.min(j.footL.y, j.footR.y) - 0.01;
    const P = (n) => [cx + (j[n].x - ox) * s, baseY - (j[n].y - floor) * s];
    g.strokeStyle = '#2b2418';
    g.lineWidth = 3;
    g.lineCap = 'round';
    g.beginPath();
    for (const [a, b] of SEGMENTS) {
      const [x1, y1] = P(a), [x2, y2] = P(b);
      g.moveTo(x1, y1);
      g.lineTo(x2, y2);
    }
    g.stroke();
    const [hx, hy] = P('head');
    g.beginPath();
    g.arc(hx, hy - 0.035 * s, 0.03 * s, 0, Math.PI * 2);
    g.stroke();
  }

  // `local`: point in the panel's frame (meters). Returns the region hit.
  hit(local) {
    const px = (local.x / PANEL_W + 0.5) * CW, py = (0.5 - local.y / PANEL_H) * CH;
    return this.regions.find((r) => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) || null;
  }

  flash(region) {
    this.pressed = region;
    clearTimeout(this._flashTimer);
    this._flashTimer = setTimeout(() => (this.pressed = null), 180);
  }
}
