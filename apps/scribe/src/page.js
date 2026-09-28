import * as THREE from 'three';
import { tokenize } from './doc.js';

// A4 portrait (210 × 297 mm), enlarged 1.4× so it reads comfortably at arm's length.
export const PAGE_W = 0.294, PAGE_H = (PAGE_W * 297) / 210;

// Canvas at ~150 dpi of real A4.
const CW = 1240, CH = 1754;
const MARGIN = 120, TEXT_TOP = MARGIN, TEXT_BOTTOM = CH - MARGIN - 20;
const TEXT_LEFT = MARGIN, TEXT_RIGHT = CW - MARGIN;
const VIEW_H = TEXT_BOTTOM - TEXT_TOP;
const LINE = 58, ASCENT = 42;
const FONT = '38px Georgia, "Times New Roman", serif';
const FONT_INTERIM = 'italic 38px Georgia, "Times New Roman", serif';

export class Page {
  constructor(doc) {
    this.doc = doc;
    this.canvas = document.createElement('canvas');
    this.canvas.width = CW;
    this.canvas.height = CH;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;

    this.group = new THREE.Group();
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(PAGE_W, PAGE_H), new THREE.MeshBasicMaterial({ map: this.texture }));
    const frame = new THREE.Mesh(
      new THREE.PlaneGeometry(PAGE_W + 0.012, PAGE_H + 0.012),
      new THREE.MeshBasicMaterial({ color: 0x9fb8ff, transparent: true, opacity: 0.25, depthWrite: false }),
    );
    frame.position.z = -0.002;
    this.group.add(frame, this.mesh);

