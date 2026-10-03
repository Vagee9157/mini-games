#!/usr/bin/env python3
"""源码对账 —— 两件事：格子标记不能撞字母，帮助文案不能写死数字。

本仓库「说明书说谎」出过四次，全是同一个形状：**数字被写进字符串字面量**，
常量后来改了，字符串没跟着改。

  · '注入 一行 2 · ...'            实际 heatGain(1) = 3
  · '热度 100 → ×7'                实际 ×9.1
  · '用它消行时，那一次得分 ×3'     实际应读 GOLD_MULT
  · 金块概率注释写 1/38             实际 1/24

所以规则很简单：帮助文案里出现的每个数字都必须是 `+ 表达式 +` 拼进去的，
不能是敲在引号里的。敲在引号里 = 它和代码之间没有任何约束 = 迟早对不上。

为什么不用「把常量改掉看文案跟不跟着变」那种差分法：ratio 会抵消
（1/130 分子分母一起缩放还是 1/130），而函数体里的字面量压根没法缩放 ——
那条路要么漏报要么假阳性一大片。这条规则是静态的，没有这两个问题。

跑法：  python3 tools/audit.py
退出码：0 = 干净，1 = 有写死的数字
"""
import re, sys, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC  = os.path.join(ROOT, 'tetris', 'tetris.js')

# 受管辖的区域：帮助页文案的三个来源。
# 新增帮助文案来源时要加进来，否则那块就审计不到。
ZONES = [
    ('helpSections', r'function helpSections\(\)\s*\{', r'\n\}'),
    ('MOD_HELP',     r'const MOD_HELP = \{',            r'\n\};'),
]

# 允许出现在文案里的数字。每一条都要能说清楚「它为什么不是参数」。
ALLOW = {
    # 中文量词的阿拉伯写法，描述的是规则形状本身，不是可调参数
    '1': '「一行」「一列」「一圈」',
    '2': '「两行」「要消两次」',
    '3': '「三行」「三列」「三分之一」',
    '4': '「四行」—— 一次最多消四行是俄罗斯方块的定义，不是参数',
}

def zones(src):
    for name, head, tail in ZONES:
        m = re.search(head, src)
        if not m:
            yield name, None, None; continue
        start = m.end()
        t = re.search(tail, src[start:])
        yield name, start, start + (t.end() if t else len(src) - start)

# 抓字符串字面量（单引号 / 双引号 / 反引号），跳过转义
STR = re.compile(r"'((?:[^'\\\n]|\\.)*)'|\"((?:[^\"\\\n]|\\.)*)\"|`((?:[^`\\]|\\.)*)`")

MARKERS = ('GARBAGE', 'FROZEN', 'CHEST', 'ZONE')

def markers(src):
    """格子标记不能和方块类型撞字母。

    这四个标记（灰线/冰冻/宝箱/死行）和方块类型共用同一个格子字段。
    ZONE 原本写成 'Z'，正好是 Z 型方块 —— 于是 Z 块被当成死行画，
    而且一整行 Z 块会被判成死行永远消不掉。字母撞车没有任何征兆，
    只能靠机器盯。
    """
    types = re.search(r'const PIECES = \{(.*?)\n\};', src, re.S)
    if not types:
        return ['找不到 PIECES，无法核对格子标记']
    tset = set(re.findall(r"^\s*([A-Z])\s*:", types.group(1), re.M))
    bad = []
    seen = {}
    for name in MARKERS:
        m = re.search(rf"const {name}\s*=\s*'(.)'", src)
        if not m:
            bad.append(f'找不到格子标记 {name}'); continue
        ch = m.group(1)
        if ch in tset:
            bad.append(f"{name} = '{ch}' 和方块类型 {ch} 撞字母")
        if ch in seen:
            bad.append(f"{name} 和 {seen[ch]} 都用了 '{ch}'")
        seen[ch] = name
    return bad

def main():
    src = open(SRC, encoding='utf-8').read()
    mb = markers(src)
    if mb:
        print('❌ 格子标记有冲突：')
        for b in mb: print('  ', b)
        return 1
    print(f'格子标记 {len(MARKERS)} 个，和方块类型无冲突')
    lines = src.count('\n')
    bad, scanned = [], 0
    for name, a, b in zones(src):
        if a is None:
            print(f"❌ 找不到受管区域 {name} —— 代码结构变了，先修这个脚本"); return 1
        chunk = src[a:b]
        scanned += 1
        for m in STR.finditer(chunk):
            lit = next(g for g in m.groups() if g is not None)
            for d in re.finditer(r'\d+(?:\.\d+)?', lit):
                if d.group() in ALLOW: continue
                ln = src[:a + m.start()].count('\n') + 1
                bad.append((ln, d.group(), lit.strip()))

    print(f"扫了 {scanned} 个受管区域（共 {lines} 行源码）")
    if not bad:
        print("✅ 帮助文案里没有写死的数字 —— 每个数都是从常量拼进去的")
        return 0
    print(f"\n❌ {len(bad)} 处数字被直接写进了文案字符串：\n")
    for ln, d, lit in bad:
        print(f"  tetris/tetris.js:{ln}  «{d}»")
        print(f"      {lit[:100]}")
    print("\n改法：换成 `'…' + 常量 + '…'`。")
    print("若确属散文（量词之类），加进脚本顶部的 ALLOW，并写清它为什么不是参数。")
    return 1

sys.exit(main())
