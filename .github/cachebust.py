"""Stamp the site's code and styles with a version when it's deployed.

GitHub Pages lets browsers keep files for 10 minutes, and the Quest Browser
keeps ES modules even longer, so after a deploy it can go on running the old
code. This gives every deploy new URLs, run on the copy being published
(the source files and local testing are left alone):

- each page's import map gets an entry for every local .js file, mapping it
  to the same file with ?v=<version>, so every import (static or dynamic,
  from any depth) asks for the new version;
- each page's entry script and stylesheet get ?v=<version> too (import maps
  don't apply to <script src> or <link>).

Usage: VERSION=<commit sha> python3 .github/cachebust.py [site root]
"""
import json
import os
import re
import sys

root = sys.argv[1] if len(sys.argv) > 1 else '.'
version = (os.environ.get('VERSION') or 'dev')[:8]
SKIP = {'.git', '.github', 'node_modules'}


def files(ext):
    out = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP]
        out += [os.path.join(dirpath, f) for f in filenames if f.endswith(ext)]
    return out


scripts = files('.js')
IMPORTMAP = re.compile(r'(<script type="importmap">)(.*?)(</script>)', re.S)
ENTRY = re.compile(r'(<script type="module" src=")([^":?]+\.js)(")')
STYLE = re.compile(r'(<link rel="stylesheet" href=")([^":?]+\.css)(")')
stamp = lambda m: f'{m.group(1)}{m.group(2)}?v={version}{m.group(3)}'

for page in files('.html'):
    with open(page, encoding='utf-8') as f:
        html = f.read()
    m = IMPORTMAP.search(html)
    if not m:
        print(f'skipped {page}: no import map')
        continue
    imap = json.loads(m.group(2))
    imports = imap.setdefault('imports', {})
    base = os.path.dirname(page)
    for js in scripts:
        rel = os.path.relpath(js, base).replace(os.sep, '/')
        if not rel.startswith('.'):
            rel = './' + rel
        imports.setdefault(rel, f'{rel}?v={version}')
    html = html[: m.start(2)] + '\n' + json.dumps(imap, indent=2) + '\n' + html[m.end(2):]
    html = STYLE.sub(stamp, ENTRY.sub(stamp, html))
    with open(page, 'w', encoding='utf-8') as f:
        f.write(html)
    print(f'versioned {page}')
