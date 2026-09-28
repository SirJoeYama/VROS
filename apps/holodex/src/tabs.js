// The cards on the Rolodex, shared by the 2D view and the XR Rolodex, saved
// in localStorage. Each card is a real browser tab: opening it hands the
// address to the browser (see launch.js), so every site works as usual.
// A card with an empty url shows the start page.

const KEY = 'vros.holodex.tabs';
const SEARCH = 'https://duckduckgo.com/?q=';

// Turn what was typed in the address bar into a URL: full URLs pass through,
// things that look like a domain get https://, anything else is a search.
export function normalizeUrl(input) {
  const s = input.trim();
  if (!s) return '';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s;
  if (!/\s/.test(s) && /^(localhost|[^/\s]+\.[a-z]{2,}|\d{1,3}(\.\d{1,3}){3})(:\d+)?([/?#].*)?$/i.test(s)) return 'https://' + s;
  return SEARCH + encodeURIComponent(s);
}

export function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

// The card's label: what you named it, else the search or the site.
export function titleOf(tab) {
  if (tab.title) return tab.title;
  if (!tab.url) return 'New card';
  if (tab.url.startsWith(SEARCH)) return '“' + decodeURIComponent(tab.url.slice(SEARCH.length).split('&')[0]).replace(/\+/g, ' ') + '”';
  return hostOf(tab.url) || tab.url;
}

export class Tabs extends EventTarget {
  constructor() {
    super();
    this.list = [];
    this.activeId = null;
    this.nextId = 1;
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (saved?.list?.length) {
        // Ids are kept: each one names the card's browser tab.
        this.list = saved.list.map((t) => ({ id: t.id || this.nextId++, url: t.url || '', title: t.title || '', opened: t.opened || 0 }));
        this.nextId = Math.max(saved.nextId || 1, ...this.list.map((t) => t.id + 1));
        this.activeId = this.list[Math.min(saved.active | 0, this.list.length - 1)].id;
      }
    } catch {}
    if (!this.list.length) {
      this.add('https://en.wikipedia.org/wiki/Rolodex', false);
      this.add('https://www.youtube.com/', false);
      this.activeId = this.list[0].id;
    }
  }

  get active() {
    return this.list.find((t) => t.id === this.activeId) || this.list[0];
  }

  get activeIndex() {
    return this.list.indexOf(this.active);
  }

  add(url = '', emit = true) {
    const tab = { id: this.nextId++, url, title: '', opened: 0 };
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
    if (!this.list.length) this.list.push({ id: this.nextId++, url: '', title: '', opened: 0 });
    if (this.activeId === id) this.activeId = this.list[Math.min(i, this.list.length - 1)].id;
    this._changed();
  }

  activate(id) {
    if (id === this.activeId || !this.list.some((t) => t.id === id)) return;
    this.activeId = id;
    this._changed();
  }

  // Point the active card at a new address (its label follows the site).
  navigate(url) {
    const tab = this.active;
    if (url === tab.url) return;
    tab.url = url;
    tab.title = '';
    this._changed();
  }

  rename(id, title) {
    const tab = this.list.find((t) => t.id === id);
    if (!tab) return;
    tab.title = title.trim();
    this._changed();
  }

  markOpened(tab) {
    tab.opened = Date.now();
    this._changed();
  }

  _changed() {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        list: this.list.map(({ id, url, title, opened }) => ({ id, url, title, opened })),
        active: this.activeIndex,
        nextId: this.nextId,
      }));
    } catch {}
    this.dispatchEvent(new Event('change'));
  }
}
