// The drawing: layers, each with its own frames; a frame is a list of
// strokes. The playhead `t` counts frames; a layer shows frame t mod its
// length, so a one-frame layer stays still while others animate.
// Strokes never change once drawn, so frames can share them (duplicating a
// frame is cheap) and undo only has to remember lists.
// Saved in IndexedDB (drawings get too big for localStorage).

export const MAX_LAYERS = 6;
const FPS_STEPS = [6, 8, 12, 15, 24, 30];

let nextId = 1;
const frame = (strokes = []) => ({ id: nextId++, strokes });
const layer = (name) => ({ id: nextId++, name, visible: true, frames: [frame()] });

export class Doc extends EventTarget {
  constructor() {
    super();
    this.reset();
  }

  reset() {
    this.layers = [layer('1')];
    this.active = 0;
    this.t = 0;
    this.fps = 12;
    this.undoStack = [];
    this.redoStack = [];
    this._changed();
  }

  get layer() {
    return this.layers[this.active];
  }

  get length() {
    return Math.max(...this.layers.map((l) => l.frames.length));
  }

  frameIndex(l = this.layer) {
    return this.t % l.frames.length;
  }

  shown(l) {
    return l.frames[this.frameIndex(l)];
  }

  get frame() {
    return this.shown(this.layer);
  }

  // ---------- undoable edits ----------
  // Each edit is a pair of functions; the stacks hold them.
  _do(apply, revert) {
    apply();
    this.undoStack.push({ apply, revert });
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack.length = 0;
    this._changed();
  }

  undo() {
    const e = this.undoStack.pop();
    if (!e) return;
    e.revert();
    this.redoStack.push(e);
    this._changed();
  }

  redo() {
    const e = this.redoStack.pop();
    if (!e) return;
    e.apply();
    this.undoStack.push(e);
    this._changed();
  }

  // Replace a frame's stroke list (drawing, erasing).
  _setStrokes(f, next) {
    const prev = f.strokes;
    this._do(() => { f.strokes = next; f.version = (f.version || 0) + 1; }, () => { f.strokes = prev; f.version = (f.version || 0) + 1; });
  }

  addStroke(s) {
    const f = this.frame;
    this._setStrokes(f, [...f.strokes, s]);
  }

  // Erasing: strokes vanish as the eraser sweeps (liveRemove), and the whole
  // sweep becomes one undo step (commit, with the list from before it).
  liveRemove(gone) {
    const f = this.frame;
    const next = f.strokes.filter((s) => !gone.has(s));
    if (next.length === f.strokes.length) return;
    f.strokes = next;
    this._changed(false);
  }

  commit(f, before) {
    const after = f.strokes;
    if (after === before) return;
    f.strokes = before;
    this._setStrokes(f, after);
  }

  // Frame and layer structure: remember the whole frame list / layer list.
  _setFrames(l, frames, t) {
    const prev = l.frames, prevT = this.t;
    this._do(() => { l.frames = frames; this.t = t; }, () => { l.frames = prev; this.t = prevT; });
  }

  addFrame(copy) {
    const l = this.layer, i = this.frameIndex();
    const frames = [...l.frames];
    frames.splice(i + 1, 0, frame(copy ? [...l.frames[i].strokes] : []));
    this._setFrames(l, frames, i + 1);
  }

  deleteFrame() {
    const l = this.layer;
    if (l.frames.length < 2) return this._setStrokes(this.frame, []); // the last one just empties
    const i = this.frameIndex();
    const frames = l.frames.filter((_, k) => k !== i);
    this._setFrames(l, frames, Math.min(i, frames.length - 1));
  }

  _setLayers(layers, active) {
    const prev = this.layers, prevActive = this.active;
    this._do(() => { this.layers = layers; this.active = active; }, () => { this.layers = prev; this.active = prevActive; });
  }

  addLayer() {
    if (this.layers.length >= MAX_LAYERS) return;
    const names = new Set(this.layers.map((l) => l.name));
    let k = 1;
    while (names.has(String(k))) k++;
    const layers = [...this.layers];
    layers.splice(this.active + 1, 0, layer(String(k)));
    this._setLayers(layers, this.active + 1);
  }

  deleteLayer() {
    if (this.layers.length < 2) return;
    const layers = this.layers.filter((_, k) => k !== this.active);
    this._setLayers(layers, Math.min(this.active, layers.length - 1));
  }

  // ---------- not undoable ----------
  select(i) {
    if (i < 0 || i >= this.layers.length) return;
    this.active = i;
    this._changed();
  }

  toggleVisible(i) {
    const l = this.layers[i];
    if (!l) return;
    l.visible = !l.visible;
    this._changed();
  }

  go(t) {
    const n = this.length;
    this.t = ((t % n) + n) % n;
    this._changed(false);
  }

  cycleFps() {
    this.fps = FPS_STEPS[(FPS_STEPS.indexOf(this.fps) + 1) % FPS_STEPS.length] || 12;
    this._changed();
  }

  // `save`: false for playhead moves, which don't need saving.
  _changed(save = true) {
    this.version = (this.version || 0) + 1;
    this.dispatchEvent(new CustomEvent('change', { detail: { save } }));
  }

  // ---------- saving ----------
  toJSON() {
    return {
      fps: this.fps,
      active: this.active,
      layers: this.layers.map((l) => ({ name: l.name, visible: l.visible, frames: l.frames.map((f) => f.strokes) })),
    };
  }

  load(data) {
    if (!data?.layers?.length) return false;
    this.layers = data.layers.map((l) => ({ id: nextId++, name: l.name, visible: l.visible !== false, frames: l.frames.map((s) => frame(s)) }));
    this.active = Math.min(data.active || 0, this.layers.length - 1);
    this.fps = data.fps || 12;
    this.t = 0;
    this.undoStack = [];
    this.redoStack = [];
    this._changed(false);
    return true;
  }
}

// A tiny IndexedDB key-value store.
const DB = 'vros-plume', STORE = 'kv';
function open() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function saveDoc(data) {
  const db = await open();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(data, 'doc');
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
export async function loadDoc() {
  const db = await open();
  const data = await new Promise((resolve, reject) => {
    const r = db.transaction(STORE).objectStore(STORE).get('doc');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  db.close();
  return data;
}
