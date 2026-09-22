#!/usr/bin/env python3
"""给 CSS/JS 的引用打上内容哈希。

GitHub Pages 会缓存静态资源，改了文件但文件名不变的话，
回访的人可能拿到新 HTML 配旧 CSS，布局直接错乱。
每次改完样式或脚本，推之前跑一下这个。
"""
import hashlib, io, re, sys, os

ROOT = os.path.dirname(os.path.abspath(__file__))

def digest(path):
    with open(path, 'rb') as f:
        return hashlib.sha1(f.read()).hexdigest()[:8]

# (要改的 html, 该 html 里引用的资源相对路径)
TARGETS = [
    ('index.html',        ['assets/shared.css']),
    ('tetris/index.html', ['../assets/shared.css', 'tetris.css', 'tetris.js']),
    ('minesweeper/index.html', ['../assets/shared.css', '../assets/ui.css', 'mine.css', 'mine.js']),
    ('bubble/index.html', ['../assets/shared.css', '../assets/ui.css', 'bubble.css', 'bubble.js']),
    ('pool/index.html', ['../assets/shared.css', '../assets/ui.css', 'pool.css', 'pool.js']),
]

changed = []
for html, assets in TARGETS:
    hp = os.path.join(ROOT, html)
    if not os.path.exists(hp):
        continue
    s = io.open(hp, encoding='utf-8').read()
    orig = s
    for rel in assets:
        real = os.path.normpath(os.path.join(os.path.dirname(hp), rel))
        if not os.path.exists(real):
            print(f'  跳过（找不到）: {rel}'); continue
        v = digest(real)
        pat = re.escape(rel) + r'(\?v=[a-f0-9]+)?'
        s = re.sub(pat, f'{rel}?v={v}', s)
    if s != orig:
        io.open(hp, 'w', encoding='utf-8').write(s)
        changed.append(html)

print('已打版本号:', ', '.join(changed) if changed else '无变化')
