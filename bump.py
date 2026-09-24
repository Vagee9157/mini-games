#!/usr/bin/env python3
"""给 CSS/JS 的引用打上内容哈希。

GitHub Pages 会缓存静态资源，改了文件但文件名不变的话，
回访的人可能拿到新 HTML 配旧 CSS，布局直接错乱。
每次改完样式或脚本，推之前跑一下这个。
"""
import hashlib, io, re, sys, os, json

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
    ('crazy/index.html', ['../assets/shared.css', '../tetris/tetris.css', '../tetris/tetris.js']),
]

# ── 疯狂版的 HTML 由标准版生成，不手工维护第二份 ──
# tetris/index.html 有 38 个 id，init 里十处 addEventListener 没有 null 守卫，
# 少一个就白屏。两份手工同步迟早漏，漏了还只有打开 /crazy/ 才炸。
def gen_crazy():
    src = io.open(os.path.join(ROOT, 'tetris/index.html'), encoding='utf-8').read()
    t = src
    # 资源路径改成指回 tetris/，顺便把哈希去掉（下面的打版本号环节会重新打）
    t = t.replace('href="tetris.css', 'href="../tetris/tetris.css')
    t = re.sub(r'src="tetris\.js(\?v=[a-f0-9]+)?"',
               'src="../tetris/tetris.js"', t)
    # 开关必须在 tetris.js 之前设
    t = t.replace('<script src="../tetris/tetris.js',
                  '<script>window.TETRIS_CRAZY = true;</script>\n<script src="../tetris/tetris.js')
    # 标题、名字、图标
    t = t.replace('<title>俄罗斯方块 · 小游戏合集</title>', '<title>疯狂俄罗斯方块 · 小游戏合集</title>')
    t = t.replace('content="浏览器里的俄罗斯方块，手机按键操作，竖屏横屏都能玩。"',
                  'content="加了 FEVER、黄金方块和行雨的俄罗斯方块，分数会爆。"')
    t = t.replace('content="方块"', 'content="疯狂方块"')
    t = t.replace('<h1>俄罗斯方块<em>TETRIS</em></h1>', '<h1>疯狂方块<em>CRAZY</em></h1>')
    t = t.replace('<h2>俄罗斯<span class="neon">方块</span></h2>',
                  '<h2>疯狂<span class="warn">方块</span></h2>')
    t = t.replace('href="../assets/icons/icon-180.png"', 'href="../assets/icons/crazy-180.png"')
    os.makedirs(os.path.join(ROOT, 'crazy'), exist_ok=True)
    p = os.path.join(ROOT, 'crazy/index.html')
    old = io.open(p, encoding='utf-8').read() if os.path.exists(p) else ''
    if old != t:
        io.open(p, 'w', encoding='utf-8').write(t)
        print('  已从 tetris/index.html 生成 crazy/index.html')

gen_crazy()

# 自检：HTML 里所有本地 src=/href= 都必须被 TARGETS 覆盖到，
# 免得漏一条导致疯狂版离线打不开
def audit():
    bad = []
    for html, assets in TARGETS:
        hp = os.path.join(ROOT, html)
        if not os.path.exists(hp): continue
        s = io.open(hp, encoding='utf-8').read()
        for m in re.finditer(r'(?:src|href)="([^"]+\.(?:css|js))(?:\?v=[a-f0-9]+)?"', s):
            rel = m.group(1)
            if rel.startswith(('http', '//')): continue
            if rel not in assets: bad.append((html, rel))
    if bad:
        print('  ⚠ 这些本地引用没进 TARGETS（离线会坏）:')
        for h, r in bad: print(f'    {h} → {r}')
    return not bad

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
audit()

# ── 顺便生成 Service Worker，好让这些游戏离线也能玩 ──
# 清单里放带版本号的资源路径，任何文件一改，整体版本号跟着变，
# 浏览器就会重新装 SW、拉新缓存、清掉旧的。
import glob

def rel(path):
    return os.path.relpath(path, ROOT).replace(os.sep, '/')

assets = ['./', './index.html', './manifest.json']
for html, deps in TARGETS:
    if not os.path.exists(os.path.join(ROOT, html)):
        continue
    d = os.path.dirname(html)
    if d:
        assets.append('./' + d + '/')
        assets.append('./' + html)
        mf = os.path.join(ROOT, d, 'manifest.json')
        if os.path.exists(mf):
            assets.append('./' + d + '/manifest.json')
    # 每个依赖都带上它当前的哈希
    for r in deps:
        real = os.path.normpath(os.path.join(ROOT, os.path.dirname(html), r))
        if not os.path.exists(real):
            continue
        assets.append('./' + rel(real) + '?v=' + digest(real))

for icon in sorted(glob.glob(os.path.join(ROOT, 'assets/icons/*.png'))):
    assets.append('./' + rel(icon))

# 去重且保持顺序
seen, uniq = set(), []
for a in assets:
    if a not in seen:
        seen.add(a); uniq.append(a)

ver = hashlib.sha1('|'.join(uniq).encode()).hexdigest()[:10]
tpl = io.open(os.path.join(ROOT, 'sw.js.tpl'), encoding='utf-8').read()
sw = tpl.replace('__VERSION__', ver).replace('__ASSETS__', json.dumps(uniq, ensure_ascii=False, indent=2))
swp = os.path.join(ROOT, 'sw.js')
old_sw = io.open(swp, encoding='utf-8').read() if os.path.exists(swp) else ''
if sw != old_sw:
    io.open(swp, 'w', encoding='utf-8').write(sw)
    print(f'Service Worker 已更新: {len(uniq)} 个资源, 版本 {ver}')
else:
    print('Service Worker 无变化')
