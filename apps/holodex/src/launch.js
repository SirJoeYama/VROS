// Opening a card as a real browser tab. Every card has its own tab, named
// after the card, so opening it again brings that tab back (where the browser
// allows) instead of piling up new ones.
//
// Browsers only open tabs from a user action: a click, a key, or in XR a
// pinch or trigger ("select"). Returns false when the browser refused.

const tabName = (tab) => 'holodex-' + tab.id;

// Show the card's tab: bring it back if it's already open, else open it.
export function openTab(tab) {
  if (!tab.url) return false;
  const w = window.open('', tabName(tab));
  if (!w) return false;
  let fresh = false;
  try {
    // A tab we just created is still a blank page of our own; one that's
    // been showing its site is out of reach (cross-origin), which is fine.
    fresh = w.location.href === 'about:blank';
  } catch {}
  if (fresh) load(w, tab.url);
  else w.focus();
  return true;
}

// Load the card's address in its tab, even if that tab is somewhere else now.
export function goTab(tab) {
  if (!tab.url) return false;
  const w = window.open('', tabName(tab));
  if (!w) return false;
  load(w, tab.url);
  return true;
}

// The tab keeps its link back to Holodex (window.opener): the browser finds a
// named tab again only through that link. Sites that isolate themselves
// (Cross-Origin-Opener-Policy) cut it on their side, and then opening the
// card makes a fresh tab.
function load(w, url) {
  w.location.replace(url);
  w.focus();
}
