#!/usr/bin/env python3
"""说明书对账 —— 禁止在帮助文案里直接敲阿拉伯数字。

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

def main():
    src = open(SRC, encoding='utf-8').read()
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
