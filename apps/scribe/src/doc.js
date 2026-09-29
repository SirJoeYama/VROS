// The document being dictated: plain text plus an optional selection that the
// next spoken phrase replaces. Saved to localStorage so it survives reloads.

const KEY = 'vros.scribe.text';
const PUNCT = /^[,.!?;:]/;

function load() {
  try { return localStorage.getItem(KEY) || ''; } catch { return ''; }
}

function atSentenceStart(before) {
  return /(^|[.!?]|\n)\s*$/.test(before);
}

// Words and line breaks with their character ranges in `text`.
export function tokenize(text) {
  const out = [];
  for (const m of text.matchAll(/\n|[^\s]+/g)) {
    out.push({ text: m[0], start: m.index, end: m.index + m[0].length, newline: m[0] === '\n' });
  }
  return out;
}

export class Doc {
  constructor() {
    this.text = load();
    this.sel = null; // { start, end } character range
    this.interim = '';
    this.history = [];
    this.future = []; // undone texts, for redo
    this.version = 0; // bumps on any visible change
    this.textVersion = 0; // bumps when the text itself changes
  }

  get insertAt() {
    return this.sel ? this.sel.end : this.text.length;
  }

  select(a, b) {
    const start = Math.min(a.start, b.start), end = Math.max(a.end, b.end);
    if (this.sel && this.sel.start === start && this.sel.end === end) return;
    this.sel = { start, end };
    this.version++;
  }

  clearSelection() {
    if (!this.sel) return;
    this.sel = null;
    this.version++;
  }

  setInterim(s) {
    if (s === this.interim) return;
    this.interim = s;
    this.version++;
  }

  // A final phrase from speech recognition: a voice command or text to write.
  dictate(raw) {
    const said = raw.trim();
    if (!said) return;
    const cmd = said.toLowerCase().replace(/[.!?,]/g, '').trim();
    if (cmd === 'undo' || cmd === 'scratch that') return this.undo();
    if (cmd === 'redo') return this.redo();
    if (cmd === 'new line' || cmd === 'new paragraph') return this.write('\n');
    if (this.sel && (cmd === 'delete' || cmd === 'delete that')) return this.write('');
    this.write(said);
  }

  // Replace the selection with `str`, or append it at the end.
  write(str) {
    const start = this.sel ? this.sel.start : this.text.length;
    const end = this.sel ? this.sel.end : this.text.length;
    let before = this.text.slice(0, start), after = this.text.slice(end);

    if (str === '\n') {
      before = before.replace(/[ \t]+$/, '');
      after = after.replace(/^[ \t]+/, '');
    } else if (str) {
      if (this.sel) str = this._matchStyle(str, this.text.slice(start, end));
      if (str && atSentenceStart(before)) str = str[0].toUpperCase() + str.slice(1);
      if (before && !/\s$/.test(before) && !PUNCT.test(str)) str = ' ' + str;
      if (after && !/^\s/.test(after) && !PUNCT.test(after)) str += ' ';
    } else {
      // Deleting: don't leave a double space or a space before punctuation.
      before = before.replace(/[ \t]+$/, '');
      if (before && after && !/^\s/.test(after) && !PUNCT.test(after)) before += ' ';
      if (PUNCT.test(after.trimStart())) after = after.trimStart();
    }

    this.history.push(this.text);
    if (this.history.length > 100) this.history.shift();
    this.future.length = 0;
    this.text = before + str + after;
    this.sel = null;
    this.interim = '';
    this._changed();
  }

  // Both return true if they changed something.
  undo() {
    if (!this.history.length) return false;
    this.future.push(this.text);
    this.text = this.history.pop();
    this.sel = null;
    this._changed();
    return true;
  }

  redo() {
    if (!this.future.length) return false;
    this.history.push(this.text);
    this.text = this.future.pop();
    this.sel = null;
    this._changed();
    return true;
  }

  // A replacement keeps the case and trailing punctuation of the words it replaces.
  _matchStyle(str, old) {
    const oldPunct = old.match(/[.!?,;:]+$/)?.[0] || '';
    str = str.replace(/[.!?,;:]+$/, '');
    if (!str) return oldPunct;
    str += oldPunct;
    const first = old[0];
    if (first && first === first.toLowerCase() && !/^I\b/.test(str)) str = str[0].toLowerCase() + str.slice(1);
    return str;
  }

  _changed() {
    this.version++;
    this.textVersion++;
    try { localStorage.setItem(KEY, this.text); } catch {}
  }
}
