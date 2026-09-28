import { normalizeUrl, hostOf, titleOf, frameUrl, framingBlocked } from './tabs.js';

const PX_PER_CARD = 60; // drag distance that flips one card
const QUICK_LINKS = [
  ['Wikipedia', 'https://en.wikipedia.org/'],
  ['DuckDuckGo', 'https://duckduckgo.com/'],
  ['Hacker News', 'https://news.ycombinator.com/'],
  ['MDN', 'https://developer.mozilla.org/'],
  ['OpenStreetMap', 'https://www.openstreetmap.org/'],
  ['Internet Archive', 'https://archive.org/'],
];

const $ = (id) => document.getElementById(id);

function hue(s) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

// The 2D browser: a Rolodex of tab cards on the left (flip it by scrolling,
// dragging, or clicking a card; the front card is the open tab) and the page
// on the right.
export function startUI(tabs) {
  const drum = $('drum');
  const cards = new Map(); // tab id → card element
  const frames = new Map(); // tab id → { iframe, src }
  let pos = tabs.activeIndex; // continuous drum position (card index at the front)
  let target = pos;
  let settleTimer = 0;

  // ---------- drum ----------
  function cardFor(tab) {
    let el = cards.get(tab.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'card';
      el.innerHTML = '<div class="tab"><span class="host"></span></div><button class="close" title="Close tab">×</button><img class="fav" alt="" /><div class="title"></div><div class="url"></div>';
      el.querySelector('.close').addEventListener('click', (e) => {
        e.stopPropagation();
        tabs.close(tab.id);
      });
      el.addEventListener('click', () => {
        if (dragMoved) return;
        const i = tabs.list.indexOf(tab);
        target = i;
        tabs.activate(tab.id);
      });
      cards.set(tab.id, el);
      drum.appendChild(el);
    }
    if (el.dataset.url !== tab.url) {
      el.dataset.url = tab.url;
      const host = hostOf(tab.url);
      el.querySelector('.host').textContent = host || 'new tab';
      el.querySelector('.title').textContent = titleOf(tab);
      el.querySelector('.url').textContent = tab.url || 'type an address or search';
      const fav = el.querySelector('.fav');
      fav.onerror = () => (fav.style.display = 'none');
      fav.style.display = host ? '' : 'none';
      if (host) fav.src = `https://icons.duckduckgo.com/ip3/${host}.ico`;
      el.style.setProperty('--tab-hue', hue(host || 'new'));
    }
    return el;
  }

  function layoutDrum() {
    const alive = new Set(tabs.list.map((t) => t.id));
    for (const [id, el] of cards) if (!alive.has(id)) { el.remove(); cards.delete(id); }
    tabs.list.forEach((tab, i) => {
      const el = cardFor(tab);
      // Cards hinge on the axle like a real Rolodex: the front card stands up,
      // the ones behind fan backwards, and flipped ones tip toward you and down.
      const d = i - pos;
      const angle = 8 + (d >= 0 ? Math.min(d * 11, 70) : d * 110);
      const vis = angle > -88 && d < 7;
      el.style.transform = `rotateX(${angle}deg)`;
      el.style.setProperty('--slot', i % 4); // tabs are staggered so each one peeks out
      el.style.visibility = vis ? 'visible' : 'hidden';
      el.style.opacity = vis ? String(d > 0 ? 1 - Math.min(d, 6) * 0.1 : 1) : '0';
      el.classList.toggle('front', tab.id === tabs.activeId);
      el.style.zIndex = String(d < 0 ? 200 : 100 - Math.round(d * 10));
    });
    $('count').textContent = `${tabs.list.length} ${tabs.list.length === 1 ? 'card' : 'cards'}`;
  }

  function animate() {
    pos += (target - pos) * 0.2;
    if (Math.abs(target - pos) < 0.002) pos = target;
    layoutDrum();
    if (pos !== target || dragging) requestAnimationFrame(animate);
    else animating = false;
  }
  let animating = false;
  function kick() {
    if (!animating) { animating = true; requestAnimationFrame(animate); }
  }

  // Flip to card i; the tab under it opens once the drum settles.
  function flipTo(i, delay = 220) {
    target = Math.max(0, Math.min(tabs.list.length - 1, i));
    kick();
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => tabs.activate(tabs.list[target].id), delay);
  }

  $('rolodex').addEventListener('wheel', (e) => {
    e.preventDefault();
    flipTo(Math.round(target) + Math.sign(e.deltaY));
  }, { passive: false });

  let dragging = false, dragMoved = false, dragY = 0, dragPos = 0;
  $('rolodex').addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    dragging = true;
    dragMoved = false;
    dragY = e.clientY;
    dragPos = pos;
  });
  addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dy = e.clientY - dragY;
    if (Math.abs(dy) > 6) dragMoved = true;
    if (!dragMoved) return;
    target = pos = Math.max(-0.4, Math.min(tabs.list.length - 0.6, dragPos + dy / PX_PER_CARD));
    kick();
  });
  addEventListener('pointerup', () => {
    if (!dragging) return;
    dragging = false;
    if (dragMoved) flipTo(Math.round(pos), 120);
    setTimeout(() => (dragMoved = false), 0);
  });
  addEventListener('keydown', (e) => {
    if (e.target.closest('input')) return;
    if (e.key === 'ArrowDown') flipTo(Math.round(target) + 1);
    else if (e.key === 'ArrowUp') flipTo(Math.round(target) - 1);
  });

  $('new-tab').addEventListener('click', () => {
    tabs.add('');
    $('address').focus();
  });

  // ---------- viewer ----------
  const viewer = $('viewer');
  function showActive() {
    const tab = tabs.active;
    $('address').value = tab.url;
    $('back').disabled = !tab.back.length;
    $('forward').disabled = !tab.fwd.length;
    $('popout').disabled = !tab.url;

    const blocked = tab.url && framingBlocked(tab.url);
    $('start').hidden = !!tab.url;
    $('blocked').hidden = !blocked;
    if (blocked) $('blocked-host').textContent = hostOf(tab.url);

    for (const [id, f] of frames) {
      if (!tabs.list.some((t) => t.id === id)) { f.iframe.remove(); frames.delete(id); }
    }
    let f = frames.get(tab.id);
    if (tab.url && !blocked) {
      const src = frameUrl(tab.url);
      if (!f) {
        const iframe = document.createElement('iframe');
        iframe.allow = 'fullscreen; autoplay; encrypted-media; picture-in-picture; clipboard-write';
        iframe.referrerPolicy = 'strict-origin-when-cross-origin';
        viewer.appendChild(iframe);
        f = { iframe, src: '' };
        frames.set(tab.id, f);
      }
      if (f.src !== src) f.iframe.src = f.src = src;
    }
    for (const [id, other] of frames) other.iframe.hidden = id !== tab.id || !tab.url || blocked;
  }

  $('nav').addEventListener('submit', (e) => {
    e.preventDefault();
    tabs.navigate(normalizeUrl($('address').value));
    $('address').blur();
  });
  $('back').addEventListener('click', () => tabs.back());
  $('forward').addEventListener('click', () => tabs.forward());
  $('reload').addEventListener('click', () => {
    const f = frames.get(tabs.activeId);
    if (f) f.iframe.src = f.src;
  });
  const popout = () => tabs.active.url && window.open(tabs.active.url, '_blank', 'noopener');
  $('popout').addEventListener('click', popout);
  $('blocked-open').addEventListener('click', popout);

  const links = $('quick-links');
  for (const [name, url] of QUICK_LINKS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = name;
    b.addEventListener('click', () => tabs.navigate(url));
    links.appendChild(b);
  }
  $('start-search').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $('start-query').value;
    $('start-query').value = '';
    if (q.trim()) tabs.navigate(normalizeUrl(q));
  });

  $('help-toggle').addEventListener('click', () => ($('help').hidden = !$('help').hidden));

  tabs.addEventListener('change', () => {
    if (!dragging) {
      target = tabs.activeIndex;
      kick();
    }
    showActive();
    layoutDrum();
  });
  showActive();
  layoutDrum();
}
