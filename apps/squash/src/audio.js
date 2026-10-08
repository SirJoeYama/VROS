import { CFG, clamp } from './config.js';

// Procedural sounds with the Web Audio API, no files: a pitched tock on
// paddle hits, a deeper thud on the walls, a chime when you score. Sounds are
// panned left / right by where in the court they happen.
export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuf = null;
  }

  // Audio may only start from a user action (a click, a pinch, entering XR).
  unlock() {
    try {
      if (!this.ctx) {
        const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
        this.master = ctx.createGain();
        this.master.gain.value = 0.6;
        this.master.connect(ctx.destination);
        this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.3, ctx.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  _out(x) {
    if (x === undefined || !this.ctx.createStereoPanner) return this.master;
    const p = this.ctx.createStereoPanner();
    p.pan.value = clamp(x / (CFG.COURT_W / 2), -1, 1) * 0.8;
    p.connect(this.master);
    return p;
  }

  _tone(type, f0, f1, peak, decay, x, delay = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + decay);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    o.connect(g).connect(this._out(x));
    o.start(t);
    o.stop(t + decay + 0.02);
  }

  _noise(peak, decay, freq, type, x) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(Math.max(peak, 0.0002), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    s.connect(f).connect(g).connect(this._out(x));
    s.start(t);
    s.stop(t + decay + 0.02);
  }

  tock(speed, x) {
    const k = clamp(speed / CFG.MAX_SPEED, 0, 1);
    this._tone('triangle', 650 + 900 * k, 480 + 500 * k, 0.35 + 0.4 * k, 0.09, x);
    this._tone('square', 1900 + 900 * k, 1200, 0.05, 0.025, x);
    this._noise(0.12 + 0.2 * k, 0.03, 3500, 'highpass', x);
  }

  thud(speed, x, big) {
    const k = clamp(speed / CFG.MAX_SPEED, 0.15, 1);
    this._tone('sine', big ? 150 : 190, big ? 52 : 70, (big ? 0.7 : 0.4) * k, big ? 0.25 : 0.16, x);
    this._noise((big ? 0.35 : 0.2) * k, 0.12, 500, 'lowpass', x);
  }

  floor(speed, x) {
    const k = clamp(speed / 8, 0.1, 1);
    this._tone('sine', 95, 48, 0.35 * k, 0.15, x);
    this._noise(0.12 * k, 0.06, 300, 'lowpass', x);
  }

  chime() {
    this._tone('sine', 1046.5, 1046.5, 0.18, 0.7);
    this._tone('sine', 1568, 1568, 0.12, 0.8, undefined, 0.06);
    this._tone('sine', 2093, 2093, 0.07, 0.9, undefined, 0.12);
  }

  serve() { this._tone('sine', 520, 780, 0.15, 0.12); }

  miss() { this._tone('triangle', 320, 110, 0.25, 0.45); }

  gameOver() {
    this._tone('triangle', 440, 430, 0.22, 0.3);
    this._tone('triangle', 349, 340, 0.22, 0.3, undefined, 0.3);
    this._tone('triangle', 262, 120, 0.25, 0.8, undefined, 0.6);
  }
}
