// Open tabs, shared by the 2D browser and the XR Rolodex, saved in
// localStorage. A tab with an empty url shows the start page.

const KEY = 'vros.holodex.tabs';
const SEARCH = 'https://duckduckgo.com/?q=';

// Sites known to refuse being shown inside another page (X-Frame-Options /
// frame-ancestors). They get an "open in window" card instead of a blank frame.
const NO_FRAMING = [
  'google.com', 'github.com', 'x.com', 'twitter.com', 'facebook.com', 'instagram.com',
  'reddit.com', 'linkedin.com', 'amazon.com', 'netflix.com', 'chatgpt.com', 'claude.ai',
];

// Turn what was typed in the address bar into a URL: full URLs pass through,
// things that look like a domain get https://, anything else is a search.
export function normalizeUrl(input) {
  const s = input.trim();
  if (!s) return '';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s;
  if (!/\s/.test(s) && /^[^/]+\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(s)) return 'https://' + s;
  return SEARCH + encodeURIComponent(s);
}

export function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

export function titleOf(tab) {
  if (!tab.url) return 'New tab';
  if (tab.url.startsWith(SEARCH)) return '“' + decodeURIComponent(tab.url.slice(SEARCH.length)) + '”';
  return hostOf(tab.url) || tab.url;
}

// YouTube pages can't be framed but the embed player can.
export function frameUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^(www|m)\./, '');
    const id = host === 'youtu.be' ? u.pathname.slice(1) : host === 'youtube.com' && u.pathname === '/watch' ? u.searchParams.get('v') : null;
    if (id) return `https://www.youtube.com/embed/${encodeURIComponent(id)}`;
  } catch {}
  return url;
}

export function framingBlocked(url) {
  if (frameUrl(url) !== url) return false;
  const host = hostOf(url);
  return NO_FRAMING.some((d) => host === d || host.endsWith('.' + d));
}

let nextId = 1;

export class Tabs extends EventTarget {
  constructor() {
    super();
    this.list = [];
    this.activeId = null;
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (saved?.list?.length) {
        this.list = saved.list.map((t) => ({ id: nextId++, url: t.url || '', back: [], fwd: [] }));
        this.activeId = this.list[Math.min(saved.active | 0, this.list.length - 1)].id;
      }
    } catch {}
    if (!this.list.length) this.add('https://en.wikipedia.org/wiki/Rolodex', false);
  }

  get active() {
    return this.list.find((t) => t.id === this.activeId) || this.list[0];
  }

  get activeIndex() {
    return this.list.indexOf(this.active);
  }

  add(url = '', emit = true) {
    const tab = { id: nextId++, url, back: [], fwd: [] };
    const at = this.activeId ? this.activeIndex + 1 : this.list.length;
    this.list.splice(at, 0, tab);
    this.activeId = tab.id;
    if (emit) this._changed();
    return tab;
  }

  close(id) {
    const i = this.list.findIndex((t) => t.id === id);
    if (i < 0) return;
    this.list.splice(i, 1);
    if (!this.list.length) this.list.push({ id: nextId++, url: '', back: [], fwd: [] });
    if (this.activeId === id) this.activeId = this.list[Math.min(i, this.list.length - 1)].id;
    this._changed();
  }

  activate(id) {
    if (id === this.activeId || !this.list.some((t) => t.id === id)) return;
    this.activeId = id;
    this._changed();
  }

  navigate(url) {
    const tab = this.active;
    if (url === tab.url) return;
    if (tab.url) tab.back.push(tab.url);
    tab.fwd.length = 0;
    tab.url = url;
    this._changed();
  }

  back() {
    const tab = this.active;
    if (!tab.back.length) return;
    tab.fwd.push(tab.url);
    tab.url = tab.back.pop();
    this._changed();
  }

  forward() {
    const tab = this.active;
    if (!tab.fwd.length) return;
    tab.back.push(tab.url);
    tab.url = tab.fwd.pop();
    this._changed();
  }

  _changed() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ list: this.list.map((t) => ({ url: t.url })), active: this.activeIndex }));
    } catch {}
    this.dispatchEvent(new Event('change'));
  }
}
