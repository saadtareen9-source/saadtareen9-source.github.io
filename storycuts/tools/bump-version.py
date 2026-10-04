#!/usr/bin/env python3
"""Set the cache-busting version on every script and stylesheet in index.html.

Usage: python3 tools/bump-version.py 31

The import map makes modules imported by app.js (./render.js, ./animate.js...)
load with the same ?v=, so browsers never mix old and new code.
"""
import glob, os, re, sys

v = sys.argv[1]
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
path = os.path.join(root, 'index.html')
html = open(path).read()
mods = sorted(os.path.basename(p) for p in glob.glob(os.path.join(root, 'js', '*.js')))
imap = '  <script type="importmap">{"imports": {' + ', '.join(f'"./js/{m}": "./js/{m}?v={v}"' for m in mods) + '}}</script>\n'
html = re.sub(r'  <script type="importmap">.*?</script>\n', '', html, flags=re.S)
html = re.sub(r'(<script type="module" src="js/app\.js)(\?v=\d+)?"', rf'\1?v={v}"', html)
html = html.replace('  <script type="module" src="js/app.js', imap + '  <script type="module" src="js/app.js', 1)
html = re.sub(r'href="style\.css(\?v=\d+)?"', f'href="style.css?v={v}"', html)
open(path, 'w').write(html)
print(f'version {v}: {len(mods)} modules mapped')
