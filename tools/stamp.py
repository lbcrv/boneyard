"""
Cache-busting for GitHub Pages (which lets browsers cache every file for 10 min).

Writes a content hash into every module URL in index.html, so a fresh
index.html always asks for the matching .js/.css and a browser can never mix
an old main.js with a new index.html.

Run before committing:  python tools/stamp.py
"""
import hashlib
import json
import pathlib
import re

root = pathlib.Path(__file__).resolve().parent.parent
index = root / 'index.html'
html = index.read_text(encoding='utf-8')


def h(path):
    return hashlib.sha1(path.read_bytes()).hexdigest()[:8]


mods = sorted((root / 'src').glob('*.js'))
imports = {
    'three': 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js',
    'three/addons/': 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/',
    'cannon-es': 'https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/dist/cannon-es.js',
}
# relative keys are resolved against the page URL, so these remap every
# `import './x.js'` inside src/ to its hashed URL
for m in mods:
    imports[f'./src/{m.name}'] = f'./src/{m.name}?v={h(m)}'

block = json.dumps({'imports': imports}, indent=2, ensure_ascii=False)
block = '\n'.join('  ' + line for line in block.splitlines())
html = re.sub(r'<script type="importmap">.*?</script>',
              '<script type="importmap">\n' + block + '\n  </script>', html, flags=re.S)
html = re.sub(r'src="src/main\.js(\?v=[^"]*)?"', f'src="src/main.js?v={h(root / "src" / "main.js")}"', html)
html = re.sub(r'href="style\.css(\?v=[^"]*)?"', f'href="style.css?v={h(root / "style.css")}"', html)
index.write_text(html, encoding='utf-8')
print(f'stamped {len(mods)} modules + style.css')