    this.tokens = [];
    this.lineCount = 0;
    this.scroll = 0;
    this.hover = -1;
    this.status = '';
    this._layoutVersion = -1;
    this._textVersion = doc.textVersion;
    this._drawKey = '';
  }

  get maxScroll() {
    return Math.max(0, this.lineCount * LINE - VIEW_H);
  }

  scrollBy(px) {
    this.scroll = THREE.MathUtils.clamp(this.scroll + px, 0, this.maxScroll);
  }

  // Page-local coordinates (meters, origin at the page center, +z toward the reader).
  toLocal(worldPoint, out) {
    return this.mesh.worldToLocal(out.copy(worldPoint));
  }

  contains(local, slack = 0) {
    return Math.abs(local.x) < PAGE_W / 2 + slack && Math.abs(local.y) < PAGE_H / 2 + slack;
  }

  // The word under a page-local point, or -1 over empty space.
  hit(local) {
    this._layout();
    const px = (local.x / PAGE_W + 0.5) * CW;
    const py = (0.5 - local.y / PAGE_H) * CH;
    if (py < TEXT_TOP - LINE / 2 || py > TEXT_BOTTOM + LINE / 2) return -1;
    const line = Math.floor((py - TEXT_TOP + this.scroll) / LINE);
    let best = -1, bestD = Infinity;
    this.tokens.forEach((t, i) => {
      if (t.line !== line || t.newline || t.interim) return;
      const d = px < t.x ? t.x - px : px > t.x + t.w ? px - (t.x + t.w) : 0;
      if (d < bestD) { bestD = d; best = i; }
    });
    return bestD < 80 ? best : -1;
  }

  _layout() {
    const doc = this.doc;
    if (this._layoutVersion === doc.version) return;
    this._layoutVersion = doc.version;
    const ctx = this.ctx;

    const tokens = tokenize(doc.text);
    if (doc.interim) {
      const at = doc.insertAt;
      const k = tokens.findIndex((t) => t.start >= at);
      const extra = doc.interim.split(/\s+/).filter(Boolean).map((text) => ({ text, start: at, end: at, interim: true }));
      tokens.splice(k < 0 ? tokens.length : k, 0, ...extra);
    }

    let x = TEXT_LEFT, line = 0;
    for (const t of tokens) {
      if (t.newline) {
        t.x = x; t.w = 0; t.line = line;
        x = TEXT_LEFT;
        line++;
        continue;
      }
      ctx.font = t.interim ? FONT_INTERIM : FONT;
      t.w = ctx.measureText(t.text).width;
      const space = x > TEXT_LEFT ? ctx.measureText(' ').width : 0;
      if (x + space + t.w > TEXT_RIGHT && x > TEXT_LEFT) {
        x = TEXT_LEFT;
        line++;
      } else x += space;
      t.x = x; t.line = line;
      x += t.w;
    }
    this.tokens = tokens;
    this.lineCount = line + 1;
    this.scroll = Math.min(this.scroll, this.maxScroll);

    // New text keeps the writing point in view.
    if (doc.textVersion !== this._textVersion || doc.interim) {
      this._textVersion = doc.textVersion;
      const caretLine = this._caret().line;
      const top = caretLine * LINE, bottom = top + LINE;
      if (bottom - this.scroll > VIEW_H) this.scroll = Math.min(this.maxScroll, bottom - VIEW_H);
      if (top < this.scroll) this.scroll = top;
    }
  }

  _caret() {
    const at = this.doc.insertAt;
    let last = null;
    for (const t of this.tokens) if (!t.interim && t.end <= at) last = t;
    if (!last) return { x: TEXT_LEFT, line: 0 };
    if (last.newline) return { x: TEXT_LEFT, line: last.line + 1 };
    return { x: last.x + last.w + 4, line: last.line };
  }

  draw(t) {
    this._layout();
    const doc = this.doc;
    const blink = !doc.sel && !doc.interim && Math.floor(t * 1.6) % 2 === 0;
    const key = `${doc.version}|${this.scroll.toFixed(1)}|${this.hover}|${this.status}|${blink}`;
    if (key === this._drawKey) return;
    this._drawKey = key;

    const ctx = this.ctx;
    ctx.fillStyle = '#f7f5ef';
    ctx.fillRect(0, 0, CW, CH);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, TEXT_TOP - 8, CW, VIEW_H + 16);
    ctx.clip();
    const yOf = (line) => TEXT_TOP + line * LINE - this.scroll;

    if (!doc.text && !doc.interim) {
      ctx.font = FONT_INTERIM;
      ctx.fillStyle = '#a3a7b3';
      ctx.fillText('Start speaking…', TEXT_LEFT + 8, yOf(0) + ASCENT);
    }

    const sel = doc.sel;
    this.tokens.forEach((tk, i) => {
      if (tk.newline) return;
      const y = yOf(tk.line);
      if (y < TEXT_TOP - LINE || y > TEXT_BOTTOM) return;
      const selected = sel && !tk.interim && tk.start >= sel.start && tk.end <= sel.end;
      if (selected || i === this.hover) {
        ctx.fillStyle = selected ? 'rgba(80, 120, 255, 0.28)' : 'rgba(80, 120, 255, 0.12)';
        ctx.fillRect(tk.x - 5, y + 4, tk.w + 10, LINE - 4);
      }
      if (selected && doc.interim) {
        ctx.strokeStyle = '#c0392b';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(tk.x, y + ASCENT - 12);
        ctx.lineTo(tk.x + tk.w, y + ASCENT - 12);
        ctx.stroke();
      }
      ctx.font = tk.interim ? FONT_INTERIM : FONT;
      ctx.fillStyle = tk.interim ? '#5a6fd6' : '#1d2230';
      ctx.fillText(tk.text, tk.x, y + ASCENT);
    });

    if (blink) {
      const c = this._caret();
      ctx.fillStyle = '#5a6fd6';
      ctx.fillRect(c.x, yOf(c.line) + 8, 3, LINE - 12);
    }
    ctx.restore();

    // Scrollbar in the right margin.
    if (this.maxScroll > 0) {
      const total = this.lineCount * LINE;
      const trackX = CW - 60, h = Math.max(60, (VIEW_H * VIEW_H) / total);
      const y = TEXT_TOP + (this.scroll / this.maxScroll) * (VIEW_H - h);
      ctx.fillStyle = 'rgba(29, 34, 48, 0.08)';
      ctx.fillRect(trackX, TEXT_TOP, 8, VIEW_H);
      ctx.fillStyle = 'rgba(90, 111, 214, 0.6)';
      ctx.fillRect(trackX, y, 8, h);
    }

    // Footer: dictation status.
    ctx.font = '26px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.fillStyle = '#7a8092';
    ctx.fillText(this.status, TEXT_LEFT, CH - 60);

    this.texture.needsUpdate = true;
  }
}
